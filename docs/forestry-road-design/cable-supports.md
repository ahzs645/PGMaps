# Intermediate supports: multi-span skyline layout

A D-line with **Rope and load** can be given intermediate supports. **Find supports** searches the
profile for where to put supports and how tall, with one skyline pre-tension for the whole rope, so
that the loaded carriage keeps the rigging's minimum clearance, the skyline stays within its
allowable tension, the saddle angles stay within their limits and, for a gravity carriage, the
loaded path falls away from the yarder. Among the layouts that pass, it takes the one with the
fewest supports, then the lowest. The D-line profile then draws the multi-span loaded path, the
empty skyline and the supports, and the section lists the limits and every support.

The search is Rust compiled to WebAssembly (`crates/cable-layout`), loaded only when a search or a
check is asked for, and run in a worker so the page stays responsive and **Cancel** stops it at once.

**Where it is.** Review → **D-line / cable geometry** → a D-line with **Sag from: Rope and load** →
**Intermediate supports**. Fixed supports and no-support sectors are drawn on the D-line profile as
soon as they are entered; the layout is drawn once found.

## Before you rely on it

- **It is a static layout screen.** It has no dynamic, braking or impact loads, no lateral yarding,
  wind or side-hill loads, and no rope wear. It is not a rigging plan, an anchor or tree assessment,
  or a WorkSafeBC check. Plan the operation with the BC cable-yarding references and the
  equipment's own ratings.
- **Replace the example rigging** on the D-line first (see
  [Cable mechanics](cable-mechanics-and-reach.md)). The minimum clearance is the rigging's
  _Minimum load clearance_; the yarder tower is the D-line's yarder height.
- **The cost is a proxy, not dollars.** Each support costs (height + 100)², five times that above
  _Built support above_, and a ground anchor 1 (Bont & Heinimann 2012). That puts fewest supports
  first and lowest supports second. It knows nothing of tree availability, access or crew time.
- **Candidate sites are a grid plus convexity peaks.** Supports are tried every _Candidate spacing_
  metres and at local humps of the ground, and only on ground that is not in a hollow between its
  neighbours. A good tree between two candidates is not considered: enter it as a fixed support.
- **Unknown ground stays unknown.** A span over a sample with no ground is never proven clear, so the
  line cannot cross it; the section says where. Anchors behind support ends are moved in to the
  last metre of known ground.
- **Tree and anchor sizes are not given.** Required support-tree and anchor-stump diameters need
  Pestal's (1961) table or a practice table; neither is reproduced here. Use the saddle forces and
  anchor tensions in the support table with your own sizing method.
- **The pre-tension is at the yarder-side support top**, as the empty skyline's tension there. The
  D-line profile's single-span _base tension_ is at the span's lower support; the two are different
  numbers for the same rope.

## What it checks and does not

| Checked                                                                                          | Not checked                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Loaded carriage clearance at every ground sample of every span, with the carriage moved along it | Dynamic loads, lateral yarding, wind, side-hill loads             |
| Largest skyline tension anywhere in the rope, every load position, against the allowable         | Support-tree and anchor-stump diameters, guylines, tree stability |
| Empty break angle at intermediate supports (lift-off) and loaded break angle at every support    | Saddle friction, rope sliding resistance, temperature, creep      |
| Gravity carriage: the loaded path falls away from the yarder on every span (two-cable system)    | Running-line tensions, carriage brakes, drum and tower ratings    |
| Fixed supports, no-support sectors, support height range, start and end element types            | Supports that lean, or sit off the D-line                         |
| Saddle forces (rope only, carriage on, carriage either side), anchor tension and pull angle      | Lift-off under load cycling; whether a hold-down lug is fitted    |

## Limits and budgets

