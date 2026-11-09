"""Measure how each named spur serves its block: junction, nearest-road choice, in-block reach, grades and stream crossings.

Usage: python3 -I analyze_pairs.py [pairs_dir ...]   -> writes pair_metrics.json in the cache
"""
import os, sys, json, glob, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
import numpy as np
from shapely.geometry import shape, Point, LineString, MultiLineString
from shapely.ops import unary_union, nearest_points, linemerge
from wfs import features
from dem import elevation

def lines(g):
    return [g] if g.geom_type == 'LineString' else [l for l in getattr(g, 'geoms', []) if l.geom_type == 'LineString']
def profile(line, step=20.0):
    n = max(2, int(line.length // step) + 1)
    pts = [line.interpolate(i * line.length / (n - 1)) for i in range(n)]
    z = elevation([p.x for p in pts], [p.y for p in pts])
    return np.linspace(0, line.length, n), z
def grades(line, window=100.0):
    if line.length < window: 
        d, z = profile(line); return [abs(z[-1] - z[0]) / max(line.length, 1) * 100]
    d, z = profile(line)
    k = max(1, int(round(window / (d[1] - d[0]))))
    return [abs(z[i + k] - z[i]) / (d[i + k] - d[i]) * 100 for i in range(len(d) - k)]
def stream_crossings(geom, streams):
    n = 0
    for s in streams:
        x = geom.intersection(s)
        if not x.is_empty: n += len(getattr(x, 'geoms', [x]))
    return n

def analyze(path):
    P = json.load(open(path)); blk = shape(P['block_geometry']); start = (P['block']['DISTURBANCE_START_DATE'] or '')[:10]
    spur = unary_union([shape(s['geometry']) for s in P['spur']])
    if spur.is_empty: return None
    ctx = [(shape(c['geometry']), c) for c in P['context'] if c['geometry']]
    net = unary_union([g for g, _ in ctx]) if ctx else None
    inside = spur.intersection(blk.buffer(10)); outside = spur.difference(blk.buffer(10))
    m = dict(oid=P['block']['OBJECTID'], block=P['block']['CUT_BLOCK_ID'], licence=P['block']['HARVEST_AUTH_FOREST_FILE_ID'], start=start,
             area_ha=round(blk.area / 1e4, 1), spur_len=round(spur.length), spur_in=round(inside.length), spur_out=round(outside.length))
    # junction: the spur endpoint closest to another road
    ends = [Point(c) for l in lines(linemerge(spur) if spur.geom_type != 'LineString' else spur) for c in (l.coords[0], l.coords[-1])]
    if net is not None and ends:
        j = min(ends, key=lambda e: e.distance(net)); m['junction_gap'] = round(j.distance(net), 1)
        host_g, host = min(ctx, key=lambda gc: gc[0].distance(j)); hp = host['props']
        m['host'] = dict(file=hp['FOREST_FILE_ID'], sec=hp['ROAD_SECTION_ID'], name=hp['ROAD_SECTION_NAME'], type=hp['FILE_TYPE_DESCRIPTION'], names_block=host.get('names_block'))
        hb = [x['start'] for x in host.get('names_block') or [] if x['start']]
        m['host_kind'] = ('fsr' if 'Service Road' in (hp['FILE_TYPE_DESCRIPTION'] or '') else
                          'earlier_block_spur' if hb and min(hb)[:10] < start else
                          'later_block_spur' if hb else 'unnamed_permit')
        m['junction_in_block'] = blk.buffer(30).contains(j)
        # nearest existing road to the block (excluding roads that only exist inside the block)
        # existing network: drop roads that name a block harvested more than 90 days after this one
        def later(c):
            ds = [x['start'][:10] for x in c.get('names_block') or [] if x['start']]
            return bool(ds) and min(ds) > (np.datetime64(start) + np.timedelta64(90, 'D')).astype(str)
        outside_net = [g for g, c in ctx if not blk.buffer(5).contains(g) and not later(c)]
        m['connections'] = sum(1 for e in ends if not blk.buffer(30).contains(e) and e.distance(net) <= 15)
        if outside_net:
            on = unary_union(outside_net); pb, pn = nearest_points(blk, on)
            m['nearest_road_dist'] = round(blk.distance(on))
            m['junction_to_nearest_point'] = round(j.distance(pn))
            m['host_dist_to_block'] = round(host_g.distance(blk))
            # straight alternative: block's nearest boundary point to the nearest road
            alt = LineString([pb, pn])
            m['alt_len'] = round(alt.length)
            if alt.length > 40: m['alt_grade_max'] = round(max(grades(alt)), 1)
    # in-block reach: distance from a 25 m grid in the block to the spur or any road touching the block
    near_roads = unary_union([spur] + [g for g, _ in ctx if g.distance(blk) <= 20])
    minx, miny, maxx, maxy = blk.bounds
    xs, ys = np.meshgrid(np.arange(minx, maxx, 25), np.arange(miny, maxy, 25))
    pts = [Point(x, y) for x, y in zip(xs.ravel(), ys.ravel())]; pts = [p for p in pts if blk.contains(p)]
    if pts:
        d = np.array([p.distance(near_roads) for p in pts]); depth = np.array([p.distance(blk.boundary) for p in pts])
        m.update(reach_p50=round(float(np.percentile(d, 50))), reach_p90=round(float(np.percentile(d, 90))), reach_max=round(float(d.max())),
                 share_within_300=round(float((d <= 300).mean()), 2), block_depth_max=round(float(depth.max())),
                 spur_depth=round(max([blk.boundary.distance(Point(c)) for l in lines(inside) for c in l.coords] or [0])))
        z = elevation([p.x for p in pts[::4]], [p.y for p in pts[::4]]); m['block_relief'] = round(float(z.max() - z.min()))
        m['block_mean_elev'] = round(float(z.mean()))
    # grades on the spur (outside the block, where the road is engineered to reach it)
    # access leg: the connected piece of the spur outside the block that holds the junction
    if 'junction_gap' in m and not m['junction_in_block'] and outside.length >= 50:
        pieces = lines(linemerge(outside) if outside.geom_type != 'LineString' else outside)
        legs = unary_union([l for l in pieces if l.distance(j) <= 30])
        if not legs.is_empty:
            m['leg_len'] = round(legs.length)
            entry = nearest_points(legs, blk)[0]
            straight = LineString([j, entry])
            if straight.length > 50:
                m['leg_straight'] = round(straight.length); m['sinuosity'] = round(legs.length / straight.length, 2)
                m['straight_grade_max'] = round(max(grades(straight)), 1)
            g = [x for l in lines(legs) if l.length >= 100 for x in grades(l)]
            if g: m.update(spur_grade_p90=round(float(np.percentile(g, 90)), 1), spur_grade_max=round(float(max(g)), 1))
            m['leg_climb'] = round(float(elevation([entry.x], [entry.y])[0] - elevation([j.x], [j.y])[0]))
    if 'junction_gap' in m:
        zj = elevation([j.x], [j.y])[0]; m['junction_elev'] = round(float(zj))
    # stream crossings on the spur outside the block, and on the straight alternative
    try:
        minx, miny, maxx, maxy = blk.buffer(1500).bounds
        st = [shape(f['geometry']) for f in features('WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP', f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')", ['STREAM_ORDER', 'GEOMETRY'], srs='EPSG:3005') if f['geometry']]
        st = [LineString([c[:2] for c in s.coords]) if s.geom_type == 'LineString' else MultiLineString([[c[:2] for c in l.coords] for l in s.geoms]) for s in st]
        m['spur_crossings'] = stream_crossings(outside, st)
        if 'alt_len' in m and m['alt_len'] > 0: m['alt_crossings'] = stream_crossings(alt, st)
    except Exception as e:
        m['streams_error'] = str(e)[:80]
    return m

if __name__ == '__main__':
    dirs = sys.argv[1:] or [os.path.join(CACHE, 'pairs')]
    files = sorted({os.path.basename(f): f for d in dirs for f in glob.glob(os.path.join(d, '*.json'))}.values())
    out = []
    for f in files:
        try:
            m = analyze(f)
            if m: out.append(m)
        except Exception as e:
            print('error', f, e, file=sys.stderr)
    json.dump(out, open(os.path.join(CACHE, 'pair_metrics.json'), 'w'), indent=1)
    print(len(out), 'pairs measured')
