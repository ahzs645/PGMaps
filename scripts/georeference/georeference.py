#!/usr/bin/env python3
"""Owner-side PGMaps GCP raster workflow. No credentials or collection URLs belong here."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import termios
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

import httpx
import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import ColorInterp

SCHEMA = 'pgmaps-georeference-v1'
PIXELS = 'pixel-centres-x-right-y-down'
RADIUS = 6378137.0
MAX_LAT = 85.0511287798066
SHA = re.compile(r'^[a-f0-9]{64}$')


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def save(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')
    path.chmod(0o600)


def load(path):
    return json.loads(Path(path).read_text())


def projected(coordinate):
    lon, lat = coordinate
    return np.array([RADIUS * math.radians(lon), RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))])


def geographic(xy):
    x, y = xy
    return [math.degrees(x / RADIUS), math.degrees(2 * math.atan(math.exp(y / RADIUS)) - math.pi / 2)]


def haversine(a, b):
    lo1, la1, lo2, la2 = map(math.radians, [*a, *b])
    v = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(v)))


def finite_pair(value, label):
    if not isinstance(value, list) or len(value) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in value):
        raise ValueError(f'{label} must be a finite numeric pair')
    return value


def validate_project(project):
    if project.get('schema') != SCHEMA or project.get('pixelConvention') != PIXELS or project.get('fitCrs') != 'EPSG:3857':
        raise ValueError('Unsupported project schema, pixel convention or fit CRS')
    source = project.get('source', {})
    if not isinstance(source.get('id'), str) or not source['id'].strip() or len(source['id']) > 256:
        raise ValueError('A stable source.id is required')
    for k in ('width', 'height'):
        if isinstance(source.get(k), bool) or not isinstance(source.get(k), int) or not 1 <= source[k] <= 1_000_000:
            raise ValueError(f'source.{k} must be a positive integer')
    if source.get('frame', {}).get('kind') not in ('original-image', 'geotiff-pixel-grid', 'derived-image'):
        raise ValueError('An explicit original-image, geotiff-pixel-grid or derived-image source frame is required')
    for holder in (source, source.get('geotiff', {})):
        value = holder.get('sha256')
        if isinstance(value, str):
            holder['sha256'] = value.lower()
    description = source['frame'].get('description')
    if not isinstance(description, str) or not description.strip() or len(description) > 2000:
        raise ValueError('Source frame description must be nonempty text of at most2000 characters')
    for holder, required_url in ((source, False), (source.get('geotiff', {}), True)):
        if not holder:
            continue
        if 'sha256' not in holder:
            raise ValueError('Source hash must be explicit SHA256 or null')
        value = holder.get('sha256')
        if value is not None and (not isinstance(value, str) or not SHA.fullmatch(value)):
            raise ValueError('Source SHA256 must be hexadecimal or null')
        value = holder.get('url')
        if value is None and not required_url:
            if 'url' not in holder:
                raise ValueError('Source URL must be explicit HTTP(S) or null')
            continue
        if not isinstance(value, str) or not value.strip() or len(value) > 8192:
            raise ValueError('Source URL must be HTTP(S), or null for a local source')
        parsed_url = urlsplit(value)
        if parsed_url.scheme not in ('http', 'https') or not parsed_url.netloc or parsed_url.username or parsed_url.password:
            raise ValueError('Source URL must be absolute HTTP(S) without embedded credentials')
    for holder, field, limit in ((project, 'title', 1000), (project, 'notes', 20000), (source['frame'], 'crs', 1000)):
        if field in holder and (not isinstance(holder[field], str) or len(holder[field]) > limit):
            raise ValueError(f'{field} must be text of at most{limit} characters')
    checksum = source.get('geotiff', {}).get('sha256') if source['frame']['kind'] == 'geotiff-pixel-grid' else source.get('sha256')
    checksum = checksum or source.get('sha256')
    if checksum is not None and not SHA.fullmatch(checksum):
        raise ValueError('Source SHA256 must be lowercase hexadecimal or null')
    points = project.get('points')
    if not isinstance(points, list) or len(points) > 100:
        raise ValueError('points must be an array with at most100 pairs')
    seen = set()
    controls, checks = [], []
    for p in points:
        if not isinstance(p.get('id'), str) or not p['id'].strip() or len(p['id']) > 256 or p['id'] in seen:
            raise ValueError('Point IDs must be nonempty and unique')
        seen.add(p['id'])
        x, y = finite_pair(p.get('pixel'), 'Point pixel')
        lon, lat = finite_pair(p.get('coordinate'), 'Point coordinate')
        if not (-.5 <= x <= source['width'] - .5 and -.5 <= y <= source['height'] - .5):
            raise ValueError(f'Point{p["id"]} is outside the declared native pixel frame')
        if not (-180 <= lon <= 180 and -MAX_LAT <= lat <= MAX_LAT):
            raise ValueError('Coordinates must be longitude/latitude within Web Mercator latitude limits')
        if not isinstance(p.get('enabled'), bool) or p.get('role') not in ('control', 'check'):
            raise ValueError('Every point needs explicit enabled:boolean and role:control|check')
        if p['enabled']:
            (controls if p['role'] == 'control' else checks).append(p)
    method = project.get('transform')
    minimum = {'similarity': 2, 'affine': 3, 'thin-plate-spline': 6}.get(method)
    if minimum is None or len(controls) < minimum:
        raise ValueError('Transform needs at least2 similarity,3 affine or6 thin-plate-spline control pairs')
    active = controls + checks
    for i, a in enumerate(active):
        for b in active[i + 1:]:
            if np.linalg.norm(np.array(a['pixel']) - b['pixel']) <= 1e-7:
                raise ValueError('Enabled points repeat a source pixel; a repeated control is not an independent check')
            if np.linalg.norm(projected(a['coordinate']) - projected(b['coordinate'])) <= 1e-6:
                raise ValueError('Enabled points repeat a target coordinate')
    longitudes = [p['coordinate'][0] for p in controls]
    if max(longitudes) - min(longitudes) > 180:
        raise ValueError('Dateline-crossing controls require a common unwrapped geographic frame')
    for field in ('pixel', 'coordinate'):
        a = np.array([p[field] for p in controls], float)
        if len(np.unique(a, axis=0)) != len(a):
            raise ValueError('Repeated control pixels or target coordinates are not allowed')
        if method != 'similarity' and np.linalg.matrix_rank(a - a.mean(axis=0)) < 2:
            raise ValueError('Collinear control pixels or targets cannot define this transform')
    return controls, checks


class Fit:
    """Same normalized pixel-centre -> EPSG3857 fit as the browser project contract."""
    def __init__(self, project):
        self.project = project
        self.controls, self.checks = validate_project(project)
        self.method = project['transform']
        self.p = np.array([p['pixel'] for p in self.controls], float)
        self.q = np.array([projected(p['coordinate']) for p in self.controls])
        self.pc = self.p.mean(axis=0)
        self.qc = self.q.mean(axis=0)
        self.ps = float(np.sqrt(np.mean(np.sum((self.p - self.pc) ** 2, axis=1))))
        self.qs = float(np.sqrt(np.mean(np.sum((self.q - self.qc) ** 2, axis=1))))
        if min(self.ps, self.qs) <= 1e-9:
            raise ValueError('Degenerate source or target controls')
        p, q = (self.p - self.pc) / self.ps, (self.q - self.qc) / self.qs
        self.matrix = None
        if self.method == 'similarity':
            # Pixel y increases down; north-up similarity is reflected in the pixel frame.
            design = np.zeros((2 * len(p), 4))
            design[0::2] = np.c_[p[:, 0], p[:, 1], np.ones(len(p)), np.zeros(len(p))]
            design[1::2] = np.c_[-p[:, 1], p[:, 0], np.zeros(len(p)), np.ones(len(p))]
            a, b, tx, ty = np.linalg.lstsq(design, q.ravel(), rcond=None)[0]
            linear = np.array([[a, b], [b, -a]]) * self.qs / self.ps
            self.matrix = np.c_[linear, self.qc + self.qs * np.array([tx, ty]) - linear @ self.pc]
        elif self.method == 'affine':
            design = np.c_[p, np.ones(len(p))]
            if np.linalg.cond(design) > 1e10:
                raise ValueError('Ill-conditioned affine controls')
            a = np.linalg.lstsq(design, q, rcond=None)[0].T
            linear = a[:, :2] * self.qs / self.ps
            self.matrix = np.c_[linear, self.qc + self.qs * a[:, 2] - linear @ self.pc]
        else:
            k = self.kernel(p[:, None] - p[None, :])
            design = np.c_[np.ones(len(p)), p]
            block = np.block([[k, design], [design.T, np.zeros((3, 3))]])
            if np.linalg.cond(block) > 1e12:
                raise ValueError('Ill-conditioned thin-plate-spline controls')
            self.coefficients = np.linalg.solve(block, np.r_[q, np.zeros((3, 2))])
        if self.matrix is not None and abs(np.linalg.det(self.matrix[:, :2])) < 1e-12:
            raise ValueError('Singular geographic transform')

    @staticmethod
    def kernel(delta):
        r2 = np.sum(delta * delta, axis=-1)
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.where(r2 > 0, r2 * np.log(np.where(r2 > 0, r2, 1)), 0)

    def forward(self, pixel):
        p = np.asarray(pixel, float)
        scalar = p.ndim == 1
        p = p.reshape(-1, 2)
        if self.matrix is not None:
            result = np.c_[p, np.ones(len(p))] @ self.matrix.T
        else:
            normalized = (p - self.pc) / self.ps
            controls = (self.p - self.pc) / self.ps
            result = (np.c_[self.kernel(normalized[:, None] - controls[None, :]), np.ones(len(p)), normalized] @ self.coefficients) * self.qs + self.qc
        return result[0] if scalar else result

    def diagnostics(self):
        out = {}
        for role, points in [('controls', self.controls), ('checks', self.checks)]:
            rows = []
            for p in points:
                xy = self.forward(p['pixel'])
                target = projected(p['coordinate'])
                rows.append({'id': p['id'], 'projectedResidualM': float(np.linalg.norm(xy - target)), 'groundResidualM': haversine(geographic(xy), p['coordinate'])})
            out[role] = {'count': len(rows), 'points': rows, 'groundRmsM': math.sqrt(sum(r['groundResidualM'] ** 2 for r in rows) / len(rows)) if rows else None}
        out['fitCrs'] = 'EPSG:3857'
        out['groundAccuracyCertified'] = False
        return out

    def check_domain(self):
        s = self.project['source']
        # Validate the entire image, including extrapolation outside the controls.
        p = np.array([(x, y) for x in np.linspace(-.5, s['width'] - .5, 21) for y in np.linspace(-.5, s['height'] - .5, 21)])
        step = max(s['width'], s['height']) * 1e-5
        base = self.forward(p)
        jx = (self.forward(p + [step, 0]) - base) / step
        jy = (self.forward(p + [0, step]) - base) / step
        det = jx[:, 0] * jy[:, 1] - jx[:, 1] * jy[:, 0]
        if np.isfinite(base).all() and np.max(np.abs(base)) > math.pi * RADIUS:
            raise ValueError('Transform extrapolates outside the supported Web Mercator world')
        if not np.isfinite(base).all() or not np.isfinite(det).all() or np.min(np.abs(det)) < 1e-10 or np.any(det > 0) and np.any(det < 0):
            raise ValueError('Transform folds or becomes singular across the source image; revise the control pairs')
        return {'sampleCount': len(p), 'minimumAbsJacobian': float(np.min(np.abs(det))), 'mirrored': bool(np.all(det > 0))}


def command(argv, stdin=None):
    env = {**os.environ, 'GDAL_PAM_ENABLED': 'NO', 'GDAL_CACHEMAX': '128'}
    target_parent = Path(str(argv[-1])).resolve().parent
    if target_parent.is_dir():
        env.update(CPL_TMPDIR=str(target_parent), TMPDIR=str(target_parent))
    result = subprocess.run([str(x) for x in argv], input=stdin, text=True, capture_output=True, env=env)
    if result.returncode:
        # Commands only receive local paths, never upload credentials or collection URLs.
        raise RuntimeError(f'{Path(argv[0]).name} failed: {result.stderr[-1800:]}')
    return result.stdout


def source_inspection(path):
    with rasterio.open(path) as d:
        return {'sha256': sha(path), 'width': d.width, 'height': d.height, 'driver': d.driver, 'crs': d.crs.to_wkt() if d.crs else None, 'transform': list(d.transform)[:6], 'count': d.count, 'dtypes': list(d.dtypes), 'colorInterpretation': [v.name for v in d.colorinterp], 'nodata': d.nodata, 'maskFlags': [[v.name for v in flags] for flags in d.mask_flag_enums]}


def resolve_source(project, override, out, max_bytes, allow_unverified=False):
    source = project['source']
    frame = source['frame']['kind']
    expected = (source.get('geotiff', {}).get('sha256') if frame == 'geotiff-pixel-grid' else None) or source.get('sha256')
    if not expected and not allow_unverified:
        raise ValueError('Project has no source SHA256; inspect the original and bind its hash, or explicitly use --allow-unverified-source')
    if override:
        path = Path(override).resolve(strict=True)
    else:
        url = (source.get('geotiff', {}).get('url') if frame == 'geotiff-pixel-grid' else None) or source.get('url')
        if not isinstance(url, str) or not re.match(r'^https?://', url):
            raise ValueError('Supply --source ORIGINAL_FILE or an HTTP(S) source URL in the project')
        path = out / 'source.bin'
        with httpx.stream('GET', url, follow_redirects=True, timeout=180) as response, path.open('wb') as f:
            response.raise_for_status()
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError('Source exceeds --max-source-bytes')
                f.write(chunk)
    if path.stat().st_size > max_bytes:
        raise ValueError('Source exceeds --max-source-bytes')
    info = source_inspection(path)
    if expected and info['sha256'] != expected:
        raise ValueError('Source SHA256 mismatch; refuse to apply points to another scan or native layer revision')
    if (info['width'], info['height']) != (source['width'], source['height']):
        raise ValueError('Native source dimensions differ from project pixel frame; preview pixels cannot be applied to the original')
    if frame == 'geotiff-pixel-grid' and (info['driver'] != 'GTiff' or not info['crs']):
        raise ValueError('geotiff-pixel-grid requires the actual CRS-bearing native GeoTIFF')
    return path, info


def normalize_rgba(source, dest, alpha_band=None):
    """Stream original pixels and valid-data masks. Never rescale or rotate the pixel frame."""
    with rasterio.open(source) as src:
        if any(v != 'uint8' for v in src.dtypes):
            raise ValueError('Non-byte raster requires an explicitly prepared display stretch; no automatic colour conversion is inferred')
        color = list(src.colorinterp)
        alpha = alpha_band or (color.index(ColorInterp.alpha) + 1 if ColorInterp.alpha in color else None)
        if alpha is not None and not 1 <= alpha <= src.count:
            raise ValueError('Invalid --alpha-band')
        palette = src.count == 1 and color[0] == ColorInterp.palette
        if not palette and src.count not in (1, 2, 3, 4):
            raise ValueError('Expected grayscale, RGB or RGBA source')
        if src.count in (2, 4) and alpha is None:
            raise ValueError('Ambiguous extra band: declare source alpha or explicitly pass --alpha-band')
        rgb_bands = [i for i in range(1, src.count + 1) if i != alpha]
        profile = {'driver': 'GTiff', 'width': src.width, 'height': src.height, 'count': 4, 'dtype': 'uint8', 'tiled': True, 'blockxsize': 512, 'blockysize': 512, 'compress': 'DEFLATE', 'photometric': 'RGB', 'ALPHA': 'YES'}
        if src.crs:
            profile.update(crs=src.crs, transform=src.transform)
        lookup = None
        if palette:
            table = src.colormap(1)
            lookup = np.zeros((256, 4), dtype='uint8')
            for k, value in table.items():
                if 0 <= k < 256:
                    lookup[k] = value
        with rasterio.open(dest, 'w', **profile) as dst:
            dst.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
            for _, window in dst.block_windows(1):
                valid = src.dataset_mask(window=window)
                if palette:
                    expanded = lookup[src.read(1, window=window)]
                    data = np.moveaxis(expanded, -1, 0)
                    data[3] = np.minimum(data[3], valid)
                else:
                    data = np.empty((4, int(window.height), int(window.width)), dtype='uint8')
                    pixels = src.read(rgb_bands, window=window)
                    data[:3] = pixels if len(rgb_bands) == 3 else np.repeat(pixels[:1], 3, axis=0)
                    data[3] = np.minimum(valid, src.read(alpha, window=window)) if alpha else valid
                dst.write(data, window=window)


def source_vrt(path, rgba, fit):
    source = fit.project['source']
    root = ET.Element('VRTDataset', rasterXSize=str(source['width']), rasterYSize=str(source['height']))
    if fit.matrix is not None:
        a = fit.matrix
        ET.SubElement(root, 'SRS').text = 'EPSG:3857'
        gt = [a[0, 2] - .5 * (a[0, 0] + a[0, 1]), a[0, 0], a[0, 1], a[1, 2] - .5 * (a[1, 0] + a[1, 1]), a[1, 0], a[1, 1]]
        ET.SubElement(root, 'GeoTransform').text = ', '.join(format(v, '.17g') for v in gt)
    else:
        gcps = ET.SubElement(root, 'GCPList', Projection=rasterio.crs.CRS.from_epsg(3857).to_wkt())
        for p, q in zip(fit.p, fit.q):
            ET.SubElement(gcps, 'GCP', Pixel=str(p[0] + .5), Line=str(p[1] + .5), X=str(q[0]), Y=str(q[1]), Z='0')
    for i, interpretation in enumerate(('Red', 'Green', 'Blue', 'Alpha'), 1):
        band = ET.SubElement(root, 'VRTRasterBand', dataType='Byte', band=str(i))
        ET.SubElement(band, 'ColorInterp').text = interpretation
        simple = ET.SubElement(band, 'SimpleSource')
        ET.SubElement(simple, 'SourceFilename', relativeToVRT='0').text = str(Path(rgba).resolve())
        ET.SubElement(simple, 'SourceBand').text = str(i)
        for k in ('SrcRect', 'DstRect'):
            ET.SubElement(simple, k, xOff='0', yOff='0', xSize=str(source['width']), ySize=str(source['height']))
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


def run_rectify(args):
    project = load(args.project)
    fit = Fit(project)
    domain = fit.check_domain()
    out = Path(args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError('--out must be a new or empty directory; original products are never overwritten')
    out.mkdir(parents=True, exist_ok=True)
    path, info = resolve_source(project, args.source, out, args.max_source_bytes, args.allow_unverified_source)
    target_crs = args.target_crs or info['crs'] or 'EPSG:3857'
    report = {'schema': 'pgmaps-georeference-result-v1', 'sourceId': project['source']['id'], 'sourceSha256': info['sha256'], 'sourceInspection': info, 'sourceFrame': project['source']['frame'], 'projectSha256': sha(args.project), 'transform': fit.method, 'fitCrs': 'EPSG:3857', 'targetCrs': target_crs, 'diagnostics': fit.diagnostics(), 'domainScreen': domain, 'matrix3857': fit.matrix.tolist() if fit.matrix is not None else None, 'originalPreserved': True, 'sourceHashVerified': bool(project['source'].get('sha256') or project['source'].get('geotiff', {}).get('sha256')), 'dryRun': args.dry_run}
    save(out / 'project.json', project)
    if args.dry_run:
        save(out / 'result.json', report)
        return {'dryRun': True, 'sourceId': report['sourceId'], 'sourceSha256': info['sha256'], 'diagnostics': report['diagnostics']}
    rgba, vrt = out / 'source-rgba.tif', out / 'source-gcps.vrt'
    normalize_rgba(path, rgba, args.alpha_band)
    source_vrt(vrt, rgba, fit)
    warp_args = ['-q', '-r', args.resampling, '-et', '0', '-dstalpha', '-t_srs', target_crs]
    if fit.method == 'thin-plate-spline':
        warp_args += ['-tps']
    if args.resolution:
        warp_args += ['-tr', str(args.resolution), str(args.resolution)]
    plan = out / 'warp-plan.vrt'
    command(['gdalwarp', *warp_args, '-of', 'VRT', vrt, plan])
    with rasterio.open(plan) as d:
        if d.width * d.height > args.max_output_pixels:
            raise ValueError('Warp exceeds --max-output-pixels; inspect the points before increasing this limit')
        if d.count != 4 or d.colorinterp[3] != ColorInterp.alpha:
            raise ValueError('GDAL planned an invalid alpha layout')
    warped, cog = out / 'warped.tif', out / 'corrected.tif'
    command(['gdalwarp', *warp_args, '-of', 'GTiff', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', vrt, warped])
    command(['gdal_translate', '-q', '-of', 'COG', '-co', 'COMPRESS=DEFLATE', '-co', 'BLOCKSIZE=512', '-colorinterp', 'red,green,blue,alpha', warped, cog])
    from rasterio.warp import transform_bounds
    with rasterio.open(cog) as d:
        if d.count != 4 or d.colorinterp[3] != ColorInterp.alpha or d.tags(ns='IMAGE_STRUCTURE').get('LAYOUT') != 'COG':
            raise ValueError('Corrected output failed RGBA/COG validation')
        bounds = list(transform_bounds(d.crs, 4326, *d.bounds, densify_pts=41))
        if not all(math.isfinite(v) for v in bounds) or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise ValueError('Corrected output has invalid geographic bounds')
        report.update({'native': {'path': str(cog), 'sha256': sha(cog), 'bytes': cog.stat().st_size}, 'bounds': bounds, 'width': d.width, 'height': d.height, 'outputCrs': d.crs.to_wkt(), 'outputTransform': list(d.transform)[:6], 'overviews': d.overviews(1)})
    # Source image/pixel frame is recorded; large scratch RGB and VRT files need not be retained.
    for temp in (rgba, vrt, plan, warped):
        temp.unlink(missing_ok=True)
    save(out / 'result.json', report)
    return {'complete': True, 'sourceId': report['sourceId'], 'nativeSha256': report['native']['sha256'], 'bounds': bounds, 'diagnostics': report['diagnostics']}


def build_module():
    file = Path(__file__).resolve().parents[1] / 'shared-maps-worker/build_catalog.py'
    spec = importlib.util.spec_from_file_location('pgmaps_tile_builder', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_identity(result):
    """Immutable original pixel-frame identity, independent of a derived native output."""
    inspection = result.get('sourceInspection', {})
    identity = {
        'id': result.get('sourceId'),
        'sha256': result.get('sourceSha256'),
        'width': inspection.get('width'),
        'height': inspection.get('height'),
        'frame': copy.deepcopy(result.get('sourceFrame')),
    }
    if not isinstance(identity['id'], str) or not SHA.fullmatch(identity.get('sha256') or ''):
        raise ValueError('A completed result must identify its immutable source ID and SHA256')
    if any(isinstance(identity[k], bool) or not isinstance(identity[k], int) or identity[k] < 1 for k in ('width', 'height')):
        raise ValueError('A completed result must record native source dimensions')
    if not isinstance(identity['frame'], dict) or identity['frame'].get('kind') not in ('original-image', 'geotiff-pixel-grid', 'derived-image'):
        raise ValueError('A completed result must record an explicit source pixel frame')
    return identity


def replay_binding(identity, current, target_id, expected_native_sha):
    """Permit only the current COG or explicitly recorded original-source lineage.

    A replaced-native hash alone is never lineage permission. Legacy revisions can
    qualify only when they explicitly record both sourceSha256 and the exact frame;
    that whole-file SHA binds dimensions even if the old revision omitted them.
    """
    if identity.get('id') != target_id or current.get('id') != target_id:
        raise ValueError('Result source ID must match the stable target native item ID')
    if current.get('download', {}).get('sha256') != expected_native_sha:
        raise ValueError('Current native SHA changed; restage against the live item')
    if identity.get('sha256') == expected_native_sha:
        return {'kind': 'current-native', 'revisionDepth': None}
    revision = current.get('georeferenceRevision')
    for depth in range(64):
        if not isinstance(revision, dict):
            break
        if revision.get('sourceSha256') == identity.get('sha256') and revision.get('sourceFrame') == identity.get('frame'):
            recorded = revision.get('sourceIdentity')
            if recorded is not None:
                if recorded == identity:
                    return {'kind': 'recorded-original-source', 'revisionDepth': depth, 'identityPolicy': 'stable-id+sha256+native-dimensions+exact-frame'}
            else:
                # No inferred replaced-native permission: these two explicit fields
                # are required for legacy lineage, and source ID remains target-bound.
                return {'kind': 'recorded-legacy-source', 'revisionDepth': depth, 'identityPolicy': 'stable-id+recorded-source-sha256+exact-frame; full-file-sha-binds-dimensions'}
        previous = revision.get('previousPlacement')
        revision = previous.get('previousRevision') if isinstance(previous, dict) else None
    if identity.get('frame', {}).get('kind') != 'geotiff-pixel-grid' and not isinstance(current.get('georeferenceRevision'), dict):
        # An explicitly target-bound original image is the existing first-time image
        # workflow; its full-file identity becomes recorded by this publication.
        return {'kind': 'explicit-original-image', 'revisionDepth': None}
    raise ValueError('Native source is neither the current COG nor an explicitly documented matching original pixel-frame lineage')


def stage_patch(args):
    result = load(args.result)
    catalog = load(args.catalogue)
    if result.get('dryRun') or not result.get('native'):
        raise ValueError('A completed corrected raster is required')
    matches = [r for r in catalog.get('items', []) if r['id'] == args.id]
    if len(matches) != 1:
        raise ValueError('Stable native item ID must match exactly one catalogue item')
    current = matches[0]
    args.expected_native_sha = args.expected_native_sha.lower()
    if not SHA.fullmatch(args.expected_native_sha) or current.get('download', {}).get('sha256') != args.expected_native_sha:
        raise ValueError('Current catalogue native SHA does not match --expected-native-sha')
    identity = source_identity(result)
    binding = replay_binding(identity, current, args.id, args.expected_native_sha)
    native = Path(result['native']['path'])
    if sha(native) != result['native']['sha256']:
        raise ValueError('Corrected COG was changed after validation')
    out = Path(args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError('--out must be new or empty')
    out.mkdir(parents=True, exist_ok=True)
    builder = build_module()
    tiles, thumb = out / 'tiles.pmtiles', out / 'preview.webp'
    geometry = builder.create_tiles(native, tiles, current['title'])
    builder.thumbnail(native, thumb)
    artifacts = {}
    for name, file, mime, key in [('native', native, 'image/tiff', 'raw'), ('tiles', tiles, 'application/vnd.pmtiles', 'tiles'), ('thumbnail', thumb, 'image/webp', 'previews')]:
        digest = sha(file)
        artifacts[name] = {'path': str(file), 'sha256': digest, 'bytes': file.stat().st_size, 'mime': mime, 'key': f'{key}/{digest}{file.suffix}'}
    patch = {'schema': 'pgmaps-georeference-catalogue-patch-v1', 'id': args.id, 'expectedNativeSha256': args.expected_native_sha, 'sourceCatalogueSha256': sha(args.catalogue), 'artifacts': artifacts, 'geometry': geometry, 'revision': {'projectSha256': result['projectSha256'], 'sourceId': result['sourceId'], 'sourceSha256': result['sourceSha256'], 'sourceFrame': result['sourceFrame'], 'sourceIdentity': identity, 'sourceBinding': binding, 'transform': result['transform'], 'fitCrs': 'EPSG:3857', 'diagnostics': result['diagnostics'], 'groundAccuracyCertified': False}, 'scope': 'Replace this stable item and featured components sharing its exact old native. Preserve every unrelated record and all original immutable assets.', 'liveActivation': False}
    save(out / 'catalogue-patch.json', patch)
    return {'staged': True, 'id': args.id, 'expectedNativeSha256': args.expected_native_sha, 'newNativeSha256': artifacts['native']['sha256'], 'tileCount': geometry['tileCount'], 'liveActivation': False}


def mark_unreviewed(record, previous, patch):
    """A new owner warp cannot inherit approval of the previous geometry."""
    prior_review = previous.get('alignmentReview')
    prior = {
        'replacedNativeSha256': patch['expectedNativeSha256'],
        'confidence': previous.get('confidence'),
        'sourceProductClass': previous.get('sourceProductClass'),
        'caveat': previous.get('caveat'),
        'alignmentReview': copy.deepcopy(prior_review),
    }
    if previous.get('georeferenceRevision') is not None:
        prior['previousRevision'] = copy.deepcopy(previous['georeferenceRevision'])
    record['georeferenceRevision'] = {
        **copy.deepcopy(patch['revision']),
        'reviewStatus': 'manual_adjustment_unreviewed',
        'groundAccuracyCertified': False,
        'previousPlacement': prior,
    }
    record['confidence'] = 'experimental'
    record['sourceProductClass'] = 'experimental_georeference'
    record['caveat'] = (
        'Manual control-point adjustment awaiting an independent geographic review. '
        'Training/check residuals do not certify ground accuracy. '
        'Previous placement notes are preserved in the revision history.'
    )
    record['alignmentReview'] = {
        'status': 'needs_review',
        'reviewStatus': 'manual_adjustment_unreviewed',
        'label': 'Manual adjustment · unreviewed',
        'summary': 'An owner applied a new control-point transformation. The previous geographic review does not validate this revision.',
        'transform_changed': True,
        'ground_accuracy_certified': False,
        'previousStatus': prior_review.get('status') if isinstance(prior_review, dict) else None,
    }


def apply_patch(catalog, patch, base):
    """Pure stable-ID/SHA replacement. Missing asset hashes never identify a component."""
    result = copy.deepcopy(catalog)
    matches = [r for r in result.get('items', []) if r.get('id') == patch['id']]
    if len(matches) != 1 or matches[0].get('download', {}).get('sha256') != patch['expectedNativeSha256']:
        raise ValueError('Live item changed since this patch was staged; restage against the current catalogue')
    old = copy.deepcopy(matches[0])
    revision = patch.get('revision', {})
    identity = revision.get('sourceIdentity')
    if not isinstance(identity, dict):
        raise ValueError('Patch lacks immutable source identity; restage it with the current CLI')
    if identity.get('sha256') != revision.get('sourceSha256') or identity.get('frame') != revision.get('sourceFrame') or identity.get('id') != revision.get('sourceId'):
        raise ValueError('Patch source identity fields disagree; restage from the saved original project')
    replay_binding(identity, old, patch['id'], patch['expectedNativeSha256'])
    a = patch['artifacts']
    raw = {'url': base + a['native']['key'], 'sha256': a['native']['sha256'], 'bytes': a['native']['bytes']}
    asset = {**patch['geometry'], 'url': base + a['tiles']['key'], 'sha256': a['tiles']['sha256'], 'bytes': a['tiles']['bytes']}
    thumb = base + a['thumbnail']['key']
    old_hashes = {
        x['sha256'].lower() for x in old.get('assets', [])
        if isinstance(x.get('sha256'), str) and SHA.fullmatch(x['sha256'].lower())
    }
    old_urls = {
        x['url'] for x in old.get('assets', [])
        if isinstance(x.get('url'), str) and x['url']
    }

    def same_asset(component):
        digest = component.get('sha256')
        url = component.get('url')
        return (
            isinstance(digest, str) and digest.lower() in old_hashes
            or isinstance(url, str) and bool(url) and url in old_urls
        )

    item = matches[0]
    item.update(download=raw, assets=[asset], thumbnail=thumb, bounds=asset['bounds'])
    mark_unreviewed(item, old, patch)
    changed = []
    for f in result.get('featured', []):
        downloads = f.get('downloads', [])
        if not any(x.get('sha256') == patch['expectedNativeSha256'] for x in downloads):
            continue
        prior = copy.deepcopy(f)
        components = f.get('assets', [])
        if not any(same_asset(x) for x in components):
            raise ValueError('Cannot identify the featured component by its old asset hash or exact URL; no catalogue changes applied')
        f['downloads'] = [raw if x.get('sha256') == patch['expectedNativeSha256'] else x for x in downloads]
        f['assets'] = [copy.deepcopy(asset) if same_asset(x) else x for x in components]
        bounds = [x['bounds'] for x in f['assets']]
        f['bounds'] = [min(x[0] for x in bounds), min(x[1] for x in bounds), max(x[2] for x in bounds), max(x[3] for x in bounds)]
        if f.get('thumbnail') == old.get('thumbnail') or len(downloads) == 1:
            f['thumbnail'] = thumb
        mark_unreviewed(f, prior, patch)
        changed.append(f['id'])
    result['representationCount'] = len(result['items'])
    result['storageBytes'] = sum(x.get('download', {}).get('bytes', 0) for x in result['items'])
    result['tileBytes'] = sum(a.get('bytes', 0) for x in result['items'] for a in x.get('assets', []))
    return result, changed


def hidden_config():
    settings = None
    if sys.stdin.isatty():
        settings = termios.tcgetattr(sys.stdin.fileno())
        hidden = settings.copy()
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, hidden)
    print('Ready for owner upload settings on hidden stdin.', file=sys.stderr)
    try:
        config = json.loads(sys.stdin.readline())
    finally:
        if settings:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, settings)
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', config.get('shareId', '')) or not config.get('uploadToken') or not str(config.get('endpoint', '')).startswith('https://'):
        raise ValueError('Invalid owner upload configuration')
    return config


def publish_patch(args):
    if not args.apply:
        raise ValueError('Live activation requires the explicit owner command publish --apply')
    patch = load(args.patch)
    if patch.get('schema') != 'pgmaps-georeference-catalogue-patch-v1':
        raise ValueError('Unsupported catalogue patch')
    expected_keys = {'native': ('raw', '.tif'), 'tiles': ('tiles', '.pmtiles'), 'thumbnail': ('previews', '.webp')}
    if set(patch.get('artifacts', {})) != set(expected_keys):
        raise ValueError('Patch must contain exactly native, tiles and thumbnail artifacts')
    for name, artifact in patch['artifacts'].items():
        prefix, suffix = expected_keys[name]
        if not SHA.fullmatch(artifact.get('sha256', '')) or artifact.get('key') != f'{prefix}/{artifact["sha256"]}{suffix}':
            raise ValueError('Artifact key must be its immutable content-addressed raw, tile or preview key')
        if sha(artifact['path']) != artifact['sha256'] or Path(artifact['path']).stat().st_size != artifact['bytes']:
            raise ValueError('Staged artifact changed; restage')
        if artifact['bytes'] > 95_000_000:
            raise ValueError('Artifact exceeds current owner Worker upload limit95MB')
    config = hidden_config()
    endpoint, share, token = config['endpoint'].rstrip('/'), config['shareId'], config['uploadToken']
    base = f'{endpoint}/c/{share}/'
    with httpx.Client(timeout=180, follow_redirects=False, headers={'Accept-Encoding': 'identity'}) as client:
        def get_current():
            r = client.get(base + 'catalog.json', params={'owner_review': __import__('time').time_ns()})
            r.raise_for_status()
            return r, r.json()
        before, current = get_current()
        apply_patch(current, patch, base)  # Validate preconditions before uploading anything.
        def upload(key, mime, payload, checksum, length, conditional=None):
            headers = {'Authorization': 'Bearer ' + token, 'Content-Type': mime, 'Content-Length': str(length), 'X-Content-SHA256': checksum}
            if conditional:
                headers['If-Match'] = conditional
            response = client.put(f'{endpoint}/__upload/{share}/{key}', headers=headers, content=payload)
            response.raise_for_status()
            receipt = response.json()
            if receipt.get('sha256') != checksum or receipt.get('bytes') != length:
                raise RuntimeError('Upload receipt did not match the staged artifact')
            check = client.head(base + key, params={'verify': checksum})
            check.raise_for_status()
            if check.headers.get('X-Content-SHA256') != checksum:
                raise RuntimeError('Uploaded object checksum verification failed')
        for a in patch['artifacts'].values():
            with Path(a['path']).open('rb') as f:
                upload(a['key'], a['mime'], f, a['sha256'], a['bytes'])
        latest_response, latest = get_current()
        updated, featured = apply_patch(latest, patch, base)
        body = (json.dumps(updated, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        checksum = hashlib.sha256(body).hexdigest()
        etag = latest_response.headers.get('ETag')
        if not etag:
            raise ValueError('Live catalogue has no ETag; refusing activation without an owner concurrency precondition')
        upload('catalog.json', 'application/json', body, checksum, len(body), etag)
        readback, verified = get_current()
        if hashlib.sha256(readback.content).hexdigest() != checksum:
            raise RuntimeError('Catalogue readback differs from the activated catalogue')
    return {'activated': True, 'id': patch['id'], 'nativeSha256': patch['artifacts']['native']['sha256'], 'updatedFeatured': featured, 'catalogueSha256': checksum, 'originalAssetsPreserved': True}


def points_command(args):
    p = load(args.project)
    if args.import_csv:
        rows = list(csv.DictReader(Path(args.import_csv).open(newline='')))
        if any(r.get('enabled', '').lower() not in ('true', 'false', '1', '0') for r in rows):
            raise ValueError('CSV enabled must be true, false,1 or0')
        p['points'] = [{'id': r['id'], 'pixel': [float(r['pixelX']), float(r['pixelY'])], 'coordinate': [float(r['longitude']), float(r['latitude'])], 'enabled': r['enabled'].lower() in ('true', '1'), 'role': r['role']} for r in rows]
        validate_project(p)
        if not args.output:
            raise ValueError('--output is required for CSV import')
        save(args.output, p)
    if args.export_csv:
        with Path(args.export_csv).open('w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['id', 'pixelX', 'pixelY', 'longitude', 'latitude', 'enabled', 'role'])
            for r in p['points']:
                w.writerow([r['id'], *r['pixel'], *r['coordinate'], str(r['enabled']).lower(), r['role']])
    return {'pointCount': len(p['points']), 'sourceId': p['source']['id']}


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    subs = ap.add_subparsers(dest='command', required=True)
    p = subs.add_parser('inspect', help='Hash and inspect native pixel frame, CRS and masks')
    p.add_argument('source')
    p = subs.add_parser('validate', help='Validate project controls and fit without loading source bytes')
    p.add_argument('project')
    p = subs.add_parser('points', help='Round-trip point pairs as CSV while preserving project source identity')
    p.add_argument('--project', required=True);p.add_argument('--export-csv');p.add_argument('--import-csv');p.add_argument('--output')
    p = subs.add_parser('rectify', help='Create a corrected full-resolution RGBA COG; no live writes')
    p.add_argument('--project', required=True);p.add_argument('--source');p.add_argument('--out', required=True);p.add_argument('--dry-run', action='store_true');p.add_argument('--target-crs');p.add_argument('--resolution', type=float);p.add_argument('--resampling', choices=['nearest', 'bilinear', 'cubic'], default='bilinear');p.add_argument('--alpha-band', type=int);p.add_argument('--allow-unverified-source', action='store_true');p.add_argument('--max-source-bytes', type=int, default=4 * 1024 ** 3);p.add_argument('--max-output-pixels', type=int, default=250_000_000)
    p = subs.add_parser('stage', help='Generate tiles/thumbnail and a reviewable stable-ID/SHA catalogue patch')
    p.add_argument('--result', required=True);p.add_argument('--catalogue', required=True);p.add_argument('--id', required=True);p.add_argument('--expected-native-sha', required=True);p.add_argument('--out', required=True)
    p = subs.add_parser('publish', help='Owner-only immutable uploads and explicit live catalogue activation')
    p.add_argument('--patch', required=True);p.add_argument('--apply', action='store_true')
    return ap


def main():
    args = parser().parse_args()
    if args.command == 'inspect':
        result = source_inspection(args.source)
    elif args.command == 'validate':
        fit = Fit(load(args.project));result = {'diagnostics': fit.diagnostics(), 'domainScreen': fit.check_domain(), 'matrix3857': fit.matrix.tolist() if fit.matrix is not None else None}
    elif args.command == 'points':
        result = points_command(args)
    elif args.command == 'rectify':
        if args.resolution is not None and (not math.isfinite(args.resolution) or args.resolution <= 0):
            raise ValueError('--resolution must be positive and finite')
        result = run_rectify(args)
    elif args.command == 'stage':
        result = stage_patch(args)
    else:
        result = publish_patch(args)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Deliberately do not print request URLs, headers, tokens or a traceback containing them.
        print(json.dumps({'error': type(error).__name__, 'message': str(error) if not isinstance(error, httpx.HTTPError) else 'HTTP request failed; check source access or owner upload settings.'}), file=sys.stderr)
        sys.exit(1)
