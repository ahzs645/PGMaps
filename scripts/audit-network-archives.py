"""Check every non-PNG archive file and backup; PNG fidelity uses the independent oracle."""
import argparse, collections, gzip, hashlib, io, json, math, tarfile, zipfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archives', type=Path, required=True)
parser.add_argument('--cache-root', type=Path, default=Path('vendor/bcdatamapper/datascrapers/network'))
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
report = {'files': 0, 'mismatches': [], 'jsonErrors': [], 'vectors': [], 'backups': []}

def check_coordinates(coordinates, result):
    if coordinates and isinstance(coordinates[0], (int, float)):
        result['coordinates'] += 1
        if len(coordinates) < 2 or not all(math.isfinite(v) for v in coordinates) or abs(coordinates[0]) > 180 or abs(coordinates[1]) > 90:
            result['badCoordinates'] += 1
    else:
        for child in coordinates:
            check_coordinates(child, result)

def check_geometry(geometry, result):
    if geometry['type'] == 'GeometryCollection':
        for child in geometry['geometries']:
            check_geometry(child, result)
    else:
        check_coordinates(geometry['coordinates'], result)

for provider in ['bell', 'rogers', 'telus', 'crtc-network-availability', 'cell-coverage']:
    with zipfile.ZipFile(args.archives / (provider + '-output.zip')) as archive:
        for entry in archive.infolist():
            if entry.is_dir() or entry.filename.endswith('.png'):
                continue
            name = Path(entry.filename)
            if name.parts[0] != provider + '-output' or '..' in name.parts:
                raise ValueError('Unexpected archive path')
            raw = archive.read(entry)
            target = args.cache_root / provider / 'output' / Path(*name.parts[1:])
            report['files'] += 1
            if not target.exists() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(raw).digest():
                report['mismatches'].append(entry.filename)
            if entry.filename.endswith('.json'):
                try:
                    json.loads(raw)
                except Exception as error:
                    report['jsonErrors'].append({'file': entry.filename, 'error': str(error)})
            elif entry.filename.endswith('.geojson.gz'):
                data = json.loads(gzip.decompress(raw))
                if data['type'] != 'FeatureCollection':
                    raise ValueError('Expected FeatureCollection')
                result = {'provider': provider, 'file': entry.filename, 'features': len(data['features']), 'coordinates': 0, 'badCoordinates': 0,
                          'sourceLevels': dict(collections.Counter(f.get('properties', {}).get('mapZoom') for f in data['features']))}
                for feature in data['features']:
                    if feature.get('geometry'):
                        check_geometry(feature['geometry'], result)
                report['vectors'].append(result)
            elif entry.filename.endswith('.tar.gz'):
                result = {'file': entry.filename, 'readableFiles': 0, 'mvtTiles': 0, 'appleDoubleMetadata': 0, 'tileMismatches': []}
                with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as backup:
                    for member in backup.getmembers():
                        if not member.isfile():
                            continue
                        contents = backup.extractfile(member).read()
                        if len(contents) != member.size:
                            raise ValueError('Incomplete backup member')
                        result['readableFiles'] += 1
                        member_path = Path(member.name)
                        if '..' in member_path.parts or member_path.is_absolute():
                            raise ValueError('Unexpected backup member path')
                        if member_path.name.startswith('._'):
                            result['appleDoubleMetadata'] += 1
                        elif member.name.endswith('.mvt'):
                            result['mvtTiles'] += 1
                            tile_path = args.cache_root / provider / 'output' / member_path
                            if not tile_path.exists() or hashlib.sha256(contents).digest() != hashlib.sha256(tile_path.read_bytes()).digest():
                                result['tileMismatches'].append(member.name)
                report['backups'].append(result)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2))
print(json.dumps({'files': report['files'], 'mismatches': len(report['mismatches']), 'jsonErrors': len(report['jsonErrors']),
                  'vectorFiles': len(report['vectors']), 'badCoordinates': sum(v['badCoordinates'] for v in report['vectors']),
                  'backupTiles': sum(v['mvtTiles'] for v in report['backups']), 'backupTileMismatches': sum(len(v['tileMismatches']) for v in report['backups'])}, indent=2))
if report['mismatches'] or report['jsonErrors'] or any(v['badCoordinates'] for v in report['vectors']) or any(v['tileMismatches'] for v in report['backups']):
    raise SystemExit(1)
