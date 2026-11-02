# Mission workbench: desktop and mobile validation

This validation applies to the working `/dev/mmgis` Earth GIS subset. It follows
the [MMGIS source comparison](mmgis-interaction-comparison.md). Missing MMGIS
features remain missing; testing the workbench on a phone does not establish
MMGIS runtime parity.

Continuation on 2026-11-02 (America/Vancouver) rebases onto main `cc511eea`
and its GeoToolkit `750accff` pin. Verification includes application TypeScript,
focused lint, the production browser/worker build and 100 mission/import/terrain
unit checks. The browser matrix contains the existing 32 Chromium cases plus
20 new cases (five journeys across Chromium/WebKit desktop/touch). All 52 cases passed; the final new matrix passed without retries. Results and
remaining engine/device limits are recorded below; the repository workflow runs
the same production bundles and uploads artifacts.

A pinned local MMGIS/PostGIS reference was also run. The shared overlap fixture
passed upstream desktop/touch inspection, overlap choice, nested filtering and
hide/restore checks with zero page script errors. The
[reference validation](mmgis-reference-validation.md) records that limited
runtime comparison and its reproduction script. Other plugin entries retain
source-only comparison status.

The earlier 2026-10-30 live-basemap smoke check loaded CARTO tiles and created a
point on desktop/touch without script errors. That observation is historical;
the current controlled-source suites do not retest external service uptime.

## Device and input matrix

The same workflow tests run at 1440×960 with mouse input and at 390×844 with
Chromium mobile/touch emulation. The phone tests use actual browser touch taps,
touch drag events for vertex and pane editing, and a two-finger pinch gesture.
They do not emulate a hover pointer to inspect rasters.

The new [parity suite](../tests/e2e/mmgis-parity.spec.ts) also runs those desktop
and phone viewport sizes in Playwright WebKit 26.0. It uses native clicks/taps,
accessible vertex controls and the keyboard sheet-expansion path. These new
cases use device-pixel ratio 1 and reduced motion for deterministic software
rendering. They do not claim retina GPU performance or animation validation.
Touch helpers check the coarse-pointer media feature as well as touch-point
count: Linux WebKit reports zero touch points even in touch emulation. Native
WebKit drag/pinch and physical Safari gestures remain unverified.

Additional viewport checks cover 320×740, 667×375 landscape, 768×1024, 1024×768
and 1280×720. Camera tests also rotate/resize between phone and desktop layouts
and verify that layers and their map sources survive. Browser screenshots are
saved as CI test artifacts for the additional viewports.

| Capability family     | Desktop and phone workflow                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layers / Legend       | Toggle a legend category, change all four style modes, reorder layers, toggle a group, filter/search and download the resulting CSV/GeoJSON.                                                                    |
| Info / Search         | Select/search overlaps, cycle candidates, filter nested zero/false values, hide/restore a feature across reload, edit JSON and open its table.                                                                  |
| Draw                  | Create point/line/polygon, Finish, drag/undo/delete/restore. New cross-engine controls insert/remove vertices in another multipart line part; pure tests cover holes/nested collections/Z.                      |
| Measure               | Place a path through clicks/taps and finish it using the map controls. Existing desktop tests cover live mouse bearing/distance and double-click completion.                                                    |
| Identifier / raster   | Import a real GeoTIFF, inspect its original zero-valued cell by map tap/click, connect/query a COG and recover from a failed raster connection.                                                                 |
| Profile / Viewshed    | Sample imported DEM/profile cursor/CSV, toggle relief, place observer and run worker. New cases block AWS requests, verify zero elevation and completed directional FOV/target-height output from imported DEM. |
| Sites / mission state | Save/restore camera plus optional layer/time settings, retain camera-only compatibility, export/import and compressed sharing.                                                                                  |
| Time                  | Edit the date window, step a frame and play/pause with the controls reachable above the collapsed sheet.                                                                                                        |
| Map views             | Switch plan/globe/split, pan/zoom, resize split panes and rotate/resize while retaining features and map sources.                                                                                               |
| Export                | Download filtered CSV/GeoJSON, mission JSON, profile CSV and a WebGL map PNG.                                                                                                                                   |

The original workbench suite also covers keyboard vertex edits, invalid mission
input, property undo/redo, inclusive time filtering, selection after hiding a
layer and mixed geometry rendering. Its mobile smoke test remains in place.

## Responsive behavior

- Activating a map tool or vertex editing collapses the phone sheet. Finishing a
  saved shape or selecting a feature opens its inspector. Configure and Draw
  toolbar buttons open the correct panel on phones as well as desktops.
- A contextual map bar provides Finish, draft-vertex undo and Done without
  requiring double-tap gestures or a hardware Escape key.
- Taps establish the map inspection coordinate. Both local DEM inspection and
  the COG query action work without mouse hover.
- Split scenes share available height vertically on narrow portrait screens;
  wider screens and landscape orientation place them side by side. Neither
  scene uses fixed stacked heights that clip
  the lower map. The split separator accepts touch, mouse and keyboard input.
- The map reserves space for the collapsed mobile sheet so time and export
  controls remain reachable. Map panes may shrink on short screens rather than
  force overflow, with a compact header on short phones. Map view buttons keep accessible names when their text is
  visually hidden.
- Phone text inputs use 16 px type to avoid automatic iOS focus zoom. Vertex and
  observer handles have larger touch targets.

## Reproduce

Start the normal Vite development server after building the toolkit, then run:

```sh
npx playwright install --with-deps chromium webkit
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/e2e/mmgis.spec.ts tests/e2e/mmgis-responsive.spec.ts --workers=1
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.mmgis.config.ts
```

The [mission workflow](../.github/workflows/mmgis.yml) runs the original suites and new cross-engine matrix sequentially and saves
browser artifacts. It also runs application types, focused lint, mission/import/
terrain unit checks and the production browser/worker build.

## Evidence limits

Source responses are controlled: a real encoded Terrarium tile, a GeoTIFF file,
CSV/GeoJSON and TiTiler-style responses. Tests verify numeric zero, actual map
sources/paint/terrain and completed worker output. They do not prove external
service uptime, CORS configuration, arbitrary assets or scientific accuracy.

These are Linux Chromium/WebKit browser and touch-emulation checks. They are not physical iPhone/Android tests or a macOS Safari/Firefox compatibility certification. Native file-picker UI,
soft keyboard viewport changes, OS sharing/download UI, GPS permissions and
device-specific GPU behavior need real-device checks. The MMGIS backend,
planetary, scientific viewer and animation-export gaps in the comparison remain
outside the implemented subset on both desktop and mobile.

## Continuation regression fixes and remaining checks

- Preserve main's road-test timeout fix and toolkit version during the rebase.
- Retain CI's software-compositing workaround in the mission suites' explicit
  launch options; the previous terrain click/tap runner failure is covered again.
- Select `canvas.maplibregl-canvas` explicitly. The newer toolkit's style preview
  also contains a canvas, so the previous generic canvas selector is ambiguous.
- Send the actual raster cells to the visibility worker while using their hash
  for cache identity. The imported-DEM case rejects remote elevation access and
  checks worker output, rather than just the presence of controls.
- Preserve feature IDs through deletion, transport and hidden-state restoration;
  distinguish numeric zero and boolean false from missing data.
- New-hole drawing, profile line of sight and matched upstream analysis numerics are still pending.
  The [full parity roadmap](mmgis-parity-roadmap.md) keeps backend, planetary and
  scientific-viewer acceptance in scope.
