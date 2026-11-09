"""Do in-block roads follow the contours? Compare road grade inside the block with the block's terrain slope."""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape, Point
from shapely.ops import unary_union, linemerge
from dem import elevation
from analyze_pairs import lines, grades
files = sorted({os.path.basename(f): f for d in (os.path.join(CACHE, 'pairs'), os.path.join(CACHE, 'expand', 'pairs')) for f in glob.glob(os.path.join(d, '*.json'))}.values())
rows = []
for f in files:
    P = json.load(open(f)); blk = shape(P['block_geometry'])
    spur = unary_union([shape(s['geometry']) for s in P['spur']])
    inside = spur.intersection(blk.buffer(-20))
    parts = [l for l in lines(linemerge(inside) if inside.geom_type == 'MultiLineString' else inside) if l.length >= 150]
    if not parts: continue
    g = [x for l in parts for x in grades(l, 60)]
    # terrain slope: central differences on a 30 m grid inside the block
    minx, miny, maxx, maxy = blk.bounds; s = 30
    xs, ys = np.meshgrid(np.arange(minx, maxx, s), np.arange(miny, maxy, s))
    keep = np.array([blk.buffer(-20).contains(Point(x, y)) for x, y in zip(xs.ravel(), ys.ravel())])
    if keep.sum() < 10: continue
    px, py = xs.ravel()[keep], ys.ravel()[keep]
    zx1, zx0 = elevation(px + s, py), elevation(px - s, py); zy1, zy0 = elevation(px, py + s), elevation(px, py - s)
    slope = np.hypot((zx1 - zx0) / (2 * s), (zy1 - zy0) / (2 * s)) * 100
    rows.append(dict(block=P['block']['CUT_BLOCK_ID'], road_len=round(sum(l.length for l in parts)), road_grade=float(np.mean(g)), road_grade_p90=float(np.percentile(g, 90)), terrain_slope=float(np.mean(slope)), terrain_p90=float(np.percentile(slope, 90))))
json.dump(rows, open(os.path.join(CACHE, 'contour_following.json'), 'w'), indent=1)
r = np.array([x['road_grade'] / x['terrain_slope'] for x in rows if x['terrain_slope'] > 3])
steep = [x for x in rows if x['terrain_slope'] > 10]
print(f'{len(rows)} blocks with >=150 m of road inside')
print(f'road grade / terrain slope (blocks steeper than 3%): n={len(r)} median {np.median(r):.2f} p25 {np.percentile(r,25):.2f} p75 {np.percentile(r,75):.2f}')
print(f'on blocks steeper than 10% (n={len(steep)}): median terrain slope {np.median([x["terrain_slope"] for x in steep]):.1f}%, median road grade {np.median([x["road_grade"] for x in steep]):.1f}%, p90 road grade {np.median([x["road_grade_p90"] for x in steep]):.1f}%')
print('road grade on flat (<5%) vs steep (>10%) blocks:', round(np.median([x['road_grade'] for x in rows if x['terrain_slope'] < 5]), 1), 'vs', round(np.median([x['road_grade'] for x in steep]), 1))
