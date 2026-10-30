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
- **Fix invalid inputs first.** Every export, the project JSON included, re-validates the whole
  project. A project that fails validation cannot be downloaded until the input is corrected;
  autosave keeps the last valid version meanwhile.
- **Open the file before you send it.** Check that the CRS, station range and number of features
  are what you expect in the receiving program.

## What each file contains

| File                            | Contents                                                                                                                                                                     | Coordinates                                                        | Leaves out                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Project JSON (`.road.json`)     | `pgmaps-road-project-v1`: every alignment, PVIs, templates, widenings, engineering inputs, settings, context, D-lines, terrain profiles, terrain provenance, embedded raster | WGS84 lon/lat; raster in its own EPSG                              | Calculated results, drainage runs and settings, undo history, layouts, regional DEM tiles, published LiDAR cells         |
| Library JSON                    | `pgmaps-road-library-v1`: named templates and materials only                                                                                                                 | None                                                               | Road geometry, assignments, horizons                                                                                     |
| GeoJSON                         | Every alignment's centreline with control and design properties; crossings, culvert barrels, haul sites, context, D-lines, terrain profiles                                  | WGS84 lon/lat, no Z                                                | Sections, stations, drainage. Re-importing it gives linework and names, not PVIs or templates                            |
| Station CSV                     | Every calculated station: chainage, lon/lat, ground, design, grades, radius, widths, areas, interval volumes, mass, completeness, flags, terrain provenance                  | WGS84 lon/lat                                                      | The station table's reporting interval (the CSV is always every station), section offsets                                |
| Selected-section CSV            | One station's section samples with codes, ground, design and cut/fill                                                                                                        | WGS84 lon/lat                                                      | Other stations                                                                                                           |
| Engineering CSV                 | Material quantities, culvert inventory, haul movements, itemized costs                                                                                                       | Chainage only                                                      | Geometry                                                                                                                 |
| D-line CSV / HTML               | Supports, sampled profile, assumed sag and clearance                                                                                                                         | WGS84 lon/lat                                                      | Tension, load, anchors                                                                                                   |
| LandXML 1.2 (`.xml`)            | Active road only: lines, arcs and clothoid spirals; PVI profile with parabolic curves; ground profile; design and ground cross-sections about every 20 m                     | Terrain's projected EPSG, else WGS84 UTM zone of the first point   | Other alternatives, surfaces (TIN), feature lines, superelevation, template/corridor model, ditches as objects, culverts |
| Stakeout CSV                    | Active road, about every 20 m: centreline, formation edges, ditch bottoms (cut only) and catch points with offset, grid coordinates, level, ground and cut/fill              | Same as LandXML                                                    | Reference or offset stakes, instrument data, point descriptions for a data collector                                     |
| Shapefile (`-shapefiles.zip`)   | `road_centrelines` (every road), `road_stations` and `road_culverts` (active road only), each with `.prj` and `.cpg`                                                         | WGS84 lon/lat (`GCS_WGS_1984` `.prj`), 2D                          | Sections, catch lines, sites, context, drainage, elevations as Z                                                         |
| Plot book (`-plot-book.html`)   | Active road: A3 plan-and-profile sheets every 250 m with mass haul, then cross-section sheets of twelve every 20 m; title block on each                                      | Plan drawn in grid metres, rotated to the road; no coordinate grid | Culverts, curve data, PI table, legend, a fixed print scale                                                              |
| Printed report (`-report.html`) | Active road summary, profile, full station table, crossings, materials, culverts, haul, costs, provenance, assumptions, and up to 240 section plots every 20 m               | Chainage                                                           | Drainage, plan view, LandXML-level geometry                                                                              |

The plot book and report are self-contained HTML with no scripts or network resources. Open
them and use the browser's **Print / Save as PDF**; set the paper to A3 landscape for the plot
book.

## Limits and budgets

