"""Blocks whose harvest started between two LidarBC flights over them. Keyset paging per year; one file per year."""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
S = sys.argv[1]
F = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/340/query'
ext = json.load(open(S + '/extent.geojson')); polys = []
for f in ext['features']:
    g = f['geometry']
    for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
        xs = [c[0] for c in p[0]]; ys = [c[1] for c in p[0]]
        polys.append((f['properties']['YEAR_'], p, (min(xs), min(ys), max(xs), max(ys))))
def in_ring(x, y, r):
    ins = False; j = len(r) - 1
    for i in range(len(r)):
        xi, yi = r[i][:2]; xj, yj = r[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: ins = not ins
        j = i
    return ins
def years_at(x, y):
    return {yr for yr, p, b in polys if b[0] <= x <= b[2] and b[1] <= y <= b[3] and in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:])}
def get(params):
    for i in range(8):
        try:
            with urllib.request.urlopen(F + '?' + urllib.parse.urlencode(params), timeout=180) as r: return json.load(r)
        except Exception as e: time.sleep(min(60, 2 ** i)); err = e
    raise err
dt = lambda v: datetime.fromtimestamp(v / 1000, timezone.utc).date().isoformat() if v else None
FIELDS = 'CUT_BLOCK_SKEY,CUT_BLOCK_ID,HARVEST_AUTH_FOREST_FILE_ID,HARVEST_AUTH_CUTTING_PERMIT_ID,ADMIN_DISTRICT_CODE,DISTURBANCE_START_DATE,DISTURBANCE_END_DATE,OPENING_ID'
for year in range(2017, 2025):
    out = f'{S}/between-{year}.json'
    if os.path.exists(out): continue
    last, seen, res = 0, 0, []
    while True:
        where = f"DISTURBANCE_START_DATE >= DATE '{year}-01-01' AND DISTURBANCE_START_DATE < DATE '{year + 1}-01-01' AND CUT_BLOCK_SKEY > {last}"
        fs = get(dict(f='geojson', where=where, outFields=FIELDS, returnGeometry='true', outSR='4326', maxAllowableOffset='0.002',
                      geometryPrecision='5', orderByFields='CUT_BLOCK_SKEY', resultRecordCount='1000')).get('features', [])
        if not fs: break
        for f in fs:
            p = f['properties']; g = f['geometry']; last = max(last, p['CUT_BLOCK_SKEY']); seen += 1
            if not g: continue
            pts = [c for q in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]) for c in q[0]]
            x, y = sum(c[0] for c in pts) / len(pts), sum(c[1] for c in pts) / len(pts)
            s, e = dt(p['DISTURBANCE_START_DATE']), dt(p['DISTURBANCE_END_DATE'])
            ys = years_at(x, y); sy = int(s[:4]); ey = int(e[:4]) if e else sy
            before = sorted(v for v in ys if v < sy); after = sorted(v for v in ys if v > ey)
            if before and after:
                res.append(dict(skey=p['CUT_BLOCK_SKEY'], block=p['CUT_BLOCK_ID'], licence=p['HARVEST_AUTH_FOREST_FILE_ID'], cp=p['HARVEST_AUTH_CUTTING_PERMIT_ID'],
                                opening=p['OPENING_ID'], start=s, end=e, district=p['ADMIN_DISTRICT_CODE'], lon=round(x, 5), lat=round(y, 5), before=before, after=after))
        print(year, seen, len(res), file=sys.stderr, flush=True)
    json.dump(dict(year=year, seen=seen, pairs=res), open(out, 'w'))
    print(year, 'seen', seen, 'pairs', len(res), flush=True)
