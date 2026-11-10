# Extraction reach: skidder, forwarder and cable yarder

**Design → Extraction reach** answers how a machine brings each part of a harvest block to a truck
road, and how far the logs travel. It extends the along-ground skid reach of
[Skid reach, spur suggestions and landing sites](skid-reach-and-spurs.md) with winching, skid
trails, closed areas, a forwarder model, cable yarding coverage, distance classes and a
before/after comparison for designed roads. The model is in `extractionReach.ts`, with winching in
`winchReach.ts` and the forwarder's runs and crane in `forwarderReach.ts`; the cable yarder's lines
are in `cableCoverage.ts` (rule and presets in `cableCoverageRule.ts`, the run in
`cableCoverageRun.ts`, suggested lines in `cableLineSelection.ts`) and are tested by the
cable-layout module (`crates/cable-layout/src/coverage.rs`, see
[Intermediate supports](cable-supports.md)). The panel is `SkidReachPanel.tsx`, with its fields in
`ExtractionReachFields.tsx` and `CableCoverageFields.tsx` and statistics in
`ExtractionReachResults.tsx` and `CableCoverageResults.tsx`.

## Before you rely on it

- **The skidder keeps the field rule.** Its default reach is the 350 m level / 200 m at 30 % uphill
  rule of thumb, with a 40 % ground skid limit, exactly as in the skid-reach guide. With winching
  off and no trails the result is cell for cell the skid-reach model's (a unit test pins it).
- **Winching and forwarder limits are Sylvaccess's, not BC standards.** The winch defaults (50 m
  uphill reached at 75 %, 100 m downhill reached at 20 %) and the forwarder defaults (15 % side
  slope, 30 % loaded uphill, 40 % loaded downhill, 300 m steep-ground budget, 8 m crane) are
  Sylvaccess 3.6's. The 500 m forwarding reach is a PGMaps choice; Sylvaccess has no reach limit
  and grades distance by classes only. Use your contractor's numbers where you have them.
- **Winch from: edge of driven ground is the default.** The skidder drives to the timber and
  winches only where it cannot drive (Sylvaccess option 2). This leaves the field rule's results
  unchanged on drivable ground and adds winching onto steep or closed ground. **Roads and trails
  first** is Sylvaccess's default (option 1, "limit soil damage"): timber within winch reach of a
  road or trail is winched to it even where the machine could drive.
- **Distances follow the ground; winch lines and runs are straight.** Driving distance is the
  cheapest path over the grid. Winch lines and forwarder runs are straight lines from a cell centre
  at 360 bearings.
- **Cell size matters.** The panel starts at 10 m cells; Sylvaccess resamples everything to 5 m.
  On 10 m cells a winch line or run is tested every 10 m, and an 8 m crane reaches no neighbouring
  cell centre at all. Enter a 5 m grid cell when the crane or short winch lines matter.
- **Cable coverage is a screen, not a layout.** A line counts when the loaded carriage clears the
  ground on a source-terrain profile sampled at half the grid cell, within the rope's allowable
  tension, with at most the set number of supports at one height. Check any line you mean to rig
  on its D-line profile with **Find supports**, on the 1 m profile, before relying on it.
- **Cable presets are Sylvaccess's machine types, not BC ratings.** Replace the rope, carriage,
  payload and heights with your yarder's.
- **Every result is a candidate.** Nothing here changes the project. Spurs are added only with
  **Add**, as before; suggested cable lines are drawn, never added.

## Using it

1. Pick the block, then the machine: **Skidder**, **Forwarder** or **Cable yarder**.
2. Skidder: the skid reach fields as before; fold open **Winching** to choose where it winches from
   and the two line lengths and their full-length slopes. Forwarder: side slope limit, loaded
   downhill and uphill limits, steep run budget, crane reach and forwarding reach. Cable yarder: a
   machine preset (fills every field), where the yarder stands (above or below the line, or
   either), the carriage (haulback or gravity), longest skyline, shortest line, tower, support and
   tail heights, most supports, lateral yarding distance and bearing step; **Line rules** (landing
   spacing, run outside the block, highest above ground, support spacing, loaded break angle) and
   **Rope and load** fold below them.
3. Both: **Hand-falling limit** (ground steeper than this, with its eight neighbours, is reported too
   steep to fell), **Travel outside block**, **Grid cell** and the **Distance classes**.
