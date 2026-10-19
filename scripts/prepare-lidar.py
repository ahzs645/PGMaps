#!/usr/bin/env python3
"""Build the supplied BC LAZ into EPT tiles without checking binary data into Git."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import urllib.request

SOURCE_URL = 'https://drive.usercontent.google.com/download?id=12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI&export=download&confirm=t'
SOURCE_SHA256 = 'f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf'
SOURCE_BYTES = 550_572_701
SOURCE_POINTS = 84_608_005


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def las_count(path):
    with path.open('rb') as stream:
        header = stream.read(375)
    if header[:4] != b'LASF':
        raise ValueError(f'{path.name} is not a LAS/LAZ file')
    legacy_count = struct.unpack_from('<I', header, 107)[0]
    return struct.unpack_from('<Q', header, 247)[0] if header[25] >= 4 else legacy_count


def validate(output):
    ept = json.loads((output / 'ept.json').read_text())
    if ept.get('points') != SOURCE_POINTS or ept.get('dataType') != 'laszip':
        raise ValueError('The EPT index does not describe the complete source cloud')
    if ept.get('srs', {}).get('horizontal') not in (3857, '3857'):
        raise ValueError('Unexpected EPT horizontal coordinate system')
    points = 0
    nodes = 0
    for hierarchy in (output / 'ept-hierarchy').glob('*.json'):
        for key, count in json.loads(hierarchy.read_text()).items():
            if count < 0:
                continue  # Another hierarchy file owns this entry.
            node = output / 'ept-data' / f'{key}.laz'
            if not node.is_file() or node.stat().st_size >= 100_000_000:
                raise ValueError(f'Missing or oversized EPT node: {key}')
            if las_count(node) != count:
                raise ValueError(f'EPT node count mismatch: {key}')
            nodes += 1
            points += count
    if points != SOURCE_POINTS:
        raise ValueError(f'EPT hierarchy contains {points:,} of {SOURCE_POINTS:,} points')
    return nodes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Reuse an already downloaded original LAZ')
    parser.add_argument('--output', type=Path, default=Path('public/data/lidar/bc-093g086'))
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pgmaps-lidar-') as tmp:
        source = args.source
        if not (output / 'ept.json').exists():
            if any(output.iterdir()):
                raise ValueError('Output directory is not empty; choose a fresh output directory')
            if source is None:
                source = Path(tmp) / 'source.laz'
                print('Downloading original LiDAR tile…', flush=True)
                with urllib.request.urlopen(SOURCE_URL, timeout=120) as response, source.open('wb') as target:
                    shutil.copyfileobj(response, target, length=4 * 1024 * 1024)
            if source.stat().st_size != SOURCE_BYTES or checksum(source) != SOURCE_SHA256:
                raise ValueError('Original LAZ size/checksum changed; refusing an unverified dataset')
            if las_count(source) != SOURCE_POINTS:
                raise ValueError('Original LAS header point count changed')
            subprocess.run([
                'entwine', 'build', '-i', str(source.resolve()), '-o', str(output),
                '-r', 'EPSG:3857', '--threads', str(args.threads), '--cacheSize', '32',
                '--noOriginId', '--span', '128', '--progress', '20', '--tmp', str(Path(tmp) / 'entwine'),
            ], check=True)
        nodes = validate(output)
        root = output / 'ept-data/0-0-0-0.laz'
        overview_points = las_count(root)
        if not 0 < overview_points <= 500_000:
            raise ValueError('Root overview exceeds the RustGIS web point budget')
        shutil.copyfile(root, output / 'overview.laz')
        summary = {
            'sourceSha256': SOURCE_SHA256, 'sourceBytes': SOURCE_BYTES,
            'points': SOURCE_POINTS, 'overviewPoints': overview_points, 'nodes': nodes,
            'horizontalCrs': 'EPSG:3857', 'sourceHorizontalCrs': 'EPSG:3157',
            'verticalDatum': 'CGVD2013 (CGG2013)',
            'elevationMetres': [589.95, 864.47],
        }
        (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(f'Verified {SOURCE_POINTS:,} points in {nodes:,} EPT nodes; overview {overview_points:,} points.')


if __name__ == '__main__':
    main()
