"""Contact sheet: built road (red) vs generated roads (cyan = group rule, violet = single block) for chosen pairs."""
import os, sys, json, gzip, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from shapely.geometry import shape
from shapely.ops import unary_union, transform
from pyproj import Transformer
from dem import elevation
to_al = Transformer.from_crs(4326, 3005, always_xy=True).transform
fc = json.loads(gzip.open(sys.argv[1]).read()); pairs = sys.argv[3].split(','); out = sys.argv[2]
by = collections.defaultdict(list)
for f in fc['features']: by[f['properties']['pair']].append(f)
cols = 4; rows = (len(pairs) + cols - 1) // cols
fig, axs = plt.subplots(rows, cols, figsize=(4 * cols, 4.1 * rows))
for ax, pid in zip(np.ravel(axs), pairs):
    fs = by[pid]; G = lambda role: [transform(to_al, shape(f['geometry'])) for f in fs if f['properties']['role'] == role]
    blk = G('block')[0]; p = next(f['properties'] for f in fs if f['properties']['role'] == 'block')
    ext = unary_union([blk] + G('built_road') + G('generated_group_access') + G('generated_access')).buffer(300).bounds
    minx, miny, maxx, maxy = ext; w = max(maxx - minx, maxy - miny); cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    minx, maxx, miny, maxy = cx - w / 2, cx + w / 2, cy - w / 2, cy + w / 2
    xs, ys = np.meshgrid(np.linspace(minx, maxx, 70), np.linspace(miny, maxy, 70))
    ax.contour(xs, ys, elevation(xs.ravel(), ys.ravel()).reshape(xs.shape), levels=14, colors='tan', linewidths=.5)
    for g in getattr(blk, 'geoms', [blk]): ax.fill(*g.exterior.xy, color='#3fb950', alpha=.35)
    def draw(role, **kw):
        for g in G(role):
            for l in getattr(g, 'geoms', [g]):
                if l.geom_type == 'LineString': ax.plot(*l.xy, **kw)
    draw('existing_road', color='0.55', lw=1); draw('built_road', color='#e5332a', lw=2.6)
    draw('generated_access', color='#9b51e0', lw=1.6, ls=':'); draw('generated_group_access', color='#00a8c6', lw=1.8, ls='--'); draw('generated_in_block', color='#00a8c6', lw=1.4, ls='--')
    g = p.get('generated', {})
    ax.set_xlim(minx, maxx); ax.set_ylim(miny, maxy); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    rep = lambda k: f"{round(g[k]*100)}%" if g.get(k) is not None else '–'
    ax.set_title(f"{p['block_id']} · {p['licence']} · {p['scenario'].replace('_',' ')}\nbuilt road within 60 m: single {rep('single_reproduced_60m')}, group {rep('group_reproduced_60m')}", fontsize=8)
for ax in np.ravel(axs)[len(pairs):]: ax.axis('off')
fig.tight_layout(); fig.savefig(out, dpi=90)
