# Outdoors planner: map layers

The **Map layers** section of `/dev/outdoors` adds optional layers under the plan: satellite and
dated imagery, terrain relief, limited entry hunting zones, forest roads, rail lines, cutblocks,
a sightline guess from the forest inventory, boat launches and lake depth charts. They came from
TROPIK (ddcnorth's trip planner built on PGMaps) in November 2026 and were reworked onto PGMaps'
shared parts, so the planner and the road designer read the same sources the same way.

Which layers are on is the viewer's preference, kept in this browser
(`pgmaps.bc-outdoors-layers.v1`); it is never part of a shared plan link or an export.

Every layer is a provincial record or a satellite picture, not a statement about today's ground. A
road or rail line shown may be washed out, overgrown or gone, a launch may no longer exist, and the
sidebar says so.

## Where each layer comes from

| Layer | Source | Read through |
|---|---|---|
| Satellite imagery | Esri World Imagery | `SatelliteImagery`, shared with the road designer and visual quality |
| Dated imagery | A feed from `IMAGERY_FEEDS`: Esri Wayback releases, Sentinel-2 scenes at 10 m, or NASA GIBS's daily Landsat and Sentinel-2 passes at 30 m | The shared `ImageryTimeline` and `ImageryFrameLayers` ([imagery feeds](imagery-feeds.md)), as the road designer's Wayback timeline |
| Terrain relief | Open Terrarium elevation tiles | `RegionalReliefLayer`, shared with the road designer |
| Forest roads | Forest Tenure Road Section Lines, BCGW MapServer layer 196 | `BC_ROADS_SERVICE`, `tenureRoadClass` (`src/lib/forestry/bcForestRoads.ts`), as the designer's existing roads |
| Cutblocks | Consolidated cutblocks, BCGW MapServer layer 543 | `BC_HARVEST_SERVICE`, `bcHarvestEvidence`, `harvestHistoryStyle` (`src/lib/forestry/bcHarvest.ts`), as the designer's harvest history |
| Sightlines | VRI rank 1 (`VEG_COMP_LYR_R1_POLY`) | `BC_VEGETATION_WFS` and its box limit (`src/lib/forestry/bcVegetationWfs.ts`) |
| Limited entry zones | `WAA_LTD_HNT_ZONE_CURR_YEAR_SVW`, one species at a time | openmaps WFS |
| Draw results on a zone or unit | Limited Entry Hunting Draw Hunt Code Report (CSV, "Access Only") | `leh.ts`, read live, never stored |
| Rail lines | `GBA_RAILWAY_TRACKS_SP` | openmaps WFS (`railways.ts`) |
| Boat launches | `FTEN_REC_SITE_POINTS_SVW` sites listing a launch, and `CHRA_BOAT_LAUNCHES_POINT` | openmaps WFS, read whole once |
| Lake depth | `BATH_SURVEY_MAP_SHEETS_SVW` charts and `BATH_LAKE_BATHYMETRIC_SP` contours | openmaps WFS |

Cutblocks are aged by the road designer's rule: 0–10, 11–30 and over 30 calendar years since the
recorded harvest, and a block whose recorded years straddle a break is *Age unknown or uncertain*,
never put in the nearer class. The colours are the designer's. A record the rule cannot read is
drawn as unknown. The sightline classes (`opennessOf`, `bcLayers.ts`) are a screening rule made for
the planner, not a published standard.

The draw report's address names its last season, so the catalogue record is asked for its current
CSV on each visit (`lehCsvUrlFromPackage`, CKAN `package_show`) and the address last checked is the
fallback. Its licence is "Access Only": it is read in the browser and never copied into the
repository, a cache or an export. Open seasons are only linked, never restated.

A lake chart is a scanned PDF on `a100.gov.bc.ca`, which sends no CORS headers, so the shared PDF
viewer cannot read it. Clicking a surveyed lake opens a card listing its sheets as links that open
in a new tab. A lake chart outranks the management unit beneath it (`pickPriority`), so the click
never adds or removes the unit.

## How the layers load

Every layer read by box follows the map through `useViewWindowRead` (`docs/map-layer-loading.md`):
the next window is read while the map still moves, the superseded read is aborted, and what is
drawn stays drawn until the next answer. A layer goes off the map only below its least zoom, which
its sidebar line states. Forest roads and cutblocks ask the service to generalise their geometry to
half a pixel at the zoom they are read at (`generalisationDegrees`, `maxAllowableOffset`), so they
read again at each zoom level up to `MAX_READ_DETAIL_ZOOM`; the WFS layers read full detail and
reuse a window at every zoom it holds. Every answer goes through `readBoundedText` and is refused
past `MAX_LAYER_RESPONSE_BYTES`, never drawn in part. A view with more than a layer's cap draws
what it read and says *shown; zoom in for all*; cutblocks are read newest first, so the youngest
blocks are the ones kept.

## Limits

| Limit | Constant |
|---|---|
| Forest Service Roads from zoom 8, two pages of 1,000 | `FSR_MIN_ZOOM`, `forestRoadReads` (`bcLayers.ts`) |
| Other tenure roads from zoom 11, three pages | `ALL_ROADS_MIN_ZOOM`, `forestRoadReads` |
| Cutblocks from zoom 12, three pages, newest first | `CUTBLOCK_MIN_ZOOM`, `CUTBLOCK_READ` |
| One ArcGIS page is 1,000 features | `ARCGIS_PAGE_SIZE` |
| Geometry generalised to half a pixel, no finer than zoom 14 | `generalisationDegrees`, `MAX_READ_DETAIL_ZOOM` |
| Sightlines from zoom 13, at most 4,000 stands and 0.35° a side | `WFS_SOURCES.stands`; `MAX_VEGETATION_FEATURES`, `MAX_VEGETATION_QUERY_DEGREES` |
| Hunt zones from zoom 8, at most 400 | `WFS_SOURCES.huntZones` |
| Lake charts from zoom 7, at most 3,000 | `WFS_SOURCES.depthCharts` |
| Rail lines from zoom 7, at most 4,000, 12° a side | `RAILWAY_MIN_ZOOM`, `MAX_RAILWAY_FEATURES`, `MAX_RAILWAY_QUERY_DEGREES` (`railways.ts`) |
| Any other WFS box at most 12° a side | `MAX_BC_QUERY_DEGREES` |
| At most 16 MB in one answer | `MAX_LAYER_RESPONSE_BYTES` |
| Draw report at most 16 MB (it is about 3 MB) | `MAX_LEH_CSV_BYTES` (`leh.ts`) |
| Dated imagery | Each feed's own, in [imagery feeds](imagery-feeds.md#limits) |

## What was measured

Real Chrome on the Metal GPU, live hosts, 21 November 2026, `scripts/map-loading/measure.mjs` with
`scripts/map-loading/setups/outdoors-layers.mjs`. Before is TROPIK's version (`moveend` reads,
WFS for roads and cutblocks, a remount for each imagery day) with only its two broken imports fixed.

