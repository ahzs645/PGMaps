"""Contact sheet of block-road pairs: block (green), named spur (red), other roads (grey), nearest existing-road link (dashed blue), hillshade."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
from shapely.geometry import shape
from shapely.ops import nearest_points, unary_union
from dem import elevation
def draw(ax, path, m):
    P = json.load(open(path)); blk = shape(P['block_geometry'])
    spur = unary_union([shape(s['geometry']) for s in P['spur']])
    ext = unary_union([blk, spur]).buffer(400).bounds; minx, miny, maxx, maxy = ext
    xs, ys = np.meshgrid(np.linspace(minx, maxx, 80), np.linspace(miny, maxy, 80))
    z = elevation(xs.ravel(), ys.ravel()).reshape(xs.shape)
    ax.imshow(LightSource(315, 45).hillshade(z[::-1], dx=(maxx - minx) / 80, dy=(maxy - miny) / 80), cmap='gray', extent=ext, alpha=.6)
    ax.contour(xs, ys, z, levels=12, colors='tan', linewidths=.4)
    for g in getattr(blk, 'geoms', [blk]): ax.fill(*g.exterior.xy, color='g', alpha=.35)
    for c in P['context']:
        g = shape(c['geometry'])
        for l in getattr(g, 'geoms', [g]): ax.plot(*l.xy, color='0.35', lw=.8)
    for l in getattr(spur, 'geoms', [spur]): ax.plot(*l.xy, color='r', lw=1.8)
    net = unary_union([shape(c['geometry']) for c in P['context'] if not blk.buffer(5).contains(shape(c['geometry']))])
    a, b = nearest_points(blk, net); ax.plot([a.x, b.x], [a.y, b.y], 'b--', lw=1.2)
    ax.set_xlim(minx, maxx); ax.set_ylim(miny, maxy); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(f"{m['block']} ({m['licence']}) nearest {m.get('nearest_road_dist')} m\nleg {m.get('leg_len')} m, alt max {m.get('alt_grade_max')}%, leg max {m.get('spur_grade_max')}%", fontsize=7)
if __name__ == '__main__':
    sel, out = sys.argv[1], sys.argv[2]
    M = json.load(open(os.path.join(CACHE, 'pair_metrics.json')))
    pick = (lambda m: True) if sel.startswith('oids:') else {'elsewhere': lambda m: (m.get('nearest_road_dist') or 0) > 20 and (m.get('junction_to_nearest_point') or 0) > 150,
            'nearest': lambda m: (m.get('nearest_road_dist') or 0) > 20 and m.get('junction_to_nearest_point') is not None and m['junction_to_nearest_point'] <= 150,
            'at_block': lambda m: m.get('nearest_road_dist') is not None and m['nearest_road_dist'] <= 20}[sel]
    if sel.startswith('oids:'):
        want = [int(x) for x in sel[5:].split(',')]; byo = {m['oid']: m for m in M}; ms = [byo[o] for o in want if o in byo]
    else:
        ms = [m for m in M if pick(m)][:int(sys.argv[3]) if len(sys.argv) > 3 else 8]
    fig, axs = plt.subplots(2, 4, figsize=(16, 8.5))
    for ax, m in zip(axs.ravel(), ms):
        pd = [d for d in (os.path.join(CACHE, 'pairs'), os.path.join(CACHE, 'expand', 'pairs')) if os.path.exists(os.path.join(d, f"{m['oid']}.json"))][0]
        draw(ax, os.path.join(pd, f"{m['oid']}.json"), m)
    for ax in axs.ravel()[len(ms):]: ax.axis('off')
    fig.tight_layout(); fig.savefig(out, dpi=95)
