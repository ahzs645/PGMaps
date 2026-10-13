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

- The initial map uses the bundled 46-location research workspace and EchoScreen's
  existing **BC Freshwater Atlas Nechako polygon**, selected by `namedWatershedId`
  **8886**. It uses the same cyan outline, 14% fill and 2.2-pixel line, and fits
  the polygon extent. Only Nechako is selected from the shared Fraser/Nechako
  file; geometry and properties are retained. This is the existing **50-metre
  topology-preserved simplification**, not full-resolution source geometry.
  Location markers are reference points, not study footprints.
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
  a window. Its optional Nechako River boundary toggle reads the same shared
  polygon. Returning to **Watershed map** preserves the underlying map workspace.
- **Links** provides the original site, data/source attribution, the comparison,
  and existing saved-project checks. **Login / Sign-up** links to the original
  portal's account flow.

Search, report and project windows leave the primary map mounted. Panel names are
reflected in the `panel` query parameter so direct links and browser Back work.
Escape closes a focused native window immediately; a nested research record
dialog handles its own Escape and leaves the search window open. Browser reload
checks wait for the close and URL update to complete.
Local edits are transient until saved or exported; closing an import/report/search
window discards that window's unsaved form settings, while the map workspace remains.

## Sources and limits

The preview reads research JSON, service definitions and capabilities from the
app-owned `public/data/nechako-showcase` snapshot captured October 11, 2026. WMS
images, legends and identify responses and the basemap use live HTTPS sources.
The boundary is the generated local asset already used by
`/projects/echoscreen-climate-health`; it is not duplicated in the showcase.
The scraper submodule owns its source shards. Standard data sync builds the shared
asset; `npm run projects:echoscreen-data -- --watersheds-only` builds just the
watershed asset for isolated preview/browser checks. Workspace export/restore
preserves the selected polygon, styling and provenance. Submission search can use
it as the polygon geographic limit; genuine server-side filtering still requires
repairing the portal registration failure.
Anonymous reads use the existing portal transport; no new proxy, authentication,
publishing or administrative endpoint is introduced.

The original portal owns account registration, permissions and publishing. Live
submission search and saved projects remain subject to the documented registration
failure and authentication requirements. The preview does not imply those protected
workflows are available or that all saved projects or attachments were imported.
See [completion matrix](completion-matrix.md) and [data audit](data-audit.md).

## Interface and display parity

Working PGMaps controls do not establish exact parity with every original portal
tool or protected payload. The current comparison is:

| Area | PGMaps behavior | Remaining difference |
| --- | --- | --- |
| Sidebars | Both edge rails expand, collapse and scroll; close/Escape restores focus; map and tool state remain mounted | Desktop panes and phone overlays use PGMaps responsive sizing rather than ExtJS layout internals |
| Layer tools | Catalogue, advertised WMS styles, opacity, visibility, ordering, zoom, legends and click identify | Private sources, arbitrary SLD and exact ordering across raster/vector/tile types remain unverified or unsupported |
| WMS display | GetMap and legends use the original service, layer and advertised style, preserving server symbology | MapLibre basemap, projection/zoom and labels can differ; upstream broken layers remain broken |
| Local vector selection | A map click opens Map Tools at the selected layer/feature, with original properties, measurements and exports | PGMaps attributes panel replaces the portal's popup/style editor; no promise of identical popup formatting or custom symbol rules |
| Research details | All 1,408 records are searchable, with title, author, year, type, tags and location IDs in PGMaps record dialogs | This is nwsviz literature, not the portal submission catalogue; absent citation/file links cannot be reconstructed |
| Search/projects windows | Open/close/Back preserves the main map; local workspace JSON and browser saves work | Live submission search and saved/default projects are blocked by registration; protected results and ownership workflows remain unverified |
| Imports/drawing/processing | Local GeoJSON and optional GDAL formats, drawing, attributes, edits, undo, exports and implemented geometry operations | Converter must be deployed for non-GeoJSON imports; original format-specific styles/media remain in retained files |
| Reports/popups | Local monitoring CSV charts/statistics; read-only submission resource panels and account handoff | Portal form/schema reports, attachment downloads, publication, login/session and administrator tools are not reproduced |

See the completion matrix for data-type limits and the original assessment for
the full portal feature inventory. Unavailable protected flows are not marked as
tested merely because their controls open.

## Verification

`tests/e2e/nechako-native-portal.spec.ts` exercises desktop and phone navigation,
local snapshot boot, WMS/identify fixtures, unmapped research and registration
failure, GIS import into the persistent map, workspace exports, browser restore,
the embedded research timeline and boundary toggle, account hand-off, and failed-boundary retry.
It checks exact shared-source geometry in workspace exports and polygon-search
requests, so a Fraser polygon or an approximate outline cannot pass.
The full local suite passed 11 browser workflows and 33 focused unit tests, with
TypeScript, scoped lint, production build, the static subpage entry and existing
project package audit also passing. Fixture reads verify interface integration; they do not establish live CORS.
The existing workbench suites remain the regression checks for reused components.
