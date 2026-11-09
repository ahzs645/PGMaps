"""Elevation from AWS Terrarium tiles (public, no key), bilinear, cached on disk. Points in BC Albers (EPSG:3005)."""
import os, math, io, urllib.request
import numpy as np
from PIL import Image
from pyproj import Transformer
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
Z = int(os.environ.get('TERRARIUM_ZOOM', '13'))
_to_ll = Transformer.from_crs(3005, 4326, always_xy=True)
_tiles = {}
def _tile(x, y):
    k = (x, y)
    if k in _tiles: return _tiles[k]
    d = os.path.join(CACHE, 'terrarium', str(Z)); os.makedirs(d, exist_ok=True); f = os.path.join(d, f'{x}_{y}.png')
    if not os.path.exists(f):
        data = urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=60).read()
        open(f, 'wb').write(data)
    a = np.asarray(Image.open(f).convert('RGB')).astype('float64')
    _tiles[k] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return _tiles[k]
def elevation(xs, ys):
    lon, lat = _to_ll.transform(np.asarray(xs, float), np.asarray(ys, float))
    n = 2 ** Z
    fx = (lon + 180) / 360 * n * 256
    fy = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * n * 256
    out = np.empty(len(fx))
    for i, (px, py) in enumerate(zip(fx - 0.5, fy - 0.5)):
        x0, y0 = int(math.floor(px)), int(math.floor(py)); tx, ty = px - x0, py - y0
        v = []
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            X, Y = x0 + dx, y0 + dy
            v.append(_tile(X // 256, Y // 256)[Y % 256, X % 256])
        out[i] = v[0] * (1 - tx) * (1 - ty) + v[1] * tx * (1 - ty) + v[2] * (1 - tx) * ty + v[3] * tx * ty
    return out
