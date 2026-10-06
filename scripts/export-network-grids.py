"""Save lossless XYZ pixel grids as run-length RGBA tiles, independently round-trip every tile."""
import argparse, concurrent.futures, gzip, hashlib, io, json, struct, time, zipfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from PIL import Image

# Header: magic(8), width/height(u16), zoom/cellPixels(u8), reserved(u16), x/y/runCount(u32).
HEADER = struct.Struct('<8sHHBBHIII')
MAGIC = b'PGGRID1\0'
DTYPE = np.dtype([('length','<u4'),('rgba','u1',(4,))])

def encode_grid(rgba, width, height, z, x, y):
    if not (0 < width <= 256 and 0 < height <= 256) or len(rgba) != width*height*4:
        raise ValueError('Expected a complete RGBA tile no larger than 256x256')
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise ValueError('Invalid XYZ tile coordinates')
    pixels = np.frombuffer(rgba, dtype='u1').reshape(-1,4)
    starts = np.concatenate(([0], np.flatnonzero(np.any(pixels[1:] != pixels[:-1], axis=1)) + 1))
    records = np.empty(len(starts), dtype=DTYPE)
    records['length'] = np.diff(np.append(starts, len(pixels)))
    records['rgba'] = pixels[starts]
    return HEADER.pack(MAGIC,width,height,z,1,0,x,y,len(starts)) + records.tobytes()

def decode_grid(compressed):
    raw = gzip.decompress(compressed)
    if len(raw) < HEADER.size:
        raise ValueError('Truncated grid header')
    magic,width,height,z,cell,reserved,x,y,count = HEADER.unpack_from(raw)
    if magic != MAGIC or cell != 1 or reserved or len(raw) != HEADER.size + count * DTYPE.itemsize:
        raise ValueError('Invalid grid header')
    if not (0 < width <= 256 and 0 < height <= 256 and 0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z and 0 < count <= width*height):
        raise ValueError('Invalid grid dimensions or coordinates')
    records = np.frombuffer(raw, dtype=DTYPE, offset=HEADER.size)
    if np.any(records['length']==0) or int(np.sum(records['length'],dtype=np.uint64)) != width*height:
        raise ValueError('Invalid run lengths')
    rgba = np.repeat(records['rgba'],records['length'].astype(np.int64),axis=0).tobytes()
    return rgba,(width,height,z,x,y)

README = '''PGGRID1 lossless pixel grid, version 1\n\nEach .grid.gz member is gzip-compressed. Decompressed header is little-endian:\n8 bytes magic PGGRID1\\0; u16 width; u16 height; u8 XYZ zoom; u8 cellPixels=1;\nu16 reserved=0; u32 tile X; u32 tile Y; u32 run count. Header length: 28 bytes.\nEach run is u32 positive length followed by four u8 unpremultiplied RGBA values.\nRuns enumerate every original cell in row-major order, including transparent cells.\nThe sum of run lengths equals width*height. Runs compress storage only: cells\nremain individual pixel boxes when rendered. No cells are dissolved into polygons.\nGrid coordinates follow XYZ/Web Mercator. Cell (column,row) at source tile (z,x,y)\nhas normalized west=(x+column/width)/2^z, east=(x+(column+1)/width)/2^z,\nnorth=(y+row/height)/2^z, south=(y+(row+1)/height)/2^z.\nPreserves all four channels exactly; labels can be inferred from the original\npalette when loaded. This is a measured saved format prototype; the current app\nstill loads PNG sources and is not yet wired to read these grid files.\n'''

