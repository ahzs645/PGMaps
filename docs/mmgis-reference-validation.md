# Pinned MMGIS runtime comparison

Observed 2026-11-02, America/Vancouver, against upstream
[`c576fe49`](https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd).
The local upstream application was built from source, started with PostgreSQL
16/PostGIS 3.4, and seeded through its own Config API with the official
Reference Mission. All six reference geodatasets were created successfully.
STAC, TiTiler, TiPG, VeloServer and SPICE services were not enabled.

The upstream map loaded with all 13 configured Reference Mission tool buttons and
no page script errors on desktop. This checks loading and configuration, not the
functionality of all 13 tools. Configured optional tools do not change the core
59-entry inventory.

## Shared interaction fixture

Both applications use [mmgis-overlap.geojson](../tests/fixtures/mmgis-overlap.geojson):
two points at longitude/latitude 0/0 with distinct persistent IDs, names, dates,
and nested zero/false/array values. A separate upstream `Parity-Interaction`
mission uses the Reference Mission's complete `Initially Visible` vector-layer
configuration with this file as its URL. Keeping the full layer configuration
avoids treating an invalid minimal configuration as an upstream feature failure.
Its first Sites entry is `Parity origin` (`code: PAR`, lat/lng 0/0, zoom 13),
because upstream Sites initialization applies the first site's camera.

The observation script uses real browser mouse clicks or touch taps, with
read-only inspection of the resulting DOM. It does not inject selection events
or call internal selection methods.

| Journey                      | Upstream desktop / touch                                    | Workbench counterpart                                                           |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Click/tap overlapping points | Two actual Leaflet paths; Info shows `1 of 2`               | Actual MapLibre hit query; inspector offers previous/next                       |
| Choose another overlap       | Info dropdown changes selected feature                      | Next feature changes stable source identity                                     |
| Filter nested fields         | `zero` shows numeric `0`; `flag` shows boolean `false`      | Searchable nested inspector preserves both values                               |
| Hide and restore             | Hide feature, reshow-all action, then upstream confirmation | Hide feature; layer's Show hidden features action; also persists through reload |

All four journeys passed on Chromium desktop 1440×960 and Chromium touch
emulation 390×844 with zero page script errors. Workbench-specific WebKit checks
are recorded separately in [device validation](mmgis-device-validation.md).
Upstream's reshow confirmation and overlap dropdown are intentionally recorded
as interaction differences; matching an outcome does not assert identical UI.

## Reproduce the observation

Build and run the pinned upstream checkout using its documented Node/PostGIS
setup. Create its Reference Mission through `/api/configure/add` with
`setupReferenceMission: true` using a local administrator session. Create the
`Parity-Interaction` mission as described above, copy the shared fixture to
`Missions/Parity-Interaction/Layers/overlap.geojson`, and set that layer's URL to
`Layers/overlap.geojson`. The fixture mission must contain exactly those two
rendered vector features. Keep the local instance bound to localhost.

From the PG Maps checkout:

```sh
npx playwright install chromium
MMGIS_REFERENCE_URL='http://127.0.0.1:18888/?mission=Parity-Interaction' \
  node scripts/mmgis-reference-observation.mjs
```

`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` can select an installed Chromium.
`MMGIS_REFERENCE_OUTPUT` can change the output directory (default
`/tmp/pgmaps-mmgis-reference`). The script saves desktop/touch screenshots and a
JSON observation report, fails on an unmet assertion, and closes its browser.
It assumes the fixture is configured; it neither provisions an account nor
changes mission configuration. Run the workbench counterpart with
`npx playwright test --config=playwright.mmgis.config.ts`.

## What this evidence does not establish

This is a runtime comparison of these inspection behaviors. Upstream drawing,
profiles, viewshed numerics, sites, temporal reloads, permissions, collaboration,
service failures, planetary geometry and scientific viewers have not been
compared in matched runtime journeys. The full core inventory is still a source
audit, not 59 passing runtime checks. Physical iOS/Android and macOS Safari remain
untested. See the [remaining parity work](mmgis-parity-roadmap.md).
