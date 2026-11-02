# Browser LiDAR restoration and stand structure

Open `/dev/forestry/road-restoration` or `/dev/lidar/restoration`. Both routes use
the same workspace, worker and pure calculation modules. The Forestry library,
LiDAR library and Road design terrain tab link to it.

Choose classified LAS/LAZ files from local storage, select grid sizes, and run.
Files are read inside a disposable browser worker; neither raw files nor decoded
points are sent to a processing service. The basemap still requests public map
tiles. Cancel terminates the worker and releases its WASM heap. A completed run
returns only typed raster arrays and metadata to the page. Changing inputs or
grid sizes clears results to prevent exporting stale calculations.

## Products and methods

The starting reference is [BC Government SCRIP](https://github.com/bcgov/SCRIP-LiDAR-Road-Restoration/tree/7a6d042221d4953de5f97311171297dcf9d1b107).
This is an independent browser adaptation. Unlike the source's lidR TIN, the
browser averages class 2 ground returns at 1 m by default, fills short gaps in
three simultaneous passes (at least three finite neighbours), and normalizes
returns with bilinear ground sampling. Large holes remain missing. Source
coordinates and heights must be in metres; no vertical transformation or ground
classification is performed. The browser excludes noise classes 7/18 and
withheld returns before both terrain and density calculations.

| Product                  | Default cell | Definition                                                                         |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------- |
| Ground elevation         | 1 m          | Ground-cell mean with limited gap filling                                          |
| Slope (%)                | 1 m          | Horn 3 × 3 derivative magnitude × 100; complete support required                   |
| Mean first-return height | 10 m         | Arithmetic mean normalized height of first returns, including low/negative returns |
| Vegetation density       | 2 m          | Returns strictly above 0.5 m / full cell area                                      |
| Canopy return cover      | 2 m          | Returns strictly above 0.5 m / all accepted returns × 100                          |
| Understory               | 2 m          | Returns in (0.5, 2] m / all accepted returns × 100                                 |
| Midstory                 | 2 m          | Returns in (2, 10] m / all accepted returns × 100                                  |
| Overstory                | 2 m          | Returns above 10 m / all accepted returns × 100                                    |
| Ground density           | 2 m          | Class 2 returns / full cell area                                                   |
| Normalization support    | 2 m          | Returns with usable terrain / all accepted returns × 100                           |

Every accepted return is counted; density inputs are never thinned. Cells with
no accepted returns are NoData. A cell with observed non-ground returns can
have a measured zero ground density. Vegetation cells with any unsupported
return remain NoData; mean-height cells require support for every first return.
The support product makes that distinction inspectable. Boundary densities
divide by the full grid cell area, rather than an invented occupied footprint.
An elevated building return can enter height bands; these are not automatically
vegetation-class, species, biomass or restoration-suitability estimates.

The additional [PEMlidr](pemlidr-browser-audit.md) family uses a separate 5 m
grid. It excludes class 2 as well as noise/withheld returns and heights above
100 m. Eligible counts include heights at/below 2 m (including negatives).
Above-cutoff counts, mean, RMS and sample standard deviation use heights strictly
above 2 m. Standard deviation has an n − 1 denominator; fewer than two
participating returns is NoData. First-return cover divides eligible first
returns above 2 m by all eligible first returns. The extra coefficient of
variation divides sample deviation by mean, as a ratio. It is **not** the source
command's `cov`, which means canopy cover. Missing terrain makes the structural
cell incomplete. These declared formulas are not a claim of LAStools binary
parity. Percentile CHMs, skewness and kurtosis are not implemented.

## GIS interoperability and reuse

All 17 products export as uncompressed float32 GeoTIFFs with their exact
projected grid, metre pixel spacing and explicit NaN NoData. Absolute terrain
also retains a declared vertical EPSG; relative heights and dimensionless
products do not acquire an absolute vertical datum. A ZIP includes every raster
plus a versioned manifest containing source names/sizes/counts, CRS, grid
settings, counts, per-product statistics and method/filter definitions.

The GeoTIFF writer deliberately preserves floating-point samples. The installed
geotiff.js 2.x reader is used for verification; its byte-only writer would lose
fractional heights and NaN, so these exports use a small single-strip TIFF
encoder. Independent GDAL/rasterio readback is part of the real-data check.

Mean-height GeoJSON exports individual source-cell footprints transformed to
WGS84. They are not dissolved height classes or full-footprint canopy means.
The map image uses projected corner coordinates for a context preview; exported
GeoTIFFs retain the analytical grid. Download `terrain.tif` and import it as a
GeoTIFF in Road design to use the same ground surface there. The screening
method and ground-support limitations still apply to that terrain.

For another forestry tool:

- Import `runRestorationWorker`, `DEFAULT_OPTIONS`, result types and product
  definitions from `src/features/lidar-restoration`.
- Pass local `File[]`, explicit grid settings, an optional `AbortSignal` and
  progress callback. Own cancellation and UI state in the consuming workspace.
- Read `result.rasters` directly, or call the GIS export functions in `outputs.ts`.
- For non-browser validation, call `runRestoration` with `Blob` inputs carrying
  names and an injected laz-perf factory. Pure grids and accumulators have no
  DOM or network dependency.

The shared LAS/LAZ header reader lives in `src/lib/lidar/lasHeader.ts`; existing
road imports re-export it for compatibility. The new reader preserves first
return and withheld flags, and sequentially visits all records. LAZ retains its
compressed input in WASM and a single decoded record, not an 84-million-point
JavaScript cloud. It still needs substantial desktop memory; this is not
HTTP-range LAZ streaming.

## Limits and budgets

| Limit                                                          | Enforcing code                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 768 MiB total input, 150 million total source returns          | `MAX_INPUT_BYTES`, `MAX_SOURCE_POINTS` in `model.ts`, checked by `run.ts` |
| 4,194,304 cells per grid; 0.5–100 m cell sizes                 | `MAX_GRID_CELLS`, `makeGrid` in `model.ts`                                |
| No silent resolution change                                    | `makeGrid` throws when over budget                                        |
| Metre UTM / BC Albers with explicit supported EPSG             | `isMetricCrs` in `run.ts`                                                 |
| Identical horizontal/vertical CRS across files                 | `runRestoration` header preflight                                         |
| No overlapping tile bounds                                     | `runRestoration` preflight; clip overlaps in GIS to avoid double-counting |
| Mean-height polygons: at most 50,000 finite cells              | `meanHeightPolygons` in `outputs.ts`                                      |
| LAS metadata prefix ≤16 MiB; extended CRS metadata read ≤1 MiB | `runRestoration` preflight                                                |

Adjacent files accumulate on one source-aligned grid before statistics are
calculated, so averaging already-computed tile means is avoided. This does not
reproduce PEMlidr's buffered LAStools retile/interpolation workflow. Unknown or
mixed CRSs, overlapping tiles, missing ground, truncated records and oversized
jobs fail with actionable errors. Browser memory exhaustion can require cropping
the source even when the configured budgets pass.

## Verification

Unit tests cover analytic slope, threshold equality, denominator populations,
first-return/withheld/class handling, unsupported terrain, adjacent mosaics,
invalid inputs, float/NaN/CRS GeoTIFF round trips, GeoJSON and archive contents.
PEM moments have separate hand-calculated tests. Browser tests exercise an actual
synthetic LAZ through WASM, LAS recovery after errors, map source readiness,
download readback, input invalidation and phone controls.

```sh
npx vitest run src/features/lidar-restoration \
  src/pages/dev-forestry-roads/pointCloud.test.ts \
  src/pages/dev-forestry-roads/lasSurface.test.ts \
  src/pages/dev-forestry-roads/terrain.test.ts \
  src/pages/dev-lidar/workspaceTools.test.ts --maxWorkers=2
npx tsc -b
npx vite build
PGMAPS_RESTORATION_LAZ=/path/to/source.laz npx playwright test \
  tests/e2e/lidar-restoration.spec.ts --workers=1
python scripts/lidar/validate_browser_restoration.py \
  --source /path/to/source.laz --products /path/to/extracted-zip
```

The opt-in real-data browser test uses the supplied BC tile:
`bc_093g086_4_4_4_xyes_8_utm10_20240713_20240713.laz`, 550,572,701
bytes, 84,608,005 returns, SHA-256
`f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`.
The independent Python validator chunk-reads a single source, rebuilds the
documented SCRIP ground model and metrics, and compares raster geometry,
CRS, float32/NoData values and manifest counters. This validates the documented
browser approximation; it is not an R/TIN or LAStools equivalence benchmark.

The [recorded full-tile validation](lidar-restoration-validation.json) passed
all 17 products, six counters and every NoData mask. Sixteen products matched
exactly; the largest difference in the additional coefficient of variation was
1.46 × 10⁻¹¹. Chromium processed and exported the complete source in 258 seconds
in the review environment; performance depends on the device. Sixty focused
unit/regression tests and the desktop/mobile browser workflows also passed.
