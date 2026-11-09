"""Generate a road for a block from the observed rules, with the block's real road removed, and score it against what was built.

Rules (section 8 of the research note):
  1. If an existing road already reaches the block (<= 20 m), build no access leg.
  2. Otherwise consider joining points every 40 m along existing roads within 1 km, skipping retired roads and
     small isolated fragments (< 1 km of connected road that does not leave the 3 km window).
  3. Cost a new road by length times a grade penalty: (1 + A * max(0, grade - G0)); grades above GMAX are blocked.
  4. Score each joining point by build cost + W_HAUL * haul distance along the network to an FSR (or the window edge).
  5. Inside the block, add contour-following roads (same grade penalty) until TARGET of the block is within REACH m.
"""
import os, sys, json, heapq, math, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
import networkx as nx
from shapely.geometry import shape, Point, LineString, MultiLineString
from shapely.ops import unary_union, nearest_points, linemerge
from shapely.strtree import STRtree
from dem import elevation

DEFAULTS = dict(CELL=20.0, G0=0.06, A=15.0, GMAX=0.18, W_HAUL=0.1, REACH=300.0, TARGET=0.8, MAX_BRANCHES=6,
                WATER=False, P_STREAM=0.0, L_OTHER=0.0, DROP_LATER_PERMITS=False,
                IN_BLOCK='v1')   # 'v3': slope-class reach targets and contour grade cap from the layout study
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def lines(g): return [g] if g.geom_type == 'LineString' else [l for l in getattr(g, 'geoms', []) if l.geom_type == 'LineString']