4. **Skid trails**: tick the roads near the block that carry machines, not trucks. Logs are dragged
   or forwarded along a trail to a truck road; a trail that joins no truck road is left out and
   named. Every other counted road is a truck road.
5. **Closed areas**: say how each exclusion area is used. **No machines**: no driving, but winch
   lines may cross it and logs inside it may be winched out. **No extraction**: neither. Areas are
   never classified from their geometry; an area left at **Not used** changes nothing.
6. **Compare with mapped roads only** runs the block twice, without and with the designed roads.
7. **Run extraction reach.** The folded row shows the machine and the share within reach. The
   results list area by how the logs leave (on a road or trail, skidded, winched from a road or
   trail, winched from driven ground; forwarded by free travel, straight runs or crane; yarded by
   skyline), the area beyond reach, too steep for the machine, too steep to fell, closed and
   unknown, the distance classes with cumulative shares, the mean and farthest distances, and the
   comparison. For the cable yarder they add the lines that work, how many with the yarder above
   and below, mean skyline and supports, why the rest were not kept, and **Suggested lines** with
   their settings and table.
   **Show on plan** fills ground within reach by distance class (or newly within reach and
   shortened, with the comparison on) and outlines winched, beyond-reach, too-steep, unfellable,
   closed and unknown ground.
8. **Suggest spurs** and **Landing sites** work as before, judged by this run's reach: a spur that
   brings steep ground within winch reach counts. Spur suggestions are not offered for the cable
   yarder: they re-run a ground-based model for every candidate spur.

## How the skidder is modelled

- **Driving.** Two ground searches run over the cells the skidder may drive (not closed, not a
  stream barrier when streams stop extraction, not steeper than the ground skid limit): one from
  the truck roads, with trail cells left out, and one from the trails, each trail cell starting with
  its along-trail reach used. A cell within reach both ways leaves by the truck road when its
  in-stand distance is no more than the trail route's in-stand distance plus a tenth of its trail
  distance (`TRACK_CHOICE_WEIGHT`). Among trails, the search counts in-stand reach twice
  (`OFF_TRAIL_CHOICE_WEIGHT`), so the machine leaves the stand by the nearest trail. The reach rule
  applies to the whole drag, in the stand and along the trail.
- **Trails.** Along-trail reach and distance are a ground search over trail cells only, from the
  truck roads, with no slope limit (a trail is built ground). Trail cells it never reaches are left
  out.
- **Winching.** Lines leave a source at 360 bearings, 1° apart, and pass through the cells a
  straight segment from the source's centre touches, nearest first. For a target at horizontal
  distance `d` and height difference `Δz` above the source, the line is `L = √(d² + Δz²)` with slope
  `p = Δz/d`. The longest line is linear in the line's drop, through the two calibration points:

  ```text
  Δz_up   =  L_up · P_up / √(1 + P_up²)
  Δz_down = −L_down · P_down / √(1 + P_down²)
  c  = (L_up − L_down) / (Δz_up − Δz_down),  L0 = L_up − c · Δz_up
  L_max(p) = L0 / (1 − c · p / √(1 + p²))     for −P_down < p ≤ P_up
           = L_down below −P_down,  L_up above P_up
  ```

  With the defaults `c = −1.0078`, `L0 = 80.23 m`: 100 m on lines at or below −20 %, 80.2 m on level
  lines, 58.4 m at +40 %, 50 m at or above +75 %. Any line no longer than the shorter length is
  allowed. A line stops at the first cell it may not cross (a road, a stream barrier, a
  no-extraction area, unfellable ground, outside the travel band), the first cell past `L_max`, or
  the first cell where the chord from the source's ground to the target's ground passes more than
  `WINCH_HUMP_M` (10 m) below a cell between them or more than `WINCH_HOLLOW_M` (20 m) above one. A
  cell already served by a better line is passed over without those checks and the line goes on;
  the cells beyond it are still checked against the whole chord. Each target keeps the line with
  the least `base + L`, where the base is the source's own distance to the truck road (a tenth of it
  for a road-winch from a trail).

- **Sources.** Roads and trails first: every truck road cell and every trail cell within reach.
  Then, in both modes, every cell the skidder drives to within reach that has a neighbour it cannot
  enter (and, driving to the timber, road and trail cells beside such ground). Edge winching fills
  only cells not yet served.
- **Total distance** = in-stand + along-trail + winch line.

## How the forwarder is modelled

