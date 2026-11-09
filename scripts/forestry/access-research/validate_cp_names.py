"""Validate parsed road-section references (CP, licence, block) against FTEN blocks and RESULTS openings."""
import os, sys, json, random, re, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wfs import features
from parse_names import parse
from shapely.geometry import shape
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
DIST, N = sys.argv[1], int(sys.argv[2])
SRC = sys.argv[3] if len(sys.argv) > 3 else 'any'
P = [p for p in json.load(open(os.path.join(CACHE, 'sections_b01.json'))) if p['GEOGRAPHIC_DISTRICT_CODE'] == DIST]
cand = []
for p in P:
    x = parse(p['ROAD_SECTION_NAME'], p['ROAD_SECTION_ID'])
    if x.get('cps') and len(x['cps']) == 1 and (SRC == 'any' or x['source'] == SRC): cand.append((p, x))
random.seed(20261109); sample = random.sample(cand, min(N, len(cand)))
def q(t, c, props): return [f for f in features(t, c, props + ['GEOMETRY'], srs='EPSG:3005') if f['geometry']]
def look(road, cp, lic, client):
    minx, miny, maxx, maxy = road.buffer(2000).bounds; bb = f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')"
    key = f"HARVEST_AUTH_CUTTING_PERMIT_ID='{cp}' AND " + (f"HARVEST_AUTH_FOREST_FILE_ID='{lic}'" if lic else f"CLIENT_NUMBER='{client}'")
    bl = [(road.distance(shape(f['geometry'])), f['properties']['CUT_BLOCK_ID'], 'FTEN') for f in q('WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW', f'{key} AND {bb}', ['CUT_BLOCK_ID'])]
    rk = f"CUTTING_PERMIT_ID='{cp}'" + (f" AND FOREST_FILE_ID='{lic}'" if lic else '')
    bl += [(road.distance(shape(f['geometry'])), f['properties']['CUT_BLOCK_ID'], 'RESULTS') for f in q('WHSE_FOREST_VEGETATION.RSLT_OPENING_SVW', f'{rk} AND {bb}', ['CUT_BLOCK_ID'])]
    return sorted(bl, key=lambda b: b[0])
out = []
for p, x in sample:
    g = features('WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', f"OBJECTID={p['OBJECTID']}", ['GEOMETRY'], srs='EPSG:3005')
    if not g or not g[0]['geometry']: continue
    road = shape(g[0]['geometry']); cp = x['cps'][0]; lic = x.get('licence')
    hits = look(road, cp, lic, p['CLIENT_NUMBER'])
    ctrl = look(road, str(int(re.match(r'\d+', cp).group()) + 37), lic, p['CLIENT_NUMBER'])
    named_blocks = {b.lstrip('0') for b in x.get('blocks', [])}
    touching = [h for h in hits if h[0] <= 20]
    out.append(dict(file=p['FOREST_FILE_ID'], sec=p['ROAD_SECTION_ID'], name=p['ROAD_SECTION_NAME'], src=x['source'], cp=cp, lic=lic, blocks=sorted(named_blocks),
                    nearest=round(hits[0][0], 1) if hits else None, via=hits[0][2] if hits else None,
                    named_block_touching=bool(named_blocks and any((h[1] or '').upper().lstrip('0') in named_blocks for h in touching)),
                    named_block_within_2km=bool(named_blocks and any((h[1] or '').upper().lstrip('0') in named_blocks for h in hits)),
                    ctrl=round(ctrl[0][0], 1) if ctrl else None))
    time.sleep(0.2)
json.dump(out, open(os.path.join(CACHE, f'cp_{DIST}_{SRC}.json'), 'w'), indent=1)
n = len(out); s = lambda f: sum(1 for o in out if f(o))
nb = s(lambda o: o['blocks'])
print(f"{DIST} ({SRC}) candidates {len(cand)} sample {n} | with licence {s(lambda o: o['lic'])} | naming a block {nb}")
print(f"  cited CP touching {s(lambda o: o['nearest'] is not None and o['nearest'] <= 20)}/{n} | <=250 m {s(lambda o: o['nearest'] is not None and o['nearest'] <= 250)}/{n} | none within 2 km {s(lambda o: o['nearest'] is None)}/{n}")
print(f"  control touching {s(lambda o: o['ctrl'] is not None and o['ctrl'] <= 20)}/{n} | control within 2 km {s(lambda o: o['ctrl'] is not None)}/{n}")
print(f"  named block touching {s(lambda o: o['named_block_touching'])}/{nb} | named block within 2 km {s(lambda o: o['named_block_within_2km'])}/{nb}")
