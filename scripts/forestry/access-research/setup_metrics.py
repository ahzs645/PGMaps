"""How a whole setup (licence + cutting permit) is roaded: blocks, spread, connections to the network, shared mainline vs spurs."""
import os, sys, json, glob, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np, networkx as nx
from datetime import date
from shapely.geometry import shape, Point, MultiPoint
from shapely.ops import unary_union
from shapely.strtree import STRtree
from generate_road import lines

def graph(geoms, tol=15):
    G = nx.Graph()
    for g in geoms:
        for l in lines(g):
            cs = [c[:2] for c in l.coords]
            for a, b in zip(cs, cs[1:]): G.add_edge(a, b, w=math.dist(a, b))
    nodes = list(G.nodes); tree = STRtree([Point(n) for n in nodes])
    for n in nodes:
        if G.degree(n) == 1:
            for j in tree.query(Point(n).buffer(tol)):
                if nodes[j] != n: G.add_edge(n, nodes[j], w=math.dist(n, nodes[j]))
    return G, nodes, tree

out = []
for f in sorted(glob.glob(os.path.join(CACHE, 'setups', '*.json'))):
    S = json.load(open(f))
    if S.get('skipped') or not S.get('blocks'): continue
    blks = [(shape(b['geometry']), b['props']) for b in S['blocks']]
    U = unary_union([g for g, _ in blks])
    starts = sorted(date.fromisoformat(p['DISTURBANCE_START_DATE'][:10]) for _, p in blks if p['DISTURBANCE_START_DATE'])
    cents = [g.centroid for g, _ in blks]
    m = dict(setup=f"{S['licence']} {S['cp'] or ''}".strip(), n_blocks=len(blks), area_ha=round(U.area / 1e4, 1),
             span_m=round(max((a.distance(b) for a in cents for b in cents), default=0)),
             harvest_years=round((starts[-1] - starts[0]).days / 365.25, 1) if len(starts) > 1 else 0.0)
    named = unary_union([shape(r['geometry']) for r in S['named']]) if S['named'] else None
    other = unary_union([shape(r['geometry']) for r in S['other']]) if S['other'] else None
    m['named_road_m'] = round(named.length) if named else 0
    m['named_sections'] = len(S['named']); m['road_permits'] = len({r['props']['FOREST_FILE_ID'] for r in S['named']})
    m['named_why'] = dict(collections.Counter(r['why'] for r in S['named']))
    m['blocks_on_named_road'] = sum(1 for g, _ in blks if named is not None and g.distance(named) <= 20)
    m['blocks_on_other_road_only'] = sum(1 for g, _ in blks if (named is None or g.distance(named) > 20) and other is not None and g.distance(other) <= 20)
    m['blocks_no_road'] = m['n_blocks'] - m['blocks_on_named_road'] - m['blocks_on_other_road_only']
    if named is not None and other is not None:
        G, nodes, tree = graph([named])
        conn = [n for n in nodes if Point(n).distance(other) <= 15 and not U.buffer(30).contains(Point(n))]
        # cluster connection points within 100 m
        clusters = []
        for n in conn:
            if not any(math.dist(n, c) < 100 for c in clusters): clusters.append(n)
        m['connections'] = len(clusters)
        if clusters:
            G.add_node('SRC')
            for n in conn: G.add_edge('SRC', n, w=0.0)
            usage = collections.Counter(); per_block = []
            for g, p in blks:
                if g.distance(named) > 20: continue
                tg = [n for n in nodes if g.buffer(20).contains(Point(n))]
                if not tg: continue
                dist, paths = nx.single_source_dijkstra(G, 'SRC', weight='w')
                t = min((n for n in tg if n in dist), key=lambda n: dist[n], default=None)
                if t is None: continue
                path = paths[t]; per_block.append(dist[t])
                for a, b in zip(path, path[1:]):
                    if 'SRC' not in (a, b): usage[frozenset((a, b))] += 1
            if per_block:
                L = lambda e: math.dist(*tuple(e)) if len(e) == 2 else 0
                shared = sum(L(e) for e, k in usage.items() if k >= 2); single = sum(L(e) for e, k in usage.items() if k == 1)
                m.update(blocks_routed=len(per_block), mainline_m=round(shared), spur_m=round(single), sum_separate_paths_m=round(sum(per_block)),
                         network_used_m=round(shared + single))
    out.append(m)
json.dump(out, open(os.path.join(CACHE, 'setup_metrics.json'), 'w'), indent=1)
q = lambda k, rs: (lambda v: f"n={len(v)} p25={np.percentile(v,25):.0f} median={np.median(v):.0f} p75={np.percentile(v,75):.0f} p90={np.percentile(v,90):.0f}" if v else 'n=0')([r[k] for r in rs if r.get(k) is not None])
print('setups measured:', len(out), '| skipped (over 15 km):', len(glob.glob(os.path.join(CACHE, 'setups', '*.json'))) - len(out))
print('blocks per setup      ', q('n_blocks', out)); print('setup area ha         ', q('area_ha', out)); print('span between blocks m ', q('span_m', out))
print('harvest spread years  ', q('harvest_years', out))
multi = [r for r in out if r['n_blocks'] >= 2]
print(f'setups with 2+ blocks: {len(multi)}')
print(' named road per setup m', q('named_road_m', multi)); print(' road permits per setup', q('road_permits', multi))
print(' connections to network', q('connections', multi), dict(collections.Counter(r.get('connections') for r in multi)))
tot = lambda k, rs: sum(r[k] for r in rs)
print(f" blocks on the setup's named roads {tot('blocks_on_named_road', multi)} | on other roads only {tot('blocks_on_other_road_only', multi)} | no road {tot('blocks_no_road', multi)} (of {tot('n_blocks', multi)})")
rt = [r for r in multi if r.get('blocks_routed', 0) >= 2]
print(f' setups with 2+ blocks routed on named roads: {len(rt)}')
print('  mainline share of road used', q('mainline_pct', [dict(mainline_pct=100 * r['mainline_m'] / r['network_used_m']) for r in rt if r['network_used_m']]))
print('  separate paths / network used', q('ratio', [dict(ratio=100 * r['sum_separate_paths_m'] / r['network_used_m']) for r in rt if r['network_used_m']]), '(x100)')
