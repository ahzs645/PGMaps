"""Setup-level generation: connect every block of a setup either (a) independently to its own best existing road,
or (b) to one common host road chosen to minimise the setup's total cost. Version 2 costs (water barrier,
order-3+ stream penalty, grade). Scored against the setup's named roads outside its blocks."""
import os, sys, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from multiprocessing import Pool
from shapely.geometry import shape, Point, LineString, mapping
from shapely.ops import unary_union, transform
from pyproj import Transformer
from generate_road import Grid, dijkstra, backtrack, lines, attach_hydro, DEFAULTS
P_ = dict(DEFAULTS, A=5.0, GMAX=0.14, WATER=True, P_STREAM=200.0, CELL=25.0)
to_ll = Transformer.from_crs(3005, 4326, always_xy=True).transform

def one(f):
    S = json.load(open(f))
    if S.get('skipped') or not (2 <= len(S.get('blocks', [])) <= 8) or not S['named'] or not S['other']: return None
    blks = [shape(b['geometry']) for b in S['blocks']]; U = unary_union(blks)
    if max(U.bounds[2] - U.bounds[0], U.bounds[3] - U.bounds[1]) > 6000: return None
    hosts = collections.defaultdict(list)
    for r in S['other']:
        g = shape(r['geometry'])
        if r['props']['LIFE_CYCLE_STATUS_CODE'] == 'RETIRED' or g.distance(U) > 1000: continue
        hosts[r['props']['FOREST_FILE_ID']].append(g)
    if not hosts: return None
    key = 's' + os.path.basename(f)[:-5]
    grid = attach_hydro(Grid(U.buffer(1200).bounds, P_['CELL'], cache_key=key), key, exclude=U)
    allowed = grid.mask(U.buffer(1200))
    def cells(geom):
        out = set()
        for l in lines(geom):
            n = max(1, int(l.length // 12))
            for i in range(n + 1):
                q = l.interpolate(i / n, normalized=True); r, c = grid.rc(q.x, q.y)
                if allowed[r, c]: out.add((r, c))
        return out
    host_cells = {h: cells(unary_union(gs)) for h, gs in hosts.items()}
    allnet = unary_union([g for gs in hosts.values() for g in gs])
    need = [i for i, b in enumerate(blks) if b.distance(allnet) > 20]     # blocks already on a road get no access leg
    costs = {}; preds = {}
    for i in need:
        cost, pred = dijkstra(grid, list(zip(*np.nonzero(grid.mask(blks[i])))), P_, allowed)
        costs[i], preds[i] = cost, pred
    def best_cell(i, h):
        cs = host_cells[h]
        if not cs: return None
        k = min(cs, key=lambda rc: costs[i][rc]); return (costs[i][k], k) if np.isfinite(costs[i][k]) else None
    table = {(i, h): best_cell(i, h) for i in need for h in host_cells}
    def path(i, k): return backtrack(grid, preds[i], *k)
    indep, indep_host = [], {}
    for i in need:
        opts = [(v[0], h, v[1]) for h in host_cells if (v := table[(i, h)])]
        if opts:
            c, h, k = min(opts); indep_host[i] = h; p = path(i, k); indep.append(p) if p is not None else None
    tot = {h: sum(table[(i, h)][0] if table[(i, h)] else 1e7 for i in need) for h in host_cells}
    common_h = min(tot, key=tot.get) if tot else None; common = []
    for i in need:
        v = table[(i, common_h)]
        if v: p = path(i, v[1]); common.append(p) if p is not None else None
    named = unary_union([shape(r['geometry']) for r in S['named']]).difference(U.buffer(30))
    # real hosts: existing road permits the named roads meet outside the blocks
    real_hosts = collections.Counter()
    for r in S['named']:
        for l in lines(shape(r['geometry'])):
            for c in (l.coords[0], l.coords[-1]):
                p = Point(c[:2])
                if U.buffer(30).contains(p): continue
                near = [(g.distance(p), h) for h, gs in hosts.items() for g in gs if g.distance(p) <= 15]
                if near: real_hosts[min(near)[1]] += 1
    def agree(gen, t):
        gu = unary_union(gen) if gen else None
        return 0.0 if gu is None or gu.is_empty or named.length < 50 else named.intersection(gu.buffer(t)).length / named.length
    top_real = real_hosts.most_common(1)[0][0] if real_hosts else None
    return dict(setup=os.path.basename(f)[:-5], n_blocks=len(blks), needing_access=len(need), real_hosts=dict(real_hosts), top_real_host=top_real, common_host=common_h,
                common_host_is_real_top=common_h == top_real if top_real else None,
                indep_host_in_real=float(np.mean([indep_host[i] in real_hosts for i in indep_host])) if indep_host and real_hosts else None,
                named_out_m=round(named.length), indep_m=round(sum(p.length for p in indep)), common_m=round(sum(p.length for p in common)),
                indep_150=agree(indep, 150), common_150=agree(common, 150), indep_300=agree(indep, 300), common_300=agree(common, 300),
                common_geom=mapping(transform(to_ll, unary_union(common))) if common else None)

if __name__ == '__main__':
    with Pool(6) as pool: R = [r for r in pool.map(one, sorted(glob.glob(os.path.join(CACHE, 'setups', '*.json')))) if r]
    json.dump(R, open(os.path.join(CACHE, 'setup_generated.json'), 'w'))
    rs = [r for r in R if r['needing_access'] and r['named_out_m'] >= 50 and r['real_hosts']]
    print(f'setups generated: {len(R)} | with access needed and a real host: {len(rs)}')
    print(f"common host = the setup's most-used real host road: {np.mean([r['common_host_is_real_top'] for r in rs]):.0%}")
    print(f"independent: share of blocks whose chosen host road is one the setup really joined: {np.mean([r['indep_host_in_real'] for r in rs if r['indep_host_in_real'] is not None]):.0%}")
    for t in (150, 300):
        print(f"named road outside blocks within {t} m of generated: independent {np.mean([r[f'indep_{t}'] for r in rs]):.0%} | common host {np.mean([r[f'common_{t}'] for r in rs]):.0%}")
    print(f"generated length / named length: independent {np.median([r['indep_m']/r['named_out_m'] for r in rs]):.2f} | common {np.median([r['common_m']/r['named_out_m'] for r in rs]):.2f}")