| Limit                    | Value                                                                                               | Enforced in                                                                                                                        | When exceeded                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Setting ranges           | see `SUPPORT_LAYOUT_LIMITS` (e.g. supports 1–50 m, angles 0–90°)                                    | `cableLayout/settings.ts` `SUPPORT_LAYOUT_LIMITS`, `supportLayoutErrors`, `parseSupportLayout`                                     | Field clamps; project file refused                           |
| Line length              | 20–3,000 m                                                                                          | `cableLayout/settings.ts` `MAX_LAYOUT_LINE_M` (= `cableMechanics.ts` `MAX_MECHANICS_SPAN_M`)                                       | Find supports says why it cannot run                         |
| Ground spacing           | 1 m, out to the anchors                                                                             | `cableLayout/settings.ts` `LAYOUT_PROFILE_SPACING_M`                                                                               | Fixed                                                        |
| Load positions per span  | 33, cosine-spaced; path between them interpolated (≤ 1 cm on 400 m)                                 | `cableLayout/settings.ts` `LAYOUT_LOAD_POSITIONS`                                                                                  | Fixed                                                        |
| Spans checked per run    | 400,000                                                                                             | `cableLayout/settings.ts` `MAX_LAYOUT_SPANS`; crate `InputError::TooManySpans`                                                     | Refused: widen the candidate spacing or the height step      |
| Pre-tensions searched    | lowest pre-tension to the allowable, 1 kN steps, at most 2,000 steps                                | `cableLayout/settings.ts` `MAX_TENSION_STEPS`                                                                                      | The step widens                                              |
| Re-checks of a best line | 60 per pre-tension, 4,000 per run                                                                   | `crates/cable-layout/src/search.rs` `MAX_REPAIRS`, `MAX_VERIFICATIONS`                                                             | That pre-tension is dropped; "stopped at its repair budget"  |
| Fixed supports, sectors  | 50 each; a fixed support may not sit inside a sector                                                | `cableLayout/settings.ts` `MAX_FIXED_SUPPORTS`, `MAX_SECTORS`, `supportLayoutErrors`                                               | Project file refused; Find supports disabled with the reason |
| Saved layout             | 200 supports, stations forwards from the yarder                                                     | `cableLayout/settings.ts` `MAX_SAVED_SUPPORTS`, `parseSupportLayout`                                                               | Project file refused                                         |
| Span windows reported    | 40,000                                                                                              | `crates/cable-layout/src/codec.rs` `MAX_REPORTED_ARCS`                                                                             | The rest are counted, not listed                             |
| Tension                  | the allowable exactly (no tolerance)                                                                | `crates/cable-layout/src/context.rs` `check_catenary`                                                                              | Span rejected                                                |
| Coverage screen          | ≤ 10 supports, ≤ 64 pre-tensions, 5 candidates kept per level, 3 targets each, 3 analyses per chain | `crates/cable-layout/src/coverage.rs` `MAX_COVER_SUPPORTS`, `MAX_COVER_TENSIONS`, `COVER_BEAM`, `COVER_TARGETS`, `VERIFY_TENSIONS` | Batch refused (codes as above); a line stops growing         |
| Coverage spans per line  | the batch's `max_arcs` (PGMaps sends 3,000)                                                         | `coverage.rs` `CoverParams::max_arcs`; `cableCoverageRule.ts` `MAX_COVER_SPANS_PER_LINE`                                           | That line is reported at its budget                          |

**Runtime.** Measured in Node on the committed WebAssembly: a 400 m line with a knoll, 8,292 spans,
0.6 s; a 600 m line on uneven ground, 41,604 spans, 2.6 s; a 1,000 m line, 100,580 spans, 5.0 s.
Most of the time is the span check, a few elastic-catenary solves per pre-tension tried. A span
whose most optimistic path (the chord less the moment of its loads over the allowable tension)
already fails is rejected without solving.

## Built-in assumptions

### The search

