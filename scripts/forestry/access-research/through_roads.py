"""Roads that cross a block: dead-end spur or through-road, centred or at the edge, and what lies beyond.

For every road (named spur or context) with >=100 m inside the block (20 m inset):
- exits: how many times it crosses the block boundary (0-1 ends in the block; >=2 passes through)
- centrality: mean distance of its inside part from the boundary / block's deepest point
- beyond: other blocks within 50 m of the road's continuation (1.5 km past the block), and whether they were
  harvested before (>1 year), around (within 1 year) or after (>1 year) this block.
"""
import os, sys, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape, Point
from shapely.ops import unary_union, linemerge
from datetime import date

def years(a, b): return (date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days / 365.25
files = sorted({os.path.basename(f): f for d in (os.path.join(CACHE, 'pairs'), os.path.join(CACHE, 'expand', 'pairs')) for f in glob.glob(os.path.join(d, '*.json'))}.values())
rows = []
for f in files:
    P = json.load(open(f)); blk = shape(P['block_geometry']); start = P['block']['DISTURBANCE_START_DATE']
    if not start: continue
    inset = blk.buffer(-20)
    if inset.is_empty: continue
    grid = [Point(x, y) for x in np.arange(blk.bounds[0], blk.bounds[2], 30) for y in np.arange(blk.bounds[1], blk.bounds[3], 30)]
    depth_max = max([p.distance(blk.boundary) for p in grid if blk.contains(p)] or [1])
    others = [(shape(b['geometry']), b['props']) for b in P['nearby_blocks'] if b['geometry'] and b['props'].get('DISTURBANCE_START_DATE')]
    # group roads by permit+section; spur sections share the "named for this block" role
    roads = [(shape(s['geometry']), 'named_for_block', s['props']) for s in P['spur']] + \
            [(shape(c['geometry']), 'names_other_block' if c.get('names_block') else ('fsr' if 'Service Road' in (c['props']['FILE_TYPE_DESCRIPTION'] or '') else 'unnamed'), c['props']) for c in P['context']]
    # merge each role's lines that touch, so a road split into sections is judged as one road
    by_role = collections.defaultdict(list)
    for g, role, _ in roads: by_role[role].append(g)
    for role, gs in by_role.items():
        merged = linemerge(unary_union(gs)) if len(gs) > 1 else gs[0]
        for road in getattr(merged, 'geoms', [merged]):
            inside = road.intersection(inset)
            if inside.length < 100: continue
            crossings = road.intersection(blk.boundary)
            exits = 0 if crossings.is_empty else len(getattr(crossings, 'geoms', [crossings]))
            pts = [inside.interpolate(t, normalized=True) for t in np.linspace(0, 1, 20)]
            centrality = float(np.mean([p.distance(blk.boundary) for p in pts]) / depth_max)
            beyond = road.difference(blk.buffer(50)).intersection(blk.buffer(1500))
            when = []
            if not beyond.is_empty:
                for og, op in others:
                    if og.distance(beyond) <= 50 and og.intersection(blk).area < 0.2 * og.area:
                        dy = years(op['DISTURBANCE_START_DATE'], start)
                        when.append('before' if dy < -1 else 'after' if dy > 1 else 'around')
            rows.append(dict(block=P['block']['CUT_BLOCK_ID'], oid=P['block']['OBJECTID'], role=role, inside_m=round(inside.length), exits=exits,
                             through=exits >= 2, centrality=round(centrality, 2), beyond_blocks=len(when),
                             beyond_before=when.count('before'), beyond_around=when.count('around'), beyond_after=when.count('after')))
json.dump(rows, open(os.path.join(CACHE, 'through_roads.json'), 'w'), indent=1)
blocks = {r['oid'] for r in rows}
print(f'{len(files)} blocks; {len(blocks)} have a road with >=100 m inside; {len(rows)} such roads')
for role in ('named_for_block', 'names_other_block', 'unnamed', 'fsr'):
    rr = [r for r in rows if r['role'] == role]
    if not rr: continue
    t = [r for r in rr if r['through']]; d = [r for r in rr if not r['through']]
    print(f'\n{role}: {len(rr)} roads | pass through {len(t)} | end in block {len(d)}')
    if t: print(f'  through: centrality median {np.median([r["centrality"] for r in t]):.2f} | continue to other blocks {sum(r["beyond_blocks"]>0 for r in t)} '
                f'(earlier {sum(r["beyond_before"]>0 for r in t)}, around {sum(r["beyond_around"]>0 for r in t)}, later {sum(r["beyond_after"]>0 for r in t)})')
    if d: print(f'  dead-end: centrality median {np.median([r["centrality"] for r in d]):.2f} | inside length median {np.median([r["inside_m"] for r in d]):.0f} m')
per_block = collections.defaultdict(set)
for r in rows: per_block[r['oid']].add((r['role'], r['through']))
print('\nblocks crossed by a through-road not named for them:', sum(1 for s in per_block.values() if any(t and role != 'named_for_block' for role, t in s)), '/', len(files))
print('blocks whose own named road passes through:', sum(1 for s in per_block.values() if ('named_for_block', True) in s), '/', len(files))
