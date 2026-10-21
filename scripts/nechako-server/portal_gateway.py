#!/usr/bin/env python3
"""Loopback-only gateway for verified Nechako reads and reviewed source changes.

Bounded changes require a private authenticated session and local CSRF token.
Upstream cookies stay in each client's in-memory CookieJar and are discarded
after 30 minutes of inactivity/restart.
"""

import argparse
import http.cookiejar
import http.cookies
import json
import math
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORTAL = 'https://nechakowatershed-portal.ca/'
BASE = '/api/nechako-portal'
COOKIE = 'nechako_local_session'
MAX_BODY = 1024 * 1024
MAX_RESPONSE = 20 * 1024 * 1024
MAX_DOWNLOAD = 32 * 1024 * 1024
SESSION_TTL = 1800
MAX_SESSIONS = 64

# Endpoint spelling, including GetFormStatistics, comes from build 6268M client source.
READS = {
    'rest/portal/getSearchContext.php': ({'types'}, set()),
    'rest/portal/getSearchResults.php': ({'keys', 'fields', 'area'}, {'keys', 'fields', 'area'}),
    'rest/openmap/getBaseLayers.php': ({'mode'}, {'mode'}),
    'rest/openmap/getDefaultProject.php': (set(), set()),
    'rest/openmap/savedProjects.php': ({'mode', 'projectId'}, {'mode'}),
    'rest/openmap/getProjectHistory.php': ({'mode', 'historyId', 'projectId'}, {'mode'}),
    'rest/portal/getForms.php': ({'page', 'start', 'limit'}, set()),
    'rest/portal/getForm.php': ({'id'}, {'id'}),
    'rest/portal/getSubmissionForm.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getFieldValue.php': ({'fieldId', 'submissionId', 'fieldIndex'}, {'fieldId', 'submissionId', 'fieldIndex'}),
    'rest/portal/getSchemas.php': ({'page', 'start', 'limit'}, set()),
    'rest/portal/getSchemaFields.php': ({'schemaId'}, {'schemaId'}),
    # SchemaManager.js Monitors tab; includes draft/disabled associations, so
    # authorize_read requires the same administrator role as /admin/ routes.
    'rest/portal/getMonitorSchemaLayers.php': ({'schemaId', 'getDraftSubmissions', 'getDisabled'}, {'schemaId', 'getDraftSubmissions', 'getDisabled'}),
    'rest/portal/getStatusFlags.php': (set(), set()),
    'rest/portal/getSpatialFormats.php': (set(), set()),
    'rest/portal/getSubmissionMetadata.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getSubmissionLayers.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getSubmissionLinkedLayers.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getSubmissionAttachments.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getSubmissionPermissions.php': ({'submissionId'}, {'submissionId'}),
    'rest/portal/getHistory.php': ({'sub_id'}, {'sub_id'}),
    'rest/portal/getChildren.php': ({'parentId'}, {'parentId'}),
    'rest/portal/getSubmissionMonitorSchemaLayers.php': ({'formId', 'submissionId'}, {'formId', 'submissionId'}),
    'rest/portal/getMonitorData.php': ({'schemaId', 'layerId', 'recId', 'submissionId', 'getDraft', 'getSingleLayerInfo', 'pageSize', 'pageNumber'}, {'pageSize', 'pageNumber'}),
    'rest/openmap/getPortalLayer.php': ({'type', 'layerId'}, {'type', 'layerId'}),
    'rest/portal/GetFormStatistics.php': ({'formId', 'mapping'}, {'formId', 'mapping'}),
    'rest/portal/getFormsLinkedSchemas.php': ({'formId'}, {'formId'}),
    'rest/portal/getFormVisibleGroups.php': ({'formId'}, {'formId'}),
    'rest/portal/getFormPermissions.php': ({'formId', 'hideInactive'}, {'formId'}),
    'rest/portal/getMatchPresets.php': ({'mode', 'formId', 'schemaId'}, {'mode'}),
    'rest/portal/saveLoadReportingToolPresets.php': ({'mode', 'matchId'}, {'mode', 'matchId'}),
    'rest/portal/saveLoadMonitoringNodePresets.php': ({'mode', 'matchId'}, {'mode', 'matchId'}),
    'rest/portal/getUsers.php': ({'page', 'start', 'limit'}, set()),
    'rest/portal/admin/getGroups.php': (set(), set()),
    'rest/portal/admin/getGroupMembers.php': ({'gid', 'includePrimaryGroupStatus'}, {'gid'}),
    'rest/portal/admin/getUserDetails.php': ({'uid'}, {'uid'}),
    'rest/portal/admin/getUserPermissionsCheckbox.php': ({'uid', 'mode'}, {'uid', 'mode'}),
    'rest/portal/admin/getUserForms.php': ({'form_id'}, {'form_id'}),
    'rest/portal/admin/getLinkableLayers.php': ({'page', 'start', 'limit'}, set()),
    'rest/portal/admin/getLayerSharedLayersManager.php': ({'layerId'}, {'layerId'}),
    'rest/portal/admin/getAllBaseLayers.php': (set(), set()),
    'rest/portal/admin/getContents.php': (set(), set()),
    'rest/portal/admin/getSubmissions.php': ({'page', 'start', 'limit'}, set()),
    'rest/portal/getTaskStatuses.php': (set(), set()),
    'rest/portal/getPriorities.php': (set(), set()),
    'rest/portal/getHolidays.php': (set(), set()),
    'rest/portal/schedule.php': ({'mode', 'date'}, {'mode', 'date'}),
}