1. **Candidates.** Every _Candidate spacing_ metres from the yarder, the far end, convexity peaks
   (where the ground stands highest above the chord of the points 10 m either side, a local maximum
   within 5 m, above a threshold lowered from 1 m in 0.1 m steps until three remain) and the fixed
   supports. Then the no-support sectors remove every candidate strictly inside them, peaks
   included. A candidate must not sit below the line between its neighbouring candidates, except
   the five nearest each end and the fixed supports.
2. **Heights.** Each candidate gets the ladder from _Lowest support_ to _Tallest support_ in _Height
   step_; a fixed support with a height gets only that. A yarder start is its tower; an anchor end is
   a ground anchor (height 0); a support end, or start, takes the ladder from 0, where 0 makes it a
   ground anchor the carriage runs to.
3. **Spans.** Every forward span between two candidates at least _Min support spacing_ apart (spans
   from the start or to the end at any distance) that does not jump a fixed support.
4. **Pre-tension window per span.** Each span is checked over the pre-tensions searched. Clearance
   and the gravity carriage get better as the rope tightens and the tension check gets worse, so the
   span works over a closed interval: the lowest pre-tension that clears and the highest within the
   allowable, found by false position on the checks' margins.
5. **Cheapest line per pre-tension**, by dynamic programming over spans in station order. One
   pre-tension serves the whole rope, so two spans that each work fail together when their windows
   do not overlap.
6. **Re-check.** The best line is analysed with the final analysis below. A span that fails there,
   or a support whose break angles fail, is banned at that pre-tension (a support angle bans the
   pair of spans either side) and the line is searched again. Keys only get worse with bans, so the
   first line that passes, best key first, is the optimum.
7. **Choice.** A complete line before an incomplete one, then the cheapest, then the lowest
   pre-tension. The pre-tensions that give the same line are reported as its range.
8. **A line that stops short** keeps the farthest support it reached (the cheapest at that station)
   and reports the limit that stops most spans out of it, at the nearest such span.

### The span

The loaded span is the elastic catenary with a point load of `cableMechanics.ts` (Irvine 1981),
solved at 33 load positions. Every other field of the rope (the other spans, and in the search the
straight stand-ins from the yarder to the span and from the span to the end, and the anchor fields)
is an elastic field with Zweifel's (1960) parabolic sag excess. The empty skyline's tension is the
pre-tension at the yarder-side support top and rises by the rope's weight per metre of height. The
rope slides freely over the saddles, so the fields before the loaded span take the tension rise of
its near support and the fields after it that of its far support, while the rope's total unstrained
length stays the one the empty rope fixed. Half the running lines' weight is added to the skyline's,
as in `cableMechanics.ts`. On one span with nothing beyond it the result is `cableMechanics.ts`'s
base mode (tested to 0.5 % on tension and 0.05 m on sag).

The search checks each span with its neighbours as straight stand-ins and the far ends at their
lowest heights; the final analysis checks it with the real neighbours. Both use the same function,
and the re-check (step 6) makes the reported layout the one that passes the final analysis.

### The checks

- **Clearance.** At every ground sample strictly between the supports, loaded path − ground ≥ the
  rigging's minimum clearance. Within _Clearance from start after_ / _up to before end_ of the line's
  ends the requirement is 0 m (the path may come down to the ground at a ground anchor, not below
  it).
- **Tension.** The largest tension anywhere in the rope with the load at each position: at the
  loaded span's supports and, through the weight per metre of height, at the highest point of each
  side, against breaking force ÷ safety factor.
- **Gravity carriage** (two-cable system only, and only between _Gravity check after_ and _up to
  before end_): between each pair of load positions the loaded path must fall away from the yarder
  by at least _Min gravity grade_. A two-cable line with the yarder below the far end is refused.
