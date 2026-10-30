# Terrain and point clouds: limits and checks

Every elevation, grade, section and volume in `/dev/forestry/road-design` is read from one terrain
source. This guide is for road planners and developers who need to know when that ground can be
trusted, what to check after loading or importing it, and what the tool assumes without telling
you. The loaders and samplers are specified in the
[workspace contract](../forestry-road-design.md#terrain-choices); this page is the practical
companion.

## Before you rely on the terrain

- **Name the source.** The terrain name in the Terrain tab and the report says which source is
  active. The training hillside is synthetic. The regional DEM is screening only. Only the
  published 1 m LiDAR, or ground you imported and checked yourself, supports site-level numbers.
- **Confirm the vertical datum.** The tool records the datum text; it never converts between
  datums. For a GeoTIFF you must type it. For LAS/LAZ, a value in the "Imported DEM vertical
  datum" field **overrides** the file's own vertical key, so clear the field (or correct it)
  if it still holds text from an earlier import. Breakline heights, vertical controls and any
  survey you compare against must be in the same datum.
- **Confirm the units are metres.** GeoTIFF vertical units are checked only when the file
  declares them. LAS/LAZ heights are never checked: a cloud in feet imports as metres.
- **Check that it sits in the right place.** Look at the hillshade against the basemap's roads
  and streams. The map fits to your alignments, not to the new terrain, so zoom out if nothing
  appears after an import.
- **Keep the road inside the footprint.** The alignment _plus_ the section half-width (35 m by
  default) must be inside the terrain's data. Read the coverage: below 100 % means part of the
  road is missing from every total (see
  [Geometric quantities and coverage](../forestry-road-design.md#geometric-quantities-and-coverage)).
- **Read the import summary for a point cloud.** It gives ground and total points, whether the
  cloud was thinned, whether ground was classified here and how long it took, the grid size and
  cell, the breakline segments held and skipped, and the cells left missing. A cell larger than
  1.00 m, a low ground share or many missing cells all need an explanation before you go on.
- **Look at the slope and hillshade layers for artefacts:** pits or spikes (undeclared no-data),
  flat smooth patches (cell-mean gap fill), long straight facets (TIN across sparse ground),
  shrub-like bumps (vegetation kept as ground).
- **Make sure it is bare earth.** The tool cannot tell a DSM or canopy surface from ground by
  its values. Check the source description.
- **Do not treat the draft LiDAR line as a road.** "Draft alignment on real LiDAR · review
  required" is a line across the tile so the views have something to show.
- **Record what you did.** The project keeps the gridded result and the input file's checksum,
  not the classification choice or the breakline file. Note those yourself, and download the
  project rather than relying on autosave (see [Exports and project files](exports-and-project-files.md)).

## Choosing a terrain source

### The scenario library

**Projects → Browse example scenarios** opens nine editable examples. Prince George uses the verified
native 1 m LiDAR tile. Tabor Mountain, Kamloops, Vernon and Smithers use their own regional DEMs and
geographic extents, for corridor screening only. The four offline training scenes cover the hillside,
reuse of an assumed old road, local gravel with zero acquisition cost, and connected full-cost access.
Their roads, blocks, road
conditions and material availability are synthetic inputs.

Each real landscape requests nearby public FTEN road-tenure sections and consolidated harvest openings.
These layers can be empty at a place, and FTEN is not an inventory of every built road. A failed or
over-budget layer is reported, with no invented replacement. Loading a scenario creates a new project
after its terrain and sampled road-section corridor have passed the coverage check; it leaves the
previous project saved. The library uses the same native analytical sampler in the plan, profile,
sections and 3D preview. It never swaps in training terrain when a real source fails.

The Terrain tab retains the scenario's initial sampled ground coverage and any public-context load
warnings after the toast disappears and after save/reopen. This records the initial load, not the
completeness of later edits: check the current section completeness in the summary. Terrain coverage
does not prove that a batter daylights or a road meets the grade limit. Regional draft alternatives
use a bounded orientation screen and terrain-sampled starting profiles; they still require review.

| Source                                                                    | Resolution                                   | Good for                                                    | Not for                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Training hillside](../forestry-road-design.md#offline-training-hillside) | Analytic function, labelled 1 m              | Learning the tool offline (`?example=training`)             | Any real location or quantity                                               |
| [Published BC LiDAR](../forestry-road-design.md#published-bc-lidar)       | Native 1 m DTM, EPSG:3157, CGVD2013          | Preliminary design inside tile 093G086                      | Anywhere outside that one tile; survey accuracy                             |
| [Imported GeoTIFF](../forestry-road-design.md#imported-geotiff)           | Native cells, as supplied                    | Your own bare-earth DEM, cropped to the corridor            | DSMs, rotated or non-metre rasters, rasters over the cell budget            |
| [Imported LAS/LAZ](../forestry-road-design.md#imported-las-and-laz)       | About 1 m grid from ground points            | Corridor clouds, with breaklines for ditches and road edges | Full-density reprocessing, classes other than ground, a TIN kept for export |
| [Regional DEM](../forestry-road-design.md#regional-dem)                   | Zoom-12 Terrarium tiles, about 22 m at 54° N | Corridor screening where no LiDAR exists                    | Earthwork quantities, ditches, culvert cover, any datum-sensitive check     |

## Limits and budgets

| Limit                                 | Value                                                                           | Enforced in                                                                            | What happens when exceeded                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GeoTIFF file size                     | 64,000,000 bytes                                                                | `terrain.ts`, `loadRaster`                                                             | Refused: crop first                                                                                                                            |
| GeoTIFF cells                         | 2 × 2 to 4,194,304 cells (2,048 × 2,048 at 1 m)                                 | `terrain.ts`, `MAX_ROAD_RASTER_CELLS`                                                  | Refused; no automatic downsampling                                                                                                             |
| Elevation values                      | −12,000 to 12,000 m                                                             | `terrain.ts`, `validateRoadRaster`                                                     | Whole raster refused as invalid                                                                                                                |
| Vertical datum text                   | Required; at most 300 characters                                                | `terrain.ts`, `loadRaster` / `loadLas`                                                 | GeoTIFF refused; LAS/LAZ text is cut to 300 characters                                                                                         |
| LAS/LAZ file size                     | 1,000,000,000 bytes                                                             | `terrain.ts`, `loadLas`                                                                | Refused: crop first                                                                                                                            |
| Points kept after reading             | 3,000,000                                                                       | `pointCloud.ts`, `DEFAULT_MAX_POINTS`                                                  | Thinned to one point per cell (ground first, then lowest); the summary says so                                                                 |
| Ground-filter run size                | 40,000 points per tile; one run up to 60,000                                    | `pointCloud.ts`, `classifyGround` (`tilePoints`)                                       | Larger clouds run in tiles overlapping by max(6 m, 3 × search radius)                                                                          |
| Ground-filter tile side               | 1,000 km (`MAX_TILE_SIDE_M`)                                                    | `pointCloud.ts`, `classifyGround`                                                      | A wider cloud is tiled even when it has few points                                                                                             |
| Coordinates sent to the filter        | 0.001 m steps per axis, int32 (about 2,147 km)                                  | `pointCloud.ts`, `encodeLas`                                                           | That axis coarsens tenfold (0.01 m, 0.1 m…) rather than overflow                                                                               |
| Point-cloud grid                      | 4,194,304 cells, starting at 1 m                                                | `terrain.ts` → `gridGroundPoints` (`lasSurface.ts`) / `rasterizeTin` (`tinSurface.ts`) | Cell grows by 1.25× steps until it fits; the summary and terrain name show the cell                                                            |
| Cell-mean gap fill                    | 3 passes, each needing 3 of 8 known neighbours                                  | `terrain.ts` (`gapCells: 3`), `lasSurface.ts`                                          | Wider gaps stay missing                                                                                                                        |
| TIN input points                      | 1,500,000                                                                       | `tinSurface.ts`, `MAX_POINTS`                                                          | Thinned to the lowest point per 0.5 m cell (`THIN_CELL_M`), grown by 1.25× until it fits                                                       |
| TIN triangle edge                     | 8 grid cells                                                                    | `tinSurface.ts`, `rasterizeTin` (`maxEdgeM` default)                                   | Triangle left missing                                                                                                                          |
| Breakline file                        | 50,000,000 bytes                                                                | `DevForestryRoads.tsx`, `importFile`                                                   | Refused                                                                                                                                        |
| Breakline vertex spacing              | 2 × thinning cell (1 m unless thinned)                                          | `tinSurface.ts`, `buildTin`                                                            | Longer segments get intermediate vertices                                                                                                      |
| Ground points cleared near breaklines | 0.02 m                                                                          | `tinSurface.ts`, `CLEAR_M`                                                             | Dropped from the TIN                                                                                                                           |
| Breakline height conflict             | 0.01 m at a shared vertex                                                       | `tinSurface.ts`, `densify`                                                             | Earlier line's z kept; reported in the summary                                                                                                 |
| Regional DEM request                  | 64 zoom-12 tiles (about 5.7 km each at 54° N)                                   | `terrain.ts`, `loadRegionalTerrain`                                                    | Refused: zoom in. All tiles missing is an error; some missing stay no-data                                                                     |
| Scenario corridor ground check        | 10 m station/section sampling; at most 100,000 samples                        | `scenarioCoverage.ts`, `SCENARIO_TERRAIN_STEP_M`, `MAX_SCENARIO_TERRAIN_SAMPLES`           | A missing corridor sample refuses the scenario before replacing the open project; narrow sub-sample gaps can remain                              |
| Regional scenario initialization      | 24 orientations × two alternatives, at up to two lengths; profile controls ≤60 m apart | `scenarios.ts`, `REGIONAL_SCENARIO_ORIENTATIONS`, `REGIONAL_SCENARIO_SCALES`, `SCENARIO_PROFILE_STEP_M` | Chooses a complete, lower-grade draft where available; this screen does not solve access, environmental constraints or road-network connectivity |
| Scenario public context request       | 12 seconds shared by roads and harvested areas; project limits 500 features / 50,000 vertices | `scenarios.ts`, `SCENARIO_CONTEXT_TIMEOUT_MS`, `scenarioContext`; `project.ts`      | Successful layers are kept; failed layer messages persist in the Terrain tab; over-budget combined context is refused explicitly                |
| Regional DEM extent                   | Alignment extent + 0.001°, then + 100 m                                         | `DevForestryRoads.tsx` `boundsOf`; `loadRegionalTerrain` (`demTileRange` pad)          | Ground outside the loaded tiles is missing; reload after extending the road                                                                    |
| Plan terrain preview                  | 192 samples on the longer side (helper allows 32–384)                           | `PlanView.tsx`; `terrainDisplay.ts`, `buildTerrainDisplay`                             | Display only; calculations are unaffected                                                                                                      |
| Contour segments                      | 60,000                                                                          | `terrainDisplay.ts`, `MAX_CONTOUR_SEGMENTS`                                            | Interval doubles from 1 m (2, 4, 8 m…) and the overlay shows it                                                                                |
| 3D preview mesh                       | At most 128 cells on the longer side, 129² samples; follow window 240 m         | `terrainMesh.ts`, `MAX_TERRAIN_MESH_SIDE`; `TerrainPreview.tsx`                        | Display only; known missing analysis samples identify unsupported cells                                                                        |
| 3D display gap infill                 | Enclosed components at most 80 m in width and height; 128 relaxation iterations | `terrainMesh.ts`, `MAX_DISPLAY_GAP_M`, `DISPLAY_GAP_ITERATIONS`                        | Larger and boundary-connected gaps stay open; estimated patches are labelled and can be switched off; analysis and exports retain missing data |
| 3D vertex cache                       | 65,536 finite or missing samples                                                | `terrainMesh.ts`, `MAX_CACHED_TERRAIN_VERTICES`                                        | Oldest samples evicted; fixed-grid overlaps reuse samples                                                                                      |
| Section half-width                    | 5–100 m, default 35 m                                                           | `project.ts`; `terrain.ts`, `DEFAULT_ROAD_SETTINGS`                                    | Sections that daylight beyond the terrain stay incomplete                                                                                      |
| Project JSON                          | 120,000,000 bytes (file) / characters (text)                                    | `DevForestryRoads.tsx`, `importFile`; `project.ts`, `parseProject`                     | Refused on import                                                                                                                              |

No limit above caps memory. A LAS/LAZ import reads the file once on the page, then transfers it
to the worker rather than copying it (`loadLas` in `terrain.ts`, `transfer: true`). The worker
holds the file and every point's coordinates before thinning, so a large file can still exhaust
the browser tab before the 1 GB check matters. The practical ceiling has not been measured.

## Built-in assumptions

**Sampling.** Every source is read by bilinear interpolation between the four nearest cell
centres. If any of the four is no-data, the sample is missing; nothing is averaged from the
others. The outer half cell of a raster is outside its footprint (only a 1e-6-cell rounding
tolerance is allowed). Calculated stations, sections and routing read this sampler directly,
not the plan image, contours or 3D mesh (see
[Terrain display and connected views](../forestry-road-design.md#terrain-display-and-connected-views)).

**Plan pinholes.** A missing DEM cell stays transparent in every plan image and missing in analysis.
Hillshade, slope and aspect use a supported one-sided gradient where a finite cell borders a gap,
instead of erasing that measured neighbour too. If neither side of an axis has terrain, that
gradient is unavailable. Contours still stop at missing source cells. This reduces enlarged white
pinholes without filling analytical terrain or claiming a height across a gap.

**GeoTIFF registration and no-data.** Without a `GTRasterTypeGeoKey` the raster is treated as
PixelIsArea, and the origin moves half a cell to the first cell centre. A tiepoint at nonzero
raster coordinates is first translated back to pixel (0, 0). No-data is the exact
`GDAL_NODATA` value at the sample's precision (rounded to Float32 for Float32 pixels), or a
non-finite value. A sentinel such as −9999 with no `GDAL_NODATA` tag is
inside the ±12,000 m range and is read as real ground. GeoTIFFs registered with a
`ModelTransformation` matrix are currently refused even when that matrix is north-up; re-export
using `ModelPixelScale` and `ModelTiepoint` tags before importing.

**Horizontal datum.** EPSG:3157 uses the pinned NAD83(CSRS) → WGS84 transformation from
`dev-lidar/sourceGrids.ts` (`METRIC_CRS`, a 7-parameter shift of about 2 m). The other accepted
codes are built with proj4's `NAD83` or `WGS84` datum, which proj4 treats as identical to WGS84.
Alignments are stored as WGS84 coordinates, so a line drawn on a 3157 terrain can sit up to about
2 m from the same ground when that ground is imported in BC Albers or NAD83 UTM. Recheck tight
geometry after switching between them.

**Accepted CRSs.** WGS84, Web Mercator, BC Albers (3005), NAD83 and WGS84 UTM zones 7–11, and
NAD83(CSRS) UTM 10N (3157) only (`localRaster.ts`, `rasterProjection`). BC data in NAD83(CSRS)
UTM zones 8, 9 or 11 (EPSG:3155, 3156, 2955) is refused; reproject it to EPSG:3005 or 3157 first.
For LAS/LAZ only a projected CRS is read, from the GeoTIFF keys VLR or the OGC WKT VLR (EVLRs
included). An uncompressed LAS without one is refused at once. A LAZ without one is decoded first:
the worker asks WhiteboxTools' `lidar_info` for the CRS and reports it back before the ground
filter runs, and breaklines are projected into that CRS (`readPointCloud` in `pointCloud.ts`, the
`crs` message in `pointCloud.worker.ts`). Only if that also finds none is the LAZ refused. The page
takes no vertical datum from that fallback, so for such a file type the datum unless the header
carries a vertical key.

**Vertical datum from a point cloud.** When the field is empty, the file's vertical EPSG key is
used and recorded as `EPSG:<code>; metres`. "Metres" is written, not checked.

**Ground classification.**

- "Use the file's; classify if none" runs the filter only when the cloud has **no** class 2
  points. A file where only part of the area was classified is trusted as it is; choose
  "Re-classify here" for it.
- The filter is WhiteboxTools' `lidar_ground_point_filter` with a 2 m search radius, 0.5 m height
  threshold and 65° slope threshold, slope normalisation off (`GROUND_FILTER_DEFAULTS` in
  `pointCloud.ts`). The thresholds were picked for 1–10 points/m² LiDAR on steep BC hillsides:
  65° keeps cut banks and 80–130 % slopes as ground, 0.5 m keeps shrub and slash returns out.
  They are not adjustable in the UI. For flat ground with dense low shrubs, or very sparse
  clouds, classify with your own tool and import with "Use the file's only".
- Re-classifying replaces every class except noise (7 and 18), which keeps its class and is left
  out of the filter. Only class 2 becomes ground; buildings, water and other classes are not used.
- Speed is measured, not guaranteed: the code comments record about 55,000 points a second at
  1 million points in tiles, and slower per point in larger runs.
- Thinning (above 3 million points) happens **before** classification and prefers the file's
  class 2 points in each cell. With "Re-classify here", a wrongly classified file still shapes
  which points survive thinning.

**Gridding.** The grid covers the bounding box of the ground (class 2) points only
(`gridSurface` in `pointCloud.worker.ts`), so a stray non-ground return far from the corridor
does not enlarge the grid. A stray point classified as ground still does. _Ground cell mean_ averages the
ground heights in each cell (rounded to the millimetre) and fills gaps up to three cells in from
known neighbours, which also smooths across a narrow gap from both sides (up to about six cells).
_TIN with breaklines_ keeps the lowest point where points coincide within 1 mm, takes each cell
centre's height from its triangle's plane, and leaves out triangles with an edge longer than eight
cells.

**Breaklines.**

- The file must be WGS84 GeoJSON (longitude, latitude); it is projected into the cloud's CRS.
  Lines, multi-lines and polygon rings are read; points are ignored.
- Height comes from the third coordinate, else a `z`, `Z`, `elevation`, `ELEVATION` or `elev`
  property, else it is draped on a triangulation of the ground points. That draping triangulation
  has no edge limit, so a draped line across a data gap takes heights bridged across the gap.
- A breakline is used only by the **next** LAS/LAZ import with the TIN surface. It stays loaded
  for later imports until you clear it, and it is not saved in the project.

## How problems show up

| Symptom                                                                                                     | Likely cause                                                                                                                                  | What to do                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Coverage below 100 %; stations flagged "Missing terrain inside the road footprint" or "daylight unresolved" | The road or its sections leave the footprint, or cross no-data or a gap                                                                       | Move the line inside, shorten the half-width if the template allows, or import terrain that covers the corridor               |
| Every station missing after an import                                                                       | The new terrain is somewhere else; alignments are not moved to it                                                                             | Zoom out to find the hillshade; draw or import the road there, or check the file's CRS                                        |
| Terrain appears in the wrong part of BC, or offset from basemap roads                                       | Wrong or mislabelled EPSG (zone, or NAD83 vs NAD83(CSRS))                                                                                     | Fix the CRS in the source file (GDAL, PDAL) and import again                                                                  |
| "Use WGS84, Web Mercator, BC Albers, or NAD83/WGS84 UTM zones 7–11."                                        | A CRS outside the list, including NAD83(CSRS) UTM other than zone 10                                                                          | Reproject to EPSG:3005 or 3157                                                                                                |
| "Invalid terrain raster…" for a file that opens in GIS                                                      | A no-data sentinel such as −32768 or −3.4e38, undeclared or declared with a value that does not match the cells exactly, is outside ±12,000 m | Set the no-data value in the file (for example `gdal_translate -a_nodata`)                                                    |
| Deep pits or cliffs to −9999 m                                                                              | No-data sentinel without a `GDAL_NODATA` tag                                                                                                  | Same as above, then import again                                                                                              |
| "This point cloud has no projected CRS key."                                                                | No GeoTIFF keys or WKT VLR, or a geographic CRS; for a LAZ, the decoder found none either (after reading the file)                            | Assign a projected CRS, for example with PDAL, before importing                                                               |
| "No ground-classified (class 2) points" or "Fewer than three ground points"                                 | "Use the file's only" on an unclassified cloud                                                                                                | Choose "Use the file's; classify if none" or classify externally                                                              |
| Classification takes minutes                                                                                | Millions of points; tiles of a long diagonal corridor hold more points than average                                                           | Crop to the corridor, or classify once externally and import the classified file                                              |
| Surface lifted by shrubs or slash, or hollow on steep cut banks                                             | Filter thresholds do not suit this cloud                                                                                                      | Classify externally with tuned settings and use "Use the file's only"                                                         |
| Holes in a TIN surface                                                                                      | Ground spacing wider than eight cells (dense canopy, water, no-return patches)                                                                | This is intended. The cell mean fills only three cells, so it will not close them either. Get better ground or route around   |
| Summary reports skipped breakline segments                                                                  | Line off the cloud with no z, a z conflict above 0.01 m, or an overlap Constrainautor cannot hold                                             | Add z values, clip lines to the cloud, or fix the overlapping geometry                                                        |
| Breaklines seem to have no effect                                                                           | GeoJSON not in WGS84, the surface set to cell mean, or the file loaded after the import                                                       | Reproject the GeoJSON, choose the TIN surface, and import the cloud again                                                     |
| Grid cell above 1.00 m in the summary                                                                       | Ground extent over about 2,048 × 2,048 m, or stray ground-classified points far outside the corridor                                          | Crop the cloud and remove outliers                                                                                            |
| Browser tab crashes or freezes during a LAS/LAZ import                                                      | Memory: the whole file and all points are held before thinning                                                                                | Crop or thin the cloud externally                                                                                             |
| "… returned point _k_ of _n_ in a tile _d_ m from where it was sent …"                                      | The ground filter reordered the points or changed their coordinates, so classes cannot be matched back                                        | Classify externally and import with "Use the file's only"; report the file                                                    |
| Saved project will not reopen: "needs its original terrain" or a checksum error                             | Published DTM bytes changed, the source host is unreachable, or the file was edited                                                           | There is no control to rebind a project to other terrain bytes. Keep the project JSON; a failed restore does not overwrite it |
| Regional project reopens with different ground or missing tiles                                             | Tiles are fetched again for the current alignment extent; nothing is embedded or checksummed                                                  | Check the missing-tile count in the terrain name; do not compare quantities across sessions                                   |
| Contours drawn at 2 m or 4 m                                                                                | The 1 m layer would exceed 60,000 segments                                                                                                    | Zoom the extent or accept it; calculations do not use contours                                                                |
| Drainage flow stops at the edge of a gap                                                                    | Missing cells are treated as outlets                                                                                                          | See [Drainage](drainage.md); fill the data gap first                                                                          |

## What it does not do

- Convert between vertical datums (for example CGVD28 and CGVD2013, or ellipsoidal and orthometric
  heights), apply a geoid, or convert feet to metres.
- Reproject an input raster or point cloud, or accept a CRS outside the list above.
- Mosaic several LiDAR tiles or combine sources. A project has one terrain; the published LiDAR is
  one tile, and a gap is never filled from the regional DEM.
- Downsample a GeoTIFF to fit the budget.
- Use point classes other than ground, keep the TIN as triangles, or export the gridded surface
  as a GeoTIFF (see [Scope boundaries](../forestry-road-design.md#scope-boundaries)).
- Let you change ground-filter parameters, or choose the segmentation filter `pointCloud.ts` also
  provides, from the UI.
- Record the classification choice or the breakline file in the project. The checksum identifies
  the input file, not how it was processed; two projects from the same LAS with different
  settings carry the same checksum.
- Assess accuracy. Resolution is cell spacing, not vertical accuracy, and a 1 m contour interval
  does not mean 1 m detail. The LiDAR accuracy caveats are in [LiDAR viewer](../lidar-viewer.md).
- Embed or checksum regional DEM tiles in a saved project.
