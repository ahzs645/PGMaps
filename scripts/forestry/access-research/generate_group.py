"""Group rule: connect a block together with neighbouring blocks cut in the same period (+/- 2 years, within 1.5 km),
growing roads from the usable existing network to the cheapest unconnected block each time (a greedy Steiner tree).
Compares how much of the built road outside the block is reproduced (within 60 m) by single-block vs group generation.
"""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np, networkx as nx
from datetime import date
from multiprocessing import Pool
from shapely.geometry import shape, Point, LineString, mapping
from shapely.ops import unary_union, transform
from pyproj import Transformer
from generate_road import Grid, dijkstra, backtrack, network, existing_roads, lines, pair_files, attach_hydro, DEFAULTS
# v2 settings: water bodies impassable, 200 m penalty per order-3+ stream crossing
P_ = dict(DEFAULTS, A=5.0, GMAX=0.14, WATER=True, P_STREAM=200.0)
to_al = Transformer.from_crs(4326, 3005, always_xy=True).transform; to_ll = Transformer.from_crs(3005, 4326, always_xy=True).transform

def usable_network(P, blk, items):
    G, nodes, tree = network(items); win = blk.buffer(3000).envelope.exterior; ok = set()
    for comp in nx.connected_components(G):
        if sum(G.edges[e]['w'] for e in G.subgraph(comp).edges) >= 1000 or any(Point(n).distance(win) < 200 for n in comp): ok |= comp
    keep = []
    for g, c in items:
        if c['props']['LIFE_CYCLE_STATUS_CODE'] == 'RETIRED': continue
        ls = lines(g)
        if ls and nodes[tree.nearest(Point(ls[0].coords[0]))] in ok: keep.append(g)
    return unary_union(keep) if keep else None

def group_generate(P):
    blk = shape(P['block_geometry']); items = existing_roads(P)
    if not items: return None
    net = usable_network(P, blk, items)
    if net is None or net.is_empty or blk.distance(net) <= 20: return None
    start = date.fromisoformat(P['block']['DISTURBANCE_START_DATE'][:10])
    group = [blk]
    for b in P['nearby_blocks']:
        bp = b['props']; g = shape(b['geometry'])
        if not bp.get('DISTURBANCE_START_DATE') or g.distance(blk) > 1500 or g.intersection(blk).area > 0.2 * g.area: continue
        if abs((date.fromisoformat(bp['DISTURBANCE_START_DATE'][:10]) - start).days) <= 730 and g.distance(net) > 20: group.append(g)
    grid = Grid(unary_union(group).buffer(1300).bounds, P_['CELL'], cache_key=f"g{P['block']['OBJECTID']}")
    attach_hydro(grid, f"g{P['block']['OBJECTID']}", exclude=unary_union(group))
    def cells(geom, step=10):
        out = set()
        for l in lines(geom):
            n = max(1, int(l.length // step))
            for i in range(n + 1):
                q = l.interpolate(i / n, normalized=True)
                if grid.X[0, 0] - 30 <= q.x <= grid.X[0, -1] + 30 and grid.Y[0, 0] - 30 <= q.y <= grid.Y[-1, 0] + 30: out.add(grid.rc(q.x, q.y))
        return out
    sources = cells(net); built = []
    masks = [grid.mask(g) for g in group]; connected = [False] * len(group)
    for _ in range(len(group)):
        if not sources: break
        cost, pred = dijkstra(grid, list(sources), P_)
        best = None
        for i, m in enumerate(masks):
            if connected[i] or not m.any(): continue
            cm = np.where(m, cost, np.inf); k = np.unravel_index(np.argmin(cm), cm.shape)
            if np.isfinite(cm[k]) and (best is None or cm[k] < best[0]): best = (cm[k], i, k)
        if best is None: break
        _, i, (r, c) = best; connected[i] = True
        path = backtrack(grid, pred, r, c)
        if path is not None: built.append(path.simplify(10)); sources |= cells(path)
        sources |= set(zip(*np.nonzero(masks[i])))   # roads can continue from inside a connected block
    return dict(roads=unary_union(built) if built else None, group_size=len(group), connected=sum(connected))

def reproduced(real, gen, tol=60):
    if real.is_empty or real.length < 50 or gen is None or gen.is_empty: return 0.0
    return real.intersection(gen.buffer(tol)).length / real.length

def one(fp):
    P = json.load(open(fp)); pid = str(P['block']['OBJECTID'])
    try: g = group_generate(P)
    except Exception as e: return dict(pair=pid, error=str(e)[:80])
    if not g: return None
    blk = shape(P['block_geometry']); real = unary_union([shape(s['geometry']) for s in P['spur']]).difference(blk.buffer(30))
    return dict(pair=pid, group_size=g['group_size'], connected=g['connected'], group_reproduced=round(reproduced(real, g['roads']), 2),
                geometry=mapping(transform(to_ll, g['roads'])) if g['roads'] is not None else None)

if __name__ == '__main__':
    single = collections.defaultdict(list)
    for f in json.load(open(os.path.join(CACHE, 'generated.geojson')))['features']:
        if f['properties']['role'] == 'generated_access': single[f['properties']['pair']].append(transform(to_al, shape(f['geometry'])))
    shared = {r['pair'] for r in json.load(open(os.path.join(CACHE, 'shared_legs.json'))) if r['built_serves'].get('same_period', 0) + r['built_serves'].get('later', 0) > 0}
    with Pool(6) as pool: R = [r for r in pool.map(one, pair_files()) if r and 'error' not in r]
    files = {os.path.basename(f)[:-5]: f for f in pair_files()}
    for r in R:
        P = json.load(open(files[r['pair']])); blk = shape(P['block_geometry'])
        real = unary_union([shape(s['geometry']) for s in P['spur']]).difference(blk.buffer(30))
        r['single_reproduced'] = round(reproduced(real, unary_union(single[r['pair']]) if r['pair'] in single else None), 2)
        r['shared'] = r['pair'] in shared
    json.dump(R, open(os.path.join(CACHE, 'group_generated.json'), 'w'))
    for label, rs in (('all access pairs', R), ('legs shared with same-period/later blocks', [r for r in R if r['shared']]), ('other legs', [r for r in R if not r['shared']]), ('groups of 2+ blocks', [r for r in R if r['group_size'] > 1])):
        if not rs: continue
        print(f"{label}: n={len(rs)} | built road reproduced within 60 m, median single {np.median([r['single_reproduced'] for r in rs]):.0%} vs group {np.median([r['group_reproduced'] for r in rs]):.0%} | mean single {np.mean([r['single_reproduced'] for r in rs]):.0%} vs group {np.mean([r['group_reproduced'] for r in rs]):.0%}")