- **Break angles** (Pestal 1961). The rope's direction arriving at and leaving each support comes
  from the solved catenary (next to an anchor, the anchor chord). The empty break angle is arriving −
  leaving; at an intermediate support it must be at least _Min empty break angle_ or the empty rope
  lifts off. The loaded break angle is the larger of loaded-arriving − empty-leaving and
  empty-arriving − loaded-leaving, over every carriage position on the span either side, against
  _Max loaded break_ (intermediate) or _end support_. Taking every carriage position is stricter
  than Pestal's mid-span parabola: the carriage close to a support bends the rope most. A support
  below _Hold-down lug below_ is listed as needing a lug; that limit does not reject a layout.
- **Saddle forces.** Rope only: the empty tension times the difference of the two rope directions.
  Carriage on the saddle (intermediate supports): that plus the load, half the skyline of both spans
  and half the running lines from the yarder out to the support. Carriage either side: the loaded
  tension at the support with one loaded and one empty direction, the largest over the positions.
- **Anchors.** The largest tension that reaches the anchor over every span and position, and the
  pull angle between the rope and the ground there.

## Reading the results

- **Summary line.** Supports between the ends, the pre-tension and the smallest load clearance.
- **Limits.** One row per check: limit, the layout's value, and met / not met / not assessed. Not
  assessed means the check could not be made (unknown ground, an unsolved span, the gravity check on
  a multi-cable system); it is never shown as met.
- **Supports.** Kind, station from the yarder, saddle height, empty / loaded break angle, the largest
  force (saddle force for supports, rope tension for anchors) and the anchor pull angle. **Spans:**
  loaded sag, smallest clearance (or unknown) and largest tension.
- **Supports CSV.** Every support, span and the line, with every force and angle above. It is
  refused while the rigging or a support setting is invalid, and offered only for a result that
  matches the D-line as it is now.
- **Saved layout.** A found layout is saved with the D-line (stations, heights, pre-tension). After
  the D-line, rigging, terrain or settings change, **Check saved layout** analyses it as the line is
  now, without searching. An edited layout is saved beside it (see below).

## Adjusting the layout by hand

The search's answer is a starting point. **Adjust layout** (under the Find supports button, once a
layout is saved) opens it for editing; **Place supports by hand** starts with only the two ends. The
edit is saved with the D-line beside the found layout, which stays as it was, and reopens on reload.
While an edit is open the section shows it in place of the found result, and so does every output:
the plan dots, the D-line CSV and report, the Stake-out CSV and the D-line sheet use the edit and say
so (see [D-line outputs](cable-outputs-and-field-profiles.md)).

- **What can change.** Each intermediate support's station and saddle height; supports added
  (**After** on a row, or **Add support in the longest span**) and deleted; a support start's or
  end's height; the start and end elements (the **Start** and **End** choices above, which also set
  the search); and the pre-tension. A station field is bounded by its neighbours, so a support never
  passes another. Supports do not lean in this model, so there is no lean to edit.
- **Re-check.** About 300 ms after the last change (`EDIT_CHECK_DELAY_MS`) the edit is analysed in
  the worker with the same final analysis as the search (`cl_analyze`), at the entered pre-tension
  and with the ends as the D-line is now. A newer change cancels a pending or running check; the
  chart keeps the last rope drawn, marked _re-checking_, until the new one arrives.
- **Found and Current.** One table puts the found layout (re-checked on the D-line as it is now)
  beside the edit: every limit of the limits table with its state, then the supports, their stations
  and heights, the pre-tension, the largest saddle force and anchor tension, and the rope length. A
  dot marks a value that changed. **Placement** (current only) lists supports inside a no-support
  sector or closer than _Min support spacing_: the analysis does not check either, so the edit can
  break them, and the section says where.
- **Locate a row.** Picking a row's name (or a span in the spans table) marks where it applies on the
  D-line chart: the smallest clearance or each failing span's worst point, the support end with the
  highest tension, the supports past an angle limit, the gravity stop, the supports needing a lug.
  The D-line's cursor and the plan's move to the first mark. Picking it again clears the marks.
