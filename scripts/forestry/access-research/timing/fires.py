"""For each pair, BC historical (and current-year) fire perimeters from 2016 on within 300 m of the block or measured road.
Writes fires.json {oid: [{year, number, label, overlap_road_m2, overlap_block_m2}]}. One WFS request per layer per pair, 1 s apart."""
import json, glob, os, sys, time
from shapely.geometry import shape
from shapely.ops import unary_union
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from wfs import features
HERE = os.path.dirname(os.path.abspath(__file__))
out = {}
for p in open(os.path.join(HERE, 'pairs_2019.txt')).read().split():
    d = json.load(open(os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research') + '/' + p)); blk = shape(d['block_geometry']).buffer(0)
    spur = unary_union([shape(s['geometry']) for s in d['spur'] if s['geometry']])
    area = unary_union([blk, spur.buffer(80)])
    x0, y0, x1, y1 = area.buffer(300).bounds
    hits = []
    for layer in ('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP', 'WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP'):
        try:
            fs = features(layer, f"BBOX(SHAPE,{x0},{y0},{x1},{y1},'EPSG:3005') AND FIRE_YEAR>=2016", ['FIRE_YEAR', 'FIRE_NUMBER', 'FIRE_SIZE_HECTARES', 'SHAPE'], srs='EPSG:3005')
        except Exception as e:
            print(p, layer[-25:], 'error', e, file=sys.stderr); fs = []
        for f in fs:
            g = shape(f['geometry']).buffer(0)
            hits.append(dict(year=f['properties']['FIRE_YEAR'], number=f['properties']['FIRE_NUMBER'], size_ha=f['properties'].get('FIRE_SIZE_HECTARES'),
                             overlap_spur80_m2=round(g.intersection(spur.buffer(80)).area), overlap_block_m2=round(g.intersection(blk).area)))
        time.sleep(1)
    out[d['block']['OBJECTID']] = hits
    if hits: print(d['block']['OBJECTID'], d['block']['CUT_BLOCK_ID'], hits, file=sys.stderr)
json.dump(out, open(os.path.join(HERE, 'fires.json'), 'w'), indent=1)
print(len(out), sum(bool(v) for v in out.values()))