- **Free travel.** Ground no steeper than the least of the three slope limits is driven in any
  direction: the same ground searches as the skidder, at a constant reach (the forwarding reach),
  on cells the forwarder may drive.
- **Straight runs** from every truck road cell and trail cell within reach, at 360 bearings, on the
  same ray geometry. Each cell on a run must be drivable, no steeper than the steepest of the three
  limits; no steeper than the loaded-downhill limit when it lies above the departure, the
  loaded-uphill limit otherwise; and its slope across the run, `slope · |sin Δ|` with Δ the angle
  between the run and the fall line, within the side slope limit. On a uniform 20 % slope that
  allows runs within 48.6° of the fall line, on 25 % within 36.9° (`widestRunAngleDeg`). The
  distance along the run over ground steeper than the side limit may not exceed the steep run
  budget. A run's distance is its straight 3D chord; it replaces free travel when shorter (with
  the trail tenth).
- **Second pass.** Runs start again from the edge of everything reached, carrying the distance
  and steep budget already used, **but only from cells within the side slope limit**: a run is
  straight because the machine cannot turn across a steep slope, so a new run starts only where it
  can turn.
- **Crane.** Cells whose centre is within the crane reach of a reached edge cell are loaded from it.
- **Total distance** = in-stand (free travel, runs and crane) + along-trail. Within reach when it
  is no more than the forwarding reach.

## Cell states

Each block cell is, in order: **unknown** when it has no ground; **within reach** when it lies on a
counted road or trail; **too steep to fell** when its 3 × 3 steepest slope is above the hand-falling
limit; **no extraction** when it lies in such an area and nothing reached it; **within reach** when
the strict run reached it; **unknown** when only the optimistic run did; **too steep for the
machine** above the skid limit (skidder) or the steepest of the three limits (forwarder; the cable
yarder has no such limit); otherwise **beyond reach**. Spur suggestions read too steep, too steep to fell and no extraction as ground a
spur cannot help, and the coverage target is read on the rest (the "extractable" area).

## Before and after a road project

With **Compare with mapped roads only** on and designed roads counted, the block is run on one grid
twice: with every counted road except the designed ones, then with all. `compareExtraction` reports
the area newly within reach, the area within reach both times whose distance fell by at least
`MIN_SHORTENED_M`, the mean shortening, and the shortened area by how much shorter, on the distance
class bounds. The plan then fills newly accessible ground green and shortened ground teal. This is
Sylvaccess's road-project comparison, with PGMaps' designed roads in the place of its "projected"
sections.

## How the cable yarder is modelled

The question is Sylvaccess's: which ground in the block can a skyline yard, from which lines. The
method of testing a line is PGMaps' own, on the cable-layout module's span check.

- **Landings.** Cells of the counted truck roads within the travel band (**Travel outside block**)
  on known ground, one every **Landing spacing** metres along each road. Skid trails are not used.
