# AQMap ECCC Overlay Snapshots

This document records the current AQMap ECCC snapshot process and the rendering
experiments that were removed after testing. The goal is to keep the reasoning
available without keeping stale scripts and generated outputs in the repo.

## Current Contract

AQMap uses two different snapshot patterns because the source products are
different:

| Layer | Raster mode | Deck.gl mode | Reason |
| --- | --- | --- | --- |
| Fire Danger | Live CWFIS WMS tiles for `public:fdr_current_shp` | Prebuilt vector tiles from the CWFIS WFS polygon source | Fire danger is a classified polygon product. The WMS renders vector polygons; the WCS raster is a different, coarser product. |
| Modelled PM2.5 | Archived ECCC WMS PNG tiles for one snapshot time | Classified polygons generated from the matching native RAQDPS GRIB2 file | PM2.5 is a continuous model field. The native source is a 10 km rotated-lat-lon grid, not an official polygon layer. |

The browser-facing files are copied into `public/data/aqmap/` for local dev and
builds. Source-controlled snapshot files live under
`vendor/bcdatamapper/datascrapers/eccc/output/`.

## Current Commands

Build fire danger vector artifacts:

```bash
npm run aqmap:fire-danger-vector
```

Build paired PM2.5 vector/raster snapshot artifacts:

```bash
npm run aqmap:pm25-snapshot
```

Copy bcdatamapper-owned outputs into `public/data`:

```bash
npm run data:sync-from-bcdatamapper
```

`npm run dev` and `npm run build` run the sync step before serving/building.

## Current Outputs

Current checked outputs in `vendor/bcdatamapper/datascrapers/eccc/output/`:

| Artifact | Approx size | Used by |
| --- | ---: | --- |
| `fire-danger-vector.geojson.gz` | 3.5 MB | Flat source/debug artifact for fire danger polygons |
| `fire-danger-vector-tiles/` | 2.7 MB, 39 gzip GeoJSON tiles | Deck.gl fire danger layer |
| `forecast-zones.geojson` | 2.1 MB | Forecast zone vector mode |
| `modelled-pm25-native-vector.geojson.gz` | 624 KB | Deck.gl/vector PM2.5 layer |
| `modelled-pm25-raster-tiles.tar.gz` | 1.8 MB | Archived PM2.5 raster tile snapshot |

The extracted PM2.5 raster tiles in `public/data/aqmap/modelled-pm25-raster-tiles/`
are generated from the archive. The current snapshot has 1,640 PNG tiles,
1,930 transparent tiles skipped, and 0 failed requests. The extracted directory
is larger than the archive because it is many small PNG files plus filesystem
overhead.

## Fire Danger

### Source

The correct source for crisp fire danger is the CWFIS polygon layer:

```text
https://cwfis.cfs.nrcan.gc.ca/geoserver/ows
typeName=public:fdr_current_shp
```

The WMS layer renders this same polygon product:

```text
LAYERS=public:fdr_current_shp
STYLES=public:cffdrs_fdr_poly
```

The vector builder slims each feature to:

```json
{ "g": 0 }
```

where `g` is the fire danger class `0..4` for Low, Moderate, High, Very High,
and Extreme. Coordinates are rounded to six decimal places. Four decimals tested
smaller, but it made boundaries visibly angular at close zoom.

### Why Not WCS Raster

The early deck.gl fire danger attempt used the WCS raster coverage instead of
the WMS source layer. That was the root mismatch:

```text
WMS: public:fdr_current_shp vector polygons, fine curving boundaries
WCS: public__fdr_current raster, about 2 km cells
```

The raster produced axis-aligned repeated rows and coarse block boundaries. No
tiling, shader, or screenshot rendering fix could recover polygon detail from
that raster because it was the wrong product.

### Why Tiled Vector

The flat fire danger vector snapshot is several megabytes and contains thousands
of polygons. Loading it all at startup works, but it is wasteful. Prebuilt gzip
GeoJSON tiles let deck.gl load only the needed viewport while still preserving
the polygon source. The current fire danger deck layer uses those vector tiles
with no internal stroke, so class boundaries meet without artificial borders.

