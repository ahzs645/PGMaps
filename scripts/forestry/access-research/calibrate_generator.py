"""Calibrate the access-leg rule (grade penalty A, grade cap GMAX, haul weight W_HAUL) against built roads.

Split by licence (hash) into train/test so a shared road system cannot appear on both sides.
Metric: distance from the generated joining point to the real junction; baseline = the network's nearest point.
"""
import os, sys, json, zlib, itertools, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np, networkx as nx
from multiprocessing import Pool
from shapely.geometry import shape, Point
from shapely.ops import unary_union, nearest_points, linemerge
from generate_road import Grid, dijkstra, network, existing_roads, lines, pair_files, DEFAULTS

AS, GMAXS, WS = [5.0, 15.0, 40.0], [0.14, 0.18, 0.24], [0.0, 0.03, 0.1, 0.3, 1.0]

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
    nb, nn = nearest_points(blk, net)
    G, nodes, tree = network(items); win = blk.buffer(3000).envelope.exterior
    ok = set()
    for comp in nx.connected_components(G):
        if sum(G.edges[e]['w'] for e in G.subgraph(comp).edges) >= 1000 or any(Point(n).distance(win) < 200 for n in comp): ok |= comp
    cands = []
    for g, c in items:
        if c['props']['LIFE_CYCLE_STATUS_CODE'] == 'RETIRED' or g.distance(blk) > 1000: continue
        for l in lines(g):
            n = max(1, int(l.length // 40))
            for i in range(n + 1):
                q = l.interpolate(i / n, normalized=True)
                if q.distance(blk) <= 1000:
                    node = nodes[tree.nearest(q)]
                    if node in ok: cands.append((q, node))
    if not cands: return None
    targets = {n for u, v, d in G.edges(data=True) if d['fsr'] for n in (u, v)} or {n for n in nodes if Point(n).distance(win) < 200}
    haul = nx.multi_source_dijkstra_path_length(G, targets, weight='w') if targets else {}
    grid = Grid(blk.buffer(1300).bounds, DEFAULTS['CELL'], cache_key=P['block']['OBJECTID'])
    src = list(zip(*np.nonzero(grid.mask(blk))))
    res = dict(oid=P['block']['OBJECTID'], licence=P['block']['HARVEST_AUTH_FOREST_FILE_ID'], nearest_error=nn.distance(j), results={})
    for A, GM in itertools.product(AS, GMAXS):
        cost, _ = dijkstra(grid, src, dict(DEFAULTS, A=A, GMAX=GM))
        cb = [(cost[grid.rc(q.x, q.y)], haul.get(node, 5000.0), q) for q, node in cands]
        cb = [x for x in cb if np.isfinite(x[0])]
        for W in WS:
            if not cb: res['results'][f'{A}|{GM}|{W}'] = None; continue
            b = min(cb, key=lambda x: x[0] + W * x[1]); res['results'][f'{A}|{GM}|{W}'] = b[2].distance(j)
    return res

if __name__ == '__main__':
    with Pool(6) as pool: R = [r for r in pool.map(one, pair_files()) if r]
    json.dump(R, open(os.path.join(CACHE, 'calibration.json'), 'w'))
    train = [r for r in R if zlib.crc32(r['licence'].encode()) % 2 == 0]; test = [r for r in R if zlib.crc32(r['licence'].encode()) % 2 == 1]
    def score(rs, key):
        e = np.array([r['results'][key] if r['results'].get(key) is not None else 5000 for r in rs])
        return np.median(e), (e <= 150).mean(), (e <= 300).mean()
    print(f'pairs with an access leg: {len(R)} | train {len(train)} | test {len(test)}')
    keys = list(R[0]['results'].keys())
    ranked = sorted(keys, key=lambda k: (-score(train, k)[1], score(train, k)[0]))
    print('top settings on train (A|GMAX|W_HAUL): median error, share within 150 m, within 300 m')
    for k in ranked[:6]: print('  ', k, [round(x, 2) for x in score(train, k)])
    best = ranked[0]
    ne = lambda rs: (np.median([r['nearest_error'] for r in rs]), np.mean([r['nearest_error'] <= 150 for r in rs]), np.mean([r['nearest_error'] <= 300 for r in rs]))
    print('TEST best', best, [round(x, 2) for x in score(test, best)], '| nearest-point baseline', [round(x, 2) for x in ne(test)])
    print('ALL  best', best, [round(x, 2) for x in score(R, best)], '| nearest-point baseline', [round(x, 2) for x in ne(R)])
    print('W_HAUL=0 (grade only) on test at best A|GMAX:', [round(x, 2) for x in score(test, '|'.join(best.split('|')[:2] + ['0.0']))])
