# Drainage checks on real areas, desktop and mobile

The earlier gallery captured the setup screen. This follow-up runs the actual drainage
workflow on both saved real-DEM roads from the [new-area journeys](forestry-road-new-area-check.md),
using desktop Chromium at 1512 × 982 and touch-enabled mobile Chromium at 390 × 844.
Both mobile journeys also check 320 × 568 and 667 × 375. These are browser-emulation
checks, not physical-handset or field hydrology validation.

All four area/device journeys pass, with 20 drainage runs and zero browser errors.
Each browser result matches a separate Node calculation of its actual saved road,
embedded terrain, current culverts and drainage inputs. The tests verify the real
MapLibre flow source, station navigation, stale-result removal, internal scrolling,
and unchanged project geometry/source when only drainage settings are changed.

## Physical-units defect found and fixed

Drainage previously reused the source's export projection. In these EPSG:3857
rasters, 100 ground metres measured about 157 projected map metres. Treating them
as ground metres distorted the requested buffer, sampling pitch and contributing
areas used in flow estimates.

Drainage now uses a local UTM ground-metre grid: EPSG:32610 for Kamloops and
EPSG:32611 for Vernon. Source cells, datum, original coordinates and export CRS
are retained. Regression tests check north/east distances and inverse projection
in both hemispheres. Choosing the proper grid also changes sampling alignment
and the physical extent, so before/after flow counts are not a simple scale ratio.

## Corrected baseline results

Desktop and mobile produce identical results for these inputs: 50 mm/h rainfall,
C 0.35, Manning n 0.024, 1 ha stream threshold and no entered culverts.

| Area     |  Buffer | Existing crossings | Largest crossing catchment | Ditch/outlet candidates | New modeled ponding |
| -------- | ------: | -----------------: | -------------------------: | ----------------------: | ------------------: |
| Kamloops |   250 m |                  0 |                          — |                      10 |                0 m² |
| Kamloops |   500 m |                  0 |                          — |                       9 |            36.65 m² |
| Kamloops | 1,000 m |                  0 |                          — |                       9 |                0 m² |
| Vernon   |   250 m |                  1 |                    2.87 ha |                       5 |            37.27 m² |
| Vernon   |   500 m |                  1 |                    4.04 ha |                       8 |                0 m² |
| Vernon   | 1,000 m |                  1 |                    4.06 ha |                       7 |                0 m² |

No baseline crossing is carried more than the 20 m diversion threshold. Zero
crossings at Kamloops means none above the entered stream threshold was found;
it does not mean the road has no drainage concerns.

The Vernon catchment grows about 41% between 250 and 500 m buffers. The 1,000 m
run has 30,189 missing cells out of 120,935 because the source tile ends. Apparent
convergence at that size does not establish a complete watershed. The new warning
identifies missing ground, and every run explains that catchments end at the
sampled buffer and terrain-data edges.

Both DEMs have approximately 6 m ground spacing. Their new coarse-grid warning
states that narrow ditches and culvert channels may be unresolved. Single-cell
ponds that appear/disappear between these grids are reconnaissance flags to
review on finer bare-earth terrain, not verified water bodies.

## A user workflow exercised on both devices

1. Run drainage and inspect the listed stream crossing or ditch outlet. Selecting
   its station now opens the plan on mobile, with the shared station and flow
   overlay; desktop keeps the connected views visible.
2. Enter a proposed culvert through **Engineering → Drainage**. The first
   illustrative pipe at the crossing's entry, station 96.65 m, appears to serve
   only 0.0075 ha on the design surface against 4.04 ha on existing ground.
   A new catchment-loss warning calls for inlet/flow inspection rather than
   treating its small modeled flow as a sufficient pipe check.
3. Move that illustrative pipe to the largest interior outlet candidate, station
   89.18 m. This selection rule excludes the first/last 20 m and uses the
   largest reported area; it is not a field-selected structure location.
4. Compare rainfall and diameter scenarios, including their warnings:

| Illustrative pipe scenario at 89.18 m | Modeled peak Q | Full-pipe capacity | Model comparison     |
| ------------------------------------- | -------------: | -----------------: | -------------------- |
| 0.30 m diameter, 50 mm/h              |     0.205 m³/s |         0.074 m³/s | Below modeled peak   |
| 0.30 m diameter, 100 mm/h             |     0.409 m³/s |         0.074 m³/s | Below modeled peak   |
| 1.20 m diameter, 100 mm/h             |     0.409 m³/s |         2.987 m³/s | Carries modeled peak |

Doubling rainfall doubles the calculated peak without changing the catchment.
The larger pipe changes capacity without changing the modeled contributing area.
Each edit stales the old run and removes its map overlay until re-run.

All pipe dimensions and storm choices here are illustrative. Inverts were left
unknown intentionally to verify the missing-invert warning and explicit assumed
2% slope. The check does not establish inlet/headwater performance, debris or fish
passage, design-event rainfall, field catchments or construction suitability.

## Verification and remaining limits

The four browser cases pass. The existing synthetic drainage browser regression
also passes, including stale runs and switching alternatives. All 37 targeted
terrain, drainage, surface and export unit tests pass; TypeScript, targeted ESLint
and formatting checks pass.

Added the opt-in `tests/e2e/forestry-road-drainage-real-areas.spec.ts`. Supply the
actual exported baselines outside the repository:

```sh
PGMAPS_ROAD_DRAINAGE_PROJECT_DIR=/path/to/saved-real-road-projects \
  npx playwright test tests/e2e/forestry-road-drainage-real-areas.spec.ts \
  --project=chromium --workers=2 --reporter=line
```

The directory must contain `kamloops-desktop.road.json` and
`vernon-mobile.road.json`. `PGMAPS_E2E_BASE_URL` and
`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` can select an existing server and executable.
Run settings, per-step images, original/illustrative projects and outcome records
are retained under `/workspace/scratch/road-drainage-check/`.

The road and entered culverts save with the project. Drainage runs do not; their
settings are browser-local and are not portable in the project file. Re-run after
reopening, and record the rainfall, buffer, source and assumptions used. The
[drainage guide](forestry-road-design/drainage.md) documents the method and limits.
