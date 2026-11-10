# Tutorial test kit for the road-design workspace

These two scripts build the files used for the
[tutorial walkthrough](../../../docs/forestry-road-design/tutorial-walkthrough-2026-11-09.md): a
set shaped like the RoadEng v11 resource-road tutorial's own data (LAS tiles, shapefiles, a KMZ, a
canopy image), placed on the published Prince George 1 m LiDAR tile so the ground is real. The
tutorial's own data set installs from a Windows executable and is not redistributable, so the
walkthrough uses this instead.

The linework is invented. Only the ground comes from the LiDAR tile. Nothing here is committed
data: the kit is written to a directory you choose.

## Build

Needs Node with the repository's dependencies installed, and Python 3 with `numpy`, `pyshp` and
`pyproj`.

```sh
mkdir -p /tmp/kit-src /tmp/roadeng-kit
cd /tmp/kit-src
for f in dtm-1m dsm-1m height-1m; do
  curl -sO "https://pgmaps.ahmadjalil.com/data/lidar-analysis/bc-093g086/$f.tif"
done
cd -                                   # back to the repository root
node scripts/forestry/tutorial-kit/dump.mjs /tmp/kit-src /tmp/kit-src
python3 scripts/forestry/tutorial-kit/build_kit.py /tmp/kit-src /tmp/roadeng-kit
```

`dump.mjs` decodes the GeoTIFFs with the repository's `geotiff` package, because the rasters use a
floating-point predictor that plain Python TIFF readers need an extra codec for.

## What it writes

Everything projected is EPSG:3157 (NAD83(CSRS) / UTM zone 10N), heights in CGVD2013 metres. The
kit's own `README.md` lists the files with their point counts.

| File | Tutorial chapter it stands in for | What it exercises |
| --- | --- | --- |
| `Tile_1.las` … `Tile_4.las` | 3, 5, 6 | Four tiles in one pick; ground (class 2) and canopy (class 1); **no CRS in the header**, so the import has to ask |
| `Prelim_Rd.zip` / `.shp` | 3, 9, 22 | A 12-vertex preliminary road as a line to import, follow or reduce to an alignment |
| `Block.kmz` | 3 | A WGS84 polygon that must come in as a cutblock, not as an exclusion |
| `Landings.zip` | 7 | Point features with names |
| `AOI.zip`, `PropertyBdy.zip` | 6, 7 | Polygons that affect nothing unless the user says so |
| `Streams.zip` | 21 | Lines named `STREAM_1K-0`, `STREAM_5K-0`, `NO-GO-0` for crossing-cost classes and a no-go line |
| `CHM-Image.tif` | 7 | A 1648 × 1396 background image, larger than the display budget |
| `DTM-1m.tif` | 9 | The user's "own terrain" for a new project |
