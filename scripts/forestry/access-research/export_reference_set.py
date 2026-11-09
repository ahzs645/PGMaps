"""Export the block-road pairs as one GeoJSON reference set (WGS84) plus a scenario index.

Each pair becomes features sharing a `pair` id:
  role=block          the cutblock polygon, with metrics and the scenario type
  role=built_road     road sections named for the block (what was built)
  role=existing_road  other FTEN road sections within 1 km of the block (the network it could join)
  role=junction       where the built road joins the network
  role=nearest_point  the network's nearest point to the block (the "obvious" connection)
Usage: python3 -I export_reference_set.py OUT_DIR
"""
import os, sys, json, glob, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
from shapely.geometry import shape, mapping, Point
from shapely.ops import transform, unary_union, nearest_points, linemerge
from pyproj import Transformer
to_ll = Transformer.from_crs(3005, 4326, always_xy=True).transform
def ll(g, tol=1.0):
    g = transform(to_ll, g.simplify(tol, preserve_topology=True))
    def r(c): return [round(c[0], 6), round(c[1], 6)]
    gj = mapping(g)
    def walk(x): return r(x) if isinstance(x[0], (int, float)) else [walk(y) for y in x]
    gj['coordinates'] = walk(gj['coordinates']); return gj

M = {m['oid']: m for m in json.load(open(os.path.join(CACHE, 'pair_metrics.json')))}
TR = json.load(open(os.path.join(CACHE, 'through_roads.json')))
NC = {r['oid']: r for r in json.load(open(os.path.join(CACHE, 'network_choice.json')))}
import csv
FS = os.path.join(CACHE, 'road_first_seen.csv')   # Sentinel-2 dating (timing/ scripts)
FIRST_SEEN = {r['oid']: r for r in csv.DictReader(open(FS))} if os.path.exists(FS) else {}
REASONS = json.load(open(os.path.join(CACHE, 'elsewhere_reasons.json')))  # from explain_elsewhere.py
through = {}
for r in TR:
    if r['through'] and r['role'] != 'named_for_block' and r['beyond_before'] > 0: through.setdefault(r['oid'], set()).add('laid_out_around_existing_road')
    if r['through'] and r['role'] == 'named_for_block' and (r['beyond_after'] > 0 or r['beyond_around'] > 0): through.setdefault(r['oid'], set()).add('development_road_continues')

def scenario(m):
    tags = sorted(through.get(m['oid'], set()))
    nd = m.get('nearest_road_dist')
    if nd is None: kind = 'unknown'
    elif nd <= 20: kind = 'road_at_block'
    elif m.get('junction_to_nearest_point') is not None and m['junction_to_nearest_point'] <= 150: kind = 'joined_nearest'
    else:
        kind = 'joined_elsewhere'
        names = {'steep straight alternative (>12%)': 'steep_straight_alternative', 'nearest road retired': 'nearest_road_retired',
                 'nearest road is a smaller, separate network': 'nearest_is_small_separate_network', 'joined closer to the FSR (shorter haul)': 'shorter_haul_to_fsr'}
        tags += [names[x] for x in REASONS.get(str(m['oid']), [])]
    return kind, tags

GEN = os.path.join(CACHE, 'generated.geojson'); SC = os.path.join(CACHE, 'generated_scores.json')
gen_feats = json.load(open(GEN))['features'] if os.path.exists(GEN) else []
gen_scores = {str(x['oid']): x for x in json.load(open(SC))} if os.path.exists(SC) else {}
gen_settings = json.load(open(GEN)).get('settings') if os.path.exists(GEN) else None
GRP = os.path.join(CACHE, 'group_generated.json')
group = {r['pair']: r for r in json.load(open(GRP))} if os.path.exists(GRP) else {}
for r in group.values():
    if r.get('geometry'): gen_feats.append(dict(type='Feature', properties=dict(pair=r['pair'], role='generated_group_access', group_size=r['group_size']), geometry=r['geometry']))
