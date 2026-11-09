"""Before/after Sentinel-2 true-colour crops for one cached pair (adapted from s2_compare.py; reads the cached pair, no WFS).
Draws: block green, roads named for the block yellow, other FTEN roads red.
Picks the clearest scene (<20% cloud) within +-45 days of each date given.
Usage: compare.py <oid> <before YYYY-MM-DD> <after YYYY-MM-DD> [label]
"""
import os, sys, json, glob, urllib.request, datetime as dt
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
import numpy as np, rasterio
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import from_bounds
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
oid, before, after = int(sys.argv[1]), sys.argv[2], sys.argv[3]
label = sys.argv[4] if len(sys.argv) > 4 else str(oid)
f = [p for p in glob.glob(os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research') + '/pairs/*.json') + glob.glob(os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research') + '/expand/pairs/*.json') if os.path.basename(p) == f'{oid}.json'][0]
d = json.load(open(f)); blk = shape(d['block_geometry'])
spur = [shape(s['geometry']) for s in d['spur'] if s['geometry']]
ids = {(s['props']['FOREST_FILE_ID'], s['props']['ROAD_SECTION_ID']) for s in d['spur']}
others = [shape(c['geometry']) for c in d['context'] if c['geometry'] and (c['props']['FOREST_FILE_ID'], c['props']['ROAD_SECTION_ID']) not in ids]
area = unary_union([blk] + spur).buffer(400).bounds
bb = transform_bounds('EPSG:3005', 'EPSG:4326', *area)
def search(day):
    c = dt.date.fromisoformat(day); a, b = c - dt.timedelta(days=45), c + dt.timedelta(days=45)
    body = json.dumps({'collections': ['sentinel-2-l2a'], 'bbox': list(bb), 'datetime': f'{a}T00:00:00Z/{b}T00:00:00Z', 'limit': 100, 'query': {'eo:cloud_cover': {'lt': 20}}}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request('https://earth-search.aws.element84.com/v1/search', body, {'Content-Type': 'application/json'}), timeout=120))
    it = [i for i in r['features'] if i['properties'].get('s2:nodata_pixel_percentage', 0) < 5]
    return sorted(it, key=lambda i: (i['properties']['eo:cloud_cover'], abs((dt.date.fromisoformat(i['properties']['datetime'][:10]) - c).days)))
panels = []
for day in (before, after):
    items = search(day)
    if not items: print('no clear scene near', day); continue
    it = items[0]
    with rasterio.open(it['assets']['visual']['href']) as src:
        b = transform_bounds('EPSG:3005', src.crs, *area); win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(window=win, boundless=True); tr = src.window_transform(win); crs = src.crs
    a = np.moveaxis(arr, 0, -1).astype('float32'); v = a[a.sum(-1) > 0]
    lo, hi = np.percentile(v, 1), np.percentile(v, 99.5)
    a = np.clip((a - lo) / max(1, hi - lo), 0, 1) ** 0.8 * 255
    img = Image.fromarray(a.astype('uint8')).convert('RGB'); k = max(1, 600 // img.width)
    img = img.resize((img.width * k, img.height * k), Image.NEAREST)
    base = img.copy(); dr = ImageDraw.Draw(img)
    px = lambda x, y: tuple(v * k for v in (~tr * (x, y)))
    def draw(g, col, w):
        g = shape(transform_geom('EPSG:3005', crs, mapping(g)))
        for p in getattr(g, 'geoms', [g]):
            cs = p.exterior.coords if p.geom_type == 'Polygon' else p.coords
            dr.line([px(*c) for c in cs], fill=col, width=w)
    for o in others: draw(o, (255, 60, 60), 1)
    draw(blk, (0, 255, 0), 2)
    for s in spur: draw(s, (255, 255, 0), 2)
    img = Image.blend(base, img, 0.45); dr = ImageDraw.Draw(img)
    dr.rectangle([0, 0, 220, 16], fill=(0, 0, 0)); dr.text((4, 3), f"{it['properties']['datetime'][:10]}  cloud {it['properties']['eo:cloud_cover']:.1f}%", fill=(255, 255, 0))
    panels.append(img); print(day, '->', it['id'])
W = sum(p.width for p in panels) + 10 * (len(panels) - 1); H = max(p.height for p in panels)
out = Image.new('RGB', (W, H + 18), 'white'); x = 0
for p in panels: out.paste(p, (x, 18)); x += p.width + 10
ImageDraw.Draw(out).text((4, 3), f"{label}: green block, yellow road named for it, red other FTEN roads", fill=(0, 0, 0))
os.makedirs(os.path.join(HERE, 'images'), exist_ok=True)
p = os.path.join(HERE, 'images', f'compare_{label}.jpg'); out.save(p, quality=88); print(p, out.size)
