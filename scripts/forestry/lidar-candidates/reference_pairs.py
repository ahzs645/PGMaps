"""Match reference blocks + their built roads to LidarBC point-cloud tiles and classify timing."""
import gzip, json, re, sys, time, urllib.parse, urllib.request, csv
from datetime import date, timedelta
SRC = sys.argv[1]; OUT = sys.argv[2]
U = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/4/query'
d = json.load(gzip.open(SRC + '/reference-pairs.geojson.gz'))
feats = {}
for f in d['features']:
    feats.setdefault(f['properties']['pair'], []).append(f)
first = {r['oid']: r for r in csv.DictReader(open(SRC + '/road-first-seen.csv'))}
def coords(g):
    t = g['type']; c = g['coordinates']
    if t == 'Point': return [c]
    if t == 'LineString': return c
    if t == 'Polygon': return c[0]
    if t == 'MultiLineString': return [p for l in c for p in l]
    if t == 'MultiPolygon': return [p for poly in c for p in poly[0]]
    return []
def q(env):
    params = dict(f='geojson', where='1=1', geometry=','.join(f'{v:.6f}' for v in env), geometryType='esriGeometryEnvelope',
                  inSR='4326', outSR='4326', spatialRel='esriSpatialRelIntersects',
                  outFields='maptile,year,density,classes,oper_name,s3Url,filename', returnGeometry='true', resultRecordCount='200')
    for i in range(4):
        try:
            with urllib.request.urlopen(U + '?' + urllib.parse.urlencode(params), timeout=60) as r: return json.load(r)
        except Exception as e:
            time.sleep(2 ** i); err = e
    raise err
def d8(s): return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
rows = []
for n, (pair, fs) in enumerate(sorted(feats.items())):
    blk = next(f for f in fs if f['properties']['role'] == 'block')
    p = blk['properties']
    road_pts = [pt for f in fs if f['properties']['role'] == 'built_road' for pt in coords(f['geometry'])]
    blk_pts = coords(blk['geometry'])
    pts = blk_pts + road_pts
    env = (min(x for x, y in pts), min(y for x, y in pts), max(x for x, y in pts), max(y for x, y in pts))
    res = q(env)
    tiles = []
    for t in res.get('features', []):
        a = t['properties']; m = re.search(r'_(\d{8})_(\d{8})', a.get('filename') or a.get('s3Url') or '')
        xs = [c[0] for c in t['geometry']['coordinates'][0]]; ys = [c[1] for c in t['geometry']['coordinates'][0]]
        tiles.append(dict(maptile=a['maptile'], year=a['year'], density=a['density'], classes=a['classes'], oper=a['oper_name'],
                          start=str(d8(m.group(1))) if m else None, end=str(d8(m.group(2))) if m else None,
                          url=a['s3Url'], bbox=(min(xs), min(ys), max(xs), max(ys))))
    def inside(pt, b): return b[0] <= pt[0] <= b[2] and b[1] <= pt[1] <= b[3]
    # Coverage per acquisition (year+operation): share of block and road vertices inside its tiles.
    acq = {}
    for t in tiles: acq.setdefault((t['year'], t['oper'], t['start'], t['end']), []).append(t)
    acqs = []
    for (yr, oper, st, en), ts in acq.items():
        cov = lambda P: (sum(any(inside(pt, t['bbox']) for t in ts) for pt in P) / len(P)) if P else None
        acqs.append(dict(year=yr, oper=oper, start=st, end=en, tiles=len(ts), density=max(t['density'] or 0 for t in ts),
                         block_cov=cov(blk_pts), road_cov=cov(road_pts), urls=[t['url'] for t in ts]))
    fsr = first.get(p['pair'], {})
    # Road construction window: Sentinel bracket when dated, else a year before harvest start to harvest start.
    hs = date.fromisoformat(p['harvest_start']) if p.get('harvest_start') else None
    he = date.fromisoformat(p['harvest_end']) if p.get('harvest_end') else None
    if fsr.get('final') == 'dated' and fsr.get('last_before') and fsr.get('first_after'):
        w0, w1, basis = date.fromisoformat(fsr['last_before']), date.fromisoformat(fsr['first_after']), 'sentinel'
    elif hs:
        w0, w1, basis = hs - timedelta(days=365), hs, 'harvest-start'
    else:
        w0 = w1 = None; basis = 'none'
    done = he or w1
    for a in acqs:
        s, e = (date.fromisoformat(a['start']) if a['start'] else date(a['year'], 1, 1)), (date.fromisoformat(a['end']) if a['end'] else date(a['year'], 12, 31))
        a['timing'] = ('pre' if w0 and e < w0 else 'post' if done and s > done else 'during' if w0 else 'unknown')
    good = lambda a: (a['road_cov'] or 0) >= 0.9 and (a['block_cov'] or 0) >= 0.9
    rows.append(dict(pair=p['pair'], block=p['block_id'], licence=p['licence'], cp=p['cutting_permit'], opening=p.get('opening_id'),
                     client=p.get('client'), scenario=p['scenario'], tags=p['tags'], harvest_start=p.get('harvest_start'), harvest_end=p.get('harvest_end'),
                     lon=p['lon'], lat=p['lat'], window=[str(w0) if w0 else None, str(w1) if w1 else None], window_basis=basis,
                     road_vertices=len(road_pts), acquisitions=acqs,
                     pre=any(a['timing'] == 'pre' and good(a) for a in acqs), post=any(a['timing'] == 'post' and good(a) for a in acqs),
                     steep=p.get('metrics', {}).get('straight_max_grade')))
    if n % 25 == 0: print(n, file=sys.stderr)
    time.sleep(0.3)
json.dump(rows, open(OUT, 'w'))
print(len(rows), 'pre', sum(r['pre'] for r in rows), 'post', sum(r['post'] for r in rows), 'both', sum(r['pre'] and r['post'] for r in rows), 'any', sum(bool(r['acquisitions']) for r in rows))
