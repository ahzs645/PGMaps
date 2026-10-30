# Drainage catchment and portability checks — 30 October 2026

The G08/G09 implementation was checked with analytical unit cases, all nine built-in scenario
sources and touch browser workflows. This record describes checks actually executed; it does
not certify site hydrology or remove the analysis extent/no-data limitations.

## Numerical and persistence checks

The six focused files `drainageCatchments.test.ts`, `drainageEvidence.test.ts`,
`drainageRun.test.ts`, `hydrology.test.ts`, `designSurface.test.ts` and `planLegend.test.ts`
passed **33 tests**. They cover known contributing-cell sets, exact polygon area, holes,
diagonally touching components, disjoint watershed partitions, snap radius and no-data handling,
cycle/budget rejection, source-resolution limits, existing drainage/road-prism regressions,
portable settings/evidence, dependency changes, regional-source recomputation, report escaping
and retained per-culvert peak/capacity results. Targeted ESLint completed without warnings.

`node --use-env-proxy --import tsx scripts/forestry/check-road-drainage-scenarios.ts` completed
at **2026-10-30 18:36 UTC** with **0 failures: nine scenarios / 17 roads**. It loads the same
published native LiDAR and regional sources as the scenario picker; only PNG decoding is
substituted for browser canvas. Training scenes retain their explicit synthetic terrain.
Each road ran existing/design drainage, a snapped existing-ground catchment and watershed
partitioning with an 80 m sample buffer and 0.4 ha minimum basin area.

| Scenario | Roads checked | Cells per road | Selected catchments touching edge/no-data |
| --- | --- | --- | --- |
| Prince George native LiDAR | 1 | 336,654 | 0 |
| Tabor access | 2 | 1,040 | 0 |
| Kamloops dry Interior | 2 | 464–493 | 2 |
| Vernon upland | 2 | 464 | 2 |
| Smithers Northwest | 2 | 1,665 | 1 |
| Training connected full-cost access | 2 | 43,587–94,416 | 1 |
| Training hillside | 2 | 1,145,766–1,180,182 | 2 |
| Training old-road reuse | 2 | 1,145,766–1,180,182 | 2 |
| Training local gravel | 2 | 1,145,766 | 2 |

All selected areas matched their contributing cell counts. Qualified watershed areas did not
exceed the supported raster area. Compact records round-tripped through JSON validation,
retained fingerprints, rejected changed-rainfall exports and required a fresh live run for
unchecksummed regional sources after restoration. Roads with incomplete engineering sections
were recorded with their actual coverage; neither section closure nor watershed completeness
was fabricated to make the checks pass. Coarse regional source warnings remain applicable.

The source-boundary contacts above are expected limitations of those entered sample extents.
A successful computation means the evidence is internally consistent, not that a truncated
catchment is complete. Increase the buffer/terrain coverage and compare before relying on area.

## Touch browser checks

`forestry-road-catchments-mobile.spec.ts` passed **three touch-enabled Chromium workflows**
at **390 × 844**, **320 × 568** and **844 × 320**. Each journey:

1. Opened the synthetic training workspace through its public route and selected Drainage.
2. Chose a point by tapping the actual plan canvas, selected watershed output and ran drainage.
3. Verified both the actual GeoJSON polygon source and a rendered MapLibre catchment fill.
4. Exported the real evidence download, inspected its settings/geometry, and saved project JSON.
5. Started a fresh page, imported the downloaded project through the file chooser and verified
   restored inputs, compact summary and polygon geometry without retaining the in-memory grids.
6. Changed rainfall, verified stale evidence/export disabling and removal from the plan, then
   reran and restored current exportability.
7. Checked document/panel containment, reachable form controls and absence of uncaught errors.

The short landscape view uses its internal detail scroll area; the document itself does not
scroll. The pour-point button wraps within narrow form columns. Screenshots of the live map and
panel were generated and inspected at portrait and short-landscape sizes. The browser basemap
was stubbed to an empty valid MapLibre style; terrain, road geometry and drainage calculations
were the real synthetic training model, not mocked result text.

Run the browser check against a local development server with:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 npx playwright test \
  tests/e2e/forestry-road-catchments-mobile.spec.ts --project=chromium --workers=1
```

The actual-source command emits a JSON review summary on stdout and bounded load progress on
stderr. The audit run's full output and downloaded evidence/screenshots were retained outside
the source tree; no third-party source package or installer was committed.