files = sorted({os.path.basename(f): f for d in (os.path.join(CACHE, 'pairs'), os.path.join(CACHE, 'expand', 'pairs')) for f in glob.glob(os.path.join(d, '*.json'))}.values())
feats, index = [], []
for f in files:
    P = json.load(open(f)); oid = P['block']['OBJECTID']; m = M.get(oid)
    if not m: continue
    blk = shape(P['block_geometry']); spur = unary_union([shape(s['geometry']) for s in P['spur']])
    kind, tags = scenario(m); pid = str(oid); b = P['block']
    props = dict(pair=pid, role='block', scenario=kind, tags=tags, opening_id=b.get('OPENING_ID'), licence=b['HARVEST_AUTH_FOREST_FILE_ID'],
                 cutting_permit=b['HARVEST_AUTH_CUTTING_PERMIT_ID'], block_id=b['CUT_BLOCK_ID'], client=b.get('CLIENT_NAME'),
                 harvest_start=(b['DISTURBANCE_START_DATE'] or '')[:10], harvest_end=(b.get('DISTURBANCE_END_DATE') or '')[:10],
                 metrics={k: v for k, v in m.items() if k not in ('oid', 'block', 'licence', 'start', 'host')})
    c0 = transform(to_ll, blk.centroid); props.update(lon=round(c0.x, 5), lat=round(c0.y, 5))
    if pid in gen_scores: props['generated'] = {k: v for k, v in gen_scores[pid].items() if k != 'oid'}
    fs_ = FIRST_SEEN.get(pid)
    if fs_: props['first_seen'] = dict(result=fs_['final'], timing=fs_['road_class'], last_scene_without=fs_['last_before'] or None, first_scene_with=fs_['first_after'] or None,
                                     bracket_days=int(fs_['bracket_days']) if fs_['bracket_days'] else None, block_first_cleared=fs_['block_first_after'] or None)
    if pid in group: props.setdefault('generated', {}).update(group_size=group[pid]['group_size'], group_reproduced_60m=group[pid]['group_reproduced'], single_reproduced_60m=group[pid].get('single_reproduced'))
    feats.append(dict(type='Feature', properties=props, geometry=ll(blk)))
    for s in P['spur']:
        q = s['props']
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='built_road', permit=q['FOREST_FILE_ID'], section=q['ROAD_SECTION_ID'], name=q['ROAD_SECTION_NAME'], permit_awarded=(q['AWARD_DATE'] or '')[:10]), geometry=ll(shape(s['geometry']))))
    near = blk.buffer(1000)
    for c in P['context']:
        g = shape(c['geometry'])
        if g.is_empty or g.distance(blk) > 1000: continue
        q = c['props']
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='existing_road', permit=q['FOREST_FILE_ID'], section=q['ROAD_SECTION_ID'], name=q['ROAD_SECTION_NAME'],
                     type=q['FILE_TYPE_DESCRIPTION'], status=q['LIFE_CYCLE_STATUS_CODE'], names_block=c.get('names_block') or []), geometry=ll(g.intersection(near.buffer(500)))))
    ctx = [shape(c['geometry']) for c in P['context'] if not blk.buffer(5).contains(shape(c['geometry']))]
    if ctx and not spur.is_empty:
        net = unary_union(ctx); pb, pn = nearest_points(blk, net)
        feats.append(dict(type='Feature', properties=dict(pair=pid, role='nearest_point'), geometry=ll(pn)))
        merged = linemerge(spur) if spur.geom_type == 'MultiLineString' else spur
        ends = [Point(c) for l in getattr(merged, 'geoms', [merged]) if l.geom_type == 'LineString' for c in (l.coords[0], l.coords[-1])]
        j = min(ends, key=lambda e: e.distance(net))
        if j.distance(net) <= 25: feats.append(dict(type='Feature', properties=dict(pair=pid, role='junction'), geometry=ll(j)))
    c = transform(to_ll, blk.centroid)
    index.append(dict(pair=pid, scenario=kind, tags=tags, licence=props['licence'], cutting_permit=props['cutting_permit'], block_id=props['block_id'], opening_id=props['opening_id'],
                      harvest_start=props['harvest_start'], area_ha=m['area_ha'], built_road_m=m['spur_len'], nearest_road_m=m.get('nearest_road_dist'),
                      lon=round(c.x, 5), lat=round(c.y, 5), road_first_seen=props.get('first_seen'), names=sorted({s['props']['ROAD_SECTION_NAME'] for s in P['spur'] if s['props']['ROAD_SECTION_NAME']})[:4]))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
feats += [f for f in gen_feats if f['properties']['pair'] in {i['pair'] for i in index}]
fc = dict(type='FeatureCollection', name='bc-block-road-reference-pairs', generator_settings=gen_settings, features=feats)
raw = json.dumps(fc, separators=(',', ':')).encode()
with gzip.GzipFile(os.path.join(out, 'reference-pairs.geojson.gz'), 'wb', mtime=0) as g: g.write(raw)
json.dump(index, open(os.path.join(out, 'reference-pairs.index.json'), 'w'), indent=1)
import shutil
viewer = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'viewer.html')
if os.path.exists(viewer): shutil.copy(viewer, os.path.join(out, 'viewer.html'))
import collections
print(len(index), 'pairs |', len(feats), 'features |', f'{len(raw)/1e6:.1f} MB raw', '|', dict(collections.Counter(i['scenario'] for i in index)))
