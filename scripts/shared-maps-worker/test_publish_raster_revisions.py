import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import write
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

import publish_raster_revisions as p


class RasterRevisionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.base = 'https://maps.example.invalid/c/' + 'x' * 43 + '/'
        self.transform = from_origin(1031000, 1168600, 200, 200)
        self.rgba = np.full((4, 32, 32), 255, dtype=np.uint8)
        self.rgba[0] = 120
        self.before_ref = self.raster('before.tif', self.rgba)
        mask = np.zeros((32, 32), dtype=np.uint8)
        mask[10:14, 11:15] = 255
        Image.fromarray(mask).save(self.root / 'mask.png')
        corrected = self.rgba.copy()
        corrected[3, mask == 255] = 0
        self.after_ref = self.raster('after.tif', corrected)
        (self.root / 'evidence.json').write_text('{"kind":"synthetic-mask-review"}')
        bounds = list(transform_bounds(3005, 4326, 1031000, 1162200, 1037400, 1168600, densify_pts=41))
        old_tile_metadata = self.prepare_derivatives('before.tif', 'old-tiles.pmtiles', 'old-thumbnail.webp')
        tile_metadata = self.prepare_derivatives('after.tif', 'tiles.pmtiles', 'thumbnail.webp')
        old_download = {**{k: self.before_ref[k] for k in ('sha256', 'bytes')},
                        'url': self.base + 'raw/' + self.before_ref['sha256'] + '.tif',
                        'width': 32, 'height': 32, 'crs': 'EPSG:3005', 'pixelSize': [200.0, 200.0],
                        'role': 'rectified', 'mimeType': 'image/tiff'}
        old_tiles = self.ref('old-tiles.pmtiles')
        asset = {'sha256': old_tiles['sha256'], 'bytes': old_tiles['bytes'],
                 'url': self.base + 'tiles/' + old_tiles['sha256'] + '.pmtiles',
                 'bounds': bounds, **old_tile_metadata}
        common = {'title': 'Synthetic map', 'description': 'Earlier description', 'caveat': 'Experimental',
                  'confidence': 'experimental', 'bounds': bounds, 'assets': [asset],
                  'thumbnail': self.base + 'previews/old.webp',
                  'imageVariants': [{'id': 'original', 'image': {'sha256': 'b' * 64}}],
                  'alignmentReview': {'summary': 'Earlier review', 'ground_accuracy_certified': False}}
        self.before = {'schema': 'raster-catalog-v1', 'items': [dict(copy.deepcopy(common), id='native', download=old_download)],
                       'featured': [dict(copy.deepcopy(common), id='story', downloads=[copy.deepcopy(old_download)])],
                       'storageBytes': old_download['bytes'], 'tileBytes': old_tiles['bytes']}
        self.stage = {
            'schema': 'pgmaps-raster-revision-publication-v1', 'collectionBase': self.base,
            'beforeCatalogue': 'catalogue-before.json', 'afterCatalogue': 'catalogue-after.json',
            'revisions': [{'itemId': 'native', 'kind': 'alpha-mask', 'beforeRaster': self.before_ref,
                           'raster': self.after_ref, 'tiles': self.ref('tiles.pmtiles'),
                           'thumbnail': self.ref('thumbnail.webp'), 'mask': self.ref('mask.png'),
                           'evidence': self.ref('evidence.json'), 'note': 'Synthetic bounded alpha repair.',
                           'tileMetadata': tile_metadata,
                           'records': [{'group': 'items', 'id': 'native'}, {'group': 'featured', 'id': 'story'}]}],
        }
        self.write_stage()

    def ref(self, name):
        path = self.root / name
        return {'path': name, 'sha256': p.digest(path), 'bytes': path.stat().st_size}

    def raster(self, name, values, transform=None):
        with rasterio.open(self.root / name, 'w', driver='GTiff', width=values.shape[2], height=values.shape[1],
                           count=4, dtype='uint8', crs='EPSG:3005', transform=transform or self.transform) as ds:
            ds.write(values)
            ds.colorinterp = tuple(getattr(rasterio.enums.ColorInterp, c) for c in ('red', 'green', 'blue', 'alpha'))
        return self.ref(name)

    def prepare_derivatives(self, raster_name, tiles_name, thumbnail_name):
        geometry = p.build_catalog.create_tiles(self.root / raster_name, self.root / tiles_name, 'Synthetic map')
        p.build_catalog.thumbnail(self.root / raster_name, self.root / thumbnail_name)
        return {key: geometry[key] for key in ('minZoom', 'maxZoom', 'tileCount', 'width', 'format')}

    def repack_tiles(self, source_name, dest_name, change_keys=False):
        with (self.root / source_name).open('rb') as handle:
            source = MmapSource(handle)
            header = Reader(source).header()
            rows = list(all_tiles(source))
        if change_keys:
            # Shift one maximum-zoom tile far outside the actual map. Header
            # bounds, zoom limits, count and encoded image bytes remain valid.
            index = next(i for i, (key, _) in enumerate(rows) if key[0] == header['max_zoom'])
            (z, x, y), data = rows[index]
            rows[index] = ((z, (x + (1 << z) // 2) % (1 << z), y), data)
            rows.sort(key=lambda row: zxy_to_tileid(*row[0]))
        with write(self.root / dest_name) as writer:
            for key, data in rows:
                writer.write_tile(zxy_to_tileid(*key), data)
            writer.finalize(header, {'name': 'Repacked metadata; tile content is not regenerated', 'format': 'webp'})
        return self.ref(dest_name)

    def write_stage(self, after=None):
        if after is None:
            after, _, _ = p.revised_catalogue(self.root, self.stage, self.before)
        for name, value in [('before', self.before), ('after', after)]:
            path = self.root / f'catalogue-{name}.json'
            path.write_text(json.dumps(value))
            self.stage[name + 'Sha256'] = p.digest(path)
        (self.root / 'stage.json').write_text(json.dumps(self.stage))
        self.after = after

    def test_mask_publication_updates_every_alias_and_retains_reading_sources(self):
        _, _, objects = p.validate_stage(self.root / 'stage.json')
        self.assertEqual(len(objects), 3)
        for group in ('items', 'featured'):
            new, old = self.after[group][0], self.before[group][0]
            self.assertEqual(new['imageVariants'], old['imageVariants'])
            self.assertEqual(new['alignmentReview'], old['alignmentReview'])
            self.assertEqual(new['bounds'], old['bounds'])
            self.assertNotEqual(new['thumbnail'], old['thumbnail'])
            self.assertFalse(new['rasterRevision']['groundAccuracyCertified'])
        self.assertEqual(self.after['storageBytes'], self.after_ref['bytes'])

    def test_catalogue_scope_cannot_change_confidence_bounds_or_original(self):
        for field, value in [('confidence', 'verified'), ('bounds', [0, 0, 1, 1]), ('imageVariants', [])]:
            after = copy.deepcopy(self.after)
            after['items'][0][field] = value
            self.write_stage(after)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'beyond the reviewed'):
                p.validate_stage(self.root / 'stage.json')

    def test_omitting_featured_alias_is_rejected(self):
        self.stage['revisions'][0]['records'].pop()
        with self.assertRaisesRegex(ValueError, 'every raster alias'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_rgb_or_outside_alpha_changes_are_rejected(self):
        for channel, y, x in [(0, 11, 12), (3, 1, 1)]:
            values = self.rgba.copy()
            values[3, 10:14, 11:15] = 0
            values[channel, y, x] = 1
            self.stage['revisions'][0]['raster'] = self.raster('after.tif', values)
            with self.subTest(channel=channel), self.assertRaisesRegex(ValueError, 'changed RGB or pixels'):
                p.revised_catalogue(self.root, self.stage, self.before)

    def test_mask_cannot_move_the_map(self):
        moved = self.transform * rasterio.Affine.translation(1, 0)
        self.stage['revisions'][0]['raster'] = self.raster('after.tif', self.rgba, moved)
        with self.assertRaisesRegex(ValueError, 'exact CRS and outer extent'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_prepared_bytes_cannot_change_after_review(self):
        (self.root / 'evidence.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'reviewed input changed'):
            p.validate_stage(self.root / 'stage.json')

    def test_tile_header_must_match_catalogue_metadata(self):
        self.stage['revisions'][0]['tileMetadata']['maxZoom'] += 1
        with self.assertRaisesRegex(ValueError, 'differs from the prepared archive'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_read_only_validation_needs_no_owner_configuration(self):
        self.assertTrue(p.validate_stage(self.root / 'stage.json')[0]['protectedInputs'])

    def test_source_resolution_requires_frozen_inputs_and_exact_grid_subdivision(self):
        revision = self.stage['revisions'][0]
        revision['kind'] = 'source-resolution'
        revision.pop('mask')
        for field in ('sourceImage', 'frozenModel', 'rebuildRecipe'):
            (self.root / f'{field}.json').write_text(json.dumps({'synthetic': field}))
            revision[field] = self.ref(f'{field}.json')
        refined = np.repeat(np.repeat(self.rgba, 2, axis=1), 2, axis=2)
        revision['raster'] = self.raster('after.tif', refined, self.transform * rasterio.Affine.scale(0.5))
        revision['tileMetadata'] = self.prepare_derivatives('after.tif', 'tiles.pmtiles', 'thumbnail.webp')
        revision['tiles'], revision['thumbnail'] = self.ref('tiles.pmtiles'), self.ref('thumbnail.webp')
        self.write_stage()
        p.validate_stage(self.root / 'stage.json')
        self.assertEqual(self.after['items'][0]['download']['width'], 64)
        (self.root / 'frozenModel.json').write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'reviewed input changed'):
            p.validate_stage(self.root / 'stage.json')

    def test_only_exact_reviewed_text_can_change(self):
        self.stage['textUpdates'] = [{'group': 'featured', 'id': 'story', 'field': 'caveat',
                                     'before': 'Experimental', 'after': 'Experimental; finer sampling is not accuracy.'}]
        self.write_stage()
        p.validate_stage(self.root / 'stage.json')
        self.stage['textUpdates'][0]['before'] = 'Stale text'
        with self.assertRaisesRegex(ValueError, 'stale, repeated or unsupported'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_featured_asset_labels_are_preserved(self):
        self.before['featured'][0]['assets'][0]['label'] = 'Curated layer title'
        self.write_stage()
        p.validate_stage(self.root / 'stage.json')
        self.assertEqual(self.after['featured'][0]['assets'][0]['label'], 'Curated layer title')
        self.assertEqual(self.after['featured'][0]['rasterRevision']['previousAsset']['label'], 'Curated layer title')

    def test_conflicting_alias_tile_metadata_is_rejected(self):
        self.before['featured'][0]['assets'][0]['maxZoom'] += 1
        with self.assertRaisesRegex(ValueError, 'conflicting core tile metadata'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_unchanged_tile_archive_is_rejected(self):
        self.stage['revisions'][0]['tiles'] = self.ref('old-tiles.pmtiles')
        with self.assertRaisesRegex(ValueError, 'unchanged tile archive'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_repacked_old_tile_content_is_rejected(self):
        revision = self.stage['revisions'][0]
        revision['tiles'] = self.repack_tiles('old-tiles.pmtiles', 'repacked-old.pmtiles')
        self.assertNotEqual(revision['tiles']['sha256'], self.before['items'][0]['assets'][0]['sha256'])
        with self.assertRaisesRegex(ValueError, 'tile coordinates or bytes differ from the repaired raster'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_old_thumbnail_is_rejected(self):
        self.stage['revisions'][0]['thumbnail'] = self.ref('old-thumbnail.webp')
        with self.assertRaisesRegex(ValueError, 'thumbnail differs from the repaired raster'):
            p.revised_catalogue(self.root, self.stage, self.before)

    def test_archive_metadata_repack_preserves_derivative_correspondence(self):
        revision = self.stage['revisions'][0]
        previous_hash = revision['tiles']['sha256']
        revision['tiles'] = self.repack_tiles('tiles.pmtiles', 'repacked-current.pmtiles')
        self.assertNotEqual(revision['tiles']['sha256'], previous_hash)
        self.write_stage()
        p.validate_stage(self.root / 'stage.json')

    def test_wrong_tile_coordinates_are_rejected_even_with_matching_header(self):
        revision = self.stage['revisions'][0]
        revision['tiles'] = self.repack_tiles('tiles.pmtiles', 'wrong-tile-keys.pmtiles', change_keys=True)
        with self.assertRaisesRegex(ValueError, 'tile coordinates or bytes differ from the repaired raster'):
            p.revised_catalogue(self.root, self.stage, self.before)


if __name__ == '__main__':
    unittest.main()
