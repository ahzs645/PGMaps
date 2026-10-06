import argparse,zipfile,hashlib,json,io,time,concurrent.futures,collections
from pathlib import Path
from PIL import Image

def oracle(inputs):
 provider, archive_dir, ROOT = inputs
 start=time.monotonic();z=zipfile.ZipFile(str(archive_dir/(provider+'-output.zip')));count=0;levels=collections.Counter()
 with (ROOT/(provider+'-oracle.ndjson')).open('w') as out:
  for name in sorted(z.namelist()):
   if '/tiles/' not in name or not name.endswith('.png'):continue
   parts=name.split('/tiles/')[1].split('/');layer,zoom,x,y=parts[0],int(parts[1]),int(parts[2]),int(parts[3][:-4])
   original=z.read(name)
   with Image.open(io.BytesIO(original)) as im:
    mode=im.mode;size=im.size;rgba=im.convert('RGBA').tobytes()
   row={'provider':provider,'layer':layer,'z':zoom,'x':x,'y':y,'archiveEntry':name,'pngSha256':hashlib.sha256(original).hexdigest(),'rgbaSha256':hashlib.sha256(rgba).hexdigest(),'mode':mode,'width':size[0],'height':size[1]}
   out.write(json.dumps(row,separators=(',',':'))+'\n');count+=1;levels[(layer,zoom)]+=1
   if count%10000==0:print(provider,count,'source files independently decoded',round(time.monotonic()-start,1),'seconds',flush=True)
 result={'provider':provider,'tiles':count,'archiveSha256':hashlib.sha256(Path(str(archive_dir/(provider+'-output.zip'))).read_bytes()).hexdigest(),'levels':[{'layer':l,'zoom':z,'tiles':n} for (l,z),n in sorted(levels.items())],'seconds':time.monotonic()-start}
 (ROOT/(provider+'-inventory.json')).write_text(json.dumps(result,indent=2));print(provider,'oracle complete',count,round(result['seconds'],1),'seconds',flush=True)
if __name__=='__main__':
 parser=argparse.ArgumentParser(description='Independently decode every archived Bell/Rogers source PNG using Pillow.')
 parser.add_argument('--archives',type=Path,required=True)
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--workers',type=int,default=2,choices=range(1,5))
 args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:list(pool.map(oracle,[(provider,args.archives,args.output) for provider in ['bell','rogers']]))