def positive(value):
    return isinstance(value, str) and value.isdecimal() and 0 < int(value) <= 2147483647


def validate_read(path, params):
    if not isinstance(path, str) or path not in READS:
        raise ValueError('This endpoint is not a verified read route.')
    if not isinstance(params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in params.items()):
        raise ValueError('Read parameters must be string values.')
    allowed, required = READS[path]
    if not set(params) <= allowed or not required <= set(params):
        raise ValueError('Unexpected or missing parameters for the verified read route.')
    for key, value in params.items():
        if len(value) > 250000:
            raise ValueError('A read parameter exceeds the development limit.')
        if key in {'projectId', 'historyId', 'schemaId', 'recId', 'submissionId', 'fieldId', 'formId', 'form_id', 'id', 'sub_id', 'parentId', 'matchId', 'gid', 'layerId', 'uid'} and not positive(value):
            raise ValueError(f'{key} must be a positive numeric ID.')
    if path.endswith('savedProjects.php'):
        mode = params['mode']
        if mode not in {'list', 'load', 'getDescription', 'getSharedGroups'}:
            raise ValueError('Saved-project mutations are not enabled.')
        if (mode == 'list' and 'projectId' in params) or (mode != 'list' and not positive(params.get('projectId'))):
            raise ValueError('Invalid saved-project read parameters.')
    if path.endswith('getProjectHistory.php') and (params['mode'] != 'loadRec' or not positive(params.get('historyId')) or 'projectId' in params):
        raise ValueError('Only the verified history loadRec read is enabled.')
    if path.endswith('getBaseLayers.php') and params['mode'] not in {'notbase', 'default'}:
        raise ValueError('Invalid layer catalogue mode.')
    if path.endswith('getPortalLayer.php') and params['type'] != 'layer':
        raise ValueError('Only the verified portal layer descriptor read is enabled.')
    if path.endswith('Presets.php') and '/saveLoad' in path and params['mode'] != 'load':
        raise ValueError('Preset mutations are not enabled.')
    if path.endswith('getMatchPresets.php') and params['mode'] not in {'monitoringNode', 'reportingTool'}:
        raise ValueError('Invalid preset read mode.')
    if path.endswith('schedule.php') and params['mode'] not in {'notification', 'date', 'monthly'}:
        raise ValueError('Schedule changes are not enabled.')
    if path.endswith('getUserPermissionsCheckbox.php') and params['mode'] not in {'form', 'submission', 'match_preset', 'shared_style', 'shared_project'}:
        raise ValueError('Invalid resource-permission read mode.')
    if 'includePrimaryGroupStatus' in params and params['includePrimaryGroupStatus'] not in {'true', 'false'}:
        raise ValueError('Invalid primary-group flag.')
    for key in {'getDraftSubmissions', 'getDisabled'} & set(params):
        if params[key] not in {'true', 'false'}:
            raise ValueError('Invalid monitoring association flag.')
    for key in {'fieldIndex', 'page', 'start', 'limit', 'pageSize', 'pageNumber'} & set(params):
        if not params[key].isdecimal() or int(params[key]) > 1000000:
            raise ValueError(f'Invalid {key}.')
    if (path.startswith('rest/portal/admin/') or path == 'rest/portal/getUsers.php') and 'limit' in params and not 1 <= int(params['limit']) <= 500:
        raise ValueError('Administrator lists use 1–500 row pages.')
    if path.endswith('getMonitorData.php') and not 1 <= int(params['pageSize']) <= 500:
        raise ValueError('Monitoring reads require pages of 1–500 records; unbounded downloads are disabled.')
    if path.endswith('getMonitorData.php'):
        layer_mode = set(params) <= {'layerId', 'recId', 'pageSize', 'pageNumber'} and positive(params.get('layerId')) and positive(params.get('recId'))
        schema_mode = set(params) <= {'schemaId', 'recId', 'getSingleLayerInfo', 'pageSize', 'pageNumber'} and positive(params.get('schemaId')) and positive(params.get('recId')) and params.get('getSingleLayerInfo') == 'true'
        node_mode = set(params) <= {'schemaId', 'recId', 'submissionId', 'getDraft', 'pageSize', 'pageNumber'} and all(positive(params.get(key)) for key in ('schemaId', 'recId', 'submissionId'))
        if not (layer_mode or schema_mode or node_mode):
            raise ValueError('Monitoring requests must match a verified layer, schema or submission-node read contract.')
    if 'getDraft' in params and params['getDraft'] not in {'true', 'false'}:
        raise ValueError('Invalid draft-read flag.')
    for key in {'keys', 'fields', 'area', 'mapping', 'types'} & set(params):
        try:
            json.loads(params[key])
        except (ValueError, TypeError) as error:
            raise ValueError(f'{key} must contain valid JSON.') from error
    return path, params


