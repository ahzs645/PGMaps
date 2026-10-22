#!/usr/bin/env python3
"""Package executed RGB predictions and original LiDAR crops for the workbench.

No inference is run here. RGB TIFF georeferencing is accepted only when its pixel
array exactly matches the image used during inference. Mask polygons are display
contours of the saved binary masks; box diagnostics use the original boxes.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--experiments', type=Path, required=True)
    parser.add_argument('--crops', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=Path('src/pages/dev-lidar/treeIsolation.generated.json'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source=json.loads(args.source.read_text())
    provenance={k:source[k] for k in ['schema_version','source_sha256','label_grid_sha256','input_sha256']}
    (args.output/'provenance.generated.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
    data_root = args.experiments/'DeepForest/src/deepforest/data'
    samples = []
    for sid, image_name, tiff_name, truth_name in [
        ('osbs', 'OSBS_029.png', 'OSBS_029.tif', 'OSBS_029.csv'),
        ('sjer', '2018_SJER_3_252000_4107000_image_477.tif', '2018_SJER_3_252000_4107000_image_477.tif', '2018_SJER_3_252000_4107000_image_477_truth.csv'),
    ]:
        image = Image.open(data_root/image_name).convert('RGB')
        assert np.array_equal(np.asarray(image), np.asarray(Image.open(data_root/tiff_name).convert('RGB')))
        with rasterio.open(data_root/tiff_name) as tif:
            transform, crs = tif.transform, tif.crs
            geographic = Transformer.from_crs(crs, 4326, always_xy=True)
        def pixel(x, y):
            return list(geographic.transform(*(transform*(x, y))))
        corners = [pixel(0,0), pixel(image.width,0), pixel(image.width,image.height), pixel(0,image.height)]
        buf = io.BytesIO(); image.save(buf, format='PNG')
        import csv
        truth_text = (data_root/truth_name).read_text().replace('\\r\\n','\n')
        truth = [[float(row[k]) for k in ['xmin','ymin','xmax','ymax']] for row in csv.DictReader(io.StringIO(truth_text))]
        models = {}
        for model in ['deepforest','canopy-maskrcnn']:
            file = args.experiments/f'results/{model}-{sid}.json'
            result = json.loads(file.read_text())
            assert result['sample_sha256']==sha(data_root/image_name)
            assert result['truth_sha256']==sha(data_root/truth_name)
            assert result['truth_count']==len(truth)
            masks_file = file.with_suffix('.masks.npz')
            masks = None
            if masks_file.exists():
                assert sha(masks_file)==result['masks_sha256']
                masks=np.load(masks_file)['masks']
                assert len(masks)==len(result['predictions'])
            predictions=[]
            for i,prediction in enumerate(result['predictions']):
                x0,y0,x1,y1=prediction['box']
                box = [pixel(x0,y0),pixel(x1,y0),pixel(x1,y1),pixel(x0,y1),pixel(x0,y0)]
                item={**prediction,'geometry':{'type':'Polygon','coordinates':[box]}}
                if masks is not None:
                    contours,hierarchy=cv2.findContours(masks[i].astype('uint8'),cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
                    polygons=[]
                    if hierarchy is not None:
                        for j,contour in enumerate(contours):
                            if hierarchy[0,j,3]!=-1 or len(contour)<3: continue
                            rings=[]
                            for k in [j]+[k for k in range(len(contours)) if hierarchy[0,k,3]==j]:
                                if len(contours[k])<3: continue
                                ring=[pixel(float(x)+.5,float(y)+.5) for x,y in contours[k][:,0,:]]
                                rings.append(ring+[ring[0]])
                            polygons.append(rings)
                    item['mask']={'type':'MultiPolygon','coordinates':polygons}
                predictions.append(item)
            models[model]={**result,'predictions':predictions,'result_sha256':sha(file)}
        samples.append(dict(id=sid,name='OSBS 029 · Florida' if sid=='osbs' else 'SJER 477 · California',
                            width=image.width,height=image.height,image='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(),
                            coordinates=corners,centre=pixel(image.width/2,image.height/2),
                            source_crs=str(crs),transform=list(transform)[:6],image_sha256=sha(data_root/image_name),
                            georeference_sha256=sha(data_root/tiff_name),georeference_pixels_verified=True,
                            truth=truth,truth_geometries=[{'type':'Polygon','coordinates':[[pixel(x0,y0),pixel(x1,y0),pixel(x1,y1),pixel(x0,y1),pixel(x0,y0)]]} for x0,y0,x1,y1 in truth],models=models))
    rgb=dict(schema_version=1,scope='Public RGB fixtures; separate locations from BC LiDAR; development samples, not independent validation',
             mask_display='Pixel-centre contours; isolated contours with fewer than three vertices omitted from display only',samples=samples)
    (args.output/'rgb.generated.json').write_text(json.dumps(rgb,separators=(',',':'),allow_nan=False)+'\n')
    review=json.loads((args.crops/'review.json').read_text())
    crops=[]
    for row in review['examples']:
        file=args.crops/f"{row['id']}.json"
        assert sha(file)==row['crop_sha256']
        crop=json.loads(file.read_text())
        assert crop['source_sha256']==row['source_sha256'] and len(crop['points'])==row['returns']
        crops.append({**crop,'review_note':row['review_note']})
    shapes=dict(schema_version=1,source_sha256=crops[0]['source_sha256'],crops=crops)
    (args.output/'shapes.generated.json').write_text(json.dumps(shapes,separators=(',',':'),allow_nan=False)+'\n')
    print(json.dumps({'rgb_samples':len(samples),'completed_rgb_runs':sum(len(s['models']) for s in samples),'shape_crops':len(crops),'shape_returns':sum(len(c['points']) for c in crops)}))


if __name__=='__main__': main()
