#!/usr/bin/env python3
"""Build a run-scoped inventory of all candidates in the seven matched cores."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from prepare_full_tile import DTYPE
from pyproj import Transformer
from shapely.geometry import MultiPoint, Point, mapping, shape
from shapely.ops import transform


def build(root, inputs, runs, foresttools, output, analysis):
    snapshot = json.loads((root/'src/pages/dev-lidar/comparisons/neural.generated.json').read_text())
    manifest = json.loads((inputs/'manifest.json').read_text())
    assert snapshot['source_sha256'] == manifest['source_sha256']
    vri = json.loads((root/'src/pages/dev-lidar/volume/vri.generated.json').read_text())
    stands = [(shape(f['geometry']), f['properties']['inventory']) for f in vri['stands']['features']]
    projection = Transformer.from_crs(3157,4326,always_xy=True)
    origin = np.array(manifest['origin_xy'])
    features=[]
    point_hashes=[json.loads((runs/m/f'tile-{sample["id"]}.json').read_text())['point_output_sha256'] for m in ['sat','forainet'] for sample in snapshot['samples']]
    run_id=hashlib.sha256(json.dumps({'source':snapshot['source_sha256'],'snapshot':snapshot['snapshot_utc'],'point_hashes':point_hashes,'foresttools':'1.0.4','fora':'e866d5b6a8cf0267515cd0fedef95043f3df3c01','schema':2},sort_keys=True).encode()).hexdigest()[:16]
    def add(method,chunk,label,geom,xy,height,p95,point_count,ground,slope,aspect,boundary,band,stem_band,texture=None,window=None):
        lon,lat = projection.transform(*xy)
        inv = next((i for g,i in stands if g.covers(Point(lon,lat))),{})
        ident=f"{run_id}:{method}:{chunk}:{label}"
        if geom.geom_type not in ['Polygon','MultiPolygon','Point']:geom=Point(xy)
        area=float(geom.area) if geom.geom_type in ['Polygon','MultiPolygon'] else None
        lo=origin+np.array(list(map(int,chunk.split('-'))))*50
        hi=lo+50
        p={'id':ident,'local_id':f'{method}:{chunk}:{label}','method':method,'chunk':chunk,'label':int(label),
           'lon':lon,'lat':lat,'height_m':round(float(height),2),'p95_m':None if p95 is None else round(float(p95),2),
           'crown_area_m2':None if area is None else round(area,3),
           'crown_diameter_m':None if area is None else round(2*np.sqrt(area/np.pi),3),
           'point_count':point_count,'ground_m':round(float(ground),2),'slope_deg':round(float(slope),2),
           'aspect_deg':round(float(aspect)%360,1),'boundary':bool(boundary),'breast_height_returns':band,'stem_band_returns':stem_band,
           'vri_id':inv.get('FEATURE_ID'),'vri_species':inv.get('SPECIES_CD_1'),'vri_species_pct':inv.get('SPECIES_PCT_1'),
           'vri_net_m3_ha':inv.get('LIVE_STAND_VOLUME_125'),'vri_basal_area_m2_ha':inv.get('BASAL_AREA'),
           'texture_entropy':texture,'detection_window_radius_m':window,
           'geometry_method':'CHM marker-controlled watershed' if method.startswith('foresttools') else 'Convex hull of assigned core crown returns',
           'sample_key':f'{method}:{chunk}:{label}' if method in ['sat','forainet'] else None}
        features.append({'type':'Feature','geometry':mapping(transform(projection.transform,geom)),'properties':p})
    with rasterio.open(analysis/'dtm-1m.tif') as dtm, rasterio.open(analysis/'slope.tif') as slope_raster:
        dem=dtm.read(1); gy,gx=np.gradient(dem,1.,1.);aspect=(np.degrees(np.arctan2(-gx,gy))+360)%360
        def terrain(x,y):
            row,col=dtm.index(x,y)
            return float(dem[row,col]),float(next(slope_raster.sample([(x,y)]))[0]),float(aspect[row,col])
        for sample in snapshot['samples']:
            key=sample['id'];raw=np.memmap(inputs/f'tile-{key}.bin',dtype=DTYPE,mode='r')
            xyz=np.column_stack([raw[k] for k in ['X','Y','Z']]).astype(float)*manifest['scales']+manifest['offsets']
            ground=np.ma.concatenate(list(dtm.sample(xyz[:,:2],masked=True))).filled(np.nan)
            assert np.all(np.isfinite(ground))
            heights=xyz[:,2]-ground
            lo=origin+np.array(list(map(int,key.split('-'))))*50;hi=lo+50
            model_points={}
            for method in ['sat','forainet']:
                path=runs/method/f'tile-{key}.npz';meta=json.loads(path.with_suffix('.json').read_text())
                assert hashlib.sha256(path.read_bytes()).hexdigest()==meta['point_output_sha256']
                with np.load(path) as data:
                    core=data['core'];assert np.array_equal(raw['row'],data['source_rows'][core]);labels=data['instance'][core];sem=data['semantic'][core]
                model_points[method]=(labels,sem)
                for label in np.unique(labels[labels>=0]):
                    idx=np.flatnonzero(labels==label)
                    if heights[idx].max()<5:continue
                    crown=idx[np.isin(sem[idx],[3,4])] if method=='forainet' else idx
                    if not len(crown):crown=idx
                    geom=MultiPoint(xyz[crown,:2]).convex_hull
                    apex=idx[np.argmax(heights[idx])];xy=xyz[apex,:2]
                    g,s,a=terrain(*xy)
                    edge=np.any(xyz[idx,:2].min(axis=0)<lo+.3) or np.any(xyz[idx,:2].max(axis=0)>hi-.3)
                    band=(heights[idx]>=.8)&(heights[idx]<=1.8)
                    add(method,key,label,geom,xy,heights[apex],np.percentile(heights[idx],95),len(idx),g,s,a,edge,int(band.sum()),int((band&(sem[idx]==2)).sum()) if method=='forainet' else None)
            for method in ['fora-fixed','fora-variable']:
                saved=foresttools/f'{key}-{method}.json'
                if not saved.exists():continue
                result=json.loads(saved.read_text());assert result['source_sha256']==snapshot['source_sha256'] and np.array_equal(result['source_rows'],raw['row'])
                labels=np.array(result['labels']);sem=np.ones(len(labels),dtype=int);labels=labels-1
                model_points[method]=(labels,sem)
                for label in np.unique(labels[labels>=0]):
                    idx=np.flatnonzero(labels==label);geom=MultiPoint(xyz[idx,:2]).convex_hull;apex=idx[np.argmax(heights[idx])];xy=xyz[apex,:2];g,s,a=terrain(*xy)
                    edge=np.any(xyz[idx,:2].min(axis=0)<lo+.3) or np.any(xyz[idx,:2].max(axis=0)>hi-.3)
                    add(method,key,label,geom,xy,heights[apex],np.percentile(heights[idx],95),len(idx),g,s,a,edge,int(((heights[idx]>=.8)&(heights[idx]<=1.8)).sum()),None)
            # Per-core lazy point assets: original returns, not a display subsample.
            lon,lat=projection.transform(xyz[:,0],xyz[:,1])
            point_rows=[[round(float(lon[i]),8),round(float(lat[i]),8),round(float(p[2]),2),round(float(heights[i]),2),int(raw['row'][i]),int(model_points['sat'][0][i]),int(model_points['forainet'][0][i]),int(model_points['sat'][1][i]),int(model_points['forainet'][1][i])]+[int(model_points[m][0][i]) if m in model_points else -1 for m in ['fora-fixed','fora-variable']] for i,p in enumerate(xyz)]
            payload=json.dumps({'source_sha256':snapshot['source_sha256'],'run_id':run_id,'chunk':key,'points':point_rows},separators=(',',':')).encode()
            point_dir=output.parent/'points';point_dir.mkdir(parents=True,exist_ok=True)
            (point_dir/f'{key}.json').write_text(json.dumps({'encoding':'gzip-base64','data':base64.b64encode(gzip.compress(payload,mtime=0)).decode()},separators=(',',':'))+'\n')
            if (foresttools/'foresttools-run.json').exists():
                for method in ['foresttools-fine','foresttools-base','foresttools-coarse']:
                    prefix=foresttools/f'{key}-{method}'
                    tops=json.loads(prefix.with_name(prefix.name+'-tops.geojson').read_text())
                    crowns=json.loads(prefix.with_name(prefix.name+'-crowns.geojson').read_text())
                    lookup={str(f['properties']['treeID']):f for f in crowns['features']}
                    import csv
                    tex=list(csv.DictReader(prefix.with_name(prefix.name+'-texture.csv').open()))
                    for top in tops['features']:
                        label=str(top['properties']['treeID']);c=lookup.get(label)
                        if c is None:continue
                        geom=shape(c['geometry']);xy=top['geometry']['coordinates'][:2];g,s,a=terrain(*xy)
                        # Package reports its segment column as 'layer'/'segs'/etc. Keep the actual names in provenance.
                        row=next((t for t in tex if any(str(t.get(k))==label for k in ['treeID','segment','seg','ID','layer'])),None)
                        entropy=None
                        if row:
                            entry=next((val for k,val in row.items() if 'entropy' in k.lower()),None)
                            if entry not in [None,'NA','NaN','']:entropy=float(entry)
                        b=geom.bounds;edge=b[0]<lo[0] or b[1]<lo[1] or b[2]>hi[0] or b[3]>hi[1]
                        add(method,key,int(label),geom,xy,top['properties']['height'],None,None,g,s,a,edge,None,None,entropy,top['properties'].get('winRadius'))
    cells=[f for f in snapshot['cells']['features'] if f['properties']['id'] in {s['id'] for s in snapshot['samples']}]
    result={'schema_version':1,'run_id':run_id,'source_sha256':snapshot['source_sha256'],'snapshot_utc':snapshot['snapshot_utc'],
            'scope':'All height >=5 m candidates in seven complete core shards; preliminary core-local neural IDs, no census claim',
            'area_method':'EPSG:3157 planimetric hectares; non-overlapping 50 m core footprints',
            'support':{'type':'FeatureCollection','features':cells},'outline':snapshot['outline'],'bounds':snapshot['bounds'],
            'methods':[{ 'id':m,'name':n,'parameters':params} for m,n,params in [
                ('sat','SegmentAnyTree',{'voxel_m':.2,'radius_m':8,'core_m':50}),('forainet','ForAINet',{'voxel_m':.2,'radius_m':8,'core_m':50}),
                ('foresttools-fine','ForestTools · smaller windows',{'slope':.04,'intercept_m':.5,'min_height_m':5,'crown_min_m':2}),
                ('foresttools-base','ForestTools · reference windows',{'slope':.06,'intercept_m':.5,'min_height_m':5,'crown_min_m':2}),
                ('foresttools-coarse','ForestTools · larger windows',{'slope':.10,'intercept_m':.5,'min_height_m':5,'crown_min_m':2}),
                ('fora-fixed','FORA · fixed window',{'cell_m':1,'min_height_m':5,'radius_m':3,'buffer_m':0}),('fora-variable','FORA · variable mixed-forest window',{'cell_m':1,'min_height_m':5,'buffer_m':0})]],
            'height_sha256':hashlib.sha256((analysis/'height-1m.tif').read_bytes()).hexdigest(),'fora':json.loads((foresttools/'fora-run.json').read_text()) if (foresttools/'fora-run.json').exists() else None,
            'foresttools':json.loads((foresttools/'foresttools-run.json').read_text()) if (foresttools/'foresttools-run.json').exists() else None,
            'crowns':{'type':'FeatureCollection','features':features}}
    output.parent.mkdir(exist_ok=True,parents=True);output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(json.dumps({'features':len(features),'by_method':{m:sum(f['properties']['method']==m for f in features) for m in [x['id'] for x in result['methods']]},'bytes':output.stat().st_size}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for a in ['root','input','run','foresttools','output','analysis']:p.add_argument('--'+a,type=Path,required=True)
    a=p.parse_args();build(a.root,a.input,a.run,a.foresttools,a.output,a.analysis)
