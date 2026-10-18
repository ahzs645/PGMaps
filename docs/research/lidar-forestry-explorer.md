# Forestry structure explorer

The Analyze panel adds **Vertical layers**, **Canopy texture**, and **Edges &
interior**, with selected-plot inspection, pinned A/B profiles, a high/low
comparison shortcut and a spatially spread field-check shortlist. Deep links
use `?view=strata`, `?view=texture` and `?view=edges`. A compact workflow selector
keeps these additions within the existing internally scrolling sidebar.

## Why these analyses

The [lidR metrics documentation](https://r-lidar.github.io/lidRbook/metrics.html)
describes point, plot and grid summaries as foundations for forestry analysis.
[INRAE's forest structure workflow](https://lidar.pages-forge.inrae.fr/lidaRtRee/articles/forest.structure.metrics.html)
combines vertical distributions, CHM heterogeneity, tree metrics and gaps/edges.
These support complementary views of this tile without a trained inventory
model. The [area-based approach](https://r-lidar.github.io/lidRbook/modelling.html)
requires field reference for inventory predictions. Our implementation uses
NumPy/SciPy/laspy, inspired by those metric families; it does not claim to have
executed lidR/lidaRtRee or reproduced their specific algorithms or indices.

The existing height surface shows only the highest return per cell. The new
profiles use original returns throughout the vertical column. Airborne occlusion,
multiple returns and acquisition settings still influence what was observed.
Neither the six-band profile nor its entropy measures vegetation volume,
seedling stocking, leaf area, biomass or fuel load.

## Actual run

- Source: the same SHA-256 verified 84,608,005-point LAZ.
- Accepted normalized returns: **82,613,315**; **39,899,959** are first returns.
- Excluded returns: **1,994,690**, including excluded source classes, withheld,
  unsupported/outside-grid coordinates, roof-buffer cells and implausible heights.
- Eligible source cells: **2,246,943 m²**; taller-canopy proxy: **1,599,142 m²**.
- Output: **924** tile-origin 50 m plots, including partial plots.
- Default filters: at least 95% eligible plot area and 40% taller-canopy proxy,
  leaving **640** plots in all three modes for this run.
- Input grid CRS: EPSG:3157; original orthometric heights retained.
- Snapshot: `src/pages/dev-lidar/forestry.generated.json`, about 0.9 MB of text,
  loaded with the other analysis products on first opening Analyze.

The source contains no building or vegetation class. Excluding known roof-like
patches plus 2 m reduces contamination; unrecognized structures can remain.
No authoritative forest mask is inferred.

## Methods and denominators

| View                  | Calculation                                                                                                                                                                                                                                                                                                                                                                                          | Use and limits                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vertical layers       | Subtract the supported 1 m DTM at each point's cell. Exclude source classes 7/12/18, withheld points, roof patches plus 2 m, missing/outside grid and heights outside [-1,80] m. Negative residuals join near-ground bin 0. Count fixed integer-metre bins 0..80; display 0–2, 2–5, 5–10, 10–20, 20–30 and 30–80 m (final band includes 80). All returns and first returns are separately tabulated. | Profile bars divide each band by selected accepted returns, including ground. The lower-layer metric divides 2–5 m returns by returns ≥2 m. The ≥2 m boundary follows bin membership exactly. Ground and low objects mix in 0–2 m. These are sampling views of one acquisition.                                  |
| Return-height entropy | Shannon entropy across the **79 fixed 1 m bins 2..80**, divided by ln(79); null with no returns ≥2 m. Map colours run 0–1 and plots rank high to low.                                                                                                                                                                                                                                                | A measure of return-height dispersion, not a biological layer count, health, maturity, biodiversity or a species prediction. This fixed-bin definition is not asserted identical to lidR's predefined entropy.                                                                                                   |
| Canopy texture        | Population SD of the normalized height surface in each 5×5 m window, followed by a plot mean. Require **all 25 eligible cells** in each window. Plot P95/SD use all eligible source cells. Missing texture remains null.                                                                                                                                                                             | Can include crown edges and opening transitions. Scale is fixed at 5 m. Colour range 0–8 m clips only rendering, not stored values. Texture is not a universal forest-quality score.                                                                                                                             |
| Edges & interior      | Taller-canopy proxy is eligible surface height >5 m; low openings are ≤2 m. At 10/20/30 m, edge cells lie within that horizontal Euclidean cell-centre distance of known openings. Interior cells are farther than that distance from **both openings and unknown cells**. Remaining taller-canopy cells are censored. Pad tile perimeter as unknown.                                                | Counts partition taller-canopy cells exactly; percentages divide by taller-canopy cells, not the whole plot. Opening types may include fields/roads. The map shows plot aggregates, not precise forest boundaries or ecological edge effects. Unknown/roof/tile boundaries cannot create a false interior claim. |

Eligible coverage is eligible cells / 2,500 m², including partial border squares.
Canopy proxy is height >5 m eligible cells / eligible cells. Ground-support P95
is a distance to classified ground, not measured elevation error. At source-grid
resolution, positions use cell-centre distances; sub-metre edge precision is not
claimed. Sparse or missing returns remain visible through counts and coverage.

## Comparisons worth exploring

These examples satisfy the default filters. Values describe the input geometry
and return distribution; they have not been checked against a field inventory.

| Plot             | Return entropy (all) | Surface P95 | Mean local SD | 2–5 m share of returns ≥2 m | 20 m interior proxy |
| ---------------- | -------------------: | ----------: | ------------: | --------------------------: | ------------------: |
| `forest-50-6-25` |              0.80052 |     38.25 m |       4.516 m |                      7.185% |              1.787% |
| `forest-50-25-7` |              0.50135 |     11.12 m |       1.734 m |                     37.353% |                  0% |
| `forest-50-23-2` |              0.73152 |     28.29 m |       6.657 m |                     20.687% |                  0% |
| `forest-50-12-1` |              0.62585 |     21.87 m |       1.187 m |                      3.814% |             67.522% |

The first two contrast broad tall-return distributions with lower vegetation.
The third illustrates a highly varied canopy surface. The fourth illustrates
relatively uniform, interior-like canopy at this scale. None establishes stand
age, species composition, stocking, habitat quality or management treatment.

## Field-check shortlist

For the current filters and map metric, select up to eight descending-value
plots, keeping centres at least **100 m apart in EPSG:3157**. The first retained
candidate is the highest current metric, then the next eligible separated plot.
Metric centres account for partial border squares. Shortlist selection is
exploratory, biased toward extremes, and is **not** a probability inventory
sample, health priority or an access route. The map keeps all matching plots
visible; the shortlist checkbox changes the result list and exports.

The CSV contains plot ID, WGS84 location, metric/value, eligible area, canopy
proxy, terrain support, return selection, edge distance, filter thresholds and
source hash. GeoJSON exports also include method, full metrics, parameters and
limitations. A/B comparisons use the same current return selection and edge
setting; comparison B remains pinned if filters exclude it.

## Maintenance and validation

```sh
python scripts/lidar/forestry.py \
  --source /path/to/original.laz \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --output src/pages/dev-lidar/forestry.generated.json
python scripts/lidar/validate_forestry.py \
  --analysis public/data/lidar-analysis/bc-093g086
python -m unittest discover -s scripts/lidar -p 'test_*.py'
npx vitest run src/pages/dev-lidar
npm run build --ignore-scripts
npm run lidar:preview:build
```

Use the existing pinned scientific requirements. No new browser dependency or
processing service is required. The snapshot records all four raster/candidate
input hashes and the original LAZ hash. Browser loading checks every dataset's
hash independently against deployed checksums, including overlapping input names.
CI validates it on cache hits and checks total return/area accounting, first-return
subsets, percentage denominators and nested edge/interior partitions.

Synthetic tests cover entropy, exact band boundaries, missing texture windows,
known local SD, missing/tile-edge censoring and no-opening behavior. Interface
checks cover all seven workflow views, actual data filtering/ordering, comparison
arithmetic, spaced shortlists, map colours/visibility, SSR controls and exports.
Browser/WebGL visual acceptance is still unavailable in this environment; no
independent forest inventory or ecological validation has been performed.

## Valuable next inputs

Reviewed forest boundaries would distinguish true forest gaps from roads/fields.
Field plots could calibrate stocking, species or volume models. A second dated,
co-registered point cloud could support height/gap change; acquisition differences
would require explicit controls. Those inputs add evidence that cannot be
recovered reliably from this single unclassified tile alone.
