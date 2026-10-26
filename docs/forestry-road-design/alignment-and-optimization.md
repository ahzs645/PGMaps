# Alignment and optimization: limits and checks

This guide covers horizontal curves, spirals, curve design, pegging, the vertical profile and
its checks, and the three search tools: the profile optimizer, the terrain-cost route search
and the sketched corridor optimizer. The geometry itself is specified in the
[workspace contract](../forestry-road-design.md#geometry-and-calculations) and
[corridor optimization](../forestry-road-optimization.md); this guide says when to trust it.

## Before you rely on a design

- **No sharp PIs left.** A corner with radius 0, or a radius that does not fit its tangents,
  stays a sharp PI. The station is flagged "Sharp horizontal PI: curve required" and the
  workspace warns. Route and corridor results start as new roads, so check them again.
- **Radii checked against the speed, not only the minimum.** The minimum-radius flag compares
  each arc with the road-wide **Minimum radius** (default 25 m, `DEFAULT_ROAD_SETTINGS` in
  `terrain.ts`). Nothing compares a radius with the design speed. See
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

| Limit                                       | Value                                    | Enforced in                                                                | When exceeded                                                   |
| ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Horizontal points per alignment             | 2,000                                    | `engine.ts` `compile`                                                      | Error                                                           |
| Alignment length; distance from first point | 100 km each                              | `engine.ts` `compile`                                                      | Error                                                           |
| Horizontal radius                           | 0–10,000 m                               | `engine.ts` `compile`, `project.ts`                                        | Error                                                           |
| Curve tangent (trim)                        | must be shorter than both legs           | `engine.ts` `compile`                                                      | Sharp PI kept, warning                                          |
| Adjacent curves                             | trims must not overlap on the shared leg | `engine.ts` `compile`                                                      | Both become sharp PIs, warning                                  |
| Spiral length each side                     | 0–2,000 m                                | `project.ts`, `CurveTools.tsx`                                             | Rejected                                                        |
| Spiral against deflection                   | Ls / R must be less than Δ               | `engine.ts` `compile`                                                      | Simple curve used, warning                                      |
| Bulk fit: tangent use                       | 98 % of each leg (`FIT`)                 | `horizontalTools.ts`                                                       | Radius reduced; notice counts it                                |
| Bulk fit: largest radius                    | 10,000 m                                 | `horizontalTools.ts`                                                       | Capped                                                          |
| Design speed                                | 1–150 km/h                               | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Maximum superelevation; side friction f     | 0–20 %; 0–1                              | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Runoff; widening vehicle length             | 0–1,000 m; 0–50 m                        | `project.ts` `parseCurveDesign`                                            | Rejected                                                        |
| Stations per analysis                       | 3,000 (`MAX_STATIONS`)                   | `engine.ts` `analyzeRoad`                                                  | Spacing widened with a warning; error if events alone exceed it |
| Road alternatives per project               | 20                                       | `VerticalDesignControls.tsx`, `DesignSidebar.tsx`, `sidebar/DesignTab.tsx` | Buttons disabled or error                                       |

### Vertical alignment and profile optimizer

| Limit                         | Value                                                      | Enforced in                                          | When exceeded                                                |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| PVIs per alignment            | 500, at least 1 mm apart                                   | `engine.ts` `verticalProfile`                        | Error                                                        |
| Vertical curve                | half its length must fit each adjoining tangent            | `engine.ts` `verticalProfile`                        | Curve dropped, warning                                       |
| PVI spacing                   | at least 10 m (UI 10–1,000 m)                              | `verticalOptimizer.ts`, `VerticalDesignControls.tsx` | Error                                                        |
| Search ±, level step, K       | UI 0.5–30 m, 0.1–5 m, 0.1–1,000; K 0 or more in the search | `VerticalDesignControls.tsx`, `verticalOptimizer.ts` | Field rejects the value; a negative or missing K is an error |
| Level transitions             | 5,000,000 across all price runs (`maxTransitions`)         | `verticalOptimizer.ts`                               | Error: coarsen the level step, reduce depth or widen spacing |
| Section solves                | 60,000 (`maxSectionSolves`)                                | `verticalOptimizer.ts`                               | Error: widen spacing or coarsen the step                     |
| Depth band between PVIs       | ± (search ± plus about four level steps); ±7 m at defaults | `verticalOptimizer.ts` `rows`                        | Station priced as incomplete                                 |
| Incomplete-section penalty    | $5,000 per m (`incompletePenaltyPerM`)                     | `verticalOptimizer.ts`                               | Added to the search cost only                                |
| Simplification                | 0.3 m; kept if cost rises at most 1 % + $1                 | `verticalOptimizer.ts` `finish`                      | Unsimplified line kept                                       |
| Imbalance prices (total cost) | 0, 0.25, 0.5, 1, 2 × max(1, fill, borrow, waste rate)      | `verticalOptimizer.ts` `prices`                      | —                                                            |

The dynamic programme runs on the page's main thread and stops at its level-transition
budget. Its work grows with the cube of the levels per PVI (2 × search ÷ step + 1), up to
five times over for **Total cost**. At the defaults (±5 m, 0.5 m) that is 21 levels; a fine
±30 m search in 0.1 m steps has 601 levels and will usually need a coarser step to finish.
The search refuses non-finite inputs and more than 500 proposed PVIs before allocating levels.

### Route search

| Limit                            | Value                                                                                            | Enforced in                  | When exceeded                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------- |
| Endpoint separation              | 2 m–15 km                                                                                        | `routing.ts` `suggestRoutes` | Error                              |
| Ground-grade limit               | above 0 % and at most 60 %                                                                       | `routing.ts`                 | Error                              |
| Search margin; grid              | 35 % of separation (80–1,000 m); at most 96 nodes per side (`MAX_GRID_SIDE`), at least 2 m apart | `routing.ts`                 | —                                  |
| Grid nodes                       | 10,000 per attempt (`MAX_VISITED`); 40,000 × alternatives in total                               | `routing.ts`                 | Error                              |
| Fine-check retries               | 4 attempts                                                                                       | `routing.ts` `search`        | Error; no unchecked route returned |
| Terrain samples; geometry checks | 450,000; 2,000,000                                                                               | `routing.ts`                 | Error                              |
| Stream and exclusion vertices    | 20,000                                                                                           | `routing.ts`                 | Error                              |
| Alternatives                     | 1–5; at most 70 % shared edges                                                                   | `routing.ts`                 | Fewer alternatives returned        |

### Sketched corridor optimizer

| Limit                                   | Value                                                                 | Enforced in                                     | When exceeded                                 |
| --------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Guide points                            | 2–100                                                                 | `corridorOptimizer.ts` `search`                 | Error                                         |
| Endpoints; sketch extent; sketch length | 10 m–5 km apart; within 7 km of the start; 15 km                      | `corridorOptimizer.ts`                          | Error                                         |
| Corridor half-width                     | 25–1,000 m (default 180 m)                                            | `corridorOptimizer.ts`, `sidebar/DesignTab.tsx` | Error or button disabled                      |
| Ground-grade limit                      | 1–30 %, taken from the road's grade limit                             | `corridorOptimizer.ts`                          | Error                                         |
| Minimum radius                          | 5–1,000 m, taken from the road settings                               | `corridorOptimizer.ts`                          | Error                                         |
| Search states                           | 50,000 (`maxStates`)                                                  | `corridorOptimizer.ts`                          | Budget-limited result, or error if none found |
| Terrain samples; geometry operations    | 3,500,000 (`maxTerrainSamples`); 15,000,000 (`maxGeometryOperations`) | `corridorOptimizer.ts`                          | Error                                         |
| Candidate length                        | the lesser of 15 km and 3 × sketch length + 4 × half-width            | `corridorOptimizer.ts`                          | Branch not searched                           |

Geometry operations include guide-distance and corridor checks even with no supplied constraints.
If that budget is reached, narrow the corridor, shorten/simplify the guide or crop constraints.
The API accepts a lower geometry-operation budget; it cannot raise the 15,000,000 ceiling.

### Pegging

| Limit                  | Value                                                                | Enforced in                                      | When exceeded                        |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Peg distance (new peg) | 0.2–1,000 m                                                          | `pegging.ts` `findGradePeg`, `PeggingEditor.tsx` | No solution, or field rejects it     |
| Leg samples            | 1 m, at most 2,000 per leg                                           | `pegging.ts` `measurePeg`                        | Legs over 2 km sampled more coarsely |
| Ground-grade search    | ±90° of the bearing, 2° brackets, match within 0.01 %, full coverage | `pegging.ts` `findGradePeg`                      | "No covered ground-grade solution"   |

## Built-in assumptions

**Curve design.** Superelevation is e = V²/(127R) − f, held between the normal crown and the
maximum (`curveDesignAt` in `engine.ts`). f is one entered value, not a speed-dependent table.
The workspace starts curve design at 40 km/h, 8 %, f 0.15 and 30 m runoff
(`CURVE_DESIGN_START` in `CurveTools.tsx`). When the formula asks for more than the maximum,
the maximum is used and nothing is flagged. At those defaults the radius that needs exactly
8 % is about 55 m, but the default minimum-radius flag is 25 m. A 25 m curve would need 35 %
and gets 8 % without a warning. Set **Minimum radius** to the speed's radius yourself.

**Runoff on simple curves** runs on the tangent before the PC and after the PT. Full
superelevation is reached at the curve itself, not shared between tangent and curve.
Widening L²/(2R) goes on the inside edge only.

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
rounds radii down to 0.1 m. It reports a radius below the minimum in the notice only; the
station flag then marks it.

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

- Levels are measured from the centreline ground at each PVI. "Tie both ends to ground" means
  centreline ground at 0+000 and at the road end, not an existing road's formation. To tie to
  a structure, add a control point at that end instead; a control there overrides the tie.
- The grade window of an interval is read at its midpoint only. A grade range that starts or
  ends inside an interval is checked properly only by the re-analysis.
- The search uses the one **Curve K** for both sags and crests. It ignores **Min sag K**,
  **Min crest K** and **Min tangent** while searching. Curves are sized afterwards, at least
  **Min curve**, and shrunk to fit their tangents. The fitted result must pass all entered
  standards before it is returned; a failure asks for adjusted inputs and creates no road.
- Controls are held on the straight grade line. A curve fitted afterwards moves the formation
  at a grade break by its middle ordinate, A × L ÷ 800 metres (A in %, L in m). A tight
  control at a grade break can fail the re-check; that candidate is rejected instead of adopted.
- Between PVIs, a station more than about the search ± plus four level steps from ground is
  priced as incomplete at $5,000 per m. Deep fills over a gully between PVIs are discouraged,
  not costed.
- **Cut and fill** minimizes cut × cut rate + fill × fill rate only. Surfacing and clearing are
  left out. **Total cost** picks, from five imbalance prices, the line that the full analysis
  prices lowest, haul, borrow and waste included.

**Route search** (`routing.ts`) uses only the first and last points of the active road. It
moves in eight directions on the grid, so every bend is a multiple of 45° and every grid turn
is a sharp PI. The grade limit applies to ground slope in both directions. Edge cost is road
$/m × (1 + 3(g/gmax)²), plus crossings and zone costs. The defaults, $100/m and $8,000 per
crossing (`DEFAULT_ROUTE_OPTIONS`), are placeholders. Each stream-segment intersection counts as
one crossing.

**Corridor optimizer** (`corridorOptimizer.ts`) checks ground grade between 1 m samples
against the road grade limit, uphill and downhill alike in the UI. Its turns are arcs with
2 m tangents between them, so one bend can become several PIs. Radii are a few discrete values
at or above the minimum radius (`nominalTurnRadiusM` in the report). Exclusions apply to the
centreline only, with no clearance in the UI. There are no spirals and no vertical design.

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
drops PVIs, and the simpler line is kept only if it has no vertical check failures, no grade
over the limit, no less coverage and no more than 1 % + $1 extra objective cost.
Both simplified and unsimplified candidates must pass the final vertical standards,
controls and road-wide grade checks before a result is returned. If no tested candidate
passes, optimization reports an error and creates no road.

**Infeasible.** "No profile meets the grade, curvature and control limits past _x_ m" names the
first PVI where no level pair survives. Untie the ends, widen the search, lower K or relax a
limit. "Every PVI station needs ground under the centreline" means a PVI sits on missing
terrain.

**Budget-limited.** The corridor optimizer can return a verified candidate after reaching its
50,000-state budget; the review dialog and report say "budget-limited". Better alternatives may
exist. Route search and the profile optimizer stop with an error instead.

**Dollars and relative costs.**

- Profile optimizer: dollars at your entered rates. The notice compares covered estimates
  before and after. A line with less coverage can look cheaper.
- Route search: dollars under the route model only, written into each new road's name. It is
  not the road's analysis estimate. Edges are priced at sampling of at most 5 m; the final 1 m
  check accepts or rejects them but does not reprice.
- Corridor optimizer: relative units, never dollars. A mapped stream contact adds 150 units.

**New alternatives start from different inputs.** The profile optimizer copies the whole road,
including its engineering design, curve design, standards and controls. Route and corridor
results copy only the template. Their cost has no haul, structures, mobilization or contingency,
no superelevation or widening, no vertical design and no checks.

**Compare alternatives** shows each metric against the chosen baseline as (other − baseline) ÷
|baseline|, rounded to whole percent. Within ±0.05 % it is grey; lower is green and higher is
amber for every metric, even where lower is not better. No percentage is shown when the baseline
value is 0. A road whose analysis failed shows dashes. **Max grade** is formation grade on a
designed road but ground grade on one without PVIs. Covered cost and earthworks only count the
covered length. Compare two roads only when both have a vertical design, the same engineering
inputs and similar coverage.

## How problems show up

| Symptom                                                                   | Likely cause                                                | What to do                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| "Curve at point _n_ does not fit its tangents; the sharp PI is retained." | Radius too large for the legs                               | Shorten the radius, move PIs apart, or run **Fit sharp corners**       |
| "Curve at point _n_ overlaps an adjacent curve"                           | Two trims share a short leg                                 | Reduce one radius or lengthen the leg                                  |
| "Spirals at point _n_ are longer than its deflection allows"              | Ls / R at least Δ                                           | Shorten the spirals or raise the radius                                |
| Reverse-curve runoff shorter than entered                                 | Limited by each spiral plus half the intervening tangent    | Inspect the crossfall rotation rate and lengthen the tangent if needed |
| Tight curves at full e max with no flag                                   | Radius below the design-speed radius                        | Raise **Minimum radius** to V²/(127(e + f))                            |
| "Vertical curve at _x_ m does not fit its tangents"                       | Curve half-length longer than a tangent                     | Shorten the curve or use **Set every curve from K**                    |
| Optimized profile fails K or tangent checks                               | Search uses one K and no tangent length                     | Rerun with **Curve K** at least the larger minimum K                   |
| Control point fails after optimizing                                      | Curve moved the formation at a grade break                  | Widen the tolerance or move the control off the break                  |
| Optimized road ends far above or below ground                             | Ends untied                                                 | Add end controls and rerun                                             |
| "The search needs too many section solves"                                | Long road, fine step, wide search or short station interval | Widen spacing, coarsen the step or shorten the road                    |
| "Use a K of 0 or more; 0 fits no vertical curves."                        | A K below 0 or not a number reached the search              | Enter a K of 0 or more                                                 |
| Browser stops responding during "Optimizing the vertical profile…"        | Too many levels per PVI                                     | Coarsen the step or narrow the search                                  |
| Route is a zigzag of 45° legs                                             | Eight-direction grid                                        | Simplify the PIs, fit curves, then recheck grade                       |
| Route or corridor alternative looks far cheaper in Compare                | No vertical design or engineering inputs                    | Design a profile and copy the engineering inputs first                 |
| "Ground-grade screening limits must be between 1% and 30%."               | Road grade limit above 30 %                                 | Lower the grade limit before using the corridor optimizer              |
| "Minimum radius must be 5–1,000 m."                                       | Road minimum radius 0 or above 1,000 m                      | Set a minimum radius in that range                                     |
| "No covered ground-grade solution within ±90° of this bearing"            | Grade unreachable at that distance, or terrain gaps         | Change the grade, bearing or distance                                  |

## What it does not do

- Check a radius against the design speed, stopping sight distance, or a road-class standard.
  Speed, e max and f are entries, not a standard.
- Optimize the horizontal alignment and the profile together. The profile optimizer keeps the
  horizontal fixed; the route and corridor searches design no profile and no earthworks.
- Carry a running mass balance in the profile search, or optimize haul, borrow and waste
  directly. **Total cost** only picks among five priced lines.
- Enforce minimum sag or crest K, minimum curve or tangent length, or a minimum drainage grade
  inside the search. A signed grade range cannot express "at least 0.5 % either way".
- Keep culvert cover, ditch drainage or crossing grades in mind while optimizing the profile.
- Fit curves or spirals to a route result, or keep route and corridor results inside the
  original road's engineering, curve design and vertical inputs.
- Treat interior sketch points as compulsory waypoints, or apply exclusion buffers to the
  constructed footprint.
- Prove that no road exists where a search fails. Failure means none was found inside these
  bounds.
