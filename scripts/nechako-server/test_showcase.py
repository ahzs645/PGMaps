"""Offline checks for reviewed anonymous saved-project evidence and refresh preservation."""

import hashlib
import json
import tempfile
import unittest
import shutil
from pathlib import Path

from check_showcase import PUBLIC_PROJECT_IDS, PUBLIC_PROJECT_SOURCE, validate_public_projects
from snapshot_showcase import preserve_public_projects, select_public_project_source


class PublicProjectTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / 'source'
        self.output = Path(self.temporary.name) / 'output'
        self.source.mkdir()
        self.index = {'schema': 'nechako-public-projects-v1', 'access': 'anonymous',
                      'source': PUBLIC_PROJECT_SOURCE, 'capturedAt': '2026-10-12', 'projects': []}
        self.manifest = {'schema': 'nechako-showcase-v1', 'captured_at_utc': '2026-10-13T12:00:00+00:00',
                         'public_projects_captured_at_utc': '2026-10-12',
                         'counts': {'public_saved_projects': len(PUBLIC_PROJECT_IDS)}, 'files': []}
        for project_id in PUBLIC_PROJECT_IDS:
            relative = f'public-projects/project-{project_id}.json'
            envelope = {'success': True, 'status': 'success', 'loggedIn': False,
                        'attributes': {'projectId': str(project_id), 'projectName': f'Public project {project_id}',
                                       'projectSaveTimestamp': '2026-09-01', 'layers': [{}, {}]}}
            entry = self.write(relative, envelope, 'public_saved_project')
            self.index['projects'].append({'id': project_id, 'name': envelope['attributes']['projectName'],
                                          'file': relative, 'bytes': entry['bytes'], 'sha256': entry['sha256'],
                                          'layerCount': 2, 'savedAt': envelope['attributes']['projectSaveTimestamp']})
        self.write_index()

    def write(self, relative, data, kind):
        body = (json.dumps(data) + '\n').encode()
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        entry = {'path': relative, 'kind': kind, 'source_url': PUBLIC_PROJECT_SOURCE,
                 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
        self.manifest['files'] = [item for item in self.manifest['files'] if item['path'] != relative] + [entry]
        return entry

    def write_index(self):
        self.write('public-projects/index.json', self.index, 'public_project_catalogue')
        (self.source / 'manifest.json').write_text(json.dumps(self.manifest))

    def rewrite_envelope(self, **changes):
        item = self.index['projects'][0]
        envelope = json.loads((self.source / item['file']).read_text())
        envelope.update(changes)
        entry = self.write(item['file'], envelope, 'public_saved_project')
        item.update(bytes=entry['bytes'], sha256=entry['sha256'])
        self.write_index()

    def test_preserves_exact_bytes_and_separate_original_capture_date(self):
        preserved = preserve_public_projects(self.source, self.output)
        self.assertEqual(preserved['count'], 9)
        self.assertEqual(preserved['captured_at_utc'], '2026-10-12')
        self.assertNotEqual(preserved['captured_at_utc'], self.manifest['captured_at_utc'])
        self.assertEqual(len(preserved['files']), 10)
        for entry in preserved['files']:
            self.assertEqual((self.source / entry['path']).read_bytes(), (self.output / entry['path']).read_bytes())

    def test_authenticated_envelope_is_rejected_even_with_matching_hashes(self):
        self.rewrite_envelope(loggedIn=True)
        with self.assertRaisesRegex(ValueError, 'not an anonymous envelope'):
            preserve_public_projects(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_wrong_envelope_id_and_error_status_are_rejected(self):
        item = self.index['projects'][0]
        envelope = json.loads((self.source / item['file']).read_text())
        self.rewrite_envelope(attributes={**envelope['attributes'], 'projectId': '999'})
        with self.assertRaisesRegex(ValueError, 'project ID mismatch'):
            validate_public_projects(self.source, self.manifest)
        self.rewrite_envelope(status='failure')
        with self.assertRaisesRegex(ValueError, 'unsuccessful envelope'):
            validate_public_projects(self.source, self.manifest)

    def test_corrupt_file_fails_before_any_copy(self):
        (self.source / self.index['projects'][-1]['file']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'size mismatch'):
            preserve_public_projects(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_layer_count_and_reviewed_id_set_are_checked(self):
        self.index['projects'][0]['layerCount'] = 100
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'layer count mismatch'):
            validate_public_projects(self.source, self.manifest)
        self.index['projects'][0]['id'] = self.index['projects'][1]['id']
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'IDs differ or repeat'):
            validate_public_projects(self.source, self.manifest)

    def test_escaping_path_and_unregistered_files_are_rejected(self):
        self.index['projects'][0]['file'] = '../private.json'
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'unexpected file path'):
            validate_public_projects(self.source, self.manifest)
        self.index['projects'][0]['file'] = 'public-projects/project-4.json'
        self.write_index()
        (self.source / 'public-projects/unreviewed.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'unexpected or missing files'):
            validate_public_projects(self.source, self.manifest)

    def test_manifest_mismatch_and_capture_date_cannot_silently_pass(self):
        self.manifest['files'][0]['sha256'] = '0' * 64
        (self.source / 'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
            preserve_public_projects(self.source, self.output)
        self.manifest['public_projects_captured_at_utc'] = '2026-10-13'
        with self.assertRaisesRegex(ValueError, 'capture date differs'):
            validate_public_projects(self.source, self.manifest)

    def test_new_output_uses_reviewed_repository_seed_without_creating_output(self):
        source = select_public_project_source(self.output, repository_source=self.source)
        self.assertEqual(source, self.source)
        self.assertFalse(self.output.exists())

    def test_existing_review_is_preferred_over_repository_seed(self):
        source = select_public_project_source(self.source, repository_source=self.output)
        self.assertEqual(source, self.source)

    def test_explicit_seed_supports_legacy_output_and_can_override_existing_review(self):
        self.output.mkdir()
        (self.output / 'manifest.json').write_text(json.dumps({'schema': 'nechako-showcase-v1'}))
        self.assertEqual(select_public_project_source(self.output, explicit_source=self.source), self.source)
        self.assertEqual(select_public_project_source(self.output, repository_source=self.source), self.source)
        shutil.copytree(self.source / 'public-projects', self.output / 'public-projects')
        # Explicit seeding is still honored when the destination has a stale/partial review.
        self.assertEqual(select_public_project_source(self.output, explicit_source=self.source), self.source)

    def test_corrupt_existing_review_and_missing_recorded_review_do_not_fall_back(self):
        shutil.copytree(self.source, self.output)
        (self.output / self.index['projects'][0]['file']).write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'size mismatch'):
            select_public_project_source(self.output, repository_source=self.source)
        shutil.rmtree(self.output / 'public-projects')
        with self.assertRaisesRegex(ValueError, 'missing public-projects/index.json'):
            select_public_project_source(self.output, repository_source=self.source)

    def test_new_output_with_missing_or_invalid_seed_fails_before_creating_output(self):
        with self.assertRaisesRegex(ValueError, 'Cannot preserve reviewed public projects'):
            select_public_project_source(self.output, repository_source=Path(self.temporary.name) / 'missing')
        self.index['access'] = 'authenticated'
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'anonymous access'):
            select_public_project_source(self.output, explicit_source=self.source)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
