"""Confirm candidates against LidarBC DEM (layers 5, 6) and point-cloud (4) tiles at the block centre."""
import json, glob, random, re, sys, time, urllib.parse, urllib.request, collections
S = sys.argv[1]
B = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/'
def get(layer, lon, lat, e=0.002):
    p = dict(f='json', where='1=1', geometry=f'{lon - e},{lat - e},{lon + e},{lat + e}', geometryType='esriGeometryEnvelope', inSR='4326',
             spatialRel='esriSpatialRelIntersects', outFields='year,filename,oper_name', returnGeometry='false')
    for i in range(6):
        try:
            with urllib.request.urlopen(B + f'{layer}/query?' + urllib.parse.urlencode(p), timeout=60) as r: return [a['attributes'] for a in json.load(r).get('features', [])]
        except Exception as ex: time.sleep(2 ** i); err = ex
    raise err
def flown(a):
    m = re.search(r'_(\d{8})_(\d{8})', a.get('filename') or ''); return m.group(1) if m else None
def survey(lon, lat):
    out = {}
    for layer, kind in ((4, 'laz'), (5, 'dem2500'), (6, 'dem20000')):
        for a in get(layer, lon, lat):
            if FLOOD.search(a.get('oper_name') or ''): continue
            out.setdefault(a['year'], set()).add(kind)
            if flown(a): out.setdefault(f"flown{a['year']}", set()).add(flown(a))
    return out
# Interior districts only; DCR is Campbell River, on the coast.
interior = {'DPG', 'DQU', 'DCC', 'DVA', 'DMK', 'DPC', 'DSE', 'DOS', 'DRM', 'DMH', 'DND', 'DKA', 'DFN', 'DTR', 'DCS', 'DSS', 'DJA'}
# Flood-mapping surveys are indexed whole but hold data mostly on the valley floor; never count them as coverage.
FLOOD = re.compile(r'\bNDMP\b|flood', re.I)
random.seed(11); result = {}
# Before/after: a DEM before harvest and a DEM after, opening ID present (opens the study).
P = [p for f in sorted(glob.glob(S + '/between-*.json')) for p in json.load(open(f))['pairs'] if p['district'] in interior and p['opening'] and p['opening'] > 0]
by = collections.defaultdict(list)
for p in P: by[p['district']].append(p)
picked = []
for d in sorted(by, key=lambda d: -len(by[d])):
    for p in random.sample(by[d], min(6, len(by[d]))):
        s = survey(p['lon'], p['lat']); sy = int(p['start'][:4]); ey = int((p['end'] or p['start'])[:4])
        dem = lambda y: any(k.startswith('dem') for k in s.get(y, ()))
        pre = [y for y in s if isinstance(y, int) and y < sy and dem(y)]; post = [y for y in s if isinstance(y, int) and y > ey and dem(y)]
        if pre and post:
            picked.append(dict(p, dem_before=max(pre), dem_after=min(post), survey={str(k): sorted(v) for k, v in s.items()})); break
    if len(picked) >= 8: break
result['beforeAfter'] = picked
# Planned: a DEM flown before the planned harvest, planned 2026-27, plausible area.
pl = [r for r in json.load(open(S + '/screen-planned.json')) if r['district'] in interior and r['planned'][:4] in ('2026', '2027')
      and any(y >= 2024 for y in r['lidar_years']) and r['ha'] and 3 <= r['ha'] <= 120]
by = collections.defaultdict(list)
for r in pl: by[r['district']].append(r)
picked = []
for d in sorted(by, key=lambda d: -len(by[d])):
    for r in random.sample(by[d], min(5, len(by[d]))):
        s = survey(r['lon'], r['lat'])
        dems = [y for y in s if isinstance(y, int) and any(k.startswith('dem') for k in s[y]) and y >= 2023]
        if dems:
            picked.append(dict(r, dem_year=max(dems), survey={str(k): sorted(v) for k, v in s.items()})); break
    if len(picked) >= 8: break
result['planned'] = picked
json.dump(result, open(S + '/confirmed.json', 'w'), indent=1)
for k, v in result.items():
    print(k, len(v))
    for r in v: print('  ', r['district'], r['block'], r['licence'], r.get('cp'), r.get('opening'), r.get('start') or r.get('planned'), r.get('dem_before'), r.get('dem_after'), r.get('dem_year'))
