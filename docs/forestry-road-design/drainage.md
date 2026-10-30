# Drainage: limits and checks

Detail view → **Drainage** routes rain over the ground as it is and over the ground the road
leaves behind, then lists the streams the road turns, the ditch outlets and sags that need a
cross-drain, new ponding and a pipe-size check. This guide says when those results can be
trusted and what the check assumes. The method is specified in the
[workspace contract](../forestry-road-design.md#drainage-on-the-design-surface).

## Before you rely on it

- **Run it on real ground.** On the training hillside the streams are synthetic. On the regional
  DEM (about 22 m cells at 54° N) every ditch, culvert and fill toe is smaller than one cell, so
  only large streams mean anything. Use the published 1 m LiDAR or your own bare-earth DEM (see
  [Terrain and point clouds](terrain-and-point-clouds.md)).
- **Read the cell size.** The line under the tables gives the cell count and cell size. The grid
  is never finer than 1 m, and it grows in 1.25× steps when the corridor plus buffer needs more
  than 4,194,304 cells. A long or diagonal road can end up on 2–4 m cells, which is wider than
  the default 1 m V ditch.
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
  when that road's alignment (culverts and other engineering inputs included), the road settings,
  the terrain or any drainage input changes; edits to other alternatives leave it current
  (`DevForestryRoads.tsx`, `drainageStale`). A stale run stays in the panel with an amber notice,
  is not drawn on the plan, and the plan header reads "Drainage out of date · re-run it to show
  flow".
- **Compare with mapped streams and the field.** The check does not read the project's context
  streams or any provincial stream layer. A stream the DEM does not resolve is not reported.

## Limits and budgets

| Limit                        | Value                                                                  | Enforced in                                                       | What happens when exceeded                                              |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Surface grid                 | 4,194,304 cells                                                        | `drainageRun.ts`, `runDrainage` (`maxCells`); `sampleSurfaceGrid` | Cell grows by 1.25× until the grid fits; the footer shows the cell      |
| Finest cell                  | 1 m, or the terrain's native resolution if coarser                     | `drainageRun.ts`, `Math.max(1, resolutionM)`                      | A 0.5 m source is resampled to 1 m                                      |
| Upslope buffer               | 250 m default; 20–2,000 m                                              | `drainageRun.ts` `DEFAULT_DRAINAGE_SETTINGS`; `DrainagePanel.tsx` | Entries outside the range are clamped to it without a message           |
| Stream threshold             | 1 ha default; 0.05–500 ha                                              | same                                                              | Clamped                                                                 |
| Rainfall intensity           | 50 mm/h default; 1–500 mm/h                                            | same                                                              | Clamped                                                                 |
| Runoff coefficient C         | 0.35 default; 0.05–1                                                   | same                                                              | Clamped                                                                 |
| Pipe Manning n               | 0.024 default; 0.009–0.05                                              | same                                                              | Clamped                                                                 |
| Flat-routing gradient        | ε = 0.00001 m per cell                                                 | `hydrology.ts`, `fillDepressions`                                 | Fixed                                                                   |
| Stream stub length           | First-order reaches under 5 cells that end at a confluence             | `hydrology.ts`, `extractStreams` (`minLengthM`)                   | Dropped from the drawn streams                                          |
| Culvert search distance      | 15 m of chainage                                                       | `hydrology.ts`, `analyzeDrainage` (`culvertSearchM`)              | A culvert further away is not associated with the crossing or low point |
| Diversion threshold          | 20 m along the road                                                    | `hydrology.ts`, `analyzeDrainage` (`divertThresholdM`)            | Carried further without a culvert: reported as redirected               |
| Crossing re-entry            | 50 m of existing-ground path outside the footprint                     | `hydrology.ts`, `analyzeDrainage` (`followCells`)                 | A stream that leaves and re-enters within 50 m counts as one crossing   |
| Low point                    | 0.05 ha (500 m²) draining to it                                        | `hydrology.ts`, `analyzeDrainage` (`lowPointMinAreaM2`)           | Smaller outlets and sags are not listed                                 |
| Low-point spacing            | 10 m of chainage, same side and kind                                   | `hydrology.ts`, `analyzeDrainage`                                 | Only the largest is kept                                                |
| New ponding                  | Fill deeper than 0.05 m                                                | `hydrology.ts`, `analyzeDrainage` (`pondDepthM`)                  | Shallower ponding is ignored                                            |
| Culvert apron                | Up to 10 m past each barrel end                                        | `designSurface.ts`, `burnRoad` / `carveCulvert` (`apronM`)        | Stops earlier where the ground falls below the invert                   |
| Culvert channel reach        | Barrel half-length + 200 m each way, while in the footprint            | `designSurface.ts`, `carveCulvert`                                | Channel ends                                                            |
| Missing invert               | Lower end ground − 0.3 m, flat                                         | `designSurface.ts`, `carveCulvert`                                | Warning: "inverts missing; channel set 0.3 m below the lower end"       |
| Assumed pipe slope           | 2 % when inverts are missing, flat or adverse                          | `hydrology.ts`, `analyzeDrainage` (`defaultSlope`)                | Slope shown with `*`                                                    |
| Standard diameters           | 0.3, 0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 3.0 m | `hydrology.ts`, `STANDARD_CULVERT_DIAMETERS_M`                    | No size carries Q: minimum shown as "> 3.0"                             |
| Culverts per road            | 100; diameter 0.1–20 m; length 0.2–500 m; skew −80° to 80°             | `engineeringProject.ts`, `parseEngineering`                       | Project refused                                                         |
| Culvert off the road or grid | Chainage outside 0 to road length, or no cell found                    | `designSurface.ts`, `burnRoad`; `hydrology.ts`                    | Warning: "outside the road or the surface grid; not checked"            |
| Pour-point snap radius | 0–2,000 m | `drainageCatchments.ts`, `snapPourPoint` | Invalid requests reject; no supported cell reports an error |
| Catchment/watershed grid | 4,194,304 cells | `drainageCatchments.ts`, `MAX_CATCHMENT_CELLS` | Rejects rather than truncates cells |
| Polygon boundaries | 200,000 raw edges per basin and 200,000 combined watershed vertices | `MAX_CATCHMENT_BOUNDARY_EDGES` | Rejects; increase minimum basin area or coarsen the analysis |
| Watersheds | 1,000 qualifying outlet basins | `MAX_WATERSHEDS` | Rejects; increase the minimum area |
| Portable evidence | 20 road records, 5,000 features per record, 200,000 vertices | `drainageEvidence.ts`, `MAX_DRAINAGE_RECORDS`, `MAX_DRAINAGE_EVIDENCE_VERTICES` | Invalid or oversized evidence is rejected |

**Runtime.** The check runs on the page's main thread and cannot be cancelled. On the published
LiDAR road (1.29 million 1 m cells) it takes about 2–4 s, during which the page does not
respond. Time grows roughly with the cell count, so a run near the 4,194,304-cell budget takes
several times longer. A finished run keeps contributing area and fill depth for both surfaces,
34 bytes a cell including both D8 direction grids: about 44 MB on the LiDAR road and 143 MB at the budget. Peak memory during the
run is higher.

## Pour points, watersheds and portable review

**Drain to a point** selects an arbitrary location on the plan (tap on phones). Choose existing
ground or the design surface and a snap radius. Snapping chooses the supported cell with the
greatest contributing area inside that metric radius, then the nearest cell if areas tie.
Zero radius selects the cell containing the point. No location outside supported terrain is
silently substituted. The result reports both the requested and snapped location, snap distance,
cell count and area.

The catchment is the exact union of cells whose D8 paths reach the selected cell. Polygonization
retains holes and disconnected components touching at a diagonal; it removes only collinear
vertices. **Delineate watershed polygons** partitions supported cells by their terminal D8 outlet,
then keeps basins meeting the entered minimum area. These are disjoint raster basins, not a
hierarchy of nested stream catchments. A catchment or basin touching the sample edge or missing
terrain is labelled as potentially truncated. Absence of boundary contact does not establish
surveyed watershed accuracy.

Project `drainage` stores rainfall, C, n, threshold, buffer, point/snap/surface and optional basin
threshold, plus one compact review record per road. The record includes run date, dependency
fingerprint, terrain/datum/resolution, sampled grid metadata, crossing/diversion/culvert metrics,
catchment and watershed polygons, review locations and warnings. Full accumulation, fill-depth,
direction grids and stream linework remain in memory and are recomputed. Editing geometry,
terrain, criteria or drainage inputs invalidates current use. Imported embedded terrain and
checksummed published terrain retain reproducible source evidence; unchecksummed regional
terrain must be rerun after reopening even if its metadata matches.

**Export drainage GeoJSON** carries review geometry and provenance. **Export drainage evidence**
retains the full compact record and inputs. Stale records cannot be exported as current. The
standard road report includes an escaped drainage chapter with status and the retained inputs,
crossing metrics and per-culvert peak/capacity checks. The generic road shapefile/plot book do not
pretend to contain a full drainage raster.

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
  whole footprint even if the entered barrel is shorter, at inverts interpolated inlet (left) to
  outlet (right). Past each end, an apron of up to 10 m is cut at the end invert until the
  original ground falls below it. A channel passes any flow: capacity is only checked afterwards.
- **A missing invert is guessed.** The channel is set flat at the lower of its two end grounds
  minus 0.3 m. The panel warns, and the pipe slope falls back to 2 %.

### Routing

- **Depressions are filled.** Priority-Flood with ε raises every pit to its spill level, plus
  0.00001 m per cell across the filled area so that water always has a downhill neighbour. Real
  wetlands, lakes and ponds that store water are treated as if they spill. On a flat (a
  hydro-flattened lake, a valley floor, a wide fill) the flow path follows that tiny gradient
  towards the spill point; its position on the flat means nothing.
- **D8 sends each cell's water to one neighbour,** the steepest of eight. Water never splits.
  On open hillsides this concentrates diffuse runoff into parallel lines aligned with the grid,
  and stream positions depend on DEM detail and noise.
- **The grid edge and data holes are outlets.** Every cell on the edge of the sampled rectangle,
  and every cell next to a missing one, drains off the grid. Water from beyond the edge is never
  counted, so a catchment that extends past the buffer is reported smaller than it is. Every run
  warns about this finite catchment; missing sampled ground receives an additional warning.
  The same happens where the terrain itself ends (the published LiDAR is one tile) or
  has no-data gaps (often water bodies in a DTM). The buffer cannot add ground the terrain does
  not have.
- **The sampled rectangle is axis-aligned** on the projected grid, around the centreline and catch
  points plus the buffer. The buffer is a minimum distance in each grid direction, not a
  catchment boundary.
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
- **There is no time of concentration.** The Rational method assumes the storm lasts as long as
  the catchment takes to respond. The tool does not compute that duration, so you must: choose i
  from an IDF curve at a duration matching the catchment's time of concentration and at the
  return period your standard requires. One intensity is used for every culvert, so a small
  cross-drain and a large stream crossing cannot both be right with the same i.
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

## Reading the results

| Result          | Defined as                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream crossing | An existing-ground flow line at or above the stream threshold that enters the road footprint. "Leaves" is where the same water exits the footprint on the design surface; "Carried" is the chainage between the two                     |
| Redirected      | Carried more than 20 m without passing through a culvert channel. "Nearby, bypassed" means a culvert lies within 15 m of the entry but the water does not reach its channel                                                             |
| Ditch low point | A footprint cell where at least 0.05 ha of design-surface flow leaves the prism ("leaves prism"), or a new pond in or beside the footprint draining at least as much ("ponds"). Without a culvert channel it is a cross-drain candidate |
| New ponding     | 8-connected cells filled more than 0.05 m on the design surface where existing ground did not pond, shown as a point at the deepest cell. The tile counts all of them, including ponds dammed behind fill away from the ditch           |
| Culvert sizing  | Design and existing catchments, Rational peak, full-pipe capacity, slope (`*` assumed) and entered/minimum diameter. Capacity in red means the entered pipe does not carry the peak                                                     |

On the plan, design streams are solid blue and widen with contributing area; existing streams
are dashed pale blue. A stream the road turns shows as the two lines parting. Redirected
crossings are red lines drawn straight from entry to exit (not along the ditch), low points
without a culvert are amber, and new ponds are small blue dots. Drainage layers are hidden while
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
- **27 cross-drain candidates.** These are ditch outlets and sags where 0.05 ha or more collects.
  Each is a place to consider a cross-drain, not a requirement for one. Several within a short
  distance can mean one ditch broken by small grade changes rather than separate needs.
- **No culverts.** The road has none yet, so the sizing table is empty. Add the crossings to the
  culvert inventory, enter inverts, re-run and check that each crossing reads "Passes through".

The first version of the check reported 129 ponds on this road. They were not water: the
default 1 m × 0.5 m V ditch is narrower than a cell, and sampling its side slopes at cell centres
on a line skewed to the grid left a staircase of pits. Burning the ditch and fill-toe lines as
continuous minima removed them. The lesson stands for any feature that is narrow compared with
the cell: a ditch, a narrow bench or a small culvert outlet on a 2–4 m grid can still alias into
false ponds or false breaks.

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
| Plan header reads "Drainage out of date · re-run it to show flow" | The road, road settings, terrain or a drainage input changed since the run           | Re-run on the Drainage view                                                          |
| Full streams absent after reload                                 | Only inputs and compact evidence are saved; full grids are recomputed | Review saved evidence and re-run; regional live terrain always needs a fresh run |
| Streams in odd parallel lines on a planar slope                   | D8 on smooth ground                                                                  | Raise the stream threshold; read streams on such slopes as approximate               |

## What it does not do

- **It does not save full raster grids.** Only settings and compact review evidence travel in
  projects; the latest three full in-memory road runs can be inspected until reload. The
  browser setting `pgmaps-road-drainage-settings` is a fallback for older projects without
  project inputs, not the sole record.
- **No wetness index, time of concentration, hydrographs, hydraulic grade
  lines, inlet control, headwater, scour or outlet protection.**
- **No ditch capacity or erosion check.** Ditches carry whatever reaches them.
- **No fish passage, channel stability or debris-flow assessment.**
- **Not a hydrotechnical design.** It is a planning screen for where water goes and roughly how
  much. In British Columbia, stream crossings on forest roads are normally designed or reviewed
  by a qualified professional, with a hydrotechnical assessment where the site warrants it, and
  the design flood, sizing method and documentation are set by the regulations, ministry manuals
  and professional guidelines that apply to your tenure. This tool applies none of them. Use its
  results to find the sites that need that work, not to replace it.
