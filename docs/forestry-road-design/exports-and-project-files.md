# Exports and project files: limits and checks

This guide covers how the workspace saves, restores and exports a road: the project JSON,
browser autosave, saved screen layouts and every file in the sidebar's **Files → Project & exports**. It says what each
file contains, which coordinate system it uses, what it leaves out and how a restore fails. The
formats are specified in the
[workspace contract](../forestry-road-design.md#exports-and-restoration).

## Before you rely on it

- **Download the project JSON.** Autosave is in this browser only. The project JSON is the only
  file that restores the whole design, and the only way to move it to another browser, device or
  person. The header **Save** button downloads it; it does not save locally.
- **Know how the terrain will come back.** Imported GeoTIFF and LAS/LAZ terrain is embedded in
  the file. The published LiDAR is re-downloaded and checked against its SHA-256. The regional DEM
  is re-downloaded without a check. The training hillside is synthetic. See
  [Restoring terrain](#restoring-terrain).
- **Check the coordinate system of each file.** LandXML and the stakeout CSV use projected grid
  coordinates. GeoJSON, shapefiles and the CSVs use WGS84 longitude/latitude. Do not mix them in
  another program without reprojecting.
- **Check the vertical datum.** Every elevation in every file is in the terrain's vertical datum,
  as typed or recorded. No file converts it. The datum text travels in LandXML, the CSVs, the
  plot book title block and the report.
- **Close previews before exporting.** Results exports are refused while a draft, numeric peg or
  template preview is open, and when the road has no calculated stations.
- **Fix invalid inputs first.** While a section or engineering input is invalid the results leave
  it out, and only the report and the map PDF are written, stamped. Every other results file is
  refused until the input is corrected. See
  [While an input is invalid](#while-an-input-is-invalid). The project JSON re-validates the whole
  project and cannot be downloaded either; autosave keeps the last valid version meanwhile.
- **Open the file before you send it.** Check that the CRS, station range and number of features
  are what you expect in the receiving program.

## What each file contains

| File                             | Contents                                                                                                                                                                                                                                                                                                                                                                                     | Coordinates                                                                      | Leaves out                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Project JSON (`.road.json`)      | `pgmaps-road-project-v1`: every alignment, PVIs, templates, widenings, engineering inputs, settings, context, D-lines, terrain profiles, terrain provenance, embedded raster                                                                                                                                                                                                                 | WGS84 lon/lat; raster in its own EPSG                                            | Calculated results, drainage runs and settings, undo history, layouts, regional DEM tiles, published LiDAR cells                            |
| Library JSON                     | `pgmaps-road-library-v1`: named templates and materials only                                                                                                                                                                                                                                                                                                                                 | None                                                                             | Road geometry, assignments, horizons                                                                                                        |
| GeoJSON                          | The centreline of the road on screen, or of every road, with control and design properties; crossings, culvert barrels, haul sites, context, D-lines, terrain profiles                                                                                                                                                                                                                       | WGS84 lon/lat, no Z                                                              | Sections, stations, drainage. Re-importing it gives linework and names, not PVIs or templates                                               |
| Station CSV                      | Every calculated station: chainage, lon/lat, ground, design, grades, radius, widths, areas, interval cut and fill, mass, interval surfacing, stripping, borrow and waste, completeness, flags, terrain provenance                                                                                                                                                                            | WGS84 lon/lat                                                                    | The station table's reporting interval (this CSV is always every station; the table's own CSV button follows the interval), section offsets |
| Station table CSV                | The Stations table as reported (`-volumes.csv`): the chosen interval and range, every column the road offers (cut, fill, surfacing, stripping, and borrow and waste once haul is on), the length each row leaves out, flags, and a last `total` row                                                                                                                                          | WGS84 lon/lat                                                                    | Terrain provenance, the hidden-column choice, the flagged-only filter                                                                       |
| Selected-section CSV             | One station's section samples with codes, ground, design and cut/fill                                                                                                                                                                                                                                                                                                                        | WGS84 lon/lat                                                                    | Other stations                                                                                                                              |
| Engineering CSV                  | Material quantities, culvert inventory, haul movements, itemized costs                                                                                                                                                                                                                                                                                                                       | Chainage only                                                                    | Geometry                                                                                                                                    |
| D-line CSV / HTML                | Supports, sampled profile, assumed sag and clearance; with rope and load also load path, tensions, rigging. Appended when the line has them: rigging set, saved or found supports with the multi-span load path, stake-out table, field-measured ground and its difference to the terrain                                                                                                    | WGS84 lon/lat                                                                    | Anchors' and trees' sizes, guylines, equipment ratings                                                                                      |
| D-line stake-out CSV             | One row per support and anchor of a D-line with a saved layout: station from the yarder, offset 0, grid easting/northing with EPSG, lon/lat, ground, support height, saddle elevation                                                                                                                                                                                                        | Project grid (terrain EPSG, else local UTM) and WGS84                            | A survey of the stake; tree or anchor sizes                                                                                                 |
| D-line sheet (PDF)               | One tabloid page for the D-line on screen: issue stamp, profile with supports and load path, plan strip with contours, support and stake-out table, forces and angles, limits, rigging, assumptions                                                                                                                                                                                          | Project grid in the table; plan north-up                                         | Pages per support; anchors' and trees' sizes                                                                                                |
| Landing reach CSV                | One row per bearing: reach or lower bound, what limited it, tailhold position, settings                                                                                                                                                                                                                                                                                                      | WGS84 lon/lat                                                                    | Lateral yarding, side-slope, profile samples                                                                                                |
| LandXML 1.2 (`.xml`)             | Active road only: lines, arcs and clothoid spirals; PVI profile with parabolic curves; ground profile; design and ground cross-sections about every 20 m; 3D feature lines                                                                                                                                                                                                                   | Terrain's projected EPSG, else WGS84 UTM zone of the first point                 | Other alternatives, surfaces (TIN), superelevation, template/corridor model, ditches as objects, culverts                                   |
| Stakeout CSV                     | Active road, about every 20 m: centreline, formation edges, ditch bottoms (cut only) and catch points with offset, grid coordinates, level, ground and cut/fill                                                                                                                                                                                                                              | Same as LandXML                                                                  | Reference or offset stakes, instrument data, point descriptions for a data collector                                                        |
| CAD drawing (`.dxf`, R12)        | Active road: plan centreline (lines and true arcs, spirals as polylines), 3D feature lines for the centreline, formation edges, ditch bottoms and catch points at every calculated station, station ticks and labels; profile and cross-sections at true scale below the plan                                                                                                                | Plan: same as LandXML. Profile and sections: their own frames below the plan     | Surfaces, hatching, title block, other roads, terrain contours                                                                              |
| Shapefile (`-shapefiles.zip`)    | `road_centrelines` (the road on screen, or every road), `road_stations` and `road_culverts` (active road only), each with `.prj` and `.cpg`                                                                                                                                                                                                                                                  | WGS84 lon/lat (`GCS_WGS_1984` `.prj`), 2D                                        | Sections, catch lines, sites, context, drainage, elevations as Z                                                                            |
| Plot book (`.pdf` and `.html`)   | Active road: A3 plan-and-profile sheets every 250 m with mass haul, then cross-section sheets of twelve every 20 m; title block on each                                                                                                                                                                                                                                                      | Plan drawn in grid metres, rotated to the road; no coordinate grid               | Culverts, curve data, PI table, legend, a fixed print scale                                                                                 |
| Printed report (`-report.html`)  | Active road summary, profile, full station table, crossings, materials, culverts, haul, costs, provenance, assumptions, and up to 240 section plots every 20 m                                                                                                                                                                                                                               | Chainage                                                                         | Drainage, plan view, LandXML-level geometry                                                                                                 |
| Block map sheet (`-<sheet>.pdf`) | One block on a printed sheet: field layout, LiDAR slope, canopy height or hillshade, 1:50,000 access or portrait imagery. Title bar, block information (area, centroid, BCGS mapsheet, elevation range, typed fields), a legend of what is drawn, Road Information table, scale bar, north arrow, the plan's notes as review markup. See [block map sheets](../forestry-block-map-sheets.md) | Web Mercator, north up; scale true at the frame's centre latitude; DMS graticule | Sections, profiles, culverts, haul; road surface classes; the reference sheets' BC Albers rotation                                          |

The plot book and report are self-contained HTML with no scripts or network resources. Open
them and use the browser's **Print / Save as PDF**; set the paper to A3 landscape for the plot
book.

## Limits and budgets

| Limit                                | Value                                                                                                                                                                 | Enforced in                                                                                                                                                                                                                                                                                                | What happens when exceeded                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Project file                         | 120,000,000 bytes (file) / characters (text)                                                                                                                          | `DevForestryRoads.tsx` `importFile`; `project.ts` `parseProject`                                                                                                                                                                                                                                           | Refused                                                                                                                    |
| Schema                               | `pgmaps-road-project-v1` exactly                                                                                                                                      | `project.ts`, `parseProject`                                                                                                                                                                                                                                                                               | Refused: "Use a pgmaps-road-project-v1 project file"                                                                       |
| Alignments                           | 1–20                                                                                                                                                                  | `project.ts`, `MAX_ALIGNMENTS`                                                                                                                                                                                                                                                                             | Refused                                                                                                                    |
| Horizontal points                    | 2,000 in the project (and per alignment)                                                                                                                              | `project.ts`, `MAX_POINTS`                                                                                                                                                                                                                                                                                 | Refused                                                                                                                    |
| Alignment length                     | 100 km                                                                                                                                                                | `project.ts`, `parseAlignment`                                                                                                                                                                                                                                                                             | Refused: split the road                                                                                                    |
| Vertical PVIs / widenings / controls | 500 / 200 / 200 per alignment                                                                                                                                         | `project.ts`, `parseAlignment`                                                                                                                                                                                                                                                                             | Refused                                                                                                                    |
| Culverts / haul sites                | 100 / 100 per alignment                                                                                                                                               | `engineeringProject.ts`, `parseEngineering`                                                                                                                                                                                                                                                                | Refused                                                                                                                    |
| Context                              | 500 features, 50,000 vertices; 10,000 per line or ring; 100 rings                                                                                                     | `project.ts`, `MAX_CONTEXT_VERTICES`, `parseContext`                                                                                                                                                                                                                                                       | Refused                                                                                                                    |
| D-lines / terrain profiles           | 100 / 20, profiles 2,000 vertices in total                                                                                                                            | `project.ts`, `parseProject`                                                                                                                                                                                                                                                                               | Refused                                                                                                                    |
| Names / IDs                          | Names 1–200 characters; IDs 1–100 of `A–Z a–z 0–9 _ . : -`                                                                                                            | `project.ts`, `text`, `id`                                                                                                                                                                                                                                                                                 | Refused                                                                                                                    |
| Latitude                             | Strictly between −85° and 85°                                                                                                                                         | `project.ts`, `coordinate`                                                                                                                                                                                                                                                                                 | Refused                                                                                                                    |
| Embedded raster                      | 2 × 2 to 4,194,304 cells; values −12,000 to 12,000 m                                                                                                                  | `terrain.ts`, `MAX_ROAD_RASTER_CELLS`, `validateRoadRaster`                                                                                                                                                                                                                                                | Refused as invalid                                                                                                         |
| Saved complete-access comparison     | Canonical input signature at most 8 MiB; 1,000 source allocations; 75,000 IDs per path list; 4,000 unique network cost items                                          | `fullCostRecord.ts`, `MAX_FULL_COST_SIGNATURE_BYTES`, `MAX_RECORD_ALLOCATIONS`, `MAX_RECORD_PATH_IDS`, `MAX_RECORD_COST_ITEMS`                                                                                                                                                                             | Adoption or project import refuses an oversized record                                                                     |
| Vertical datum text                  | 1–300 characters                                                                                                                                                      | `project.ts`, `parseTerrain`                                                                                                                                                                                                                                                                               | Refused                                                                                                                    |
| Spatial file import                  | 120,000,000 bytes; 500 features and 50,000 vertices a file; lines as roads: 20 roads, 2,000 vertices                                                                  | `spatialImport.ts`, `MAX_SPATIAL_FILE_BYTES`, `MAX_SPATIAL_FEATURES`, `MAX_SPATIAL_VERTICES`; `project.ts`, `importAlignmentGeoJson`                                                                                                                                                                       | Refused, naming the file and what to crop                                                                                  |
| Reference features                   | 500 features, 50,000 vertices; names 1–200 characters                                                                                                                 | `referenceFeatures.ts`, `MAX_REFERENCE_FEATURES`, `MAX_REFERENCE_VERTICES`                                                                                                                                                                                                                                 | Refused                                                                                                                    |
| Library JSON                         | 2,000,000 characters                                                                                                                                                  | `project.ts`, `importRoadLibrary`                                                                                                                                                                                                                                                                          | Refused                                                                                                                    |
| Autosave delay                       | 650 ms after the last edit                                                                                                                                            | `useRoadWorkspace.ts`                                                                                                                                                                                                                                                                                      | —                                                                                                                          |
| New project from a regional DEM      | A 1–10 km square around the chosen point (default 3 km); at most 64 z12 DEM tiles                                                                                     | `ProjectsDialog.tsx`; `terrain.ts` `loadRegionalTerrain`                                                                                                                                                                                                                                                   | Field clamps; error before loading                                                                                         |
| Undo history                         | 30 steps, each named; edits within 450 ms merge into one                                                                                                              | `undoHistory.ts`, `MAX_UNDO_STEPS`, `UNDO_MERGE_MS`                                                                                                                                                                                                                                                        | Oldest step dropped                                                                                                        |
| Checkpoints                          | 12 a session, names 60 characters; lost on reload or when another project opens                                                                                       | `undoHistory.ts`, `MAX_CHECKPOINTS`, `MAX_CHECKPOINT_NAME`                                                                                                                                                                                                                                                 | Oldest checkpoint dropped                                                                                                  |
| Saved sheet setups                   | 30 in this browser, names 80 characters; a file read as one up to 120,000,000 bytes                                                                                   | `sheetSetups.ts`, `MAX_SHEET_SETUPS`, `MAX_SHEET_SETUP_NAME`, `MAX_SHEET_SETUP_FILE_BYTES`                                                                                                                                                                                                                 | Saving one more is refused until one is deleted; a damaged entry is dropped                                                |
| Section and stake interval           | 20 m (nearest calculated station)                                                                                                                                     | `designExports.ts`, `landXml` / `stakeoutCsv` (`sectionStations`)                                                                                                                                                                                                                                          | Fixed                                                                                                                      |
| LandXML import                       | 50,000,000 characters; 4,000 elements an alignment; checks 7 mm, 1 mm, 0.06°                                                                                          | `landXmlImport.ts` `MAX_LANDXML_BYTES`, `MAX_LANDXML_ELEMENTS`, `LANDXML_LENGTH_TOLERANCE_M`, `LANDXML_JOINT_TOLERANCE_M`, `LANDXML_KINK_TOLERANCE_DEG`                                                                                                                                                    |
| DXF sections                         | Every 20 m (nearest calculated station), at most 500, five to a row; ticks and labels every 20 m                                                                      | `dxfExport.ts` `DEFAULT_DXF_OPTIONS`, `MAX_DXF_SECTIONS`, `DXF_SECTIONS_PER_ROW`                                                                                                                                                                                                                           |
| Plot book sheets                     | 250 m per plan-and-profile sheet; 12 sections per sheet                                                                                                               | `plotBook.ts`, `plotBookHtml`                                                                                                                                                                                                                                                                              | More sheets; no upper limit                                                                                                |
| Plot book contours                   | 256 samples on the longer side; interval from 1 m, doubled until ≤ 60,000 segments                                                                                    | `DevForestryRoads.tsx` `save`; `terrainDisplay.ts`, `MAX_CONTOUR_SEGMENTS`                                                                                                                                                                                                                                 | Coarser contours; on failure plans print "Contours unavailable" and the notice gives the reason                            |
| Report section plots                 | 240                                                                                                                                                                   | `project.ts`, `reportSections`                                                                                                                                                                                                                                                                             | Only the first 240 (4.8 km at 20 m); the report says so                                                                    |
| DBF field names                      | 1–10 capitals, digits or `_`                                                                                                                                          | `shapefile.ts`, `encodeDbf`                                                                                                                                                                                                                                                                                | Export fails                                                                                                               |
| DBF text                             | Starts at `NAME` 80 bytes, `FLAGS` 200 bytes (UTF-8); widens to fit, up to 254 bytes (`DBF_MAX_TEXT_BYTES`)                                                           | `designExports.ts`, `roadShapefileLayers`; `shapefile.ts`, `encodeDbf`                                                                                                                                                                                                                                     | Cut on a character boundary; the notice counts it                                                                          |
| DBF numbers                          | Starts at e.g. `GROUND_M` 10.2, `COVER_PCT` 7.2, `COST_CAD` 14.0; widens to fit, up to 19 characters (`DBF_MAX_NUMBER_WIDTH`)                                         | `designExports.ts`, `roadShapefileLayers`; `shapefile.ts`, `encodeDbf`                                                                                                                                                                                                                                     | Written blank; the notice counts it. Values of 10²¹ or more are always blank                                               |
| Block map sheet                      | Scales to 1:250,000; terrain raster 150 dpi, at most 4,000,000 cells; 10 m contours, at most 250,000 segments; imagery 200 dpi, 4,096 px, 30 s; 10 roads in the table | `src/lib/mapSheet/scale.ts` `MAX_SHEET_SCALE`; `prepareSheet.ts` `SHEET_RASTER_DPI`; `classedRasters.ts` `MAX_SHEET_GRID_CELLS`; `contours.ts` `MAX_SHEET_CONTOUR_SEGMENTS`; `printCapture.ts` `PRINT_CAPTURE_DPI`, `MAX_CAPTURE_SIDE_PX`, `PRINT_CAPTURE_TIMEOUT_MS`; `composeSheet.ts` `ROAD_TABLE_ROWS` | Coarsened, contour interval doubled, or refused; see the [sheet guide](../forestry-block-map-sheets.md#limits-and-budgets) |
| File name                            | Project name, non-alphanumerics to `-`, at most 70 characters                                                                                                         | `DevForestryRoads.tsx`, `save`                                                                                                                                                                                                                                                                             | Shortened                                                                                                                  |
| Saved layout name                    | 60 characters                                                                                                                                                         | `LayoutPicker.tsx`                                                                                                                                                                                                                                                                                         | Shortened                                                                                                                  |

## Built-in assumptions

### Coordinates and datums

- **Alignments are stored as WGS84 longitude/latitude.** Every projected export is computed from
  them with `exportGrid` (`terrain.ts`): the terrain's own EPSG when it is projected, otherwise
  the WGS84 UTM zone (EPSG:326xx/327xx) of the active road's first point.
- **"WGS84" is nominal for some sources.** The published LiDAR (EPSG:3157, NAD83(CSRS)) is
  converted with fixed EPSG:1946 parameters. Imported NAD83 UTM and BC Albers rasters are
  treated as if NAD83 and WGS84 were the same datum. The difference is under about 2 m in BC, but
  it is there; do not compare these lon/lat values with survey-grade WGS84 or ITRF positions.
- **Chainage is not grid distance.** Stations come from the workspace's spherical model;
  coordinates in LandXML and the stakeout file are projected. At Prince George a line measuring
  983.0 m along the road is 985.9 m between its exported UTM coordinates (0.29 %); north–south the
  difference is about 0.06 %. LandXML element lengths are grid lengths, so they agree with the
  coordinates, but its stations stay chainage (see [LandXML](#landxml)). A program that restations
  from the geometry will not reproduce the workspace's stations exactly.
- **Offsets are perpendicular to the station bearing,** negative to the left looking up-station,
  in every file.

### Bringing spatial files in

Open **Layers** on the plan, or under **View → Map layers** in the ribbon. Drop a folder or use
**Add folder** or **Add files**. The pane reads each shapefile with its matching sidecars from the
same directory, including subfolders. It also takes zipped shapefiles, GeoJSON, KML and KMZ.
Supported Canfor ArcGIS map PDFs can be added here too: a company profile reads the registered
map frame and recognized vector layers in a browser worker. The review dialog lets you select
the source-sheet preview and recovered geometry; native GIS takes priority when supplied.
See [Company source-map imports](source-pdf-import.md) for template support and measurement limits.
The import dialog assigns a role to each layer. **Reference** draws it on the plan. A line layer
can be a **Proposed road** layer. Its lines stay together in the tree, and **Copy as design road**
adds a selected line to the editable roads. A line that is already a design road, as every line
is after an import with **Load proposed roads** ticked, says so on its row (_Line · design road_)
and offers **Show design road** instead: the line stays as the road as imported, and a second copy
would only be a duplicate. Once the design road is edited the row reads _edited design road_ and
**Copy as design road** comes back, to bring the imported line in again as a new road. A polygon
layer can go into **Planned cutblocks** for access planning. The default for every layer is
**Reference**. A folded proposed-road or planned-cutblock layer names its role at the end of its
row.

Expand a folder to see its layers and expand a layer to see its features. A folder that holds
only another folder shares its row (`Zips / 2026`), and a name repeated down such a chain, as an
archive unpacked into a folder of its own name leaves, prints once. A folder around a single
file is listed as that file, with its full path in the row's tooltip. Use the eye beside a
layer to toggle it and the target beside a layer or feature to fit it. The pencil on a feature's
row renames it in place (Enter or clicking away keeps the name, Escape puts the old one back) and
the bin removes it; both show under the pointer, on keyboard focus or while the feature is
expanded. Expand a feature for its other actions and its source attributes; a feature with
neither has no arrow. **Design roads** lists the project's editable alignments. Select
a road there to make it active and fit it on the plan. Use **Delete layer** inside an expanded
imported layer to remove it in one undoable edit.

A planned cutblock layer can have one optional **Cutblock buffer**. Choose a polygon layer to use
its imported geometry, or enter a distance from 1 to 10,000 m to generate horizontal offsets
from each block. Set the buffer on import or inside the cutblock layer. The buffer sits under
that layer in the tree and has its own visibility and fit controls. **Buffer colour** applies to
its fill and outline. Choose a solid tint, diagonal hatch or crosshatch under **Buffer pattern**.
The plan legend uses the same style. It is a map overlay. Removing
the parent releases a linked source back to the layer tree. The buffer setting travels with the
project.

**Fit all layers** shows and frames the imported layers. The import fits its
extent in the current plan pane. On narrow screens, fitting a layer or feature closes the drawer
to reveal the map. Files are read in the browser. Imported geometry is saved with the road
project. Adding the same relative file path again refreshes that layer.

**Import line**, **Streams**, **Import cutblocks** and **Import existing roads** use the same
reader for GeoJSON, zipped shapefiles, KML and KMZ when the geometry is intended for design.

- **File contents determine the format.** A KMZ renamed `.zip` still reads. A design picker
  takes a shapefile ZIP. For loose shapefile parts, use **Layers** and include the projection and
  attribute files with the `.shp`.
- **Coordinates are reprojected from the file's CRS** to the WGS84 longitude/latitude the project
  stores. A shapefile's `.prj` is matched to an EPSG code by its authority tag or its UTM or BC Albers
  parameters (`epsgFromPrj`), and a code the workspace has its own definition for uses that
  definition. This matters for NAD83(CSRS): a generic reader ignores its datum shift and lands a
  line 1 to 2 m from terrain in the same CRS. GeoJSON with a named CRS the workspace knows is
  reprojected; one it does not know is refused. A shapefile without a `.prj` is read only when its
  coordinates already are longitude/latitude. The notice names the CRS that was read.
- **Names are kept.** A `name`, `NAME` or `Name` attribute, a KML placemark name, then `label`,
  `title`, `GNIS_NAME`, `Road_ID` or `Block_ID` names the feature (`spatialFeatureName`). A layer with one text column and
  no name column is named by that column. An unnamed feature takes the file's name.
- **Nothing is classified without a choice.** A picker with one purpose settles its own shape: a
  road picker's lines are roads. Features that carry a PGMaps export's `kind`, or evidence only one
  kind carries, keep it, and each picker takes only the stated kinds it is for
  (`STATED_BY_INTENT`): an exported project given to a road picker adds its roads and not a second
  copy of its streams, and roads come in only through a road picker. The notice counts what was
  left out. For everything else the import asks what the lines, polygons and points
  are (`proposeRoles`): road, existing road, stream, planned or harvested cutblock, avoidance area,
  or reference. The streams import asks unless the file reads as stream data, by Freshwater Atlas
  attributes or by what the file and its features are called. A plain polygon is never planned or
  harvested by default, so the cutblock picker asks too. The notice lists what was created.
- **Reference features** are their own project collection (`reference`, `referenceFeatures.ts`).
  Files added through **Layers** supply visual reference geometry. A named point can start a road
  (**Peg from**) or take the active road's start or end. The plan legend lists visible layers.
  On the plan their linework sits above
  the contours and under streams, constraints and every road, and their points under the road line
  (`REFERENCE_LAYERS` in `ReferenceLayer.tsx`, ordered with the plan's other layers in
  `PlanView.tsx`). The GeoJSON export writes them with `kind: "reference"`, so they import back as
  reference. The map PDF is a picture of the plan as it is on screen, so it shows them with their
  point names, and follows the plan's layer visibility. The printed report and
  the plot book draw their own figures from the design and do not include them.
- **A KML altitude or a third coordinate** is dropped: it is not ground and carries no datum. The
  exception is a GeoJSON feature that states its datum in a `referenceVerticalDatum` property, as
  the project's own GeoJSON export writes for a measured 3D line or area. Its heights are kept
  (`statesVerticalDatum`, `spatialImport.ts`), so a section component anchored to it takes its
  level from them when that datum matches the terrain's (see
  [section assemblies](section-assemblies.md)). A shapefile cannot carry that property, and the
  import has no field for stating a datum, so a 3D shapefile line comes in flat.

### While an input is invalid

An input the engine refuses (a station range the wrong way round, a ditch bottom wider than its
top) does not blank the workspace. The road is calculated with that input at its last valid value
and every other edit as entered, and `RoadAnalysis.invalidInput` names what was left out
([Sections, quantities and costs](sections-quantities-and-costs.md#while-an-input-is-invalid)).
Those results are not the current design, so each output follows one rule
(`INVALID_INPUT_RULES`, `exportCatalog.ts`):

| Rule       | Outputs                                                                                                                                       | Why                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Stamped    | Report HTML, Report PDF, Map PDF, Block map sheet                                                                                             | A person reads them, and the stamp is the first thing on the page                                              |
| Refused    | LandXML, DXF, Stakeout CSV, Plot book, Station CSV, GeoJSON, Shapefile, and the Station table, Engineering and Selected-section CSV downloads | They go to a contractor or into other software, and have nowhere to carry a notice their reader will see       |
| Unaffected | Project JSON, Map notes, Terrain surface and grid, Stream register, Fish & watershed evidence                                                 | They hold no calculated design result. The project JSON is still refused by its own validation, as noted above |

- **The stamp** on the report is a red box under the title: "Not current: this report leaves out an
  invalid input", the input's own message, and the instruction to correct it and print again. The
  Readiness checks table leads with the same statement, and Model flags repeats it. The map PDF
  carries "NOT CURRENT" and the message on its source line.
- **A stamped report prints the inputs its results came from,** not the invalid value: the template
  in the readiness table is the one the sections were calculated with (`calculatedAlignment`,
  `analysisResult.ts`).
- **A refusal names the input:** "LandXML alignment was not exported: an input is invalid, and this
  file would leave it out without saying so. … Correct it and export again." Save & export shows
  the reason on each refused row before anything is pressed. The writers refuse too
  (`refuseInvalidResults`, `inputErrors.ts`), so no other caller can produce the file.
- **A multi-road file is refused when any road it would write has an invalid input,** not only the
  road on screen.
- **A terrain profile is ground only.** Its CSV and report are written whatever the road's inputs
  are.

### LandXML

- **Version 1.2, one alignment.** The active road only, named by the project, with the terrain's
  EPSG and the vertical datum text in `CoordinateSystem`. Points are written "northing easting"
  to 3 decimals.
- **Geometry is in grid units, stations in chainage.** Each line's length is the grid distance
  between its written coordinates. An arc's radius comes from its grid chord and its deflection,
  with the centre placed from its grid ends. A clothoid's length and radii are scaled by grid chord
  ÷ model chord (`gridElement` in `designExports.ts`). The `Alignment` length is the sum of the
  grid lengths. `staStart`, PVI, ground-profile and cross-section stations stay chainage. An XML
  comment above `Alignments` says which is which and gives grid length ÷ chainage over the
  alignment: about 1.003 on an east–west road at Prince George, 1.0006 north–south, 1.0017 at 45°.
  Because each element is scaled on its own, the radius of a spiral's end and of the arc it meets
  can differ by about 0.1 %.
- **The profile is the PVI list.** The first and last PVI never carry a curve. A road without
  PVIs gets no design profile element, and with no ground either the `Profile` is left out. The
  ground profile joins the stations that have ground, straight across any gap.
- **Sections are at the calculated station nearest each 20 m multiple,** plus the last station.
  With a 15 m station interval the section for 0+020 is the one at 0+015; read the `sta` attribute.
  Each has a design and a ground point list; a list with no points is omitted, and a section with
  neither is left out.
- **A missing value is never written as a number.** A point, PVI, section surface or element with
  a missing value is left out rather than written as 0.
- **3D feature lines** follow the alignment as `PlanFeatures`: one `PlanFeature` per section code
  (`CL_3D`, `EDGE_L`/`EDGE_R`, `DITCH_L`/`DITCH_R`, `CATCH_L`/`CATCH_R`), each an `IrregularLine`
  with a `PntList3D` of "northing easting elevation" at every calculated station. A station where
  the point or its level is missing ends one part and starts the next (`EDGE_L_1`, `EDGE_L_2`).
  They are the same lines as the DXF's (`sectionFeatureLines`, `designExports.ts`). They are string
  lines for CAD and machine-control software to read; no design surface (TIN) is written.

### Importing a LandXML alignment

**Import line** on the Design tab also takes a LandXML 1.0–1.2 file and brings each `Alignment` in
it in as a new road (`landXmlImport.ts`); the active road is never replaced. The file's opening
decides the reader (`isLandXml`), not its name.

- **Horizontal geometry.** `Line`, `Curve` and `Spiral` elements of `CoordGeom` are read. Each run of
  curves and spirals between tangents becomes one intersection point, where the tangents at its
  start and end meet, with the curve's radius and the spirals' length. The road engine draws
  symmetric spirals and one radius per corner, so unequal spirals take their mean and a compound or
  reverse run takes its smallest radius; the notice says so for each.
- **Grid to model.** Coordinates are converted from the file's `epsgCode` (UTM on NAD83(CSRS),
  NAD83 or WGS84, or BC Albers). Radii and spiral lengths are grid lengths, so they are scaled by
  the ratio of the road model's spherical length to the grid length along the PIs. A file without
  an EPSG code, or in degrees or Web Mercator, is refused: its coordinates are never guessed.
- **Profile.** `PVI`, `ParaCurve`, `CircCurve` (read as a parabola of the same length) and
  `UnsymParaCurve` (read as a symmetric curve of their total length). Stations are moved to the
  road's chainage: minus the alignment's `staStart`, times the road's length over the file's
  stationed length. PVIs off the road are left out and counted.
- **Checks, for information.** Each element's stated length against its geometric length within 7 mm
  (2π × 1 mm of radius error); each joint within 1 mm; each change of direction at a joint within
  0.06°, spirals included. The notice lists them for each road with the start station and the ratio
  of road chainage to file stations. An alignment is never refused on a check.
- **Units.** Metres, international feet and US survey feet.
- **What it does not read.** Cross-sections, superelevation, surfaces and feature lines. The roads
  take the active road's section template.

### DXF drawing

- **AutoCAD R12 ASCII**, written by PG Maps (`dxfExport.ts`): a HEADER with `$ACADVER AC1009`, an
  LTYPE and LAYER table, and LINE, ARC, POLYLINE (2D and 3D) and TEXT entities. R12 is the version
  every CAD and GIS program still opens.
- **Plan** in the same grid as LandXML. Lines are LINEs and circular curves are ARCs at the grid
  radius (each curve scaled to the chord between its projected ends, as in LandXML); spirals are
  polylines at 1 m. Feature lines are 3D polylines on `CL_3D`, `EDGE_L`/`EDGE_R`,
  `DITCH_L`/`DITCH_R` and `CATCH_L`/`CATCH_R`, one vertex per calculated station: design level,
  and at catch points the ground where the batter meets it. Station ticks (`STATIONS`) and labels
  (`LABELS`) every 20 m.
- **Profile and sections are drawn at true scale (1:1) below the plan**, in their own frames: the
  profile 100 m south of the plan's extent with a 5 m elevation grid and station labels, the
  sections in rows of five below it, each labelled with its station. Their coordinates are drawing
  units, not grid positions. Layers `PROF_*` and `SECT_*`.
- **A missing value breaks the line.** A run of stations or section samples with a missing level
  ends one polyline and starts the next; nothing is bridged or written as 0.
- **Text is plain ASCII**, as R12 expects: other characters in a road name become `?`.
- Refused while an input is invalid, like LandXML.

### Stakeout CSV

- **Columns:** `point, station_m, code, offset_m, easting, northing, elevation_m, ground_m,
cut_fill_m, epsg`. Cut/fill is ground minus design: positive is cut.
- **Codes:** `centreline`, `left-formation-edge`/`right-formation-edge`,
  `left-ditch-bottom`/`right-ditch-bottom` and `left-catch`/`right-catch`, one catch point per side.
- **Level is the design level, except at catch points,** where the batter meets the ground and the
  level is ground (design if ground is missing). A point with no design has a blank level, never
  ground in its place. A point with neither design nor ground is left out.
- **Missing values are blank,** in every column; numbers never print as `-0.000`.
- **Ditch bottoms appear only on cut sides** where the section reaches the ditch depth, or the
  deeper ditch a culvert dip makes (up to 4 m below the hinge).
- **It is a list of geometric points, not a survey package.** There are no reference points, no
  offset stakes, no instrument or control data and no tolerance. A surveyor needs to set out from
  control in the same CRS and datum.

### One road or every road

GeoJSON and the shapefile can hold more than one road. Save & export offers **This road** and
**All _N_ roads** for them, and starts on **This road**: a file handed to someone else then carries
the road on screen, not a superseded alternative or the starter line a project begins with
(`exportRoads`, `exportCatalog.ts`). The choice is not saved with the project. The project file
always holds every road.

### Issue stamp

The report, the map PDF and every plot-book title block print who prepared the document, the
organisation, the revision and the date of issue. Enter them in Save & export: select one of those
documents and switch its pane to **Issue stamp**. They are `project.issue` (`projectIssue.ts`), saved
in the project file.

- **A missing name or revision prints as "not recorded",** never as a blank, so an unstamped
  document cannot pass for a stamped one. The line beside the pane's tabs turns amber until both are
  entered.
- **The date of issue defaults to the day the document is made.** The report then says "(day of
  printing)". Enter a date to hold it on reissued copies.
- **Nothing increments the revision for you.** Change it each time you issue.
- **The report also prints the [readiness checks](review-and-standards.md#the-readiness-list), the
  crossing register and the design standards,** so the printed document says what was and was not
  checked, including every check that was not assessed.

### Shapefile

- **Three layers, written without a GIS library.** Point and PolyLine geometry, dBase III tables,
  a WGS84 `.prj` and a `UTF-8` `.cpg`. Elevations are attributes, never Z.
- **Fields:** `road_centrelines`: `NAME, LENGTH_M, MAXGRADE, CUT_M3, FILL_M3, COST_CAD,
COVER_PCT`. `road_stations`: `STATION_M, GROUND_M, DESIGN_M, GRADE_PCT, CUT_M2, FILL_M2,
FLAGS`. `road_culverts`: `NAME, STATION_M, DIAM_M, COVER_M, COST_CAD`.
- **Unknown values are blank, not zero.** A GIS may read a blank number as 0 or as null; check
  which before summing.
- **Fields widen to fit** (`encodeDbf` in `shapefile.ts`), numbers up to 19 characters and text up
  to 254 bytes. A number still too wide, or of 10²¹ or more, is written blank, and text still too
  long is cut on a character boundary. Either way the notice reads "Shapefiles downloaded with _N_
  field warnings: …", naming the layer, field and number of records.

### Plot book

- **Each plan sheet is fitted, not drawn at a stated scale.** The plan is rotated so the
  window's first-to-last chord runs left to right and scaled to fit the frame, so the scale
  changes from sheet to sheet (the last, shorter sheet is larger). Use the scale bar; "250 m per
  sheet" in the title block is the window length, not a scale.
- **The profile is exaggerated by a different amount on each sheet,** because its height is
  fitted to that window's elevation range. Each auto-fit sheet prints the exaggeration it is drawn
  at ("2.9× on this sheet"); before 13 November 2026 it printed the setting, 1×, whatever was
  drawn. Compare grades by their labels, not by eye across sheets.
- **Cross-sections are drawn at equal horizontal and vertical scale** inside each cell ("1:1"
  means that, not a print ratio), and each cell has its own scale.
- **Contours come from the active terrain** over the road's extent plus 0.002°, sampled at 256
  points on the longer side. The interval starts at 1 m and doubles to stay under 60,000
  segments. Each plan prints the interval, the index interval (5 ×) and the sample-grid spacing
  (`contourNote` in `plotBook.ts`), and where the terrain's own cells are coarser than that grid
  it names them ("from a 10.9 m sample grid of 22.4 m terrain"): contours finer than the terrain
  are interpolation, not detail. On a long road the contours are generalized well beyond the
  terrain's resolution. Without contours each plan prints "Contours unavailable", and when the
  contour build failed the notice reads "Plot book downloaded without contours (…)".
- **Every sheet's title block carries the issue stamp:** the revision, the date of issue and who
  prepared it, with the terrain source and "Preliminary planning geometry · not for construction".
  A field too long for its box is set smaller first (down to 70 %) and shortened with "…" only
  past that. See [Issue stamp](#issue-stamp).
- **Paper is A3, A4, tabloid 11 × 17 in (ANSI B) or ANSI D 22 × 34 in, all landscape**
  (`REPORT_PAPERS`, `reportSettings.ts`). Every sheet is drawn 1,123 units high; A3 and A4 keep
  the original 1,587-unit width and tabloid and ANSI D are 1,736 units wide, the 17 : 11
  proportion. Plans, profiles, tables and the title block take the extra width; nothing moves
  vertically. Type is sized to the drawing, so ANSI D prints it twice as large as tabloid. At a
  fixed print scale the sheet holds its printable width of road: at 1:1,000 about 380 m on A3,
  395 m on tabloid and 789 m on ANSI D. Print at 100 % on the chosen paper; the page size is set
  in the file (`@page`), but some browsers still need the paper picked in their print dialog.
- **Plot book PDF prints the same sheets as vector pages** on the chosen paper (`plotBookPdf.ts`,
  through svg2pdf.js), so its text is selectable. jsPDF's standard fonts are WinAnsi Helvetica in
  normal and bold: labels are folded through `pdfText`, and a weight of 600 or more prints bold.
  The HTML plot book stays for printing from a browser.
- **Station labels stay inside the plan frame:** the window's first and last labels are moved in
  from the frame's edge rather than clipped. Grade labels sit above the higher of the ground and
  design lines, and the mass-haul strip starts below the profile's station labels.
- **A click on a preview sheet opens that chapter's settings,** and a click on a title block
  opens the issue stamp (`previewPick.ts`). The Preview / Sheet setup / Issue stamp switch does
  the same from the keyboard.

### Printed report

- **You choose the sections it prints.** Save & export → Report → **Contents** has a checkbox per
  optional section (`REPORT_SECTIONS`, `reportContents.ts`), and the choice is saved in the
  project's `reportSettings.omittedSections`; the HTML and the PDF report both follow it. The
  title, issue stamp, a "Not current" stamp, the status and totals, terrain and assumptions, and
  quantity basis and limitations always print. A print that leaves anything out says so under its
  status line, naming each section. Clicking a section heading in the preview opens Contents at
  that section. A project file from a newer version that names a section this one does not know
  still opens; the unknown name is dropped.
- **Profile and section plots are fitted to their boxes,** with different horizontal and
  vertical scales. They show shape, not true slope. Use the plot book for equal-scale sections.
- **Repeated warnings print once.** A message the model raises for every culvert prints as one
  line naming them ("Culverts 1–28: …"), with any figure that differs kept beside each
  (`groupNamedWarnings`, `reportWarnings.ts`); the culvert table cites numbered notes instead of
  repeating the sentences, and routing screens that read the same are one row naming each feature.
  One 46-page report printed the same invert sentence 74 times before this.
- **The cost breakdown uses item names, whole dollars and a per-kilometre line,** and leaves out
  items at $0, listing them under the table.
- **The PDF report right-aligns columns of quantities, prints each list item on its own line
  (numbered lists keep the numbers tables cite), keeps a heading with what follows it, and never
  prints a `<style>` block as text** (`exportReportPdf`, `pdf.ts`).
- **The Map PDF prints the current plan view.** It leaves out the on-map attribution box (the
  footer lists every source's credit). On the plan the compact attribution stays folded to its ⓘ
  until opened (`keepAttributionFolded`, `src/components/ui/map-attribution.ts`), and culvert labels
  that would overlap fold to their Ø mark until zooming gives them room (`planLabelRoom.ts`); the
  selected and flagged culverts keep theirs first.
- **An adopted complete-access comparison has a separate total.** The report keeps the
  covered construction estimate and engineering ledger, then shows the saved complete access
  cost, assessment date, current/stale input status, component costs, material allocations,
  loaded/empty-return path IDs and adoption-time road/source evidence. Do not add the two totals.
  A stale comparison retains its original evidence and is labelled for recalculation.
- **GeoJSON alignment properties keep the same distinction.**
  `covered_construction_estimate_cad` is the calculated engineering estimate;
  `complete_access_cost_cad`, `complete_access_cost_as_of` and
  `complete_access_cost_status` identify an adopted snapshot when present.
  `complete_access_cost` contains its ledger, source/path IDs and decoded reviewed inputs,
  including dated road evidence and terrain metadata without raster cells. Current means exact
  model inputs and `FULL_COST_MODEL_VERSION` match, not field verification. A changed cost or
  eligibility model must bump that version; legacy or unfamiliar versions remain readable and
  are stale. The project JSON retains the canonical input
  signature and is the editable restoration format; GeoJSON import does not restore a comparison.

### Autosave and restore

- **Projects are kept in a library in this browser.** **Projects** in the header lists them with
  their terrain, road count and last edit; open, duplicate or delete one there (the open project
  cannot be deleted). **New project** starts from a regional DEM around a chosen place (a square
  1–10 km wide, recorded as the terrain's `bounds` so a reopened project loads the same square),
  an imported GeoTIFF/LAS/LAZ, the BC LiDAR sample or the training example, and asks for the job's
  [design standards](review-and-standards.md#design-standards) with starting values filled in. The
  new project records them as confirmed that day, and its first road takes the running-surface
  width and the design vehicle. A project always holds
  at least one road, so the first three start with a straight 300 m road (`starterAlignment`) to
  drag or replace; the BC sample brings its example road. Opening a project file, and the sidebar's
  **Training example**, start a new project too; the one that was open stays saved.
- **A project file whose name matches a saved project asks first.** **Replace saved project** opens
  the file in that project's place, overwriting the version in this browser. **Keep both** opens it
  under the next free numbered name, such as "Block 12 spur (2)" (`distinctProjectName`,
  `roadLifecycle.ts`). Names are compared exactly; the file's content is not compared.
- **Autosave writes the whole validated project to IndexedDB** (`pgmaps-forestry-roads-v1`, key
  `project:<id>`, listed under `library`, with `active` naming the one to reopen;
  `projectLibrary.ts`) 650 ms after each edit, embedded raster included. Switching projects saves
  the open one first. A pre-library save under `current` moves into the library on first load.
- **The header says which project is open and where it is kept.** The project's name sits beside
  the heading; click it to rename the project. Under it, one line gives the browser save and its
  time and whether a project file holds the same thing: "Saved in this browser 14:02 · not yet saved
  to a file", "· file saved 13:58" or "· not saved to a file since 13:58" once the project has
  changed (`saveState.ts`). A file counts when it was saved with **Save** or opened in this session;
  the workspace cannot see a file saved in an earlier session. A refused save reads "Not saved in
  this browser", and inputs that cannot be saved read "Last valid version kept". A red dot beside
  the buttons marks both, in the same words, for a header too small to show the line; the state is
  said once, not in a second wording. Below a wide desktop (1280 px) the line uses its short form,
  "Saved 14:02 · no file", and the project name and that line keep a floor of 12 rem beside the
  road switcher, so both stay readable down to the 768 px tablet width without the header growing
  a row (`workspace.css`, `.road-workspace-heading`). A notice takes the line's place for eight
  seconds; when it is longer than the line, an (i) beside it shows the whole message.
- **A reload says what it reopened.** "Previous session restored", with the project's name and the
  time of its save, shows once in the notification stack. A first visit opens an example road and
  says so, with **New project** and **Open a project file** on the card.
- **An invalid edit does not overwrite the last valid save.** The message names the problem.
- **Autosave pauses while an error banner is shown,** and while the workspace is busy. Dismiss
  the banner to resume.
- **One tab per project.** Two tabs with the same project open write the same key; the last edit
  wins with no warning.
- **Private windows and quotas.** Where IndexedDB is unavailable or full, autosave fails with the
  "unavailable" message and the previous save, if any, remains. In a private window the save is
  discarded when the window closes. A project with a large embedded raster is the most likely to
  hit a quota.
- **`?example=training` saves under a separate key (`training`) but never restores from it,** by
  design: training mode always starts fresh from the synthetic hillside, and its saves never
  touch the library. Opening a project, starting a new one or importing data leaves that temporary
  session, removes `example=training` from the URL and saves the adopted project in the normal
  library. Reload then restores that project; the other projects in the library are retained.
- **A restore that fails changes nothing.** The current project stays, undo history is kept, and
  the message says what is missing. If the saved project cannot be restored when the page opens,
  the training hillside is shown, the saved project is left untouched and autosave stays off
  until you open a project, import a file or load terrain. That work then saves as a new project,
  so the save that could not be restored stays in the library to retry once the cause is fixed
  (for example the network, for published LiDAR).
- **Unknown fields are dropped.** Parsing rebuilds the project from the fields it knows. A file
  edited by hand or written by a newer version loses anything extra on the next save.

### Restoring terrain

| Terrain           | Stored in the project                                                         | On restore                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Imported GeoTIFF  | Every cell, its EPSG, origin, pixel size, datum, SHA-256 of the original file | Cells validated; metadata, datum and resolution must agree with them or the file is refused                                           |
| Imported LAS/LAZ  | The gridded ground surface, with the SHA-256 of the point-cloud file          | As for a GeoTIFF. The cloud itself is not stored, so the surface cannot be regenerated from the file                                  |
| Published LiDAR   | HTTPS URL and SHA-256 of `dtm-1m.tif`                                         | Downloaded; refused on a hash mismatch ("Source raster hash mismatch"). Needs the network                                             |
| Regional DEM      | Name and resolution only                                                      | Re-downloaded for the alignments' extent + 0.001°, with no checksum. It can differ from the original if the tiles or the road changed |
| Training hillside | Nothing                                                                       | Recomputed                                                                                                                            |

The embedded checksum identifies the file you imported. It is not recomputed from the stored
cells, so it records provenance, not integrity of the cells in the JSON.

### Saved sheet setups

The plot book's and the block map sheet's Sheet setup panes start with **Saved setups**
(`SheetSetupLibrary.tsx`, `sheetSetups.ts`, schema `pgmaps-sheet-setup-v1`).

- **A setup is an office standard, not a project's sheet.** It keeps the plot book's paper,
  chapters, ranges, scales, subviews, labels and report contents, and the block sheet's sheet,
  paper, scale and typed fields. It never keeps the block a sheet shows or its access comments.
- **Save current setup as** stores both parts under a name in this browser's `localStorage`
  (`pgmaps.forestryRoads.sheetSetups`); a name already used (ignoring case) is replaced.
  **Apply** sets every part the setup holds on the open project, keeping its block and comments,
  and says what it changed. Undo takes back the plot-book part; the block sheet's settings are
  per browser and are not in the undo history.
- **Download** writes the setup as `<name>.sheet-setup.json`; **Import** reads one, or a project
  file, whose plot-book settings become a setup named "<project> plot book". A project file
  without plot-book settings of its own has nothing to read and says so.
- **A damaged library entry is dropped,** not the library. A setup with an invalid plot book is
  refused whole, with the reason.

### Edit history and checkpoints

- **Every undo step has a name.** The clock button beside Redo lists the last 30 steps, newest
  first, each named by what it changed ("Spur A: moved point 3", "Spur A: PVI 2 moved to
  0+412.0", "Deleted road Spur B", "Issue stamp"; `projectChangeLabel.ts`). A name is worked out
  by comparing the project before and after the step when the list opens, so it costs nothing
  while you edit. Several changes at once read "… and 2 other changes".
- **Choosing a step goes back or forward to it in one move** (`travel`, `undoHistory.ts`). Steps
  after it stay available to redo until the next edit. A step whose terrain cannot be rebuilt
  without re-importing is refused, as Undo refuses it.
- **A checkpoint names the project as it is now.** Returning to one is itself an edit, named
  "Returned to checkpoint …", so Undo takes you back. Checkpoints hold the project in memory: they
  are not in the project file and are lost on reload or when another project opens. To keep a
  version, duplicate the road or download the project file.

### Saved layouts

Screen layouts, their pane sizes and the station table's hidden columns are kept in this
browser's `localStorage` (`pgmaps-road-saved-layouts`, `pgmaps-road-layout`,
`pgmaps-road-panes:…`, `pgmaps-road-station-columns`). These presentation preferences are not in the project file, do not
follow you to another browser and are lost with site data or at the end of a private session.
Write failures are ignored; the layout falls back to its defaults.

Drainage settings and compact review evidence are saved in project `drainage`; browser
`pgmaps-road-drainage-settings` is a fallback for older projects only. The compact record includes
source/run provenance, catchment/watershed geometry and crossing/culvert metrics; full flow grids
are recomputed. The Drainage panel exports current GeoJSON and evidence JSON; the road report
includes status, settings, source and retained checks. Stale evidence cannot be exported as current,
and unchecksummed regional terrain needs a fresh run after reopening.

## How problems show up

| Symptom                                                       | Likely cause                                                             | What to do                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| "Finish or close the design preview before exporting"         | A draft, peg or template preview is open                                 | Finish or cancel it                                                        |
| Save refuses with a validation message                        | The current inputs are invalid                                           | Correct the named field; autosave still holds the last valid version       |
| "… was not exported: an input is invalid"                     | The results leave out an invalid input and this file cannot say so       | Correct the input the message names; print the stamped report meanwhile    |
| A red "Not current" box at the top of the report              | The report was printed while an input was invalid                        | Correct the input and print it again before relying on it                  |
| "This project needs its original terrain GeoTIFF re-imported" | A GeoTIFF project without embedded cells                                 | Import the original GeoTIFF, then open the project                         |
| "Source raster hash mismatch"                                 | The published LiDAR file changed since the project was saved             | The project cannot be restored on that terrain; do not substitute another  |
| Regional project reopens with different elevations            | Tiles re-downloaded, or the road's extent changed                        | Compare against your exported results; regional numbers are screening only |
| Shapefile lands 1–2 m off a survey layer                      | Datum treated as WGS84, or survey in another datum                       | Reproject the survey; do not rely on sub-2 m agreement                     |
| LandXML stations differ from lengths over a long road         | Element lengths are grid; stations are spherical chainage                | Expect up to about 3 m per km east–west; read the ratio in the XML comment |
| A point, PVI or section missing from LandXML or stakeout      | Its value was missing, so it was left out                                | Check coverage at that station                                             |
| Blank `GROUND_M` or `COST_CAD` in the shapefile               | Unknown value, or a field warning in the notice                          | Use the station CSV, which has no width limit                              |
| "Building the plot book…" or "Building the shapefiles…" stays | The file is still being built; its own notice or error follows           | Wait for "… downloaded" or read the error banner                           |
| Plans print "Contours unavailable"                            | The contour build failed (the notice gives the reason) or found none     | Check the terrain covers the road; re-export                               |
| Work missing after reopening the browser                      | Private window, cleared site data, another tab's save, or another device | Open your downloaded project JSON                                          |
| "Last valid save retained: …" in the header                   | The current edit is invalid                                              | Correct it; nothing is lost until you do                                   |
| The report misses a section                                   | It was left out in Report → Contents; the status line names it           | Tick it in Contents and print again                                        |
| "This browser keeps 30 sheet setups"                          | The library is full                                                      | Delete a setup, or download it first                                       |
| A plot book prints shrunk or clipped                          | The browser's print dialog has another paper or "Fit to page"            | Pick the sheet's paper and 100 % scale in the print dialog                 |
| A checkpoint is gone                                          | The page was reloaded or another project opened                          | Checkpoints last one session; save versions as roads or project files      |

## What it does not do

- **No native RoadEng, Civil 3D or DWG project.** Open handoff includes LandXML alignment/profile/sections,
  an R12 DXF drawing, and terrain surfaces, ASCII grids and GeoJSON, shapefile, KML and KMZ import;
  product-specific corridor objects are not reconstructed. A DXF or DWG cannot be imported: a file
  geodatabase, GeoPackage, DWG or DXF has to be exported to one of those first.
- **No instrument-specific construction stakeout package.** Portable survey field books, traverse reduction,
  closure adjustment, side shots and CSV exports are available; instrument/control workflows remain separate.
- **No projected shapefile.** Reproject in a GIS if you need grid coordinates.
- **No full drainage raster output.** Project/evidence exports retain compact review geometry and
  metrics, not accumulation, fill-depth or direction grids.
- **No per-chart PNG or PDF export.** Print the HTML to PDF.
- **No cloud sync, sharing or version history.** Undo, its named history and checkpoints are in
  memory and lost on reload; the downloaded project JSON is the record.
- **No migration between schema versions.** Only `pgmaps-road-project-v1` opens.
- **Nothing is for construction.** The plot book, report and LandXML all say so. Construction
  drawings and set-out need field survey and the professional sign-off your jurisdiction
  requires.

### Prepared-ground sections

LandXML cross-sections retain **Ground** as the original observations and add a distinct
**Prepared ground** surface where stripping or key excavation changed the construction base.
**Design** remains the designed subgrade/section. Missing elevations split each surface into contiguous named parts rather than connecting across
no-data intervals or writing zero; the same rule applies to the exported ground profile. A road
without preparation has no artificial prepared-ground surface.
The selected-section CSV also carries original and prepared elevations in separate columns.

### Provenance of the DXF drawing, feature lines and LandXML import

Written from functional specifications (Lima VVA §4.1, §8.2 and gaps G4–G6; RFLTools §11, which
notes that RFLTools draws AutoCAD entities directly and writes no DXF, and that its LandXML reader
needs each tag on its own line); no code from Lima VVA or RFLTools (GPL-3.0) was used. The DXF
layout follows Autodesk's published _AutoCAD Release 12 DXF reference_, and the LandXML elements
the landxml.org 1.2 schema. Unlike Lima, spirals are drawn (densified) rather than refused, the
direction check covers spirals, and a missing elevation breaks a line rather than being
extrapolated. Unlike RFLTools, minified XML reads. The import checks reproduce the Lima
specification's T8 cases (`landXmlImport.test.ts`): 5 mm passes and 8 mm fails on a 50 m arc, a
1.5 mm joint fails, a 0.05° kink passes and 0.07° fails; and a road exported by this workspace
reads back with its radii, spiral and profile.
