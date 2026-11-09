"""How much of each built road outside the block lies within 150 m / 300 m of the generated single-block and group roads."""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape
from shapely.ops import unary_union, transform
from pyproj import Transformer
from generate_road import pair_files
to_al = Transformer.from_crs(4326, 3005, always_xy=True).transform
single = collections.defaultdict(list)
for f in json.load(open(os.path.join(CACHE, 'generated.geojson')))['features']:
    if f['properties']['role'] == 'generated_access': single[f['properties']['pair']].append(transform(to_al, shape(f['geometry'])))
G = {r['pair']: r for r in json.load(open(os.path.join(CACHE, 'group_generated.json')))}
files = {os.path.basename(f)[:-5]: f for f in pair_files()}
rows = []
for pid, r in G.items():
    P = json.load(open(files[pid])); blk = shape(P['block_geometry'])
    real = unary_union([shape(s['geometry']) for s in P['spur']]).difference(blk.buffer(30))
    if real.length < 50: continue
    s = unary_union(single[pid]) if pid in single else None; g = transform(to_al, shape(r['geometry'])) if r.get('geometry') else None
    rep = lambda gen, t: 0 if gen is None or gen.is_empty else real.intersection(gen.buffer(t)).length / real.length
    rows.append((r['shared'], rep(s, 150), rep(g, 150), rep(s, 300), rep(g, 300)))
a = np.array([x[1:] for x in rows]); sh = np.array([x[0] for x in rows])
for lab, m in (('all', np.ones(len(rows), bool)), ('legs shared with same-period/later blocks', sh), ('other legs', ~sh)):
    print(f'{lab}: n={m.sum()} | within 150 m: single {a[m,0].mean():.0%}, group {a[m,1].mean():.0%} | within 300 m: single {a[m,2].mean():.0%}, group {a[m,3].mean():.0%} | pairs with >=50% within 150 m: single {np.mean(a[m,0]>=.5):.0%}, group {np.mean(a[m,1]>=.5):.0%}')