def authorize_read(session, path):
    if path.startswith('rest/portal/admin/') or path in {'rest/portal/getMonitorSchemaLayers.php', 'rest/portal/getUsers.php'}:
        if not session.logged_in or not session.is_admin:
            raise PermissionError('This read requires a source administrator sign-in.')


PROJECT_WRITE_KEYS = {
    'save': {'mode', 'projectId', 'projectJson'},
    'saveNew': {'mode', 'projectName', 'projectJson'},
    'rename': {'mode', 'projectId', 'projectName'},
    'shareProject': {'mode', 'projectId', 'permissionAdditions', 'permissionRemovals'},
    'stopSharing': {'mode', 'projectId'},
}
USER_IDENTITY_KEYS = {'uname', 'fname', 'lname', 'email', 'initial_notification', 'initial_permission', 'initial_group',
                      'active', 'can_be_assigned_subs', 'can_assign_subs', 'can_edit_subs', 'boss_permission'}
PERMISSION_KEYS = {'formPermissionChanges', 'submissionPermissionChanges', 'matchPresetPermissionChanges', 'sharedStylePermissionChanges', 'sharedProjectPermissionChanges'}


def bounded_ids(value, maximum=500):
    return isinstance(value, list) and len(value) <= maximum and all(type(item) is int and 0 < item <= 2147483647 for item in value) and len(set(value)) == len(value)


def validate_admin_write(path, params):
    if path == 'rest/portal/admin/setContent.php':
        if set(params) != {'id', 'data', 'link'} or not positive(params['id']) or params['link'] not in {'true', 'false'} or len(params['data'].encode()) > 300000:
            raise ValueError('Only bounded existing-content edits are enabled.')
    elif path == 'rest/portal/admin/setLinkableStatus.php':
        if set(params) != {'layerIds', 'mode'} or params['mode'] not in {'allow', 'toggle'} or not bounded_ids(json.loads(params['layerIds'])):
            raise ValueError('Only bounded layer approval/activation changes are enabled; deletion is disabled.')
    elif path == 'rest/portal/admin/updateUser.php':
        if set(params) != {'uid', 'newData', 'newPassword', *PERMISSION_KEYS} or not positive(params['uid']) or params['newPassword'] != '':
            raise ValueError('Only resource-permission changes with an empty native newPassword field are enabled.')
        identity = json.loads(params['newData'])
        if not isinstance(identity, dict) or set(identity) != USER_IDENTITY_KEYS:
            raise ValueError('The original account identity and flags must be retained exactly.')
        for key in PERMISSION_KEYS:
            changes = json.loads(params[key])
            editable = key in {'formPermissionChanges', 'submissionPermissionChanges'}
            keys = {'id', 'checked', 'editChecked'} if editable else {'id', 'checked'}
            if not isinstance(changes, list) or len(changes) > 500:
                raise ValueError('Permission changes are limited to 500 records per resource kind.')
            ids = []
            for change in changes:
                if not isinstance(change, dict) or set(change) != keys or not positive(str(change['id'])) or any(type(change[k]) is not bool for k in keys - {'id'}):
                    raise ValueError('Invalid resource-permission change.')
                ids.append(str(change['id']))
            if len(set(ids)) != len(ids):
                raise ValueError('Duplicate resource-permission IDs.')
    elif path == 'rest/portal/admin/updateGroup.php':
        if set(params) != {'gid', 'addedUsers', 'primaryToggledUsers', 'removedUsers'} or not positive(params['gid']):
            raise ValueError('Invalid existing-group membership change.')
        for key, flag in [('addedUsers', 'primary_group'), ('primaryToggledUsers', 'value')]:
            changes = json.loads(params[key])
            if not isinstance(changes, list) or len(changes) > 500 or any(not isinstance(item, dict) or set(item) != {'uid', flag} or not positive(str(item['uid'])) or type(item[flag]) is not bool for item in changes):
                raise ValueError('Invalid or excessive group-membership changes.')
            if len({str(item['uid']) for item in changes}) != len(changes):
                raise ValueError('Duplicate group-membership IDs.')
        if not bounded_ids(json.loads(params['removedUsers'])):
            raise ValueError('Invalid removed-member IDs.')
    else:
        raise ValueError('This administrator change is not a verified gateway capability.')
    return path, params


