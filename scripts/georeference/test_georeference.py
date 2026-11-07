"""Synthetic raster integration checks; no private collection data or URLs."""
from pathlib import Path
import argparse
import copy
import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock
import httpx
import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import ColorInterp
from rasterio.transform import from_origin
from rasterio.warp import transform

spec = importlib.util.spec_from_file_location('georeference', Path(__file__).with_name('georeference.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


def project(width=32, height=24, method='affine', source_sha=None, frame='geotiff-pixel-grid'):
    pixels = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]
    def world(p):
        x, y = p
        return [-14000000 + 10 * x + .5 * y, 7000000 + .25 * x - 10 * y]
    return {'schema': g.SCHEMA, 'pixelConvention': g.PIXELS, 'fitCrs': 'EPSG:3857', 'source': {'id': 'synthetic-map', 'url': None, 'sha256': source_sha, 'width': width, 'height': height, 'frame': {'kind': frame, 'description': 'Synthetic native pixels'}}, 'transform': method, 'points': [{'id': str(i), 'pixel': p, 'coordinate': g.geographic(world(p)), 'enabled': True, 'role': 'control'} for i, p in enumerate(pixels)]}


class TestMath(unittest.TestCase):
    def test_similarity_reflects_image_y(self):
        p = project(method='similarity')
        for row in p['points']:
            x, y = row['pixel']
            row['coordinate'] = g.geographic([1000000 + 12 * x + 3 * y, 6000000 + 3 * x - 12 * y])
        fit = g.Fit(p)
        np.testing.assert_allclose(fit.matrix, [[12, 3, 1000000], [3, -12, 6000000]], atol=1e-6)

    def test_check_and_disabled_points_never_fit(self):
        p = project()
        reference = g.Fit(p).matrix
        p['points'] += [{'id': 'check', 'pixel': [8, 7], 'coordinate': [-10, 30], 'role': 'check', 'enabled': True}, {'id': 'off', 'pixel': [10, 10], 'coordinate': [0, 40], 'role': 'control', 'enabled': False}]
        fit = g.Fit(p)
        np.testing.assert_array_equal(reference, fit.matrix)
        self.assertGreater(fit.diagnostics()['checks']['groundRmsM'], 100000)

    def test_duplicate_collinear_and_bad_frame_rejected(self):
        p = project()
        p['points'][1]['pixel'] = p['points'][0]['pixel']
        with self.assertRaises(ValueError):
            g.Fit(p)
        p = project()
        for i, row in enumerate(p['points']):
            row['pixel'] = [i, i]
        with self.assertRaises(ValueError):
            g.Fit(p)
        p = project()
        p['pixelConvention'] = 'preview-pixels'
        with self.assertRaises(ValueError):
            g.Fit(p)


    def test_browser_validation_parity(self):
        p = project()
        p['source']['sha256'] = 'A' * 64
        g.Fit(p)
        self.assertEqual(p['source']['sha256'], 'a' * 64)
        repeated = copy.deepcopy(p['points'][0])
        repeated.update(id='not-independent', role='check')
        p['points'].append(repeated)
        with self.assertRaisesRegex(ValueError, 'independent check'):
            g.Fit(p)
        p = project()
        p['points'][0]['coordinate'][0] = -179
        p['points'][1]['coordinate'][0] = 179
        with self.assertRaisesRegex(ValueError, 'Dateline'):
            g.Fit(p)
        p = project()
        p['points'] *= 26
        with self.assertRaisesRegex(ValueError, '100'):
            g.Fit(p)


    def test_legacy_lineage_requires_explicit_source_hash_and_exact_frame(self):
        identity = synthetic_revision()['sourceIdentity']
        catalog = synthetic_catalog('1' * 64)
        item = catalog['items'][0]
        prior = {'sourceSha256': '0' * 64, 'sourceFrame': copy.deepcopy(identity['frame'])}
        item['georeferenceRevision'] = {'sourceSha256': '2' * 64, 'sourceFrame': {'kind': 'geotiff-pixel-grid', 'description': 'Later distinct pixel grid'}, 'previousPlacement': {'previousRevision': prior, 'replacedNativeSha256': '0' * 64}}
        proof = g.replay_binding(identity, item, 'synthetic-map', '1' * 64)
        self.assertEqual(proof['kind'], 'recorded-legacy-source')
        self.assertEqual(proof['revisionDepth'], 1)
        prior.pop('sourceFrame')
        with self.assertRaisesRegex(ValueError, 'documented'):
            g.replay_binding(identity, item, 'synthetic-map', '1' * 64)
        # A replaced native hash alone is not permission to reinterpret that grid.
        item['georeferenceRevision']['previousPlacement'].pop('previousRevision')
        with self.assertRaisesRegex(ValueError, 'documented'):
            g.replay_binding(identity, item, 'synthetic-map', '1' * 64)
        wrong = copy.deepcopy(identity)
        wrong['id'] = 'different-map'
        with self.assertRaisesRegex(ValueError, 'stable target'):
            g.replay_binding(wrong, item, 'synthetic-map', '1' * 64)

    def test_missing_asset_hash_never_replaces_unrelated_mosaic_component(self):
        for missing in ('absent', None, ''):
            with self.subTest(missing=missing):
                catalog = synthetic_catalog('0' * 64)
                for record in catalog['items']:
                    for asset in record['assets']:
                        if missing == 'absent':
                            asset.pop('sha256', None)
                        else:
                            asset['sha256'] = missing
                for asset in catalog['featured'][0]['assets']:
                    if missing == 'absent':
                        asset.pop('sha256', None)
                    else:
                        asset['sha256'] = missing
                original = copy.deepcopy(catalog)
                changed, stories = g.apply_patch(catalog, synthetic_patch(), 'https://example.invalid/new/')
                self.assertEqual(stories, ['two-panel-story'])
                self.assertNotEqual(changed['featured'][0]['assets'][0]['url'], original['featured'][0]['assets'][0]['url'])
                self.assertEqual(changed['featured'][0]['assets'][1], original['featured'][0]['assets'][1])
                self.assertEqual(changed['featured'][0]['downloads'][1], original['featured'][0]['downloads'][1])
                self.assertEqual(changed['items'][1], original['items'][1])
                self.assertEqual(catalog, original)

    def test_unidentifiable_featured_component_aborts_without_mutating_catalogue(self):
        catalog = synthetic_catalog('0' * 64)
        catalog['items'][0]['assets'][0].pop('sha256')
        catalog['items'][0]['assets'][0].pop('url')
        for asset in catalog['featured'][0]['assets']:
            asset.pop('sha256', None)
        original = copy.deepcopy(catalog)
        with self.assertRaisesRegex(ValueError, 'Cannot identify'):
            g.apply_patch(catalog, synthetic_patch(), 'https://example.invalid/new/')
        self.assertEqual(catalog, original)

    def test_new_owner_warp_invalidates_native_and_story_approval(self):
        catalog = synthetic_catalog('0' * 64)
        old_review = {'status': 'corrected_provisional', 'ground_accuracy_certified': True, 'label': 'Supported provisional'}
        for record in [catalog['items'][0], catalog['featured'][0]]:
            record.update(confidence='provisional', sourceProductClass='supported_provisional_gis', alignmentReview=copy.deepcopy(old_review), caveat='Previously approved placement.')
        original = copy.deepcopy(catalog)
        patch = synthetic_patch()
        patch['revision']['groundAccuracyCertified'] = True
        changed, _ = g.apply_patch(catalog, patch, 'https://example.invalid/new/')
        for record in [changed['items'][0], changed['featured'][0]]:
            self.assertEqual(record['confidence'], 'experimental')
            self.assertEqual(record['sourceProductClass'], 'experimental_georeference')
            self.assertEqual(record['alignmentReview']['reviewStatus'], 'manual_adjustment_unreviewed')
            self.assertFalse(record['alignmentReview']['ground_accuracy_certified'])
            self.assertFalse(record['georeferenceRevision']['groundAccuracyCertified'])
            previous = record['georeferenceRevision']['previousPlacement']
            self.assertEqual(previous['confidence'], 'provisional')
            self.assertEqual(previous['alignmentReview'], old_review)
            self.assertEqual(previous['caveat'], 'Previously approved placement.')
            self.assertNotIn('Previously approved', record['caveat'])
        self.assertEqual(changed['items'][1], original['items'][1])
        self.assertEqual(catalog, original)


class TestRasters(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('PGMAPS_TEST_TMPDIR', '/dev/shm'))
        self.root = Path(self.tmp.name)
        self.source = self.root / 'native;literal $(never-executed).tif'
        data = np.zeros((4, 24, 32), dtype='uint8')
        data[0] = np.arange(32, dtype='uint8')[None, :] * 7
        data[1] = np.arange(24, dtype='uint8')[:, None] * 9
        data[2] = 80
        data[3, 3:21, 4:28] = 255
        with rasterio.open(self.source, 'w', driver='GTiff', width=32, height=24, count=4, dtype='uint8', crs='EPSG:3005', transform=from_origin(1000000, 1000000, 2, 2), photometric='RGB', ALPHA='YES', compress='ZSTD') as d:
            d.write(data)
            d.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
        self.project = project(source_sha=g.sha(self.source))
        self.project_file = self.root / 'project.json'
        g.save(self.project_file, self.project)

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, **kw):
        args = dict(project=str(self.project_file), source=str(self.source), out=str(self.root / 'corrected'), max_source_bytes=10000000, allow_unverified_source=False, dry_run=False, target_crs=None, alpha_band=None, resampling='nearest', resolution=None, max_output_pixels=1000000)
        args.update(kw)
        return argparse.Namespace(**args)

    def test_native_cog_pixel_frame_overrides_old_georeferencing(self):
        g.run_rectify(self.args())
        report = g.load(self.root / 'corrected/result.json')
        with rasterio.open(report['native']['path']) as d:
            self.assertEqual(d.crs.to_epsg(), 3005)
            self.assertEqual(d.count, 4)
            self.assertEqual(d.colorinterp[3], ColorInterp.alpha)
            self.assertEqual(d.tags(ns='IMAGE_STRUCTURE')['LAYOUT'], 'COG')
            alpha = d.read(4)
            self.assertGreater(np.sum(alpha == 0), 0)
            self.assertGreater(np.sum(alpha == 255), 0)
            x, y = d.transform * (d.width / 2, d.height / 2)
            mx, my = transform(d.crs, 'EPSG:3857', [x], [y])
            expected = g.Fit(self.project).forward([15.5, 11.5])
            np.testing.assert_allclose([mx[0], my[0]], expected, atol=15)
        self.assertEqual(g.sha(self.source), self.project['source']['sha256'])
        self.assertFalse((self.root / 'never-executed').exists())

    def test_identity_and_dimension_mismatch_fail_before_warp(self):
        p = copy.deepcopy(self.project)
        p['source']['sha256'] = '0' * 64
        g.save(self.project_file, p)
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            g.run_rectify(self.args())
        p['source']['sha256'] = g.sha(self.source)
        p['source']['width'] = 33
        g.save(self.project_file, p)
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            g.run_rectify(self.args(out=str(self.root / 'other')))

    def test_plain_rgba_image_and_dry_run(self):
        image = self.root / 'plain.png'
        with rasterio.open(self.source) as d:
            Image.fromarray(np.moveaxis(d.read(), 0, -1)).save(image)
        p = copy.deepcopy(self.project)
        p['source'].update(sha256=g.sha(image), frame={'kind': 'original-image', 'description': 'Original RGBA PNG'})
        g.save(self.project_file, p)
        g.run_rectify(self.args(source=str(image), dry_run=True))
        report = g.load(self.root / 'corrected/result.json')
        self.assertTrue(report['dryRun'])
        self.assertNotIn('native', report)
        g.run_rectify(self.args(source=str(image), out=str(self.root / 'plain-output')))
        with rasterio.open(self.root / 'plain-output/corrected.tif') as d:
            self.assertEqual(d.crs.to_epsg(), 3857)
            self.assertEqual(d.colorinterp[-1], ColorInterp.alpha)

    def test_grayscale_nodata_is_expanded_without_losing_mask(self):
        source = self.root / 'gray-nodata.tif'
        data = np.zeros((24, 32), dtype='uint8')
        data[4:20, 5:27] = 90
        with rasterio.open(source, 'w', driver='GTiff', width=32, height=24, count=1, dtype='uint8', crs='EPSG:3005', transform=from_origin(1000000, 1000000, 2, 2), nodata=0) as d:
            d.write(data, 1)
        normalized = self.root / 'gray-rgba.tif'
        g.normalize_rgba(source, normalized)
        with rasterio.open(normalized) as d:
            actual = d.read()
            np.testing.assert_array_equal(actual[0], data)
            np.testing.assert_array_equal(actual[0], actual[1])
            np.testing.assert_array_equal(actual[1], actual[2])
            np.testing.assert_array_equal(actual[3], np.where(data > 0, 255, 0).astype('uint8'))

    def test_tps_matches_gdal_forward_and_true_inverse_with_halfpixel(self):
        p = project(width=100, height=100, method='thin-plate-spline', frame='original-image')
        pixels = [[0, 0], [99, 0], [0, 99], [99, 99], [49, 20], [20, 49], [80, 60], [50, 90]]
        p['points'] = []
        for i, (x, y) in enumerate(pixels):
            # A nonlinear but unfolded warp, substantially away from the affine cases.
            xy = [-14000000 + 20 * x + 70 * mathsin(x, y), 7000000 - 20 * y + 60 * mathcos(x, y)]
            p['points'].append({'id': str(i), 'pixel': [x, y], 'coordinate': g.geographic(xy), 'enabled': True, 'role': 'control'})
        fit = g.Fit(p)
        fit.check_domain()
        rgba = self.root / 'tps-source.tif'
        with rasterio.open(rgba, 'w', driver='GTiff', width=100, height=100, count=4, dtype='uint8', photometric='RGB', ALPHA='YES') as d:
            d.write(np.ones((4, 100, 100), dtype='uint8') * 255)
        vrt = self.root / 'tps.vrt'
        g.source_vrt(vrt, rgba, fit)
        probes = [[20.25, 30.75], [67.3, 80.2], [49.1, 50.6], [90, 10]]
        text = ''.join(f'{x + .5} {y + .5}\n' for x, y in probes)
        output = g.command(['gdaltransform', '-tps', '-s_srs', 'EPSG:3857', '-t_srs', 'EPSG:3857', vrt], text)
        gdal_points = np.array([[float(v) for v in row.split()[:2]] for row in output.splitlines()])
        np.testing.assert_allclose(gdal_points, fit.forward(probes), atol=.0002, rtol=0)
        reverse = g.command(['gdaltransform', '-i', '-tps', '-s_srs', 'EPSG:3857', '-t_srs', 'EPSG:3857', vrt], ''.join(f'{x} {y}\n' for x, y in gdal_points))
        edges = np.array([[float(v) for v in row.split()[:2]] for row in reverse.splitlines()])
        np.testing.assert_allclose(edges - .5, probes, atol=.0001, rtol=0)

    def test_tps_actual_rgba_cog_preserves_pixels_and_transparency(self):
        p = project(width=100, height=100, method='thin-plate-spline', frame='original-image')
        pixels = [[0, 0], [99, 0], [0, 99], [99, 99], [49, 20], [20, 49], [80, 60], [50, 90]]
        p['points'] = []
        for i, (x, y) in enumerate(pixels):
            xy = [-14000000 + 20 * x + 70 * mathsin(x, y), 7000000 - 20 * y + 60 * mathcos(x, y)]
            p['points'].append({'id': str(i), 'pixel': [x, y], 'coordinate': g.geographic(xy), 'enabled': True, 'role': 'control'})
        arr = np.zeros((100, 100, 4), dtype='uint8')
        arr[:, :, 0] = np.arange(100, dtype='uint8')[None, :] * 2
        arr[:, :, 1] = np.arange(100, dtype='uint8')[:, None] * 2
        arr[:, :, 2] = 80
        arr[3:97, 3:97, 3] = 255
        source = self.root / 'nonlinear.png'
        Image.fromarray(arr).save(source)
        p['source']['sha256'] = g.sha(source)
        project_file = self.root / 'nonlinear.json'
        g.save(project_file, p)
        g.run_rectify(self.args(project=str(project_file), source=str(source), out=str(self.root / 'tps-output')))
        fit = g.Fit(p)
        with rasterio.open(self.root / 'tps-output/corrected.tif') as d:
            self.assertEqual(d.colorinterp[3], ColorInterp.alpha)
            self.assertEqual(d.crs.to_epsg(), 3857)
            self.assertGreater(np.sum(d.read(4) == 0), 0)
            for pixel in [[20, 30], [67, 80], [49, 50]]:
                actual = next(d.sample([fit.forward(pixel)]))
                np.testing.assert_allclose(actual[:3], [pixel[0] * 2, pixel[1] * 2, 80], atol=5)
                self.assertEqual(actual[3], 255)

    def test_browser_fixtures_match_python_and_native_gdal(self):
        fixtures = g.load(Path(__file__).with_name('fixtures.json'))['fixtures']
        for fixture in fixtures:
            with self.subTest(transform=fixture['name']):
                fit = g.Fit(fixture['project'])
                fit.check_domain()
                source = fixture['project']['source']
                rgba = self.root / (fixture['name'] + '.tif')
                with rasterio.open(rgba, 'w', driver='GTiff', width=source['width'], height=source['height'], count=4, dtype='uint8') as d:
                    d.write(np.zeros((4, 1, 1), dtype='uint8'), window=rasterio.windows.Window(0, 0, 1, 1))
                vrt = self.root / (fixture['name'] + '.vrt')
                g.source_vrt(vrt, rgba, fit)
                probes = np.array([p['pixel'] for p in fixture['probes']])
                expected = np.array([p['projected'] for p in fixture['probes']])
                np.testing.assert_allclose(fit.forward(probes), expected, atol=.0001, rtol=0)
                options = ['-tps'] if fixture['name'] == 'thin-plate-spline' else []
                input_text = ''.join(f'{x + .5} {y + .5}\n' for x, y in probes)
                output = g.command(['gdaltransform', *options, '-s_srs', 'EPSG:3857', '-t_srs', 'EPSG:3857', vrt], input_text)
                actual = np.array([[float(v) for v in row.split()[:2]] for row in output.splitlines()])
                np.testing.assert_allclose(actual, expected, atol=.0002, rtol=0)
                inverse = g.command(['gdaltransform', '-i', *options, '-s_srs', 'EPSG:3857', '-t_srs', 'EPSG:3857', vrt], ''.join(f'{x} {y}\n' for x, y in expected))
                actual_inverse = np.array([[float(v) for v in row.split()[:2]] for row in inverse.splitlines()]) - .5
                np.testing.assert_allclose(actual_inverse, probes, atol=.0001, rtol=0)

    def test_owner_activation_rebases_and_uses_quoted_etag(self):
        self.exercise_publish(conflict=False)

    def test_owner_activation_conflict_preserves_catalogue(self):
        self.exercise_publish(conflict=True)

    def exercise_publish(self, conflict):
        catalog = synthetic_catalog('0' * 64)
        state = {'body': json.dumps(catalog).encode(), 'gets': 0, 'assets': {}, 'ifMatch': None, 'queries': []}
        artifacts = {}
        for name, prefix, suffix in [('native', 'raw', '.tif'), ('tiles', 'tiles', '.pmtiles'), ('thumbnail', 'previews', '.webp')]:
            f = self.root / (name + suffix)
            f.write_bytes(('synthetic ' + name).encode())
            artifacts[name] = {'path': str(f), 'sha256': g.sha(f), 'bytes': f.stat().st_size, 'mime': 'application/octet-stream', 'key': f'{prefix}/{g.sha(f)}{suffix}'}
        patch = {'schema': 'pgmaps-georeference-catalogue-patch-v1', 'id': 'synthetic-map', 'expectedNativeSha256': '0' * 64, 'artifacts': artifacts, 'geometry': {'bounds': [-126, 53, -125, 54], 'tileCount': 1}, 'revision': synthetic_revision()}
        patch_path = self.root / 'patch.json'
        g.save(patch_path, patch)
        def handle(request):
            path = request.url.path
            if request.method == 'GET':
                state['gets'] += 1
                state['queries'].append(str(request.url.query))
                if state['gets'] == 2:
                    # An unrelated owner edit arrived after the first preflight read.
                    current = json.loads(state['body'])
                    current['items'].append({'id': 'new-unrelated', 'download': {'sha256': 'd' * 64, 'bytes': 300}, 'assets': []})
                    state['body'] = json.dumps(current).encode()
                return httpx.Response(200, content=state['body'], headers={'ETag': '"fresh-two"' if state['gets'] >= 2 else '"first-one"'})
            if request.method == 'HEAD':
                key = path.split('/', 3)[-1]
                return httpx.Response(200, headers={'X-Content-SHA256': state['assets'].get(key, g.hashlib.sha256(state['body']).hexdigest())})
            key = path.split('/', 3)[-1]
            body = request.read()
            if key == 'catalog.json':
                state['ifMatch'] = request.headers.get('If-Match')
                if conflict:
                    return httpx.Response(412, text='Catalogue changed')
                self.assertEqual(state['ifMatch'], '"fresh-two"')
                state['body'] = body
            else:
                state['assets'][key] = request.headers['X-Content-SHA256']
            return httpx.Response(200, json={'sha256': g.hashlib.sha256(body).hexdigest(), 'bytes': len(body)})
        real_client = httpx.Client
        with mock.patch.object(g, 'hidden_config', return_value={'endpoint': 'https://example.invalid', 'shareId': 'x' * 43, 'uploadToken': 'synthetic-test-value'}), mock.patch.object(g.httpx, 'Client', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw)):
            if conflict:
                with self.assertRaises(httpx.HTTPStatusError) as error:
                    g.publish_patch(argparse.Namespace(patch=str(patch_path), apply=True))
                self.assertEqual(error.exception.response.status_code, 412)
                self.assertEqual(json.loads(state['body'])['items'][0]['download']['sha256'], '0' * 64)
            else:
                result = g.publish_patch(argparse.Namespace(patch=str(patch_path), apply=True))
                self.assertTrue(result['activated'])
                self.assertEqual(len(json.loads(state['body'])['items']), 3)
        self.assertEqual(len(state['assets']), 3)
        self.assertNotEqual(state['queries'][0], state['queries'][1])

    def test_saved_original_project_can_republish_without_resampling_current_cog(self):
        original_sha = g.sha(self.source)
        original_frame = copy.deepcopy(self.project['source']['frame'])
        g.run_rectify(self.args())
        catalog_path = self.root / 'catalog-first.json'
        g.save(catalog_path, synthetic_catalog(original_sha))
        first_stage = self.root / 'stage-first'
        g.stage_patch(argparse.Namespace(result=str(self.root / 'corrected/result.json'), catalogue=str(catalog_path), id='synthetic-map', expected_native_sha=original_sha, out=str(first_stage)))
        first, _ = g.apply_patch(g.load(catalog_path), g.load(first_stage / 'catalogue-patch.json'), 'https://example.invalid/first/')
        first_sha = first['items'][0]['download']['sha256']
        self.assertNotEqual(first_sha, original_sha)
        self.assertEqual(first['items'][0]['georeferenceRevision']['sourceIdentity']['sha256'], original_sha)
        # Reopen and tweak the saved project. Pixel pairs still address the exact
        # original32x24source, never the differently sampled first corrected COG.
        edited = copy.deepcopy(self.project)
        for point in edited['points']:
            point['coordinate'] = g.geographic(g.projected(point['coordinate']) + [35, -17])
        edited_project = self.root / 'edited.json'
        g.save(edited_project, edited)
        second_output = self.root / 'second-result'
        g.run_rectify(self.args(project=str(edited_project), out=str(second_output)))
        second_result = g.load(second_output / 'result.json')
        self.assertEqual(second_result['sourceSha256'], original_sha)
        first_catalogue = self.root / 'catalog-current.json'
        g.save(first_catalogue, first)
        second_stage = self.root / 'stage-second'
        g.stage_patch(argparse.Namespace(result=str(second_output / 'result.json'), catalogue=str(first_catalogue), id='synthetic-map', expected_native_sha=first_sha, out=str(second_stage)))
        second_patch = g.load(second_stage / 'catalogue-patch.json')
        self.assertEqual(second_patch['revision']['sourceBinding']['kind'], 'recorded-original-source')
        second, _ = g.apply_patch(first, second_patch, 'https://example.invalid/second/')
        self.assertNotEqual(second['items'][0]['download']['sha256'], first_sha)
        identity = second['items'][0]['georeferenceRevision']['sourceIdentity']
        self.assertEqual(identity, first['items'][0]['georeferenceRevision']['sourceIdentity'])
        self.assertEqual(identity['frame'], original_frame)
        self.assertEqual(identity['width'], 32)
        self.assertEqual(g.sha(self.source), original_sha)
        self.assertEqual(second['items'][1], first['items'][1])
        # A stale initial current-SHA cannot be published over the second revision.
        with self.assertRaisesRegex(ValueError, 'changed'):
            g.apply_patch(second, second_patch, 'https://example.invalid/stale/')
        # Full hash, frame, dimensions and stable ID are required for repeat staging.
        variants = []
        bad = copy.deepcopy(second_result);bad['sourceSha256'] = 'f' * 64;variants.append(bad)
        bad = copy.deepcopy(second_result);bad['sourceFrame']['description'] = 'Another frame';variants.append(bad)
        bad = copy.deepcopy(second_result);bad['sourceInspection']['width'] += 1;variants.append(bad)
        bad = copy.deepcopy(second_result);bad['sourceId'] = 'different-map';variants.append(bad)
        bad = copy.deepcopy(second_result);bad['sourceFrame']['kind'] = 'original-image';variants.append(bad)
        for i, bad in enumerate(variants):
            bad_path = self.root / f'bad-result-{i}.json'
            g.save(bad_path, bad)
            with self.subTest(variant=i), self.assertRaises(ValueError):
                g.stage_patch(argparse.Namespace(result=str(bad_path), catalogue=str(first_catalogue), id='synthetic-map', expected_native_sha=first_sha, out=str(self.root / f'bad-stage-{i}')))

    def test_stage_tiles_rgba_and_featured_alias_patch(self):
        g.run_rectify(self.args())
        catalog = synthetic_catalog(g.sha(self.source))
        catalog_path = self.root / 'catalog.json'
        g.save(catalog_path, catalog)
        args = argparse.Namespace(result=str(self.root / 'corrected/result.json'), catalogue=str(catalog_path), id='synthetic-map', expected_native_sha=g.sha(self.source), out=str(self.root / 'stage'))
        g.stage_patch(args)
        patch = g.load(self.root / 'stage/catalogue-patch.json')
        updated, names = g.apply_patch(catalog, patch, 'https://example.invalid/private/')
        self.assertEqual(names, ['two-panel-story'])
        self.assertEqual(updated['items'][1], catalog['items'][1])
        self.assertEqual(updated['featured'][0]['downloads'][1], catalog['featured'][0]['downloads'][1])
        self.assertEqual(updated['featured'][0]['assets'][1], catalog['featured'][0]['assets'][1])
        self.assertEqual(updated['items'][0]['id'], 'synthetic-map')
        self.assertEqual(updated['featured'][0]['alignmentReview']['status'], 'needs_review')
        self.assertEqual(len(updated['items']), 2)
        self.assertGreater(patch['geometry']['tileCount'], 0)
        updated['items'][0]['download']['sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'changed'):
            g.apply_patch(updated, patch, 'https://example.invalid/private/')


def mathsin(x, y):
    return np.sin(x / 40) * np.sin(y / 45)


def mathcos(x, y):
    return np.cos(x / 35) * np.sin(y / 45)


def synthetic_revision():
    frame = {'kind': 'geotiff-pixel-grid', 'description': 'Synthetic native pixels'}
    return {
        'sourceId': 'synthetic-map',
        'sourceSha256': '0' * 64,
        'sourceFrame': frame,
        'sourceIdentity': {'id': 'synthetic-map', 'sha256': '0' * 64, 'width': 32, 'height': 24, 'frame': copy.deepcopy(frame)},
        'transform': 'affine',
        'groundAccuracyCertified': False,
    }


def synthetic_patch():
    return {
        'id': 'synthetic-map',
        'expectedNativeSha256': '0' * 64,
        'artifacts': {
            'native': {'key': 'raw/new.tif', 'sha256': '1' * 64, 'bytes': 300},
            'tiles': {'key': 'tiles/new.pmtiles', 'sha256': '2' * 64, 'bytes': 400},
            'thumbnail': {'key': 'previews/new.webp', 'sha256': '3' * 64, 'bytes': 500},
        },
        'geometry': {'bounds': [-126, 53, -125, 54], 'tileCount': 1},
        'revision': synthetic_revision(),
    }


def synthetic_catalog(old_sha):
    asset = {'sha256': 'a' * 64, 'url': 'https://example.invalid/old.pmtiles', 'bytes': 10, 'bounds': [-127, 53, -126, 54]}
    other = {'sha256': 'b' * 64, 'url': 'https://example.invalid/other.pmtiles', 'bytes': 20, 'bounds': [-124, 54, -123, 55]}
    raw = {'sha256': old_sha, 'bytes': 100, 'url': 'https://example.invalid/old.tif'}
    other_raw = {'sha256': 'c' * 64, 'bytes': 200, 'url': 'https://example.invalid/other.tif'}
    return {'items': [{'id': 'synthetic-map', 'title': 'Synthetic', 'assets': [asset], 'download': raw, 'bounds': asset['bounds'], 'thumbnail': 'old.webp', 'caveat': 'Provisional'}, {'id': 'untouched', 'assets': [other], 'download': other_raw}], 'featured': [{'id': 'two-panel-story', 'assets': [copy.deepcopy(asset), copy.deepcopy(other)], 'downloads': [copy.deepcopy(raw), copy.deepcopy(other_raw)], 'thumbnail': 'old.webp', 'alignmentReview': {'status': 'partial_agreement'}}]}


if __name__ == '__main__':
    unittest.main()
