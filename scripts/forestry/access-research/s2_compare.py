"""Sentinel-2 L2A true-colour before/after crops around a block, with FTEN + FOM roads drawn on top."""
import os, sys, json, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
os.makedirs(os.path.join(CACHE, 'images'), exist_ok=True)
from wfs import features
import rasterio, numpy as np
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import from_bounds
from shapely.geometry import shape, mapping
from PIL import Image, ImageDraw
OID, LABEL, BEFORE, AFTER = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
blk = features('WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW', f'OBJECTID={OID}', ['CUT_BLOCK_ID', 'GEOMETRY'])[0]
bg = shape(blk['geometry']); minx, miny, maxx, maxy = bg.buffer(0.012).bounds
roads = [shape(s['geometry']) for s in features('WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:4326')", ['GEOMETRY']) if s['geometry']]
def search(dates):
    body = json.dumps({'collections': ['sentinel-2-l2a'], 'bbox': [minx, miny, maxx, maxy], 'datetime': '/'.join(d + ('T00:00:00Z' if 'T' not in d else '') for d in dates.split('/')), 'limit': 50,
                       'query': {'eo:cloud_cover': {'lt': 10}}}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request('https://earth-search.aws.element84.com/v1/search', body, {'Content-Type': 'application/json'}), timeout=120))
    items = [i for i in r['features'] if i['properties'].get('s2:nodata_pixel_percentage', 0) < 5]
    return sorted(items, key=lambda i: i['properties']['eo:cloud_cover'])
panels = []
for dates in (BEFORE, AFTER):
    items = search(dates)
    if not items: print('no clear scene for', dates); continue
    it = items[0]; href = it['assets']['visual']['href']
    with rasterio.open(href) as src:
        b = transform_bounds('EPSG:4326', src.crs, minx, miny, maxx, maxy)
        win = from_bounds(*b, transform=src.transform)
        arr = src.read(window=win); tr = src.window_transform(win); crs = src.crs
    img = Image.fromarray(np.moveaxis(arr, 0, -1)).convert('RGB')
    img = img.resize((img.width * 4, img.height * 4), Image.NEAREST); d = ImageDraw.Draw(img)
    def px(x, y):
        c, r = ~tr * (x, y); return (c * 4, r * 4)
    g = shape(transform_geom('EPSG:4326', crs, mapping(bg)))
    for poly in getattr(g, 'geoms', [g]): d.line([px(*c) for c in poly.exterior.coords], fill=(0, 255, 0), width=2)
    for rd in roads:
        rg = shape(transform_geom('EPSG:4326', crs, mapping(rd)))
        for ln in getattr(rg, 'geoms', [rg]): d.line([px(*c) for c in ln.coords], fill=(255, 60, 60), width=1)
    d.text((6, 6), f"{it['properties']['datetime'][:10]}  cloud {it['properties']['eo:cloud_cover']:.1f}%", fill=(255, 255, 0))
    panels.append(img); print(dates, '->', it['id'], it['properties']['datetime'][:10])
W = sum(p.width for p in panels) + 10 * (len(panels) - 1); H = max(p.height for p in panels)
out = Image.new('RGB', (W, H), 'white'); x = 0
for p in panels: out.paste(p, (x, 0)); x += p.width + 10
out.save(os.path.join(CACHE, 'images', f's2_{LABEL}.jpg'), quality=88); print(out.size)