def write_member(target, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980,1,1,0,0,0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o100644 << 16
    target.writestr(info, data)

def export_provider(inputs):
    provider, archives, oracles, output = inputs
    start = time.monotonic()
    with (oracles / (provider + '-oracle.ndjson')).open() as oracle:
        rows = [json.loads(line) for line in oracle]
    result = dict(provider=provider, tiles=0, pixels=0, sourcePngBytes=0, rawGridBytes=0, savedGridBytes=0, runs=0, changedTiles=0, groups=[])
    if not rows:raise ValueError('No source tiles in oracle')
    groups={}
    dest=output/(provider+'-pixel-grid.zip')
    with zipfile.ZipFile(archives/(provider+'-output.zip')) as source, zipfile.ZipFile(str(dest)+'.part','w',compression=zipfile.ZIP_STORED,allowZip64=True) as target:
        write_member(target,'FORMAT.txt',README)
        for row in rows:
            original=source.read(row['archiveEntry'])
            if hashlib.sha256(original).hexdigest()!=row['pngSha256']:raise ValueError('Source PNG changed')
            with Image.open(io.BytesIO(original)) as image:rgba=image.convert('RGBA').tobytes();width,height=image.size
            if (width,height)!=(row['width'],row['height']) or (width,height)!=(256,256):raise ValueError('Expected original 256x256 source tile')
            raw=encode_grid(rgba,width,height,row['z'],row['x'],row['y'])
            saved=gzip.compress(raw,compresslevel=6,mtime=0)
            restored,coords=decode_grid(saved)
            if coords!=(width,height,row['z'],row['x'],row['y']) or hashlib.sha256(restored).hexdigest()!=row['rgbaSha256']:
                raise ValueError('Grid round-trip differs from independent source oracle')
            member=f"tiles/{row['layer']}/{row['z']}/{row['x']}/{row['y']}.grid.gz"
            write_member(target,member,saved)
            key=(row['layer'],row['z'])
            group=groups.setdefault(key,dict(layer=row['layer'],zoom=row['z'],tiles=0,pixels=0,sourcePngBytes=0,rawGridBytes=0,savedGridBytes=0,runs=0,changedTiles=0))
            for r in (group,result):
                r['tiles']+=1;r['pixels']+=width*height;r['sourcePngBytes']+=len(original);r['rawGridBytes']+=len(raw);r['savedGridBytes']+=len(saved);r['runs']+=(len(raw)-HEADER.size)//DTYPE.itemsize
            if result['tiles']%10000==0:print(provider,result['tiles'],'saved and independently verified',round(time.monotonic()-start,1),'seconds',flush=True)
        result['groups']=list(groups.values())
        manifest={'format':'pgmaps-rgba-pixel-grid-v1','provider':provider,'cellPixels':1,'compression':'gzip','headerBytes':HEADER.size,'runBytes':DTYPE.itemsize,'lossless':True,'tileCount':result['tiles'],'levels':result['groups']}
        write_member(target,'manifest.json',json.dumps(manifest,indent=2))
    Path(str(dest)+'.part').replace(dest)
    result['packageBytes']=dest.stat().st_size;result['packagePath']=str(dest);result['seconds']=time.monotonic()-start
    (output/(provider+'-size.json')).write_text(json.dumps(result,indent=2))
    print(provider,'complete',json.dumps({k:v for k,v in result.items() if k!='groups'}),flush=True)
    return result

def native_sizes(archives):
    """Measure unchanged native payloads from the actual source ZIP entries."""
    sizes = {}
    for provider, suffix, key in [
        ('telus', '.mvt', 'telusMvtBytes'),
        ('crtc-network-availability', '.geojson.gz', 'crtcGeoJsonGzipBytes'),
    ]:
        with zipfile.ZipFile(archives / (provider + '-output.zip')) as source:
            entries = [i for i in source.infolist() if not i.is_dir()
                       and i.filename.endswith(suffix)
                       and not Path(i.filename).name.startswith('._')]
            if not entries:
                raise ValueError('No native data in ' + provider + ' archive')
            sizes[key] = sum(i.file_size for i in entries)
    return sizes


def package_native_sources(archives, output):
    """Package the native payloads, compressing raw MVT and retaining gzip GeoJSON."""
    packages = []
    for provider, suffix, compression in [
        ('telus', '.mvt', zipfile.ZIP_DEFLATED),
        ('crtc-network-availability', '.geojson.gz', zipfile.ZIP_STORED),
    ]:
        destination = output / (provider + '-native.zip')
        temporary = Path(str(destination) + '.part')
        files = 0
        source_bytes = 0
        with zipfile.ZipFile(archives / (provider + '-output.zip')) as source, zipfile.ZipFile(temporary, 'w') as target:
            for entry in sorted(source.infolist(), key=lambda i: i.filename):
                if entry.is_dir() or not entry.filename.endswith(suffix) or Path(entry.filename).name.startswith('._'):
                    continue
                data = source.read(entry)
                info = zipfile.ZipInfo(entry.filename.split('/', 1)[1], date_time=(1980,1,1,0,0,0))
                info.compress_type = compression
                info.external_attr = 0o100644 << 16
                target.writestr(info, data, compresslevel=9)
                source_bytes += len(data)
                files += 1
        if not files:
            raise ValueError('No native payloads in ' + provider)
        with zipfile.ZipFile(temporary) as saved, zipfile.ZipFile(archives / (provider + '-output.zip')) as source:
            if saved.testzip() is not None:
                raise ValueError('Corrupt native download package')
            for entry in saved.infolist():
                if saved.read(entry) != source.read(provider + '-output/' + entry.filename):
                    raise ValueError('Native geometry bytes changed during packaging')
        temporary.replace(destination)
        packages.append({'provider': provider, 'files': files, 'sourceBytes': source_bytes,
                         'packageBytes': destination.stat().st_size, 'packagePath': str(destination),
                         'compression': 'deflate-9' if compression == zipfile.ZIP_DEFLATED else 'stored-gzip-members',
                         'sourceBytesVerified': True})
    return packages


def verify_and_report(output, report):
    """Verify every saved ZIP entry, measure file bytes and write JSON/Markdown."""
    for provider in report['providers']:
        package = output / (provider['provider'] + '-pixel-grid.zip')
        with zipfile.ZipFile(package) as saved:
            if saved.testzip() is not None:
                raise ValueError('Corrupt saved grid package')
            tiles = [i for i in saved.infolist() if i.filename.endswith('.grid.gz')]
            if (len(tiles) != provider['tiles'] or
                    sum(i.file_size for i in tiles) != provider['savedGridBytes']):
                raise ValueError('Saved tile count/size differs from export')
        sha = hashlib.sha256()
        with package.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                sha.update(chunk)
        if provider.get('packageSha256') and provider['packageSha256'] != sha.hexdigest():
            raise ValueError('Saved grid package differs from its recorded SHA-256')
        provider.update(packagePath=str(package), packageBytes=package.stat().st_size,
                        packageSha256=sha.hexdigest(), packageCrcVerified=True)
    for native_package in report.get('nativeCompressedPackages', []):
        package = output / (native_package['provider'] + '-native.zip')
        with zipfile.ZipFile(package) as saved:
            if (saved.testzip() is not None or len(saved.infolist()) != native_package['files']
                    or sum(i.file_size for i in saved.infolist()) != native_package['sourceBytes']):
                raise ValueError('Native download package failed verification')
        sha = hashlib.sha256()
        with package.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                sha.update(chunk)
        if native_package.get('packageSha256') and native_package['packageSha256'] != sha.hexdigest():
            raise ValueError('Native package differs from its recorded SHA-256')
        native_package.update(packageBytes=package.stat().st_size, packagePath=str(package),
                              packageSha256=sha.hexdigest(), packageCrcVerified=True)
    for field in ['savedGridBytes', 'packageBytes', 'sourcePngBytes', 'changedTiles']:
        report[field] = sum(p[field] for p in report['providers'])
    if report['changedTiles']:
        raise ValueError('Export contains changed tiles')
    native = report['nativeUnchanged']
    report['sourceRenderingBytes'] = report['sourcePngBytes'] + sum(native.values())
    report['totalGridAndNativeBytes'] = report['savedGridBytes'] + sum(native.values())
    report['totalPackagesAndNativeBytes'] = report['packageBytes'] + sum(native.values())
    if report.get('nativeCompressedPackages'):
        report['totalCompressedDownloadBytes'] = report['packageBytes'] + sum(p['packageBytes'] for p in report['nativeCompressedPackages'])
    report['totalReductionPercent'] = 100 * (1 - report['totalGridAndNativeBytes'] / report['sourceRenderingBytes'])
    rows = [(p['provider'].title(), p['sourcePngBytes'], p['savedGridBytes']) for p in report['providers']]
    rows += [('TELUS (native MVT)', native['telusMvtBytes'], native['telusMvtBytes']),
             ('CRTC (native compressed GeoJSON)', native['crtcGeoJsonGzipBytes'], native['crtcGeoJsonGzipBytes'])]
    lines = ['# Measured saved pixel-grid sizes', '',
             'Compact lossless XYZ pixel grids, RGBA run-length storage, gzip level 6.',
             'Cell positions follow the original XYZ grid. Every original colour/alpha byte is retained.',
             'This is a saved-format prototype; the current app still reads PNG sources.', '',
             'Sizes use decimal MB and logical file bytes. Grid sizes sum the actual `.grid.gz` files.',
             'TELUS and CRTC retain native geometry. ZIP packages store the already-compressed tiles',
             'without a second compression layer; file indexes account for the larger package sizes.', '',
             '| Source | Source files | Gzip grid/native files |', '| --- | ---: | ---: |']
    lines += [f'| {label} | {before / 1e6:.1f} MB | {after / 1e6:.1f} MB |' for label, before, after in rows]
    lines += [f'| **Total** | **{report["sourceRenderingBytes"] / 1e6:.1f} MB** | **{report["totalGridAndNativeBytes"] / 1e6:.1f} MB** |', '',
              f'Total reduction: {report["totalReductionPercent"]:.1f}%. Every source tile was decoded after grid encoding and compared with its independent source RGBA hash.', '',
              '## Download packages', '']
    lines += [f'- {p["provider"].title()}: **{p["packageBytes"] / 1e6:.1f} MB**, {p["tiles"]:,} tiles, SHA-256 `{p["packageSha256"]}`.' for p in report['providers']]
    lines += ['', f'Packages plus unchanged native data: **{report["totalPackagesAndNativeBytes"] / 1e6:.1f} MB**.',
              'All ZIP entries passed CRC verification.', '',
              'Reproduce with `scripts/export-network-grids.py`. It writes `FORMAT.txt`, provider ZIPs,',
              'per-provider/per-level results, `saved-grid-size.json` and this report.', '']
    if report.get('nativeCompressedPackages'):
        lines += ['## Complete compressed downloads', '', '| Package | Compressed download |', '| --- | ---: |']
        lines += [f'| {p["provider"]} | {p["packageBytes"] / 1e6:.1f} MB |' for p in report['providers'] + report['nativeCompressedPackages']]
        lines += [f'| **Total** | **{report["totalCompressedDownloadBytes"] / 1e6:.1f} MB** |', '',
                  'TELUS MVT is ZIP-deflated at level 9. CRTC retains its existing gzip compression.',
                  'Every native package entry was compared byte-for-byte with its source.', '']
    (output / 'FORMAT.txt').write_text(README)
    (output / 'saved-grid-size.json').write_text(json.dumps(report, indent=2) + '\n')
    (output / 'SIZE-REPORT.md').write_text('\n'.join(lines))
    print(json.dumps({k: v for k, v in report.items() if k != 'providers'}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archives', type=Path, help='Folder containing the four source output ZIPs')
    parser.add_argument('--oracles', type=Path, help='Independent hashes from network-pixel-oracle.py')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=2, choices=(1, 2))
    parser.add_argument('--verify-only', action='store_true', help='Recheck an existing export and regenerate its size report')
    parser.add_argument('--package-native', action='store_true', help='Also create compressed TELUS/CRTC downloads from --archives')
    args = parser.parse_args()
    if args.verify_only:
        report = json.loads((args.output / 'saved-grid-size.json').read_text())
    else:
        if args.archives is None or args.oracles is None:
            parser.error('Export requires --archives and --oracles')
        native = native_sizes(args.archives)
        args.output.mkdir(parents=True, exist_ok=True)
        inputs = [(p, args.archives, args.oracles, args.output) for p in ['bell', 'rogers']]
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
            providers = list(pool.map(export_provider, inputs))
        report = {'format': 'pgmaps-rgba-pixel-grid-v1',
                  'formatStatus': 'Measured saved-format prototype; app currently reads PNG tiles.',
                  'generatedAt': datetime.now(timezone.utc).isoformat(),
                  'providers': providers, 'nativeUnchanged': native}
    if args.package_native:
        if args.archives is None:
            parser.error('--package-native requires --archives')
        report['nativeCompressedPackages'] = package_native_sources(args.archives, args.output)
    verify_and_report(args.output, report)


if __name__ == '__main__':
    main()
