# Alignment and optimization: limits and checks

This guide covers horizontal curves, spirals, curve design, pegging, the vertical profile and
its checks, and the three search tools: the profile optimizer, the terrain-cost route search
and the sketched corridor optimizer. The geometry itself is specified in the
[workspace contract](../forestry-road-design.md#geometry-and-calculations) and
[corridor optimization](../forestry-road-optimization.md); this guide says when to trust it.

See [Forester constraints and route comparisons](planning-constraints.md) for sourced BC
planning considerations, saved route assumptions, clearance/slope screens, reviewed road
reuse and live preview behavior.

The final-connector adoption gate is documented in [Final connector checks](final-connector-checks.md), including dense-section/terrain/geometry budgets and unknown results.

## Before you rely on a design

- **No sharp PIs left.** A corner with radius 0, or a radius that does not fit its tangents,
  stays a sharp PI. The station is flagged "Sharp horizontal PI: curve required" and the
  workspace warns. Select the point in **Horizontal points**: the note under its radius gives the
  tangent the curve needs, the leg or neighbouring curve that is short, and the largest radius
  that fits. Route and corridor results start as new roads, so check them again.
- **Radii checked against the speed, not only the minimum.** The minimum-radius flag compares
  each arc with the road-wide **Minimum radius** (default 25 m, `DEFAULT_ROAD_SETTINGS` in
  `terrain.ts`). With curve design enabled, required versus capped superelevation is checked too; conflicting curves are flagged and fail the final connector gate. See
  [Built-in assumptions](#built-in-assumptions).
- **A vertical alignment exists.** Without PVIs the formation follows the ground at the
  centreline. Grades are then ground grades, and cut and fill come only from the template's
  shape on the side slope.
- **Vertical checks are on and clean.** Grade ranges, minimum K, curve and tangent lengths and
  control points are checked only when the road has two or more PVIs and at least one standard
  or control is set (`analyzeRoad` in `engine.ts`). An empty field is not checked.
- **No "does not fit" or "overlaps" warnings.** A vertical curve that does not fit, or that
  overlaps its neighbour, is dropped and the sharp grade break is used instead.
- **Ends meet what they connect to.** After an optimized profile, check the formation at both
  ends against the existing road, landing or crossing. The search may have moved them.
- **Coverage is 100 %**, or you know why it is not. Costs and quantities are covered subtotals.
- **The alternative you compare against has the same inputs.** Route and corridor results do
  not copy the engineering design, curve design, vertical standards or controls. See
  [Reading optimizer and route results](#reading-optimizer-and-route-results).

## Limits and budgets

### Horizontal geometry and curve design

| Limit                                        | Value                                                                       | Enforced in                                                                | When exceeded                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Horizontal points per alignment              | 2,000                                                                       | `engine.ts` `compile`                                                      | Error                                                           |
| Alignment length; distance from first point  | 100 km each                                                                 | `engine.ts` `compile`                                                      | Error                                                           |
| Horizontal radius                            | 0–10,000 m                                                                  | `engine.ts` `MAX_HORIZONTAL_RADIUS_M`, `project.ts`                        | Error; the radius field holds it and says so                    |
| Curve tangent (trim)                         | must be shorter than both legs                                              | `engine.ts` `compile`                                                      | Sharp PI kept, warning, note under the radius field             |
| Adjacent curves                              | trims must not overlap on the shared leg                                    | `engine.ts` `compile`                                                      | Both become sharp PIs, warning, note naming the neighbour       |
| Spiral length each side                      | 0–2,000 m                                                                   | `project.ts`, `CurveTools.tsx`                                             | Rejected                                                        |
| Spiral against deflection                    | Ls / R must be less than Δ                                                  | `engine.ts` `compile`                                                      | Simple curve used, warning                                      |
| Bulk fit: tangent use                        | 98 % of each leg (`FIT`)                                                    | `horizontalTools.ts`                                                       | Radius reduced; notice counts it                                |
| Bulk fit: largest radius                     | 10,000 m                                                                    | `horizontalTools.ts`                                                       | Capped                                                          |
| Polyline to alignment: maximum deviation     | 0.1–500 m (`MIN_FIT_DEVIATION_M`, `MAX_FIT_DEVIATION_M`)                    | `polylineFit.ts`, `CurveTools.tsx`                                         | Error, or the field rejects it                                  |
| Polyline to alignment: source points         | 5,000 (`MAX_FIT_SOURCE_POINTS`)                                             | `polylineFit.ts`                                                           | Error: thin the line first                                      |
| Polyline to alignment: tangent use; merge    | 98 % of each leg; corners merged up to 120° of turn (`MAX_MERGED_TURN`)     | `polylineFit.ts`                                                           | Curve reduced, or the corners stay separate                     |
| Road from a found route: fit; smallest curve | within 2, 4, 8 or 16 m (`ROUTE_FIT_DEVIATIONS_M`); 5 m (`SMALLEST_CURVE_M`) | `routeFit.ts`                                                              | Tighter fit tried; corner left sharp                            |
| Design speed                                 | 1–150 km/h                                                                  | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Maximum superelevation; side friction f      | 0–20 %; 0–1                                                                 | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Runoff; widening vehicle length              | 0–1,000 m; 0–50 m                                                           | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Stations per analysis                        | 3,000 (`MAX_STATIONS`)                                                      | `engine.ts` `analyzeRoad`                                                  | Spacing widened with a warning; error if events alone exceed it |
| Road alternatives per project                | 20                                                                          | `VerticalDesignControls.tsx`, `DesignSidebar.tsx`, `sidebar/DesignTab.tsx` | Buttons disabled or error                                       |

### Vertical alignment and profile optimizer

| Limit                         | Value                                                             | Enforced in                                          | When exceeded                                                |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| PVIs per alignment            | 500, at least 1 mm apart                                          | `engine.ts` `verticalProfile`                        | Error                                                        |
| PVI drag in the profile       | at least 5 m from each neighbour; adjacent tangents at most 100 % | `verticalTools.ts` `MIN_PVI_GAP_M`, `MAX_DRAG_GRADE` | Drag stops at the limit                                      |
| Tangent steeper than 100 %    | allowed when typed, with a warning naming the two PVIs            | `engine.ts` `verticalProfile`                        | Warning                                                      |
| Vertical curve                | half its length must fit each adjoining tangent                   | `engine.ts` `verticalProfile`                        | Curve dropped, warning, note under the PVI                   |
| PVI spacing                   | at least 10 m (UI 10–1,000 m)                                     | `verticalOptimizer.ts`, `VerticalDesignControls.tsx` | Error                                                        |
| Search ±, level step, K       | UI 0.5–30 m, 0.1–5 m, 0.1–1,000; K 0 or more in the search        | `VerticalDesignControls.tsx`, `verticalOptimizer.ts` | Field rejects the value; a negative or missing K is an error |
| Level transitions             | 5,000,000 across all price runs (`maxTransitions`)                | `verticalOptimizer.ts`                               | Error: coarsen the level step, reduce depth or widen spacing |
| Section solves                | 60,000 (`maxSectionSolves`)                                       | `verticalOptimizer.ts`                               | Error: widen spacing or coarsen the step                     |
| Depth band between PVIs       | ± (search ± plus about four level steps); ±7 m at defaults        | `verticalOptimizer.ts` `rows`                        | Station priced as incomplete                                 |
| Incomplete-section penalty    | $5,000 per m (`incompletePenaltyPerM`)                            | `verticalOptimizer.ts`                               | Added to the search cost only                                |
| Simplification                | 0.3 m, then 0.15 and 0.075 m; kept if cost rises at most 1 % + $1 | `verticalOptimizer.ts` `finish`, `SIMPLIFY_SHARES`   | Unsimplified line kept                                       |
| Imbalance prices (total cost) | 0, 0.25, 0.5, 1, 2 × max(1, fill, borrow, waste rate)             | `verticalOptimizer.ts` `prices`                      | —                                                            |

The dynamic programme runs on the page's main thread in slices of about 12 ms
(`COOPERATIVE_SLICE_MS` in `cooperative.ts`), so the page keeps answering, the progress line
shows a percentage and **Cancel** stops the run at the next slice. It also stops at its
level-transition budget. Its work grows rapidly with levels per PVI (2 × search ÷ step + 1), up
to five times over for **Total cost**. For each last-level pair and proposed next level, a sorted prefix query
selects the cheapest predecessor that leaves enough tangent; it does not repeat the same
transition for every nondominated history. Those histories are retained where their curve
occupancy affects future feasibility. At the defaults (±5 m, 0.5 m) that is 21 levels; a fine
±30 m search in 0.1 m steps has 601 levels and will usually need a coarser step to finish.
The search refuses non-finite inputs and more than 500 proposed PVIs before allocating levels.

### Route search

| Limit                                                 | Value                                                                                                                             | Enforced in                  | When exceeded                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| Endpoint separation                                   | 2 m–15 km                                                                                                                         | `routing.ts` `suggestRoutes` | Error                              |
| Ground-grade limit                                    | above 0 % and at most 60 %                                                                                                        | `routing.ts`                 | Error                              |
| Search margin; grid                                   | Automatic 35 % of separation (80–1,000 m), or entered 20–1,000 m; at most 96 nodes per side (`MAX_GRID_SIDE`), at least 2 m apart | `routing.ts`                 | —                                  |
| Grid nodes                                            | 10,000 per attempt (`MAX_VISITED`); 40,000 × alternatives in total                                                                | `routing.ts`                 | Error                              |
| Fine-check retries                                    | 4 attempts                                                                                                                        | `routing.ts` `search`        | Error; no unchecked route returned |
| Terrain samples; geometry checks                      | 450,000; 2,000,000                                                                                                                | `routing.ts`                 | Error                              |
| Stream, exclusion and eligible existing-road vertices | 20,000                                                                                                                            | `routing.ts`                 | Error                              |
| Alternatives                                          | 1–5; at most 70 % shared edges                                                                                                    | `routing.ts`                 | Fewer alternatives returned        |

### Sketched corridor optimizer

| Limit                                   | Value                                                                  | Enforced in                                     | When exceeded                                 |
| --------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Guide points                            | 2–100                                                                  | `corridorOptimizer.ts` `search`                 | Error                                         |
| Endpoints; sketch extent; sketch length | 10 m–5 km apart; within 7 km of the start; 15 km                       | `corridorOptimizer.ts`                          | Error                                         |
| Corridor half-width                     | 25–1,000 m (default 180 m)                                             | `corridorOptimizer.ts`, `sidebar/DesignTab.tsx` | Error or button disabled                      |
| Ground-grade limit                      | 1–30 %, taken from the road's grade limit                              | `corridorOptimizer.ts`                          | Error                                         |
| Minimum radius                          | 0–1,000 m, from the road settings; searched at no less than 5 m        | `corridorOptimizer.ts` `MIN_SEARCH_RADIUS_M`    | Error above 1,000 m                           |
| Search states                           | 50,000 (`maxStates`)                                                   | `corridorOptimizer.ts`                          | Budget-limited result, or error if none found |
| Search weight                           | 1–5 (`searchWeight`); 1, or 2 with a ground penalty                    | `corridorOptimizer.ts`                          | Error                                         |
| Terrain samples; geometry operations    | 3,500,000 (`maxTerrainSamples`); 200,000,000 (`maxGeometryOperations`) | `corridorOptimizer.ts`                          | Error                                         |
| Candidate length                        | the lesser of 15 km and 3 × sketch length + 4 × half-width             | `corridorOptimizer.ts`                          | Branch not searched                           |

Geometry operations include guide-distance and corridor checks even with no supplied constraints.
If that budget is reached, narrow the corridor, shorten/simplify the guide or crop constraints.
The API accepts a lower geometry-operation budget; it cannot raise the 200,000,000 ceiling.

The search works on cells of the corridor's longer side ÷ 140, never finer than 3 m, in strides of
twice that (at least 12 m) and 32 headings, and reads ground every 1 m along each line
(`corridorSearchResolution`). **Find the best route → Search settings** shows these figures for the
current road and corridor before a run.

A search that ends without a road throws `CorridorSearchError`. Its `failure` says whether the
budget ran out or every line was tried, how near the end the search got, and how many trial lines
each check stopped: grade, missing terrain, a blocked area or the corridor's edge.

### Pegging

| Limit                  | Value                                                                | Enforced in                                      | When exceeded                        |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Peg distance (new peg) | 0.2–1,000 m                                                          | `pegging.ts` `findGradePeg`, `PeggingEditor.tsx` | No solution, or field rejects it     |
| Leg samples            | 1 m, at most 2,000 per leg                                           | `pegging.ts` `measurePeg`                        | Legs over 2 km sampled more coarsely |
| Ground-grade search    | ±90° of the bearing, 2° brackets, match within 0.01 %, full coverage | `pegging.ts` `findGradePeg`                      | "No covered ground-grade solution"   |

## Built-in assumptions

### Curve and switchback review

**Horizontal curves** (the four-pane data pane, or **Stations** in the detail view) reviews the geometry actually fitted. Simple curves have BC/EC
events; spiralled curves have TS/SC/CS/ST, with full deflection and length including both spirals.
Each event selects the shared plan/profile/section station. The compact table expands to show
inside/outside formation widths, inside formation radius, inside daylight radius, profile grade,
curve widening and required/capped/actual crossfall. **Curve CSV** exports these same values,
criteria, source provenance, missing-data status and screening assumptions.

The detailed width, radius, grade and crossfall ranges use calculated sections on the **circular
arc**. They are sampled ranges, not continuous extrema. Full-curve completeness is the count
of complete calculated sections, not a certified coverage or safety result. A missing daylight
keeps its radius unknown; it does not suppress a known folding warning at another section.

The optional inner-edge grade screen is `g_inner = g_centreline × R / (R − w_inside)`. It is
available only with an independent formation profile, known grades, positive inner formation
radius, and constant sampled inside width/crossfall over the arc. Variable widths or crossfalls
make the screen unavailable. Spirals, runoff, wheel tracks and vehicle offtracking are excluded;
this is not an allowable truck grade. The actual edge profile requires additional terms when
offset or crossfall changes.

An inside formation or daylight reaching the curve centre receives a folding/overlap review
flag. This screen does not detect every contact between separate switchback legs, correct the
average-end-area volume model for curvature, or establish a vehicle swept envelope. Successive
arcs are still reviewed separately; a multi-curve switchback requires a complete vehicle
maneuver review. No automatic BC vehicle/table preset is implied by these calculations.

Required superelevation follows the speed/friction equation. **Capped rotation target** is
its nonnegative, capped value; **actual inside/outside crossfall** comes from the resolved
section, including its template crown. Positive crossfall falls away from the centreline.
Retaining a crown can make actual crossfall exceed the entered maximum even when the target is
smaller. When the requested bank is positive, the curve review flags this for correction and
the final connector checker rejects that exceedance at its dense circular-arc stations. A zero
requested bank retains ordinary normal crown and is not treated as applied superelevation.
Neither check silently changes the entered section. The final connector checker also rejects
known local formation/daylight folding; see [Final connector checks](final-connector-checks.md)
for its sampling limits and the separate-leg overlap and vehicle checks it does not perform.

**Curve design.** Superelevation is e = V²/(127R) − f, held between the normal crown and the
maximum (`curveDesignAt` in `engine.ts`). f is one entered value, not a speed-dependent table.
The workspace starts curve design at 40 km/h, 8 %, f 0.15 and 30 m runoff
(`CURVE_DESIGN_START` in `CurveTools.tsx`). When the formula asks for more than the maximum,
the displayed geometry remains capped, but the curve is flagged and cannot pass the final connector gate.
At those defaults a 25 m curve needs 35.39 % and gets 8 % with an explicit conflict. The independent
minimum-radius flag still applies. Name the entered criteria and record the document/edition in
**Criteria source**; those text fields do not certify compliance with a published standard.

The optional rectangular widening table has `radius,deflection,inside,outside` CSV entries. It replaces
the vehicle formula, bilinearly interpolates side widths, and uses edge values with a warning outside
its extent. Extra inside/outside widths are added afterwards. The table supports at most 400 entries
(`roadCriteria.ts`, `MAX_WIDENING_TABLE_ENTRIES`); missing combinations, duplicate pairs and invalid
values are rejected. The fitted deflection includes spiral heading change.

**Runoff on simple curves** runs on the tangent before the PC and after the PT. Full
superelevation is reached at the curve itself, not shared between tangent and curve.
Without a table, widening L²/(2R) goes on the inside edge; independent added inside/outside widths are also available.

**Spirals.** On a spiralled curve, superelevation and widening run in linearly over the longer
of **Runoff** and the spiral, ending at the SC, and run out from the CS over the same length
(`curveDesignAt` in `engine.ts`). With runoff no longer than the spiral they follow the spiral
exactly: 0 at the TS, full at the SC. A longer runoff starts the extra length on the tangent
before the TS (after the ST). Between opposite curves, each transition is limited to its
spiral plus half the intervening tangent. Both reach normal crown and zero curve widening
at the tangent midpoint, including when the spiral lengths differ. Closely spaced reverse
curves can therefore have a shorter effective runoff than entered; review the rotation rate.
The tolerance in **Best fit every corner** uses the simple-curve external distance
E = R(sec(Δ/2) − 1). With spirals the arc sits farther from the corner, so the fitted curve can
miss the tolerance.

**Chainage is measured on a sphere.** Lengths, radii and stations come from a great-circle
model with the mean Earth radius (`distance` in `engine.ts`, R = 6,371,008.8 m). At Prince
George that measures east–west distances about 0.3 % short of the projected grid (983.0 m of
chainage is 985.9 m in UTM zone 10), north–south about 0.06 % short. Stations, grades and
volumes all use chainage. LandXML writes grid lengths beside chainage stations and states the
ratio (see [Exports and project files](exports-and-project-files.md#landxml)).

**Bulk radius fit** keeps radii you set when you use **Fit sharp corners** (default 35 m). It
rounds radii down to 0.1 m, and a radius its tangents hold comes back exactly as asked. It reports
a radius below the minimum in the notice only; the station flag then marks it.

**Polyline to alignment** (**Reduce points, fit curves**, `fitPolylineAlignment` in
`polylineFit.ts`) turns a line of many points into few points with a curve at each. It takes one
value, **Max deviation**, and the road-wide minimum radius.

- A road with no curves is read along its points; a road that already has curves is read along its
  centreline, sampled every 2 m, so existing curves are followed rather than their corners.
- It tries nine point reductions (Douglas–Peucker at shares of the deviation from all of it to
  none) and, for each, the same line with neighbouring corners that turn the same way merged into
  one point where their tangents meet. It keeps the result with the fewest sharp corners, then the
  fewest points.
- Every fitted curve is at least the minimum radius and as large as the deviation and its tangents
  allow, up to 1,000 m. A corner that cannot take the minimum radius inside the deviation stays
  sharp and is counted; **Fit sharp corners** then gives it the largest curve its tangents hold.
- A minimum radius of 0 means none is set. Curves are then fitted from 5 m up (`SMALLEST_CURVE_M`,
  `fittedMinimumRadius`): a tighter one is a sharp corner in all but name. The same holds wherever
  a search or fit reads the minimum radius: found routes, **Find the best route** and the corridor
  optimizer, which draws no curve under 5 m (`MIN_SEARCH_RADIUS_M`).
- The notice gives points before and after, the number of curves and the tightest, the largest
  distance between the old line and the new centreline, and both lengths. That distance is measured
  on the result at 1 m samples, both ways; it is not assumed from the tolerances.
- Stations along the road move. A profile, widenings and anything else set by station keep their
  stations, so check them after reducing a designed road.

**Pegging.** Bearings are true bearings. **L-Stn** in the pegging table is the running
peg-to-peg distance, not road chainage: fitted curves cut the corners, so road stations are
shorter. **Find ground grade** matches the grade between the two peg ends only. The leg between
can be steeper; read "steepest sampled grade" in the preview. The search changes the bearing
and keeps the distance, and always pegs from the last point.

**Vertical checks.** Grade ranges and the road-wide grade limit are checked at the analysis
stations (default every 10 m, plus curve and event stations), not continuously. K, curve
lengths and controls are checked at their own stations. A grade break below 0.05 % is not treated as unrounded. The first
and last tangents are exempt from the minimum tangent length.

**Profile optimizer** (`verticalOptimizer.ts`):

- **Search band centre** chooses ground or the current fitted design. The area tables use the same
  reference, so a design high above ground is not silently searched around ground instead.
  Levels remain on the entered discrete ladder. "Tie both ends to ground" means
  centreline ground at 0+000 and at the road end, not an existing road's formation. To tie to
  a structure, add a control point at that end instead; a control there overrides the tie.
- Grade and curvature range boundaries are mandatory search stations. Global and range-specific
  sag/crest K values combine with **Curve K** by taking the strictest value. Linear-only ranges
  exclude curves and grade breaks. The DP retains the preceding occupied half-curve and a Pareto
  frontier of cost/tangent occupancy, enforcing curve fit and interior tangent lengths during search.
- A control's own elevation is a search level exactly as entered, to any number of decimals, and a
  free PVI beside a grade control also gets the levels that run at exactly that grade from it.
  Levels a control depends on are not rounded; all others are whole millimetres. A control at the
  ground or profile value the workspace filled in, held to ±0, is therefore always inside the search.
- **Gaps in the terrain.** A PVI that the spacing puts on a gap slides to the nearest station with
  ground, up to half a spacing away, and the log counts it. If nothing that near has ground, the PVI
  stays and its levels are centred on ground read across the gap from the stations either side.
  Stations on the gap have no section, so they are priced as incomplete and left out of the
  quantities. An end tied to ground must have ground under it: otherwise the run stops and names
  the end.
- Curves keep their required lengths rather than being silently shortened below K. The complete
  fitted result is rechecked against every standard and control before returning.
- **Every curve of a returned profile is built.** The engine drops a vertical curve that does not
  fit its tangents or overlaps its neighbour and keeps the tangent grades, so a result is read back
  through the engine's own curve fit (`curveFault`). A line with a dropped or short curve is
  repaired by taking out the free PVI nearest the line through its neighbours, which lengthens the
  tangents (`withFittedCurves`); the log counts the PVIs removed. If only controls and the road
  ends are left to remove, that trial line fails and the message names the grade break, the curve
  it needs and the tangent it has.
- Elevation controls are corrected against the actual parabolic profile in at most 24 bounded
  iterations, then rechecked. This handles the middle-ordinate shift at a control on a grade break.
  An unsatisfied or infeasible control rejects the candidate; no missed control is accepted.
- Between PVIs, a station more than about the search ± plus four level steps from the selected band reference is
  priced as incomplete at $5,000 per m. Deep fills over a gully between PVIs are discouraged,
  not costed.
- **Cut and fill** minimizes cut × cut rate + fill × fill rate only. Surfacing and clearing are
  left out. **Total cost** picks, from five imbalance prices, the line that the full analysis
  prices lowest, haul, borrow and waste included.

**Route search** (`routing.ts`) uses only the first and last points of the active road. It
moves in eight directions on the grid, so every bend of the route it finds is a multiple of 45°.
The grade limit applies to ground slope in both directions, read on the ground trend where one is
set.

Each route then becomes a road (`terrainCostAlternatives` in `routeAlternatives.ts`, `roadFromRoute`
in `routeFit.ts`):

- **Curves.** The tightest polyline fit of 2, 4, 8 or 16 m that rounds every corner, with radii
  between one and two times the minimum, kept only if every metre of its centreline has ground under
  it and it enters no blocked area. A corner with no room for the minimum radius takes the largest
  curve its tangents hold, of 5 m or more, and is flagged below the minimum radius. A corner where
  no curve stays on the terrain stays sharp. The notice counts both. With no minimum radius set (0),
  radii run from 5 to 10 m and none is flagged as tight.
- **Name.** `<road> · terrain-cost route <n>`: the lowest number free, an identifier only. A search
  run from a found route names its roads after the original road, not after the route.
- **Record.** The road keeps the search's rank, score, length and crossing count (`routeSearch`,
  saved with the project). **Search tools → Routes found** lists them with the score and what each
  road breaks as it stands: sharp corners, curves under the minimum radius, sections with no ground,
  and ground steeper than the limit while the road has no profile. That last figure is raw ground
  between stations, which reads steeper than the trend the search held to the limit; fit a profile
  to see the designed grade.
- **Replacement.** The next search removes the found roads nobody has changed: same points and name,
  no profile, widenings, standards, controls or engineering. A road you rename, edit or design is
  kept, and so is the road the search runs from. One Undo brings the replaced roads back. Replaced
  roads leave room for new ones against the 20-road limit.
  Edge cost is road
  $/m × (1 + 3(g/gmax)²), plus crossings and zone costs. The defaults, $100/m and $8,000 per
  crossing (`DEFAULT_ROUTE_OPTIONS`), are placeholders. A stream's explicit **crossing cost** overrides
  its named class, then the default. Class prices are saved in `routeSearch.crossingGroups` (at most
  100 classes; `parseRouteSearchOptions`), while feature prices/classes are saved with context and GeoJSON.
  Shared vertices within a feature are counted once. Existing no-go line/polygon constraints remain separate.

**Corridor optimizer** (`corridorOptimizer.ts`) checks ground grade between 1 m samples
against the road grade limit, uphill and downhill alike in the UI. Its turns are arcs with
2 m tangents between them, so one bend can become several PIs. Radii are a few discrete values
at or above the minimum radius, and never under 5 m (`nominalTurnRadiusM` in the report). Exclusions apply to the
centreline only, with no clearance in the UI. There are no spirals and no vertical design.

## Ground trend

`groundTrend.ts`. A 1 m DTM carries relief no road follows: stump holes, skid ruts and windthrow
mounds. Compared between neighbouring 1 m samples, that reads as 30 % or more on a hillside a road
crosses at 6 %. On the published LiDAR tile, the route and corridor searches found nothing at
limits from 10 % to 15 % between the ends of the default 5.7 % road, even though it exists.

So a search reads grades from a moving mean: **Ground trend**, 12 m by default on cells of 3 m or
finer and off on coarser terrain, which has already averaged the relief away. It is saved as
`routeSearch.groundWindowM`; null picks the default for the terrain (`resolvedGroundWindow`). Each
mean is 25 samples over the window at nodes half a window apart, interpolated bilinearly.

- Missing ground still comes from the source, sample by sample. The trend cannot average away a gap.
- A window that partly leaves the data uses the samples it has, so an end near a tile edge still works.
- Only searches read it. Designed profiles, sections and quantities use the source terrain.
- It is a screen: a sharp real bench narrower than the window is also smoothed, and shows up later
  in the profile and sections.

## Find the best route

**Design → Find the best route** (`RouteFinder.tsx`, `routeComparison.ts`) takes the ends of the
active road, plus its interior points simplified to at most 8 as a guide, and designs one road per
goal. Your road is never edited. Clicking a row adds that road and makes it active, so every chart
and table shows it; **Compare all** adds the rest and opens Compare. The switcher above the summary
tiles then flips between roads from any tab or view.

| Goal                   | Horizontal line                                                                                                    | Profile                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Lowest cost            | Prices the shortest, balanced and contour lines, drainage allowance included; keeps the cheapest within the limits | Cheaper of cut/fill and total |
| Shortest               | Corridor search, `shortest`                                                                                        | Total cost                    |
| Gentlest               | Corridor search, `contour`                                                                                         | Total cost                    |
| Fewest drainage issues | Corridor search, `balanced`, charged for ground that carries flow                                                  | Total cost                    |

Lowest cost then refines the plan and profile for up to 10 trials when the line has at most 12
interior controls. Refinement sees only the build price, so its result is kept only when the total,
drainage allowance included, comes down.

**Rows are named by what was measured, not by the search that made them** (`assignGoals`). Each goal
goes to the road leading it among those that meet every limit, your road included, with ties to the
cheaper. One road can hold several goals, and a road leading nothing is left out. A road that breaks
a limit or found no line shows only when no other road holds its goal. When no search produced a
road at all, every failed goal stays: your road then holds each goal only because nothing was set
against it. Goals that failed for the same reason share one line. Your road shows the goals it
already leads.

**How a line is found** (`horizontal` in `routeComparison.ts`). Each step is tried only when the
one before found nothing, and the row's note says which one produced the road:

1. The corridor of the entered half-width around your road, searched evenly.
2. The same corridor searched again leaning toward the end (`QUICK_SEARCH_WEIGHT`, 2.5), when the
   first search spent its whole budget. On the LiDAR hillside this reached ends 1.1 km apart in
   under 3 s where the even search ran out. The line can be longer than a larger budget would find.
3. Twice the half-width, up to ±600 m, when the corridor was searched out with no line.
4. A terrain-cost grid route between the ends, searched once for all goals, then a road fitted
   inside ±40 m of it (`ROUTED_HALF_WIDTH_M`). The grid route already meets the grade limit, so the
   search only has to round its corners, and a tube that narrow is searched in a second or two.
5. The grid route itself with curves fitted (`roadFromRoute` in `routeFit.ts`): the tightest
   polyline fit of 2, 4, 8 or 16 m that rounds every corner at between one and two times the
   minimum radius, kept only if every metre of its centreline has ground under it and it enters no
   blocked area. If no fit stays clear, the route as found, with sharp corners.

What one goal learns about a corridor the others reuse. The limits a line must meet do not depend
on the goal, so a corridor one goal searched out, or spent both searches in, is skipped by the
rest. That bounds a comparison to two budget-length searches of each corridor, however many goals
are asked for. The drainage goal steers inside the corridors only; past them it takes the balanced
line and says so. A goal with no route at all does not stop the others.

**A goal with no road says why** (`describeCorridorFailure`). The row names the limits, how near
the end the search got, whether it ran out of budget or of lines to try, the check that stopped the
most lines (grade, gaps in the terrain, blocked areas or the corridor's edge) with its share, and
what to change. It is the report of the search that got nearest the end, and it is used only for a
goal that found no line (`failureText`). A goal that found a line and could not fit a profile to it
says so and gives the profile's reason; one whose search could not start, such as a grade limit over
30 %, gives that. Lowest cost tries three lines and reports a lost line before a line never found.
Goals that failed for the same reason share one row.

**The notice counts what came back** (`comparisonSummary`): how many routes, how many of them
carry a flag, and the goals left without one. With no route at all it is an error that repeats the
reason, never "ready". "No new road beat yours on these goals" means roads were designed and yours
leads every goal; it is not shown when every search failed.

**Progress and Cancel.** Every search and profile fit runs in slices of about 12 ms
(`cooperative.ts`), so the page keeps answering. The progress line names the step, what it is doing
and the share of that search's own budget spent: a search that finds a line early stops well short
of 100 %. **Cancel** hands the workspace back at once and the run stops at its next slice. The
longest stretches that cannot be split are the grid route and one drainage screen, each well under
a second on the LiDAR tile.

**Drainage has two parts.** The drainage goal steers: flow is modelled on 4 m cells over the corridor
plus 150 m, and ground carrying five times the stream threshold costs about 20 m of road per metre,
more for larger catchments, so a crossing is worth about 240 m. Smaller gullies are left to culverts:
pricing every 1 ha flow line on a LiDAR hillside exhausted the search. A goal that cannot steer
reports it and uses the balanced line.

Every row, the current road included, is then screened with `runDrainage` on cells of at least 2 m
and a buffer of at most 150 m. That is coarser than the Drainage view, and the counts can differ:
run the view on the road you pick. Low points within 40 m of each other are one cross-drain site.

**Total** is the base engineering estimate plus a drainage allowance: stream crossings without a
culvert at **Stream crossing ($)**, default $8,000, and cross-drain sites at **Cross-drain ($)\*\*,
default $1,500. Both are placeholders. The allowance is a planning figure in the comparison only; it
does not enter the road's estimate, because no culvert has been sized or placed.

**A row with a blocker cannot lead.** Grades over the limit, incomplete sections and sharp corners
keep a road out of the Cheapest, Shortest, Gentlest and Best drainage tags, however low its price. A
road with no designed profile follows the ground, so it can look cheap while breaking the limit.
So does a road whose material plan is not solved or cannot be met (`materialPlanGap`): no movement
is adopted, so its estimate has no haul, borrow, waste or site preparation. One road read $38,873
with its plan unsolved and $41,215 solved. Its row says the cost leaves those out, and of two
profiles fitted to one line the one with a solved plan is kept.

**Comparing like with like.** New roads carry the active road's template only. If the current road
has culverts, materials or haul inputs, its estimate includes them and theirs does not.

Time on the published LiDAR tile, all four goals, on a loaded desktop: about 30 s between the ends
of the example road, about half of it the Lowest cost refinement; about 40 s for ends 1.1 km apart
across a 40 % hillside, where both searches of the corridor run out and the road follows the grid
route; about 15 s to report that no line reaches an end on a 60 % face.

**Sections can still be incomplete.** The searches check ground under the centreline only. On
terrain with scattered gaps, a found road often has a few sections whose batters run onto a gap,
and its row says "98% of sections complete". Such a road cannot lead a goal; open it and move the
points beside the gap.

## Reading optimizer and route results

**"Optimized" means lowest under one objective, inside the search you set.** The profile
optimizer is exact only on its own grid of PVI stations and levels, with linear grades between.
A finer step, wider search or different spacing can find a cheaper line. The route and corridor
searches are bounded heuristics with no global-optimality claim.

**Untied ends are part of the gain.** On the published LiDAR road, the total-cost optimizer
with ends untied, ±12 m and K 4 lowered the covered cost from $795,170 to $419,157 and
earthworks by 46 %. Its line ends about 11 m above ground at 1+050. Some of that saving comes
from leaving the end in the air. With both ends tied the search is infeasible, because the last
segment drops about 25 %. Before you accept an untied result, pin each end with a control
point at the elevation it must meet and run again.

**Simplification.** The search places a PVI every spacing step. Douglas–Peucker at 0.3 m then
drops PVIs, and the simpler line is kept only if every one of its curves still fits, it has no
vertical check failures, no grade over the limit, no less coverage and no more than 1 % + $1 extra
objective cost. Fewer PVIs mean larger grade changes and longer curves, and two of them can meet on
a short tangent: on rolling 400 m roads that happened on 2 of 25 terrains at K 10 and 6 of 25 at
K 20. Half and a quarter of the tolerance are then tried, and the message gives the one used.
Both simplified and unsimplified candidates must pass the final vertical standards,
controls and road-wide grade checks before a result is returned. If no tested candidate
passes, optimization reports an error and creates no road.

**Infeasible.** "No profile meets the limits between _a_ and _b_" names the first PVI interval
where no line survives, then the check that removed the last of them, in the order the search
applies them (`infeasible` in `verticalOptimizer.ts`):

- the **grade limit**: the grades every line in the band would run at there, the limit they break,
  and whatever holds the line at either end of the interval (a control, or an end tied to ground);
- a **control point**, by its number and station: its grade against the grade limit, or the fact
  that no line in the band runs through it;
- **curvature**: the shortest curve the grade change needs against the distance to the PVIs either
  side, or a straight-grade-only range the change falls in;
- the **minimum tangent** before a curve.

Each message ends with what to change. It names one interval and one check; an earlier limit
can be what left too few lines to reach that interval, so loosen the named one first and run again.
"The road start (0+000.0) is on a gap in the terrain" means a tied end has no ground under it.

**Result log.** After a run, **Last run** under the button lists what the search used and what
came back (`verticalOptimizationLog`): sections sampled and their spacing, PVIs searched and kept,
the band, the grade and curve limits, how each end was set, every control with the value the line
holds there, the objective, then steepest grade, cut and fill, waste or borrow and cost from the
full analysis of the returned line. Waste is usable cut left after filling, as bank volume; borrow
is fill still needed. Notes underneath say what the run could not do: length with no complete
section, PVIs moved off gaps, earthwork out of balance by more than a tenth of cut plus fill (and
50 m³), an untied end left above or below ground, PVIs taken out so every curve fits, and trial lines
dropped after curve fitting. The
log belongs to the road or named profile the run produced and goes when you open another.

**Budget-limited.** The corridor optimizer can return a verified candidate after reaching its
50,000-state budget; the review dialog and report say "budget-limited". Better alternatives may
exist. Route search and the profile optimizer stop with an error instead. In **Find the best
route**, a line found by the second, quicker search of a corridor carries a note that a more direct
line may exist.

**Dollars and relative costs.**

- Profile optimizer: dollars at your entered rates. The notice compares covered estimates
  before and after. A line with less coverage can look cheaper.
- Route search: a **search score** in dollars under the route model only (road $/m scaled by ground
  grade, plus crossing and zone costs). It ranks the routes of one search and is shown under
  **Routes found**, never in a road's name. It is not the road's estimate and will not match it:
  the estimate prices earthworks, surfacing and clearing at your rates. Edges are priced at sampling
  of at most 5 m; the final 1 m check accepts or rejects them but does not reprice.
- Corridor optimizer: relative units, never dollars. A mapped stream contact adds 150 units.

**New alternatives start from different inputs.** The profile optimizer copies the whole road,
including its engineering design, curve design, standards and controls. Route and corridor
results copy only the template. Their cost has no haul, structures, mobilization or contingency,
no superelevation or widening, no vertical design and no checks.

**Compare alternatives** shows eligible metrics against the chosen baseline as (other − baseline) ÷
|baseline|, rounded to whole percent. Within ±0.05 % it is grey; lower is green and higher is
amber. These colours describe the numeric change, not overall design quality. No percentage is
shown when the baseline value is 0 or either analysis is unavailable. Partial earthwork and
disturbance totals are labelled **covered** and receive no percentage ranking if either road has
incomplete sections. Costs require complete engineering and a feasible material plan. **Max grade**
is labelled **design** or **ground**; a comparison requires matching bases and all sampled grades
known. Covered totals still count only the supported length. Compare roads with consistent terrain,
engineering assumptions and sampling, and review the geometric and material flags independently.

## How problems show up

| Symptom                                                                   | Likely cause                                                                                                 | What to do                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| "Curve at point _n_ does not fit its tangents; the sharp PI is retained." | Radius too large for the legs                                                                                | Use the radius the note gives, move PIs apart, **Fit sharp corners**   |
| "Curve at point _n_ overlaps an adjacent curve"                           | Two trims share a short leg                                                                                  | Reduce one radius or lengthen the leg                                  |
| "Spirals at point _n_ are longer than its deflection allows"              | Ls / R at least Δ                                                                                            | Shorten the spirals or raise the radius                                |
| Reverse-curve runoff shorter than entered                                 | Limited by each spiral plus half the intervening tangent                                                     | Inspect the crossfall rotation rate and lengthen the tangent if needed |
| Design speed requires more e than the maximum                             | Radius below V²/(127(e + f)); geometry is capped and flagged                                                 | Increase radius, reduce speed or review the sourced criteria           |
| "Vertical curve at _x_ m does not fit its tangents"                       | Curve half-length longer than a tangent                                                                      | Use the length the note gives, or **Set every curve from K**           |
| Optimized profile fails a standard                                        | No fitted candidate passed the discrete band, range and control constraints                                  | Widen the band, change spacing or review the conflicting constraints   |
| Control point fails after optimizing                                      | Curve moved the formation at a grade break                                                                   | Widen the tolerance or move the control off the break                  |
| Optimized road ends far above or below ground                             | Ends untied                                                                                                  | Add end controls and rerun                                             |
| "The search needs too many section solves"                                | Long road, fine step, wide search or short station interval                                                  | Widen spacing, coarsen the step or shorten the road                    |
| "Use a K of 0 or more; 0 fits no vertical curves."                        | A K below 0 or not a number reached the search                                                               | Enter a K of 0 or more                                                 |
| "Optimizing the vertical profile…" runs for minutes                       | Too many levels per PVI                                                                                      | Cancel, then coarsen the step or narrow the search                     |
| "The road start (0+000.0) is on a gap in the terrain"                     | A tied end has no ground under it                                                                            | Move the end, set a control there, or untie the ends                   |
| "No profile meets the limits between _a_ and _b_"                         | The named limit or control cannot be met over that interval inside the band                                  | Change what the message names, then run again                          |
| The road end drops far below the ground in the profile and 3D view        | Two PVIs almost on top of each other make a near-vertical tangent, and the road extends it past the last PVI | Remove or move the PVI beside the end; the warning names both stations |
| Route is a zigzag of 45° legs                                             | Eight-direction grid                                                                                         | **Reduce points, fit curves** with more deviation, then recheck grade  |
| A found route has sharp corners or curves under the minimum radius        | Grid legs too short for the minimum radius, or the curve would leave the terrain                             | Move the points apart, or reduce points with more deviation            |
| Route or corridor alternative looks far cheaper in Compare                | No vertical design or engineering inputs                                                                     | Design a profile and copy the engineering inputs first                 |
| "The corridor search takes a grade limit of 1–30%."                       | Road grade limit above 30 %                                                                                  | Lower the grade limit before using the corridor optimizer              |
| "The corridor search takes a minimum radius of up to 1,000 m."            | Road minimum radius above 1,000 m                                                                            | Lower the minimum radius, or leave it at 0 for none                    |
| "No covered ground-grade solution within ±90° of this bearing"            | Grade unreachable at that distance, or terrain gaps                                                          | Change the grade, bearing or distance                                  |

## What it does not do

- Infer a published road standard or check stopping sight distance. Speed/e/radius consistency is
  checked, but the named criteria still need an appropriate source and professional review.
- Prove a global plan/profile optimum. Joint refinement below is a bounded local search; the
  standalone profile optimizer keeps the horizontal fixed and terrain-route searches still have
  their own preliminary objectives.
- Carry a running mass balance in the profile search, or optimize haul, borrow and waste
  directly. **Total cost** only picks among five priced lines.
- Enforce a minimum drainage grade of "at least 0.5 % either way". Signed grade ranges cannot
  express that disjoint condition. Sag/crest/range K, required curve length and occupied tangent
  are enforced by the updated profile search.
- Keep culvert cover, ditch drainage or crossing grades in mind while optimizing the profile.
- Fit spirals to a route result, check the ground grade along the curves it fits to one, or keep
  route and corridor results inside the original road's engineering, curve design and vertical
  inputs.
- Keep a found road's sections whole. The searches check ground under the centreline, so a batter
  can still run onto a gap in the terrain.
- Treat interior sketch points as compulsory waypoints, or validate the constructed footprint
  against exclusions. The terrain-cost search applies the entered centreline clearance only.
- Prove that no road exists where a search fails. Failure means none was found inside these
  bounds.

## Joint plan/profile refinement

**Design → Refine plan and profile** moves interior horizontal controls and redesigns/reprices
the vertical profile after each trial. Endpoints remain fixed. The engine retains the entered
templates, station-based assumptions, controls and rates; review their physical location after
any plan shift. Invalid geometry, speed/e conflicts, grade failures, avoidance areas and incomplete
sections cannot produce a winner. The original road remains an alternative.

The engineering objective uses the recalculated complete engineering estimate. **Complete access**
calls the actual connected-network comparison for each exact trial, with automatic terrain-candidate
generation disabled. Missing prices, permissions, capacity or connectivity remain blockers; no
base estimate replaces an unpriced network ledger. Adoption recomputes the final trial and saves
the normal `FullCostReviewRecord`.

| Limit                                                       | Enforcing constant or validation                         | Behavior                                             |
| ----------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| 12 interior horizontal controls                             | `jointOptimizer.ts`, `MAX_JOINT_MOVABLE_POINTS`          | Reject; simplify/split first                         |
| 32 evaluations, UI 20                                       | `MAX_JOINT_EVALUATIONS`, `JointOptimizationControls.tsx` | Return best checked trial with budget-limited notice |
| Plan step 0.1–100 m; 1–5 rounds                             | `refinePlanAndProfile`                                   | Reject invalid input                                 |
| 100 curvature ranges; 500 combined PVI/control/range events | `project.ts` parser; `verticalOptimizer.ts` marks        | Reject rather than discard constraints               |

The coordinate-descent search halves its plan step each round and never claims a global optimum.
Profile section/transition budgets still apply to each trial. Cancellation abandons the run without
adopting a partial result. Editing or reopening the project, changing terrain, or leaving the
refinement controls invalidates a running result. Adoption checks the immediate current project
before writing, so a completed search cannot overwrite intervening edits. Its cleanup releases
only its own busy state.