def validate_write(path, params):
    if not isinstance(path, str):
        raise ValueError('A source change requires a relative verified endpoint.')
    if not isinstance(params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in params.items()):
        raise ValueError('Write parameters must be strings.')
    if path in {'rest/portal/startSubmission.php', 'rest/portal/setDynamicFields.php', 'rest/portal/setSubmissionName.php'}:
        keys = {'formId'} if path.endswith('startSubmission.php') else {'fields', 'status', 'submissionId'} if path.endswith('setDynamicFields.php') else {'name', 'submissionId'}
        if set(params) != keys or any(not positive(value) for key, value in params.items() if key in {'formId', 'submissionId'}):
            raise ValueError('Invalid source-draft request.')
        if path.endswith('setDynamicFields.php'):
            fields = json.loads(params['fields'])
            if params['status'] != 'draft' or not isinstance(fields, list) or len(fields) > 500:
                raise ValueError('Only bounded draft dynamic-field writes are enabled.')
            for field in fields:
                if not isinstance(field, dict) or set(field) != {'id', 'value'} or not positive(str(field['id'])) or field['value'] is not None and type(field['value']) not in (str, int, float, bool):
                    raise ValueError('Invalid source draft field.')
                if isinstance(field['value'], str) and len(field['value'].encode()) > 100000:
                    raise ValueError('A source draft field exceeds the 100 kB development limit.')
                if isinstance(field['value'], float) and not math.isfinite(field['value']):
                    raise ValueError('Draft numbers must be finite.')
            if len({str(field['id']) for field in fields}) != len(fields):
                raise ValueError('Duplicate source draft field IDs.')
        if path.endswith('setSubmissionName.php') and len(params['name']) > 1000:
            raise ValueError('The source draft name exceeds the development limit.')
        return path, params
    if isinstance(path, str) and path.startswith('rest/portal/admin/'):
        return validate_admin_write(path, params)
    if path == 'rest/openmap/savedProjects.php':
        allowed = PROJECT_WRITE_KEYS.get(params.get('mode'))
        if allowed is None or set(params) != allowed:
            raise ValueError('Unknown or incomplete saved-project change.')
    elif path == 'rest/openmap/setDefaultProject.php':
        if set(params) != {'projectId'}:
            raise ValueError('Invalid default-project change.')
    else:
        raise ValueError('This source change is not a verified gateway capability.')
    if 'projectId' in params and not positive(params['projectId']) and not (path.endswith('setDefaultProject.php') and params['projectId'] == 'unset'):
        raise ValueError('Invalid project ID.')
    if 'projectName' in params and not 0 < len(params['projectName'].strip()) <= 255:
        raise ValueError('Project name must contain 1–255 characters.')
    for key in {'permissionAdditions', 'permissionRemovals'} & set(params):
        values = json.loads(params[key])
        if not isinstance(values, list) or len(values) > 250 or any(type(value) is not int or not 0 < value <= 2147483647 for value in values) or len(set(values)) != len(values):
            raise ValueError('Sharing changes require at most 250 distinct numeric user IDs.')
    if 'projectJson' in params:
        if len(params['projectJson'].encode()) > 750000:
            raise ValueError('The native saved-project payload exceeds the 750 kB development limit.')
        project = json.loads(params['projectJson'])
        if not isinstance(project, dict) or not isinstance(project.get('layers'), list) or len(project['layers']) > 250:
            raise ValueError('A native project must contain a bounded layer list.')
        if not isinstance(project.get('coordinates'), list) or len(project['coordinates']) != 2 or any(type(value) not in (int, float) or not math.isfinite(value) for value in project['coordinates']):
            raise ValueError('A native project must contain finite camera coordinates.')
        if type(project.get('scale')) not in (int, float) or not math.isfinite(project['scale']) or project['scale'] <= 0:
            raise ValueError('A native project must contain a positive camera scale.')
    return path, params


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError('Upstream redirects are not enabled in this fixed-endpoint gateway.')


