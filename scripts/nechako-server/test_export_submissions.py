"""Offline export coverage/integrity tests. No network, login or source writes."""

import contextlib
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock
import zipfile

import export_submissions as exporter


def envelope(attributes):
    return {'success': True, 'status': 'success', 'loggedIn': True, 'attributes': attributes}


def form():
    nodes = [
        {'field_id': fid, 'field_label': label, 'field_type': kind, 'nodeInfo': {'node_is_dynamic': True}}
        for fid, label, kind in [(101, 'Flag', 'checkbox'), (102, 'Count', 'number'),
                                (103, 'Text', 'text'), (104, 'Details', 'textarea')]
    ]
    nodes.extend([
        {'field_id': 900, 'nodeInfo': {'node_is_dynamic': False}},
        {'field_id': 105, 'field_label': 'After static node', 'field_type': 'text', 'nodeInfo': {'node_is_dynamic': 't'}},
    ])
    return envelope({'name': 'Offline source form', 'nodes': nodes})


class FixtureSource:
    def __init__(self):
        self.calls = []
        self.clients = []
        self.lock = threading.Lock()
        self.fail_attachment = False
        self.resource_overrides = {}
        self.catalogue = envelope([
            {'sub_id': 20, 'sub_title': 'Unsearched draft', 'sub_name': '', 'sub_state': 'DRAFT'},
            {'sub_id': 2, 'sub_title': 'Submitted fixture', 'sub_name': '', 'sub_state': 'SUBMITTED'},
            {'sub_id': 10, 'sub_title': 'Draft fixture', 'sub_name': '', 'sub_state': 'DRAFT'},
        ])
        # The source search/report omit both drafts. The admin catalogue is the
        # coverage authority; content fallbacks must retain the hidden drafts.
        self.search = envelope({'results': [{'submission_id': 2, 'form_id': 39}]})
        self.bulk = envelope({'rows': {'2': {'field_101': False, 'field_102': 0,
                                           'field_103': '', 'field_104': {'notes': ['one', 'two']}}}})

    def client(self, username, password):
        source = self
        class OfflineClient:
            authenticated = True
            closed = False
            def read(self, path, params):
                if path not in exporter.ALLOWED or path.endswith('login.php'):
                    raise AssertionError('Unexpected export endpoint: ' + path)
                with source.lock:
                    source.calls.append((path, dict(params)))
                endpoint = path.rsplit('/', 1)[-1]
                if endpoint == 'getSubmissions.php': return copy.deepcopy(source.catalogue)
                if endpoint == 'getSearchResults.php': return copy.deepcopy(source.search)
                if endpoint == 'getForms.php': return envelope([{'form_id': 39, 'form_name': 'Fixture catalogue form name'}])
                if endpoint == 'getForm.php': return form()
                if endpoint == 'GetFormStatistics.php':
                    expected = {str(fid): 'field_' + str(fid) for fid in range(101, 106)}
                    if json.loads(params['mapping']) != expected:
                        raise AssertionError('Bulk mapping did not preserve source field IDs.')
                    return copy.deepcopy(source.bulk)
                sid = params['submissionId']
                if (endpoint, sid) in source.resource_overrides:
                    return envelope(source.resource_overrides[(endpoint, sid)])
                if endpoint == 'getSubmissionMetadata.php':
                    # The hidden draft also exercises the separate form-ID read.
                    return envelope({'submission_id': int(sid), **({} if sid == '20' else {'form_id': 39}), 'parent_id': 0})
                if endpoint == 'getSubmissionForm.php': return envelope(39)
                if endpoint == 'getSubmissionAttachments.php':
                    if source.fail_attachment and sid == '20': raise ValueError('Offline attachment denial')
                    return envelope([{'attachment_id': int(sid), 'name': 'reference.txt', 'path': 'https://example.test/reference.txt'}])
                if endpoint == 'getSubmissionLayers.php': return envelope([{'layer_id': int(sid) + 1000, 'layer_name': 'Fixture layer'}])
                if endpoint == 'getSubmissionLinkedLayers.php': return envelope([])
                if endpoint == 'getFieldValue.php':
                    field = params['fieldId']
                    values = {'101': False, '102': 0, '103': '', '104': None,
                              '105': '=SUM(1,2)' if sid == '2' else 'Café,\n"quoted"'}
                    return envelope(values[field])
                raise AssertionError('Unhandled offline read: ' + path)
            def close(self): self.closed = True
        client = OfflineClient()
        source.clients.append(client)
        return client


