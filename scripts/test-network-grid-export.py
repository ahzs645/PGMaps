"""Run with: python scripts/test-network-grid-export.py."""
import gzip
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT = Path(__file__).with_name('export-network-grids.py')
SPEC = importlib.util.spec_from_file_location('network_grid_export', SCRIPT)
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class NetworkGridExportTests(unittest.TestCase):
    def test_every_channel_and_xyz_survive_round_trip(self):
        rgba = bytes([30, 40, 50, 0, 90, 80, 70, 1, 255, 0, 42, 127, 0, 0, 0, 255])
        encoded = EXPORT.encode_grid(rgba, 2, 2, 10, 162, 329)
        restored, coords = EXPORT.decode_grid(gzip.compress(encoded, mtime=0))
        self.assertEqual(restored, rgba)
        self.assertEqual(coords, (2, 2, 10, 162, 329))

    def test_run_can_cross_rows_without_losing_individual_cells(self):
        rgba = bytes([218, 41, 28, 255]) * 12
        encoded = EXPORT.encode_grid(rgba, 4, 3, 4, 3, 5)
        self.assertEqual(EXPORT.HEADER.unpack_from(encoded)[-1], 1)
        self.assertEqual(EXPORT.decode_grid(gzip.compress(encoded))[0], rgba)

    def test_corrupt_or_truncated_runs_are_rejected(self):
        encoded = EXPORT.encode_grid(bytes(16), 2, 2, 4, 3, 5)
        for bad in [encoded[:10], encoded[:-1], encoded + b'x',
                    encoded[:EXPORT.HEADER.size] + bytes(4) + encoded[EXPORT.HEADER.size + 4:]]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                EXPORT.decode_grid(gzip.compress(bad))
        for args in [(bytes(3), 1, 1, 0, 0, 0), (bytes(4), 1, 1, 0, 1, 0)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                EXPORT.encode_grid(*args)

    def test_cli_exports_verifies_measures_and_repeats_deterministically(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives, oracles, output = [root / name for name in ['archives', 'oracles', 'output']]
            archives.mkdir()
            oracles.mkdir()
            rgba = np.arange(256 * 256 * 4, dtype=np.uint32).astype(np.uint8).reshape(256, 256, 4).tobytes()
            encoded_png = io.BytesIO()
            Image.frombytes('RGBA', (256, 256), rgba).save(encoded_png, format='PNG')
            png = encoded_png.getvalue()
            for provider in ['bell', 'rogers']:
                entry = provider + '-output/tiles/lte/4/3/5.png'
                with zipfile.ZipFile(archives / (provider + '-output.zip'), 'w') as source:
                    source.writestr(entry, png)
                row = {'provider': provider, 'layer': 'lte', 'z': 4, 'x': 3, 'y': 5,
                       'archiveEntry': entry, 'pngSha256': hashlib.sha256(png).hexdigest(),
                       'rgbaSha256': hashlib.sha256(rgba).hexdigest(), 'width': 256, 'height': 256}
                (oracles / (provider + '-oracle.ndjson')).write_text(json.dumps(row) + '\n')
            native = {'telus': ('tiles/telus-lte/0/0/0.mvt', b'native-vector-payload' * 100),
                      'crtc-network-availability': ('coverage.geojson.gz', gzip.compress(b'{"type":"FeatureCollection","features":[]}', mtime=0))}
            for provider, (name, data) in native.items():
                with zipfile.ZipFile(archives / (provider + '-output.zip'), 'w') as source:
                    source.writestr(provider + '-output/' + name, data)
            command = [sys.executable, str(SCRIPT), '--archives', str(archives), '--oracles', str(oracles),
                       '--output', str(output), '--workers', '1', '--package-native']
            subprocess.run(command, check=True, capture_output=True)
            report = json.loads((output / 'saved-grid-size.json').read_text())
            self.assertEqual(report['nativeUnchanged']['telusMvtBytes'], len(native['telus'][1]))
            self.assertEqual(report['nativeUnchanged']['crtcGeoJsonGzipBytes'], len(native['crtc-network-availability'][1]))
            self.assertEqual(report['changedTiles'], 0)
            packages = list(output.glob('*.zip'))
            self.assertEqual(len(packages), 4)
            package_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in packages}
            self.assertEqual(report['totalCompressedDownloadBytes'], sum(p.stat().st_size for p in packages))
            for provider in ['bell', 'rogers']:
                with zipfile.ZipFile(output / (provider + '-pixel-grid.zip')) as saved:
                    restored, coords = EXPORT.decode_grid(saved.read('tiles/lte/4/3/5.grid.gz'))
                self.assertEqual(restored, rgba)
                self.assertEqual(coords, (256, 256, 4, 3, 5))
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(package_hashes, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in packages})
            subprocess.run([sys.executable, str(SCRIPT), '--verify-only', '--output', str(output)], check=True, capture_output=True)
            row['pngSha256'] = '0' * 64
            (oracles / 'rogers-oracle.ndjson').write_text(json.dumps(row) + '\n')
            with self.assertRaisesRegex(ValueError, 'Source PNG changed'):
                EXPORT.export_provider(('rogers', archives, oracles, output))
            self.assertEqual(package_hashes['rogers-pixel-grid.zip'], hashlib.sha256((output / 'rogers-pixel-grid.zip').read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
