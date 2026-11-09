"""Does a road section name contain the CUT_BLOCK_ID of a block it touches? Control: names paired with another section's neighbours."""
import os, sys, json, random, re, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wfs import features
from shapely.geometry import shape
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
DIST, N, SINCE = sys.argv[1], int(sys.argv[2]), sys.argv[3]
P = [p for p in json.load(open(os.path.join(CACHE, 'sections_b01.json')))
     if p['GEOGRAPHIC_DISTRICT_CODE'] == DIST and (p['AWARD_DATE'] or '') >= SINCE and (p['ROAD_SECTION_NAME'] or '').strip()]
random.seed(20261109); sample = random.sample(P, min(N, len(P)))
norm = lambda s: re.sub(r'^0+', '', s.upper())
toks = lambda name: {norm(t) for t in re.split(r'[^A-Za-z0-9]+', name or '') if len(t) >= 2}
near = []
for p in sample:
    g = features('WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', f"OBJECTID={p['OBJECTID']}", ['GEOMETRY'], srs='EPSG:3005')
    if not g or not g[0]['geometry']: near.append(set()); continue
    road = shape(g[0]['geometry']); minx, miny, maxx, maxy = road.buffer(200).bounds
    bl = features('WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW', f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')", ['CUT_BLOCK_ID', 'GEOMETRY'], srs='EPSG:3005')
    near.append({norm(b['properties']['CUT_BLOCK_ID'] or '') for b in bl if b['geometry'] and road.distance(shape(b['geometry'])) <= 20} - {''})
    time.sleep(0.2)
hit = [bool(toks(p['ROAD_SECTION_NAME']) & near[i]) for i, p in enumerate(sample)]
ctrl = [bool(toks(p['ROAD_SECTION_NAME']) & near[(i + 7) % len(sample)]) for i, p in enumerate(sample)]
has_blocks = sum(1 for s in near if s)
print(f"{DIST} since {SINCE}: sample {len(sample)} | sections touching any block {has_blocks} | name contains a touching block's ID {sum(hit)} | control {sum(ctrl)}")
for i, p in enumerate(sample):
    if hit[i]: print('   ', p['FOREST_FILE_ID'], p['ROAD_SECTION_ID'], repr(p['ROAD_SECTION_NAME']), sorted(toks(p['ROAD_SECTION_NAME']) & near[i]))
