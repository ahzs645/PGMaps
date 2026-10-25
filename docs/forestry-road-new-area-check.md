# New-area desktop and mobile road journeys

Three agents checked new-area terrain preparation, desktop use, and mobile use on
2026-10-24. The UI journeys start with a terrain file import, rather than a seeded
road project. Every camera movement uses rendered Fit/Zoom controls or actual pointer
gestures. Reading map coordinates to locate pointer targets is allowed; changing
the map camera or application state through script is not part of these journeys.

## Terrain and selection

Both public GeoTIFFs are independent of the earlier Prince George test tile:

| Area     | Source                                                                                          | SHA-256                                                            | Grid                                                     |
| -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Kamloops | [AWS tile 13/1357/2754](https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1357/2754.tif) | `37917d47255ba71057a4855dc82428a873ed888952e081c5618325f4235c3900` | 512 × 512, EPSG:3857, about 6.05 m ground sample spacing |
| Vernon   | [AWS tile 13/1381/2768](https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1381/2768.tif) | `83126970daa6c1cc134fc3e016f24904fec3fa9f758ab6a8cd989ca61e635dc8` | 512 × 512, EPSG:3857, about 6.10 m ground sample spacing |

Source attribution: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
The entered vertical reference is the product's assumed EGM96 orthometric metres;
local survey datum and bare-earth suitability were not independently established.
Grid spacing does not establish original source resolution or elevation accuracy.

The Kamloops guide uses the fixed tile centre and a contour direction derived from
a 10 m central gradient, with endpoints 100 m either side and a 25 m middle offset.
Vernon's same centre rule failed under both Balanced/100 m and Shortest/25 m searches.
The first declared secondary tile fraction (0.25, 0.25) succeeded and was used for
the mobile journey. These outcomes are retained in the data-agent report; a selected
successful example is not unbiased regional validation. Public metadata, exact
guide coordinates and selection rules are committed under
`tests/fixtures/forestry-road-new-areas/`; no DEM bytes or input road projects are
committed.

All searches keep the ordinary 12% grade limit and 25 m minimum radius. No real
exclusion, watercourse, field or geotechnical inputs were supplied.

## Failure found and fixed

Both UI agents reproduced the same initial blocker: importing an unrelated DEM
left the map centred on the old Prince George alignments. The only Fit button also
returned to those old roads, so the new terrain was not reasonably reachable.

`PlanView.tsx` now reveals terrain coverage when the active road is outside that
coverage. **Fit terrain coverage** is an explicit map control; **Fit selected road**
is available in Map display settings. The all-road Fit control remains available.
Automatic project opening fits the active road when it overlaps the terrain, so
retained alternatives in another area do not dominate the reopened view. View
navigation does not alter the project geometry, terrain or saved alternatives.

## What the journeys exercise

The desktop journey uses 1512 × 982 and 1280 × 720. It imports the Kamloops DEM,
locates the area using Fit/Zoom, pegs a three-point road, moves both endpoints,
inserts and moves a middle control, and creates horizontal and vertical alternatives.
It verifies linked station views, actual 3D ground rendering, project/GeoJSON/station
CSV downloads, device autosave restoration, and exact downloaded-file reopening in
a fresh browser context.

The mobile journey uses a touch-enabled 390 × 844 context, plus 320 × 568 and
667 × 375. It imports the Vernon DEM through the controls drawer, pans and zooms
using touch/UI controls, pegs a road with taps, duplicates it, and edits numbered
controls with real touch drags. Undo/redo and preservation of the original path are
checked. It then optimizes the original guide while retaining the edited alternative,
checks the pane tabs, 3D, summary/cost access and page containment, and checks both
device restoration and fresh-context downloaded-file reopening.

The optional default LiDAR fetch is deliberately blocked to exercise import recovery.
Its visible error is dismissed normally. The basemap uses a valid empty style for
deterministic rendering, and all imported terrain and road calculations are real.
Fresh-context file reopening also blocks external terrain requests. These checks
establish the software workflow, not basemap service availability or a field design.

## Recorded results

Both complete UI journeys passed, including normal device reload and exact
downloaded-project reopening in a fresh browser context. Both had zero browser
errors and no model warnings:

| Journey              | Final road length | Maximum design grade | Sampled section coverage | Cut / fill         |
| -------------------- | ----------------- | -------------------- | ------------------------ | ------------------ |
| Desktop, Kamloops    | 209.42 m          | 2.12%                | 100%                     | 915.16 / 917.25 m³ |
| Touch mobile, Vernon | 206.42 m          | 6.91%                | Complete (99.99999978%)  | 535.23 / 583.24 m³ |

The final mobile test reprojects each tap after the live drawing feedback resizes
the map, and checks every original control is within 1 m of its declared coordinate.
An earlier successful 338 m mobile road came from cached pre-resize tap pixels; it
is retained as earlier evidence rather than substituted for the final guide result.
Touch gestures use normal-sized, frame-paced movements across Chromium's gesture
threshold; they do not force events through overlays.

A separate agent re-read both actual exported project files against fresh GeoTIFF
decodes. For each, all 262,144 embedded cells and raster metadata matched exactly;
all 41 desktop / 33 mobile station elevations matched, with zero source differences.
The complete section, quantity, control and warning analyses matched after restoration.
The 12% grade and 25 m radius limits remained unchanged. Final projects were named
through the Save dialog as **Kamloops road design** and **Vernon road design**.

The navigation fix also passed the existing three responsive browser tests across
fourteen viewport sizes, and TypeScript and targeted ESLint checks passed. An
additional UI check verified that all-road Fit and selected-road Fit produce their
distinct intended views. Mobile results use touch-enabled Chromium emulation;
physical iOS and Android handsets were not exercised.

## Reproduce

The follow-up [optimization option comparison](forestry-road-optimization-options-check.md)
tests every corridor preference on the same guide, both profile objectives, and
explicit haul-cost sensitivities. It also records the endpoint-site defect found
and fixed during that comparison.

After installing dependencies/submodules and building the shared toolkit, download
the small fixtures outside the repository:

```sh
mkdir -p /tmp/road-new-area
curl --fail --location \
  https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1357/2754.tif \
  --output /tmp/road-new-area/kamloops.tif
curl --fail --location \
  https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/1381/2768.tif \
  --output /tmp/road-new-area/vernon.tif
sha256sum /tmp/road-new-area/*.tif

PGMAPS_ROAD_NEW_AREA=1 PGMAPS_ROAD_NEW_AREA_DIR=/tmp/road-new-area \
  npx playwright test tests/e2e/forestry-road-new-area-desktop.spec.ts \
  --project=chromium --workers=1

PGMAPS_ROAD_NEW_AREA_DEM=/tmp/road-new-area/vernon.tif \
  npx playwright test tests/e2e/forestry-road-new-area-mobile.spec.ts \
  --project=chromium --workers=1
```

Use `PGMAPS_E2E_BASE_URL` for an existing local server and
`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` for a supplied Chromium executable. Without
the opt-in variables, the live-data journeys are skipped. Per-step screenshots,
downloaded projects and JSON outcome records are written to the Playwright output
directory. Failed searches remain recorded and must preserve the saved project.