| Limit                                | Value                                                                                                                         | Enforced in                                                                | What happens when exceeded                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Project file                         | 120,000,000 bytes (file) / characters (text)                                                                                  | `DevForestryRoads.tsx` `importFile`; `project.ts` `parseProject`           | Refused                                                                                         |
| Schema                               | `pgmaps-road-project-v1` exactly                                                                                              | `project.ts`, `parseProject`                                               | Refused: "Use a pgmaps-road-project-v1 project file"                                            |
| Alignments                           | 1–20                                                                                                                          | `project.ts`, `MAX_ALIGNMENTS`                                             | Refused                                                                                         |
| Horizontal points                    | 2,000 in the project (and per alignment)                                                                                      | `project.ts`, `MAX_POINTS`                                                 | Refused                                                                                         |
| Alignment length                     | 100 km                                                                                                                        | `project.ts`, `parseAlignment`                                             | Refused: split the road                                                                         |
| Vertical PVIs / widenings / controls | 500 / 200 / 200 per alignment                                                                                                 | `project.ts`, `parseAlignment`                                             | Refused                                                                                         |
| Culverts / haul sites                | 100 / 100 per alignment                                                                                                       | `engineeringProject.ts`, `parseEngineering`                                | Refused                                                                                         |
| Context                              | 500 features, 50,000 vertices; 10,000 per line or ring; 100 rings                                                             | `project.ts`, `MAX_CONTEXT_VERTICES`, `parseContext`                       | Refused                                                                                         |
| D-lines / terrain profiles           | 100 / 20, profiles 2,000 vertices in total                                                                                    | `project.ts`, `parseProject`                                               | Refused                                                                                         |
| Names / IDs                          | Names 1–200 characters; IDs 1–100 of `A–Z a–z 0–9 _ . : -`                                                                    | `project.ts`, `text`, `id`                                                 | Refused                                                                                         |
| Latitude                             | Strictly between −85° and 85°                                                                                                 | `project.ts`, `coordinate`                                                 | Refused                                                                                         |
| Embedded raster                      | 2 × 2 to 4,194,304 cells; values −12,000 to 12,000 m                                                                          | `terrain.ts`, `MAX_ROAD_RASTER_CELLS`, `validateRoadRaster`                | Refused as invalid                                                                              |
| Saved complete-access comparison     | Canonical input signature at most 8 MiB; 1,000 source allocations; 75,000 IDs per path list; 4,000 unique network cost items | `fullCostRecord.ts`, `MAX_FULL_COST_SIGNATURE_BYTES`, `MAX_RECORD_ALLOCATIONS`, `MAX_RECORD_PATH_IDS`, `MAX_RECORD_COST_ITEMS` | Adoption or project import refuses an oversized record                                          |
| Vertical datum text                  | 1–300 characters                                                                                                              | `project.ts`, `parseTerrain`                                               | Refused                                                                                         |
| GeoJSON import                       | 20,000,000 characters, 500 features; lines: 20 roads, 2,000 vertices                                                          | `project.ts`, `features`, `importAlignmentGeoJson`                         | Refused                                                                                         |
| Library JSON                         | 2,000,000 characters                                                                                                          | `project.ts`, `importRoadLibrary`                                          | Refused                                                                                         |
| Autosave delay                       | 650 ms after the last edit                                                                                                    | `useRoadWorkspace.ts`                                                      | —                                                                                               |
| New project from a regional DEM      | A 1–10 km square around the chosen point (default 3 km); at most 64 z12 DEM tiles                                             | `ProjectsDialog.tsx`; `terrain.ts` `loadRegionalTerrain`                   | Field clamps; error before loading                                                              |
| Undo history                         | 30 steps; edits within 450 ms merge into one                                                                                  | `useRoadWorkspace.ts`, `commit`                                            | Oldest step dropped                                                                             |
| Section and stake interval           | 20 m (nearest calculated station)                                                                                             | `designExports.ts`, `landXml` / `stakeoutCsv` (`sectionStations`)          | Fixed                                                                                           |
| Plot book sheets                     | 250 m per plan-and-profile sheet; 12 sections per sheet                                                                       | `plotBook.ts`, `plotBookHtml`                                              | More sheets; no upper limit                                                                     |
| Plot book contours                   | 256 samples on the longer side; interval from 1 m, doubled until ≤ 60,000 segments                                            | `DevForestryRoads.tsx` `save`; `terrainDisplay.ts`, `MAX_CONTOUR_SEGMENTS` | Coarser contours; on failure plans print "Contours unavailable" and the notice gives the reason |
| Report section plots                 | 240                                                                                                                           | `project.ts`, `reportSections`                                             | Only the first 240 (4.8 km at 20 m); the report says so                                         |
| DBF field names                      | 1–10 capitals, digits or `_`                                                                                                  | `shapefile.ts`, `encodeDbf`                                                | Export fails                                                                                    |
| DBF text                             | Starts at `NAME` 80 bytes, `FLAGS` 200 bytes (UTF-8); widens to fit, up to 254 bytes (`DBF_MAX_TEXT_BYTES`)                   | `designExports.ts`, `roadShapefileLayers`; `shapefile.ts`, `encodeDbf`     | Cut on a character boundary; the notice counts it                                               |
| DBF numbers                          | Starts at e.g. `GROUND_M` 10.2, `COVER_PCT` 7.2, `COST_CAD` 14.0; widens to fit, up to 19 characters (`DBF_MAX_NUMBER_WIDTH`) | `designExports.ts`, `roadShapefileLayers`; `shapefile.ts`, `encodeDbf`     | Written blank; the notice counts it. Values of 10²¹ or more are always blank                    |
| File name                            | Project name, non-alphanumerics to `-`, at most 70 characters                                                                 | `DevForestryRoads.tsx`, `save`                                             | Shortened                                                                                       |
| Saved layout name                    | 60 characters                                                                                                                 | `LayoutPicker.tsx`                                                         | Shortened                                                                                       |

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
  fitted to that window's elevation range. Compare grades by their labels, not by eye across
  sheets.
