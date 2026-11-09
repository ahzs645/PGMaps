"""Do built access legs pass other blocks (serving them too) more than the generated shortest legs do?"""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from datetime import date
from shapely.geometry import shape
from shapely.ops import unary_union, transform
from pyproj import Transformer
from generate_road import pair_files
to_al = Transformer.from_crs(4326, 3005, always_xy=True).transform
G = collections.defaultdict(list)
for f in json.load(open(os.path.join(CACHE, 'generated.geojson')))['features']:
    if f['properties']['role'] == 'generated_access': G[f['properties']['pair']].append(transform(to_al, shape(f['geometry'])))
S = {str(s['oid']): s for s in json.load(open(os.path.join(CACHE, 'generated_scores.json')))}
rows = []
for fp in pair_files():
    P = json.load(open(fp)); pid = str(P['block']['OBJECTID']); s = S.get(pid)
    if pid not in G or not s or 'junction_error' not in s: continue
    blk = shape(P['block_geometry']); start = date.fromisoformat(P['block']['DISTURBANCE_START_DATE'][:10])
    built = unary_union([shape(x['geometry']) for x in P['spur']]).difference(blk.buffer(30)); gen = unary_union(G[pid]).difference(blk.buffer(30))
    def served(leg):
        n = collections.Counter()
        for b in P['nearby_blocks']:
            bp = b['props']; g = shape(b['geometry'])
            if not bp.get('DISTURBANCE_START_DATE') or g.intersection(blk).area > 0.2 * g.area or leg.is_empty or leg.distance(g) > 30: continue
            dy = (date.fromisoformat(bp['DISTURBANCE_START_DATE'][:10]) - start).days / 365.25
            n['earlier' if dy < -2 else 'later' if dy > 2 else 'same_period'] += 1
        return n
    b, g = served(built), served(gen)
    rows.append(dict(pair=pid, junction_error=s['junction_error'], built_len=round(built.length), gen_len=round(gen.length), built_serves=dict(b), gen_serves=dict(g)))
json.dump(rows, open(os.path.join(CACHE, 'shared_legs.json'), 'w'), indent=1)
n = len(rows); tot = lambda k, w: sum(r[k].get(w, 0) for r in rows)
print(f'access pairs: {n}')
for w in ('earlier', 'same_period', 'later'):
    print(f'  other blocks within 30 m of the leg, harvested {w:11}: built legs {tot("built_serves", w):4} | generated legs {tot("gen_serves", w):4}')
ser = [r for r in rows if r['built_serves'].get('same_period', 0) + r['built_serves'].get('later', 0) > 0]
non = [r for r in rows if r not in ser]
print(f'built leg passes a block cut in the same period or later: {len(ser)}/{n}')
print(f'  their junction error: median {np.median([r["junction_error"] for r in ser]):.0f} m, within 150 m {np.mean([r["junction_error"]<=150 for r in ser]):.0%}')
print(f'  others:               median {np.median([r["junction_error"] for r in non]):.0f} m, within 150 m {np.mean([r["junction_error"]<=150 for r in non]):.0%}')
print(f'  built/generated leg length: shared {np.median([r["built_len"]/max(r["gen_len"],1) for r in ser]):.1f}x | others {np.median([r["built_len"]/max(r["gen_len"],1) for r in non]):.1f}x')
