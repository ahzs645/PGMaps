# Real DEM road workflow check

`tests/e2e/forestry-road-live-dem.spec.ts` exercises the browser with an independently
downloaded GeoTIFF, rather than the synthetic training terrain or a mocked sampler.
It imports the raster through the file picker, pegs a three-point road with pointer
events, downloads the project, adopts a horizontal corridor candidate, optimizes its
vertical profile, then checks both device autosave restoration and the actual downloaded
project in a fresh browser context with external network requests blocked.
If the first horizontal search fails, it verifies the saved project is unchanged and
retries with Shortest preference and a 25 m corridor, recording both outcomes. Grade
and radius limits remain unchanged.

The test checks exact embedded raster cells and saved alternatives, finite ground and
design levels, complete sampled section coverage, the entered maximum grade, and the
visible profile/section charts after reopening. It saves before/after project JSON,
a workspace screenshot, and source/quantity metrics for each location.

## Data and scope

- Public DEM: <https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1303/2633.tif>.
- Source project and attribution: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
- Recorded SHA-256: `c80c77535e393aaf61142423903f25c7027e8133e05a3277ca0eaf3203296204`.
- 512 × 512 cells, EPSG:3857, PixelIsPoint. Projected spacing is approximately
  9.55 m, equivalent to 5.63 m ground sample spacing at the tile centre.
- Three fixed locations at tile fractions (0.25, 0.30), (0.50, 0.55), (0.70, 0.75).
  At each, the initial guide uses offsets (−100, 0), (0, 35), (100, 0) metres.
- This is a regional elevation product. Its sample spacing does not establish the
  underlying source resolution or survey accuracy. The entered EGM96 metre reference
  describes the terrain-tile product; it does not verify a local survey datum.
- The basemap is isolated with a valid empty style. The optional default LiDAR request
  is blocked to exercise recovery through a different imported DEM. Terrain rendering,
  contour generation, geometry, sections, quantities, optimization and file operations
  all use the real imported raster.

These are three locations in **one tile**, without real exclusion or stream inputs.
A passing check establishes this software workflow, not engineering suitability or
regional validation. Inspect candidate geometry and all engineering inputs before use.

## Observed live results, 2026-10-24

All three saved profiles reopened with their embedded DEM and exact alternatives,
with complete sampled section coverage and no model warnings:

| Location | Final length | Maximum design grade | Profile controls |
| -------- | ------------ | -------------------- | ---------------- |
| 1        | 411.02 m     | 7.77%                | 9                |
| 2        | 200.43 m     | 3.04%                | 5                |
| 3        | 222.36 m     | 2.68%                | 5                |

Location 3's initial Balanced / 100 m half-width search reached the geometry budget.
The failed search preserved the saved project exactly. Retrying with Shortest / 25 m
half-width succeeded with the same 12% ground-grade limit and 25 m minimum radius.
The unsuccessful attempt is part of the evidence, not a claim that every search succeeds.

The separate published 1 m LiDAR smoke check also passed source/hash and sampler
restoration checks. Its unoptimized draft road reported 96.32% supported earthworks
coverage and 24 stations over the grade limit, correctly retaining those warnings.

Verification for this change: 280 road unit tests passed (the separate opt-in native
corridor trial was skipped), along with 37 browser cases: 31 workspace/engineering
regressions, three existing corridor workflows, and three imported real-DEM workflows.
A combined project containing all nine real-road alternatives was also reopened and
re-saved exactly in a fresh browser with external terrain requests blocked.

## Reproduce

Install the repository's dependencies/submodules and build its shared toolkit first.
Download the small fixture outside the repository (do not commit a copied DEM):

```sh
curl --fail --location \
  https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1303/2633.tif \
  --output /tmp/pg-regional-dem.tif
sha256sum /tmp/pg-regional-dem.tif
PGMAPS_ROAD_DEM_PATH=/tmp/pg-regional-dem.tif \
  npx playwright test tests/e2e/forestry-road-live-dem.spec.ts \
  --project=chromium --workers=1
```

The normal Playwright configuration starts Vite. For an already-running server, set
`PGMAPS_E2E_BASE_URL`; for a supplied Chromium executable, set
`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH`. Without `PGMAPS_ROAD_DEM_PATH`, these live-data
tests are skipped so ordinary tests do not require an external data download.

## Fixes found during this check

- Nonzero GeoTIFF raster tiepoints shifted ground coordinates; registration now accounts
  for the tiepoint's raster indices.
- Decimal Float32 no-data declarations could become finite deep pits; comparisons now
  use the pixel type's precision.
- A transient device-storage read failure could enable a default-project write over
  existing work; startup now protects the saved project and offers recovery guidance.
- The vertical optimizer could return a fitted profile that violated an entered control;
  it now rejects candidates failing the final standards/control checks.
- Excessive profile searches could freeze the page; finite input validation and explicit
  transition/PVI budgets now stop oversized requests with an actionable error.
- Opposing spiral runoff could flip crossfall abruptly between close reverse curves;
  each transition now reaches normal crown at the intervening tangent midpoint.
- A corridor geometry-budget error blamed exclusion layers even with none loaded;
  it now gives applicable guide/corridor recovery guidance.

The focused regressions reproduce the original failures. The live browser suite then
checks that import, optimization and persistence still operate together.

Remaining limits include unsupported matrix-form GeoTIFF georeferencing and the vertical
search running on the main thread within its work budget. The optimizer may reject a
constrained request even when another feasible design exists; it is a bounded search.
See the [terrain guide](forestry-road-design/terrain-and-point-clouds.md) and
[alignment guide](forestry-road-design/alignment-and-optimization.md).