- **Cross-sections are drawn at equal horizontal and vertical scale** inside each cell ("1:1"
  means that, not a print ratio), and each cell has its own scale.
- **Contours come from the active terrain** over the road's extent plus 0.002°, sampled at 256
  points on the longer side. The interval starts at 1 m and doubles to stay under 60,000
  segments. Each plan prints the interval, the index interval (5 ×) and the sample-grid spacing
  (`contourNote` in `plotBook.ts`); on a long road the contours are generalized well beyond the
  terrain's resolution. Without contours each plan prints "Contours unavailable", and when the
  contour build failed the notice reads "Plot book downloaded without contours (…)".
- **Every sheet says "Preliminary planning geometry · not for construction".**

### Printed report

- **Profile and section plots are fitted to their boxes,** with different horizontal and
  vertical scales. They show shape, not true slope. Use the plot book for equal-scale sections.
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
  an imported GeoTIFF/LAS/LAZ, the BC LiDAR sample or the training example. A project always holds
  at least one road, so the first three start with a straight 300 m road (`starterAlignment`) to
  drag or replace; the BC sample brings its example road. Opening a project file, and the sidebar's
  **Training example**, start a new project too; the one that was open stays saved.
- **Autosave writes the whole validated project to IndexedDB** (`pgmaps-forestry-roads-v1`, key
  `project:<id>`, listed under `library`, with `active` naming the one to reopen;
  `projectLibrary.ts`) 650 ms after each edit, embedded raster included. Switching projects saves
  the open one first. A pre-library save under `current` moves into the library on first load. The
  header shows "Saved on this device", "Local save unavailable — download your project" or "Last
  valid save retained: …". Below the `xl` breakpoint it shows a small dot instead, whose tooltip and
  label carry the text.
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
  touch the library.
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

## What it does not do

- **No native RoadEng, Civil 3D or DWG project.** Open handoff includes LandXML alignment/profile/sections
  and terrain surfaces, ASCII grids and KML/KMZ import; product-specific corridor objects are not reconstructed.
- **No instrument-specific construction stakeout package.** Portable survey field books, traverse reduction,
  closure adjustment, side shots and CSV exports are available; instrument/control workflows remain separate.
- **No projected shapefile.** Reproject in a GIS if you need grid coordinates.
- **No full drainage raster output.** Project/evidence exports retain compact review geometry and
  metrics, not accumulation, fill-depth or direction grids.
- **No per-chart PNG or PDF export.** Print the HTML to PDF.
- **No cloud sync, sharing or version history.** Undo is in memory and lost on reload; the
  downloaded project JSON is the record.
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