- **On the chart.** Drag a support's handle sideways to move it, or up and down to change its height:
  the first `MIN_SUPPORT_DRAG_PX` of movement picks which, and the plan cursor follows. Double-click
  the profile to add a support there (starting an edit if none is open); Shift-drag along it to draw
  a no-support sector. Escape cancels. A focused handle takes the arrow keys (left and right move it
  1 m, up and down change the height 0.5 m; Shift: 10 m and 2 m) and Delete. Each gesture has a
  sidebar field or button that does the same.
- **Names and categories.** Each support, and a support start or end, can be named (a spar, a stump)
  and given a category: support tree, mast, ground anchor or other. The chart draws a symbol at its
  foot and the name over it, and the edited layout's **Supports CSV** adds `support_name` and
  `support_category` as its last two columns. They are labels only: nothing is sized or checked from
  them.
- **Reset to found** replaces the edit with the found layout; **Discard edits** removes it.

| Limit                         | Value                                          | Enforced in                                                                           | When exceeded                                        |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Intermediate supports in edit | 50                                             | `cableLayout/layoutEdit.ts` `MAX_EDITED_SUPPORTS`, `parseEditedLayout`                | Add buttons disabled; project file refused           |
| Support spacing in an edit    | 1 m from a neighbour or an end                 | `layoutEdit.ts` `MIN_EDIT_SPACING_M`, `stationBounds`, `addSupportAt`                 | Station clamped between neighbours; no support added |
| Edited heights                | supports 1–50 m; a support start or end 0–50 m | `layoutEdit.ts` `EDIT_SUPPORT_HEIGHT_M`, `EDIT_END_HEIGHT_M`                          | Field and drag clamp; project file refused           |
| Edited pre-tension            | 1–10,000 kN                                    | `layoutEdit.ts` `EDIT_PRE_TENSION_KN`                                                 | Field clamps; project file refused                   |
| Support name                  | 60 characters                                  | `layoutEdit.ts` `MAX_SUPPORT_NAME_LENGTH`                                             | Field stops; project file refused                    |
| Re-check delay                | 300 ms after the last change                   | `layoutEdit.ts` `EDIT_CHECK_DELAY_MS`; `cableLayout/editStore.ts` `scheduleEditCheck` | –                                                    |
| Drag threshold                | 4 px before a support drag edits               | `layoutEdit.ts` `MIN_SUPPORT_DRAG_PX`                                                 | A shorter press only moves the cursor to it          |
| Drawn sector                  | at least 2 m, rounded to the metre             | `layoutEdit.ts` `MIN_DRAWN_SECTOR_M`, `sectorFromDrag`; `settings.ts` `MAX_SECTORS`   | Not added                                            |
| Rounding                      | stations and heights to 0.1 m                  | `layoutEdit.ts` `EDIT_ROUNDING_M`                                                     | –                                                    |

## Failure modes

| You see                                                                   | It means                                                                                       | Do this                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "The loaded carriage would not clear the ground at N m"                   | Most spans out of the last support hit the ground there even at the allowable tension          | Raise the tallest support, add a fixed support near N, lighten the turn       |
| "…needs a pre-tension of a–b kN, which the rest of the line cannot share" | The next span works alone, but not at any pre-tension the rest of the line works at            | Allow taller supports before it, or a fixed support that shortens it          |
| "A gravity carriage would stop at N m"                                    | The loaded path rises towards the next support                                                 | Use a multi-cable system, a taller support before N, or a support at the hump |
| "Ground is unknown at N m"                                                | No span over the gap can be shown to clear                                                     | Load terrain that covers the line                                             |
| "The empty skyline would lift off the support at N m"                     | A support stands below the rope line; the search banned it and found no other way              | Lower the minimum empty break only if a hold-down is fitted; move the support |
| Line stops short                                                          | No span from the last support reaches on; the layout up to there is kept and checked           | Read the reason; the partial line's tension and clearance are its own         |
| "Too many spans to check"                                                 | The candidate grid × height ladder is over the span budget                                     | Widen the candidate spacing or the height step, narrow the height range       |
| A layout with more supports than SEILAPLAN gives                          | The catenary path hangs lower near supports than SEILAPLAN's parabola, and angles are enforced | Expected; see the comparison below                                            |
| "Ground is unknown under the support at N m"                              | An edited support stands where the terrain has no ground                                       | Move it onto known ground                                                     |
| "Support N at S m is outside the line"                                    | The D-line was shortened after the edit                                                        | Move or delete that support                                                   |
| Placement: a support "stands in the no-support sector"                    | The edit breaks a search rule the analysis does not check                                      | Move the support, or change the sector                                        |
| Placement: supports "under the … minimum spacing"                         | The edit breaks a search rule the analysis does not check                                      | Move one apart, or lower the minimum spacing                                  |

