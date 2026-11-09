"""Build one file per setup (licence + cutting permit; licence alone when there is no CP): every FTEN block in it,
the road sections named for any of its blocks or its CP, and the other roads within 1.5 km.
Output: $CACHE/setups/<licence>_<cp>.json (EPSG:3005)."""
import os, sys, json, re, time, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
from wfs import features
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from parse_names import parse
from build_pairs import toks, pairs, block_token, norm
from generate_road import pair_files
B = 'WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'; R = 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
os.makedirs(os.path.join(CACHE, 'setups'), exist_ok=True)
setups = {}
for f in pair_files():
    b = json.load(open(f))['block']
    setups.setdefault((b['HARVEST_AUTH_FOREST_FILE_ID'], b['HARVEST_AUTH_CUTTING_PERMIT_ID']), b.get('CLIENT_NUMBER'))
for (lic, cp), client in setups.items():
    path = os.path.join(CACHE, 'setups', f"{lic}_{cp or 'none'}.json")
    if os.path.exists(path): continue
    cql = f"HARVEST_AUTH_FOREST_FILE_ID='{lic}' AND " + (f"HARVEST_AUTH_CUTTING_PERMIT_ID='{cp}'" if cp else 'HARVEST_AUTH_CUTTING_PERMIT_ID IS NULL')
    blocks = [x for x in features(B, cql, ['CUT_BLOCK_ID', 'OBJECTID', 'OPENING_ID', 'DISTURBANCE_START_DATE', 'DISTURBANCE_END_DATE', 'CLIENT_NUMBER', 'GEOMETRY'], srs='EPSG:3005') if x['geometry']]
    if not blocks: continue
    U = unary_union([shape(x['geometry']) for x in blocks])
    if max(U.bounds[2] - U.bounds[0], U.bounds[3] - U.bounds[1]) > 15000:   # licence-wide or scattered: too spread to be one setup
        json.dump(dict(licence=lic, cp=cp, skipped='extent over 15 km', n_blocks=len(blocks)), open(path, 'w')); continue
    minx, miny, maxx, maxy = U.buffer(1500).bounds
    roads = features(R, f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')", ['FOREST_FILE_ID', 'ROAD_SECTION_ID', 'ROAD_SECTION_NAME', 'FILE_TYPE_CODE', 'FILE_TYPE_DESCRIPTION', 'AWARD_DATE', 'CLIENT_NUMBER', 'LIFE_CYCLE_STATUS_CODE', 'GEOMETRY'], srs='EPSG:3005')
    ids = {norm(x['properties']['CUT_BLOCK_ID']) for x in blocks if x['properties']['CUT_BLOCK_ID']}
    ncp = norm(cp) if cp else None
    named, other = [], []
    for r in roads:
        if not r['geometry']: continue
        q = r['properties']; n = q['ROAD_SECTION_NAME']; why = None
        hit = [t for t in toks(n) if t in ids and block_token(t, t)]
        if hit: why = 'block_id'
        elif ncp and any(a == ncp and b in ids for a, b in pairs(n)): why = 'cp_block'
        else:
            x = parse(n, q['ROAD_SECTION_ID'])
            if ncp and x.get('source') == 'name' and ncp in {norm(c) for c in x.get('cps', [])} and (x.get('licence') == lic or q['CLIENT_NUMBER'] == client): why = 'cp'
        (named if why else other).append(dict(props=q, why=why, blocks=sorted(hit) if why == 'block_id' else [], geometry=r['geometry']))
    json.dump(dict(licence=lic, cp=cp, client=client, blocks=[dict(props=x['properties'], geometry=x['geometry']) for x in blocks], named=named, other=other), open(path, 'w'))
    print(lic, cp, len(blocks), 'blocks', len(named), 'named sections', len(other), 'other'); time.sleep(0.2)
