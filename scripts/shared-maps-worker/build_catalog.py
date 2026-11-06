"""Build raster PMTiles once and publish a capability-scoped catalogue to private R2.

Credentials arrive on hidden stdin and are never written to the state directory.
Inventory/source paths and private collection URLs stay outside the public repo.
Requires GDAL CLI, rasterio, Pillow, httpx and pmtiles (tested with 3.8.1).
"""
from pathlib import Path
import argparse, concurrent.futures, hashlib, io, json, math, os, sqlite3, subprocess, sys, tempfile, termios, threading, time
import httpx, numpy as np, rasterio
from rasterio.warp import calculate_default_transform, transform_bounds
from PIL import Image
from pmtiles.writer import write
from pmtiles.reader import Reader, MmapSource
from pmtiles.tile import Compression, TileType, zxy_to_tileid

def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def create_tiles(source, dest, title):
    with rasterio.open(source) as ds:
        t,_,_=calculate_default_transform(ds.crs,3857,ds.width,ds.height,*ds.bounds)
        zoom=max(0,min(22,round(math.log2(156543.03392804097/t.a))))
        bounds=list(transform_bounds(ds.crs,4326,*ds.bounds,densify_pts=41))
        if not all(math.isfinite(x) for x in bounds):raise ValueError('Invalid geographic bounds')
    res=156543.03392804097/2**zoom;mb=dest.with_suffix('.mbtiles')
    env={**os.environ,'GDAL_PAM_ENABLED':'NO','GDAL_CACHEMAX':'128','TMPDIR':str(dest.parent)}
    command=['gdalwarp','-q','-of','MBTiles','-co','TILE_FORMAT=WEBP','-co','QUALITY=95','-dstalpha','-r','bilinear','-t_srs','EPSG:3857','-tr',str(res),str(res),'-tap',str(source),str(mb)]
    run=subprocess.run(command,capture_output=True,text=True,env=env)
    if run.returncode:raise RuntimeError(run.stderr[:1000])
    if zoom:subprocess.run(['gdaladdo','-q','-r','average',str(mb)]+[str(2**i) for i in range(1,zoom+1)],check=True,capture_output=True,env=env)
    with sqlite3.connect(mb) as db:
        meta=dict(db.execute('select name,value from metadata'))
        rows=[(z,x,(1<<z)-1-y,data) for z,x,y,data in db.execute('select zoom_level,tile_column,tile_row,tile_data from tiles')]
    rows.sort(key=lambda r:zxy_to_tileid(*r[:3]));assert rows
    header={'tile_compression':Compression.NONE,'tile_type':TileType.WEBP,'min_lon_e7':round(bounds[0]*1e7),'min_lat_e7':round(bounds[1]*1e7),'max_lon_e7':round(bounds[2]*1e7),'max_lat_e7':round(bounds[3]*1e7),'center_zoom':zoom,'center_lon_e7':round((bounds[0]+bounds[2])*5e6),'center_lat_e7':round((bounds[1]+bounds[3])*5e6)}
    with write(dest) as writer:
        for z,x,y,data in rows:writer.write_tile(zxy_to_tileid(z,x,y),data)
        writer.finalize(header,{'name':title,'format':'webp','type':'overlay','description':'Web display derivative of the source GeoTIFF. Original placement and uncertainty are preserved.','attribution':'Historical source attribution and placement limits are recorded in the catalogue.'})
    # Validate EVERY stored tile against GDAL's tile bytes, not just the header.
    with dest.open('rb') as f:
        reader=Reader(MmapSource(f));h=reader.header()
        for z,x,y,data in rows:assert reader.get(z,x,y)==data,(z,x,y)
    mb.unlink();return {'bounds':bounds,'minZoom':h['min_zoom'],'maxZoom':h['max_zoom'],'tileCount':len(rows),'width':256,'format':'webp'}