## How the numbers were checked

The crate's tests (`cargo test --release` in `crates/cable-layout`) and `cableLayout.test.ts` (the
committed WebAssembly in Vitest) check the method against a reference run of SEILAPLAN 3.8.2 on 10
November 2026, through a **SEILAPLAN parity** model: Zweifel's three-field rope with SEILAPLAN's
parabolic load path and its search and selection rules, defects included. Parity is a test model
only; the road tool always uses the catenary model.

Profiles: A, 40 % straight slope, 250 m; B, concave valley, 400 m; C, 30 % slope with an 18 m knoll
at 200 m; D, C with a fixed 14 m support at 150 m; E, C with no supports 170–230 m and a ground
anchor end; F, B with a support start; G, C with a 35 kN load. SEILAPLAN's Standard set with a 20 kN
load, yarder 12 m, end support with an anchor 20 m behind.

| Vector | Supports (station / height)        | Objective | Spans checked | Pre-tension, reference / parity (ties) |
| ------ | ---------------------------------- | --------- | ------------- | -------------------------------------- |
| A      | 0/12, 210/22, 250/0 — same         | 27,430 ✓  | 2,252 ✓       | 83 (83–85) / 83 (83–86)                |
| B      | 0/12, 400/6 — same                 | 23,781 ✓  | 2,252 ✓       | 66 (66–67) / 66 (66–69)                |
| C      | 0/12, 200/10, 400/10 — same        | 36,745 ✓  | 7,524 ✓       | 83 (83–105) / 82 (82–105)              |
| D      | 0/12, 150/14 — same                | 37,204 ✓  | 4,357 ✓       | 106 (106–115) / 104 (104–115)          |
| E      | 0/12, 200/10, 380/10, 400/0 — same | 36,746 ✓  | 3,313 ✓       | 66 (66–100) / 64 (64–102)              |
| F      | 0/22, 400/6 — same                 | 11,237 ✓  | 3,088 ✓       | 61 (61–72) / 61 (61–72) ✓              |
| G      | none — same                        | –         | –             | –                                      |

Supports, heights, objectives, convexity peaks and the number of spans checked are exact. The
pre-tension windows come within one step of SEILAPLAN's bisection (81/64 kN) on the vector C spans
the reference lists, and the chosen pre-tension within 2 kN. The remaining gap is SEILAPLAN's
tension-rise solve, which stops at the first value whose length mismatch is under 1/64 m and so
moves each window edge by up to about 0.7 kN; its exact stepping is not documented, and several
plausible readings were tried. At the reference's own pre-tension the parity final analysis
reproduces the reference's loaded tensions, sags, clearances (A 6.89/8.05 m, B 4.55 m, C 7.34/6.46
m), break angles (A 26.16°/33.74°), saddle forces (A 58.75 kN, C 42.50 kN, E 39.98/43.39 kN), rope
lengths and anchor force to 0.5 %.

The catenary model on the same profiles, with its fixes:

