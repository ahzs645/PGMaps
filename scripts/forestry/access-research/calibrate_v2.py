"""Calibrate generator v2 rules (water as barrier, order-3+ stream penalty, other-licensee penalty, drop later permits)
at A=5, GMAX=0.14, W_HAUL=0. Licence-hash split; metric = generated vs real junction distance."""
import os, sys, json, zlib, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np, networkx as nx
from multiprocessing import Pool
from shapely.geometry import shape, Point
from shapely.ops import unary_union, linemerge
from generate_road import Grid, dijkstra, network, existing_roads, lines, pair_files, attach_hydro, permitted_after, DEFAULTS
BASE = dict(DEFAULTS, A=5.0, GMAX=0.14, W_HAUL=0.0)
WATERS, PS, LS, DROPS = [False, True], [0.0, 200.0, 500.0], [0.0, 300.0, 1000.0], [False, True]

def one(f):
    P = json.load(open(f)); blk = shape(P['block_geometry']); items = existing_roads(P)
    if not items: return None
    net = unary_union([g for g, _ in items])
    if blk.distance(net) <= 20: return None
    built = unary_union([shape(s['geometry']) for s in P['spur']])
    merged = linemerge(built) if built.geom_type == 'MultiLineString' else built
    ends = [Point(c) for l in lines(merged) for c in (l.coords[0], l.coords[-1])]
    if not ends: return None
    j = min(ends, key=lambda e: e.distance(net))
    if j.distance(net) > 25: return None
    G, nodes, tree = network(items); win = blk.buffer(3000).envelope.exterior; ok = set()
    for comp in nx.connected_components(G):
        if sum(G.edges[e]['w'] for e in G.subgraph(comp).edges) >= 1000 or any(Point(n).distance(win) < 200 for n in comp): ok |= comp
    start = (P['block']['DISTURBANCE_START_DATE'] or '')[:10]; client = P['block'].get('CLIENT_NUMBER')
    cands = []
    for g, c in items:
        if c['props']['LIFE_CYCLE_STATUS_CODE'] == 'RETIRED' or g.distance(blk) > 1000: continue
        later = permitted_after(c, start); other = c['props']['FILE_TYPE_CODE'] == 'B01' and c['props'].get('CLIENT_NUMBER') != client
        for l in lines(g):
            n = max(1, int(l.length // 40))
            for i in range(n + 1):
                q = l.interpolate(i / n, normalized=True)
                if q.distance(blk) <= 1000 and nodes[tree.nearest(q)] in ok: cands.append((q, other, later))
    if not cands: return None
    grid = attach_hydro(Grid(blk.buffer(1300).bounds, BASE['CELL'], cache_key=P['block']['OBJECTID']), P['block']['OBJECTID'], exclude=blk)
    src = list(zip(*np.nonzero(grid.mask(blk))))
    res = dict(oid=P['block']['OBJECTID'], licence=P['block']['HARVEST_AUTH_FOREST_FILE_ID'], results={})
    for W, PSV in itertools.product(WATERS, PS):
        cost, _ = dijkstra(grid, src, dict(BASE, WATER=W, P_STREAM=PSV))
        cb = [(cost[grid.rc(q.x, q.y)], q, o, lt) for q, o, lt in cands]
        for L, D in itertools.product(LS, DROPS):
            ok_c = [x for x in cb if np.isfinite(x[0]) and not (D and x[3])]
            k = f'water={W}|stream={PSV:.0f}|other={L:.0f}|drop_later={D}'
            res['results'][k] = min(ok_c, key=lambda x: x[0] + (L if x[2] else 0))[1].distance(j) if ok_c else None
    return res

if __name__ == '__main__':
    with Pool(6) as pool: R = [r for r in pool.map(one, pair_files()) if r]
    json.dump(R, open(os.path.join(CACHE, 'calibration_v2.json'), 'w'))
    train = [r for r in R if zlib.crc32(r['licence'].encode()) % 2 == 0]; test = [r for r in R if zlib.crc32(r['licence'].encode()) % 2 == 1]
    def score(rs, k):
        e = np.array([r['results'][k] if r['results'].get(k) is not None else 5000 for r in rs]); return round(float(np.median(e))), round(float((e <= 150).mean()), 2), round(float((e <= 300).mean()), 2)
    base = 'water=False|stream=0|other=0|drop_later=False'
    print(f'pairs {len(R)} | train {len(train)} | test {len(test)}')
    print('v1 (no new rules):            train', score(train, base), 'test', score(test, base))
    keys = sorted(R[0]['results'], key=lambda k: (-score(train, k)[1], score(train, k)[0]))
    for k in keys[:6]: print('train-ranked', k, 'train', score(train, k), 'test', score(test, k))
    for k in ['water=True|stream=0|other=0|drop_later=False', 'water=False|stream=200|other=0|drop_later=False', 'water=False|stream=0|other=300|drop_later=False', 'water=False|stream=0|other=0|drop_later=True', 'water=True|stream=200|other=300|drop_later=True']:
        print('single rule ', k, 'ALL', score(R, k), 'test', score(test, k))
