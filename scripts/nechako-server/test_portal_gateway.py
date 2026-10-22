"""Offline endpoint, session-isolation and source-change protections; never writes upstream."""

import http.cookiejar
import io
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch, Mock

import portal_gateway as gateway


class GatewayContracts(unittest.TestCase):
    def test_source_layer_catalogues_are_read_only_without_extra_parameters(self):
        for name in ['getSchemas_TBD', 'getSubmissionLayersAddLayer', 'getLinkedLayers']:
            path = f'rest/portal/{name}.php'
            self.assertEqual(gateway.validate_read(path, {})[1], {})
            for params in [{'mode': 'delete'}, {'query': 'SELECT *'}, {'layerId': '1'}]:
                with self.subTest(path=path, params=params), self.assertRaises(ValueError):
                    gateway.validate_read(path, params)

    def test_manager_reads_require_exact_ids_flags_and_bounded_pages(self):
        monitor = {'schemaId': '13', 'getDraftSubmissions': 'true', 'getDisabled': 'true'}
        self.assertEqual(gateway.validate_read('rest/portal/getMonitorSchemaLayers.php', monitor)[1], monitor)
        self.assertEqual(gateway.validate_read('rest/portal/admin/getUserForms.php', {'form_id': '39'})[1], {'form_id': '39'})
        for path, params in [
            ('rest/portal/getMonitorSchemaLayers.php', {'schemaId': '13'}),
            ('rest/portal/getMonitorSchemaLayers.php', {**monitor, 'getDisabled': 'all'}),
            ('rest/portal/getMonitorSchemaLayers.php', {**monitor, 'schemaId': '0'}),
            ('rest/portal/admin/getUserForms.php', {'form_id': '2147483648'}),
            ('rest/portal/admin/getUserForms.php', {'form_id': '39', 'mode': 'save'}),
            ('rest/portal/admin/getSubmissions.php', {'limit': '501'}),
            ('rest/portal/admin/getSubmissions.php', {'limit': '0'}),
            ('rest/portal/getUsers.php', {'limit': '501'}),
        ]:
            with self.subTest(path=path, params=params), self.assertRaises(ValueError):
                gateway.validate_read(path, params)

    def test_unknown_routes_and_write_modes_cannot_use_read_channel(self):
        for path, params in [
            ('https://example.com/private', {}),
            ('rest/portal/admin/getServerVariables.php', {}),
            ('rest/openmap/savedProjects.php', {'mode': 'save', 'projectId': '4'}),
            ('rest/portal/saveLoadReportingToolPresets.php', {'mode': 'save', 'matchId': '1'}),
            ('rest/portal/getForm.php', {'id': '39', 'url': 'https://example.com'}),
        ]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                gateway.validate_read(path, params)

    def test_monitor_pages_are_bounded_and_native_zero_based(self):
        params = {'schemaId': '13', 'recId': '4', 'submissionId': '1477', 'pageSize': '500', 'pageNumber': '0', 'getDraft': 'true'}
        self.assertEqual(gateway.validate_read('rest/portal/getMonitorData.php', params)[1]['pageNumber'], '0')
        for native in [
            {'layerId': '386', 'recId': '1', 'pageSize': '500', 'pageNumber': '0'},
            {'schemaId': '13', 'recId': '1', 'getSingleLayerInfo': 'true', 'pageSize': '500', 'pageNumber': '0'},
        ]:
            self.assertEqual(gateway.validate_read('rest/portal/getMonitorData.php', native)[1], native)
        with self.assertRaises(ValueError):
            gateway.validate_read('rest/portal/getMonitorData.php', {**params, 'layerId': '386'})
        for value in ['null', '0', '501']:
            with self.subTest(size=value), self.assertRaises(ValueError):
                gateway.validate_read('rest/portal/getMonitorData.php', {**params, 'pageSize': value})

    def test_project_payload_and_sharing_are_bounded(self):
        project = json.dumps({'coordinates': [-124, 54], 'scale': 1250, 'layers': []})
        self.assertEqual(gateway.validate_write('rest/openmap/savedProjects.php', {'mode': 'save', 'projectId': '4', 'projectJson': project})[0], 'rest/openmap/savedProjects.php')
        for params in [
            {'mode': 'delete', 'projectId': '4'},
            {'mode': 'save', 'projectId': '4', 'projectJson': '{}'},
            {'mode': 'shareProject', 'projectId': '4', 'permissionAdditions': '[1,1]', 'permissionRemovals': '[]'},
        ]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                gateway.validate_write('rest/openmap/savedProjects.php', params)

    def test_group_and_permissions_exclude_password_identity_and_delete(self):
        self.assertEqual(gateway.validate_write('rest/portal/admin/updateGroup.php', {
            'gid': '1', 'addedUsers': '[{"uid":7,"primary_group":false}]',
            'primaryToggledUsers': '[]', 'removedUsers': '[]'})[0], 'rest/portal/admin/updateGroup.php')
        with self.assertRaises(ValueError):
            gateway.validate_write('rest/portal/admin/setLinkableStatus.php', {'mode': 'delete', 'layerIds': '[1]'})
        with self.assertRaises(ValueError):
            gateway.validate_write('rest/portal/admin/updateUser.php', {'uid': '1', 'newPassword': 'changed'})

    def test_source_draft_mutations_never_finalize_or_notify(self):
        for path in ['rest/portal/setSubmitted.php', 'rest/portal/sendSubmissionNotification.php']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                gateway.validate_write(path, {'submissionId': '4'})
        with self.assertRaises(ValueError):
            gateway.validate_write('rest/portal/setDynamicFields.php', {'submissionId': '4', 'status': 'submitted', 'fields': '[]'})
        self.assertEqual(gateway.validate_write('rest/portal/setDynamicFields.php', {'submissionId': '4', 'status': 'draft', 'fields': '[{"id":561,"value":"reviewed"}]'})[0], 'rest/portal/setDynamicFields.php')

    def test_session_jars_are_distinct_and_expire(self):
        sessions = gateway.Sessions()
        first_id, first = sessions.get()
        second_id, second = sessions.get()
        self.assertNotEqual(first_id, second_id)
        self.assertIsNot(first.cookies, second.cookies)
        first.touched -= gateway.SESSION_TTL + 1
        new_id, new = sessions.get(first_id)
        self.assertNotEqual(new_id, first_id)
        self.assertIsNot(new, first)
        self.assertFalse(new.logged_in)

    def test_native_document_bootstrap_occurs_once_per_private_jar(self):
        session = gateway.Session()
        calls = []
        def respond(request, timeout):
            calls.append(request)
            return io.BytesIO(b'<html>native document</html>' if request.full_url == gateway.PORTAL else b'{"status":"success","loggedIn":false,"attributes":[]}')
        session.opener = Mock()
        session.opener.open.side_effect = respond
        gateway.upstream(session, 'rest/portal/getSubmissionLayers.php', {'submissionId': '1477'})
        gateway.upstream(session, 'rest/portal/getSubmissionLayers.php', {'submissionId': '1477'})
        self.assertEqual([request.full_url for request in calls].count(gateway.PORTAL), 1)
        self.assertIsNone(calls[0].data)
        self.assertTrue(session.bootstrapped)
        self.assertEqual(calls[1].get_header('Referer'), gateway.PORTAL)

    def test_oversized_bootstrap_is_not_marked_successful(self):
        session = gateway.Session()
        session.opener = Mock()
        session.opener.open.return_value = io.BytesIO(b'x' * 21)
        with patch.object(gateway, 'MAX_RESPONSE', 20), self.assertRaises(ValueError):
            gateway.upstream(session, 'rest/portal/getForms.php')
        self.assertFalse(session.bootstrapped)


class GatewayHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), gateway.Handler)
        cls.server.allowed_origins = {'http://127.0.0.1:42173'}
        cls.server.sessions = gateway.Sessions()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}{gateway.BASE}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.opener = self.client()
        self.other = self.client()
        self.source_calls = []
        self.owner = 7
        self.patch = patch.object(gateway, 'upstream', side_effect=self.source)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def client(self):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def source(self, session, path, params=None):
        self.source_calls.append((path, params))
        if path == 'rest/portal/login.php':
            session.logged_in = True
            return {'success': True, 'status': 'success', 'loggedIn': True,
                    'attributes': {'isAdmin': params['username'] == 'admin', 'private_contact': 'not forwarded'}}
        if path == 'rest/openmap/savedProjects.php' and params.get('mode') == 'list':
            return {'status': 'success', 'loggedIn': session.logged_in,
                    'attributes': {'uid': 7, 'projects': [{'project_id': 4, 'creator_id': self.owner}]}}
        if path.startswith('rest/portal/admin/getUserDetails'):
            return {'status': 'success', 'attributes': {key: False if key in {'active', 'can_be_assigned_subs', 'can_assign_subs', 'can_edit_subs', 'boss_permission'} else 'original' for key in gateway.USER_IDENTITY_KEYS}}
        if path == 'rest/portal/getForm.php':
            return {'status': 'success', 'attributes': {'nodes': [{'field_id': 561, 'nodeInfo': {'node_is_dynamic': True}}, {'field_id': 562, 'nodeInfo': {'node_is_dynamic': 'false'}}]}}
        if path == 'rest/portal/startSubmission.php':
            return {'status': 'success', 'attributes': {'submissionId': 99}}
        if path == 'rest/portal/getSubmissionLayers.php':
            return {'status': 'success', 'attributes': [{'layer_id': 386}]}
        if path == 'rest/openmap/getPortalLayer.php':
            return {'status': 'success', 'attributes': {'mapfile': '/source/permitted.map', 'mapfileName': 'source_layer'}}
        return {'status': 'success', 'loggedIn': session.logged_in, 'attributes': {'accepted': True}}

    def call(self, action, payload=None, headers=None, opener=None):
        data = None if payload is None else json.dumps(payload).encode()
        request_headers = {'Origin': 'http://127.0.0.1:42173', **({'Content-Type': 'application/json'} if data else {}), **(headers or {})}
        request = urllib.request.Request(self.base + '/' + action, data=data, headers=request_headers)
        try:
            with (opener or self.opener).open(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def login(self, name='viewer'):
        status, body = self.call('login', {'username': name, 'password': 'fixture-only'})
        self.assertEqual(status, 200)
        return body

    def test_login_isolates_clients_and_does_not_return_private_attributes(self):
        logged = self.login('admin')
        self.assertTrue(logged['canWrite'])
        self.assertTrue(logged['isAdmin'])
        self.assertNotIn('attributes', logged)
        self.assertFalse(self.call('status', opener=self.other)[1]['loggedIn'])
        self.assertNotEqual(logged['csrfToken'], self.call('status', opener=self.other)[1]['csrfToken'])

    def partial_login_identity(self, session):
        session.logged_in = True
        session.cookies.set_cookie(http.cookiejar.Cookie(
            version=0, name='PHPSESSID', value='synthetic-partial-login', port=None, port_specified=False,
            domain='nechakowatershed-portal.ca', domain_specified=False, domain_initial_dot=False,
            path='/', path_specified=True, secure=True, expires=None, discard=True,
            comment=None, comment_url=None, rest={}))

    def assert_failed_identity_cleared(self, session):
        self.assertFalse(session.logged_in)
        self.assertFalse(session.is_admin)
        self.assertEqual(list(session.cookies), [])
        self.assertNotIn(session, self.server.sessions.items.values())
        self.assertEqual(self.call('read', {'path': 'rest/portal/admin/getGroups.php', 'params': {}})[0], 403)
        current = self.call('status')[1]
        self.assertFalse(current['loggedIn'])
        self.assertFalse(current['isAdmin'])
        self.assertFalse(current['canWrite'])

    def test_failed_login_envelopes_never_leave_administrator_rights(self):
        for denial in [
            {'success': False, 'status': 'success'},
            {'success': True, 'status': 'failure'},
            {'success': True, 'status': 'success', 'error': 'Synthetic denial'},
        ]:
            with self.subTest(denial=denial):
                self.login('admin')
                partial = []
                def deny(session, path, params=None):
                    self.assertEqual(path, 'rest/portal/login.php')
                    self.partial_login_identity(session)
                    partial.append(session)
                    return {**denial, 'loggedIn': True, 'attributes': {'isAdmin': True}}
                with patch.object(gateway, 'upstream', side_effect=deny):
                    code, value = self.call('login', {'username': 'synthetic-fixture', 'password': 'fixture-only'})
                    self.assertEqual(code, 401)
                    self.assertNotIn('csrfToken', value)
                    self.assert_failed_identity_cleared(partial[0])

    def test_source_login_exception_discards_partial_identity_and_cookies(self):
        self.login('admin')
        partial = []
        def fail_after_cookie(session, path, params=None):
            self.assertEqual(path, 'rest/portal/login.php')
            self.partial_login_identity(session)
            partial.append(session)
            raise urllib.error.URLError('Synthetic source transport failure')
        with patch.object(gateway, 'upstream', side_effect=fail_after_cookie):
            code, _ = self.call('login', {'username': 'synthetic-fixture', 'password': 'fixture-only'})
            self.assertEqual(code, 502)
            self.assert_failed_identity_cleared(partial[0])

    def test_wrong_origin_and_csrf_never_forward_a_write(self):
        logged = self.login()
        payload = {'path': 'rest/openmap/savedProjects.php', 'params': {'mode': 'rename', 'projectId': '4', 'projectName': 'Reviewed'}}
        self.assertEqual(self.call('write', payload)[0], 403)
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken'], 'Origin': 'https://untrusted.example'})[0], 400)
        self.assertEqual(self.source_calls, [('rest/portal/login.php', {'username': 'viewer', 'password': 'fixture-only'})])

    def test_source_owner_is_checked_before_forwarding_project_changes(self):
        logged = self.login()
        payload = {'path': 'rest/openmap/savedProjects.php', 'params': {'mode': 'rename', 'projectId': '4', 'projectName': 'Reviewed'}}
        self.owner = 99
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken']})[0], 403)
        self.assertFalse(any(params and params.get('mode') == 'rename' for _, params in self.source_calls))
        self.owner = 7
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken']})[0], 200)

    def test_admin_changes_require_actual_login_admin_flag(self):
        logged = self.login()
        payload = {'path': 'rest/portal/admin/setContent.php', 'params': {'id': '18', 'data': 'Reviewed text', 'link': 'false'}}
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken']})[0], 403)
        admin = self.login('admin')
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': admin['csrfToken']})[0], 200)

    def test_manager_reads_require_source_admin_and_clear_after_disconnect(self):
        payloads = [
            {'path': 'rest/portal/getUsers.php', 'params': {'page': '1', 'start': '0', 'limit': '100'}},
            {'path': 'rest/portal/admin/getGroups.php', 'params': {}},
            {'path': 'rest/portal/admin/getUserForms.php', 'params': {'form_id': '39'}},
            {'path': 'rest/portal/getMonitorSchemaLayers.php', 'params': {
                'schemaId': '13', 'getDraftSubmissions': 'true', 'getDisabled': 'true'}},
        ]
        for payload in payloads:
            self.assertEqual(self.call('read', payload)[0], 403)
        self.assertEqual(self.source_calls, [])
        self.login()
        before = len(self.source_calls)
        for payload in payloads:
            self.assertEqual(self.call('read', payload)[0], 403)
        self.assertEqual(len(self.source_calls), before)
        self.login('admin')
        for payload in payloads:
            self.assertEqual(self.call('read', payload)[0], 200)
            self.assertEqual(self.source_calls[-1], (payload['path'], payload['params'] or None))
            self.assertEqual(self.call('read', payload, opener=self.other)[0], 403)
        self.call('disconnect', {})
        before = len(self.source_calls)
        for payload in payloads:
            self.assertEqual(self.call('read', payload)[0], 403)
        self.assertEqual(len(self.source_calls), before)

    def test_permission_changes_cannot_mutate_account_identity(self):
        admin = self.login('admin')
        identity = self.source(None, 'rest/portal/admin/getUserDetails.php', {})['attributes']
        params = {'uid': '3', 'newData': json.dumps({**identity, 'email': 'changed'}), 'newPassword': '',
                  **{key: '[]' for key in gateway.PERMISSION_KEYS}}
        self.assertEqual(self.call('write', {'path': 'rest/portal/admin/updateUser.php', 'params': params}, {'X-Nechako-CSRF': admin['csrfToken']})[0], 403)
        self.assertFalse(any(path.endswith('updateUser.php') for path, _ in self.source_calls))

    def test_disconnect_discards_auth_and_rejects_prior_token(self):
        logged = self.login()
        self.assertEqual(self.call('disconnect', {})[0], 200)
        self.assertFalse(self.call('status')[1]['loggedIn'])
        payload = {'path': 'rest/openmap/setDefaultProject.php', 'params': {'projectId': 'unset'}}
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken']})[0], 403)

    def test_drafts_require_current_session_allocation_and_declared_dynamic_fields(self):
        logged = self.login()
        headers = {'X-Nechako-CSRF': logged['csrfToken']}
        payload = {'path': 'rest/portal/setDynamicFields.php', 'params': {'submissionId': '99', 'status': 'draft', 'fields': '[{"id":561,"value":"reviewed"}]'}}
        self.assertEqual(self.call('write', payload, headers)[0], 403)
        allocated = self.call('write', {'path': 'rest/portal/startSubmission.php', 'params': {'formId': '39'}}, headers)
        self.assertEqual(allocated[1]['attributes']['submissionId'], 99)
        self.assertEqual(self.call('write', payload, headers)[0], 200)
        payload['params']['fields'] = '[{"id":562,"value":"static node must not be written"}]'
        self.assertEqual(self.call('write', payload, headers)[0], 403)
        self.assertEqual(self.call('write', payload, {'X-Nechako-CSRF': logged['csrfToken']}, opener=self.other)[0], 403)

    def test_attributes_use_only_a_permitted_server_derived_descriptor(self):
        payload = {'submissionId': '1477', 'layerId': '386'}
        self.assertEqual(self.call('layer-attributes', {**payload, 'filename': '/caller/untrusted.map'})[0], 400)
        self.assertEqual(self.call('layer-attributes', {**payload, 'layerId': '999'})[0], 403)
        self.assertFalse(any(path == 'rest/openmap/attributes.php' for path, _ in self.source_calls))
        self.assertEqual(self.call('layer-attributes', payload)[0], 200)
        attributes_call = self.source_calls[-1]
        self.assertEqual(attributes_call[0], 'rest/openmap/attributes.php')
        self.assertEqual(json.loads(attributes_call[1]['data']), {'filename': '/source/permitted.map', 'layername': 'source_layer'})
        self.assertEqual(json.loads(attributes_call[1]['source']), {'isPortal': True, 'layer': 386})
        self.assertEqual(self.call('read', {'path': 'rest/openmap/attributes.php', 'params': {}})[0], 400)



class SubmissionDownloads(unittest.TestCase):
    def session(self, body, disposition='attachment; filename="original.file"'):
        session = gateway.Session()
        response = io.BytesIO(body)
        response.headers = {'Content-Disposition': disposition}
        session.opener = Mock()
        session.opener.open.return_value = response
        return session

    def test_invalid_ids_modes_urls_and_extra_fields_never_read_source(self):
        with patch.object(gateway, 'upstream') as read:
            for payload in [{'submissionId': '9', 'mode': 'delete'}, {'submissionId': '-1', 'mode': 'pdf'},
                            {'submissionId': '9', 'mode': 'pdf', 'url': 'https://example.test'},
                            {'submissionId': '9', 'mode': 'files', 'filename': '/private'}]:
                with self.assertRaises(ValueError):
                    gateway.submission_download(gateway.Session(), payload)
            read.assert_not_called()

    def test_permission_denial_prevents_binary_read(self):
        session = self.session(b'%PDF-1.7')
        with patch.object(gateway, 'upstream', return_value={'status': 'failure', 'error': 'Denied'}):
            with self.assertRaises(PermissionError):
                gateway.submission_download(session, {'submissionId': '9', 'mode': 'pdf'})
        session.opener.open.assert_not_called()

    def test_verified_formats_bound_to_same_identity_and_fixed_endpoint(self):
        bodies = {'pdf': b'%PDF-1.7 fixture', 'html': b'<link rel="stylesheet" href="source.css"><div>fixture</div>',
                  'csv': b'"Title","Value"\n"Fixture","0"', 'files': b'PK\x05\x06' + bytes(18)}
        for mode, body in bodies.items():
            session = self.session(body)
            with patch.object(gateway, 'upstream', return_value={'status': 'success', 'attributes': {'submission_id': 9}}) as read:
                content, mime, filename = gateway.submission_download(session, {'submissionId': '9', 'mode': mode})
            self.assertEqual(content, body)
            self.assertIn('9', filename)
            read.assert_called_once_with(session, 'rest/portal/getSubmissionMetadata.php', {'submissionId': '9'})
            request = session.opener.open.call_args.args[0]
            self.assertEqual(request.full_url, gateway.PORTAL + 'rest/portal/downloadSubmission.php')
            self.assertEqual(urllib.parse.parse_qs(request.data.decode()), {'submissionId': ['9'], 'mode': [mode]})
            self.assertEqual(request.get_header('Referer'), gateway.PORTAL)

    def test_invalid_errors_signatures_and_oversized_downloads_remain_errors(self):
        for mode, body, disposition in [('pdf', b'<html>Error</html>', 'attachment'),
                                        ('files', b'not ZIP', 'attachment'),
                                        ('html', b'{"status":"failure","error":"Denied"}', 'attachment'),
                                        ('csv', b'<html>Warning</html>', 'attachment'),
                                        ('pdf', b'%PDF-1.7', '')]:
            with patch.object(gateway, 'upstream', return_value={'status': 'success', 'attributes': {}}):
                with self.assertRaises((ValueError, PermissionError)):
                    gateway.submission_download(self.session(body, disposition), {'submissionId': '9', 'mode': mode})
        with patch.object(gateway, 'MAX_DOWNLOAD', 4), patch.object(gateway, 'upstream', return_value={'status': 'success', 'attributes': {}}):
            with self.assertRaisesRegex(ValueError, '32 MiB'):
                gateway.submission_download(self.session(b'%PDF-1.7'), {'submissionId': '9', 'mode': 'pdf'})

if __name__ == '__main__':
    unittest.main()