| Vector | Catenary layout (station / height)        | Pre-tension | Smallest clearance | What changed and why                                                                          |
| ------ | ----------------------------------------- | ----------- | ------------------ | --------------------------------------------------------------------------------------------- |
| A      | 0/12, 130/14, 250/12                      | 90 kN       | 7.03 m             | SEILAPLAN's 210 m support has a 33.7° loaded break (40° on the catenary), over the 30° limit  |
| B      | 0/12, 40/22, 380/8, 400/0                 | 69 kN       | 7.33 m             | SEILAPLAN's single span clears by 4.55 m on its own final analysis                            |
| C      | 0/12, 170/14, 200/10, 380/10, 400/0       | 103 kN      | 7.37 m             | SEILAPLAN's 200→400 m span clears by 6.46 m; the catenary sags more near the supports         |
| D      | 0/12, 150/14, 170/8; stops short          | 89 kN       | 8.11 m             | The farthest support is kept, not dropped; the partial line's tension is within the allowable |
| E      | 0/12, 20/14, 170/16, 230/18, 380/8, 400/0 | 107 kN      | 7.38 m             | No support inside 170–230 m; SEILAPLAN put one at the 200 m peak                              |
| F      | 0/14, 360/12, 380/8, 400/0                | 69 kN       | 7.83 m             | Every start height is charged                                                                 |
| G      | 0/12, 40/10; stops short                  | 102 kN      | 7.94 m             | Says why: the carriage does not clear at 79 m on the next spans                               |

Every catenary layout above passes its own final analysis on every span and support (clearance,
tension, gravity, lift-off, loaded break), which the tests assert.

## The coverage screen

Design → Extraction reach → **Cable yarder** ([Extraction reach](extraction-reach.md)) asks the
module a different question of thousands of lines: along a line from a landing, how long a skyline
works with at most N supports of one height. `cl_cover` takes a batch (`codec.rs` `COVER_HEADER`:
the layout run's first 36 settings, then the tail height, most supports, tail step, shortest line,
span budget per line and the lines, each its ground from the yarder and the farthest tail to try)
and returns per line its status, length, supports, pre-tension and why the farthest tail failed.

