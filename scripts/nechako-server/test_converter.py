import base64
import importlib.util
import io
import json
import pathlib
import sqlite3
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('converter', pathlib.Path(__file__).with_name('converter.py'))
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


def file(name, content):
    return {'name': name, 'base64': base64.b64encode(content).decode()}


def dataset(kind):
    geometries = {'Point': [-124, 54, 713], 'LineString': [[-125, 54], [-124, 54.5]], 'Polygon': [[[-125, 53], [-124, 53], [-124, 54], [-125, 54], [-125, 53]]]}
    return {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'name': 'Synthetic Nechako test', 'reading': 7.25, 'empty': None}, 'geometry': {'type': kind, 'coordinates': geometries[kind]}}]}


class ConversionTests(unittest.TestCase):
    def test_format_geometry_round_trips(self):
        for kind in ['Point', 'LineString', 'Polygon']:
            for format in ['gpkg', 'sqlite', 'spatialite', 'gml', 'kml', 'kmz', 'shapefile'] + (['gpx'] if kind != 'Polygon' else []):
                with self.subTest(geometry=kind, format=format):
                    output = converter.export_dataset({'format': format, 'data': dataset(kind)})
                    result = converter.convert({'files': [output]})
                    geometries = [item['geometry'] for layer in result['layers'] for item in layer['data']['features'] if item['geometry']]
                    expected = {kind, 'Multi' + kind}
                    self.assertTrue(any(geometry['type'] in expected for geometry in geometries), geometries)
                    self.assertTrue(all(-180 <= coordinate[0] <= 180 and -90 <= coordinate[1] <= 90 for geometry in geometries for coordinate in self.positions(geometry['coordinates'])))

    def positions(self, value):
        if value and isinstance(value[0], (int, float)):
            return [value]
        return [position for child in value for position in self.positions(child)]

    def test_multilayer_geopackage_and_reprojection(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name)
            for index, kind in enumerate(['Point', 'LineString', 'Polygon']):
                source = root / f'{kind}.geojson'
                source.write_text(json.dumps(dataset(kind)))
                converter.run(['ogr2ogr', '-f', 'GPKG', '-t_srs', 'EPSG:3005', *(['-update'] if index else []), str(root / 'mixed.gpkg'), str(source), '-nln', kind])
            result = converter.convert({'files': [file('mixed.gpkg', (root / 'mixed.gpkg').read_bytes())]})
            self.assertEqual(len(result['layers']), 3)
            first = next(layer for layer in result['layers'] if layer['name'].endswith(': Point'))['data']['features'][0]
            self.assertAlmostEqual(first['geometry']['coordinates'][0], -124, places=6)
            self.assertAlmostEqual(first['geometry']['coordinates'][1], 54, places=6)
            self.assertEqual(first['properties']['reading'], 7.25)

    def test_kmz_and_original_archive_inventory(self):
        output = converter.export_dataset({'format': 'kml', 'data': dataset('Point')})
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('doc.kml', base64.b64decode(output['base64']))
            archive.writestr('photos/original.jpg', b'original media retained in uploaded archive')
        result = converter.convert({'files': [file('field.kmz', buffer.getvalue())]})
        self.assertGreater(len(result['layers']), 0)
        self.assertIn('photos/original.jpg', result['archiveEntries'])

    def test_unsafe_paths_entities_and_duplicate_basenames_rejected(self):
        for names in [['../outside.shp'], ['a/points.shp', 'b/points.shp']]:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as archive:
                for name in names:
                    archive.writestr(name, b'bad input')
            with self.assertRaises(ValueError):
                converter.convert({'files': [file('unsafe.zip', buffer.getvalue())]})
        with self.assertRaisesRegex(ValueError, 'entities'):
            converter.convert({'files': [file('unsafe.gml', b'<!DOCTYPE test [<!ENTITY x SYSTEM "file:///etc/passwd">]><test/>')]})

    def test_geopaparazzi_is_inventory_only(self):
        with tempfile.TemporaryDirectory() as name:
            path = pathlib.Path(name) / 'sample.gpap'
            with sqlite3.connect(path) as database:
                database.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, lon REAL, lat REAL, text TEXT)')
                database.execute('INSERT INTO notes VALUES (1, -124, 54, "Synthetic field note")')
            result = converter.convert({'files': [file(path.name, path.read_bytes())]})
            self.assertEqual(result['layers'], [])
            self.assertEqual(result['tables'][0]['rows'], 1)
            self.assertIn('inventory only', result['warnings'][0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
