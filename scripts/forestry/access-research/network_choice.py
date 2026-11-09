"""For pairs whose spur did not join the nearest road: compare the nearest road and the joined road by network position."""
import os, sys, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape, Point
from shapely.ops import unary_union, nearest_points, linemerge
from shapely.strtree import STRtree

def components(items, tol=15):
    geoms = [g for g, _ in items]; tree = STRtree(geoms); parent = list(range(len(geoms)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i, g in enumerate(geoms):
        for j in tree.query(g.buffer(tol)):
            if j != i and geoms[j].distance(g) <= tol: parent[find(i)] = find(j)
    comp = collections.defaultdict(list)
    for i in range(len(geoms)): comp[find(i)].append(i)
    of = {i: r for r, ids in comp.items() for i in ids}
    return comp, of

def describe(i, items, comp, of):
    ids = comp[of[i]]; g, c = items[i]; p = c['props']
    return dict(name=p['ROAD_SECTION_NAME'], type=p['FILE_TYPE_DESCRIPTION'], retired=p['LIFE_CYCLE_STATUS_CODE'] == 'RETIRED',
                component_km=round(sum(items[k][0].length for k in ids) / 1000, 1),
                reaches_fsr=any('Service Road' in (items[k][1]['props']['FILE_TYPE_DESCRIPTION'] or '') for k in ids),
                touches_edge=False)

M = {m['oid']: m for m in json.load(open(os.path.join(CACHE, 'pair_metrics.json')))}
rows = []
for oid, m in M.items():
    if not ((m.get('nearest_road_dist') or 0) > 20 and (m.get('junction_to_nearest_point') or 0) > 150): continue
    path = next(p for p in (os.path.join(CACHE, 'pairs', f'{oid}.json'), os.path.join(CACHE, 'expand', 'pairs', f'{oid}.json')) if os.path.exists(p))
    P = json.load(open(path)); blk = shape(P['block_geometry'])
    items = [(shape(c['geometry']), c) for c in P['context'] if c['geometry']]
    comp, of = components(items)
    # the 3 km window clips networks: a component touching the window edge continues beyond it
    win = blk.buffer(3000).envelope.exterior
    outside = [i for i, (g, _) in enumerate(items) if not blk.buffer(5).contains(g)]
    ni = min(outside, key=lambda i: items[i][0].distance(blk))
    spur = unary_union([shape(s['geometry']) for s in P['spur']])
    hi = min(range(len(items)), key=lambda i: items[i][0].distance(spur.difference(blk.buffer(30))) if not spur.difference(blk.buffer(30)).is_empty else 9e9)
    def d(i):
        x = describe(i, items, comp, of); x['open_ended'] = bool(any(items[k][0].distance(win) < 200 for k in comp[of[i]])); return x
    n, h = d(ni), d(hi)
    same = bool(of[ni] == of[hi])
    rows.append(dict(oid=oid, block=m['block'], nearest=n, joined=h, same_network=same, alt_grade=m.get('alt_grade_max'), leg_grade=m.get('spur_grade_max')))
json.dump(rows, open(os.path.join(CACHE, 'network_choice.json'), 'w'), indent=1)
N = len(rows); s = lambda f: sum(1 for r in rows if f(r))
print('joined elsewhere:', N)
print(' nearest and joined road on the same connected network:', s(lambda r: r['same_network']))
print(' nearest road retired:', s(lambda r: r['nearest']['retired']), '| joined road retired:', s(lambda r: r['joined']['retired']))
print(' nearest network leaves the 3 km window (continues):', s(lambda r: r['nearest']['open_ended']), '| joined:', s(lambda r: r['joined']['open_ended']))
print(' nearest network reaches an FSR:', s(lambda r: r['nearest']['reaches_fsr']), '| joined:', s(lambda r: r['joined']['reaches_fsr']))
print(' network km within window, nearest:', [r['nearest']['component_km'] for r in rows])
print(' network km within window, joined: ', [r['joined']['component_km'] for r in rows])
print(' isolated nearest road (<1 km, closed):', s(lambda r: r['nearest']['component_km'] < 1 and not r['nearest']['open_ended']))
expl = s(lambda r: (r['nearest']['component_km'] < 1 and not r['nearest']['open_ended']) or r['nearest']['retired'] or (r['alt_grade'] or 0) > 12)
print(' explained by isolated/retired nearest road or straight alternative > 12%:', expl, '/', N)
