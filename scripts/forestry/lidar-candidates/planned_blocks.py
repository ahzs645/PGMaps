"""Planned FTEN blocks (no opening, no harvest reported, planned from 2025) against yearly LidarBC coverage."""
import json, sys, time, urllib.parse, urllib.request, collections
from datetime import datetime, timezone
S = sys.argv[1]
F = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/340/query'
ext = json.load(open(S + '/extent.geojson'))
polys = []  # (year, [rings]) with bbox
for f in ext['features']:
    g = f['geometry']; ps = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for p in ps:
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
    out = set()
    for yr, p, b in polys:
        if b[0] <= x <= b[2] and b[1] <= y <= b[3] and in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:]): out.add(yr)
    return out
def page(where, fields, off):
    params = dict(f='geojson', where=where, outFields=fields, returnGeometry='true', outSR='4326', maxAllowableOffset='0.002',
                  geometryPrecision='5', orderByFields='CUT_BLOCK_SKEY', resultOffset=str(off), resultRecordCount='1000')
    for i in range(6):
        try:
            with urllib.request.urlopen(F + '?' + urllib.parse.urlencode(params), timeout=180) as r: return json.load(r).get('features', [])
        except Exception as e: time.sleep(2 ** i); err = e
    raise err
def fetch(where, fields):
    from concurrent.futures import ThreadPoolExecutor
    for i in range(6):
        try:
            with urllib.request.urlopen(F + '?' + urllib.parse.urlencode(dict(f='json', where=where, returnCountOnly='true')), timeout=120) as r: n = json.load(r)['count']; break
        except Exception as e: time.sleep(2 ** i); err = e
    else: raise err
    with ThreadPoolExecutor(4) as ex: pages = list(ex.map(lambda o: page(where, fields, o), range(0, n, 1000)))
    rows = [f for p in pages for f in p]
    print(where[:30], n, len(rows), file=sys.stderr, flush=True)
    return rows
def centre(g):
    if not g: return None
    pts = [c for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]) for c in p[0]]
    return (sum(c[0] for c in pts) / len(pts), sum(c[1] for c in pts) / len(pts))
def dt(v): return datetime.fromtimestamp(v / 1000, timezone.utc).date().isoformat() if v else None
FIELDS = 'CUT_BLOCK_SKEY,CUT_BLOCK_ID,HARVEST_AUTH_FOREST_FILE_ID,HARVEST_AUTH_CUTTING_PERMIT_ID,PLANNED_HARVEST_DATE,PLANNED_GROSS_BLOCK_AREA,ADMIN_DISTRICT_CODE,BLOCK_STATUS_CODE,DISTURBANCE_START_DATE,DISTURBANCE_END_DATE,OPENING_ID'
planned = fetch("OPENING_ID IS NULL AND DISTURBANCE_START_DATE IS NULL AND PLANNED_HARVEST_DATE >= DATE '2025-01-01'", FIELDS)
res = []
for f in planned:
    c = centre(f['geometry'])
    if not c: continue
    p = f['properties']; ys = years_at(*c)
    res.append(dict(skey=p['CUT_BLOCK_SKEY'], block=p['CUT_BLOCK_ID'], licence=p['HARVEST_AUTH_FOREST_FILE_ID'], cp=p['HARVEST_AUTH_CUTTING_PERMIT_ID'],
                    planned=dt(p['PLANNED_HARVEST_DATE']), ha=p['PLANNED_GROSS_BLOCK_AREA'], district=p['ADMIN_DISTRICT_CODE'], status=p['BLOCK_STATUS_CODE'],
                    lon=round(c[0], 5), lat=round(c[1], 5), lidar_years=sorted(ys)))
json.dump(res, open(S + '/screen-planned.json', 'w'))
print('planned', len(res), 'with any LiDAR', sum(bool(r['lidar_years']) for r in res), 'with 2023+', sum(any(y >= 2023 for y in r['lidar_years']) for r in res))
