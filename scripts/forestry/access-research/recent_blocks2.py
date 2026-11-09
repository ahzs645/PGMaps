"""Second pass on the recent-block samples: match section names against all block IDs and licences within 2 km; FOM plan lookup for 2022+ blocks."""
import os, sys, json, re, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
os.makedirs(os.path.join(CACHE, 'images'), exist_ok=True)
from wfs import features
from shapely.geometry import shape
DIST = sys.argv[1]
o = json.load(open(os.path.join(CACHE, f'recent_{DIST}.json')))
B = 'WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'; R = 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
FOM = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_tenure/MapServer'
norm = lambda s: re.sub(r'^0+(?=.)', '', (s or '').upper())
def toks(name):
    t = [x for x in re.split(r'[^A-Za-z0-9]+', (name or '').upper()) if x]
    return {norm(x) for x in t}
def cp_block_pairs(name):
    # "153-10", "15L-84", "CP399-5", "CP 407 BLK 3", "CP777-404B"
    n = (name or '').upper(); pairs = set()
    for a, b in re.findall(r'(?<![A-Z0-9])(?:CP\s*)?(\d{1,4}[A-Z]?)\s*[-/]\s*(\d{1,4}[A-Z]?)(?![0-9])', n): pairs.add((norm(a), norm(b)))
    for a, b in re.findall(r'CP\s*#?\s*(\d{1,4}[A-Z]?)\D{0,6}BL(?:OC)?K\s*#?\s*(\w{1,6})', n): pairs.add((norm(a), norm(b)))
    return pairs
def is_block_token(tok, bid):
    return tok == bid and (len(bid) >= 3 or (re.search(r'[A-Z]', bid) and re.search(r'\d', bid)))
def fom(layer, geom, fields):
    minx, miny, maxx, maxy = geom.bounds
    u = f'{FOM}/{layer}/query?' + urllib.parse.urlencode(dict(f='json', where='1=1', outFields=fields, returnGeometry='true', outSR=3005,
        geometry=f'{minx},{miny},{maxx},{maxy}', geometryType='esriGeometryEnvelope', inSR=3005, spatialRel='esriSpatialRelIntersects', resultRecordCount=200))
    return json.load(urllib.request.urlopen(u, timeout=120)).get('features', [])
def esri_shape(g):
    from shapely.geometry import Polygon, MultiLineString
    if 'rings' in g: return Polygon(g['rings'][0], g['rings'][1:]).buffer(0)
    return MultiLineString(g['paths'])
for rec in o:
    p = rec['block']
    g = features(B, f"OBJECTID={p['OBJECTID']}", ['GEOMETRY'], srs='EPSG:3005')[0]['geometry']; blk = shape(g)
    minx, miny, maxx, maxy = blk.buffer(2000).bounds
    near = features(B, f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')", ['CUT_BLOCK_ID', 'HARVEST_AUTH_FOREST_FILE_ID', 'HARVEST_AUTH_CUTTING_PERMIT_ID', 'DISTURBANCE_START_DATE', 'OBJECTID'])
    others = [n['properties'] for n in near if n['properties']['OBJECTID'] != p['OBJECTID']]
    bid, cp, lic = norm(p['CUT_BLOCK_ID']), norm(p['HARVEST_AUTH_CUTTING_PERMIT_ID']), (p['HARVEST_AUTH_FOREST_FILE_ID'] or '').upper()
    other_ids = {norm(x['CUT_BLOCK_ID']): x for x in others if x['CUT_BLOCK_ID']}
    other_lics = {(x['HARVEST_AUTH_FOREST_FILE_ID'] or '').upper() for x in others} - {lic, ''}
    for t in rec['touching']:
        tk = toks(t['name']); pairs = cp_block_pairs(t['name'])
        refs = []
        if any(is_block_token(x, bid) for x in tk) or (cp, bid) in pairs: refs.append('this_block')
        elif cp and cp in {a for a, _ in pairs}: refs.append('this_cp')
        hits_other = [x for x in tk if x in other_ids and is_block_token(x, x) and x != bid]
        if hits_other: refs.append('other_block')
        if lic and any(lic in x or x.startswith(lic) for x in tk): refs.append('this_licence')
        if any(l and any(x.startswith(l) for x in tk) for l in other_lics): refs.append('other_licence')
        t['refs'] = refs; t['other_blocks'] = [(x, other_ids[x]['DISTURBANCE_START_DATE']) for x in hits_other][:3]
    order = ['this_block', 'this_cp', 'this_licence', 'other_block', 'other_licence']
    allrefs = [r for t in rec['touching'] for r in t['refs']]
    rec['best_ref'] = next((r for r in order if r in allrefs), 'no_reference' if rec['touching'] else 'no_road')
    if (p['DISTURBANCE_START_DATE'] or '') >= '2022':
        fc = [f for f in fom(32, blk, 'FOM_ID,CUT_BLOCK_ID,NAME,PLANNED_DEVELOPMENT_DATE,FSP_HOLDER_NAME') if f.get('geometry')]
        fc = [(f, esri_shape(f['geometry'])) for f in fc]
        fc = [(f, s) for f, s in fc if s.intersection(blk).area > 0.3 * min(s.area, blk.area)]
        rec['fom'] = None
        if fc:
            f, s = max(fc, key=lambda fs: fs[1].intersection(blk).area); a = f['attributes']
            roads = [r for r in fom(31, blk.buffer(200), 'FOM_ID,NAME,PLANNED_DEVELOPMENT_DATE,PLANNED_LENGTH') if r.get('geometry') and r['attributes']['FOM_ID'] == a['FOM_ID']]
            rec['fom'] = dict(fom_id=a['FOM_ID'], planned=a['PLANNED_DEVELOPMENT_DATE'], holder=a['FSP_HOLDER_NAME'], overlap=round(s.intersection(blk).area / blk.area, 2), planned_roads_near=len(roads))
    time.sleep(0.15)
json.dump(o, open(os.path.join(CACHE, f'recent2_{DIST}.json'), 'w'), indent=1)
import collections
c = collections.Counter(r['best_ref'] for r in o)
f22 = [r for r in o if (r['block']['DISTURBANCE_START_DATE'] or '') >= '2022']
print(DIST, 'sample', len(o), '|', dict(c), '| 2022+ blocks', len(f22), 'with FOM plan', sum(1 for r in f22 if r.get('fom')))
