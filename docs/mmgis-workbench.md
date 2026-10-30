# Mission workbench

`/dev/mmgis` is an MMGIS-inspired Earth GIS workbench using `@pgmaps/geo-toolkit`.
It is linked from the Dev Library. Run the normal PG Maps development server and
open that route.

See the [source and interaction comparison](mmgis-interaction-comparison.md) for
the complete core-plugin inventory, gesture checks and remaining differences,
and the [initial toolkit gap analysis](mmgis-geotoolkit-gap-analysis.md) for the
package-level assessment. This example does not establish full MMGIS parity.

## Working capabilities

- An illustrative Prince George mission with clearly identified example data.
- Independent vector layers with visibility, stacking, categorical/range/size
  styles, opacity, legends, property filters, tables and feature inspection.
- Local GeoJSON, zipped shapefile, KML and coordinate CSV import through the
  existing importer; GeoJSON URL and City of Prince George catalog connections.
  Mixed point/line/polygon imports retain every geometry family.
- Search across visible feature properties. Optional map/table filtering uses
  the same selected categories, mission time and source feature identities.
- Point, line and polygon creation, geographic length/area measurement, feature
  property editing, deletion and draggable/keyboard-operable vertex handles.
  Drawing has live segment distance/bearing feedback and a dashed preview;
  double-click commits the terminal vertex once. XY edits preserve elevation.
  Example layers are read-only; make an editable copy from a layer's menu.
- Twenty mission undo/redo steps plus separate draft-vertex undo.
- Plan, globe and synchronized plan/3D scene views; configurable Earth relief.
- Cropped local elevation GeoTIFF import, an elevation-color overlay and original
  cell inspection. Display resampling never replaces original values.
- XYZ overlays and COG connections through a configurable TiTiler service. COG
  point queries read the configured band rather than infer values from colors.
- Elevation profiles sampled from an imported DEM or AWS overview terrain;
  hover/keyboard profile sample linked to a map marker and profile CSV export.
  Terrain-only viewshed with explicit pending/current state.
- Per-layer date fields, inclusive UTC date windows and cumulative daily playback.
- Local mission configuration, new/duplicate/example missions, camera bookmarks,
  device persistence, validated JSON import/export and compressed share URLs.
- Map WebGL-canvas PNG export and filtered layer CSV export. PNG capture excludes
  HTML markers and application panels, following the toolkit capture contract.
- Responsive sidebar/sheet, resizable split scenes, attribute table and a read-only
  `read_mission_workbench` WebMCP tool reporting actual map/layer state.

## Boundaries and limits

This route is a browser application, not a deployment of MMGIS. It does not
provide shared accounts, a spatial database, collaborative editing, published
server history, STAC mosaicking, planetary coordinate systems, SPICE, scientific
model/photosphere/radar viewers or animation video encoding. No controls imply
those services exist. COG serving and raw-value querying require a reachable
TiTiler deployment with CORS and permission to read the source asset.

Mission files and vector imports are capped at 32 MB. Missions support up to 100
vector layers, 20 tile overlays and 100 bookmarks. Each imported collection has a
100,000-feature limit. Share URL compressed payloads are capped at 30,000
characters; larger missions must be exported as files. Links contain the vector
data and source URLs, so sharing is explicit. Browser storage can fill; the save
status then asks the user to export a mission. Imported DEM bytes remain in the
current tab and are excluded from saved missions and links.

Local DEM imports reuse the existing forestry reader: single-band metre-valued,
north-up GeoTIFFs, up to 64 MB and 1,048,576 native cells; WGS84, Web Mercator, BC
Albers and NAD83/WGS84 UTM zones 7–11. A vertical reference is required. The local
DEM drives original cell inspection and profile sampling. It does not replace
MapLibre relief or the viewshed worker's AWS overview DEM.

Profiles use at most 200 stations and 64 overview tiles. Viewsheds use the shared
terrain feature with a 128×128 display grid, a 100 m–5 km radius and 0.5–100 m eye
height. Missing terrain stays unknown. Earth curvature and fixed 0.13 refraction
are included; trees, buildings and RF quality are excluded. The underlying shared
analysis has its documented latitude/date-line and tile-budget limits. A previous
footprint may remain while a new observer is loading, and the UI identifies this.

Dates without an offset are interpreted in UTC. Numeric feature times are Unix
milliseconds. Untimed layers remain visible; missing/invalid dates in a layer
with a chosen time field are excluded while mission time is enabled. Ordinary
playback steps data; it is not a frame-ready animation export system.

## Ownership and verification

`src/pages/DevMmgis.tsx` composes the route. `src/pages/dev-mmgis/` contains the
mission model, validation, transport, panels and map adapters. Reusable rendering,
workspace, legend, chart-independent controls and export primitives continue to
come from GeoToolkit. Existing PG Maps data/style/table and terrain modules are
reused without changing their ownership or importing application code into the
toolkit. The toolkit submodule revision remains unchanged.

Focused checks:

```sh
npm run toolkit:build
npx vitest run src/pages/dev-mmgis/mission.test.ts src/lib/geoFileImport.test.ts src/pages/dev-data/model.test.ts src/pages/dev-forestry/terrain.test.ts src/pages/dev-forestry/visibility.test.ts
npx eslint src/pages/DevMmgis.tsx src/pages/dev-mmgis
npx tsc -b
# With an existing Vite server:
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/e2e/mmgis.spec.ts --workers=1
```

Browser tests stub basemaps, terrain and raster services to verify interactions
and actual MapLibre state deterministically. They do not establish the
availability of any remote deployment or the scientific accuracy of source data.