class Session:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cookies), NoRedirects())
        self.logged_in = False
        self.is_admin = False
        self.bootstrapped = False
        self.created_drafts = {}
        self.csrf = secrets.token_urlsafe(32)
        self.touched = time.monotonic()
        self.lock = threading.RLock()


class Sessions:
    def __init__(self):
        self.items = {}
        self.lock = threading.RLock()

    def get(self, token=None):
        with self.lock:
            now = time.monotonic()
            for key in list(self.items):
                if now - self.items[key].touched >= SESSION_TTL:
                    self.items[key].cookies.clear()
                    del self.items[key]
            if token not in self.items:
                if len(self.items) >= MAX_SESSIONS:
                    raise ValueError('The local gateway session limit has been reached.')
                token = secrets.token_urlsafe(32)
                self.items[token] = Session()
            session = self.items[token]
            session.touched = now
            return token, session

    def discard(self, token):
        with self.lock:
            session = self.items.pop(token, None)
            if session:
                with session.lock:
                    session.cookies.clear()
                    session.logged_in = False
                    session.is_admin = False
                    session.created_drafts.clear()


def bootstrap(session):
    # The native document initializes legacy PHP session configuration. This fixed
    # GET is necessary before descriptor reads; discard its HTML, never proxy it.
    if session.bootstrapped:
        return
    request = urllib.request.Request(PORTAL, headers={'Accept': 'text/html', 'User-Agent': 'PGMaps-Nechako-LocalGateway/1.0'})
    with session.opener.open(request, timeout=60) as response:
        if len(response.read(MAX_RESPONSE + 1)) > MAX_RESPONSE:
            raise ValueError('Portal bootstrap exceeds the 20 MiB gateway limit.')
    session.bootstrapped = True


def upstream(session, path, params=None):
    # Never accept caller-provided URLs, headers or cookies. HTTPS verification remains on.
    request = urllib.request.Request(PORTAL + path,
        data=urllib.parse.urlencode(params).encode() if params is not None else None,
        headers={'Referer': PORTAL, 'X-Requested-With': 'XMLHttpRequest',
                 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                 'Accept': 'application/json', 'User-Agent': 'PGMaps-Nechako-LocalGateway/1.0'})
    with session.lock:
        bootstrap(session)
        with session.opener.open(request, timeout=60) as response:
            body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError('Portal response exceeds the 20 MiB gateway limit.')
        try:
            value = json.loads(body)
        except ValueError as error:
            raise ValueError('The portal returned invalid JSON; inspect its server logs.') from error
        if not isinstance(value, dict):
            raise ValueError('The portal returned an invalid response envelope.')
        if isinstance(value.get('loggedIn'), bool):
            session.logged_in = value['loggedIn']
            if not session.logged_in:
                session.is_admin = False
        return value


