# AVAST volume utility

`/dev/forestry/avast-volume` runs the planning team's **AVAST Volume
Calculation** procedure (Parts 1–3) in the browser: drop in candidate blocks
and the AVAST File Geodatabase, run, and download a planning workbook and a
File Geodatabase. Nothing is uploaded; GDAL reads the files in place.

## What each part of the procedure maps to

| Procedure step | Code |
| --- | --- |
| Part 1 §3–6: Pairwise Intersect, `Piece_HA`, `CMM_m3ha × Piece_HA`, sum by candidate | `overlay.ts` (`overlayCandidate`, `intersectLayers`) |
| Part 1 §7: coverage %, area-weighted m³/ha | `report.ts` (`summarize`) |
| Part 2 §4–10: common AVAST ∩ LiDAR footprint, aggregate LiDAR ÷ AVAST factor | `overlay.ts` (common pieces), `report.ts` (`calibrate`) |
| Part 2 §12–14: factor on AVAST-only blocks, LiDAR used directly, `Volume_Source` | `report.ts` |
| Part 3 §4–11: percent slope, reclassify, raster → polygon, intersect, sum by class | `slope.ts` (`slopeGrid`, `slopeClassPolygons`), `overlay.ts` (`splitBySlope`) |
| Part 3 §12–18: factor per class, reconciliation | `report.ts` |

Rules that must survive any change (the procedure's "common errors"):

- Volume is always Σ(piece area × piece density). Never `SUM(CMM_m3ha)`, never
  gross area × one density, never a simple mean of densities. The weighted
  m³/ha is total volume ÷ covered area.
- Raw AVAST values are kept, including very high densities. Missing densities
  count as 0 m³/ha and are reported as a warning, not dropped silently.
- The LiDAR factor multiplies volume only — never area — and is never applied
  to a block reported from direct LiDAR. A derived factor is total LiDAR ÷
  total AVAST over the common footprint, not a mean of per-block ratios.
- Slope classes use percent rise with the SOP's boundary convention:
  `s < break1`, `break1 ≤ s ≤ break2`, `s > break2` (`classifySlope`).
- Per-class volumes plus any no-DEM-data volume must reconcile to the block
  total; `summarize` warns when they do not.

## Inputs

- **Candidate blocks**: shapefile parts, zipped shapefile, GeoPackage,
  GeoJSON, KML or a `.gdb` folder (folder picker or drop). Several layers are
  assessed together. Field guesses (`inputs.ts`) cover the Dunkley shapefiles:
  `BLOCK_ID`, `OPERATING_`, `MERCH_AREA`. Merch area ≤ 0 or blank falls back to
  the polygon's BC Albers area.
- **AVAST**: the `TimberAnalysis_Base` layer, density `CMM_m3ha`, slope
  `Avg_Slope`, `OPERATING_AREA`. A `.gdb` folder or a zip holding one. Several
  AVAST geodatabases may be added (PG and TSN); where they overlap inside a
  block, the earlier one keeps the ground (`intersectLayers`) and the overlap is
  noted.
- **LiDAR (optional)**: a polygon layer with a m³/ha field. Raster LiDAR volume
  is not supported yet.

Only the AVAST features near the candidates are read: candidate boxes are
clustered (`clusterBoxes`, 250 m margin) and each cluster is one
`ogr2ogr -spat … -spat_srs EPSG:3005` read through the layer's spatial index.

All geometry is BC Albers (EPSG:3005); GDAL reprojects on read. Piece areas are
planar Albers hectares, which is what ArcGIS's Calculate Geometry Attributes
reports for a BC Albers feature class. `overlay.ts` was checked against GDAL's
own `-clipsrc` on the Dunkley blocks to the hundredth of a hectare.

## Slope

- **DEM** (default): AWS Terrarium tiles (the forestry DEM loader and its
  caches) sampled onto a BC Albers grid snapped to multiples of the cell size,
  Horn's 3×3 percent slope, classes merged into rectangles and dissolved per
  class, then intersected with each piece. Terrarium tiles are a regional
  surface, not LiDAR bare earth; the classes are a planning screen.
- **AVAST Avg_Slope**: each AVAST polygon's average slope classifies its whole
  piece. Fast and coarse.

## Outputs

- **Workbook** (`excel.ts`). The first three sheets copy
  `Dunkley_Volume_Summary_All_Blocks.xlsx` — sheet names and order, title rows,
  header row 5, data from row 6, Carlito, the colours, the `G` and `K`
  formulas, the `COUNTIFS`/`SUMIFS` Management Summary over rows with
  `K = "OK"`, the Operating Area list validation and the DUPLICATE highlight —
  so rows move between the two workbooks unchanged. After them: AVAST Volume
  Summary (Part 1 §8 / Part 2 §19 fields), Slope Volume Summary (Part 3 §15),
  LiDAR Calibration (Part 2 §15/19) and the intersect pieces.
- **Paste rows** (`workbookRows.ts`): columns A–K as tab-separated text for the
  sheet row the user names, with `G`/`K` formulas rewritten for those rows.
  Coverage notes use the Dunkley workbook's sentences verbatim
  (`COVERAGE_NOTES`); default thresholds (90 / 70 / 5 %) reproduce its classes.
- **File Geodatabase** (`outputs.ts`, `gdal.ts`): `[Project]_Candidates`,
  `_AVAST_Volume_Intersect`, `_AVAST_Slope_Intersect`, `_Slope_Class_Polygon`,
  `_LiDAR_*` and the summary tables, zipped as `[Project]_AVAST_Volume.gdb`.

## GDAL in the browser

- gdal3.js runs GDAL in its own worker and mounts inputs with WORKERFS, which
  reads `File`s lazily. A mount replaces the previous one and closes its
  datasets, so every input is mounted together (`ensureMounted`) and every GDAL
  call goes through one queue (`exclusive`). Do not call gdal3.js directly.
- GeoJSON carries no schema. `layerGeoJson` drops columns no feature fills and
  writes doubles with a decimal point; otherwise GDAL types whole-number
  columns as Integer and nullable ones as String. Do not route the export
  through `-dialect SQLite` CASTs: computed columns take their type from the
  first row, so a null there still produces String.
- Output geometry is pinned to `SHAPE` (`-lco GEOMETRY_NAME=SHAPE`).
- The 28 MB `.wasm` and 11.6 MB `.data` are lazy `?url` assets fetched only on
  this page.

## Keep these modules free of DOM and network access

`geometry.ts`, `slope.ts`, `overlay.ts`, `report.ts`, `run.ts`, `inputs.ts`,
`workbookRows.ts`, `outputs.ts` and `projection.ts` carry the unit tests
(`avast.test.ts`). `run.ts` takes its DEM through an injected factory so a test
can supply a synthetic surface; the worker supplies terrain tiles.

## Tests

- `npx vitest run src/pages/dev-avast` — the SOP's worked examples (8.42 ha ×
  145 m³/ha, the 1 ha @ 300 + 100 ha @ 150 weighted mean, the 0.8133 aggregate
  factor), slope boundaries, reconciliation, workbook layout and GDB typing.
- `tests/e2e/forestry-avast-volume.spec.ts` — synthetic blocks and AVAST
  through the real page and GDAL-WASM, with stubbed basemap and flat terrain,
  checking both downloads.