def thumbnail(source,dest):
    with rasterio.open(source) as ds:
        scale=min(600/ds.width,420/ds.height,1);w=max(1,round(ds.width*scale));h=max(1,round(ds.height*scale))
        channels=ds.read([1,2,3] if ds.count>=3 else [1],out_shape=(3 if ds.count>=3 else 1,h,w),resampling=rasterio.enums.Resampling.bilinear)
        if channels.shape[0]==1:channels=np.repeat(channels,3,axis=0)
        if channels.dtype!=np.uint8:raise ValueError('A display stretch must be specified for non-byte imagery')
        mask=ds.dataset_mask(out_shape=(h,w));im=Image.fromarray(np.moveaxis(channels,0,2));paper=Image.new('RGB',(w,h),'#eeeade');paper.paste(im,mask=Image.fromarray(mask));paper.save(dest,'WEBP',quality=84)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inventory',required=True);ap.add_argument('--raster-index',required=True);ap.add_argument('--site-root',required=True);ap.add_argument('--state-dir',required=True);ap.add_argument('--scratch',required=True);ap.add_argument('--workers',type=int,default=3);ap.add_argument('--limit',type=int);ap.add_argument('--replacement-model');args=ap.parse_args()
    state=Path(args.state_dir);state.mkdir(parents=True,exist_ok=True);scratch=Path(args.scratch);scratch.mkdir(parents=True,exist_ok=True);tempfile.tempdir=str(scratch)
    settings=None
    if sys.stdin.isatty():
        settings=termios.tcgetattr(sys.stdin.fileno());hidden=settings.copy();hidden[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,hidden)
    print('Ready for private upload settings on hidden stdin.',flush=True)
    try:config=json.loads(sys.stdin.readline())
    finally:
        if settings:termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,settings)
    endpoint=config['endpoint'].rstrip('/');share=config['shareId'];token=config['uploadToken'];base=f'{endpoint}/c/{share}/'
    # This file contains share URLs, not API credentials. It must not be committed.
    private={'catalogue_url':base+'catalog.json','viewer_url':'https://pgmaps.ahmadjalil.com/dev/view#catalog='+__import__('urllib.parse').parse.quote(base+'catalog.json',safe='')}
    private_file=state/'PRIVATE_SHARE.json'
    if private_file.exists() and json.load(open(private_file))['catalogue_url']!=private['catalogue_url']:
        raise ValueError('This state directory belongs to another collection; use a new empty state directory')
    private_file.write_text(json.dumps(private,indent=2)+'\n');os.chmod(private_file,0o600)
    inventory=json.load(open(args.inventory))['rasters'];index={r['output_id']:r for r in json.load(open(args.raster_index))};site=Path(args.site_root);collection=json.load(open(site/'assets/collection.json'));curation=json.load(open(site.parent/'curation-all.json'))
    replacement=json.load(open(args.replacement_model)) if args.replacement_model else None
    if replacement:
        old=next(r for r in inventory if r['sha256']==replacement['previous_cog_sha256']);old.update(path=replacement['cog_path'],sha256=replacement['cog_sha256'],bytes=replacement['cog_bytes'])
    featured_ids=[]
    for row in curation['recommendations']:
        for layer in row['layers']:
            match=next((r for r in inventory if r['sha256']==layer['cog_sha256']),None)
            if match:featured_ids.append(match['output_id'])
    inventory.sort(key=lambda r:(r['output_id'] not in featured_ids,featured_ids.index(r['output_id']) if r['output_id'] in featured_ids else 0))
    if args.limit:inventory=inventory[:args.limit]
    lock=threading.Lock();tls=threading.local();completed=[];failures=[]
    def client():
        if not hasattr(tls,'client'):tls.client=httpx.Client(timeout=httpx.Timeout(180,connect=30),follow_redirects=False)
        return tls.client
    def upload(path,key,mime):
        path=Path(path);checksum=sha(path);url=base+key
        for attempt in range(4):
            try:
                head=client().head(url)
                if head.status_code==200 and head.headers.get('X-Content-SHA256')==checksum and head.headers.get('Content-Length')==str(path.stat().st_size):return {'url':url,'bytes':path.stat().st_size,'sha256':checksum}
                with path.open('rb') as f:
                    response=client().put(f'{endpoint}/__upload/{share}/{key}',content=f,headers={'Authorization':'Bearer '+token,'Content-Length':str(path.stat().st_size),'Content-Type':mime,'X-Content-SHA256':checksum})
                response.raise_for_status();receipt=response.json();assert receipt['bytes']==path.stat().st_size and receipt['sha256']==checksum
                # Verify the new object independently of a cached prior catalogue.
                verified=client().get(url+'?verify='+checksum) if mime=='application/json' else client().head(url+'?verify='+checksum)
                verified.raise_for_status();assert verified.headers.get('X-Content-SHA256')==checksum
                # Edge compression can remove Content-Length from catalogue responses.
                if mime=='application/json':assert len(verified.content)==path.stat().st_size and hashlib.sha256(verified.content).hexdigest()==checksum
                else:assert int(verified.headers['Content-Length'])==path.stat().st_size
                return {'url':url,'bytes':path.stat().st_size,'sha256':checksum}
            except Exception:
                if attempt==3:raise
                time.sleep(2**attempt)
    def process(row):
        id=row['output_id'];source=Path(row['path']);checksum=row['sha256'];recordfile=state/(checksum+'.json')
        if recordfile.exists():
            record=json.load(open(recordfile));assert record['download']['sha256']==checksum;return record
        assert sha(source)==checksum,id
        original=index[id];title=original['source_title']+' · '+id.split('_')[-1]
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            td=Path(temp);pm=td/'tiles.pmtiles';thumb=td/'preview.webp';geometry=create_tiles(source,pm,title);thumbnail(source,thumb)
            raw=upload(source,'raw/'+checksum+'.tif','image/tiff');tile=upload(pm,'tiles/'+checksum+'.pmtiles','application/vnd.pmtiles');preview=upload(thumb,'previews/'+checksum+'.webp','image/webp')
            record={'id':id,'title':original['source_title'],'subtitle':id,'description':'Georeferenced raster representation from the map archive.','caveat':'Experimental placement; read the original review before drawing geographic conclusions.' if original['product_class']=='experimental_georeference' else 'Provisional archive placement under stated assumptions. This raster has not necessarily received an independent satellite accuracy review.','confidence':'experimental' if original['product_class']=='experimental_georeference' else 'provisional','assets':[{**geometry,'url':tile['url'],'bytes':tile['bytes'],'sha256':tile['sha256']}],'thumbnail':preview['url'],'download':raw,'sources':[{'title':original['source_title'],'url':original['source_url']}],'bounds':geometry['bounds'],'sourceProductClass':original['product_class']}
            recordfile.write_text(json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n')
        return record
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(process,r):r for r in inventory}
        for future in concurrent.futures.as_completed(futures):
            row=futures[future]
            try:
                record=future.result();completed.append(record);print(json.dumps({'completed':len(completed),'total':len(inventory),'id':row['output_id'],'tiles':record['assets'][0]['tileCount']}),flush=True)
            except Exception as e:
                failures.append({'id':row['output_id'],'error':type(e).__name__+': '+str(e)[:300]});print(json.dumps({'failed':row['output_id'],'error_type':type(e).__name__}),flush=True)
    (state/'FAILURES.json').write_text(json.dumps(failures,indent=2)+'\n')
    if failures:raise RuntimeError(f'{len(failures)} rasters failed; preserve state and resume after repair')
    by_sha={r['download']['sha256']:r for r in completed};featured=[]
    for item in collection['items']:
        row=next(r for r in curation['recommendations'] if r['slug']==item['id']);layers=[by_sha.get(x['cog_sha256']) for x in row['layers']]
        if not all(layers):continue
        current={k:v for k,v in item.items() if k in ['id','title','description','caveat','confidence','sources','dateLabel','alignmentReview']};current['assets']=[a for r in layers for a in r['assets']];current['bounds']=[min(r['bounds'][0] for r in layers),min(r['bounds'][1] for r in layers),max(r['bounds'][2] for r in layers),max(r['bounds'][3] for r in layers)];current['thumbnail']=layers[0]['thumbnail'];current['downloads']=[r['download'] for r in layers]
        sheets=[]
        for sheet in item.get('fullSheets',[]):
            path=site/sheet['image'];dest='sheets/'+sha(path)+path.suffix;image=upload(path,dest,'image/'+('png' if path.suffix=='.png' else 'webp'));s={k:v for k,v in sheet.items() if k not in ['image','legend']};s['image']=image['url']
            if sheet.get('legend'):
                legend=sheet['legend'];lp=site/legend['image'];uploaded=upload(lp,'sheets/'+sha(lp)+lp.suffix,'image/'+('png' if lp.suffix=='.png' else 'webp'));s['legend']={**legend,'image':uploaded['url']}
            sheets.append(s)
        current['fullSheets']=sheets;featured.append(current)
    catalogue={'schema':'raster-catalog-v1','title':'Cheslatta Map Room','description':'Historical maps, surveys, forestry, engineering and remembered landscapes.','representationCount':len(completed),'items':completed,'featured':featured,'storageBytes':sum(r['download']['bytes'] for r in completed),'tileBytes':sum(r['assets'][0]['bytes'] for r in completed),'notes':'Raster representations include panels and scan versions. Experimental and provisional placements retain their uncertainty; only30selected stories received the individual satellite review. Tile generation changes delivery, not georeferencing.'}
    path=state/'catalog.json';path.write_text(json.dumps(catalogue,ensure_ascii=False,separators=(',',':'))+'\n');receipt=upload(path,'catalog.json','application/json');(state/'PUBLICATION.json').write_text(json.dumps({'complete':True,'rawRasterCount':len(completed),'featuredStories':len(featured),'rawBytes':catalogue['storageBytes'],'tileBytes':catalogue['tileBytes'],'catalogue':receipt,'private_share':private},indent=2)+'\n');print(json.dumps({'complete':True,'rasters':len(completed),'featured':len(featured),'tileBytes':catalogue['tileBytes']}),flush=True)

if __name__=='__main__':main()
