"""Synthetic metadata-only recovery and conditional owner publication checks."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from unittest import mock

import httpx
from PIL import Image

spec = importlib.util.spec_from_file_location('project_catalogue', Path(__file__).with_name('project_catalogue.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

BASE = 'https://maps.example.test/c/' + 'x' * 43 + '/'
CONFIG = {'endpoint': 'https://maps.example.test', 'shareId': 'x' * 43, 'uploadToken': 'synthetic-owner-token'}


class TestProjectCatalogue(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.catalogue = {
            'schema': 'synthetic-catalogue', 'title': 'Synthetic catalogue',
            'items': [], 'featured': [{'id': 'composite', 'assets': [{'bounds': [1, 2, 3, 4]}], 'alignmentReview': {'status': 'experimental'}}],
            'rectificationRevision': {'id': 'prior-review'}, 'storageBytes': 123,
        }
        self.manifest = {'schema': p.MANIFEST_SCHEMA, 'projects': [], 'groundAccuracyCertified': False}
        for index in range(5):
            item_id = f'synthetic-map-{index}'
            native_sha = hashlib.sha256(f'native-{index}'.encode()).hexdigest()
            source = self.bundle / f'source-{index}.png'
            Image.new('RGBA', (4, 3), (index, 50, 100, 255)).save(source)
            source_sha = p.digest_file(source)
            evidence = self.bundle / f'evidence-{index}.json'
            evidence.write_bytes(p.json_bytes({'originalModel': index, 'heldOutCheck': True}))
            evidence_sha = p.digest_file(evidence)
            project = {
                'schema': 'pgmaps-georeference-v2', 'pixelConvention': 'pixel-centres-x-right-y-down',
                'fitCrs': 'EPSG:3857', 'transform': 'affine', 'points': [],
                'source': {'id': item_id, 'sha256': source_sha, 'url': 'https://example.invalid/source.png',
                           'width': 4, 'height': 3, 'frame': {'kind': 'derived-image', 'description': 'Exact synthetic original pixels'}},
                'recoveredPlacement': {
                    'crs': 'EPSG:3005', 'active': True, 'matrix': [[2, .1, 1000000], [.2, -2, 1100000]],
                    'method': 'archived-model', 'summary': 'Existing placement preserved; ground accuracy remains unreviewed.',
                    'recoveredAt': '2026-11-08',
                    'evidence': [{'label': 'Synthetic evidence', 'sha256': evidence_sha, 'url': 'https://example.invalid/evidence.json'}],
                },
            }
            project_path = self.bundle / f'project-{index}.json'
            project_path.write_bytes(p.json_bytes(project))
            self.manifest['projects'].append({
                'nativeItemId': item_id, 'title': f'Recovered synthetic map {index}',
                'expectedCurrentNativeSha256': native_sha,
                'sourceFile': source.name, 'sourceSha256': source_sha, 'sourceBytes': source.stat().st_size,
                'sourceDimensions': [4, 3], 'evidenceFile': evidence.name, 'evidenceSha256': evidence_sha,
                'projectFile': project_path.name, 'projectSha256': p.digest_file(project_path),
            })
            self.catalogue['items'].append({
                'id': item_id, 'download': {'url': BASE + f'raw/{native_sha}.tif', 'sha256': native_sha, 'bytes': 123},
                'bounds': [1, 2, 3, 4], 'assets': [{'url': BASE + f'tiles/{native_sha}.pmtiles', 'bounds': [1, 2, 3, 4]}],
                'confidence': 'experimental', 'alignmentReview': {'status': 'limited', 'groundAccuracyCertified': False},
                'fullSheets': [{'label': 'Original page'}],
            })
        self.manifest_path = self.bundle / 'recovery-manifest.json'
        self.save_manifest()
        self.output = self.root / 'stage'

    def save_manifest(self):
        self.manifest_path.write_bytes(p.json_bytes(self.manifest))

    def stage(self):
        return p.stage_manifest(self.manifest_path, self.catalogue, self.output)

    def test_five_registrations_change_only_project_pointers_and_preserve_inputs(self):
        before = copy.deepcopy(self.catalogue)
        manifest_before = self.manifest_path.read_bytes()
        registration = self.stage()
        self.assertEqual(len(registration['registrations']), 5)
        self.assertEqual(len(registration['artifacts']), 15)
        updated = p.register_projects(self.catalogue, registration['registrations'])
        self.assertEqual(self.catalogue, before)
        self.assertEqual(self.manifest_path.read_bytes(), manifest_before)
        for item in updated['items']:
            reference = item.pop('georeferenceProject')
            self.assertEqual(reference['nativeSha256'], item['download']['sha256'])
        self.assertEqual(updated, before)
        preview = p.load_json(self.output / 'catalogue.preview.json')
        self.assertEqual(p.register_projects(preview, registration['registrations']), preview)
        self.assertEqual((self.output.stat().st_mode & 0o777), 0o700)
        self.assertEqual(((self.output / 'registration.json').stat().st_mode & 0o777), 0o600)

    def test_urls_are_rewritten_before_project_hash_without_changing_model_or_controls(self):
        registration = self.stage()
        rewritten = p.load_json(self.output / 'recovery-manifest.json')
        for old_entry, new_entry, entry in zip(self.manifest['projects'], rewritten['projects'], registration['registrations']):
            old = p.load_json(self.bundle / old_entry['projectFile'])
            path = self.output / new_entry['projectFile']
            current = p.load_json(path)
            self.assertEqual(p.digest_file(path), entry['georeferenceProject']['sha256'])
            self.assertNotEqual(new_entry['projectSha256'], old_entry['projectSha256'])
            self.assertEqual(current['source']['url'], BASE + f'raw/{old_entry["sourceSha256"]}.png')
            self.assertEqual(current['recoveredPlacement']['evidence'][0]['url'], BASE + f'reviews/evidence/{old_entry["evidenceSha256"]}.json')
            current['source']['url'] = old['source']['url']
            current['recoveredPlacement']['evidence'][0]['url'] = old['recoveredPlacement']['evidence'][0]['url']
            self.assertEqual(current, old)
        verified, artifacts = p.validate_stage(self.output / 'registration.json')
        self.assertEqual(verified, registration)
        self.assertEqual(len(artifacts), 15)

    def test_missing_stale_duplicate_native_or_changed_pointer_rejected(self):
        registration = self.stage()
        for mutate in (
            lambda c: c['items'][0]['download'].update(sha256='a' * 64),
            lambda c: c['items'].append(copy.deepcopy(c['items'][0])),
            lambda c: c['items'].pop(0),
            lambda c: c['items'][0].update(georeferenceProject={'newer': True}),
        ):
            with self.subTest(mutate=mutate):
                changed = copy.deepcopy(self.catalogue)
                mutate(changed)
                with self.assertRaises(ValueError):
                    p.register_projects(changed, registration['registrations'])
        for mutate in (
            lambda rows: rows.append(copy.deepcopy(rows[0])),
            lambda rows: rows[0]['georeferenceProject'].update(nativeSha256='b' * 64),
            lambda rows: rows[0].pop('expectedPreviousProject'),
            lambda rows: rows[0]['georeferenceProject'].update(geometry={'bounds': [9, 9, 9, 9]}),
        ):
            rows = copy.deepcopy(registration['registrations'])
            mutate(rows)
            with self.assertRaises(ValueError):
                p.register_projects(self.catalogue, rows)

    def test_source_hash_and_pixel_frame_mismatch_rejected(self):
        source = self.bundle / self.manifest['projects'][0]['sourceFile']
        source.write_bytes(source.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'source bytes'):
            self.stage()
        self.assertFalse(self.output.exists())
        self.manifest['projects'][0]['sourceSha256'] = p.digest_file(source)
        self.manifest['projects'][0]['sourceBytes'] = source.stat().st_size
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'different native ID or original source'):
            self.stage()

    def test_manifest_paths_cannot_escape_bundle(self):
        outside = self.root / 'outside.png'
        outside.write_bytes((self.bundle / self.manifest['projects'][0]['sourceFile']).read_bytes())
        self.manifest['projects'][0]['sourceFile'] = '../outside.png'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'outside its private bundle'):
            self.stage()

    def test_modified_or_extra_staged_objects_rejected_before_http(self):
        registration = self.stage()
        (self.output / registration['artifacts'][0]['path']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'staged artifact changed'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=mock.Mock())

    def exercise_publish(self, *, conflict=False, stale=False, changed_pointer=False, invalid_etag=False, corrupt_readback=False, existing=False, wrong_existing=False):
        registration = self.stage()
        state = {'objects': {}, 'getCount': 0, 'puts': [], 'activation': None, 'current': copy.deepcopy(self.catalogue)}
        if existing or wrong_existing:
            for item in registration['artifacts']:
                state['objects'][item['key']] = (self.output / item['path']).read_bytes()
        if wrong_existing:
            state['objects'][registration['artifacts'][0]['key']] = b'wrong bytes'
        if stale:
            state['current']['items'][0]['download']['sha256'] = 'd' * 64

        def handle(request):
            self.assertEqual(request.headers.get('User-Agent'), p.USER_AGENT)
            self.assertNotIn('Referer', request.headers)
            path = request.url.path
            key = path.split('/' + 'x' * 43 + '/', 1)[1]
            if request.method == 'GET' and key == 'catalog.json':
                state['getCount'] += 1
                if state['getCount'] == 2:
                    state['current']['title'] = 'Concurrent unrelated catalogue title'
                    if changed_pointer:
                        state['current']['items'][0]['georeferenceProject'] = {'newer': True}
                if state['activation'] is not None:
                    content = state['activation'] + (b' ' if corrupt_readback else b'')
                else:
                    content = p.json_bytes(state['current'])
                etag = 'W/"weak"' if invalid_etag else '"current-version"'
                return httpx.Response(200, content=content, headers={'ETag': etag})
            if request.method == 'HEAD':
                content = state['activation'] if key == 'catalog.json' else state['objects'].get(key)
                if content is None:
                    return httpx.Response(404)
                return httpx.Response(200, headers={'X-Content-SHA256': hashlib.sha256(content).hexdigest(), 'Content-Length': str(len(content))})
            if request.method == 'PUT':
                self.assertTrue(path.startswith('/__upload/'))
                self.assertEqual(request.headers.get('Authorization'), 'Bearer ' + CONFIG['uploadToken'])
                content = request.read()
                self.assertEqual(request.headers['X-Content-SHA256'], hashlib.sha256(content).hexdigest())
                self.assertEqual(request.headers['Content-Length'], str(len(content)))
                state['puts'].append(key)
                if key == 'catalog.json':
                    self.assertEqual(request.headers.get('If-Match'), '"current-version"')
                    self.assertEqual(len(state['objects']), 15)
                    if conflict:
                        return httpx.Response(412)
                    state['activation'] = content
                else:
                    self.assertNotIn('If-Match', request.headers)
                    state['objects'][key] = content
                return httpx.Response(200, json={'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
            self.fail('Unexpected request')

        client = httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=False, headers={'User-Agent': p.USER_AGENT})
        self.addCleanup(client.close)
        return registration, state, client

    def test_owner_publish_rebases_unrelated_metadata_and_uses_atomic_etag(self):
        registration, state, client = self.exercise_publish()
        result = p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertTrue(result['activated'])
        self.assertEqual(result['uploadedObjects'], 15)
        self.assertEqual(state['puts'][-1], 'catalog.json')
        updated = json.loads(state['activation'])
        self.assertEqual(updated['title'], 'Concurrent unrelated catalogue title')
        for item in updated['items']:
            item.pop('georeferenceProject')
        expected = copy.deepcopy(self.catalogue)
        expected['title'] = updated['title']
        self.assertEqual(updated, expected)

    def test_existing_verified_content_is_not_reuploaded(self):
        _, state, client = self.exercise_publish(existing=True)
        result = p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertEqual(result['uploadedObjects'], 0)
        self.assertEqual(state['puts'], ['catalog.json'])

    def test_stale_native_fails_before_any_upload(self):
        _, state, client = self.exercise_publish(stale=True)
        with self.assertRaisesRegex(ValueError, 'native item changed'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertEqual(state['puts'], [])

    def test_changed_project_pointer_fails_before_activation(self):
        _, state, client = self.exercise_publish(changed_pointer=True)
        with self.assertRaisesRegex(ValueError, 'pointer changed'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertNotIn('catalog.json', state['puts'])

    def test_concurrent_catalogue_change_is_not_retried_unconditionally(self):
        _, state, client = self.exercise_publish(conflict=True)
        with self.assertRaisesRegex(ValueError, 'changed during activation'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertEqual(state['puts'].count('catalog.json'), 1)
        self.assertIsNone(state['activation'])

    def test_missing_strong_etag_prevents_activation(self):
        _, state, client = self.exercise_publish(invalid_etag=True)
        with self.assertRaisesRegex(ValueError, 'strong ETag'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertNotIn('catalog.json', state['puts'])

    def test_existing_content_mismatch_never_overwritten(self):
        _, state, client = self.exercise_publish(wrong_existing=True)
        with self.assertRaisesRegex(RuntimeError, 'refusing to overwrite'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)
        self.assertEqual(state['puts'], [])

    def test_activation_requires_exact_readback_bytes(self):
        _, state, client = self.exercise_publish(corrupt_readback=True)
        with self.assertRaisesRegex(RuntimeError, 'readback differs'):
            p.publish_registration(self.output / 'registration.json', CONFIG, client=client)

    def test_owner_destination_must_equal_staged_collection(self):
        self.stage()
        client = mock.Mock()
        with self.assertRaisesRegex(ValueError, 'different staged collection'):
            p.publish_registration(self.output / 'registration.json', {**CONFIG, 'shareId': 'y' * 43}, client=client)
        client.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
