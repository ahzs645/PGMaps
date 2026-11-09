"""Date a road's appearance: NDVI on the road line (outside the block) minus NDVI 40-80 m away, per clear Sentinel-2 scene."""
import os, sys, json, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
os.makedirs(os.path.join(CACHE, 'images'), exist_ok=True)
from wfs import features
import rasterio, numpy as np
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import from_bounds
from rasterio.features import geometry_mask
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
OID, START, END = int(sys.argv[1]), sys.argv[2], sys.argv[3]
blk = shape(features('WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW', f'OBJECTID={OID}', ['GEOMETRY'], srs='EPSG:3005')[0]['geometry'])
minx, miny, maxx, maxy = blk.buffer(30).bounds
secs = [shape(s['geometry']) for s in features('WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')", ['GEOMETRY'], srs='EPSG:3005') if s['geometry']]
road = unary_union([s for s in secs if s.distance(blk) <= 20]).difference(blk.buffer(60))   # access outside the block
# keep road segments within 1.5 km of the block so the series measures this access, not the whole network
road = road.intersection(blk.buffer(1500))
on = road.buffer(10); ring = road.buffer(80).difference(road.buffer(40)).difference(blk.buffer(60))
print(f'road outside block: {road.length:.0f} m', file=sys.stderr)
bb4326 = transform_bounds('EPSG:3005', 'EPSG:4326', *ring.buffer(100).bounds)
body = json.dumps({'collections': ['sentinel-2-l2a'], 'bbox': list(bb4326), 'datetime': f'{START}T00:00:00Z/{END}T00:00:00Z', 'limit': 200, 'query': {'eo:cloud_cover': {'lt': 50}}}).encode()
items = json.load(urllib.request.urlopen(urllib.request.Request('https://earth-search.aws.element84.com/v1/search', body, {'Content-Type': 'application/json'}), timeout=120))['features']
items = sorted(items, key=lambda i: i['properties']['datetime'])
def read(href, geom_bounds):
    with rasterio.open(href) as src:
        b = transform_bounds('EPSG:3005', src.crs, *geom_bounds)
        w = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        return src.read(1, window=w, boundless=True, fill_value=0).astype('float32'), src.window_transform(w), src.crs, src.shape
seen = set()
for it in items:
    date = it['properties']['datetime'][:10]; tile = it['properties'].get('s2:mgrs_tile') or it['id'].split('_')[1]
    if date in seen: continue  # overlapping tiles agree; one per date is enough

    try:
        bounds = ring.buffer(100).bounds
        red, tr, crs, _ = read(it['assets']['red']['href'], bounds)
        nir, _, _, _ = read(it['assets']['nir']['href'], bounds)
        scl20, tr20, _, _ = read(it['assets']['scl']['href'], bounds)
    except Exception as e:
        print(date, 'read error', e, file=sys.stderr); continue
    scl = np.kron(scl20, np.ones((2, 2)))[:red.shape[0], :red.shape[1]]
    if scl.shape != red.shape: scl = np.pad(scl, ((0, red.shape[0] - scl.shape[0]), (0, red.shape[1] - scl.shape[1])), mode='edge')
    clear = np.isin(scl, [4, 5, 6, 7]) & (red > 0)
    def stat(g):
        gg = transform_geom('EPSG:3005', crs, mapping(g))
        m = ~geometry_mask([gg], out_shape=red.shape, transform=tr) 
        ok = m & clear
        if m.sum() == 0 or ok.sum() / m.sum() < 0.8: return None
        ndvi = (nir[ok] - red[ok]) / (nir[ok] + red[ok] + 1e-6)
        return float(np.mean(ndvi))
    a, b = stat(on), stat(ring)
    if a is None or b is None: continue
    seen.add(date)
    print(f'{date} {tile} road {a:.3f} forest {b:.3f} contrast {b - a:+.3f}')
