"""Per-scene Sentinel-2 NDVI series for one cached block-road pair.

Adapted from scripts/forestry/access-research/s2_timeseries.py. Reads the cached pair JSON (EPSG:3005), so no WFS calls.
Per scene (one tile per date, SCL 4-7 clear, >=80% clear pixels per geometry) records mean NDVI on:
  road   - 10 m buffer of the measured spur part
  ring   - 40-80 m from the measured spur part (forest reference beside the corridor)
  blk    - block interior (block buffered -20 m, minus 30 m around any road)
  oring  - 40-150 m outside the block (forest reference beside the block)
Measured spur part: spur outside block.buffer(60); if under 100 m, spur inside the block. Either way, minus 60 m around
other (non-spur) FTEN roads and minus earlier-harvested neighbour blocks, so a pre-existing clearing does not mask the step.
Usage: fetch_series.py <pair.json> <out.json>
"""
import os
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
import sys, json, time, urllib.request, datetime as dt
import numpy as np, rasterio
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import from_bounds
from rasterio.features import geometry_mask
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

src_path, out_path = sys.argv[1], sys.argv[2]
d = json.load(open(src_path))
b = d['block']
blk = shape(d['block_geometry']).buffer(0)
start = dt.date.fromisoformat(b['DISTURBANCE_START_DATE'][:10])
t0 = max(dt.date(2017, 1, 1), start - dt.timedelta(days=730))
t1 = min(dt.date(2026, 11, 1), start + dt.timedelta(days=365))

spur = unary_union([shape(s['geometry']) for s in d['spur'] if s['geometry']])
spur_ids = {(s['props']['FOREST_FILE_ID'], s['props']['ROAD_SECTION_ID']) for s in d['spur']}
others = [shape(c['geometry']) for c in d['context'] if c['geometry'] and (c['props']['FOREST_FILE_ID'], c['props']['ROAD_SECTION_ID']) not in spur_ids]
others = unary_union([o for o in others if o.distance(blk) < 2000]) if others else None
# neighbour blocks harvested before the target's series ends (their clearing would read as "road")
nb = []
for n in d.get('nearby_blocks', []):
    s = (n['props'].get('DISTURBANCE_START_DATE') or '')[:10]
    if n.get('geometry') and s and s < t1.isoformat() and n['props'].get('OBJECTID') != b.get('OBJECTID'):
        g = shape(n['geometry']).buffer(0)
        if g.distance(blk) < 2000 and not g.equals(blk) and g.intersection(blk).area < 0.5 * blk.area: nb.append(g)
nbu = unary_union(nb) if nb else None

out_part = spur.difference(blk.buffer(60)).intersection(blk.buffer(1500))
mode = 'outside'
road = out_part
if road.length < 100:
    mode = 'inside'; road = spur.intersection(blk.buffer(-20))
if road.length < 100:
    # short stub ending at the block edge: take what lies outside the bare block edge, else the whole spur
    mode = 'edge'; road = spur.difference(blk.buffer(15))
    if road.length < 50: mode = 'whole'; road = spur
excl_road = (others.buffer(60) if others is not None and not others.is_empty else None)
r2 = road.difference(excl_road) if excl_road is not None else road
if r2.length >= min(100, 0.5 * road.length): road = r2
else: mode += '+nearother'
r3 = road.difference(nbu.buffer(10)) if nbu is not None else road
if r3.length >= min(100, 0.5 * road.length): road = r3
else: mode += '+inneighbour'

on = road.buffer(10)
ring = road.buffer(80).difference(road.buffer(40))
if mode.startswith('outside') or mode.startswith('edge'): ring = ring.difference(blk.buffer(30 if mode.startswith('outside') else 10))
if excl_road is not None: ring = ring.difference(others.buffer(25))
if nbu is not None:
    rr = ring.difference(nbu)
    if rr.area > 0.3 * ring.area: ring = rr
allroads = unary_union([spur] + ([others] if others is not None else []))
inner = blk.buffer(-20).difference(allroads.buffer(30))
oring = blk.buffer(150).difference(blk.buffer(40))
if nbu is not None:
    o2 = oring.difference(nbu)
    if o2.area > 0.3 * oring.area: oring = o2
if excl_road is not None: oring = oring.difference(others.buffer(25))
geoms = {'road': on, 'ring': ring, 'blk': inner, 'oring': oring}
geoms = {k: g for k, g in geoms.items() if not g.is_empty and g.area > 500}
area_bounds = unary_union(list(geoms.values())).buffer(50).bounds

meta = dict(oid=b.get('OBJECTID'), block=b.get('CUT_BLOCK_ID'), licence=b.get('CUT_BLOCK_FOREST_FILE_ID'), district=b.get('ADMIN_DISTRICT_CODE'),
            client=b.get('CLIENT_NAME'), start=b['DISTURBANCE_START_DATE'][:10], end=(b.get('DISTURBANCE_END_DATE') or '')[:10],
            spur_names=sorted({s['props'].get('ROAD_SECTION_NAME') or '' for s in d['spur']}), mode=mode,
            road_len=round(road.length), spur_len=round(spur.length), spur_out_len=round(out_part.length), t0=t0.isoformat(), t1=t1.isoformat(),
            areas={k: round(g.area) for k, g in geoms.items()})

