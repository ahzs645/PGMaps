# Mission workbench: desktop and mobile validation

This validation applies to the working `/dev/mmgis` Earth GIS subset. It follows
the [MMGIS source comparison](mmgis-interaction-comparison.md). Missing MMGIS
features remain missing; testing the workbench on a phone does not establish
MMGIS runtime parity.

## Device and input matrix

The same workflow tests run at 1440×960 with mouse input and at 390×844 with
Chromium mobile/touch emulation. The phone tests use actual browser touch taps,
touch drag events for vertex and pane editing, and a two-finger pinch gesture.
They do not emulate a hover pointer to inspect rasters.

Additional viewport checks cover 320×740, 667×375 landscape, 768×1024, 1024×768
and 1280×720. Camera tests also rotate/resize between phone and desktop layouts
and verify that layers and their map sources survive. Browser screenshots are
saved as CI test artifacts for the additional viewports.

| Capability family     | Desktop and phone workflow                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layers / Legend       | Toggle a legend category, change all four style modes, reorder layers, toggle a group, filter/search and download the resulting CSV/GeoJSON.                 |
| Info / Search         | Select a search result, edit its JSON properties and open its attribute table.                                                                               |
| Draw                  | Place a point, draw a line and closed polygon, undo a draft vertex, Finish, drag a saved vertex, undo the edit, delete and restore a feature.                |
| Measure               | Place a path through clicks/taps and finish it using the map controls. Existing desktop tests cover live mouse bearing/distance and double-click completion. |
| Identifier / raster   | Import a real GeoTIFF, inspect its original zero-valued cell by map tap/click, connect/query a COG and recover from a failed raster connection.              |
| Profile / Viewshed    | Sample an imported DEM, select a chart sample, export profile CSV, enable/disable 3D terrain, place an observer and run the shared viewshed worker.          |
| Sites / mission state | Save and restore a camera bookmark, export/import the mission and restore it from a compressed share link.                                                   |
| Time                  | Edit the date window, step a frame and play/pause with the controls reachable above the collapsed sheet.                                                     |
| Map views             | Switch plan/globe/split, pan/zoom, resize split panes and rotate/resize while retaining features and map sources.                                            |
| Export                | Download filtered CSV/GeoJSON, mission JSON, profile CSV and a WebGL map PNG.                                                                                |

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
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/e2e/mmgis.spec.ts tests/e2e/mmgis-responsive.spec.ts --workers=1
```

The [mission workflow](../.github/workflows/mmgis.yml) runs both suites and saves
browser artifacts. It also runs application types, focused lint, mission/import/
terrain unit checks and the production browser/worker build.

## Evidence limits

Source responses are controlled: a real encoded Terrarium tile, a GeoTIFF file,
CSV/GeoJSON and TiTiler-style responses. Tests verify numeric zero, actual map
sources/paint/terrain and completed worker output. They do not prove external
service uptime, CORS configuration, arbitrary assets or scientific accuracy.

These are Chromium browser/emulation checks, not physical iPhone/Android device
tests or a Safari/Firefox compatibility certification. Native file-picker UI,
soft keyboard viewport changes, OS sharing/download UI, GPS permissions and
device-specific GPU behavior need real-device checks. The MMGIS backend,
planetary, scientific viewer and animation-export gaps in the comparison remain
outside the implemented subset on both desktop and mobile.
