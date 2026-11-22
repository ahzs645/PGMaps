# Mission workbench

`/dev/mmgis` is an MMGIS-inspired Earth GIS workbench using `@pgmaps/geo-toolkit`.
It is linked from the Dev Library. Run the normal PG Maps development server and
open that route.

See the [source and interaction comparison](mmgis-interaction-comparison.md) for
the complete core-plugin inventory, gesture checks and remaining differences,
and the [initial toolkit gap analysis](mmgis-geotoolkit-gap-analysis.md) for the
package-level assessment. This example does not establish full MMGIS parity.
The [device validation matrix](mmgis-device-validation.md) records desktop,
touch-phone, landscape and narrow-screen workflows and their verification limits.

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
  property editing, deletion, optional vertex snapping and draggable/keyboard-operable vertex handles. Midpoints can be inserted and vertices removed across interior rings, multipart shapes and nested collections.
  Drawing has live segment distance/bearing feedback and a dashed preview;
  double-click commits the terminal vertex once. XY edits preserve elevation.
  Example layers are read-only; make an editable copy from a layer's menu.
- Overlap cycling, searchable nested properties, copy GeoJSON, locate and per-feature hide/restore with persistent source identities.
- Twenty mission undo/redo steps plus separate draft-vertex undo.
- Plan, globe and synchronized plan/3D scene views; configurable Earth relief.
- Cropped local elevation GeoTIFF import, an elevation-color overlay and original
  cell inspection. Display resampling never replaces original values.
- XYZ overlays and COG connections through a configurable TiTiler service. COG
  point queries read the configured band rather than infer values from colors.
- Elevation profiles sampled from an imported DEM or AWS overview terrain;
  hover/keyboard profile sample linked to a map marker and profile CSV export.
  Terrain-only viewshed with explicit pending/current state, target height and directional field of view. Imported DEMs supply the visibility worker as well.
- Per-layer date fields, inclusive UTC date windows and cumulative daily playback.
- Local mission configuration, new/duplicate/example missions, saved sites with optional layer/time/view presets,
  device persistence, validated JSON import/export and compressed share URLs.
- Map WebGL-canvas PNG export and filtered layer CSV export. PNG capture excludes
  HTML markers and application panels, following the toolkit capture contract.
- Responsive sidebar/sheet, resizable split scenes, attribute table and a read-only
  `read_mission_workbench` WebMCP tool reporting actual map/layer state.
  Phone map tools collapse the sheet and offer Finish/Undo/Done directly above
  the map. Feature selection opens the inspector; raster inspection accepts taps.

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

Saved missions accept MapLibre's full zoom range (−2 to 24), and display text
longer than 200 characters (labels from long file names or URLs, "copy" names) is
shortened when it is created, so a workspace the app saved always reopens; older
exports with longer names are shortened on import. If a stored workspace still
cannot be read, its raw text is copied to `pgmaps:mmgis:mission:v1:unreadable`
and nothing is autosaved over the original until you make a change. Vertex
editing is limited to 1,500 vertices per feature so the map stays responsive;
larger geometries keep their property, style and delete controls.

Local DEM imports reuse the existing forestry reader: single-band metre-valued,
north-up GeoTIFFs, up to 64 MB and 1,048,576 native cells; WGS84, Web Mercator, BC
Albers and NAD83/WGS84 UTM zones 7–11. A vertical reference is required. The local
DEM drives original cell inspection, profile sampling and the shared visibility worker. It does not replace MapLibre relief, which still uses AWS.

Profiles use at most 200 stations and 64 overview tiles. Viewsheds use the shared
terrain feature with a 128×128 display grid, a 100 m–5 km radius and 0.5–100 m eye
height, 0–1000 m target height and a 1–360° horizontal field of view. Missing terrain stays unknown. Earth curvature and fixed 0.13 refraction
are included; trees, buildings and RF quality are excluded. Sightlines are
sampled every half DEM cell, so a one-cell wall or ridge on a fine imported DEM
cannot fall between samples; a ray that would need more than 4,096 samples
reports its far cells as unknown rather than visible, and the ready message says
from what distance. The underlying shared
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
toolkit. After the rebase, the toolkit pin is main’s `750accff`; this PR makes no toolkit pointer change relative to main.

