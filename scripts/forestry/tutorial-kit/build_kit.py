"""Builds a RoadEng-tutorial-shaped test kit on the Prince George LiDAR tile (EPSG:3157).

Usage: python3 build_kit.py <dir holding dtm-1m.f32/.json, dsm-1m.f32 and height-1m.tif, dtm-1m.tif> <output dir>
Run dump.mjs first; see README.md.
"""
import json, struct, sys, zipfile, shutil, os
import numpy as np
import shapefile  # pyshp
from pyproj import CRS, Transformer

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
meta = json.load(open(f'{src}/dtm-1m.json'))
W, H = meta['width'], meta['height']
x0, ytop = meta['origin'][0], meta['origin'][1]
dtm = np.fromfile(f'{src}/dtm-1m.f32', dtype='<f4').reshape(H, W)
dsm = np.fromfile(f'{src}/dsm-1m.f32', dtype='<f4').reshape(H, W)
rng = np.random.default_rng(20261109)

def write_las(path, x, y, z, cls):
    n = len(x)
    scale = 0.001
    off = (float(np.floor(x.min())), float(np.floor(y.min())), 0.0)
    hdr = b'LASF' + struct.pack('<HH', 0, 0) + bytes(16) + struct.pack('<BB', 1, 2)
    hdr += b'PGMaps test kit'.ljust(32, b'\0') + b'build_kit.py'.ljust(32, b'\0')
    hdr += struct.pack('<HH', 313, 2026) + struct.pack('<H', 227) + struct.pack('<I', 227) + struct.pack('<I', 0)
    hdr += struct.pack('<B', 0) + struct.pack('<H', 20) + struct.pack('<I', n) + struct.pack('<5I', n, 0, 0, 0, 0)
    hdr += struct.pack('<3d', scale, scale, scale) + struct.pack('<3d', *off)
    hdr += struct.pack('<6d', x.max(), x.min(), y.max(), y.min(), float(z.max()), float(z.min()))
    assert len(hdr) == 227
    rec = np.zeros(n, dtype=[('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('i', '<u2'), ('flags', 'u1'), ('cls', 'u1'), ('ang', 'i1'), ('user', 'u1'), ('src', '<u2')])
    rec['x'] = np.round((x - off[0]) / scale); rec['y'] = np.round((y - off[1]) / scale); rec['z'] = np.round(z / scale)
    rec['i'] = 100; rec['flags'] = 0b00001001; rec['cls'] = cls; rec['src'] = 1
    with open(path, 'wb') as f:
        f.write(hdr); f.write(rec.tobytes())
    return n

# Four tiles, 2 x 2, over the hillside the example road crosses. No CRS VLR, as in the tutorial's LAS.
X0, X1, Y0, Y1 = 511800, 512400, 5971300, 5972400
xm, ym = (X0 + X1) // 2, (Y0 + Y1) // 2
tiles = [(X0, xm, ym, Y1), (xm, X1, ym, Y1), (X0, xm, Y0, ym), (xm, X1, Y0, ym)]
summary = []
for k, (a, b, c, d) in enumerate(tiles, 1):
    cols = np.arange(a - x0, b - x0).astype(int); rows = np.arange(ytop - d, ytop - c).astype(int)
    cc, rr = np.meshgrid(cols, rows)
    g = dtm[rr, cc]; ok = g > -9000
    gx = x0 + cc[ok] + rng.uniform(0.15, 0.85, ok.sum()); gy = ytop - rr[ok] - rng.uniform(0.15, 0.85, ok.sum()); gz = g[ok].astype('f8')
    # First returns on canopy: every third cell where the surface stands more than 2 m over the ground.
    s = dsm[rr, cc]; veg = (s > -9000) & ok & ((s - g) > 2) & ((rr % 3 == 0) & (cc % 3 == 0))
    vx = x0 + cc[veg] + 0.5; vy = ytop - rr[veg] - 0.5; vz = s[veg].astype('f8')
    x = np.concatenate([gx, vx]); y = np.concatenate([gy, vy]); z = np.concatenate([gz, vz])
    cls = np.concatenate([np.full(len(gx), 2, 'u1'), np.full(len(vx), 1, 'u1')])
    order = rng.permutation(len(x))
    n = write_las(f'{out}/Tile_{k}.las', x[order], y[order], z[order], cls[order])
    summary.append((f'Tile_{k}.las', n, int(len(gx)), int(len(vx)), (a, c, b, d)))

wkt = CRS.from_epsg(3157).to_wkt('WKT1_ESRI')
def shp(name, kind, shapes, fields, records):
    w = shapefile.Writer(f'{out}/{name}', shapeType=kind)
    for f in fields: w.field(*f)
    for s, r in zip(shapes, records):
        if kind == shapefile.POLYLINE: w.line([s])
        elif kind == shapefile.POLYGON: w.poly([s])
        else: w.point(*s)
        w.record(*r)
    w.close()
    open(f'{out}/{name}.prj', 'w').write(wkt)
    with zipfile.ZipFile(f'{out}/{name}.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for ext in ('shp', 'shx', 'dbf', 'prj'): z.write(f'{out}/{name}.{ext}', f'{name}.{ext}')

road = [(512101, 5972292), (512098, 5972210), (512093, 5972120), (512090, 5972008), (512104, 5971930), (512128, 5971838),
        (512112, 5971770), (512068, 5971690), (512046, 5971648), (512040, 5971584), (512012, 5971490), (511982, 5971393)]
shp('Prelim_Rd', shapefile.POLYLINE, [road], [('NAME', 'C', 40), ('STATUS', 'C', 20)], [('Prelim Rd', 'preliminary')])
aoi = [(511940, 5972360), (512260, 5972360), (512290, 5971800), (512150, 5971330), (511850, 5971330), (511900, 5971800), (511940, 5972360)]
shp('AOI', shapefile.POLYGON, [aoi], [('NAME', 'C', 40)], [('AOI',)])
shp('Landings', shapefile.POINT, [(511982, 5971393), (512190, 5971720), (511905, 5971900)], [('NAME', 'C', 40)], [('Landing 1',), ('Landing 2',), ('Landing 3',)])
prop = [[(511810, 5971310), (512390, 5971310), (512390, 5971860), (511810, 5971860), (511810, 5971310)],
        [(511810, 5971860), (512390, 5971860), (512390, 5972390), (511810, 5972390), (511810, 5971860)]]
shp('PropertyBdy', shapefile.POLYGON, prop, [('LOT', 'C', 20)], [('Lot A',), ('Lot B',)])

# Named streams with a crossing-cost class in the name, as the tutorial's Path Explorer example does.
streams = [('STREAM_1K-0', [(511830, 5972060), (511960, 5972050), (512230, 5972075), (512380, 5972060)]),
           ('STREAM_5K-0', [(511830, 5971760), (512010, 5971745), (512200, 5971770), (512380, 5971790)]),
           ('NO-GO-0', [(512240, 5971330), (512250, 5971520), (512300, 5971700)])]
shp('Streams', shapefile.POLYLINE, [s for _, s in streams], [('NAME', 'C', 40)], [(n,) for n, _ in streams])

to_ll = Transformer.from_crs(3157, 4326, always_xy=True)
block = [(511850, 5971330), (512060, 5971320), (512100, 5971430), (512020, 5971500), (511880, 5971470), (511850, 5971330)]
coords = ' '.join('%.7f,%.7f,0' % to_ll.transform(x, y) for x, y in block)
kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Block</name>
<Placemark><name>Block A</name><description>Planned cutblock</description><Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>'''
with zipfile.ZipFile(f'{out}/Block.kmz', 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('doc.kml', kml)

shutil.copy(f'{src}/height-1m.tif', f'{out}/CHM-Image.tif')
shutil.copy(f'{src}/dtm-1m.tif', f'{out}/DTM-1m.tif')
ll = [to_ll.transform(*p) for p in (road[0], road[-1])]
open(f'{out}/README.md', 'w').write(f'''# RoadEng-tutorial test kit (Prince George LiDAR tile, BC 093G086)

Built from the published 1 m DTM/DSM by build_kit.py. Mirrors the file set the RoadEng v11 resource-road
tutorial uses (chapters 3-7, 21). All projected files are **EPSG:3157, NAD83(CSRS) / UTM zone 10N, metres**;
heights are CGVD2013 metres. This is test data: the linework is invented, only the ground is real.

| File | What it is |
| --- | --- |
| Tile_1.las ... Tile_4.las | LAS 1.2 tiles, 2 x 2 over x {X0}-{X1}, y {Y0}-{Y1}. Class 2 = ground (about 1 point per m2), class 1 = canopy first returns. **No CRS in the header**, like the tutorial's tiles. |
| Prelim_Rd.shp/.zip | Preliminary road polyline, 12 vertices, about 930 m, north to south. Start {ll[0][0]:.5f}, {ll[0][1]:.5f}; end {ll[1][0]:.5f}, {ll[1][1]:.5f} |
| AOI.shp/.zip | Area-of-interest polygon around the road (tutorial ch. 6) |
| Landings.shp/.zip | Three landing points; Landing 1 is the road end |
| PropertyBdy.shp/.zip | Two property polygons |
| Streams.shp/.zip | Three lines named STREAM_1K-0, STREAM_5K-0 and NO-GO-0 (tutorial ch. 21 crossing-cost classes). Invented, not real streams. |
| Block.kmz | A cutblock polygon in WGS84 (tutorial ch. 3) |
| CHM-Image.tif | Canopy height model GeoTIFF, 1 m (tutorial ch. 7) |
| DTM-1m.tif | The full 1 m bare-earth DTM GeoTIFF |

Point counts: ''' + '; '.join(f'{n} {t:,} ({g:,} ground, {v:,} canopy)' for n, t, g, v, _ in summary) + '\n')
for row in summary: print(row)
print(sorted(os.listdir(out)))
