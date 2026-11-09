"""Same-network cases: is the joined point closer, along the network, to an FSR (or the window edge) than the nearest point is?"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import networkx as nx
from shapely.geometry import shape, Point
from shapely.ops import unary_union, nearest_points, split, snap
from shapely.strtree import STRtree

def graph(items, tol=15):
    G = nx.Graph(); pts = []
    for gi, (g, c) in enumerate(items):
        for l in getattr(g, 'geoms', [g]):
            cs = list(l.coords)
            for a, b in zip(cs, cs[1:]):
                G.add_edge(a[:2], b[:2], w=Point(a).distance(Point(b)), fsr='Service Road' in (c['props']['FILE_TYPE_DESCRIPTION'] or ''))
    nodes = list(G.nodes); tree = STRtree([Point(n) for n in nodes])
    for i, n in enumerate(nodes):   # join line ends that meet within tol
        if G.degree(n) == 1:
            for j in tree.query(Point(n).buffer(tol)):
                if nodes[j] != n: G.add_edge(n, nodes[j], w=Point(n).distance(Point(nodes[j])), fsr=False)
    return G, nodes, tree
def nearest_node(nodes, tree, p): return nodes[tree.nearest(p)]

rows = []
M = {m['oid']: m for m in json.load(open(os.path.join(CACHE, 'pair_metrics.json')))}
NC = {r['oid']: r for r in json.load(open(os.path.join(CACHE, 'network_choice.json')))}
for oid, m in M.items():
    r = NC.get(oid)
    if not r or not r['same_network']: continue
    path = next(p for p in (os.path.join(CACHE, 'pairs', f'{oid}.json'), os.path.join(CACHE, 'expand', 'pairs', f'{oid}.json')) if os.path.exists(p))
    P = json.load(open(path)); blk = shape(P['block_geometry'])
    items = [(shape(c['geometry']), c) for c in P['context'] if c['geometry']]
    G, nodes, tree = graph(items)
    on = unary_union([g for g, _ in items if not blk.buffer(5).contains(g)]); pb, pn = nearest_points(blk, on)
    spur = unary_union([shape(s['geometry']) for s in P['spur']]); out = spur.difference(blk.buffer(30))
    j = nearest_points(on, out if not out.is_empty else spur)[0]
    a, b = nearest_node(nodes, tree, pn), nearest_node(nodes, tree, j)
    win = blk.buffer(3000).envelope
    targets = {n for u, v, d in G.edges(data=True) if d['fsr'] for n in (u, v)}
    kind = 'fsr'
    if not targets:
        targets = {n for n in nodes if Point(n).distance(win.exterior) < 150}; kind = 'window edge'
    if not targets: continue
    dist = nx.multi_source_dijkstra_path_length(G, targets, weight='w')
    if a not in dist or b not in dist: continue
    rows.append(dict(oid=oid, block=m['block'], to=kind, nearest_point=round(dist[a]), joined_point=round(dist[b]), leg=m.get('leg_len'), nearest_dist=m['nearest_road_dist'], alt_grade=m.get('alt_grade_max')))
for r in rows: print(r)
closer = sum(1 for r in rows if r['joined_point'] < r['nearest_point'] - 100)
farther = sum(1 for r in rows if r['joined_point'] > r['nearest_point'] + 100)
print(f'{len(rows)} same-network cases: joined point closer to the outlet by >100 m: {closer} | farther: {farther} | about the same: {len(rows) - closer - farther}')
total_saved = [r['nearest_point'] - r['joined_point'] for r in rows]
extra_leg = [ (r['leg'] or 0) - r['nearest_dist'] for r in rows]
print('haul saved on the network (m):', total_saved)
print('extra spur built vs nearest  (m):', extra_leg)