- **Candidate lines.** From each landing, lines at bearings **Bearing step** apart. Each is walked
  out over the **source terrain** (sampled at the grid's cell centres, bilinear between them, every
  half cell along the line), not the ground trend: a skyline's clearance is a profile check. A line
  is cut at the first sample that is off the grid, on unknown ground, on a stream barrier (when
  **Streams stop extraction** is on), more than the usable skyline from the landing in 3D, past a
  run outside the block longer than **Outside block**, or where the side-slope ground along it
  passes 75 m. Side-slope ground is ground steeper than 30 % that the line crosses 30° or more off
  the fall line (read on the ground trend's gradient). The line may end only on a block sample
  where the side-slope ground so far is at most 15 % of the distance.
- **Usable skyline** = longest skyline − √2 · (tail height + 5 m): rope for a 45° guyline from the
  tail top to its anchor. 750 m and a 12 m tail leave 726 m; 300 m leaves 276 m.
- **Height trim.** The far end is pulled back until the loaded line, estimated as the chord from
  tower top to tail top less a parabolic sag at the allowable tension (`parabolicLoadSagM`, ×1.1),
  is nowhere more than **Highest above ground** above the ground.
- **Where the yarder stands.** Above the line when its ground is higher than the tail's, otherwise
  below (a level line counts as below). **Yarder stands** keeps only lines of that kind; a
  **gravity** carriage needs the yarder no lower than the tail and the loaded path to fall away from
  it along every span (the module's two-cable check).
- **The screen** (`coverage.rs`). Each line is tensioned within its allowable working tension
  (breaking force ÷ safety factor), on a grid of 32 pre-tensions from 1/32 of it up, and checked as
  an elastic catenary with the loaded carriage moved along every span (`Ctx::check_catenary`, the
  support search's own span check): the carriage keeps the rigging's clearance except within 10 m
  of a support, and the rope's tension stays within the allowable. Supports are candidates every
  grid cell, at the support height, at least **Support spacing** apart. Tails are tried from the
  farthest inward; for each, chains of spans are grown by number of supports, keeping per candidate
  the pre-tensions at which a chain reaches it (one pre-tension serves the whole rope), from each
  kept candidate its 3 farthest working targets and at each level the 5 farthest candidates. The
  first chain that reaches the tail is analysed as a complete line (the support search's final
  analysis: every span again with its real neighbours, the loaded break angle at each intermediate
  support within **Max loaded break**, and the empty rope bearing on it by at least 1°), at the
  lowest, highest and middle shared pre-tension. Fewest supports first; the longest tail that
  passes is the line. When a tail fails, the next tried is the farthest candidate any chain
  reached, or one cell in.
- **Coverage.** A line yards the band **Lateral yarding** either side of its axis, from the landing
  to its end: a block cell whose centre lies in the band is within reach, unless it is too steep
  to fell, in a no-extraction area or on unknown ground. A cell several lines cover is yarded by
  the line whose axis passes closest to it (then the shorter carriage distance); its extraction
  distance is that line's **carriage distance**, the distance along the axis from the landing, and
  its exit the landing cell. Truck-road cells in the block are within reach, as for the other
  machines. `cableExtractionResult` turns this into the same result the other machines produce, so
  the area and class tables, the plan layer and the comparison read it unchanged.
- **Unknown.** A line cut by unknown ground or the grid edge cannot be shown to reach further:
  block cells in its band out to the usable skyline that no line covers are unknown, never beyond
  reach.
- **Before and after.** One screening serves both runs: lines from landings on designed roads count
  only after.
- **Suggested lines** (`cableLineSelection.ts`). Choose at most **Most lines** of the lines that work
  to yard as much of the block's known, fellable, open ground as possible: greedy maximum coverage.
  Each step takes the line with the most ground no chosen line yards per unit cost, a line costing
  1 + **Support penalty** × its supports (ties: fewer supports, shorter mean carriage distance), and
  only if that new ground is at least **New share** of its own band; it stops at **Target**, at the
  most lines, or when no line qualifies. Gains only fall as lines are chosen, so they are
  recomputed lazily. A last pass drops any chosen line of which less than 10 % (`MIN_UNIQUE_SHARE`)
  is yarded by no other, least unique first. With no penalty and no share rule this is the classic
  greedy, within 1 − 1/e of the best set of that many lines. It is not Sylvaccess's selection (a
  weighted criteria score, a two-line overlap count and 60 % pruning).
- **Open a suggested line as a profile.** Click its number in the Suggested lines table: it is drawn
  selected on the plan, its supports are checked as one multi-span layout at its pre-tension (the
  same check as **Check saved layout**), and the profile shows the loaded path. **Use as D-line**
  keeps it, with the supports as its saved layout (see
  [D-line outputs, rigging sets and field profiles](cable-outputs-and-field-profiles.md)).
- **Rigging sets.** _Rope and load_ offers the project's named rigging sets, shared with the
  D-lines. Applying one sets the tension mode to the allowable (coverage always tensions to it) and,
  when the set carries a loaded break limit inside 5–60°, the **Max loaded break**.

## Limits and budgets

| Limit                                                                                                    | Enforcing code                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Skidder default: 350 m level, 200 m at 30 % uphill, 40 % ground skid limit; winch from the edge          | `DEFAULT_EXTRACTION_SETTINGS`, `extractionReach.ts`                                                            |
| Winch defaults 50 m up (full from 75 %), 100 m down (full from 20 %)                                     | `DEFAULT_WINCH_RULE`, `winchReach.ts`                                                                          |
| Winch lines 0–300 m each way, at least one above 0; full-length slopes 1–500 %                           | `MAX_WINCH_M`, `MIN_WINCH_SLOPE_PERCENT`, `MAX_WINCH_SLOPE_PERCENT`                                            |
| A winch line passes at most 10 m below a rise and 20 m above a hollow; fixed                             | `WINCH_HUMP_M`, `WINCH_HOLLOW_M`                                                                               |
| Winch lines and runs at 360 bearings, 1° apart                                                           | `RAY_BEARINGS`, `rayTable`                                                                                     |
| Forwarder defaults: 15 % side, 30 % loaded uphill, 40 % loaded downhill, 300 m steep, 8 m crane, 500 m   | `DEFAULT_FORWARDER_RULE`, `forwarderReach.ts`                                                                  |
| Forwarder slopes 1–100 %; steep budget 0–2,000 m; crane 2–20 m; forwarding reach 20–2,000 m              | `MIN/MAX_FORWARDER_SLOPE_PERCENT`, `MAX_STEEP_BUDGET_M`, `MIN/MAX_CRANE_M`, `MIN/MAX_FORWARDER_REACH_M`        |
| Hand-falling limit 100 % by default, 10–300 %                                                            | `DEFAULT_FELLABLE_SLOPE_PERCENT`, `MIN/MAX_FELLABLE_SLOPE_PERCENT`                                             |
| Distance classes 0;100;200;300 m by default; at most 8, starting at 0, below 5,000 m                     | `DEFAULT_CLASS_BOUNDS_M`, `MAX_DISTANCE_CLASSES`, `MAX_CLASS_BOUND_M`                                          |
| Trail distance counts a tenth against in-stand distance; in-stand reach counts twice choosing a trail    | `TRACK_CHOICE_WEIGHT`, `OFF_TRAIL_CHOICE_WEIGHT`                                                               |
| A distance counts as shortened from 1 m                                                                  | `MIN_SHORTENED_M`                                                                                              |
| Grid, travel band, reach multiple and plan vertices as for skid reach                                    | `DEFAULT_SKID_CELL_M`, `MAX_SKID_CELLS`, `MAX_OFF_BLOCK_M`, `SKID_REPORT_REACHES`, `MAX_SKID_OUTLINE_VERTICES` |
| Skid trails listed: counted roads within 1 km of the block, nearest 30                                   | `ROAD_USE_RADIUS_M`, `MAX_ROAD_USE_ROWS`, `SkidReachPanel.tsx`                                                 |
| Cable rule ranges (skyline 100–2,000 m, supports 0–10, lateral 5–200 m, bearing step 1–15°, …)           | `CABLE_RULE_LIMITS`, `MAX_COVER_SKYLINE_M`, `MAX_COVER_SUPPORTS`, `cableCoverageRule.ts`                       |
| A run screens at most 12,000 lines (landings × bearings); refused above, with the counts                 | `MAX_COVER_LINES`, `cableCandidateSteps`                                                                       |
| A line evaluates at most 3,000 spans, then is reported at its budget ("span budget")                     | `MAX_COVER_SPANS_PER_LINE`; crate `CoverParams::max_arcs`                                                      |
| 32 pre-tensions from 1/32 of the allowable to the allowable (the module holds at most 64)                | `COVER_TENSION_LEVELS`, `COVER_LOWEST_TENSION_SHARE`; crate `MAX_COVER_TENSIONS`                               |
| Chains keep 5 candidates per level and 3 targets per candidate; 3 pre-tensions analysed per chain        | crate `COVER_BEAM`, `COVER_TARGETS`, `VERIFY_TENSIONS` (`coverage.rs`)                                         |
| Side slope: over 30 %, 30° or more off the fall line, 75 m, 15 % of the line; fixed                      | `SIDE_SLOPE_PERCENT`, `SIDE_SLOPE_OFF_FALL_LINE_DEG`, `SIDE_SLOPE_MAX_M`, `SIDE_SLOPE_MAX_SHARE`               |
| Anchor allowance: guyline at 45° from the tail top plus 5 m; no clearance check within 10 m of a support | `ANCHOR_EXTRA_M`, `SUPPORT_CLEARANCE_ZONE_M`                                                                   |
| Lines sent to the worker 24 at a time (one progress step each)                                           | `COVER_BATCH_LINES`                                                                                            |
| Suggested lines: 30 most, 30 % new share, 0.25 support penalty, 95 % target; final pass at 10 %          | `DEFAULT_CABLE_SELECTION`, `CABLE_SELECTION_LIMITS`, `MIN_UNIQUE_SHARE` (`cableLineSelection.ts`)              |

**Runtime of the cable yarder.** Measured in Node on the committed WebAssembly on the reference
case below: about 3 ms a line on 5 m cells and 2 ms on 10 m cells (a 276 m usable skyline, half
the lines needing a support). The defaults (2° bearings, a landing every 25 m) on a 55 m road
frontage: 540 lines, 1.6 s on 5 m cells, 1.1 s on 10 m. Every 1° from every 5 m cell (Sylvaccess's
precision 1): 4,320 lines, 13.5 s. A block with 500 m of road within the travel band takes about
3,600 lines with the defaults, so 7–11 s; the 12,000-line cap holds a run to about 25–40 s.
Selection takes 10–160 ms and follows its settings without a new run.

## Built-in assumptions

- The reach rule applies to the skidder's whole drag, in the stand and along a trail; a winch line
  has its own limit and adds to the total distance but not to the reach used.
- Edge winching starts only where the driven ground meets ground the machine cannot enter (too
  steep, closed, a barrier); a skidder at the end of its reach on gentle ground does not winch
  further.
- A suggested spur is a truck road. Trails keep the truck roads they joined in the base run; run
  again after adding a spur that a trail should join.
- No public-road class: Sylvaccess's class 3 (public road, an obstacle to machines) has no PGMaps
  equivalent. Every counted road that is not a trail is a truck road and a destination.
- The forwarder's side-slope rule uses the exact tangent form; Sylvaccess applies the same rule to
  slope angles, which allows slightly wider runs (48.96° rather than 48.59° on 20 %).
- The forwarder's second pass starts only on ground within the side slope limit (see above), and the
  steep-ground budget is enforced on every cell a run reaches.
- Slopes are central differences on the ground trend (`groundTrendTerrain`), not Horn's 3 × 3
  operator; on a plane they agree.
- Stream barriers stop winch lines as well as driving.
- Missing ground stays unknown: every pass runs twice, refusing missing cells and then treating
  them as level and passable. Sylvaccess treats missing ground as an obstacle.
- Cable: the band counts cells whose centre lies in it; Sylvaccess counts every cell it touches,
  which adds up to about 10 % on oblique bands. A cell's extraction distance is the carriage
  distance along the line nearest it; lateral yarding adds no distance.
- Cable: one support height and one tail height for every line; Sylvaccess's support heights from
  a tree-height raster and its "optimise heights" option are not modelled. Supports may stand
  anywhere on the line, inside or outside the block.
- Cable: the loaded break angle is held at every carriage position (Pestal 1961), as in the support
  search; Sylvaccess compares the chords' angles. Chord-slope windows for a classical or
  self-motorised carriage are not modelled; the gravity carriage is the module's two-cable check.
- Cable: a line must end inside the block; its tail and anchor may stand on ground outside it only
  when it runs out of the block for less than **Outside block**. A shortened line's tail is wherever
  the screen found it.
- Cable: no line may cross a stream when streams stop extraction; no-extraction areas may be
  crossed, but their ground is never yarded. No-machines areas do not affect cable.

## Failure modes

- **Coarse terrain hides humps and hollows.** On the 22 m regional DEM, a bluff or gully smaller
  than a few cells does not stop a winch line it would stop in the field. Use LiDAR.
- **A 10 m grid under-reports the crane** and coarsens winch envelopes. Use 5 m cells for forwarder
  work.
- **A trail that only touches a truck road diagonally across a gap** in the rasterized lines is
  still joined (eight-neighbour); a trail that stops short of the road by a cell is left out and
  named. Check the named trails.
- **Closed areas are opt-in.** An exclusion area left at **Not used** is crossed freely by machines
  and winch lines.
- **Distances are not costs.** The classes grade distance only; uphill and downhill skidding are
  distinguished only by the reach rule, not by the distance reported.
- **A cable line passes on the coverage grid but not on its D-line.** The screen reads the ground
  every half cell; a knoll or bank narrower than that can stop the carriage in the field. On a 10 m
  grid, open each suggested line as a profile, or use it as a D-line and check it (1 m) with
  **Check saved layout** or **Find supports**.
- **Too many cable lines.** Over 12,000 landings × bearings the run is refused: widen the landing
  spacing or the bearing step, or narrow the travel band.
- **Lines reported at their span budget** are counted among those not kept; they are lines whose
  supports the screen could not settle in 3,000 spans. Fewer supports or a coarser grid settle them.
- **Lines fanning from one landing overlap near it.** Suggested lines from the same landing share
  ground there by construction; the new-share rule counts that overlap against each later line, so
  a high **New share** leaves fewer lines from each landing.

## Provenance

- **Specification.** Written from the clean-room functional specification of Sylvaccess 3.6
  (`sylvaccess.md`, 10 November 2026; §5–7 for the cable module), which describes the program's
  options and behaviour without code. Written from a functional specification; no code from
  Sylvaccess (GPL-3.0-or-later) was used. The specification's defects (the ONF class labelling of
  unreached cells, the forwarder's first-reach budget quirk, the cable summary's negative
  "inaccessible" area when lines reach past the area of interest) are not reproduced; cable
  coverage counts block cells only. The cable line test and the line selection are PGMaps' own:
  the support search's span check and final analysis, and greedy maximum coverage.
- **Papers.** Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess : un modèle pour
  cartographier automatiquement l'accessibilité des forêts, _Revue forestière française_ 67(2):
  111–126, doi:10.4267/2042/57902; the Sylvaccess 3.6 detailed user notice (INRAE UR LESSEM,
  September 2024; software deposit doi:10.15454/JUBESS); Clouet N., Berger F., Monnet J.-M.,
  Descroix L. (2010), CARTUVI – un modèle sous SIG pour la cartographie des surfaces débardables en
  zone de montagne, _Revue forestière française_ 62(2): 155–171 (winch rule); Suvinen A. (2006), A
  GIS-based simulation model for terrain tractability, _Journal of Terramechanics_ 43(4): 427–449
  (side-slope rule); Dupire S., Bourrier F., Berger F. (2016), Predicting load path and tensile
  forces during cable yarding operations on steep terrain, _Journal of Forest Research_ 21(1):
  1–14 (tension-limited catenary line test); Irvine H. M. (1981), _Cable Structures_, MIT Press;
  Pestal E. (1961), _Seilbahnen und Seilkräne_ (break angles). Line selection: Church R., ReVelle C.
  (1974), The maximal covering location problem, _Papers of the Regional Science Association_ 32:
  101–118; Nemhauser G. L., Wolsey L. A., Fisher M. L. (1978), An analysis of approximations for
  maximizing submodular set functions, _Mathematical Programming_ 14: 265–294; Khuller S., Moss A.,
  Naor J. (1999), The budgeted maximum coverage problem, _Information Processing Letters_ 70(1):
  39–45; Minoux M. (1978), Accelerated greedy algorithms for maximizing submodular set functions,
  _Optimization Techniques_, LNCS 7: 234–243.
- **Reference runs.** Sylvaccess 3.6 was run unmodified on synthetic 5 m planes (60 × 60 cells, the
  whole grid forest) on 10 November 2026. `extractionReach.test.ts` and `winchReach.test.ts` carry
  the numbers as small fixtures on the same planes at 5 m cells. Accessible cells, PGMaps against
  the reference:

  | Case                                                            | PGMaps | Sylvaccess | Note                                                         |
  | --------------------------------------------------------------- | -----: | ---------: | ------------------------------------------------------------ |
  | 20 % plane, road below, roads first: winched to 65 m, then skid |  3,600 |      3,600 | Winch and skid transects within 1 m                          |
  | 20 % plane, drive to the timber                                 |  3,600 |      3,600 | Skidded everywhere, 25 m reads 25, 50 m reads 51 (±1 m)      |
  | 40 % plane, road below: winched to 50 m (54 m line)             |    780 |        779 | One corner cell                                              |
  | 40 % plane, road above: winched to 90 m (97 m line)             |  1,260 |      1,259 | One corner cell                                              |
  | 40 % plane, one road cell: winch envelope                       |    797 |        797 | 54 m at 50 m up, 80 m across, 97 m at 90 m down              |
  | 20 % plane, 100–130 m strip closed to machines                  |  1,980 |      1,979 | Skid to 97.5 m (86 m), winched across to 162.5 m (86 + 66)   |
  | 20 % plane, strip closed to extraction                          |  1,200 |      1,199 | Nothing at or beyond 102.5 m                                 |
  | Forwarder, 10 / 20 / 30 % planes, road below                    |  3,600 |      3,600 | 286 / 291 / 298 m at the far edge (±1 m)                     |
  | Forwarder, 20 % plane, one road cell                            |  2,303 |      2,181 | +5.6 %: crane and ray-touch detail; reference not symmetric  |
  | Forwarder, 25 % plane, one road cell                            |  1,616 |      1,650 | −2.1 %: tangent form of the side rule                        |
  | Forwarder, 20 % plane, one road cell, 100 m steep budget        |    891 |      1,040 | Budget enforced on first reach: fan ends at 100 m, not 110 m |

  Sylvaccess reports skid distances as centimetre steps truncated to the metre and winch lengths
  rounded to the metre; PGMaps keeps metres unrounded, so transects agree to within 1 m.

- **Cable reference run.** Sylvaccess 3.6 was run unmodified on the `cable_concave` case (10
  November 2026): a 1 km square of forest on 5 m cells, a valley floor along y = 400 m, a concave
  slope to the north (`z = 500 + 0.0015·(y − 400)²`, 60 % at 200 m) and a 5 % rise to the south, a
  road from x = 472.5 to 527.5 m on y = 402.5 m; the trailer preset with a 300 m skyline (276 m
  usable), lines of at least 100 m, 40 m lateral yarding, every 1°. `cableCoverage.test.ts` and
  `crates/cable-layout/tests/coverage.rs` carry its numbers for the middle start cell (360 lines,
  every one with the yarder below):

  | Bearing                   | Skyline, PGMaps / Sylvaccess (m) | Supports    | Area (m²)       | Mean carriage (m) | Note                                                    |
  | ------------------------- | -------------------------------- | ----------- | --------------- | ----------------- | ------------------------------------------------------- |
  | 0°, up the concave slope  | 274 / 274                        | 0 / 0       | 22,100 / 22,100 | 128 / 127         | One span; the band lies on the grid's axes              |
  | 15°                       | 275 / 270                        | 0 / 0       | 20,600 / 22,300 | 129 / 126         | Cell centres against all-touched cells                  |
  | 30°, side-slope cut       | 132 / 129                        | 0 / 0       | 10,425 / 11,650 | 65 / 62           | Cut by the side-slope rule in both                      |
  | 45°                       | 161 / 160                        | 0 / 0       | 13,225 / 13,800 | 80 / 78           |                                                         |
  | 60°                       | 191 / 229                        | 0 / 1       | 15,250 / 20,550 | 95 / 115          | Its support breaks the loaded line by 44–70°; see below |
  | 90°, along the flat floor | 275 / 275                        | 1 / 1       | 23,800 / 23,800 | 138 / 137         | Needs a support (PGMaps at 135 m)                       |
  | 180°, up the 5 % side     | 275 / 275                        | 1 / 1       | 23,800 / 23,800 | 138 / 137         | Support at 135 m; Sylvaccess at 125 m                   |
  | 300°                      | 191 / 225                        | 0 / 1       | 15,250 / 20,100 | 95 / 111          | As 60°                                                  |
  | 330°, side-slope cut      | 132 / 127                        | 0 / 0       | 10,425 / 11,550 | 65 / 62           |                                                         |
  | All 360 lines, mean       | 251 / 254                        | 0.61 / 0.68 | 19,844 / 22,221 |                   | −10.7 % area: cell centres, and 60°/300°-type lines     |

  Over all 360 bearings the skyline lengths agree within 7 m on 332 (median difference 2.3 m) and
  the supports on 336. The 24 that differ are the fans 58–69° and 291–302°, where the reference
  puts one support on the concave slope. PGMaps holds the loaded break angle at an intermediate
  support to 30° at every carriage position (the support search's rule, after Pestal 1961); there
  the carriage beside the support bends the rope by 44–70° at the shared pre-tensions analysed, so the
  support fails and the line stops short (155–209 m) without one. Sylvaccess compares only the
  chords' angles. Four side-slope-cut lines (37°, 318–326°) end 7–12 m from the reference's: the
  slope read from the ground trend's central differences rather than Horn's operator moves the
  point where the 15 % share is met by a sample or two. Areas agree exactly on bands along the
  grid's axes and are up to about 10 % lower on oblique ones, because PGMaps counts cells whose
  centre lies in the band and Sylvaccess every
  cell it touches. From all 12 road cells (4,320 lines, all working), PGMaps covers 25.6 ha; the
  reference's 3,960 lines from 11 start cells cover 26.6 ha. The reference's workbook reports
  −26.4 ha "inaccessible" against its 0.2 ha area of interest, the defect noted above.
