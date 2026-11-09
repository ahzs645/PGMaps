"""Build block-road pair files: the block, the road sections named for it, and the road/block context within 3 km.

Input: recent2_<DIST>.json files from recent_blocks2.py (blocks whose touching road names them).
Output: $ACCESS_RESEARCH_CACHE/pairs/<OBJECTID>.json, all geometry in BC Albers (EPSG:3005).
"""
import os, sys, json, re, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
from wfs import features
from shapely.geometry import shape, mapping

B = 'WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'; R = 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
norm = lambda s: re.sub(r'^0+(?=.)', '', (s or '').upper())
def toks(name): return {norm(x) for x in re.split(r'[^A-Za-z0-9]+', (name or '').upper()) if x}
def pairs(name):
    n = (name or '').upper(); out = set()
    for a, b in re.findall(r'(?<![A-Z0-9])(?:CP\s*)?(\d{1,4}[A-Z]?)\s*[-/]\s*(\d{1,4}[A-Z]?)(?![0-9])', n): out.add((norm(a), norm(b)))
    for a, b in re.findall(r'CP\s*#?\s*(\d{1,4}[A-Z]?)\D{0,6}BL(?:OC)?K\s*#?\s*(\w{1,6})', n): out.add((norm(a), norm(b)))
    return out
def block_token(t, bid): return t == bid and (len(bid) >= 3 or (re.search(r'[A-Z]', bid) and re.search(r'\d', bid)))
def names_block(name, bid, cp): return any(block_token(t, bid) for t in toks(name)) or (cp and (cp, bid) in pairs(name))

def build(rec):
    p = rec['block']; oid = p['OBJECTID']; path = os.path.join(CACHE, 'pairs', f'{oid}.json')
    if os.path.exists(path): return 'cached'
    blk = shape(features(B, f'OBJECTID={oid}', ['GEOMETRY'], srs='EPSG:3005')[0]['geometry'])
    bid, cp = norm(p['CUT_BLOCK_ID']), norm(p['HARVEST_AUTH_CUTTING_PERMIT_ID'])
    minx, miny, maxx, maxy = blk.buffer(3000).bounds; bb = f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')"
    roads = features(R, bb, ['FOREST_FILE_ID', 'ROAD_SECTION_ID', 'ROAD_SECTION_NAME', 'FILE_TYPE_CODE', 'FILE_TYPE_DESCRIPTION', 'AWARD_DATE', 'CLIENT_NUMBER', 'LIFE_CYCLE_STATUS_CODE', 'RETIREMENT_DATE', 'GEOMETRY'], srs='EPSG:3005')
    blocks = features(B, bb, ['CUT_BLOCK_ID', 'HARVEST_AUTH_FOREST_FILE_ID', 'HARVEST_AUTH_CUTTING_PERMIT_ID', 'DISTURBANCE_START_DATE', 'OBJECTID', 'GEOMETRY'], srs='EPSG:3005')
    touching_files = {t['file'] for t in rec['touching'] if 'this_block' in t.get('refs', [])}
    spur, context = [], []
    for r in roads:
        if not r['geometry']: continue
        q = r['properties']
        item = dict(props=q, geometry=r['geometry'])
        (spur if q['FOREST_FILE_ID'] in touching_files and names_block(q['ROAD_SECTION_NAME'], bid, cp) else context).append(item)
    # tag context roads with the nearby block they name, if any, and that block's harvest start
    others = {}
    for b in blocks:
        bp = b['properties']
        if bp['OBJECTID'] == oid or not bp['CUT_BLOCK_ID']: continue
        others.setdefault(norm(bp['CUT_BLOCK_ID']), []).append(bp)
    for c in context:
        named = [x for t in toks(c['props']['ROAD_SECTION_NAME']) if t in others and block_token(t, t) for x in others[t]]
        c['names_block'] = [dict(id=x['CUT_BLOCK_ID'], start=x['DISTURBANCE_START_DATE']) for x in named][:3]
    out = dict(block=p, block_geometry=mapping(blk), spur=spur, context=context,
               nearby_blocks=[dict(props=b['properties'], geometry=b['geometry']) for b in blocks if b['geometry'] and b['properties']['OBJECTID'] != oid])
    json.dump(out, open(path, 'w'))
    return f'{len(spur)} spur sections, {len(context)} context roads'

if __name__ == '__main__':
    for dist in sys.argv[1:]:
        for rec in json.load(open(os.path.join(CACHE, f'recent2_{dist}.json'))):
            if rec['best_ref'] != 'this_block': continue
            print(dist, rec['block']['CUT_BLOCK_ID'], build(rec)); time.sleep(0.2)
