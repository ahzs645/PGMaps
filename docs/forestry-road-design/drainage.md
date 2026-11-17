# Drainage: limits and checks

Detail view → **Drainage** routes rain over the ground as it is and over the ground the road
leaves behind, then lists the streams the road turns, the ditch outlets and sags that need a
cross-drain, new ponding and a pipe-size check. This guide says when those results can be
trusted and what the check assumes. The method is specified in the
[workspace contract](../forestry-road-design.md#drainage-on-the-design-surface).

**Where it is.** The check, with its streams, ponding, drain-to-point catchments and watersheds,
is the **Drainage** choice of the **View** picker in the detail pane's title row. Culverts are
entered in the sidebar under Engineering → Drainage. Each place has a button to the other:
**Drainage check: streams, ponds, catchments** there, **Culvert inputs** here. Review's
[crossing register](review-and-standards.md#the-crossing-register) lists the modelled crossings
beside the mapped ones.

## Before you rely on it

- **Run it on real ground.** On the training hillside the streams are synthetic. On the regional
  DEM (about 22 m cells at 54° N) every ditch, culvert and fill toe is smaller than one cell, so
  only large streams mean anything. Use the published 1 m LiDAR or your own bare-earth DEM (see
  [Terrain and point clouds](terrain-and-point-clouds.md)).
- **Read the cell size.** The line under the tables gives the cells routed, the cell size and
  the cells of the box around the road. Only the ground within the upslope buffer of the road is
  routed (see [Where flow is routed](#where-flow-is-routed)), so the box does not count. The grid
  is never finer than 1 m, and it grows in 1.25× steps only when the routed cells pass
  4,194,304. A very long road on 1 m terrain, or a buffer of a kilometre or more, can still end
  up on 1.25–2 m cells, which is wider than the default 1 m V ditch.
  A warning identifies cells coarser than 2 m; narrower ditches and culvert channels
  may be unresolved even when the calculation finishes.
- **Check coverage first.** Only stations with a design elevation are burned into the surface.
  A station without ground, or a side that never reaches a catch point, leaves a gap or a step in
  the prism, and water routes through it as if the road were not there.
- **Make sure the buffer reaches the ridge.** Catchments are cut off at the edge of the sampled
  grid and at the edge of the terrain's data (see [Built-in assumptions](#built-in-assumptions)).
  Re-run with a larger buffer and compare the catchment areas at each crossing. If they grow, the
  first run was truncated.
- **Enter the culverts you plan.** The check only passes water under the road where a culvert in
  the sidebar's culvert inventory carves a channel. Enter inverts where you know them: without
  them the channel and its slope are assumed.
- **Replace the defaults.** The 50 mm/h storm, runoff coefficient 0.35, Manning n 0.024, 1 ha
  stream threshold and 250 m buffer are placeholders that make the check run. The intensity in
  particular must come from an IDF curve for your site, return period and catchment (see
  [the Rational method](#rational-method-and-pipe-capacity)).
- **Re-run after every change.** Full raster runs are not saved or updated by edits; the project
  retains settings and compact review evidence. A run goes stale
  when the recorded calculation version is older, that road's alignment (culverts and other engineering inputs included), the road settings,
  the terrain or any drainage input changes; edits to other alternatives leave it current
  (`DevForestryRoads.tsx`, `drainageStale`). A stale run stays in the panel with an amber notice
  and is not drawn on the plan.
- **Compare with mapped streams and the field.** The check does not read the project's context
  streams or any provincial stream layer. A stream the DEM does not resolve is not reported.

The route finder's drainage counts are a coarser screen of the same check, for ranking roads; see
[Find the best route](alignment-and-optimization.md#find-the-best-route). Run this view on the road
you choose.

## Limits and budgets

| Limit                        | Value                                                                                                                                                                                                                                                                        | Enforced in                                                                          | What happens when exceeded                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Routed cells                 | 4,194,304 cells held in the tiles along the road (the box around the road is not counted)                                                                                                                                                                                    | `drainageRun.ts` `MAX_DRAINAGE_ROUTED_CELLS`; `corridorGrid.ts` `sampleCorridorGrid` | Cell grows by 1.25× until the held tiles fit; the footer shows the cells routed, the cell and the box |
| Routed area                  | Tiles of 32 × 32 cells within the buffer of the road: a capsule around each pair of stations, radius the farther catch point plus the buffer; a tile within the road's own reach (catch points, the longest culvert barrel's half-length plus its 10 m apron) is always kept | `corridorGrid.ts` `CORRIDOR_TILE_SHIFT`; `drainageRun.ts` (`extraRoadReachM`)        | A sampled tile with no ground is dropped (no data); beyond the tiles is the grid's edge               |
| Finest cell                  | Maximum of 1 m, source resolution and optional requested working cell; a RoadEng TIN's source resolution is half its median edge, at least 1 m, not the cell of the grid kept over its box                                                                                   | `drainageRun.ts`, `runDrainage`; `tinGround.ts` `terrainGridCellM`, `TIN_MIN_CELL_M` | A coarser request reduces detail; a finer request never upsamples the source                          |
| Requested working cell       | 1–100,000 m, optional                                                                                                                                                                                                                                                        | `drainageEvidence.ts`, `parseDrainageSettings`; `drainageRun.ts`                     | Invalid settings reject; actual cells may grow to fit the cell budget                                 |
| Depression policy            | Fill all (legacy default), preserve, or fill shallow connected basins                                                                                                                                                                                                        | `drainagePolicies.ts`; `hydrology.ts`, `fillDepressions`                             | The policy is recorded and changes invalidate evidence                                                |
| Maximum basin fill           | 0–1,000 m for depth-limited routing                                                                                                                                                                                                                                          | `drainagePolicies.ts`, `parseDepressionPolicy`                                       | Deeper connected basins remain unfilled; zero preserves all positive-depth depressions                |
| Upslope buffer               | 250 m default; 20–2,000 m                                                                                                                                                                                                                                                    | `drainageRun.ts` `DEFAULT_DRAINAGE_SETTINGS`; `DrainagePanel.tsx`                    | Entries outside the range are clamped to it without a message                                         |
| Stream threshold             | 1 ha default; 0.05–500 ha                                                                                                                                                                                                                                                    | same                                                                                 | Clamped                                                                                               |
| Rainfall intensity           | 50 mm/h default; 1–500 mm/h                                                                                                                                                                                                                                                  | same                                                                                 | Clamped                                                                                               |
| Runoff coefficient C         | 0.35 default; 0.05–1                                                                                                                                                                                                                                                         | same                                                                                 | Clamped                                                                                               |
| Pipe Manning n               | 0.024 default; 0.009–0.05                                                                                                                                                                                                                                                    | same                                                                                 | Clamped                                                                                               |
| Flat routing                 | Full-fill: ε = 0.00001 m per cell; preserve/depth-limited: unchanged equal-height flats route to real lower/open exits                                                                                                                                                       | `hydrology.ts`, `fillDepressions`, `routeDrainingFlats`                              | Closed unfilled flats remain sinks                                                                    |
| Stream stub length           | First-order reaches under 5 cells that end at a confluence                                                                                                                                                                                                                   | `hydrology.ts`, `extractStreams` (`minLengthM`)                                      | Dropped from the drawn streams                                                                        |
| Culvert search distance      | 15 m of chainage                                                                                                                                                                                                                                                             | `hydrology.ts`, `analyzeDrainage` (`culvertSearchM`)                                 | A culvert further away is not associated with the crossing or low point                               |
| Diversion threshold          | 20 m along the road                                                                                                                                                                                                                                                          | `hydrology.ts`, `analyzeDrainage` (`divertThresholdM`)                               | Carried further without a culvert: reported as redirected                                             |
| Crossing re-entry            | 50 m of existing-ground path outside the footprint                                                                                                                                                                                                                           | `hydrology.ts`, `analyzeDrainage` (`followCells`)                                    | A stream that leaves and re-enters within 50 m counts as one crossing                                 |
| Low point                    | 0.05 ha (500 m²) draining to it, and at least 4 cells                                                                                                                                                                                                                        | `hydrology.ts`, `analyzeDrainage` (`lowPointMinAreaM2`, `LOW_POINT_MIN_CELLS`)       | Smaller outlets and sags are not listed                                                               |
| Cross-drain site             | Outlets within 40 m of the last along the road, either side, ditch outlet or pond                                                                                                                                                                                            | `hydrology.ts`, `crossDrainSiteGroups` (`CROSS_DRAIN_SITE_M`)                        | One site, located at its largest outlet, with the stretch it spans                                    |
| Flow lines drawn by zoom     | z12: 5× threshold and 3 cells wide; z14.5: 2× and 2 cells; z16: all                                                                                                                                                                                                          | `planLegendModel.ts` (`STREAM_ZOOM_STOPS`)                                           | Smaller or sheet-flow lines fade in as the map zooms in; data and exports unchanged                   |
| Cross-drain plan marks       | Sleeve padded 15 m each end; tick 4 m past each formation edge, from zoom 14.5                                                                                                                                                                                               | `crossDrainMarks.ts`                                                                 | Drawn only; the table and Review read the sites                                                       |
| Ditch detail                 | Cells of 2 m or finer                                                                                                                                                                                                                                                        | `hydrology.ts` (`DITCH_DETAIL_CELL_M`); `drainageRun.ts`; `readiness.ts`             | Coarser: cross-drain candidates are screening only and Review does not count them                     |
| New ponding                  | Fill deeper than 0.05 m                                                                                                                                                                                                                                                      | `hydrology.ts`, `analyzeDrainage` (`pondDepthM`)                                     | Shallower ponding is ignored                                                                          |
| Culvert apron                | Up to 10 m past each barrel end                                                                                                                                                                                                                                              | `designSurface.ts`, `burnRoad` / `carveCulvert` (`apronM`)                           | Stops earlier where the ground falls below the invert                                                 |
| Culvert channel reach        | Barrel half-length + 200 m each way, while in the footprint                                                                                                                                                                                                                  | `designSurface.ts`, `carveCulvert`                                                   | Channel ends                                                                                          |
| Missing invert               | Lower end ground − 0.3 m, flat                                                                                                                                                                                                                                               | `designSurface.ts`, `carveCulvert`                                                   | Warning: "inverts missing; channel set 0.3 m below the lower end"                                     |
| Assumed pipe slope           | 2 % when inverts are missing, flat or adverse                                                                                                                                                                                                                                | `hydrology.ts`, `analyzeDrainage` (`defaultSlope`)                                   | Slope shown with `*`                                                                                  |
| Standard diameters           | 0.3, 0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 3.0 m                                                                                                                                                                                                       | `hydrology.ts`, `STANDARD_CULVERT_DIAMETERS_M`                                       | No size carries Q: minimum shown as "> 3.0"                                                           |
| Batch duplicate distance     | 15 m of chainage, the culvert search distance                                                                                                                                                                                                                                | `crossDrainBatch.ts` `BATCH_DUPLICATE_M`                                             | A draft this close to a culvert or another draft is flagged as a duplicate; it can still be added     |
| Batch stream clearance       | 15 m of chainage from a natural-stream crossing                                                                                                                                                                                                                              | `crossDrainBatch.ts` `BATCH_STREAM_CLEARANCE_M`                                      | The draft is refused: a stream crossing is placed on its own                                          |
| Trial spacing                | 10–1,000 m; start and end on the road                                                                                                                                                                                                                                        | `crossDrainBatch.ts` `TRIAL_SPACING_LIMITS`, `trialSpacingProblem`                   | The preview is not filled and the panel says why                                                      |
| Draft barrel span            | Farther daylight on both ends at the skew, rounded up to 0.5 m; unresolved: road width + 4 m, at least 12 m                                                                                                                                                                  | `crossDrainBatch.ts` `draftCulvert`, `BATCH_SPAN_STEP_M`                             | —                                                                                                     |
| Culverts per road            | 100; diameter 0.1–20 m; length 0.2–500 m; skew −80° to 80°                                                                                                                                                                                                                   | `engineeringProject.ts`, `parseEngineering`                                          | Project refused                                                                                       |
| Culvert off the road or grid | Chainage outside 0 to road length, or no cell found                                                                                                                                                                                                                          | `designSurface.ts`, `burnRoad`; `hydrology.ts`                                       | Warning: "outside the road or the surface grid; not checked"                                          |
| Pour-point snap radius       | 0–2,000 m                                                                                                                                                                                                                                                                    | `drainageCatchments.ts`, `snapPourPoint`                                             | Invalid requests reject; no supported cell reports an error                                           |
| Catchment/watershed grid     | 4,194,304 stored cells (the held tiles on a run)                                                                                                                                                                                                                             | `drainageCatchments.ts`, `MAX_CATCHMENT_CELLS`                                       | Rejects rather than truncates cells                                                                   |
| Polygon boundaries           | 200,000 raw edges per basin and 200,000 combined watershed vertices                                                                                                                                                                                                          | `MAX_CATCHMENT_BOUNDARY_EDGES`                                                       | Rejects; increase minimum basin area or coarsen the analysis                                          |
| Watersheds                   | 1,000 qualifying outlet basins                                                                                                                                                                                                                                               | `MAX_WATERSHEDS`                                                                     | Rejects; increase the minimum area                                                                    |
| Portable evidence            | 20 road records, 5,000 features per record, 200,000 vertices                                                                                                                                                                                                                 | `drainageEvidence.ts`, `MAX_DRAINAGE_RECORDS`, `MAX_DRAINAGE_EVIDENCE_VERTICES`      | Invalid or oversized evidence is rejected                                                             |
| Saved sensitivity runs       | 12 per project; numeric summaries with at most 100 culvert pairs each                                                                                                                                                                                                        | `drainageEvidence.ts`, `MAX_DRAINAGE_COMPARISONS`, `parseDrainageComparisons`        | Remove a saved comparison before adding another; no raster or polygon copies                          |
| Per-culvert intensity          | Off by default; needs an IDF curve when on                    | `timeOfConcentration.ts` `activeConcentration`, `DEFAULT_CONCENTRATION_SETTINGS` | The run refuses with "no IDF curve"                                         |
| Kirpich coefficient            | 0.0195 (min, m, m/m)                                          | `KIRPICH_K_METRIC`                                                              | —                                                                           |
| Kirpich catchment range        | 0.49–45.3 ha                                                  | `KIRPICH_MIN_AREA_HA`, `KIRPICH_MAX_AREA_HA`                                    | Flagged: Tc extrapolated                                                    |
| Kirpich slope range            | 3–10 %                                                        | `KIRPICH_MIN_SLOPE`, `KIRPICH_MAX_SLOPE`                                        | Flagged: Tc extrapolated                                                    |
| Measurable path slope          | 0.1 %                                                         | `MIN_MEASURABLE_SLOPE`                                                          | Minimum Tc used, flagged                                                    |
| Minimum Tc                     | 5 min default; 1–60 min                                       | `DEFAULT_MINIMUM_TC_MIN`, `MIN_TC_LIMITS`                                       | Tc raised to it, flagged when Kirpich is shorter; outside the range refused |
| Flow-path profile mean         | 12 m on cells of 3 m or finer; none on coarser                | `groundTrend.ts` `groundWindowFor`; `smoothProfile`                             | —                                                                           |
| IDF table                      | 2–24 durations, rising, 1–10,080 min, 0.01–2,000 mm/h         | `idfCurve.ts` `MAX_IDF_POINTS`, `parseIdfTable`                                 | Refused                                                                     |
| IDF equation                   | A 0.001–100,000; B −2 to 0; read over 5 min–24 h              | `parseIdfCurve`, `ECCC_SHORTEST_DURATION_MIN`, `ECCC_LONGEST_DURATION_MIN`       | Outside the durations: held at the end and flagged                          |
| IDF table durations            | The table's own first and last rows                           | `logLogInterpolate`                                                             | Held at the end and flagged, never extrapolated                             |
| Imported IDF file              | 1 MB; needs Table 2b                                          | `MAX_IDF_FILE_BYTES`, `parseEcccIdfText`                                        | Refused                                                                     |

**Runtime.** The check runs on the page's main thread and cannot be cancelled. The previous
full-fill implementation took about 2–4 s on the published LiDAR road (1.29 million 1 m cells);
that historical measurement has not been repeated for the policy-aware implementation. On
Softree's LongRoad sample (a 27.7 km road on a TIN surveyed along it, measured in Node on
15 November 2026) the dense grid over the 9.2 × 17.5 km box took 2,743,312 cells of 7.67 m and
2.7 s, and grew the process's peak memory by 252 MB; routed along the road it takes 633,856
cells of 3.92 m (half the TIN's median edge) and 1.8 s, and 61 MB. In the browser the same run
took 2.6 s. The new
physical spill-depth calculation adds a flood pass, and non-default policies also route flats.
The page does not respond while the check runs. A finished run keeps contributing area and fill depth for both surfaces,
34 bytes a routed cell including both D8 direction grids: about 44 MB on the LiDAR road and 143 MB at the budget. Peak memory during the
run is higher. Full-fill now needs at least another 16 bytes per cell of live spill-surface/depth
temporary arrays (about 67 MB at the budget), in addition to queues, heaps and other working arrays.

## Where flow is routed

The grid is laid over the box around the centreline and catch points plus the buffer, aligned to
the projected grid, as before; but only the 32 × 32-cell tiles within the buffer of the road are
sampled and held (`corridorGrid.ts`). A tile with no ground in it is dropped, unless the road's
prism or a culvert channel reaches it, so a gap in the terrain stays a gap. Tiles the buffer does
not reach are never sampled: to the routing they are the grid's edge, and a catchment that
touches them is marked as touching the grid edge, one that touches a dropped tile or a missing
cell as touching no data. Either is reported as truncated.

A long, winding road's box is mostly ground the buffer never asks for. LongRoad's box is 10.5
million cells of 3.92 m, of which 633,856 are routed; the dense grid over the box had to
coarsen to 7.67 m to fit the cell limit.

The routed cells are stored tile row by tile row, so a scan over them meets the cells in the
full grid's row-major order. Depression filling, flats, flow accumulation, stream extraction,
crossings, cross-drain candidates, ponds, pour-point snapping and watersheds therefore process
the same cells in the same order as a dense run, and where the box holds no ground outside the
routed tiles the results are identical, cell for cell. `corridorGrid.test.ts` checks this on a
generated winding road whose ground lies only along it (a hole in it, a gully on a culvert), on
every depression policy, and, with `ROADENG_SAMPLES` set, on LongRoad at the old 7.67 m cell
(48 crossings, 242 cross-drain sites, the same catchment). Where the terrain does hold ground
beyond the buffer (a LiDAR tile or a regional DEM), the routed area is smaller than the old box
and catchments are cut at the buffer, as the buffer setting says: raise the buffer to reach the
ridge, which on a long road no longer costs cell size.

Outlet cells and watershed IDs are numbered row-major in the full grid, tiled or not. Saved
evidence keeps the grid's frame and its routed cell count (`grid.routedCells`); a record without
it routed the whole box. The algorithm version is `d8-policy-physical-spill-v3-corridor-tiles`,
so runs saved before this change ask to be recomputed.

## Pour points, watersheds and portable review

**Catchments & watersheds**, folded under the Drainage view, holds the pour point and watershed
tools. A pour point selects an arbitrary location on the plan (tap on phones). Choose existing
ground or the design surface and a snap radius. **Greatest contributing area** is the legacy
snap policy. **Lowest elevation** instead selects the lowest supported cell on the chosen
surface before depression conditioning. Both search within the same metric radius and use
nearest distance, then cell index, to break equal-score ties.
Zero radius selects the cell containing the point. No location outside supported terrain is
silently substituted. The result reports both the requested and snapped location, snap distance,
cell index, policy, cell count and area. Lowest-elevation snapping on the design surface reads
the road/culvert-modified ground, not the original bare-earth surface or a filled spill height.

The catchment is the exact union of cells whose D8 paths reach the selected cell. Polygonization
retains holes and disconnected components touching at a diagonal; it removes only collinear
vertices. **Delineate watershed polygons** partitions supported cells by their terminal D8 outlet,
then keeps basins meeting the entered minimum area. These are disjoint raster basins, not a
hierarchy of nested stream catchments. A catchment or basin touching the sample edge or missing
terrain is labelled as potentially truncated. Absence of boundary contact does not establish
surveyed watershed accuracy.

Project `drainage` stores rainfall, C, n, threshold, buffer, depression treatment, requested working
resolution, point/snap policy/surface and optional basin
threshold, plus one compact review record per road. The record includes run date, dependency
fingerprint, calculation version, terrain/datum/resolution, sampled grid metadata, crossing/diversion/culvert metrics,
catchment and watershed polygons, review locations and warnings. Full accumulation, fill-depth,
direction grids and stream linework remain in memory and are recomputed. Editing geometry,
terrain, criteria or drainage inputs invalidates current use. Imported embedded terrain and
checksummed published terrain retain reproducible source evidence; unchecksummed regional
terrain must be rerun after reopening even if its metadata matches.

Older evidence keeps its original input hash and remains in saved projects and historical reports.
It must be rerun for current exports: legacy ponding depth included the numerical full-fill routing
increment, while current ponding uses physical spill depth. A small depth change can cross the
0.05 m reporting threshold, so the application does not silently assign a new calculation version
to an old record.

**Export drainage GeoJSON** carries review geometry and provenance. **Export drainage evidence**
retains the full compact record and inputs. Stale records cannot be exported as current. The
standard road report includes an escaped drainage chapter with status and the retained inputs,
crossing metrics and per-culvert peak/capacity checks. The generic road shapefile/plot book do not
pretend to contain a full drainage raster.

### Compare a baseline with changed assumptions

1. Select the outlet and run drainage. Enter a **Comparison label** and **Save comparison run**.
2. Change one assumption: upslope buffer, requested cell size, depression policy, snap radius/policy,
   or existing/design surface. Terrain-source changes can also be compared where the source is available.
3. Rerun, save a second comparison, and choose the baseline. The cards show actual resolution,
   catchment area, absolute/percentage difference, outlet movement and boundary contact. Expand
   **Outlet and crossing evidence** for requested/selected coordinates, outlet cell, saved warnings
   and per-culvert existing/design catchments and design-area changes. A saved request without
   a resolved catchment is shown as **Outlet not resolved**, not as an omitted selection.
4. Export comparison evidence or save the project JSON. Reopening the project retains the snapshots.

These are deliberately saved historical results, not a confidence interval or automatic accuracy
estimate. The comparison lists all changed inputs, so a buffer comparison that also became coarser
is visible. Deltas for different requested outlets or roads are withheld. A different snapped outlet
is reported beside the delta because the new area includes its movement. Boundary/no-data contact
and unchecksummed terrain remain warnings. Results with changed inputs cannot be saved as a new
comparison until recomputed; the explicitly historical comparison export remains available.

The finite sample extent cannot recover upslope terrain absent from the source. A larger area that
has stopped changing is not proof that the watershed is complete. Comparison records do not claim
equivalence with the RoadEng tutorial's filling or outlet-selection algorithms.

## Built-in assumptions

### The design surface

- **It is the prism only.** Consecutive stations are joined by flat triangles from the centreline
  out to each catch point and rasterized at design elevation. Ground beyond the catch points is
  never changed. Between stations the formation, ditch and batters are straight-line
  interpolations, so at a 10 m station interval a vertical curve or a tight horizontal curve is
  approximated by 10 m chords.
- **Only the active road is burned.** Other alternatives in the project, spurs drawn as separate
  roads, landings and intersections are not part of the surface. Existing roads are only present
  if the terrain already shows them.
- **Ditch bottoms and uphill fill toes are burned again as lines.** They are lowered every half
  cell as a continuous 8-connected channel, but only where a ditch (or a cut face against the
  formation edge) exists, and the fill toe only where fill meets rising ground. This repairs
  sampling. It never cuts below the triangulated design.
- **Culverts are one-cell channels.** Each runs through its chainage at its skew, across the
  whole footprint even if the entered barrel is shorter, at inverts interpolated from the inlet
  end to the outlet end: left to right, or right to left for a culvert with its inlet on the right
  (`inletSide`, [Culverts](culverts.md#inlet-side)). Past each end, an apron of up to 10 m is cut at the end invert until the
  original ground falls below it. A channel passes any flow: capacity is only checked afterwards.
- **A missing invert is guessed.** The channel is set flat at the lower of its two end grounds
  minus 0.3 m. The panel warns, and the pipe slope falls back to 2 %.

### Routing

- **Depression treatment is explicit.** The default retains Priority-Flood with ε = 0.00001 m
  per cell, routing filled pits towards their spill. **Preserve depressions** retains their
  storage/sinks. **Fill shallow basins** fills a connected depression only when the complete
  basin fits within the entered maximum spill depth; it does not clip each cell's height and
  accidentally connect a deep basin to its outlet. Flat routing is numerical, not a surveyed
  channel. Equal-height open flats route to existing lower or boundary exits without raising
  their elevations. Closed flat bottoms can retain multiple terminal cells, so a catchment at
  one sink may cover only part of the whole depression; the run reports this limitation.
  These choices are not a rainfall-duration/storage-routing model.
- **Potential ponding remains visible under every policy.** Spill-depth storage diagnostics
  are separate from the chosen routing surface. Preserving a pit does not turn its ponding
  depth into zero or establish that it is safe to ignore. Full-fill routing can connect real
  wetlands and lakes as if they spill; preserving them can reduce downstream contributing area.
- **D8 sends each cell's water to one neighbour,** the steepest of eight. Water never splits.
  On open hillsides this concentrates diffuse runoff into parallel lines aligned with the grid,
  and stream positions depend on DEM detail and noise.
- **The grid edge and data holes are outlets.** Every cell on the edge of the routed tiles, and
  every cell next to a missing one, drains off the grid. Water from beyond the edge is never
  counted, so a catchment that extends past the buffer is reported smaller than it is. Every run
  warns about this finite catchment; missing sampled ground receives an additional warning.
  The same happens where the terrain itself ends (the published LiDAR is one tile) or
  has no-data gaps (often water bodies in a DTM). The buffer cannot add ground the terrain does
  not have.
- **The routed area follows the road** (see [Where flow is routed](#where-flow-is-routed)). The
  buffer is a minimum distance from the catch points, not a catchment boundary: whole tiles are
  routed, so ground up to about one tile further is included.
- **The grid is a resampling.** Cells are sampled at their centres from the active terrain, on a
  new grid aligned to the corridor rather than to the source cells. On a raster source that is
  interpolated between source cells.
  The analysis projection is local UTM in ground metres, independent of the source CRS.
  Web Mercator map metres must not be used as ground metres for buffer distances or areas;
  source cells and export coordinates retain their recorded CRS.
- **Surface runoff only.** No infiltration, interception, snowmelt, subsurface flow, channel
  hydraulics or storage routing.

### Rational method and pipe capacity

- **Peak flow** is Q = C · i · A / 360, with Q in m³/s, i in mm/h and A in hectares. A is the
  largest design-surface contributing area on the culvert's barrel cells, which includes
  whatever the ditches bring to it.
- **Intensity: one for every culvert, or each culvert's own.** By default every culvert uses the
  **Rainfall (mm/h)** figure, and the tool does not compute a duration: choose i from an IDF curve
  at a duration matching the catchment's time of concentration and at the return period your
  standard requires. With **Intensity → Per culvert: Tc and IDF** on, each culvert's intensity is
  read from an IDF curve you enter at its own time of concentration (next section). Off, every
  figure is exactly as before, and a curve kept with the option off does not stale a run.
- **The Rational method suits small catchments.** Many design guides limit it to catchments of a
  few tens of hectares to a few square kilometres. In much of BC the design flood comes from
  snowmelt or rain-on-snow, which a rainfall intensity does not represent.
- **Capacity is full-pipe Manning flow:** Q = (1/n) · (πD²/4) · (D/4)^(2/3) · √S. There is no
  inlet or outlet control, headwater limit, debris, bedload, ice or beaver allowance, and no
  fish-passage check. On steep culverts inlet control usually governs, and full-pipe capacity
  overstates what the pipe passes.
- **Slope** is (inlet invert − outlet invert) / length. When it is missing, zero or adverse the
  check uses 2 %, which is optimistic for a pipe laid flat.
- **The minimum diameter** is the smallest size in the standard list whose full-pipe capacity
  carries Q at that slope and n. Larger or non-round structures are not considered.
- **A culvert with a shape, barrel count or material of its own** is checked through them: every
  barrel together, a box by its own wetted perimeter, an arch as the round pipe of the same end
  area, and the material's Manning n in place of the run's ([Culverts](culverts.md)). A plain
  round pipe keeps the figures above. The minimum diameter stays a single round pipe.
- **Inlet- and outlet-control headwater and overtopping** are checked from this run's peak in the
  culvert editor and the culvert schedule, not here: see
  [Culverts](culverts.md#inlet-control-headwater).

### Per-culvert time of concentration and IDF intensity

Drainage → **Intensity** (`DrainageIntensityEditor.tsx`; `timeOfConcentration.ts`, `idfCurve.ts`).

1. **Flow path.** From the barrel cell that collects the culvert's design catchment, the longest
   D8 flow path upstream on the routed design surface (the conditioned elevations the run routed
   over), so it can run down a ditch to the pipe (`flowPathProfile`, `longestFlowPath`). L is that
   path's length in metres.
2. **Slope**, m/m, one of:
   - **10–85** (default): (z at 85 % of L − z at 10 % of L, from the outlet) / 0.75 L — Benson
     (1962), USGS Water-Supply Paper 1580-B.
   - **Equal-area**: S = 2·∫(z − z₀)dx / L², the line through the outlet with the profile's area
     under it — Australian Rainfall and Runoff (1987), Book IV.
   - **End-to-end**: total fall / L, the slope Kirpich's own data used.

   The profile is read on a centred moving mean of 12 m along the path on cells of 3 m or finer
   (none on coarser cells), the window the route searches use for grades (`groundWindowFor`,
   `groundTrend.ts`), shrinking near the ends so a straight profile is unchanged. A 1 m stump hole
   at the 10 % point moves a raw 10–85 slope by 1.3 points on a 100 m path; on the mean, by 0.1.
   The slopes are chords or areas over most of the path, so the mean otherwise moves them little.
3. **Time of concentration**, Kirpich (1940), metric: **Tc = 0.0195 · L^0.77 · S^−0.385**, Tc in
   minutes, L in metres, S in m/m (TxDOT Hydraulic Design Manual, ch. 4 §11: K = 0.0078 with L in
   feet, 0.0195 in metres). Kirpich fitted it to seven small agricultural catchments in Tennessee
   of 1.2–112 acres (0.49–45.3 ha) with well-defined channels and slopes of 3–10 % (Chow, Maidment
   & Mays, _Applied Hydrology_, 1988, Table 15.1.2). A catchment or slope outside that range is
   **flagged** in the run's notes and the culvert's figures, never silently used. Tc is at least
   the **minimum Tc**, 5 minutes by default: FHWA HEC-22 (3rd ed., 2009) recommends 5 minutes as
   the least time of concentration, and 5 minutes is ECCC's shortest published duration. A path
   with under 0.1 % fall has no Kirpich time: the minimum is used and the culvert says so.
4. **Intensity**, mm/h, from the IDF curve at duration Tc:
   - **Table**: duration → intensity for the return period, read linearly in log(intensity)
     against log(duration) between rows. Hand check: 100 mm/h at 10 min and 50 mm/h at 30 min give
     64.58 mm/h at 20 min.
   - **Equation**: ECCC's fitted interpolation equation, R = A·T^B, R in mm/h and **T in hours**
     (station file, Table 3), used over the 5 min–24 h it was fitted to.
   - Beyond either end of the curve nothing is extrapolated: the end is used and flagged. Past the
     longest duration that overstates the intensity.
5. **Peak**: Q = C · i_culvert · A / 360 as before; capacity, minimum diameter and headwater read
   that Q.

**The curve is yours.** Enter the station, ID, return period and source with the table or the
equation, or import one station's ECCC short-duration IDF text file (Environment and Climate
Change Canada, Engineering Climate Datasets, Open Government Licence – Canada): its station line,
Table 2b's rates (−99.9, fewer than 10 years, is left out) and Table 3's A and B are read by hand,
and you pick the return period. The file is not stored or bundled; the project keeps the curve you
chose with its source line (release, date and file name). The report's settings line names the
method, the slope, the minimum and the curve; its culvert table gives each culvert's flow path,
slope, Kirpich and used Tc, intensity, return period and flags.

**When it helps, and when it does not.** On the small steep catchments forest road culverts
drain, Kirpich usually gives under 5 minutes: the test hillside's gully (2.2 ha, 306 m path at
12 %) reads 3.6 minutes, so the 5-minute minimum governs and the intensity is the curve's 5-minute
figure, much higher than a typical single "design" figure. Per-culvert intensity matters most
where catchments differ in size: a 0.2 ha cross-drain and a 40 ha stream crossing do not share a
critical duration. It does not make the Rational method fit larger catchments (many guides stop at
tens of hectares to a few km²), it does not represent snowmelt or rain-on-snow, which set the
design flood over much of BC, and Kirpich was fitted to channelled farmland: on forested hillslopes
with subsurface stormflow it tends to give too short a Tc and so too high an intensity. The flow
path stops at the buffer and data edges like the catchment does. It remains a planning screen.

## Reading the results

| Result                | Defined as                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream crossing       | An existing-ground flow line at or above the stream threshold that enters the road footprint. "Leaves" is where the same water exits the footprint on the design surface; "Carried" is the chainage between the two                                                                                                                                                                                                                          |
| Redirected            | Carried more than 20 m without passing through a culvert channel. "Nearby, bypassed" means a culvert lies within 15 m of the entry but the water does not reach its channel                                                                                                                                                                                                                                                                  |
| Cross-drain candidate | A site where design-surface flow of at least 0.05 ha (and 4 cells) leaves the prism ("leaves road"), or a new pond in or beside the footprint drains at least as much ("ponds"). Outlets within 40 m of each other along the road, on either side, are one site; the table gives the site's largest outlet, the stretch it spans and how many outlets it joins. Without a culvert channel it needs a cross-drain or a reason not to have one |
| New ponding           | 8-connected cells filled more than 0.05 m on the design surface where existing ground did not pond, shown as a point at the deepest cell. The tile counts all of them, including ponds dammed behind fill away from the ditch                                                                                                                                                                                                                |
| Culvert sizing        | Design and existing catchments, Rational peak, full-pipe capacity, slope (`*` assumed) and entered/minimum diameter. Capacity in red means the entered pipe does not carry the peak                                                                                                                                                                                                                                                          |

On the plan, design streams are solid blue and widen with contributing area; existing streams
are dashed pale blue. A stream the road turns shows as the two lines parting. Redirected
crossings are red lines drawn straight from entry to exit (not along the ditch), and new ponds
are small blue dots. A cross-drain candidate without a culvert is a yellow sleeve, two thin lines either side of the
road, over the stretch where flow leaves it, stronger where more area drains off; from zoom 14.5 a
dashed yellow line across the road marks its largest outlet, where a culvert would go. Yellow, not
amber, because amber is the default road colour, the within-grade road class and "mostly cut". The
marks follow the road, so a zoomed-out plan shows sleeves on the road rather than a field of dots.
They are not the profile's sag low points, which are the bottom of a vertical curve. Drainage layers are hidden while
a terrain profile is open.

Selecting a table station updates the linked views. In a focused mobile layout it also opens
the plan, so the selected location is visible immediately. Mobile culvert cards put modeled
peak flow, capacity, catchments, diameters and the assumed/measured slope together; desktop
retains the comparison table.

When a pipe's existing-ground catchment is at least 0.05 ha but its design catchment falls
below half of that, the run warns to inspect diverted flow, the inlet and terrain detail.
The capacity comparison still uses the modeled design catchment; a small modeled flow is
not evidence that the original upstream water has disappeared or that the pipe is suitable.

### A worked reading: the published LiDAR road

The draft road on the published LiDAR tile is about 1,050 m long, sampled at 1.29 million 1 m
cells. The check reports:

- **Five stream crossings.** The largest, a 5.2 ha stream entering at 0+866, is carried 184 m and
  leaves at 1+050. That is the end of the road, not a designed outlet: the prism stops there, so
  the water leaves with it. On a longer road the same stream would be carried further. Either a
  culvert at about 0+866 or a different alignment is needed.
- **27 ditch outlets and sags** where 0.05 ha or more collects, in the run before outlets were
  joined into sites. Each is a place to consider a cross-drain, not a requirement for one. Several
  within a short distance were often one ditch broken by small grade changes rather than separate
  needs, which is why outlets within 40 m are now one cross-drain site.
- **No culverts.** The road has none yet, so the sizing table is empty. Add the crossings to the
  culvert inventory, enter inverts, re-run and check that each crossing reads "Passes through".

The first version of the check reported 129 ponds on this road. They were not water: the
default 1 m × 0.5 m V ditch is narrower than a cell, and sampling its side slopes at cell centres
on a line skewed to the grid left a staircase of pits. Burning the ditch and fill-toe lines as
continuous minima removed them. The lesson stands for any feature that is narrow compared with
the cell: a ditch, a narrow bench or a small culvert outlet on a 2–4 m grid can still alias into
false ponds or false breaks.

## Flow lines by zoom

A smooth hillside on coarse terrain drains in parallel strips one cell wide. On 22.4 m cells each
strip passes a 1 ha stream threshold about 450 m down the slope, so every cell across the slope
became a drawn "stream", 22 m apart; on 1 m cells the same strip would need about 10 km. These are
an artefact of D8 routing on the grid, not channels.

Each flow line therefore carries two measures, both taken at its own last cell, before the
confluence it ends on (`extractStreams`, `hydrology.ts`):

- `thresholdRatio`, its contributing area over the stream threshold;
- `widthCells`, its contributing area over its longest flow path (`longestFlowPath`), in cells
  across: about 1 for a sheet-flow strip, more where flow converges in a hollow, a gully or a
  ditch.

Taking them at the confluence cell instead read every strip that ran into a ditch as large as
the ditch: on a 22.4 m block road the median line then read 18 times the threshold and 8 cells
wide, against 4.7 times and 3 cells measured on its own flow.

Zoomed out the plan draws lines with at least five times the threshold and three cells of width;
by zoom 14.5 those with twice the threshold and two cells; by zoom 16 every line
(`STREAM_ZOOM_STOPS`, `planLegendModel.ts`), fading in between. Redirected flow always shows, and
a line from an older saved run without the measures always shows. On that road the full network
was 51.6 km of drawn line and the zoomed-out view now draws about 12 km. Exports, crossings and
culvert checks are unchanged: they read the full network.

## Cross-drain candidates on the plan

A cross-drain candidate without a culvert is drawn as a yellow sleeve, two thin lines either
side of the road (MapLibre `line-gap-width`), over the stretch where flow leaves it, padded 15 m
each end so a one-outlet site still shows, and stronger where more area drains off. From zoom
14.5 a dashed yellow line crosses the road at the site's largest outlet, 4 m past each formation
edge, where a culvert would go (`crossDrainMarks.ts`, `CROSS_DRAIN_BAND_PAD_M`,
`CROSS_DRAIN_TICK_PAST_EDGE_M`). Both follow the road in metres, so a zoomed-out plan shows
sleeves on the road rather than a field of dots. The tick has no legend row of its own; the
sleeve's row ("Cross-drain candidate · flow leaves the road") covers both.

Yellow, not amber: amber is the default road colour, the within-grade road class and "mostly
cut", and the first amber bands vanished on an amber road. The marks are not the profile's sag
low points (the bottom of a vertical curve, see
[Profile labels, grade trouble and value bands](profile-labels-and-bands.md)).

## Cross-drain candidates on coarse terrain

On cells coarser than 2 m the road's ditch is narrower than a cell, so the design surface cannot
carry water along it. Flow reads as leaving the road wherever the ground falls away, and every
such cell was once its own low point: on the 22.4 m regional DEM one cell is 503 m², over the
0.05 ha minimum by itself, and the old 10 m same-side spacing was shorter than a cell, so almost
nothing merged. Now a low point needs four cells of flow and outlets join into 40 m sites. On a
3.6 km block road that is 75 outlets in 30 sites; one site on a sidehill stretch joins 24
outlets over 728 m, which says that stretch needs several cross-drains, not one.

On such terrain the panel marks the list "Screening only" and Review reads the row as not
assessed rather than counting the candidates as missing culverts; it is never met either.
Stream crossings and pipe sizes are still reported and can still flag the row. Load LiDAR or
another bare-earth DEM of 2 m or finer before placing cross-drains.

## Placing cross-drains in a batch

Under the cross-drain candidates, **Place cross-drains in a batch** fills a preview of draft
culverts and adds the ready ones in one step (`crossDrainBatch.ts`, `useCrossDrainBatch.ts`,
`CrossDrainBatchPanel.tsx`). Nothing reaches the road until **Add**.

- **From candidates.** Tick sites in the table (a site already served through a culvert has no
  box) and press **Preview draft culverts**. A site can merge several outlets, so its row shows
  the site's stretch and outlet count; the pipe starts at the largest outlet and can be moved.
  The inlet is proposed on the side that outlet is on: the side the site's water gathers on.
  Water leaving over a fill may need the inlet on the other side, so every side waits for the
  designer: pick it, or **Confirm proposed sides**. Coarse-grid candidates (cells over 2 m) stay
  available and every such row says it is a screen.
- **Trial spacing.** Start, end and spacing fill the same preview with a pipe at each station.
  With no candidate to say where water gathers, the inlet is proposed at the barrel's uphill end
  (the ground at its two ends); where that ground is level or missing there is no proposal and the
  side must be chosen. Spacing rows replace earlier spacing rows and keep the candidate rows.
- **The preview is the placed geometry.** Each draft is built into a culvert (span to the farther
  daylight at its skew, crown at the draft cover under the centreline formation at mid-barrel,
  falling at the draft's fall) and calculated by the engine's own culvert calculation
  (`calculateCulverts` over `engineeringGeometry`), deepened once by any cover shortfall. The plan
  draws each barrel in violet with an arrow past its outlet, red while a row is refused, grey when
  excluded. Station, inlet side, skew and fall are edited in the row; diameter, cover and cost
  for the whole batch above it.
- **Refused rows** (not added until fixed or excluded): inlet side not confirmed, off the road, a
  natural-stream crossing within 15 m (those stay in individual review under Culvert inputs), a
  barrel crossing an existing culvert or another included draft, past 100 culverts on the road.
- **Flagged rows** (added if included): another culvert or draft within 15 m, span short of the
  daylight span, cover unknown or low, a fall that is not downhill, ground at the outlet end
  higher than at the inlet, a candidate moved more than 40 m outside its site's stretch, a
  coarse-grid screen.
- **Adding.** The ready rows go in as one undo step named "Add N cross-drains"; one Undo removes
  them all. It is refused while an input does not calculate, while the drainage run that filled
  candidate rows is out of date, or while the road (its culverts aside) or that run differs from
  what the preview was built on; the panel then says so, and **Use the preview as it now stands**
  accepts the rows as re-checked. Adding culverts changes the drainage inputs, so the run reads
  out of date until it is re-run.

## RoadEng culverts from a traverse

RoadEng fills a road's culverts from its P-line traverse: _Culverts Re-Import_ reads every
culvert the traverse holds between a From and a To P-line station, deletes existing culverts
within a tolerance of each one read (or all of them) and adds those read. The traverse's culvert
is the `CREEK` field of a Softree ASCII or IPD file, or Polycorder's culvert width
(`softreeCulvert.ts`), kept with a survey field book read from the file. Drainage → **RoadEng
culverts** does the same between a saved field book and the road on screen
(`roadEngCulverts.ts`, `RoadEngCulvertsPanel.tsx`):

- **Read from book** places each culvert at the road station square to its traverse station and
  replaces culverts within **Replace within** of it, or all of them with **Remove all first**. Its
  size is the pipe's diameter (a box's height; the box's width is kept), and it is a natural
  stream culvert. A downstream azimuth (flag 0) sets the skew against the road's direction on the
  book's grid, so grid convergence does not enter; flags 1 and 3 (square, downstream right or
  left) and 5 (from side shots) cross square. A culvert flowing to the road's left is placed with
  its inlet on the right (`inletSide`); written back, a culvert with its inlet on the right flows
  left. A culvert read before the field existed keeps the direction its record states. What the model has no
  field for (book, station, P-station, box width, surveyed gradient, azimuth, flag, slope
  distance, the field as written) is kept on the culvert (`Culvert.roadEng`) and listed under it.
- **Write to book** writes the road's culverts into the field book, each at the traverse station
  nearest it along the road, and removes the book's other culverts along the road. A culvert read
  from that station and unchanged goes back as it was written, so an unedited book exports the
  same bytes; an edited one is written afresh in the book's format and unit. A unit survey has no
  culvert field and is refused. The book's traverse export then carries the culverts to RoadEng.
- **Culverts placed in a RoadEng design** are read too: see
  [RoadEng culverts in a design](#roadeng-culverts-in-a-design).

| Limit                                                | Value | Enforced by                                |
| ---------------------------------------------------- | ----- | ------------------------------------------ |
| Read: existing culverts replaced within (default)    | 5 m   | `ROADENG_CULVERT_REPLACE_M`                |
| Write: a culvert’s traverse station along the road   | 10 m  | `ROADENG_CULVERT_MATCH_M`                  |
| A traverse station further from the road is not used | 50 m  | `ROADENG_CULVERT_MAX_OFFSET_M`             |
| Culverts a road holds                                | 100   | `culvertsFromTraverse`, `parseEngineering` |

## RoadEng culverts in a design

RoadEng keeps a design's placed culverts in the alignment's `LocationN.ds1`
(`roadEngPlacedCulverts.ts`), not in the `.dsn`, whose `[Culvert]` keys are only the defaults a
new culvert starts from. The file is three chunks, each a 24-byte header and a payload; the second
holds one length-prefixed text record per culvert: its description, `%#%|`, then 20
comma-separated fields in the layout of the `DefDrainCulvert`/`DefStreamCulvert` keys. Opening a
design reads them onto its road (Drainage lists them, with a line saying how many came from the
design):

| Field       | Read as                                                                                                                                       | From                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description | the culvert's name (its first line); a record without one is named _Stream culvert n_ or _Cross-drain n_                                      | Softree's samples                                                                                                                                                                              |
| 0           | 0 cross drain, 1 natural stream                                                                                                               | the two defaults; the tutorial's creek culvert                                                                                                                                                 |
| 1           | L-line station, project units, placed at the road chainage of that station                                                                    | the tutorial's creek culvert at 1391.181 ft                                                                                                                                                    |
| 2           | P-line station; 3.40282346639e+38 (no value) when there is none                                                                               | every sample                                                                                                                                                                                   |
| 3           | diameter, thousandths of a project unit (mm in metres, 0.001 ft in feet)                                                                      | a 60-inch pipe stored as 5000 in a feet design                                                                                                                                                 |
| 4           | skew, degrees clockwise from the L-line ahead, 90 square: PGMaps' skew is this less 90                                                        | a V11 tutorial culvert whose drawn stream crosses the road within 3.4° of it read clockwise (anticlockwise is 82° off); Softree's help says anticlockwise                                      |
| 5           | gradient, %, kept and editable (**RoadEng gradient**), written back; PGMaps' own pipe grade still comes from the inverts                      | signed values in the samples                                                                                                                                                                   |
| 6, 7        | length left and right of the L-line, project units; their sum is the barrel span (PGMaps centres the barrel)                                  | the Culvert Editor help                                                                                                                                                                        |
| 8           | vertical-position depth, project units, shown and kept                                                                                        | the tutorial's 8 ft depth                                                                                                                                                                      |
| 9           | option bits: bit 1 (2) skew Auto, bit 2 (4) gradient Auto, bit 7 (128) length Auto, bit 12 (4096) template override on; the rest kept as read | the V11 RoadEng Resource tutorial, chapter 17: unticking Auto under Gradient turns the design's stream default 414 into 410; ticking Override and unticking Auto under Skew turns it into 4508 |
| 10–12       | 2, 0, 0 in every sample (shape and its sizes; no sample has a box or arch): kept as read                                                      | not decoded                                                                                                                                                                                    |
| 13–17       | template override on (1) or off, ditch width, ditch depth, template offset and taper, project units                                           | the same chapter's culvert at 338 m (width 1, depth 0.6) and the Culvert Properties help's order                                                                                               |
| 18, 19      | 0 and no value in nearly every design: kept as read                                                                                           | not decoded                                                                                                                                                                                    |

Drainage's line for each RoadEng culvert says which of its values RoadEng computes (Auto) and its
template override. The vertical-position option is among field 9's other bits: bit 3 is set on
every culvert the tutorials put at _Attach to upper ditch/catch point_ and clear on two
knowledge-base designs' typed-depth cross drains, but no sample separates _Cut depth at C/L_,
_Fill depth at C/L_ and _Minimum fill depth_, so the depth is never applied: the culvert's inverts
stay unset until entered. Section 1 of the file holds the design's floating labels; its header's
byte count is not their length in Softree's own files (Road 6 stages 15–18, V11 Location 18_4
onward), so the reader walks the labels to reach the culverts. A culvert whose station lies off
the road (Widening only's first, 271 m before its start) or whose record does not read stays in
the file unread and goes back as written; the notice counts them.

**Written back** by the RoadEng design and project exports: each record in its place, an
unedited one as the same bytes (an unedited `.ds1` is the file read), an edited one with only the
fields it changed rewritten, each keeping its own leading space; a deleted culvert's record is
removed; a culvert added in PGMaps becomes a new record from the design's default culvert of its
kind (RoadEng 11's own default when the design has none, or is written in other units), in
station order. A skew, lengths or gradient edited here go back with that value's Auto bit cleared,
so RoadEng keeps the value instead of computing its own; a new culvert keeps its default's Auto
lengths and gradient, and its skew Auto only where its skew is the default's. A written station within 2 mm of the record's keeps the record's text. A design
written in other units than it was read in has every length converted. `[PGMaps]` keeps the
culverts with the records written, so the design opens back onto them with their costs, cover and
inverts; after a save in RoadEng a culvert whose record RoadEng left as written keeps those, and
one it rewrote starts from the defaults.

| Limit                                                             | Value           | Enforced by                              |
| ----------------------------------------------------------------- | --------------- | ---------------------------------------- |
| Culverts read from a design (the rest stay in the file)           | 100             | `MAX_PLACED_CULVERTS`                    |
| A written station keeps the record's within                       | 2 mm            | `ROADENG_CULVERT_STATION_TOLERANCE_M`    |
| PGMaps' skew; a record skewed further is placed at it and said so | 80° from square | `parseEngineering`, `culvertsFromDesign` |

## How problems show up

| Symptom                                                           | Likely cause                                                                         | What to do                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Many small ponds along a ditch, every station or two              | Ditch narrower than the cell, often after the grid coarsened                         | Check the cell size in the footer; shorten the road or the buffer; use finer terrain |
| A crossing's catchment grows when the buffer is increased         | Catchment truncated at the grid edge                                                 | Increase the buffer until areas stop changing, or accept and record the truncation   |
| Catchment stops at a straight line on the plan                    | Terrain edge or a no-data gap acting as an outlet                                    | Load terrain covering the whole catchment                                            |
| Stream crosses the road with no diversion where the road is cut   | A station without design elevation left a gap in the prism                           | Fix coverage (ground, daylight) at that station and re-run                           |
| "Nearby, bypassed" on a crossing                                  | Culvert chainage or skew misses the flow line by more than the channel's one cell    | Move the culvert to the flow line's entry station; check skew                        |
| Water still redirected with a culvert in place                    | Inverts above the ditch, or the culvert is off the thalweg                           | Enter inverts at or below the ditch bottom; check the culvert's station              |
| Slope shows `*`                                                   | Inverts missing, equal, or rising downstream                                         | Enter falling inverts                                                                |
| Minimum diameter "> 3.0"                                          | Peak exceeds a 3 m pipe at that slope; likely a bridge or open-bottom structure site | Treat as a major crossing for a qualified professional; the check cannot size it     |
| Results did not change after an edit                              | The run is stale; runs are not recalculated                                          | Re-run. The plan hides a stale run until you do                                      |
| Flow gone from the plan; the Drainage panel shows an amber notice | The road, road settings, terrain or a drainage input changed since the run           | Re-run on the Drainage view                                                          |
| Full streams absent after reload                                  | Only inputs and compact evidence are saved; full grids are recomputed                | Review saved evidence and re-run; regional live terrain always needs a fresh run     |
| Streams in odd parallel lines on a planar slope                   | D8 on smooth ground: sheet flow in one-cell strips                                   | Zoom out: the plan leads with convergent lines; or raise the stream threshold        |
| Dozens of cross-drain candidates on regional terrain              | Cells coarser than 2 m: the ditch is narrower than a cell                            | Read them as a screen; load 2 m or finer bare-earth terrain before placing culverts  |
| A cross-drain site spans hundreds of metres                       | Flow leaves the road all along a sidehill stretch                                    | Plan several cross-drains along it; the site's largest outlet is the first place     |

## What it does not do

- **It does not save full raster grids.** Only settings and compact review evidence travel in
  projects; the latest three full in-memory road runs can be inspected until reload. The
  browser setting `pgmaps-road-drainage-settings` is a fallback for older projects without
  project inputs, not the sole record.
- **No wetness index, hydrographs, hydraulic grade lines, scour or outlet protection.** Time of
  concentration is the per-culvert option above; inlet and outlet control are the culverts'.
- **No ditch capacity or erosion check.** Ditches carry whatever reaches them.
- **No fish passage, channel stability or debris-flow assessment.**
- **Not a hydrotechnical design.** It is a planning screen for where water goes and roughly how
  much. In British Columbia, stream crossings on forest roads are normally designed or reviewed
  by a qualified professional, with a hydrotechnical assessment where the site warrants it, and
  the design flood, sizing method and documentation are set by the regulations, ministry manuals
  and professional guidelines that apply to your tenure. This tool applies none of them. Use its
  results to find the sites that need that work, not to replace it.
