# Native watershed portal preview

Open `/dev/nechako/portal` from **Dev library → Nechako portal → Portal interface**,
or use **Open portal interface** in the existing workbench. The route has its own
static build entry point and runs on the PGMaps React/MapLibre/shared-toolkit stack.
It does not embed or load the original ExtJS/OpenLayers application.

The teal header, centred navigation, map canvas, collapsible Map Tools and Map
rails, and coordinate footer follow the original portal's map-centred interface.
The PGMaps navigation remains available. Rails become overlays on phones; their
contents scroll independently and keep the same controls mounted across collapse.

## Available workflows

- The initial map uses the bundled 46-location research workspace and the
  Watershed Context service's Nechako Watershed layer. Location markers are
  reference points, not study footprints.
- **Map Tools** reuses the existing WMS catalogue/style selector, local vector
  drawing, geometry processing, attributes and export controls. **Map** contains
  layer order, opacity, visibility, extents, legends and identify selection/results.
  Clicking a local vector reveals its tools; identify results reveal the Map rail.
- **Search** defaults to all 1,408 bundled research records, including unmapped
  records. Its second tab uses the existing live portal submission search, including
  context expressions and current-map or local-polygon geographic limits.
- **Projects** opens the existing JSON import/export and browser save/restore
  workflow. The workspace includes camera, WMS layers/styles, local vector layers,
  warnings and retained original portal project data where supplied.
- **Import** opens the existing GIS/file conversion and preview component. Adding
  a converted vector closes the window and retains the current map layers.
- **Reports** opens local monitoring CSV matching, validation, charts and exports.
- **Research map** opens the existing bundled research explorer and timeline in
  a window. Returning to **Watershed map** preserves the underlying map workspace.
- **Links** provides the original site, data/source attribution, the comparison,
  and existing saved-project checks. **Login / Sign-up** links to the original
  portal's account flow.

Search, report and project windows leave the primary map mounted. Panel names are
reflected in the `panel` query parameter so direct links and browser Back work.
Local edits are transient until saved or exported; closing an import/report/search
window discards that window's unsaved form settings, while the map workspace remains.

## Sources and limits

The preview reads research JSON, service definitions and capabilities from the
app-owned `public/data/nechako-showcase` snapshot captured October 11, 2026. WMS
images, legends and identify responses and the basemap use live HTTPS sources.
Anonymous reads use the existing portal transport; no new proxy, authentication,
publishing or administrative endpoint is introduced.

The original portal owns account registration, permissions and publishing. Live
submission search and saved projects remain subject to the documented registration
failure and authentication requirements. The preview does not imply those protected
workflows are available or that all saved projects or attachments were imported.
See [completion matrix](completion-matrix.md) and [data audit](data-audit.md).

## Verification

`tests/e2e/nechako-native-portal.spec.ts` exercises desktop and phone navigation,
local snapshot boot, WMS/identify fixtures, unmapped research and registration
failure, GIS import into the persistent map, workspace exports, browser restore,
the embedded research timeline, account hand-off, and failed-load retry.
The full local suite passed 11 browser workflows and 30 focused unit tests, with
TypeScript, scoped lint, production build, the static subpage entry and existing
project package audit also passing. Fixture reads verify interface integration; they do not establish live CORS.
The existing workbench suites remain the regression checks for reused components.
