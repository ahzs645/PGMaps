# Whitebox Next Gen: what was taken, what was left, and what is still to do (18 November 2026)

Whitebox Next Gen (John Lindsay, Whitebox Geospatial Inc., MIT OR Apache-2.0) is the source of the
`whitebox-wasm` package PGMaps already ships: its `whitebox-wasm/tools` runs the 733 WhiteboxTools
tools over WASI in a worker or in Node. On 18 November 2026 four of its ideas were tried against
PGMaps. This note records the outcome of each and the work left open, so the next person starts
from the measurements rather than from the idea.

## What was done

| Idea                                            | Outcome                                                                                                                                                                                                                                                                                   | Where                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Burn ratio, moisture index, area time series    | Built. NBR/dNBR and NDMI beside NDVI; an area series over the listed scenes with a "first seen between" bracket from the medians either side of a fall; a histogram of the selected scene.                                                                                                | `src/pages/dev-forestry-roads/sentinel/`, guide `forestry-road-design/sentinel-imagery.md`               |
| Spatial autocorrelation in the Labs             | Built. Global Moran's I, local Moran's I clusters, Gi*, the Moran scatter, residual clustering in the Correlation Lab, a *Clusters\* map. Pinned to PySAL esda.                                                                                                                           | `src/maps/scorebuilder/lib/spatialWeights.ts`, `spatialAutocorrelation.ts`                               |
| Least-cost breaching for road drainage          | Not adopted. It found fewer mapped crossings than fill-all (10 of 17 against 12 of 17) and moved streams far from roads.                                                                                                                                                                  | [drainage-breaching-2026-11-18.md](drainage-breaching-2026-11-18.md), `scripts/forestry/drainage-bench/` |
| Whitebox terrain classes as landform candidates | Not adopted. Geomorphon breaks added +0.03 mean IoU against 18 consultant landforms (smaller than the sheets' registration error), left the perspective percentage unchanged, and lost the gain under cross-validation. The study and the third-party sheets stay outside the repository. | —                                                                                                        |

A shared histogram part came with the Sentinel work (`ValueHistogram`, `src/components/ui/value-histogram.tsx`,
binned by `src/lib/histogram.ts`), so a page that needs a distribution no longer draws its own bars.

## Still to do

### 1. Charts

Whitebox's report tools (`rendering/` in `wbtools_oss`) draw these as standalone HTML. The idea worth
keeping is the chart, drawn natively from figures PGMaps already computes; none of them needs Whitebox
itself. The toolkit has scatter, XY, line-band and time-series charts (`packages/geo-toolkit/src/visualizations/charts/`)
and the app now has a histogram; the rose and the agreement table need new shared parts. Every chart
here is display only: it reads a figure and never feeds one.

**Horizon rose (visual quality, at a viewpoint).** The horizon's apparent elevation angle all the way
round the eye, with the block's bearings and the landform's span marked, so a reviewer sees at once
where a block breaks the skyline and where hills stand behind it.

- Data: `skylineReach.ts` already finds the skyline point bearing by bearing, with curvature and
  standard refraction (`curvatureDrop`, `STANDARD_REFRACTION`). Return the angle beside the distance.
- Evidence: Whitebox's `skyline_analysis` agreed with an independent skyline tracer to a median of
  0.006–0.073° (p90 ≤ 0.23°) on four registered sheets, so PGMaps' own tracer is enough and Whitebox
  adds nothing but a cross-check.
- If Whitebox is used as that cross-check: run it on a DEM without a CRS tag (with one, its GeoJSON
  vertices come back as garbage) and read its values per azimuth, never its geometry, which places
  each vertex with the azimuth as a mathematical angle (from east, counter-clockwise) and so comes
  out mirrored and turned. `horizon_angle` has no observer height or curvature and took 38–155 s per
  azimuth: never use it for a rose.
- Needs: a shared radial chart part in `src/components/ui/` (none exists).

**Cumulative difference curve (terrain and accuracy checks).** "90 % of points within ±0.4 m" read off
one curve of |difference|, instead of a mean and a spread.

- Where: Review's terrain row and the terrain comparisons it rests on (`scripts/forestry/compare-road-terrains.ts`,
  the contour-against-DEM checks), the canopy-source benches (ICESat-2 ground against LiDAR), and
  photo-matching residuals (`pairResiduals.ts`).
