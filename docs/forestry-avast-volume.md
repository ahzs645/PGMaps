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

## What-if: VRI fallback (not exported)

After a run, optional step 4 fills the ground AVAST leaves empty with VRI
rank-1 fetched live from DataBC (`vriFill.ts`, `useVriFill.ts`). It stays out
of the totals, paste rows and geodatabase unless "Add VRI volume to the
export" is on. Then Direct Est. Vol (F) — and so G, the Management Summary and
Copy rows — becomes AVAST plus the audit-adjusted VRI fill
(`withVriVolume` in `workbookRows.ts`); AVAST-only Ref. (J) keeps AVAST alone,
E is restated as F ÷ merch area, H and I say VRI was added, and Method & QA
records the rules. The geodatabase stays AVAST-only.
- Workbook zeros display blank (`hideZeros` in `excel.ts`): the cell still
  holds 0 so formulas work; only the number format's zero section is empty.

- In the June 2026 PG geodatabase, every `CMM_m3ha > 0` equals VRI
  `LIVE_STAND_VOLUME_175`, or live + `DEAD_STAND_VOLUME_175` where VRI records
  dead volume, on stands aged 60 or more. AVAST also zeroes about 40% of
  mature, unharvested treed area for reasons its attributes do not show, so
  0 m³/ha AVAST pieces can be refilled too.
- The defaults follow the Prince George TSA rather than AVAST: pine-leading
  stands at 12.5 cm and dead volume on the shelf-life curve, age ≥ 60, treed
  only. Choose 17.5 cm and "All dead" to reproduce AVAST's own rule.
- DataBC's WFS answers browser requests from the live site
  (`pgmaps.ahmadjalil.com`) without a proxy; checked from a real browser on
  that origin.
- The query box is BC Albers in `CQL_FILTER`, with `srsName=EPSG:3005` (the
  layer's native CRS), paged by `FEATURE_ID`. Blocks within 30 m share a request.
- The fill is a map overlay (the "VRI fill" chip beside the view switcher)
  over the m³/ha and slope views, not a view of its own. The block hover card
  is the only tooltip on the map — layers stacked under the pointer would each
  open one — so it carries the VRI figures while the overlay is on.
- The geometry (which VRI polygon covers which uncovered or zero piece) is
  computed once in the worker; utilization, dead volume, age, treed-only and
  the factor re-total instantly. Direct-LiDAR blocks are never filled.
- Rules from the Prince George TSA (see the research summary the planning
  team keeps beside the sample outputs):
  - **Utilization "Pine 12.5"** — pine-leading stands at 12.5 cm, others at
    17.5 cm, the TSA's merchantability rule. AVAST uses 17.5 cm throughout.
  - **Dead volume "Shelf life"** — VRI dead volume is "at year of death", so it
    is discounted by years since `EARLIEST_NONLOGGING_DIST_DATE` (mostly `IBM`,
    mountain pine beetle) on the TSR curve: 100% in year 1, 80% in year 2,
    linear to 40% at year 15, held at 40% after (`shelfLife`). Stands with no
    disturbance year use the "years dead if unrecorded" setting.
  - **Flag below** 182 m³/ha (TSR minimum harvestable volume) or 140 m³/ha
    (beetle salvage), on volume with VRI fill ÷ merch area. Clicking the
    "Below … m³/ha" tile outlines those blocks yellow, dims the rest and zooms
    to them.
  - **Audit-adjusted** — VRI fill × the 2018 PG TSA VRI audit's ground ÷
    inventory ratio by leading species (pine 0.836, spruce 0.946, balsam
    1.246, other 1.159; `auditRatio`), shown beside the unadjusted figure.
- VRI is a VDYP projection of photo-interpreted attributes, designed for
  management-unit totals. The Prince George TSA VRI audit found it unbiased in
  total but biased by leading species (pine low, balsam high), so a single
  block's VRI volume can be well off.

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
