"""For recent blocks (disturbed since 2010), classify the roads touching each block by the strongest name/ownership link."""
import os, sys, json, random, re, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
os.makedirs(os.path.join(CACHE, 'images'), exist_ok=True)
from wfs import features
from parse_names import parse
from shapely.geometry import shape
DIST, N = sys.argv[1], int(sys.argv[2]); SINCE = sys.argv[3] if len(sys.argv) > 3 else '2010-01-01'
B = 'WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'; R = 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
blocks = features(B, f"GEOGRAPHIC_DISTRICT_CODE='{DIST}' AND DISTURBANCE_START_DATE >= '{SINCE}'",
                  ['CUT_BLOCK_ID', 'HARVEST_AUTH_FOREST_FILE_ID', 'HARVEST_AUTH_CUTTING_PERMIT_ID', 'CLIENT_NUMBER', 'CLIENT_NAME', 'TIMBER_MARK', 'OPENING_ID',
                   'DISTURBANCE_START_DATE', 'DISTURBANCE_END_DATE', 'PLANNED_HARVEST_DATE', 'OBJECTID'], srs='EPSG:3005')
random.seed(int(os.environ.get('SAMPLE_SEED', '20261109'))); sample = random.sample(blocks, min(N, len(blocks)))
norm = lambda s: re.sub(r'^0+', '', (s or '').upper())
toks = lambda name: {norm(t) for t in re.split(r'[^A-Za-z0-9]+', name or '') if len(t) >= 2}
RANK = ['block_id', 'cp_block', 'cp', 'same_client_permit', 'fsr', 'other_permit', 'other']
out = []
for b in sample:
    p = b['properties']
    g = features(B, f"OBJECTID={p['OBJECTID']}", ['GEOMETRY'], srs='EPSG:3005')
    if not g or not g[0]['geometry']: continue
    blk = shape(g[0]['geometry']); minx, miny, maxx, maxy = blk.buffer(100).bounds
    secs = features(R, f"BBOX(GEOMETRY,{minx},{miny},{maxx},{maxy},'EPSG:3005')",
                    ['FOREST_FILE_ID', 'ROAD_SECTION_ID', 'ROAD_SECTION_NAME', 'FILE_TYPE_CODE', 'FILE_TYPE_DESCRIPTION', 'AWARD_DATE', 'CLIENT_NUMBER', 'LIFE_CYCLE_STATUS_CODE', 'GEOMETRY'], srs='EPSG:3005')
    bid, cp, lic = norm(p['CUT_BLOCK_ID']), norm(p['HARVEST_AUTH_CUTTING_PERMIT_ID']), (p['HARVEST_AUTH_FOREST_FILE_ID'] or '').upper()
    touching = []
    for s in secs:
        if not s['geometry']: continue
        d = shape(s['geometry']).distance(blk)
        if d > 20: continue
        q = s['properties']; x = parse(q['ROAD_SECTION_NAME'], q['ROAD_SECTION_ID'])
        cps = {norm(c) for c in x.get('cps', [])}; bl = {norm(c) for c in x.get('blocks', [])}
        lic_ok = not x.get('licence') or x['licence'] == lic
        if len(bid) >= 3 and bid in toks(q['ROAD_SECTION_NAME']): cls = 'block_id'
        elif cp in cps and lic_ok and bid in bl: cls = 'cp_block'
        elif cp in cps and lic_ok and x.get('source') == 'name': cls = 'cp'
        elif q['FILE_TYPE_CODE'] == 'B01' and q['CLIENT_NUMBER'] == p['CLIENT_NUMBER']: cls = 'same_client_permit'
        elif 'Service Road' in (q['FILE_TYPE_DESCRIPTION'] or ''): cls = 'fsr'
        elif q['FILE_TYPE_CODE'] == 'B01': cls = 'other_permit'
        else: cls = 'other'
        names_other_cp = bool(cps) and cp not in cps and x.get('source') == 'name'
        touching.append(dict(file=q['FOREST_FILE_ID'], sec=q['ROAD_SECTION_ID'], name=q['ROAD_SECTION_NAME'], type=q['FILE_TYPE_CODE'], award=(q['AWARD_DATE'] or '')[:10],
                             status=q['LIFE_CYCLE_STATUS_CODE'], cls=cls, names_other_cp=names_other_cp, dist=round(d, 1), length=round(shape(s['geometry']).length)))
    best = min((t['cls'] for t in touching), key=RANK.index) if touching else 'none'
    out.append(dict(block=p, best=best, touching=touching))
    time.sleep(0.15)
json.dump(out, open(os.path.join(CACHE, f'recent_{DIST}.json'), 'w'), indent=1)
import collections
c = collections.Counter(o['best'] for o in out)
print(DIST, len(blocks), 'recent blocks; sample', len(out), '|', ' '.join(f"{k}={c.get(k,0)}" for k in RANK + ['none']))