| Layer | Before | After |
|---|---|---|
| Cutblocks, zoom 13.2 | First read 3.1 s into a 3 s drag; up to 18% more of the view empty mid-drag | First read 0.6 s in; 6% more empty; 4 reads a drag |
| Forest roads, zoom 11.5 | First read 3.1 s into the drag | First read 0.6 s in; 8 reads a drag (two reads a window) |
| Sightlines, zoom 14 | First read 3.1 s into the drag; up to 27% more empty mid-drag | First read 0.6 s in; 2.5% more empty; 4 reads a drag |
| Rail, hunt zones, lake charts, zoom 10 | Not measured | Never gone; 4 reads a drag; none on a zoom-in inside the window |
| Dated imagery, four date steps (both feeds) | Gone on every frame of each day change | Never gone; the old date stays until the new one has tiles |

## Dated imagery

**Dated imagery** draws one feed at a time under the labels, over the undated photo, with the shared
timeline strip along the map's bottom. The sidebar chooses the feed (`IMAGERY_FEEDS`); the choice is
this browser's (`pgmaps.bc-outdoors-imagery-feed.v1`), NASA's daily passes by default, as TROPIK had.
Choosing another feed keeps the last picture drawn until the new feed's newest date has tiles.
Closing the strip switches the layer off. A new feed added to `IMAGERY_FEEDS` appears in the chooser
with nothing else to change here.

## Tests

`tests/e2e/outdoors-layers.spec.ts` runs the planner against stubbed DataBC, catalogue, NASA and Esri
services (the management units stay live): cutblocks read from the designer's source newest first and
wait below their least zoom; a lake opens its chart sheets and leaves the unit beneath alone, while a
click off it adds the unit; a hunt zone card lists the last draw's hunts; and dated imagery steps
NASA's days and switches to Wayback with its local changes. It runs by hand, like the other e2e suites.

## Not done

- No layer here is kept for offline use, and none is in the map's table view.
- The draw report is read whole (about 3 MB) the first time a zone card or a unit's panel needs it.
