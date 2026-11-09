"""Export every setup (licence + cutting permit) as GeoJSON: all its blocks and the road sections named for it.
role=setup_block / setup_road; a `setup` key "<licence>|<cp>" links them and the block pairs. Writes reference-setups.geojson.gz."""
import os, sys, json, glob, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import Transformer
to_ll = Transformer.from_crs(3005, 4326, always_xy=True).transform
def ll(g):
    x = mapping(transform(to_ll, g.simplify(1.0, preserve_topology=True)))
    def walk(c): return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [walk(y) for y in c]
    x['coordinates'] = walk(x['coordinates']); return x
M = {m['setup']: m for m in json.load(open(os.path.join(CACHE, 'setup_metrics.json')))}
H = {r['setup']: r for r in json.load(open(os.path.join(CACHE, 'setup_hosts.json'))) if r.get('setup')}
G = {r['setup']: r for r in json.load(open(os.path.join(CACHE, 'setup_generated.json')))}
feats = []
for f in sorted(glob.glob(os.path.join(CACHE, 'setups', '*.json'))):
    S = json.load(open(f))
    if S.get('skipped') or not S.get('blocks'): continue
    key = f"{S['licence']}|{S['cp'] or ''}"; name = f"{S['licence']} {S['cp'] or ''}".strip()
    m = M.get(name, {}); h = H.get(name, {}); g = G.get(os.path.basename(f)[:-5], {})
    summary = {k: m.get(k) for k in ('n_blocks', 'area_ha', 'span_m', 'harvest_years', 'named_road_m', 'road_permits', 'connections', 'blocks_on_named_road', 'blocks_on_other_road_only', 'blocks_no_road', 'mainline_m', 'spur_m')}
    summary.update(host_permits=h.get('host_permits'), top_host_share=h.get('top_host_share'), joins_fsr=h.get('joins_fsr'),
                   generated_common_host=g.get('common_host'), real_top_host=g.get('top_real_host'))
    for i, b in enumerate(S['blocks']):
        p = b['props']
        feats.append(dict(type='Feature', properties=dict(setup=key, role='setup_block', block_id=p['CUT_BLOCK_ID'], opening_id=p.get('OPENING_ID'),
                     harvest_start=(p['DISTURBANCE_START_DATE'] or '')[:10], **({'summary': summary} if i == 0 else {})), geometry=ll(shape(b['geometry']))))
    for r in S['named']:
        q = r['props']
        feats.append(dict(type='Feature', properties=dict(setup=key, role='setup_road', permit=q['FOREST_FILE_ID'], section=q['ROAD_SECTION_ID'], name=q['ROAD_SECTION_NAME'], matched_by=r['why']), geometry=ll(shape(r['geometry']))))
    if g.get('common_geom'):
        feats.append(dict(type='Feature', properties=dict(setup=key, role='setup_generated', host=g.get('common_host')), geometry=g['common_geom']))
out = sys.argv[1]; raw = json.dumps(dict(type='FeatureCollection', name='bc-setup-reference', features=feats), separators=(',', ':')).encode()
with gzip.GzipFile(os.path.join(out, 'reference-setups.geojson.gz'), 'wb', mtime=0) as z: z.write(raw)
print(len({f['properties']['setup'] for f in feats}), 'setups |', len(feats), 'features |', f'{len(raw)/1e6:.1f} MB raw')
