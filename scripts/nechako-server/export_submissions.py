#!/usr/bin/env python3
"""Read-only, resumable authenticated submission content/inventory export.

Uses the native catalogue, form-report and resource contracts. No mutation,
binary attachment, spatial-file, monitoring-observation or identity endpoints.
Credentials are supplied through environment variables and never written.
"""

import argparse
import concurrent.futures
import csv
import datetime
import hashlib
import http.client
import http.cookies
import json
import os
from pathlib import Path
import threading
import time
import urllib.parse
import zipfile

ORIGIN = 'https://nechakowatershed-portal.ca/'
HOST = 'nechakowatershed-portal.ca'
MAX_RESPONSE = 20 * 1024 * 1024
RESOURCES = {
    'metadata': 'getSubmissionMetadata.php',
    'attachments': 'getSubmissionAttachments.php',
    'layers': 'getSubmissionLayers.php',
    'linked_layers': 'getSubmissionLinkedLayers.php',
}
ALLOWED = {'rest/portal/' + name for name in RESOURCES.values()} | {
    'rest/portal/login.php', 'rest/portal/admin/getSubmissions.php',
    'rest/portal/getSearchResults.php', 'rest/portal/getForms.php',
    'rest/portal/getForm.php', 'rest/portal/GetFormStatistics.php',
    'rest/portal/getSubmissionForm.php', 'rest/portal/getFieldValue.php',
    'rest/portal/getSchemas.php', 'rest/portal/getSchemaFields.php',
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def identifier(value):
    if isinstance(value, bool) or not str(value).isdigit() or not 0 < int(value) <= 2147483647:
        raise ValueError('Invalid source identifier.')
    return str(int(value))


def successful(value):
    return isinstance(value, dict) and value.get('status') == 'success' and not value.get('error')


class Client:
    def __init__(self, username, password):
        self.connection = None
        self.cookies = {}
        self.authenticated = False
        self.content_response_limit = MAX_RESPONSE
        self.request('', None, bootstrap=True)
        value = self.read('rest/portal/login.php', {'username': username, 'password': password})
        if value.get('loggedIn') is not True or value.get('attributes', {}).get('isAdmin') is not True:
            self.close()
            raise RuntimeError('The provided account did not establish the requested administrator scope.')
        self.authenticated = True

    def request(self, path, params, bootstrap=False):
        if path not in ALLOWED and not (bootstrap and path == '' and params is None):
            raise ValueError('Not a verified export read route.')
        if self.connection is None:
            self.connection = http.client.HTTPSConnection(HOST, timeout=45)
        body = urllib.parse.urlencode(params).encode() if params is not None else None
        headers = {
            'Referer': ORIGIN, 'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'text/html' if bootstrap else 'application/json',
            'Accept-Encoding': 'identity', 'User-Agent': 'PGMaps-Nechako-ReadOnly-Export/1.0',
        }
        if self.cookies:
            headers['Cookie'] = '; '.join(key + '=' + value for key, value in self.cookies.items())
        self.connection.request('POST' if body is not None else 'GET', '/' + path, body, headers)
        response = self.connection.getresponse()
        limit = self.content_response_limit if path in {'rest/portal/getFieldValue.php', 'rest/portal/GetFormStatistics.php'} else MAX_RESPONSE
        raw = response.read(limit + 1)
        for key, value in response.getheaders():
            if key.lower() == 'set-cookie':
                jar = http.cookies.SimpleCookie()
                jar.load(value)
                self.cookies.update({name: item.value for name, item in jar.items()})
        if len(raw) > limit:
            self.connection.close()
            self.connection = None
            raise ValueError(f'Response exceeded the {limit // (1024 * 1024)} MiB limit; this read is incomplete.')
        if response.status != 200:
            raise RuntimeError('Source HTTP status ' + str(response.status))
        return raw

    def read(self, path, params):
        # Only retry network failures on these fixed reads; login is never retried.
        for attempt in range(2):
            try:
                raw = self.request(path, params)
                value = json.loads(raw)
                if not successful(value):
                    raise ValueError(str(value.get('error') or value.get('status') or 'Invalid source response'))
                if self.authenticated and value.get('loggedIn') is False:
                    raise RuntimeError('The source session expired; authenticated extraction stopped.')
                return value
            except (OSError, http.client.HTTPException):
                if self.connection:
                    self.connection.close()
                self.connection = None
                if attempt or path.endswith('login.php'):
                    raise
                time.sleep(1)

    def close(self):
        if self.connection:
            self.connection.close()
        self.cookies.clear()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(raw)
    temporary.replace(path)
    return len(raw)


def load(path):
    return json.loads(path.read_text())


def catalogue_ids(value):
    rows = value.get('attributes')
    if not successful(value) or not isinstance(rows, list):
        raise ValueError('Administrator catalogue did not return its complete native array.')
    indexed = {identifier(row['sub_id']): row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError('Duplicate source catalogue IDs.')
    return indexed


def form_fields(value):
    nodes = value.get('attributes', {}).get('nodes')
    if not successful(value) or not isinstance(nodes, list) or len(nodes) > 200:
        raise ValueError('Invalid or oversized source form definition.')
    fields = []
    index = 0
    for node in nodes:
        dynamic = node.get('nodeInfo', {}).get('node_is_dynamic')
        if dynamic not in (True, 1, '1', 'true', 't'):
            index = 0
            continue
        fid = identifier(node['field_id'])
        fields.append({'id': fid, 'label': node['field_label'], 'type': node['field_type'], 'index': index})
        index += 1
    if len({field['id'] for field in fields}) != len(fields):
        raise ValueError('Duplicate dynamic field IDs.')
    return fields


def source_value(row, field):
    key = 'field_' + field['id']
    if key in row:
        return {'value': row[key], 'read_method': 'GetFormStatistics'}
    return None  # Never infer an omitted bulk value to be null, false or empty.


def resource_attributes(name, response):
    if not successful(response) or 'attributes' not in response:
        raise ValueError('Resource did not return a successful native envelope.')
    attributes = response['attributes']
    if name == 'metadata':
        if not isinstance(attributes, dict):
            raise ValueError('Source metadata must be an object.')
    elif not isinstance(attributes, list) or any(not isinstance(row, dict) for row in attributes):
        raise ValueError('Source inventory must be an array of reference objects.')
    return attributes


def resume_hashes(root):
    path = root / 'manifest.json'
    if not path.exists():
        return None  # An interrupted first capture has no final manifest yet.
    manifest = load(path)
    if not isinstance(manifest, dict) or manifest.get('schema') != 'nechako-export-manifest-v1' or not isinstance(manifest.get('files'), list):
        raise ValueError('The existing export manifest is invalid; cannot verify resumed records.')
    hashes = {}
    for entry in manifest['files']:
        if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or not isinstance(entry.get('sha256'), str) or len(entry['sha256']) != 64 or any(c not in '0123456789abcdef' for c in entry['sha256']) or entry['path'] in hashes:
            raise ValueError('The existing export manifest has invalid or duplicate file hashes.')
        hashes[entry['path']] = entry['sha256']
    return hashes


def reusable_record(previous, sid, catalogue, definitions, path, hashes):
    if not isinstance(previous, dict) or previous.get('schema') != 'nechako-submission-export-v1' or previous.get('source') != ORIGIN or previous.get('source_id') != sid or previous.get('id') != sid or previous.get('kind') != 'submission' or previous.get('complete') is not True or previous.get('errors') != []:
        return False
    if previous.get('catalogue') != catalogue or previous.get('state') != catalogue['sub_state'] or previous.get('title') != (catalogue['sub_name'] or catalogue['sub_title']):
        return False
    if hashes is not None and hashes.get('submissions/' + sid + '.json') != hashlib.sha256(path.read_bytes()).hexdigest():
        return False
    fid = previous.get('form_id')
    if not isinstance(fid, str) or fid not in definitions or previous.get('form_path') != 'forms/' + fid + '.json':
        return False
    fields = definitions[fid][1]
    values = previous.get('values')
    resources = previous.get('resources')
    if not isinstance(values, dict) or set(values) != {field['id'] for field in fields} or not isinstance(resources, dict) or set(resources) != set(RESOURCES):
        return False
    try:
        for name in RESOURCES:
            attributes = resource_attributes(name, resources[name])
            if name == 'metadata' and attributes.get('form_id') is not None and identifier(attributes['form_id']) != fid:
                return False
        metadata = resources['metadata']['attributes']
        if metadata.get('form_id') is None:
            search = previous.get('search_metadata')
            if isinstance(search, dict) and search.get('form_id') is not None:
                if identifier(search['form_id']) != fid:
                    return False
            else:
                response = previous.get('form_response')
                if not successful(response) or identifier(response.get('attributes')) != fid:
                    return False
        for field in fields:
            value = values[field['id']]
            if not isinstance(value, dict) or 'value' not in value or 'error' in value or value.get('label') != field['label'] or value.get('type') != field['type'] or value.get('read_method') not in {'GetFormStatistics', 'getFieldValue'}:
                return False
            if value['read_method'] == 'getFieldValue' and (not successful(value.get('response')) or 'attributes' not in value['response'] or value['response']['attributes'] != value['value']):
                return False
    except (ValueError, TypeError, KeyError):
        return False
    return True


def csv_value(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return "'" + text if isinstance(value, str) and text.lstrip().startswith(('=', '+', '-', '@')) else text


def extract(args):
    username = os.environ.get('NECHAKO_EXPORT_USERNAME')
    password = os.environ.get('NECHAKO_EXPORT_PASSWORD')
    if not username or not password:
        raise ValueError('Supply NECHAKO_EXPORT_USERNAME and NECHAKO_EXPORT_PASSWORD in the process environment.')
    os.umask(0o077)
    root = args.output.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    content_limit_mib = getattr(args, 'max_content_response_mib', 20)
    if content_limit_mib not in (20, 64, 128):
        raise ValueError('Content response limit must be 20, 64 or 128 MiB.')
    main = Client(username, password)
    main.content_response_limit = content_limit_mib * 1024 * 1024
    clients = [main]
    started = now()
    try:
        hashes = resume_hashes(root) if args.resume else None
        catalogue_path = root / 'catalogues/admin-submissions.json'
        if args.resume and catalogue_path.exists():
            before = load(catalogue_path)
        else:
            before = main.read('rest/portal/admin/getSubmissions.php', {})
            save(catalogue_path, before)
        catalogue = catalogue_ids(before)
        capture_path = root / 'capture-info.json'
        if args.resume and capture_path.exists():
            started = load(capture_path)['started_at_utc']
        elif args.resume:
            started = datetime.datetime.fromtimestamp(catalogue_path.stat().st_mtime, datetime.timezone.utc).isoformat()
        save(capture_path, {'schema': 'nechako-export-capture-v1', 'started_at_utc': started, 'this_run_started_at_utc': now(), 'resumed': args.resume, 'content_response_limit_mib': content_limit_mib})
        search = main.read('rest/portal/getSearchResults.php', {
            'keys': json.dumps({'token': 'comparator', 'value': '>=', 'left': {'token': 'column', 'value': 'Submission ID'}, 'right': {'token': 'number', 'value': '1'}}),
            'fields': json.dumps(['Submission ID']), 'area': 'null',
        })
        save(root / 'catalogues/all-search.json', search)
        search_rows = search.get('attributes', {}).get('results')
        if not isinstance(search_rows, list):
            raise ValueError('Search did not return the verified native result list.')
        searched = {identifier(row['submission_id']): row for row in search_rows}
        if len(searched) != len(search_rows):
            raise ValueError('Duplicate native search IDs.')
        forms = main.read('rest/portal/getForms.php', {})
        save(root / 'catalogues/forms.json', forms)
        form_ids = {identifier(row['form_id']) for row in forms['attributes']}
        form_names = {identifier(row['form_id']): row.get('form_name', '') for row in forms['attributes']}
        form_ids.update(identifier(row['form_id']) for row in search_rows)
        definitions, reports, setup_errors = {}, {}, []
        print(json.dumps({'stage': 'catalogue', 'submissions': len(catalogue), 'submitted': sum(r['sub_state'] == 'SUBMITTED' for r in catalogue.values()), 'drafts': sum(r['sub_state'] == 'DRAFT' for r in catalogue.values()), 'search_rows': len(search_rows)}), flush=True)
        for fid in sorted(form_ids, key=int):
            try:
                fp = root / 'forms' / (fid + '.json')
                form = load(fp) if args.resume and fp.exists() else main.read('rest/portal/getForm.php', {'id': fid})
                fields = form_fields(form)
                definitions[fid] = (form, fields)
                save(fp, form)
                rp = root / 'form-reports' / (fid + '.json')
                report = load(rp) if args.resume and rp.exists() else main.read('rest/portal/GetFormStatistics.php', {'formId': fid, 'mapping': json.dumps({f['id']: 'field_' + f['id'] for f in fields})})
                save(rp, report)  # Retain source evidence even when its shape is invalid.
                attributes = report.get('attributes')
                if not successful(report) or not isinstance(attributes, dict):
                    raise ValueError('Source bulk report did not return a successful report object.')
                rows = attributes.get('rows')
                if isinstance(rows, list) and not rows:
                    rows = {}  # Native PHP serializes an empty associative array as [].
                if not isinstance(rows, dict):
                    raise ValueError('Source bulk report did not return rows keyed by submission ID.')
                reports[fid] = rows
            except (ValueError, RuntimeError) as error:
                setup_errors.append({'form_id': fid, 'error': str(error)})
            print(json.dumps({'stage': 'form', 'form_id': fid, 'fields': len(definitions.get(fid, (None, []))[1]), 'bulk_rows': len(reports.get(fid, {}))}), flush=True)

        local = threading.local()
        clients_lock = threading.Lock()

        def worker_client():
            if not hasattr(local, 'client'):
                local.client = Client(username, password)
                local.client.content_response_limit = content_limit_mib * 1024 * 1024
                with clients_lock:
                    clients.append(local.client)
            return local.client

        def record(sid):
            path = root / 'submissions' / (sid + '.json')
            if args.resume and path.exists():
                try:
                    previous = load(path)
                    if reusable_record(previous, sid, catalogue[sid], definitions, path, hashes):
                        return previous
                except (ValueError, TypeError, KeyError):
                    pass  # Corrupt/incomplete records are recaptured, never trusted.
            client = worker_client()
            item = {'schema': 'nechako-submission-export-v1', 'source_id': sid, 'id': sid, 'kind': 'submission', 'title': catalogue[sid]['sub_name'] or catalogue[sid]['sub_title'], 'state': catalogue[sid]['sub_state'], 'source': ORIGIN, 'captured_at_utc': now(), 'catalogue': catalogue[sid], 'search_metadata': searched.get(sid), 'resources': {}, 'values': {}, 'errors': []}
            for name, endpoint in RESOURCES.items():
                try:
                    response = client.read('rest/portal/' + endpoint, {'submissionId': sid})
                    item['resources'][name] = response
                    resource_attributes(name, response)
                except (ValueError, RuntimeError, OSError, http.client.HTTPException) as error:
                    if not client.authenticated or 'session expired' in str(error):
                        raise
                    item['errors'].append({'resource': name, 'error': str(error)})
            try:
                meta = item['resources'].get('metadata', {}).get('attributes', {})
                supplied_form = meta.get('form_id') if isinstance(meta, dict) else None
                if supplied_form is None and searched.get(sid):
                    supplied_form = searched[sid]['form_id']
                if supplied_form is None:
                    form_response = client.read('rest/portal/getSubmissionForm.php', {'submissionId': sid})
                    item['form_response'] = form_response
                    supplied_form = form_response['attributes']
                fid = identifier(supplied_form)
                item['form_id'] = fid
                if fid not in definitions:
                    raise ValueError('No readable form definition was captured for this source form.')
                item['form_path'] = 'forms/' + fid + '.json'
                fields = definitions[fid][1]
                row = reports.get(fid, {}).get(sid, {})
                if not isinstance(row, dict):
                    item['errors'].append({'resource': 'bulk_row', 'error': 'Source report row was not an object; fields are read individually.'})
                    row = {}
                item['bulk_row'] = row or None
                for field in fields:
                    returned = source_value(row, field)
                    if returned is None:
                        try:
                            envelope = client.read('rest/portal/getFieldValue.php', {'submissionId': sid, 'fieldId': field['id'], 'fieldIndex': str(field['index'])})
                            returned = {'value': envelope['attributes'], 'read_method': 'getFieldValue', 'response': envelope}
                        except (ValueError, RuntimeError, OSError, http.client.HTTPException) as error:
                            if 'session expired' in str(error):
                                raise
                            item['errors'].append({'resource': 'field', 'field_id': field['id'], 'error': str(error)})
                            returned = {'error': str(error)}
                    item['values'][field['id']] = {'label': field['label'], 'type': field['type'], **returned}
            except (ValueError, RuntimeError) as error:
                if 'session expired' in str(error):
                    raise
                item['errors'].append({'resource': 'form', 'error': str(error)})
            item['complete'] = not item['errors']
            save(path, item)
            return item

        completed = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(record, sid): sid for sid in sorted(catalogue, key=int)}
            for future in concurrent.futures.as_completed(futures):
                completed.append(future.result())
                if len(completed) % 50 == 0 or len(completed) == len(catalogue):
                    print(json.dumps({'stage': 'records', 'captured': len(completed), 'total': len(catalogue), 'with_errors': sum(bool(r['errors']) for r in completed)}), flush=True)
        completed.sort(key=lambda row: int(row['source_id']))
        save(root / 'submissions.json', {'schema': 'nechako-submissions-export-v1', 'source': ORIGIN, 'started_at_utc': started, 'submissions': completed})
        headers = ['source_id', 'state', 'title', 'form_id', 'parent_id', 'complete', 'attachments', 'layers', 'linked_layers', 'record_file']
        with (root / 'submission-index.csv').open('w', newline='', encoding='utf-8-sig') as out:
            writer = csv.DictWriter(out, fieldnames=headers)
            writer.writeheader()
            for item in completed:
                meta = item['resources'].get('metadata', {}).get('attributes', {})
                row = {'source_id': item['source_id'], 'state': item['state'], 'title': csv_value(item['title']), 'form_id': item.get('form_id', ''), 'parent_id': meta.get('parent_id', '') if isinstance(meta, dict) else '', 'complete': item['complete'], 'record_file': 'submissions/' + item['source_id'] + '.json'}
                for key in ('attachments', 'layers', 'linked_layers'):
                    try:
                        row[key] = len(resource_attributes(key, item['resources'].get(key)))
                    except ValueError:
                        row[key] = 'UNREAD'
                writer.writerow(row)
        def references(item, key):
            value = item['resources'].get(key, {}).get('attributes')
            return [ref for ref in value if isinstance(ref, dict)] if isinstance(value, list) else []
        inventories = {key: [{'submission_id': item['source_id'], **ref} for item in completed for ref in references(item, key)] for key in ('attachments', 'layers', 'linked_layers')}
        save(root / 'attachment-inventory.json', inventories['attachments'])
        save(root / 'layer-inventory.json', {'layers': inventories['layers'], 'linked_layers': inventories['linked_layers']})
        for fid, (_, fields) in definitions.items():
            with (root / 'form-reports' / (fid + '.csv')).open('w', newline='', encoding='utf-8-sig') as out:
                writer = csv.writer(out)
                writer.writerow(['submission_id', 'state', *('field_' + field['id'] for field in fields)])
                for item in completed:
                    if item.get('form_id') == fid:
                        writer.writerow([item['source_id'], item['state'], *(csv_value(item['values'].get(field['id'], {}).get('value')) if 'value' in item['values'].get(field['id'], {}) else 'UNREAD' for field in fields)])
        with (root / 'field-dictionary.csv').open('w', newline='', encoding='utf-8-sig') as out:
            writer = csv.writer(out)
            writer.writerow(['form_id', 'form_name', 'field_id', 'label', 'type', 'index', 'csv_column'])
            for fid, (definition, fields) in sorted(definitions.items(), key=lambda entry: int(entry[0])):
                form_name = form_names.get(fid) or definition['attributes'].get('name', '')
                for field in fields:
                    writer.writerow([fid, csv_value(form_name), field['id'], csv_value(field['label']), csv_value(field['type']), field['index'], 'field_' + field['id']])
        after = main.read('rest/portal/admin/getSubmissions.php', {})
        save(root / 'catalogues/admin-submissions-after.json', after)
        after_ids = catalogue_ids(after)
        summary = {
            'schema': 'nechako-submissions-export-summary-v1', 'source': ORIGIN, 'started_at_utc': started, 'finished_at_utc': now(),
            'access': 'user-authorized temporary administrator; credentials/cookies excluded',
            'submissions': len(completed), 'submitted': sum(r['state'] == 'SUBMITTED' for r in completed), 'drafts': sum(r['state'] == 'DRAFT' for r in completed),
            'complete_records': sum(r['complete'] for r in completed), 'incomplete_records': sum(not r['complete'] for r in completed),
            'dynamic_field_values': sum('value' in v for r in completed for v in r['values'].values()),
            'bulk_field_values': sum(v.get('read_method') == 'GetFormStatistics' for r in completed for v in r['values'].values()),
            'individual_field_values': sum(v.get('read_method') == 'getFieldValue' for r in completed for v in r['values'].values()),
            'attachments': len(inventories['attachments']), 'layers': len(inventories['layers']), 'linked_layers': len(inventories['linked_layers']),
            'forms': len(definitions), 'setup_errors': setup_errors,
            'catalogue_added_during_export': sorted(set(after_ids) - set(catalogue), key=int),
            'catalogue_removed_during_export': sorted(set(catalogue) - set(after_ids), key=int),
            'catalogue_changed_during_export': [sid for sid in catalogue.keys() & after_ids.keys() if catalogue[sid] != after_ids[sid]],
            'limitations': ['Scope is all submissions listed by this account, not a database dump or an atomic snapshot.', 'Attachment and spatial-file bodies, full monitoring observations, permissions and history are not included.', 'Original bulk report statistics are retained without redefining their semantics.', 'Omitted bulk fields are read individually; source errors remain explicit.', 'CSV prefixes potentially executable text with an apostrophe; JSON retains exact returned values.'],
        }
        save(root / 'summary.json', summary)
        (root / 'README.txt').write_text('Nechako source submission export\n\nStart with summary.json and submission-index.csv.\nsubmissions.json contains all records; submissions/<ID>.json contains each original-ID record.\nforms/<ID>.json and form-reports/<ID>.json retain native source definitions and raw bulk reports.\nform-reports/<ID>.csv includes submitted records and drafts, including individually read missing values.\nfield-dictionary.csv maps field_<ID> columns to original form names, field labels/types and native field indices.\nattachment-inventory.json and layer-inventory.json contain references, not downloaded file bodies.\n\nThis is private, administrator-visible data. It is not published or added to PGMaps public data.\nNo submissions were created, edited, published or deleted. No passwords/cookies/tokens were saved.\nSee summary.json for completeness and source changes observed during capture.\nJSON is authoritative; CSV protects spreadsheet formula text and flattens complex values.\n')
        files = [{'path': str(path.relative_to(root)), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(root.rglob('*')) if path.is_file() and path.name != 'manifest.json']
        save(root / 'manifest.json', {'schema': 'nechako-export-manifest-v1', 'files': files, 'file_bytes': sum(f['bytes'] for f in files)})
        archive = root.with_suffix('.zip')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
            for path in sorted(root.rglob('*')):
                if path.is_file():
                    out.write(path, str(path.relative_to(root)))
        print(json.dumps({'stage': 'finished', **{k: summary[k] for k in ('submissions', 'submitted', 'drafts', 'complete_records', 'incomplete_records', 'dynamic_field_values', 'attachments', 'layers', 'linked_layers')}, 'json_file_bytes': (root / 'submissions.json').stat().st_size, 'archive_bytes': archive.stat().st_size}), flush=True)
    finally:
        for client in clients:
            client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--workers', type=int, choices=(1, 2, 4), default=2)
    parser.add_argument('--max-content-response-mib', type=int, choices=(20, 64, 128), default=20, help='Bound for form reports/individual field content, including inline media. Other reads stay at 20 MiB.')
    parser.add_argument('--resume', action='store_true', help='Reuse successful reads from the same capture; not a fresh snapshot.')
    extract(parser.parse_args())