`coverage.rs` judges every span with `search::evaluate`, the support search's own span check, and
analyses every line it returns as a complete line with `analysis::analyze` and
`analysis::support_failure` (the break-angle and lift-off test the search's re-check uses too).
Tails are tried from the farthest inward; chains of spans are grown by number of supports, each
candidate carrying a bit mask of the pre-tensions at which a chain reaches it, so one pre-tension
still serves the whole rope; from each kept candidate the 3 farthest working targets, and at each
level the 5 farthest candidates, go on. The first chain to reach the tail is analysed at the lowest,
highest and middle of its shared pre-tensions, fewest supports first. On the reference profiles of
the extraction guide it agrees with Sylvaccess 3.6's line lengths and supports except where the
loaded break angle limit applies (`tests/coverage.rs`). Measured natively: 180 bearings of a 276 m
line in 0.5 s, about 40 spans each.

## The build

- `crates/cable-layout` is a plain `cdylib` with a small C ABI (`cl_alloc`, `cl_begin`, `cl_step`,
  `cl_finish`, `cl_analyze`, `cl_cover`, `cl_result_ptr`) over `f64` buffers, and no dependencies,
  so the build needs no binding generator. `cableLayout/cableLayout.ts` encodes the input and
  decodes the result (`codec.rs` documents the format; change both together and bump the version,
  now 2). The worker takes a `cover` request of several batches and reports progress after each.
- `rust-toolchain.toml` pins Rust 1.98.0 with the `wasm32-unknown-unknown` target.
- `npm run wasm:cable` rebuilds `src/pages/dev-forestry-roads/cableLayout/cable_layout.wasm`:
  release, one codegen unit, `panic=abort`, LTO, no debug information, stripped, with every local
  path remapped (`scripts/build-cable-wasm.mjs`). Two clean rebuilds, one from another directory,
  gave identical bytes. Commit the rebuilt file with any change to the crate.
- The **Checks** workflow's `cable-wasm` job runs the crate's tests, rebuilds the file and fails when
  the committed bytes differ, uploading the rebuilt file as `cable-layout-wasm-rebuilt` to commit.
- The page loads the file with `new URL(..., import.meta.url)` inside `cableLayout.worker.ts`, only
  when **Find supports** or **Check saved layout** is pressed; Vitest reads it from disk.

## Provenance

- **Method.** Bont, L. G., Heinimann, H. R. (2012), the candidate-grid × height network and the
  fewest-then-lowest objective, as described in Bont, L. G., Moll, P. E., Ramstein, L., Frutig, F.,
  Heinimann, H. R., Schweier, J. (2022), _SEILAPLAN, a QGIS plugin for cable road layout design_,
  Croatian Journal of Forest Engineering 43(2): 241–255, doi:10.5552/crojfe.2022.1824 (constraints
  I–III, candidate spacing, angle limits not optimized in the plugin).
- **Mechanics.** Zweifel, O. (1960), the fixed-length skyline (sag, excess-length and compatibility
  terms) for the parity model and the non-loaded fields; Irvine, H. M. (1981), the elastic catenary
  already in `cableMechanics.ts`; Pestal, E. (1961), support angles and saddle forces.
- **Specification and reference run.** Written in PGMaps from a functional specification of
  SEILAPLAN 3.8.2 (WSL / ETH Zürich, GPL-2.0-or-later) prepared by a reviewer who read its code;
  the implementer did not. No code from SEILAPLAN was used. The comparison numbers come from running
  SEILAPLAN 3.8.2 unmodified on the profiles above (reference run, 10 November 2026); only the
  numbers are kept, in the tests. See
  [Converting the reference projects](reference-repo-licensing-and-conversion.md).
- **Coverage screen.** `coverage.rs` answers the line question of Sylvaccess 3.6's cable module
  (INRAE, GPL-3.0-or-later; Dupire et al. 2015, _Revue forestière française_ 67(2): 111–126; Dupire,
  Bourrier & Berger 2016, _Journal of Forest Research_ 21(1): 1–14), written from a functional
  specification of it; no code from Sylvaccess was used. Its search is this crate's own and its
  checks are the support search's. Reference run of Sylvaccess 3.6, 10 November 2026: see
  [Extraction reach](extraction-reach.md), Provenance.
- **Defects of the reference fixed in the catenary model:** support placed inside a no-support
  sector; only the lowest start height charged; an incomplete line dropping its farthest support
  while counting its cost; the truncated line's tension not re-checked; break-angle limits reported
  but not enforced; the optimizer's parabola clearing where its own final analysis does not; no
  notion of unknown ground.

## References

- Bont, L. G., Heinimann, H. R. (2012). Optimum geometric layout of a single cable road. _European
  Journal of Forest Research_ 131(5): 1439–1448.
- Bont, L. G., Moll, P. E., Ramstein, L., Frutig, F., Heinimann, H. R., Schweier, J. (2022).
  SEILAPLAN, a QGIS plugin for cable road layout design. _Croatian Journal of Forest Engineering_
  43(2): 241–255.
- Bont, L. G., Ramstein, L., Frutig, F., Schweier, J. (2022). Tensile forces and deflections on
  skylines of cable yarders: comparison of measurements with close-to-catenary predictions.
  _International Journal of Forest Engineering_.
- Irvine, H. M. (1981). _Cable Structures_. MIT Press.
- Pestal, E. (1961). _Seilbahnen und Seilkräne für Holz- und Materialtransport_. Fromme, Wien.
- Zweifel, O. (1960). Seilbahnberechnung bei beidseitig verankerten Tragseilen. _Schweizerische
  Bauzeitung_ 78.
