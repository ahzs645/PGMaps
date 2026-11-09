"""Summarise pair_metrics.json: how named spurs serve blocks and which existing road they join."""
import os, sys, json, collections
import numpy as np
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
M = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(CACHE, 'pair_metrics.json')))
def q(vals, ps=(25, 50, 75, 90)):
    v = [x for x in vals if x is not None]
    return f"n={len(v)} " + ' '.join(f"p{p}={np.percentile(v, p):.0f}" if max(map(abs, v), default=0) >= 10 else f"p{p}={np.percentile(v, p):.1f}" for p in ps) if v else 'n=0'
print('pairs', len(M))
at = [m for m in M if m.get('nearest_road_dist') is not None and m['nearest_road_dist'] <= 20]
away = [m for m in M if m.get('nearest_road_dist') is not None and m['nearest_road_dist'] > 20]
print(f'\n== A. an existing road already reached the block: {len(at)}')
print(' spur length outside block', q([m['spur_out'] for m in at]))
print(' spur length inside block ', q([m['spur_in'] for m in at]))
print(f'\n== B. nearest existing road was away from the block: {len(away)}')
print(' nearest road distance     ', q([m['nearest_road_dist'] for m in away]))
print(' access leg length         ', q([m.get('leg_len') for m in away]))
print(' leg / nearest distance    ', q([m['leg_len'] / m['nearest_road_dist'] for m in away if m.get('leg_len')]))
near = [m for m in away if m.get('junction_to_nearest_point') is not None and m['junction_to_nearest_point'] <= 150]
far = [m for m in away if m.get('junction_to_nearest_point') is not None and m['junction_to_nearest_point'] > 150]
print(f' joined at the nearest road point (<=150 m): {len(near)} | joined elsewhere: {len(far)}')
for label, grp in (('nearest', near), ('elsewhere', far)):
    print(f'  [{label}] straight-alternative max grade', q([m.get('alt_grade_max') for m in grp]))
    print(f'  [{label}] actual leg max grade         ', q([m.get('spur_grade_max') for m in grp]))
    print(f'  [{label}] alt crossings mean {np.mean([m.get("alt_crossings", 0) for m in grp]):.2f} | actual leg crossings mean {np.mean([m.get("spur_crossings", 0) for m in grp]):.2f}')
    print(f'  [{label}] host kinds', dict(collections.Counter(m.get('host_kind') for m in grp)))
steep = [m for m in far if (m.get('alt_grade_max') or 0) > 12]
print(f'  joined elsewhere with straight alternative > 12%: {len(steep)}/{len(far)} | joined nearest with alternative > 12%: {sum(1 for m in near if (m.get("alt_grade_max") or 0) > 12)}/{len(near)}')
print('\n== All pairs')
print(' host kinds', dict(collections.Counter(m.get('host_kind') for m in M)))
print(' connections to network (outside block)', dict(collections.Counter(m.get('connections') for m in M)))
print(' block area ha              ', q([m['area_ha'] for m in M]))
print(' named spur total length    ', q([m['spur_len'] for m in M]))
print(' spur metres per ha         ', q([m['spur_len'] / m['area_ha'] for m in M if m['area_ha']]))
print(' in-block reach p50 (m)     ', q([m.get('reach_p50') for m in M]))
print(' in-block reach p90 (m)     ', q([m.get('reach_p90') for m in M]))
print(' share of block within 300 m', q([m.get('share_within_300') for m in M]))
print(' spur depth / block depth   ', q([m['spur_depth'] / m['block_depth_max'] for m in M if m.get('block_depth_max')]))
print(' access leg sinuosity       ', q([m.get('sinuosity') for m in M]))
print(' leg max grade %            ', q([m.get('spur_grade_max') for m in M]))
print(' leg p90 grade %            ', q([m.get('spur_grade_p90') for m in M]))
print(' straight line max grade %  ', q([m.get('straight_grade_max') for m in M]))
cl = [m['leg_climb'] for m in M if m.get('leg_climb') is not None]
print(f' leg climbs to block: {sum(c > 5 for c in cl)} | descends: {sum(c < -5 for c in cl)} | level: {sum(abs(c) <= 5 for c in cl)}')
