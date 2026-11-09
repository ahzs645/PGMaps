"""Within a setup: which existing roads do its spurs join, and how often is new road shared between blocks?"""
import os, sys, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape, Point
from shapely.ops import unary_union, linemerge
from generate_road import lines
M = {m['setup']: m for m in json.load(open(os.path.join(CACHE, 'setup_metrics.json')))}
rows = []
for f in sorted(glob.glob(os.path.join(CACHE, 'setups', '*.json'))):
    S = json.load(open(f))
    if S.get('skipped') or len(S.get('blocks', [])) < 2 or not S['named'] or not S['other']: continue
    U = unary_union([shape(b['geometry']) for b in S['blocks']])
    others = [(shape(r['geometry']), r['props']) for r in S['other']]
    # each named section's ends that meet another road outside the blocks: which road (permit) is it?
    hosts = collections.Counter(); fsr = 0
    for r in S['named']:
        g = shape(r['geometry'])
        for l in lines(g):
            for c in (l.coords[0], l.coords[-1]):
                p = Point(c[:2])
                if U.buffer(30).contains(p): continue
                near = [(og, op) for og, op in others if og.distance(p) <= 15]
                if near:
                    og, op = min(near, key=lambda x: x[0].distance(p))
                    hosts[op['FOREST_FILE_ID']] += 1; fsr += 'Service Road' in (op['FILE_TYPE_DESCRIPTION'] or '')
    m = M.get(f"{S['licence']} {S['cp'] or ''}".strip(), {})
    rows.append(dict(setup=m.get('setup'), n_blocks=len(S['blocks']), host_permits=len(hosts), top_host_share=(max(hosts.values()) / sum(hosts.values())) if hosts else None,
                     joins_fsr=fsr > 0, mainline_m=m.get('mainline_m'), network_used_m=m.get('network_used_m'), span_m=m.get('span_m')))
json.dump(rows, open(os.path.join(CACHE, 'setup_hosts.json'), 'w'), indent=1)
h = [r for r in rows if r['host_permits']]
print(f'setups (2+ blocks) whose named roads join other roads: {len(h)}')
print(f"  distinct existing road permits joined: median {np.median([r['host_permits'] for r in h]):.0f}, 1 permit in {sum(r['host_permits']==1 for r in h)}, 2 in {sum(r['host_permits']==2 for r in h)}, 3+ in {sum(r['host_permits']>=3 for r in h)}")
print(f"  share of joins on the most-used existing road: median {np.median([r['top_host_share'] for r in h]):.0%}")
print(f"  setups joining an FSR: {sum(r['joins_fsr'] for r in h)}")
mm = [r for r in rows if r['network_used_m']]
print(f"  setups with any shared new road (mainline > 0): {sum(1 for r in mm if r['mainline_m'] > 0)}/{len(mm)}; among them mainline share median {np.median([r['mainline_m']/r['network_used_m'] for r in mm if r['mainline_m']>0]):.0%}")