def submission_download(session, payload):
    if set(payload) != {'submissionId', 'mode'} or not positive(payload.get('submissionId')) or payload.get('mode') not in {'pdf', 'html', 'csv', 'files'}:
        raise ValueError('Download requires a source submission ID and PDF, HTML, CSV or files mode.')
    with session.lock:
        # Permission is checked with the same per-browser source identity before a file read.
        metadata = upstream(session, 'rest/portal/getSubmissionMetadata.php', {'submissionId': payload['submissionId']})
        if metadata.get('status') != 'success' or metadata.get('success') is False or metadata.get('error') or not isinstance(metadata.get('attributes'), dict):
            raise PermissionError(metadata.get('error') or 'The original portal denied this submission download.')
        request = urllib.request.Request(PORTAL + 'rest/portal/downloadSubmission.php',
            data=urllib.parse.urlencode(payload).encode(),
            headers={'Referer': PORTAL, 'X-Requested-With': 'XMLHttpRequest',
                     'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                     'Accept': '*/*', 'User-Agent': 'PGMaps-Nechako-LocalGateway/1.0'})
        with session.opener.open(request, timeout=60) as response:
            body = response.read(MAX_DOWNLOAD + 1)
            disposition = response.headers.get('Content-Disposition', '')
        if len(body) > MAX_DOWNLOAD:
            raise ValueError('Original download exceeds the 32 MiB development limit. Use the original portal.')
        if not body or 'attachment' not in disposition.lower():
            raise ValueError('The original portal did not return a downloadable file.')
        if body.lstrip().startswith(b'{'):
            try:
                error = json.loads(body)
            except ValueError:
                error = {}
            if isinstance(error, dict) and (error.get('error') or error.get('status') == 'failure'):
                raise PermissionError(str(error.get('error') or 'The original portal denied the download.'))
        mode = payload['mode']
        if mode == 'pdf' and not body.startswith(b'%PDF-'):
            raise ValueError('The original portal did not return a valid PDF signature.')
        if mode == 'files' and not body.startswith((b'PK\x03\x04', b'PK\x05\x06')):
            raise ValueError('The original portal did not return a valid ZIP signature.')
        if mode == 'html' and not body.lstrip().lower().startswith((b'<!doctype', b'<html', b'<head', b'<body', b'<link', b'<style', b'<div', b'<h1', b'<h2', b'<p', b'<table')):
            raise ValueError('The original portal did not return an HTML document.')
        if mode == 'csv' and (body.lstrip().startswith(b'<') or b'\x00' in body):
            raise ValueError('The original portal did not return CSV content.')
        extension, mime = {'pdf': ('pdf', 'application/pdf'), 'html': ('html', 'text/html; charset=utf-8'),
                           'csv': ('csv', 'text/csv; charset=utf-8'), 'files': ('zip', 'application/zip')}[mode]
        return body, mime, f"nechako-original-submission-{payload['submissionId']}.{extension}"


def layer_attributes(session, payload):
    # Match the native SubmissionViewer -> getPortalLayer -> getAttributes flow.
    # Never accept the caller's filename, table, SQL, URL or serialized source.
    if set(payload) != {'submissionId', 'layerId'} or not all(positive(value) for value in payload.values()):
        raise ValueError('Source attributes require a submission ID and its existing layer ID.')
    with session.lock:
        response = upstream(session, 'rest/portal/getSubmissionLayers.php', {'submissionId': payload['submissionId']})
        layers = response.get('attributes')
        if response.get('status') != 'success' or not isinstance(layers, list) or not any(isinstance(layer, dict) and str(layer.get('layer_id')) == payload['layerId'] for layer in layers):
            raise PermissionError('The source layer is not in this permitted submission.')
        descriptor_response = upstream(session, 'rest/openmap/getPortalLayer.php', {'type': 'layer', 'layerId': payload['layerId']})
        descriptor = descriptor_response.get('attributes')
        if descriptor_response.get('status') != 'success' or not isinstance(descriptor, dict) or any(not isinstance(descriptor.get(key), str) or not 0 < len(descriptor[key]) <= 4096 or '\0' in descriptor[key] for key in ('mapfile', 'mapfileName')):
            raise ValueError('The source portal did not provide a valid layer descriptor.')
        return upstream(session, 'rest/openmap/attributes.php', {
            'data': json.dumps({'filename': descriptor['mapfile'], 'layername': descriptor['mapfileName']}),
            'source': json.dumps({'isPortal': True, 'layer': int(payload['layerId'])}),
        })


def authorize_project_write(session, path, params):
    if not session.logged_in:
        raise PermissionError('Sign in to your own portal session before changing a project.')
    catalogue = upstream(session, 'rest/openmap/savedProjects.php', {'mode': 'list'})
    attributes = catalogue.get('attributes')
    if catalogue.get('status') != 'success' or not isinstance(attributes, dict) or not isinstance(attributes.get('projects'), list):
        raise PermissionError('The source portal did not provide a permitted project catalogue.')
    uid = attributes.get('uid')
    if not positive(str(uid)) or not session.logged_in:
        raise PermissionError('The original portal session is not authenticated.')
    if params.get('mode') == 'saveNew' or params.get('projectId') == 'unset':
        return
    project = next((item for item in attributes['projects'] if str(item.get('project_id')) == params.get('projectId')), None)
    if project is None:
        raise PermissionError('This project is not in your permitted source catalogue.')
    if path.endswith('savedProjects.php') and str(project.get('creator_id')) != str(uid):
        raise PermissionError('Only the project owner can save, rename or change its sharing through this gateway.')


def connection_status(session):
    # A concurrent status must not observe the temporary native loggedIn flag
    # before a login envelope has been accepted or rejected under this lock.
    with session.lock:
        return {'schema': 'nechako-local-connection-v1', 'available': True, 'loggedIn': session.logged_in,
                'readOnly': not session.logged_in, 'canWrite': session.logged_in, 'isAdmin': session.is_admin, 'csrfToken': session.csrf,
                'expiresAfterIdleSeconds': SESSION_TTL}


def authorize_write(session, path, params):
    if path in {'rest/portal/startSubmission.php', 'rest/portal/setDynamicFields.php', 'rest/portal/setSubmissionName.php'}:
        if not session.logged_in:
            raise PermissionError('An authenticated source session is required for a draft upload.')
        if path.endswith('startSubmission.php'):
            if len(session.created_drafts) >= 100:
                raise PermissionError('The gateway allows at most 100 allocated drafts per session.')
            form_id = params['formId']
        else:
            form_id = session.created_drafts.get(params['submissionId'])
            if form_id is None:
                raise PermissionError('This gateway can edit only drafts allocated in the current isolated session.')
        response = upstream(session, 'rest/portal/getForm.php', {'id': form_id})
        form = response.get('attributes')
        if response.get('status') != 'success' or not isinstance(form, dict) or not isinstance(form.get('nodes'), list) or not session.logged_in:
            raise PermissionError('The source portal did not provide a permitted form definition.')
        if path.endswith('setDynamicFields.php'):
            allowed = {str(node['field_id']) for node in form['nodes'] if isinstance(node, dict) and isinstance(node.get('nodeInfo'), dict) and node['nodeInfo'].get('node_is_dynamic') in (True, 1, '1', 'true', 't') and 'field_id' in node}
            if any(str(field['id']) not in allowed for field in json.loads(params['fields'])):
                raise PermissionError('A draft field is not a dynamic field declared by the source form.')
        return
    if path.startswith('rest/portal/admin/'):
        if not session.logged_in or not session.is_admin:
            raise PermissionError('An authenticated source administrator is required for this change.')
        if path.endswith('updateUser.php'):
            response = upstream(session, 'rest/portal/admin/getUserDetails.php', {'uid': params['uid']})
            current = response.get('attributes')
            proposed = json.loads(params['newData'])
            if response.get('status') != 'success' or not isinstance(current, dict) or any(key not in current or proposed[key] != current[key] for key in USER_IDENTITY_KEYS):
                raise PermissionError('Account identity or flags changed; reload the source details before changing resource permissions.')
        return
    authorize_project_write(session, path, params)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # No credentials, request payloads, upstream cookies or record contents in logs.

    def reply(self, status, value, token=None, clear=False):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if token is not None:
            self.send_header('Set-Cookie', f'{COOKIE}={token}; HttpOnly; SameSite=Strict; Path={BASE}; Max-Age={SESSION_TTL}')
        if clear:
            self.send_header('Set-Cookie', f'{COOKIE}=; HttpOnly; SameSite=Strict; Path={BASE}; Max-Age=0')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A cancelled browser read does not need a traceback or retry.

    def token(self):
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except http.cookies.CookieError:
            return None
        return cookie[COOKIE].value if COOKIE in cookie else None

    def trusted(self):
        host = urllib.parse.urlsplit('http://' + self.headers.get('Host', '')).hostname
        if host not in {'localhost', '127.0.0.1', '[::1]', '::1'}:
            raise ValueError('This development gateway requires a loopback host.')
        origin = self.headers.get('Origin')
        if origin and origin not in self.server.allowed_origins:
            raise ValueError('This origin is not allowed to use the local gateway.')
        if self.command == 'POST' and not origin:
            raise ValueError('Same-origin POST requests require an allowed Origin header.')
        if self.headers.get('Sec-Fetch-Site') in {'cross-site', 'same-site'}:
            raise ValueError('Cross-site gateway requests are disabled.')

    def do_GET(self):
        try:
            self.trusted()
            if self.path != BASE + '/status':
                self.reply(404, {'error': 'Unknown local gateway route.'})
                return
            token, session = self.server.sessions.get(self.token())
            self.reply(200, connection_status(session), token)
        except ValueError as error:
            self.reply(403, {'error': str(error)})

    def do_POST(self):
        try:
            self.trusted()
            if self.path not in {BASE + '/read', BASE + '/write', BASE + '/login', BASE + '/disconnect', BASE + '/layer-attributes', BASE + '/download'}:
                self.reply(404, {'error': 'Unknown local gateway route.'})
                return
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('The local gateway accepts JSON request envelopes.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                raise ValueError('Invalid request size; the gateway limit is 1 MiB.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Invalid gateway request envelope.')
            if self.path == BASE + '/disconnect':
                self.server.sessions.discard(self.token())
                self.reply(200, {'available': True, 'loggedIn': False, 'readOnly': True, 'canWrite': False}, clear=True)
                return
            token, session = self.server.sessions.get(self.token())
            if self.path == BASE + '/download':
                body, mime, filename = submission_download(session, payload)
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "sandbox; default-src 'none'")
                self.send_header('Set-Cookie', f'{COOKIE}={token}; HttpOnly; SameSite=Strict; Path={BASE}; Max-Age={SESSION_TTL}')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            elif self.path == BASE + '/layer-attributes':
                self.reply(200, layer_attributes(session, payload), token)
            elif self.path in {BASE + '/read', BASE + '/write'}:
                if set(payload) - {'path', 'params'}:
                    raise ValueError('Unexpected gateway request fields.')
                if self.path == BASE + '/write':
                    csrf = self.headers.get('X-Nechako-CSRF', '')
                    if not secrets.compare_digest(csrf, session.csrf):
                        raise PermissionError('A valid per-session CSRF token is required for a source change.')
                    path, params = validate_write(payload.get('path'), payload.get('params', {}))
                    with session.lock:
                        authorize_write(session, path, params)
                        result = upstream(session, path, params)
                        if path.endswith('startSubmission.php') and result.get('status') == 'success':
                            attributes = result.get('attributes')
                            if not isinstance(attributes, dict) or not positive(str(attributes.get('submissionId'))):
                                raise ValueError('The source allocated a draft but returned no valid ID; inspect the original portal before retrying.')
                            session.created_drafts[str(attributes['submissionId'])] = params['formId']
                        self.reply(200, result, token)
                else:
                    path, params = validate_read(payload.get('path'), payload.get('params', {}))
                    with session.lock:
                        authorize_read(session, path)
                        self.reply(200, upstream(session, path, params or None), token)
            else:
                if set(payload) != {'username', 'password'} or not all(isinstance(payload[k], str) and 0 < len(payload[k]) <= 256 for k in payload):
                    raise ValueError('Enter a username and password for the original portal.')
                # Replace any earlier upstream identity before attempting another login.
                succeeded = False
                try:
                    with session.lock:
                        session.cookies.clear()
                        session.bootstrapped = False
                        session.logged_in = False
                        session.is_admin = False
                        session.created_drafts.clear()
                        session.csrf = secrets.token_urlsafe(32)
                        try:
                            response = upstream(session, 'rest/portal/login.php', payload)
                            attributes = response.get('attributes')
                            succeeded = (response.get('status') == 'success' and response.get('success') is not False
                                         and not response.get('error') and session.logged_in is True)
                            session.is_admin = succeeded and isinstance(attributes, dict) and attributes.get('isAdmin') is True
                        finally:
                            if not succeeded:
                                session.cookies.clear()
                                session.bootstrapped = False
                                session.logged_in = False
                                session.is_admin = False
                                session.created_drafts.clear()
                except Exception:
                    # A partial HTTP/JSON login failure must not leave a usable
                    # source cookie jar for a subsequent read to authenticate.
                    self.server.sessions.discard(token)
                    raise
                if not succeeded:
                    self.server.sessions.discard(token)
                    self.reply(401, {'error': response.get('error') or 'The portal did not establish an authenticated session.'}, clear=True)
                    return
                # Do not forward login attributes (which can contain account/contact details).
                self.reply(200, connection_status(session), token)
        except PermissionError as error:
            self.reply(403, {'error': str(error)})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.reply(400, {'error': str(error)})
        except (OSError, urllib.error.URLError) as error:
            self.reply(502, {'error': 'The original portal could not be reached through the local gateway.'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=42175)
    parser.add_argument('--allowed-origin', action='append', default=['http://127.0.0.1:42173', 'http://localhost:42173'])
    args = parser.parse_args()
    for origin in args.allowed_origin:
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'} or parsed.path or parsed.query or parsed.fragment:
            parser.error('Development allowed origins must be exact loopback HTTP origins.')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.sessions = Sessions()
    server.allowed_origins = set(args.allowed_origin)
    print(f'Nechako local gateway listening on 127.0.0.1:{args.port}; sessions are memory-only.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        for token in list(server.sessions.items):
            server.sessions.discard(token)


if __name__ == '__main__':
    main()