- Data: a DOM-free empirical CDF helper beside `src/lib/histogram.ts`; draw with the toolkit's `XYPlot`.
- Keep the sign apart from the size: a constant offset (the contour surface's ~1.5 m, for example) is
  a datum question, and a curve of |difference| hides its direction. Print the median signed
  difference beside the curve.

**Class agreement table and kappa (class rasters compared).** Which classes are taken for which, not only
how the area shares differ.

- Where: the slope-sheet check (`slopeSheetCheck.ts`), the PDF class decoder's JPEG estimates against
  exact tiles (`paletteJpeg.ts`), and an engine's ground pass against PGMaps' class pass.
- Rule to keep: a JPEG class pixel is right about half the time and a slope sheet is compared by area
  shares along a strip, never pixel by pixel (`AGENTS.md`, company map PDFs and slope sheets). So the
  table is built per strip or per coarse cell of a stated size, and an estimated column is always
  labelled as one; never a pixel-level confusion matrix over estimates.
- Needs: a shared matrix table part; kappa computed in the same DOM-free module as the table.

**Area-by-elevation curve (catchments and landforms).** The share of an area above each elevation.

- Where: a culvert's catchment in the road designer (how much of it holds snow at a given elevation)
  and a landform on the visual-quality page.
- Data: the catchment's cells from the drainage run (watershed IDs, `gridCellNumber`) or the
  landform polygon over the run's elevation grid; the curve is a sorted cumulative area, drawn with
  `XYPlot`. Missing cells are counted and stated, never read as low ground.

### 2. Road-crossing stream cut (road drainage)

The drainage bench found that lowering the existing ground only where a mapped stream crosses an existing
road found 15 of 17 mapped crossings (fill-all 12, breaching 10) and changed little else (89–100 % of
fill-all's stream cells kept within two cells; 33–333 cells cut per tile). The full reasoning is in
[drainage-breaching-2026-11-18.md](drainage-breaching-2026-11-18.md), **Recommendation**.

What a prototype needs before it reaches `hydrology.ts`:

1. **Existing ground only.** Cut the existing surface, never the design surface: the check finds
   cross-drain sites from the ponds behind the new prism, and cutting it hid every one of them in the
   bench.
2. **Snap to the channel.** FWA lines are 1:20,000 and can lie tens of metres off the LiDAR channel;
   take the lowest point of the road prism within a stated distance of the mapped crossing, and say
   when none is found.
3. **A depth limit.** Whitebox's `burn_streams_at_roads` cut 6.9 m at one crossing; a cut deeper than
   a stated limit is refused and named, never applied.
4. **Tiled grids.** It must work on the corridor grid in the full grid's row-major order (`corridorGrid.ts`,
   `neighbourCells`), with `corridorGrid.test.ts`'s dense-equivalence checks passing.
5. **Off by default**, as a depression-policy option parsed in `drainagePolicies.ts`, with its limits in
   `drainage.md`'s limits table in the same commit as the constants.
6. **Method.** Whitebox's `burn_streams_at_roads` is MIT OR Apache-2.0, so its method may be adapted with
   a notice and a provenance header.
7. **Measure it.** Re-run `scripts/forestry/drainage-bench/road-runs.ts` and keep the mapped-crossing
   count at or above 15 of 17 on the five bench tiles.

A cheaper first step changes no routing: mark fill ponds that touch an existing road in the ponding
layer as "possibly an unmodelled culvert", so a reviewer reads them as the dam they probably are.

### 3. Smaller loose ends found on the way

- **Labs:** spatial-lag and spatial-error regression (an "adjusted slope" beside the Correlation
  Lab's r) were left for later.
- **Landform option:** if wanted anyway, geomorphon ridge/peak/valley/pit cells as extra breaks on
  `visibleFaceLandform` were the one safe variant (never worse on a primary landform). It would have to be
  off by default, adopted by the reviewer's click, and computed by a small JavaScript geomorphon
  (Jasiewicz & Stepinski 2013) rather than the 17.6 MB WASM. A "stop at the first crest" cap must not
  be a default: it fixed overshoot on one document and cut long faces apart on another.
- **Tests failing on main before this work:** `tests/e2e/forestry-road-sentinel2.spec.ts` looks for a
  "Retry catalog" button that `WaybackTimeline.tsx` labels "Retry Wayback catalog"; and since 17
  November `tests/e2e/score-builder-sidebar.spec.ts` does not load in Playwright ("No tests found")
  because it imports `src/lib/dataUrl.ts`, which loads JSON without an import attribute and reads
  `import.meta.env`.

## Whitebox tools: what to know before calling one

Measured with `whitebox-wasm` 0.6.1 in Node on an M-series Mac under heavy load (times are upper bounds).

- **Arguments are not checked.** An unknown flag is silently ignored: `--dist` and `--fill` on
  `breach_depressions_least_cost` gave byte-identical output to passing nothing. Its real flags are
  `--max_dist` (default 100 cells), `--fill_deps` and `--max_cost`. Change a flag and compare outputs
  before trusting it. Some tools take `--dem=` rather than `--input=`.
- **Not usable as a reference:** `getis_ord_gi_star` (its variance is dimensionally wrong and clamps to
  zero, and its permutations reuse one RNG state; on a planted 5 × 5 hot corner it flagged 1 of 25);
  `dissolve` on many overlapping polygons (400 overlapping rectangles along an arc came back as 7
  fragments totalling 476 m², where polygon-clipping returned the correct 317,989 m² ring);
  `ridge_and_valley_vectors` fails in this build.
- **Too slow for interactive use:** `sky_view_factor` (49 s for 250,000 cells at a 200 m search) and
  `horizon_angle` (38–155 s per azimuth).
- **Fast enough on a click, in a worker:** `geomorphons` (1.3 s per 250,000 cells at a 50-cell search),
  `openness` (1.5 s), `feature_preserving_smoothing` (0.55 s), `breach_depressions_least_cost` (0.13 s),
  `d8_flow_accum` (0.11 s), `find_ridges` (0.06 s), `local_morans_i_lisa` (17 ms for 400 points).
- **Agrees with PGMaps:** D8 directions on the same filled surface (99.5–99.9 % of cells; every
  difference an exact tie between two equally steep neighbours), and `skyline_analysis` against an
  independent skyline tracer (see the horizon rose above).
- **Weight:** the tool runner is 17.6 MB of WASM (about 5 MB gzipped). Load it only with `import()` in a
  worker, as `pointCloud.ts` does, never on a route that loads with the page.