bb = transform_bounds('EPSG:3005', 'EPSG:4326', *area_bounds)
items, tok, r = [], None, None
body = {'collections': ['sentinel-2-l2a'], 'bbox': list(bb), 'datetime': f'{t0}T00:00:00Z/{t1}T00:00:00Z', 'limit': 100, 'query': {'eo:cloud_cover': {'lt': 60}}}
for attempt in range(5):
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request('https://earth-search.aws.element84.com/v1/search', json.dumps(body).encode(), {'Content-Type': 'application/json'}), timeout=120))
        items = r['features']; break
    except Exception as e:
        print('search error', e, file=sys.stderr); time.sleep(10 * (attempt + 1))
if r is None: sys.exit('STAC search failed')
# STAC returns newest first, limit 250 covers a 3-year window at <60% cloud in most places; page if needed
while r.get('links') and any(l.get('rel') == 'next' for l in r['links']) and len(items) < 2000:
    nxt = [l for l in r['links'] if l.get('rel') == 'next'][0]
    time.sleep(0.5)
    req = urllib.request.Request(nxt['href'], json.dumps(nxt.get('body', {})).encode() if nxt.get('method') == 'POST' else None, {'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=120)); items += r['features']
items = sorted(items, key=lambda i: (i['properties']['datetime'], i['properties'].get('s2:nodata_pixel_percentage', 0)))
meta['n_items'] = len(items)

def read(href, bounds):
    for attempt in range(3):
        try:
            with rasterio.open(href) as src:
                bb = transform_bounds('EPSG:3005', src.crs, *bounds)
                w = from_bounds(*bb, transform=src.transform).round_offsets().round_lengths()
                return src.read(1, window=w, boundless=True, fill_value=0).astype('float32'), src.window_transform(w), src.crs
        except Exception as e:
            err = e; time.sleep(2 * (attempt + 1))
    raise err

masks = {}
def scene(it):
    p = it['properties']; date = p['datetime'][:10]
    scl20, tr20, crs = read(it['assets']['scl']['href'], area_bounds)
    if (scl20 > 0).mean() < 0.5: return None                       # tile edge: try another tile for this date
    scl10 = np.kron(scl20, np.ones((2, 2)))
    row = {'date': date, 'tile': p.get('s2:mgrs_tile') or it['id'].split('_')[1], 'cloud': round(p.get('eo:cloud_cover', -1), 1)}
    # SCL-first: if neither road nor ring is >=80% clear, skip the red/NIR reads
    tr10 = tr20 * tr20.scale(0.5, 0.5)
    def mask(k, shape_):
        key = (k, str(crs), shape_, tuple(tr10)[:6])
        if key not in masks:
            masks[key] = ~geometry_mask([transform_geom('EPSG:3005', crs, mapping(geoms[k]))], out_shape=shape_, transform=tr10)
        return masks[key]
    clear10 = np.isin(scl10, [4, 5, 6, 7])
    for k in geoms:
        m = mask(k, scl10.shape)
        if ((m & (scl10 > 0)).sum() < 0.8 * m.sum()) and k in ('road', 'ring'): return None
    fr = {}
    for k in geoms:
        m = mask(k, scl10.shape)
        fr[k] = (m & clear10).sum() / max(1, m.sum())
        row[k + '_snow'] = round(float((m & (scl10 == 11)).sum() / max(1, m.sum())), 3)
    if fr.get('road', 0) < 0.8 and fr.get('blk', 0) < 0.8: return row
    red, tr, crs2 = read(it['assets']['red']['href'], area_bounds)
    nir, _, _ = read(it['assets']['nir']['href'], area_bounds)
    if not p.get('earthsearch:boa_offset_applied', True) and float(p.get('s2:processing_baseline', '0') or 0) >= 4:
        red = np.where(red > 0, red - 1000, 0); nir = np.where(nir > 0, nir - 1000, 0)
    h, w = red.shape
    sc = scl10[:h, :w]
    if sc.shape != red.shape: sc = np.pad(sc, ((0, h - sc.shape[0]), (0, w - sc.shape[1])), mode='edge')
    clear = np.isin(sc, [4, 5, 6, 7]) & (red > 0)
    for k, g in geoms.items():
        m = ~geometry_mask([transform_geom('EPSG:3005', crs2, mapping(g))], out_shape=red.shape, transform=tr)
        ok = m & clear
        if m.sum() == 0 or ok.sum() / m.sum() < 0.8: row[k] = None; continue
        ndvi = (nir[ok] - red[ok]) / (nir[ok] + red[ok] + 1e-6)
        row[k] = round(float(np.mean(ndvi)), 4)
        if k == 'road': row['road_red'] = round(float(np.median(red[ok])), 0)
    return row

bydate = {}
for it in items: bydate.setdefault(it['properties']['datetime'][:10], []).append(it)
def one_date(date):
    for it in bydate[date]:
        try:
            r = scene(it)
        except Exception as e:
            print(date, 'read error', e, file=sys.stderr); continue
        if r is not None: return r
    return None
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(int(os.environ.get('S2_THREADS', '4'))) as ex:
    rows = [r for r in ex.map(one_date, sorted(bydate)) if r is not None]
json.dump({'meta': meta, 'rows': rows}, open(out_path, 'w'))
print(meta['oid'], meta['district'], meta['mode'], meta['road_len'], len(items), len(rows), file=sys.stderr)
