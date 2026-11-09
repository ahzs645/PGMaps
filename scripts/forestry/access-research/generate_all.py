"""Generate a road for every reference block with given settings; save geometry (WGS84) and scores.

Usage: python3 -I generate_all.py A GMAX W_HAUL [P_STREAM] [WATER 0/1] [IN_BLOCK v1/v3]
Writes $CACHE/generated.geojson (role=generated_access / generated_in_block / generated_junction) and $CACHE/generated_scores.json
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
from multiprocessing import Pool
import numpy as np
from shapely.geometry import mapping
from shapely.ops import transform
from pyproj import Transformer
from generate_road import generate, compare, pair_files, DEFAULTS
to_ll = Transformer.from_crs(3005, 4326, always_xy=True).transform
A, GMAX, W = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
PS = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0; WATER = len(sys.argv) > 5 and sys.argv[5] == '1'
IB = sys.argv[6] if len(sys.argv) > 6 else 'v1'
P_ = dict(DEFAULTS, A=A, GMAX=GMAX, W_HAUL=W, P_STREAM=PS, WATER=WATER, IN_BLOCK=IB)
def gj(g):
    x = mapping(transform(to_ll, g))
    def walk(c): return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [walk(y) for y in c]
    x['coordinates'] = walk(x['coordinates']); return x
def one(f):
    P = json.load(open(f))
    try: g = generate(P, P_)
    except Exception as e: return None, dict(oid=P['block']['OBJECTID'], error=str(e)[:100])
    if not g: return None, dict(oid=P['block']['OBJECTID'], error='no network')
    if g.get('placeholder'): return None, dict(oid=P['block']['OBJECTID'], error='placeholder block')
    pid = str(P['block']['OBJECTID']); feats = []
    if g.get('access') is not None:
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='generated_access', length_m=round(g['access'].length)), geometry=gj(g['access'])))
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='generated_junction'), geometry=gj(g['junction'])))
    if g.get('in_block') is not None and not g['in_block'].is_empty:
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='generated_in_block', length_m=round(g['in_block'].length)), geometry=gj(g['in_block'])))
    sc = compare(P, g); sc.update(block_slope=g.get('block_slope'), reach_p90=g.get('reach_p90'), in_block_m_per_ha=g.get('in_block_m_per_ha')); return feats, sc
if __name__ == '__main__':
    with Pool(6) as pool: R = pool.map(one, pair_files())
    feats = [x for fs, _ in R if fs for x in fs]; scores = [s for _, s in R]
    json.dump(dict(type='FeatureCollection', settings=P_, features=feats), open(os.path.join(CACHE, 'generated.geojson'), 'w'), separators=(',', ':'))
    json.dump(scores, open(os.path.join(CACHE, 'generated_scores.json'), 'w'), indent=1)
    S = [s for s in scores if 'error' not in s]
    acc = [s for s in S if 'junction_error' in s]
    print('settings', P_)
    print(f'blocks scored {len(S)} | errors {len(scores) - len(S)}')
    print(f'access leg built {sum(s["access_built"] for s in S)} | generated {sum(s["access_generated"] for s in S)} | both {sum(s["access_built"] and s["access_generated"] for s in S)}')
    if acc:
        je = np.array([s['junction_error'] for s in acc]); ne = np.array([s['nearest_point_error'] for s in acc])
        print(f'junction error (generated vs real), n={len(acc)}: median {np.median(je):.0f} m, within 150 m {np.mean(je<=150):.0%}, within 300 m {np.mean(je<=300):.0%}')
        print(f'nearest-point baseline:              median {np.median(ne):.0f} m, within 150 m {np.mean(ne<=150):.0%}, within 300 m {np.mean(ne<=300):.0%}')
        ls = [s for s in acc if 'leg_mean_separation' in s]
        print(f'leg mean separation from the real leg: generated median {np.median([s["leg_mean_separation"] for s in ls]):.0f} m vs straight-to-nearest {np.median([s["straight_mean_separation"] for s in ls]):.0f} m (n={len(ls)})')
        print(f'leg length ratio (generated/real): median {np.median([s["leg_len_ratio"] for s in ls]):.2f}')
    ib = [s for s in S if s['in_block_built'] > 50]
    print(f'in-block road length, generated vs built (blocks with built in-block road, n={len(ib)}): median ratio {np.median([s["in_block_generated"]/s["in_block_built"] for s in ib]):.2f}')
    print(f'coverage: generated roads meet the reach target in a median {np.median([s["coverage"] for s in S if s["coverage"] is not None]):.0%} of the block')
    for lab, f in (('flat (<15%)', lambda s: (s.get('block_slope') or 0) < 15), ('sloped (>=15%)', lambda s: (s.get('block_slope') or 0) >= 15)):
        ss = [s for s in S if s.get('block_slope') is not None and f(s)]
        if ss: print(f'  {lab}: n={len(ss)} | in-block road m/ha median {np.median([s["in_block_m_per_ha"] for s in ss]):.0f} | 90% of block within median {np.median([s["reach_p90"] for s in ss]):.0f} m')
