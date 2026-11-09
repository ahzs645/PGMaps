"""Contact sheet of whole setups: blocks (orange), roads named for the setup (red), other FTEN roads (grey)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from shapely.geometry import shape
from shapely.ops import unary_union
names, out = sys.argv[1].split(','), sys.argv[2]
M = {m['setup']: m for m in json.load(open(os.path.join(CACHE, 'setup_metrics.json')))}
H = {r['setup']: r for r in json.load(open(os.path.join(CACHE, 'setup_hosts.json'))) if r.get('setup')}
fig, axs = plt.subplots(1, len(names), figsize=(4.2 * len(names), 4.4))
for ax, nm in zip(axs, names):
    S = json.load(open(os.path.join(CACHE, 'setups', nm.replace(' ', '_') + '.json')))
    U = unary_union([shape(b['geometry']) for b in S['blocks']]); minx, miny, maxx, maxy = U.buffer(600).bounds
    w = max(maxx - minx, maxy - miny); cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    for r in S['other']:
        g = shape(r['geometry'])
        for l in getattr(g, 'geoms', [g]): ax.plot(*l.xy, color='0.6', lw=.8)
    for b in S['blocks']:
        g = shape(b['geometry'])
        for p in getattr(g, 'geoms', [g]): ax.fill(*p.exterior.xy, color='#ff9f0a', alpha=.45)
    for r in S['named']:
        g = shape(r['geometry'])
        for l in getattr(g, 'geoms', [g]): ax.plot(*l.xy, color='#e5332a', lw=2.2)
    m = M.get(nm, {}); h = H.get(nm, {})
    ax.set_xlim(cx - w / 2, cx + w / 2); ax.set_ylim(cy - w / 2, cy + w / 2); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(f"{nm}: {m.get('n_blocks')} blocks, {m.get('span_m',0)/1000:.1f} km apart\njoins {h.get('host_permits','?')} existing road permit(s), shared new road {m.get('mainline_m',0)} m", fontsize=8)
fig.tight_layout(); fig.subplots_adjust(top=0.86); fig.savefig(out, dpi=90)