Focused checks:

```sh
npm run toolkit:build
npx vitest run src/pages/dev-mmgis src/features/terrain-viewshed src/lib/geoFileImport.test.ts src/pages/dev-data/model.test.ts packages/geo-toolkit/src/terrain/terrain.test.ts src/pages/dev-forestry/visibility.test.ts
npx eslint src/pages/DevMmgis.tsx src/pages/dev-mmgis
npx tsc -b
# With an existing Vite server:
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/e2e/mmgis.spec.ts tests/e2e/mmgis-responsive.spec.ts --workers=1
PGMAPS_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.mmgis.config.ts
```

Browser tests stub basemaps, terrain and raster services to verify interactions
and actual MapLibre state deterministically. They do not establish the
availability of any remote deployment or the scientific accuracy of source data.

## Terrain Viewer and historical imagery

In **Rasters → Historical imagery**, choose an **Imagery source** (the shared imagery feeds,
`docs/imagery-feeds.md`: Esri Wayback first, NASA's daily Landsat and Sentinel-2 passes), browse its
dates, pick one and add it to the mission (**Browse Wayback releases**, **Add Wayback layer** for
Wayback). A date with two layers (NASA's Landsat and Sentinel-2) adds two overlays. Add a second date
and adjust the upper layer's opacity to compare the same place. The mission stores each layer's
tile URL, attribution and deepest zoom (`maxZoom`, so a deeper view stretches the last real tile
instead of asking for tiles the service does not have), so a saved mission reopens that date even if
the catalogue has since changed. Tiles are fetched from the source each time they are needed. The
catalogue is fetched on request, with a 20-second timeout and a retry control. Sentinel-2 scenes are
not offered: PGMaps draws them through its own tile reader, and a saved mission holds only plain
HTTPS tile addresses.

In **Terrain**, **Shade terrain relief** draws hillshade from the workbench's
AWS Terrarium DEM, independently of 3D terrain. Either panel can open the
current location in Iconem. The terrain link selects the same AWS source and
carries zoom, bearing and pitch. The imagery link opens a plan view and passes
the selected release date when available. Iconem resolves the date against its
timeline. These are one-way links. Mission files, imported rasters, annotations
and credentials stay in PGMaps.

| Limit | Practical effect |
| --- | --- |
| Release date and coverage | A Wayback release dates the global mosaic. Adjacent dates may use identical pixels at a location. Use imagery metadata to establish capture date, resolution and local credits. |
| Zoom and resolution | PGMaps requests 256 px imagery tiles through zoom 22 and overview DEM tiles through zoom 14. More screen magnification cannot recover detail. Terrain samples and imagery may have different dates and resolutions. |
| Source compatibility | Direct tiles need browser-accessible Web Mercator URLs and CORS. The template adapter understands XYZ, ArcGIS level/row/col and numeric WMTS matrix/row/col. Other projections, matrix numbering and south-origin grids need an adapter or tile service. |
| Network and capacity | Wayback uses Esri directly without an API key. The catalog and tile services publish no request allowance in the interfaces used here. No throughput is reserved and no tiles are archived by the workbench. The workbench allows 20 tile overlays total. Extra visible releases and split scenes increase tile traffic and GPU memory. |
| Advanced analysis and exports | Iconem offers terrain derivatives, GeoTIFF exports and historical comparison grids up to 4 × 2 in its viewer. Its DEM export defaults to a 4,096 px longest edge, configurable in export settings. Historical batch export has a separate target resolution. Browser memory, source coverage and, for some workflows, TiTiler capacity constrain the result. PGMaps' mission export saves source references. |
| Data rights | Both Iconem applications publish MIT-licensed code. Imagery and DEM terms come from the data providers. Each catalog item links to its release credits from the map attribution. Subscription sources such as Planet require their own access. A working tile URL alone does not establish bulk-download or redistribution rights. |

Iconem is phasing out its standalone historical-satellite app. Both workbench
links target Terrain Viewer, which exposes its state through URL parameters.
See the [upstream migration notice](https://github.com/Iconem/historical-satellite),
[Terrain Viewer URL contract](https://terrain-viewer.iconem.com/docs/dev/url-api/),
[Esri Wayback](https://livingatlas.arcgis.com/wayback/) and
[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