class Grid:
    def __init__(self, bounds, cell, cache_key=None):
        minx, miny, maxx, maxy = bounds; self.cell = cell; self.x0, self.y0 = minx, miny
        self.nx, self.ny = int((maxx - minx) // cell) + 1, int((maxy - miny) // cell) + 1
        xs = minx + (np.arange(self.nx) + 0.5) * cell; ys = miny + (np.arange(self.ny) + 0.5) * cell
        X, Y = np.meshgrid(xs, ys); self.X, self.Y = X, Y
        f = os.path.join(CACHE, 'grids', f'{cache_key}_{int(cell)}.npy') if cache_key else None
        if f and os.path.exists(f): self.Z = np.load(f)
        else:
            self.Z = elevation(X.ravel(), Y.ravel()).reshape(X.shape)
            if f: os.makedirs(os.path.dirname(f), exist_ok=True); np.save(f, self.Z)
    def rc(self, x, y): return (min(self.ny - 1, max(0, int((y - self.y0) // self.cell))), min(self.nx - 1, max(0, int((x - self.x0) // self.cell))))
    def xy(self, r, c): return (self.X[r, c], self.Y[r, c])
    def mask(self, geom):
        from shapely import contains_xy
        return contains_xy(geom, self.X, self.Y)

HYDRO_LAYERS = {'wetland': 'WHSE_BASEMAPPING.FWA_WETLANDS_POLY', 'lake': 'WHSE_BASEMAPPING.FWA_LAKES_POLY',
                'river': 'WHSE_BASEMAPPING.FWA_RIVERS_POLY', 'reservoir': 'WHSE_BASEMAPPING.FWA_MANMADE_WATERBODIES_POLY'}
def attach_hydro(grid, key, exclude=None):
    """Mark water polygons as blocked and cells on order-3+ streams as crossings (cached per key)."""
    from wfs import features
    f = os.path.join(CACHE, 'hydro', f'{key}.json')
    minx, miny = grid.x0, grid.y0; maxx, maxy = minx + grid.nx * grid.cell, miny + grid.ny * grid.cell
    bb = f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')"
    if os.path.exists(f): H = json.load(open(f))
    else:
        H = {k: [x['geometry'] for x in features(t, bb, ['GEOMETRY'], srs='EPSG:3005') if x['geometry']] for k, t in HYDRO_LAYERS.items()}
        H['stream3'] = [x['geometry'] for x in features('WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP', bb + ' AND STREAM_ORDER >= 3', ['GEOMETRY'], srs='EPSG:3005') if x['geometry']]
        os.makedirs(os.path.dirname(f), exist_ok=True); json.dump(H, open(f, 'w'))
    water = unary_union([shape(g) for k in HYDRO_LAYERS for g in H[k]]) if any(H[k] for k in HYDRO_LAYERS) else None
    if water is not None and exclude is not None: water = water.difference(exclude)
    grid.blocked = grid.mask(water) if water is not None and not water.is_empty else np.zeros_like(grid.Z, bool)
    st = np.zeros_like(grid.Z, bool)
    for g in H['stream3']:
        for l in lines(shape(g)):
            n = max(1, int(l.length // (grid.cell / 2)))
            for i in range(n + 1):
                q = l.interpolate(i / n, normalized=True)
                if grid.x0 <= q.x < grid.x0 + grid.nx * grid.cell and grid.y0 <= q.y < grid.y0 + grid.ny * grid.cell: st[grid.rc(q.x, q.y)] = True
    grid.stream3 = st
    return grid

def dijkstra(grid, sources, p, allowed=None):
    """Multi-source least-cost over the grid; returns cost array and predecessor index."""
    ny, nx_ = grid.ny, grid.nx; cost = np.full((ny, nx_), np.inf); pred = np.full((ny, nx_), -1, dtype=np.int64)
    h = []
    for r, c in sources:
        if cost[r, c] > 0: cost[r, c] = 0; heapq.heappush(h, (0.0, r, c))
    Z = grid.Z; cell = grid.cell; G0, A, GMAX = p['G0'], p['A'], p['GMAX']
    blocked = getattr(grid, 'blocked', None) if p.get('WATER') else None
    st = getattr(grid, 'stream3', None) if p.get('P_STREAM') else None; PS = p.get('P_STREAM', 0.0)
    while h:
        d, r, c = heapq.heappop(h)
        if d > cost[r, c]: continue
        for dr, dc in NB:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= ny or cc >= nx_: continue
            if allowed is not None and not allowed[rr, cc]: continue
            if blocked is not None and blocked[rr, cc]: continue
            L = cell * (1.4142135 if dr and dc else 1.0); g = abs(Z[rr, cc] - Z[r, c]) / L
            if g > GMAX: continue
            nd = d + L * (1 + A * max(0.0, g - G0))
            if st is not None and st[rr, cc] and not st[r, c]: nd += PS
            if nd < cost[rr, cc]: cost[rr, cc] = nd; pred[rr, cc] = r * nx_ + c; heapq.heappush(h, (nd, rr, cc))
    return cost, pred

def backtrack(grid, pred, r, c):
    pts = [grid.xy(r, c)]
    while pred[r, c] >= 0:
        k = pred[r, c]; r, c = divmod(int(k), grid.nx); pts.append(grid.xy(r, c))
    return LineString(pts) if len(pts) > 1 else None

def network(items, tol=15):
    G = nx.Graph()
    for g, c in items:
        fsr = 'Service Road' in (c['props']['FILE_TYPE_DESCRIPTION'] or '')
        for l in lines(g):
            cs = list(l.coords)
            for a, b in zip(cs, cs[1:]): G.add_edge(a[:2], b[:2], w=math.dist(a[:2], b[:2]), fsr=fsr)
    nodes = list(G.nodes); tree = STRtree([Point(n) for n in nodes])
    for n in nodes:
        if G.degree(n) == 1:
            for j in tree.query(Point(n).buffer(tol)):
                if nodes[j] != n: G.add_edge(n, nodes[j], w=math.dist(n, nodes[j]), fsr=False)
    return G, nodes, tree

def existing_roads(P):
    start = (P['block']['DISTURBANCE_START_DATE'] or '')[:10]
    later = lambda c: any((x['start'] or '9999')[:10] > str(np.datetime64(start) + np.timedelta64(90, 'D')) for x in c.get('names_block') or [] if x['start'])
    return [(shape(c['geometry']), c) for c in P['context'] if c['geometry'] and not later(c)]

def permitted_after(c, start):
    a = (c['props'].get('AWARD_DATE') or '')[:10]
    return bool(a) and a > start

def is_placeholder(blk):
    """FTEN stores an unmapped block as a ~0.6 ha triangle; generate nothing for it (layout study rule R11)."""
    if blk.geom_type != 'Polygon': return False
    ratio = 4 * math.pi * blk.area / blk.length ** 2
    return 5500 <= blk.area <= 6500 and len(blk.exterior.coords) <= 5 and 0.55 <= ratio <= 0.65

def block_slope(grid, blk):
    m = grid.mask(blk)
    gy, gx = np.gradient(grid.Z, grid.cell)
    s = np.hypot(gx, gy)[m] * 100
    return float(s.mean()) if s.size else 0.0

def in_block_targets(p, grid, blk):
    if p.get('IN_BLOCK') != 'v3': return p['REACH'], p['TARGET'], p['A'] * 2, p['GMAX'], None  # v1: section 8 targets
    slope = block_slope(grid, blk)
    if slope < 15: return 175.0, 0.9, p['A'] * 3, 0.10, slope    # flat: 90% within 175 m (R3)
    return 150.0, 0.9, p['A'] * 3, 0.10, slope                    # sloped: 90% within 150 m; hold contours, cap 10% (R4)

def generate(P, p=DEFAULTS, grid=None):
    blk = shape(P['block_geometry']); items = existing_roads(P)
    if not items: return None
    oid = P['block']['OBJECTID']
    grid = grid or Grid(blk.buffer(1300).bounds, p['CELL'], cache_key=oid)
    if p.get('WATER') or p.get('P_STREAM'): attach_hydro(grid, oid, exclude=blk)
    out = dict(oid=oid)
    if is_placeholder(blk): return dict(oid=oid, placeholder=True)
    net_all = unary_union([g for g, _ in items])
    in_blk = grid.mask(blk)
    roads = [g for g, _ in items if g.distance(blk) <= 20]
    if blk.distance(net_all) <= 20:
        out['access'] = None
    else:
        # usable network: drop retired roads and small closed fragments
        G, nodes, tree = network(items)
        win = blk.buffer(3000).envelope.exterior
        comp_ok = set()
        for comp in nx.connected_components(G):
            length = sum(G.edges[e]['w'] for e in G.subgraph(comp).edges)
            if length >= 1000 or any(Point(n).distance(win) < 200 for n in comp): comp_ok |= comp
        start = (P['block']['DISTURBANCE_START_DATE'] or '')[:10]; client = P['block'].get('CLIENT_NUMBER')
        usable = [(g, c) for g, c in items if c['props']['LIFE_CYCLE_STATUS_CODE'] != 'RETIRED' and g.distance(blk) <= 1000
                  and not (p.get('DROP_LATER_PERMITS') and permitted_after(c, start))]
        cands = []
        for g, c in usable:
            for l in lines(g):
                n = max(1, int(l.length // 40))
                for i in range(n + 1):
                    q = l.interpolate(i / n, normalized=True)
                    if q.distance(blk) <= 1000:
                        node = nodes[tree.nearest(q)]
                        other = c['props']['FILE_TYPE_CODE'] == 'B01' and c['props'].get('CLIENT_NUMBER') != client
                        if node in comp_ok: cands.append((q, node, other))
        if not cands: return None
        targets = {n for u, v, d in G.edges(data=True) if d['fsr'] for n in (u, v)} or {n for n in nodes if Point(n).distance(win) < 200}
        haul = nx.multi_source_dijkstra_path_length(G, targets, weight='w') if targets else {}
        src = list(zip(*np.nonzero(in_blk)))
        cost, pred = dijkstra(grid, src, p)
        best = None
        for q, node, other in cands:
            r, c = grid.rc(q.x, q.y); b = cost[r, c]
            if not np.isfinite(b): continue
            s = b + p['W_HAUL'] * haul.get(node, 5000.0) + (p.get('L_OTHER', 0.0) if other else 0.0)
            if best is None or s < best[0]: best = (s, q, r, c, b)
        if best is None: return None
        _, q, r, c, b = best
        leg = backtrack(grid, pred, r, c)
        if leg is None: return None
        leg = LineString([(q.x, q.y)] + list(leg.coords)).simplify(10)
        out.update(access=leg, junction=q, build_cost=b)
        roads.append(leg)
    # in-block layout: contour-following branches until TARGET of the block is within REACH
    pts = np.column_stack([grid.X[in_blk], grid.Y[in_blk]])
    allowed = grid.mask(blk.buffer(60))
    REACH, TARGET, A_IN, GMAX_IN, slope = in_block_targets(p, grid, blk)
    out['block_slope'] = slope
    branches = []
    for _ in range(p['MAX_BRANCHES'] * (2 if p.get('IN_BLOCK') == 'v3' else 1)):
        net = unary_union(roads + branches)
        from shapely import distance as sdist, points as spts
        d = sdist(spts(pts), net)
        if len(d) == 0 or (d <= REACH).mean() >= TARGET: break
        far = pts[int(np.argmax(d))]
        src = [grid.rc(x, y) for l in lines(net.intersection(blk.buffer(60))) for x, y in l.coords] or [grid.rc(*nearest_points(net, Point(far))[0].coords[0])]
        # v3 holds contours with a strong penalty above 6% (A_IN) and only a loose hard cap, so steep blocks stay reachable
        gmax_in = 0.35 if p.get('IN_BLOCK') == 'v3' else p['GMAX']
        cost, pred = dijkstra(grid, src, dict(p, A=A_IN, GMAX=gmax_in), allowed)
        r, c = grid.rc(*far)
        if not np.isfinite(cost[r, c]): break
        br = backtrack(grid, pred, r, c)
        if br is None: break
        # stop the branch REACH/2 short of the far point: the road only needs to bring it within reach
        cut = max(0.0, br.length - REACH / 2)
        from shapely.ops import substring
        br = substring(br, 0, cut).simplify(10) if cut > 20 else None
        if br is None or br.length < 40: break
        branches.append(br)
    out['in_block'] = unary_union(branches) if branches else None
    allr = unary_union(roads + branches)
    from shapely import distance as sdist, points as spts
    dd = sdist(spts(pts), allr) if len(pts) else None
    out['coverage'] = float((dd <= REACH).mean()) if len(pts) else None
    out['reach_p90'] = float(np.percentile(dd, 90)) if len(pts) else None
    out['in_block_m_per_ha'] = (allr.intersection(blk).length / (blk.area / 1e4)) if blk.area else None
    return out

def compare(P, gen):
    """Generated vs built: junction distance, leg length ratio, mean separation; in-block length."""
    blk = shape(P['block_geometry']); built = unary_union([shape(s['geometry']) for s in P['spur']])
    m = dict(oid=P['block']['OBJECTID'])
    items = existing_roads(P); net = unary_union([g for g, _ in items]) if items else None
    built_out = built.difference(blk.buffer(10))
    if gen.get('access') is not None and net is not None:
        merged = linemerge(built) if built.geom_type == 'MultiLineString' else built
        ends = [Point(c) for l in lines(merged) for c in (l.coords[0], l.coords[-1])]
        j = min(ends, key=lambda e: e.distance(net)) if ends else None
        nb, nn = nearest_points(blk, net)
        if j is not None and j.distance(net) <= 25:
            m['junction_error'] = round(gen['junction'].distance(j)); m['nearest_point_error'] = round(nn.distance(j))
        leg = gen['access']
        if built_out.length > 50:
            m['leg_len_ratio'] = round(leg.length / built_out.length, 2)
            s = [leg.interpolate(t, normalized=True).distance(built_out) for t in np.linspace(0, 1, 25)]
            m['leg_mean_separation'] = round(float(np.mean(s)))
            straight = LineString([nb, nn]); s2 = [straight.interpolate(t, normalized=True).distance(built_out) for t in np.linspace(0, 1, 25)]
            m['straight_mean_separation'] = round(float(np.mean(s2)))
    m['access_generated'] = gen.get('access') is not None
    m['access_built'] = built_out.length > 50
    bi = built.intersection(blk.buffer(10)).length
    gi = (gen['in_block'].length if gen.get('in_block') is not None else 0) + (gen['access'].intersection(blk.buffer(10)).length if gen.get('access') is not None else 0)
    m.update(in_block_built=round(bi), in_block_generated=round(gi), coverage=round(gen['coverage'], 2) if gen.get('coverage') is not None else None)
    return m

def pair_files():
    return sorted({os.path.basename(f): f for d in (os.path.join(CACHE, 'pairs'), os.path.join(CACHE, 'expand', 'pairs')) for f in glob.glob(os.path.join(d, '*.json'))}.values())

if __name__ == '__main__':
    f = sys.argv[1]; P = json.load(open(f)); g = generate(P)
    print(json.dumps(compare(P, g)) if g else 'no network')