## Modelled PM2.5

### Source

PM2.5 is a continuous model field from RAQDPS. The current builder pairs two
representations for the same snapshot time:

1. The WMS default time is discovered from GeoMet capabilities.
2. The matching RAQDPS GRIB2 URL is derived from that model run/time.
3. The native GRIB2 is vectorized into classified polygons for deck.gl.
4. Matching WMS PNG tiles are downloaded and archived for raster mode.

The vectorizer reads the GRIB2 with `rasterio`, classifies values into the
`PM2.5_0to100ugm3_Dis` style bands, masks near-transparent background values,
densifies grid-cell edges, transforms from the native rotated grid to WGS84, and
writes a gzip GeoJSON snapshot.

### Why Not the Old WCS ASCII Grid

The first PM2.5 conversion used GeoMet WCS `image/x-aaigrid`. It was removed
because it did not reliably match the WMS render:

- It was easy to compare against a different time than the WMS default.
- The output was not the same rendered footprint users saw in GeoMet/AniMet.
- The native RAQDPS grid is rotated; treating cells as simple lon/lat boxes made
  large-scale alignment and edge shape visibly wrong.
- It produced stale app artifacts named `modelled-pm25-example.*`, which made it
  unclear whether they were production data or test data.

### Why Not WMS PNG Stitch Vectorization

We also tested fetching a high-resolution WMS PNG over the area, classifying
pixels by color, polygonizing the result, and reprojecting the polygons. This
could visually approximate one screenshot, but it was rejected:

- It vectorized a rendered image, not the underlying model field.
- Results depended on requested extent, pixel size, WMS style, antialiasing, and
  transparency.
- Polygon output could contain holes, broken fragments, and cut edges where the
  requested image ended.
- A tiled variant created thousands of loose files and still only traced WMS
  pixels.
- It could never be a clean source of truth for comparing raster and deck.gl,
  because the deck data would be derived from the raster image rather than from
  the same native model source.

### Why Not Static PM2.5 Vector Tiles

PM2.5 deck.gl now loads a single gzip vector snapshot of about 624 KB. Splitting
that into thousands of static vector tile files adds request overhead and repo
noise without solving a real load problem. Raster mode is different: it naturally
uses WMS PNG tiles, so those are archived as one `tar.gz` and extracted into
`public/data` for serving.

## Rendering Modes

`/dev/aqmap/main` forces the two key AQ overlays to the new deck.gl paths:

```text
modelledPm25 -> deck.gl native GRIB-derived vector snapshot
fireDanger   -> deck.gl CWFIS WFS-derived vector tiles
```

The full `/dev/aqmap` page still has render-mode toggles for comparison and
debugging. PM2.5 raster mode uses the archived local WMS PNG tiles. Fire danger
raster mode uses live WMS tiles from the same CWFIS polygon source.

## Removed Experiments

The following experiment paths were removed:

| Removed artifact | Reason |
| --- | --- |
| `scripts/build-aqmap-pm25-example.mjs` | WCS ASCII-grid experiment; did not match the WMS/native model projection well enough. |
| `scripts/build-aqmap-pm25-native-vector.mjs` | Redundant one-off wrapper; replaced by `npm run aqmap:pm25-snapshot`. |
| `scripts/build-aqmap-pm25-wms-stitch-vector.mjs` | WMS PNG trace experiment; not a source-of-truth vector product. |
| `wms-stitch-vectorize.py` | Helper for the removed WMS PNG trace experiment. |
| `modelled-pm25-example.*` | Output from the removed WCS experiment. |
| `modelled-pm25-wms-stitch-vector.geojson.gz` | Output from the removed WMS PNG trace experiment. |
| `modelled-pm25-vector-tiles/` | Loose-file tile experiment; not needed for a 624 KB PM2.5 vector snapshot. |

## Practical Rule

Use vector snapshots when the source is genuinely vector or when a native model
grid is polygonized in its native projection. Use raster tiles when the source is
already a rendered image product or when the product is continuous and the
raster representation is the user-facing reference. Do not polygonize rendered
PNG tiles unless the goal is explicitly visual tracing rather than source-faithful
data.