class ExportContracts(unittest.TestCase):
    def test_omission_is_distinct_from_false_zero_empty_and_null(self):
        field = {'id': '101'}
        for value in [False, 0, '', None, [], {}]:
            with self.subTest(value=value):
                self.assertEqual(exporter.source_value({'field_101': value}, field),
                                 {'value': value, 'read_method': 'GetFormStatistics'})
        self.assertIsNone(exporter.source_value({}, field))

    def test_catalogue_rejects_duplicate_normalized_ids(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            exporter.catalogue_ids(envelope([{'sub_id': 2}, {'sub_id': '02'}]))
        for value in [False, 0, -1, 'not-an-id']:
            with self.subTest(value=value), self.assertRaises(ValueError): exporter.identifier(value)

    def test_field_indices_restart_at_static_nodes_and_duplicate_ids_fail(self):
        self.assertEqual([(f['id'], f['index']) for f in exporter.form_fields(form())],
                         [('101', 0), ('102', 1), ('103', 2), ('104', 3), ('105', 0)])
        duplicate = form()
        duplicate['attributes']['nodes'].append(duplicate['attributes']['nodes'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate'): exporter.form_fields(duplicate)


class ExportTransportBounds(unittest.TestCase):
    def client(self, response_bytes):
        # Skip Client.__init__: no bootstrap/authentication/network is exercised.
        client = exporter.Client.__new__(exporter.Client)
        client.cookies = {}
        client.content_response_limit = 64
        response = Mock(status=200)
        response.getheaders.return_value = []
        response.read.side_effect = lambda limit: b'x' * min(limit, response_bytes)
        connection = Mock()
        connection.getresponse.return_value = response
        client.connection = connection
        return client, connection, response

    def test_only_content_routes_use_the_expanded_bound(self):
        for path in sorted(exporter.ALLOWED) + ['']:
            with self.subTest(path=path), patch.object(exporter, 'MAX_RESPONSE', 20), patch.object(exporter.http.client, 'HTTPSConnection', side_effect=AssertionError('Network forbidden')):
                client, connection, response = self.client(7)
                expected = 64 if path in {'rest/portal/getFieldValue.php', 'rest/portal/GetFormStatistics.php'} else 20
                self.assertEqual(client.request(path, {} if path else None, bootstrap=path == ''), b'x' * 7)
                response.read.assert_called_once_with(expected + 1)
                connection.close.assert_not_called()

    def test_oversized_content_and_inventory_close_the_connection_without_retry(self):
        for path, length in [('rest/portal/getFieldValue.php', 65),
                             ('rest/portal/GetFormStatistics.php', 65),
                             ('rest/portal/getSubmissionAttachments.php', 21)]:
            with self.subTest(path=path), patch.object(exporter, 'MAX_RESPONSE', 20), patch.object(exporter.http.client, 'HTTPSConnection', side_effect=AssertionError('Network forbidden')):
                client, connection, _ = self.client(length)
                with self.assertRaisesRegex(ValueError, 'this read is incomplete'):
                    client.request(path, {})
                connection.close.assert_called_once()
                self.assertIsNone(client.connection)
                self.assertEqual(connection.request.call_count, 1)


class ExportCapture(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / 'capture'
        self.source = FixtureSource()
        previous_umask = os.umask(0o077)
        os.umask(previous_umask)
        self.addCleanup(os.umask, previous_umask)
        self.patches = [
            patch.object(exporter, 'Client', side_effect=self.source.client),
            patch.object(exporter.http.client, 'HTTPSConnection', side_effect=AssertionError('Network forbidden in offline tests')),
            patch.dict(os.environ, {'NECHAKO_EXPORT_USERNAME': 'offline-fixture-user', 'NECHAKO_EXPORT_PASSWORD': 'offline-fixture-password'}),
        ]
        for active in self.patches:
            active.start()
            self.addCleanup(active.stop)

    def capture(self, resume=False):
        with contextlib.redirect_stdout(io.StringIO()):
            exporter.extract(SimpleNamespace(output=self.root, workers=2, resume=resume))
        self.assertTrue(all(client.closed for client in self.source.clients))
        return exporter.load(self.root / 'summary.json')

    def test_all_catalogue_records_including_unsearched_drafts_and_exact_values(self):
        summary = self.capture()
        self.assertEqual({k: summary[k] for k in ('submissions', 'submitted', 'drafts', 'complete_records', 'incomplete_records')},
                         {'submissions': 3, 'submitted': 1, 'drafts': 2, 'complete_records': 3, 'incomplete_records': 0})
        self.assertEqual(summary['bulk_field_values'], 4)
        self.assertEqual(summary['individual_field_values'], 11)
        records = exporter.load(self.root / 'submissions.json')['submissions']
        self.assertEqual([r['source_id'] for r in records], ['2', '10', '20'])
        for item in records:
            self.assertIs(item['values']['101']['value'], False)
            self.assertEqual(item['values']['102']['value'], 0)
            self.assertEqual(item['values']['103']['value'], '')
        self.assertEqual(records[0]['values']['104']['value'], {'notes': ['one', 'two']})
        self.assertIsNone(records[2]['values']['104']['value'])
        fallback = [params for path, params in self.source.calls if path.endswith('getFieldValue.php') and params['submissionId'] == '2']
        self.assertEqual(fallback, [{'submissionId': '2', 'fieldId': '105', 'fieldIndex': '0'}])
        self.assertIn(('rest/portal/getSubmissionForm.php', {'submissionId': '20'}), self.source.calls)
        with (self.root / 'form-reports/39.csv').open(encoding='utf-8-sig', newline='') as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(rows[0]['field_101'], 'false')
        self.assertEqual(rows[0]['field_102'], '0')
        self.assertEqual(rows[0]['field_103'], '')
        self.assertEqual(rows[0]['field_105'], "'=SUM(1,2)")
        self.assertEqual(records[0]['values']['105']['value'], '=SUM(1,2)')
        self.assertEqual(rows[1]['field_105'], 'Café,\n"quoted"')
        self.assertEqual(rows[2]['field_104'], 'null')
        with (self.root / 'field-dictionary.csv').open(encoding='utf-8-sig', newline='') as stream:
            dictionary = list(csv.DictReader(stream))
        self.assertEqual(len(dictionary), 5)
        self.assertEqual(dictionary[-1], {'form_id': '39', 'form_name': 'Fixture catalogue form name',
                         'field_id': '105', 'label': 'After static node', 'type': 'text', 'index': '0', 'csv_column': 'field_105'})

    def test_manifest_and_zip_match_every_capture_file_without_credentials(self):
        self.capture()
        manifest = exporter.load(self.root / 'manifest.json')
        expected = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file() and p.name != 'manifest.json'}
        self.assertEqual({entry['path'] for entry in manifest['files']}, expected)
        self.assertEqual(manifest['file_bytes'], sum(entry['bytes'] for entry in manifest['files']))
        for entry in manifest['files']:
            raw = (self.root / entry['path']).read_bytes()
            self.assertEqual(entry['bytes'], len(raw))
            self.assertEqual(entry['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertNotIn(b'offline-fixture-user', raw)
            self.assertNotIn(b'offline-fixture-password', raw)
        with zipfile.ZipFile(self.root.with_suffix('.zip')) as archive:
            self.assertEqual(set(archive.namelist()), expected | {'manifest.json'})
            for name in archive.namelist(): self.assertEqual(archive.read(name), (self.root / name).read_bytes())

    def test_resume_reuses_complete_records_and_recaptures_failed_resource(self):
        self.source.fail_attachment = True
        first = self.capture()
        self.assertEqual(first['complete_records'], 2)
        self.assertEqual(first['incomplete_records'], 1)
        failed = exporter.load(self.root / 'submissions/20.json')
        self.assertFalse(failed['complete'])
        self.assertEqual(failed['errors'], [{'resource': 'attachments', 'error': 'Offline attachment denial'}])
        untouched = {sid: (self.root / f'submissions/{sid}.json').read_bytes() for sid in ('2', '10')}
        self.source.calls.clear()
        self.source.fail_attachment = False
        second = self.capture(resume=True)
        self.assertEqual(second['complete_records'], 3)
        self.assertEqual(second['incomplete_records'], 0)
        for sid, raw in untouched.items(): self.assertEqual((self.root / f'submissions/{sid}.json').read_bytes(), raw)
        resource_calls = [params['submissionId'] for path, params in self.source.calls if path.rsplit('/', 1)[-1] in exporter.RESOURCES.values()]
        self.assertEqual(resource_calls, ['20'] * 4)
        self.assertFalse(any(path.endswith('getForm.php') or path.endswith('GetFormStatistics.php') for path, _ in self.source.calls))

    def test_duplicate_search_ids_abort_before_content_reads(self):
        self.source.search['attributes']['results'].append({'submission_id': '02', 'form_id': 39})
        with self.assertRaisesRegex(ValueError, 'Duplicate native search'):
            self.capture()
        self.assertFalse(any(path.rsplit('/', 1)[-1] in exporter.RESOURCES.values() for path, _ in self.source.calls))
        self.assertFalse((self.root / 'summary.json').exists())

    def test_native_empty_bulk_array_is_preserved_and_all_values_fall_back(self):
        self.source.bulk = envelope({'rows': []})
        summary = self.capture()
        self.assertEqual(summary['setup_errors'], [])
        self.assertEqual(summary['complete_records'], 3)
        self.assertEqual(summary['bulk_field_values'], 0)
        self.assertEqual(summary['individual_field_values'], 15)
        self.assertEqual(exporter.load(self.root / 'form-reports/39.json')['attributes']['rows'], [])

    def test_invalid_bulk_shape_is_saved_before_fallback_capture(self):
        self.source.bulk = envelope({'rows': [None]})
        summary = self.capture()
        self.assertEqual(summary['complete_records'], 3)
        self.assertEqual(summary['individual_field_values'], 15)
        self.assertEqual(len(summary['setup_errors']), 1)
        self.assertEqual(exporter.load(self.root / 'form-reports/39.json')['attributes']['rows'], [None])

    def test_invalid_resource_shapes_are_incomplete_and_do_not_crash_inventories(self):
        for invalid in [None, 5, False, [None]]:
            with self.subTest(attributes=invalid):
                self.source.resource_overrides[('getSubmissionAttachments.php', '20')] = invalid
                summary = self.capture()
                self.assertEqual(summary['incomplete_records'], 1)
                self.assertEqual(summary['attachments'], 2)
                item = exporter.load(self.root / 'submissions/20.json')
                self.assertIs(item['complete'], False)
                self.assertEqual(item['resources']['attachments']['attributes'], invalid)
                self.assertEqual(item['errors'][0]['resource'], 'attachments')
                with (self.root / 'submission-index.csv').open(encoding='utf-8-sig', newline='') as stream:
                    index = {row['source_id']: row for row in csv.DictReader(stream)}
                self.assertEqual(index['20']['attachments'], 'UNREAD')
        self.source.resource_overrides.clear()
        self.source.resource_overrides[('getSubmissionMetadata.php', '20')] = []
        summary = self.capture()
        self.assertEqual(summary['incomplete_records'], 1)
        self.assertEqual(exporter.load(self.root / 'submissions/20.json')['errors'][0]['resource'], 'metadata')

    def test_resume_recaptures_hash_mismatch(self):
        self.capture()
        path = self.root / 'submissions/2.json'
        item = exporter.load(path)
        item['values']['101']['value'] = 'tampered value'
        exporter.save(path, item)
        self.source.calls.clear()
        self.capture(resume=True)
        self.assertIs(exporter.load(path)['values']['101']['value'], False)
        resources = [params['submissionId'] for path, params in self.source.calls if path.rsplit('/', 1)[-1] in exporter.RESOURCES.values()]
        self.assertEqual(resources, ['2'] * 4)

    def test_resume_rejects_structurally_incomplete_records_even_with_matching_hash(self):
        self.capture()
        path = self.root / 'submissions/2.json'
        item = exporter.load(path)
        del item['values']['102']
        exporter.save(path, item)
        manifest_path = self.root / 'manifest.json'
        manifest = exporter.load(manifest_path)
        for entry in manifest['files']:
            if entry['path'] == 'submissions/2.json':
                entry['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                entry['bytes'] = path.stat().st_size
        exporter.save(manifest_path, manifest)
        self.source.calls.clear()
        summary = self.capture(resume=True)
        self.assertEqual(summary['complete_records'], 3)
        self.assertEqual(exporter.load(path)['values']['102']['value'], 0)
        resources = [params['submissionId'] for path, params in self.source.calls if path.rsplit('/', 1)[-1] in exporter.RESOURCES.values()]
        self.assertEqual(resources, ['2'] * 4)

    def test_interrupted_capture_resume_requires_original_scope_and_complete_shape(self):
        self.capture()
        path = self.root / 'submissions/2.json'
        original = exporter.load(path)
        catalogue = next(row for row in self.source.catalogue['attributes'] if row['sub_id'] == 2)
        definitions = {'39': (form(), exporter.form_fields(form()))}
        self.assertTrue(exporter.reusable_record(original, '2', catalogue, definitions, path, None))
        changes = [
            {'schema': 'another-export-schema'}, {'source': 'https://example.test/'},
            {'source_id': '20'}, {'complete': 'true'}, {'errors': [{'resource': 'field'}]},
            {'catalogue': {**catalogue, 'sub_state': 'DRAFT'}}, {'form_path': 'forms/40.json'},
            {'form_id': '40'}, {'values': {}},
            {'resources': {**original['resources'], 'metadata': envelope([])}},
        ]
        for change in changes:
            with self.subTest(change=list(change)):
                self.assertFalse(exporter.reusable_record({**original, **change}, '2', catalogue, definitions, path, None))
        # With no final manifest, complete partial records can still be resumed
        # once every source ID, definition and required value has been checked.
        (self.root / 'manifest.json').unlink()
        self.source.calls.clear()
        self.capture(resume=True)
        self.assertFalse(any(path.rsplit('/', 1)[-1] in exporter.RESOURCES.values() for path, _ in self.source.calls))

    def test_capture_info_keeps_original_cohort_start_across_resume(self):
        original_start = '2020-09-13T12:26:40+00:00'
        resumed_at = '2026-10-12T23:00:00+00:00'
        with patch.object(exporter, 'now', return_value=original_start): self.capture()
        original_info = exporter.load(self.root / 'capture-info.json')
        self.assertEqual(original_info['started_at_utc'], original_start)
        self.assertIs(original_info['resumed'], False)
        with patch.object(exporter, 'now', return_value=resumed_at): summary = self.capture(resume=True)
        resumed_info = exporter.load(self.root / 'capture-info.json')
        self.assertEqual(summary['started_at_utc'], original_start)
        self.assertEqual(resumed_info['started_at_utc'], original_start)
        self.assertEqual(resumed_info['this_run_started_at_utc'], resumed_at)
        self.assertIs(resumed_info['resumed'], True)

    def test_older_capture_without_info_uses_initial_catalogue_mtime(self):
        self.capture()
        (self.root / 'capture-info.json').unlink()
        catalogue = self.root / 'catalogues/admin-submissions.json'
        original_epoch = 1600000000
        os.utime(catalogue, (original_epoch, original_epoch))
        expected = exporter.datetime.datetime.fromtimestamp(original_epoch, exporter.datetime.timezone.utc).isoformat()
        summary = self.capture(resume=True)
        self.assertEqual(summary['started_at_utc'], expected)
        self.assertEqual(exporter.load(self.root / 'capture-info.json')['started_at_utc'], expected)


if __name__ == '__main__':
    unittest.main()
