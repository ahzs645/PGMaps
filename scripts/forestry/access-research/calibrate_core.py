"""Variant: route new access to the block's core (cells deeper than half the block's max depth) instead of any block cell."""
import os, sys, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from multiprocessing import Pool
import calibrate_generator as cg
from generate_road import Grid, dijkstra, DEFAULTS
from shapely import distance as sdist, points as spts
from shapely.geometry import shape
SETS = [(5.0, 0.14), (15.0, 0.18)]
orig = cg.one
def one_core(f):
    # reuse calibrate_generator.one but swap the Dijkstra sources for core cells
    import generate_road
    real_dijkstra = cg.dijkstra
    P = json.load(open(f)); blk = shape(P['block_geometry'])
    def core_dijkstra(grid, src, p, allowed=None):
        m = grid.mask(blk); X, Y = grid.X[m], grid.Y[m]
        d = sdist(spts(np.column_stack([X, Y])), blk.boundary)
        keep = d >= 0.5 * d.max() if len(d) else d
        rs, cs = np.nonzero(m); core = list(zip(rs[keep], cs[keep])) or src
        return real_dijkstra(grid, core, p, allowed)
    cg.dijkstra = core_dijkstra; cg.AS = [a for a, _ in SETS]; cg.GMAXS = sorted({g for _, g in SETS}); cg.WS = [0.0, 0.1]
    try: return orig(f)
    finally: cg.dijkstra = real_dijkstra
if __name__ == '__main__':
    with Pool(6) as pool: R = [r for r in pool.map(one_core, cg.pair_files()) if r]
    test = [r for r in R if zlib.crc32(r['licence'].encode()) % 2 == 1]
    def score(rs, key):
        e = np.array([r['results'][key] if r['results'].get(key) is not None else 5000 for r in rs]); return round(float(np.median(e))), round(float((e <= 150).mean()), 2), round(float((e <= 300).mean()), 2)
    for k in sorted(R[0]['results']): print('core', k, 'ALL', score(R, k), 'TEST', score(test, k))
