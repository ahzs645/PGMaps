# Review checks, design standards and the crossing register

Read this before you sign a road off from the Review step, enter the job's limits, or rely on the
"Readiness checks" table in a report.

Review answers one question for the active road: what would a designer still have to do, or look
at, before this leaves the workspace? It does that with three things: a list of checks, the
project's design standards, and one register of the places water crosses the road. None of them
certifies a road standard. Every limit is a project input.

## The readiness list

`readiness.ts` holds the rule for each row (`assessReadiness`). It is pure: it takes the project's
settings and standards, the road, its calculated analysis, the cost prompts from
`costReadiness.ts`, the saved drainage check and the swept-path result, and returns rows. The
Review step and the report both render those rows, so the printed list is the list on screen.

Each row has one of three states.

| State           | Means                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Met             | The check was made and nothing is outstanding.                                                        |
| Needs attention | The check was made and something is outstanding: a limit is broken, or an input is still to do.       |
| Not assessed    | The workspace could not make the check: no limit entered, no result, a stale result, or out of scope. |

**Not assessed is not a pass.** A check with no limit, such as clearing width before a limit is
entered, shows its measured value and stays not assessed. A drainage check that no longer matches
the road is not assessed, not "checked".

**A rule reads met only on a calculation it made.** Two things stop a rule judging: its own input
is empty (no streams, no limit, no culvert), or the analysis it reads produced nothing (an invalid
input with no earlier valid result, or a line the engine cannot read). In both, the row is not
assessed. With nothing calculated, a project that has a stream and an excluded area does not read
"the road crosses none of the 1 mapped stream" or "the centreline is clear": those were never
tested. Rules judged on an input alone (terrain cell size, the profile's PVIs, the template, the
standards) keep their state, because nothing they read is missing. `readiness.test.ts` holds one
case per rule.

A row that needs attention is one of two kinds, shown differently: **outside a limit** (red) for a
broken limit, and **to do** (amber) for an input still at its starting value. A 20 % grade against a
12 % limit and an unedited unit rate are not the same weight.

Each row states the result ("4 of 4 curves are tighter than 60 m"), the measured value ("Tightest
30 m at 0+280.9"), what it was judged on ("Minimum radius 60 m") and, when something is outstanding,
a button that leads to where it is cleared.

**How the Review step lays the list out** (`ReadinessList`, `ReadinessPanel.tsx`; `readinessParts`
and `readinessVerdict`, `readiness.ts`):

- A verdict line leads: "Not ready: 1 outside a limit, 6 to do". It reads "All 23 checks are met"
  only when every check was made and met. With nothing outstanding and some checks not made it
  reads "Nothing needs attention, but 9 checks were not made".
- The rows that need attention follow, **Outside a limit** before **To do**. A row shows its result,
  its measured value and its button; opening it adds the check's own wording and what it was judged
  on.
- **Not assessed** and **Met** are folded groups. Each summary line gives its count ("9 checks"),
  and opening a group lists its rows under the same headings the report uses. A not-assessed row
  keeps its button there ("Run check", "Set standards").
- The printed report lists every row in full, in the report's own order.

| Row                                                 | Met when                                                                                                                                                                        | Not assessed when                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain fit for site quantities                     | Imported terrain at 2 m cells or finer                                                                                                                                          | the terrain records no cell size. Synthetic or coarse terrain needs attention                                                                   |
| Ground and design known at every section            | Coverage is complete (`hasCompleteCoverage`)                                                                                                                                    | no sections were calculated                                                                                                                     |
| Design standards confirmed                          | A person pressed **Confirm standards**                                                                                                                                          | never                                                                                                                                           |
| Profile designed                                    | The road has two or more PVIs                                                                                                                                                   | the road is a mapped road                                                                                                                       |
| Grade within the standard                           | No station breaks the grade rule and no station-range grade limit fails                                                                                                         | no grades were calculated                                                                                                                       |
| Every corner fitted with a curve                    | No station carries a sharp-PI flag                                                                                                                                              | no sections were calculated                                                                                                                     |
| Curve radius at or above the minimum                | Every fitted curve is at or above the minimum radius, or the road is straight                                                                                                   | the minimum radius is 0, the road has corners and no curve is fitted, or the line cannot be read                                                |
| Design vehicle stays on the running surface         | The swept path fits at every turn and, with a steering lock entered, no turn needs more steering than the lock                                                                  | no vehicle has been run on this road                                                                                                            |
| Vertical curve at every grade break                 | Every PVI whose grade changes by 0.5 % or more has a curve the engine applied                                                                                                   | there is no designed profile                                                                                                                    |
| Vertical curves long enough (K)                     | No K, curve-length or tangent check fails                                                                                                                                       | no minimum K or curve length is entered                                                                                                         |
| Stopping sight distance along the road              | Every eye station sees the distance it needs both ways, on the road's own surface, measured along the road                                                                      | no design speed is entered, no stations were calculated, or a sightline crosses missing terrain and no shortfall is proven elsewhere            |
| Turnouts intervisible and within 300 m              | On a single-lane road, each turnout sees the next both ways and stands no more than 300 m from it (Engineering Manual §3.5.2.6)                                                 | a pair's sightline crosses missing terrain and no pair already fails. Left out on a two-lane road or with fewer than two turnouts               |
| Cross-section template set                          | The template differs from the starting one, or matches a confirmed running-surface width                                                                                        | the road is a mapped road                                                                                                                       |
| Ground materials entered                            | No cut is unclassified                                                                                                                                                          | no earthwork was calculated: no stations, or no complete section                                                                                |
| Earthwork balanced or sourced                       | Cut and fill balance within tolerance, or haul allocation is on and no borrow or waste is unallocated                                                                           | no earthwork was calculated, or the material plan was not solved                                                                                |
| Clearing width within the limit                     | No complete section is wider than the limit                                                                                                                                     | no clearing limit is entered                                                                                                                    |
| Every stream crossing has a sized structure         | Each mapped crossing has a culvert with both inverts and a current capacity check that passes                                                                                   | no stream lines are in the project, no sections were calculated, or a crossing has a recorded structure this workspace does not size            |
| Every crossed stream has a reviewed class           | Each crossed stream's status is Reviewed (`streamStatus`)                                                                                                                       | no stream lines are in the project, or no sections were calculated                                                                              |
| Stream crossings square, with straight approaches   | Every mapped crossing has at least 15 m of straight road each side and is no more than 45° off square (Engineering Manual §2.3.3.1; the 45° is a screen)                        | no stream lines are in the project, no sections were calculated, or a crossing cannot be measured against its stream line                       |
| Road kept out of riparian areas except at crossings | No run of calculated stations lies inside a stream's riparian screening area without a crossing of that stream, unless a current conditional-use review records it (FPPR s. 50) | no stream lines are in the project, or no sections were calculated                                                                              |
| Cross-drain sites and modelled streams drained      | The current drainage check has no cross-drain site or modelled stream without a culvert, no stream carried along the road and no undersized culvert, on cells of 2 m or finer   | the check was not run or is out of date, or it ran on cells coarser than 2 m and found nothing else (cross-drain candidates there are a screen) |
| Cross-drain spacing within the limit                | No run between culverts, or from a road end, is longer than the limit                                                                                                           | no spacing limit is entered                                                                                                                     |
| Excluded and conditional areas kept clear           | No sampled centreline station lies inside a constraint area                                                                                                                     | no constraint areas are in the project, or no sections were calculated                                                                          |
| Unit rates entered                                  | No base rate with a quantity is still the starting value or zero                                                                                                                | no quantity was calculated                                                                                                                      |
| Haul, borrow and waste priced                       | Haul allocation is on and no haul prompt remains                                                                                                                                | no earthwork was calculated, or the material plan was not solved                                                                                |
| Structures priced                                   | Every culvert and current crossing record has a price                                                                                                                           | no structures are entered, or no structure cost was calculated                                                                                  |
| Mobilization and contingency set                    | At least one of the two is not zero                                                                                                                                             | never                                                                                                                                           |

A cost prompt from `costReadiness.ts` that the list has no row for is shown as its own row, so a
prompt added there is never dropped here.

**While an input is invalid** the list leads with one more row, under **Inputs**: "The results
leave out 1 invalid input", outside a limit, with the input's message and a button to where it is
corrected. Every row after it is judged on the results, which use that input's last valid value,
and rows that quote an input quote the one the results used. See
[While an input is invalid](sections-quantities-and-costs.md#while-an-input-is-invalid).

**A vertical curve counts only where it is applied.** The engine drops an entered curve that is
longer than its tangents, or that overlaps the curve at the next PVI, and keeps the tangent grades
(`verticalProfile`, `engine.ts`). That PVI is then a grade break without a curve. The curve row
reads "outside a limit" and lists each dropped curve with its station, entered length and reason,
separately from breaks where no curve was entered ("to do"). K is never quoted or judged on the
entered length of a dropped curve: with a minimum K or a minimum curve length entered,
`checkVerticalDesign` raises a failed check at that station instead.

### What the list does not do

- It reads the active road only. Switch roads to review another.
- "Sized" means geometry and the drainage check's full-pipe capacity. It is not a hydraulic design
  or a fish-passage assessment. See [Drainage](drainage.md).
- Slope stability and geotechnical review are not modelled. Sight distance is checked against
  stopping sight distance and turnout intervisibility only: no passing, decision or headlight sight
  distance, and no signs. See [Sight distance](sight-distance.md).
- The constraint check samples the centreline at each station. A road that clips an area between
  two stations, or whose batter reaches into one, is not caught. The
  [final connector checks](final-connector-checks.md) test the full footprint.
- The riparian row (`streamCrossingReview.ts`) tests calculated stations against the preliminary
  horizontal screens drawn on the plan ([Streams and constraints](streams-and-constraints.md)), not
  surveyed slope-distance boundaries. A run of stations holding a crossing of that stream counts as
  the crossing; FPPR s. 50's other two reasons (higher sediment risk outside, no practicable
  option) are a person's judgement, recorded as a current conditional-use review on the stream.
  While a crossed stream's class is unresolved its screen is the 100 m allowance, so the row says
  "to do" (classify it); on a reviewed class it is outside a limit.
- The crossing row reads the road's direction at the mapped station and the nearest segment of the
  stream line. The Engineering Manual asks for right angles and gives no largest skew; 45° off
  square is the only published figure found (a Maryland highway culvert limit), so it is a screen,
  `CROSSING_SKEW_SCREEN_DEG`. The approaches run to the nearest curve, spiral, sharp corner or road
  end; straight pieces that turn less than 0.5° read as one.
- The earthwork row with haul allocation off compares total usable cut with total fill. It says
  nothing about where along the road the surplus and deficit sit; the mass-haul view does.

## Design standards

Review → **Design standards** is the project's record of what its roads are designed to. New
project asks for the same record, with starting values filled in. It is `project.standards`
(`designStandards.ts`) plus two numbers that stay in `project.settings`, where every search and
screen already reads them: the grade limit (`maxGradePercent`) and the minimum radius (`minRadius`).
`jobStandards.ts` edits the two together.

| Field                               | What reads it                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Grade limit                         | The grade flag on every station, the profile and plan colouring, route searches, the Review grade row                   |
| Short-pitch limit and longest pitch | The grade flag and the Review grade row                                                                                 |
| Loaded trucks travel, adverse limit | The grade flag and the Review grade row                                                                                 |
| Minimum radius                      | The radius flag on every station, the Review radius row, the corridor optimizer                                         |
| Design vehicle                      | The Review vehicle row runs it on a road that has no swept-path check of its own; New project puts it on the first road |
| Running surface                     | The Review template row; New project sets the first road's template to it                                               |
| Clearing limit                      | The Review clearing row                                                                                                 |
| Drain spacing                       | The Review cross-drain spacing row                                                                                      |
| Design speed                        | Printed in the report only. Section → Superelevation & widening has its own speed per road                              |
| Source                              | Printed in the report                                                                                                   |

**The grade rule.** `reviewGrades` (`designStandards.ts`) judges station grades. A run is a set of
consecutive stations steeper than the sustained limit for their direction. Without a short-pitch
allowance every run is a breach. With one ("12 %, 18 % for pitches up to 100 m"):

- a run no steeper than the short-pitch limit and no longer than the longest pitch is allowed, and
  its stations carry no flag;
- a run longer than the longest pitch is a breach along its whole length;
- a run short enough but steeper than the short-pitch limit is a breach only at the stations past
  that limit.

**How a pitch is measured.** A run's length is the sum of the intervals its stations describe
(`GradeSpan`). On a designed profile a station carries the grade of the road ahead of it, and PVIs
are stations, so a pitch from one PVI to the next measures its own length; the last station
repeats the grade behind it and adds nothing. On a ground-following road a station carries the
grade of the interval behind it, and station 0 repeats the first interval. One over-limit station
at 10 m spacing is a 10 m run, and a 50 m pitch measures 50 m at the road start, mid-road and at
the road end. On a vertical curve the grade is sampled at the stations, so a run's ends are known
to within one station spacing.

With a haul direction and an adverse limit, a grade that loaded trucks climb is held to the adverse
limit and one they descend to the grade limit. The adverse limit can only tighten the grade limit.
Empty-truck limits are not part of this record.

**A short-pitch limit relaxes a side only where it is above that side's limit.** With an 18 % grade
limit, an 8 % adverse limit and "12 % for pitches up to 100 m", a 50 m loaded-uphill pitch at 10 %
is allowed, and a loaded-downhill grade is still held to 18 %: the rule prints as "18 % favourable,
8 % adverse; 12 % for adverse pitches up to 100 m". A short-pitch limit at or below every sustained
limit permits nothing; the field says so, and the rule is applied and printed without it.

**Confirmation.** The record starts as starting values and the Review list says so until someone
presses **Confirm standards**. Confirming records the date; it does not lock the fields.

### Where the standards do not reach yet

- Route search, the corridor optimizer and the profile optimizer read the grade limit and minimum
  radius only. They do not use the short-pitch allowance or the adverse limit: a road they produce
  can be inside the standard and still be reported with fewer pitches than it could use.
  `project.routeSearch.haulGrades` and the complete-route comparison's connector checks keep their
  own directional limits.
- The plan, the 3D view and the mapped-road panel colour grades over the grade limit. A permitted
  short pitch is still coloured there, although its stations carry no flag.
- Roads added after the project is created start from the workspace's starting template, not the
  running-surface width. The Review template row raises the difference.

## The crossing register

Review → **Crossing register** lists every place water crosses the active road, once
(`crossingRegister.ts`).

- **Mapped** crossings are where the road meets a stream line in the project.
- **Modelled** crossings are where the drainage check's flow routing over the terrain enters the
  road footprint. They are listed only while the check is current.
- A mapped stream and a modelled flow line within 25 m along the road are **one crossing**, shown
  with the distance between the two stations. Pairs are made nearest first, and a flow line is
  never paired twice. Everything else is listed as mapped only or modelled only.

Each row gives the station, the structure and what stops it counting as sized, and the riparian
class of a mapped stream. A modelled-only crossing has no reach to classify.

Route comparison prices crossings from its own coarser flow model. Its stream and drain counts are
a pricing allowance and are not expected to equal the register.

## Limits and budgets

| Limit                                        | Value                                                     | Enforced by                                                             |
| -------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Terrain fine enough for site quantities      | 2 m cells                                                 | `MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M`, `connectorCheckOptions.ts`   |
| Earthwork counted as balanced                | within 2 % of the larger of usable cut and fill, or 10 m³ | `BALANCE_TOLERANCE_FRACTION`, `BALANCE_TOLERANCE_M3`, `readiness.ts`    |
| Grade break that needs a vertical curve      | 0.5 % or more                                             | `MIN_GRADE_BREAK_PERCENT`, `readiness.ts`                               |
| Mapped and modelled crossings treated as one | 25 m along the road                                       | `CROSSING_MATCH_DISTANCE_M`, `crossingRegister.ts`                      |
| Straight road each side of a crossing        | 15 m                                                      | `CROSSING_APPROACH_TANGENT_M`, `streamCrossingReview.ts`                |
| Crossing angle flagged                       | more than 45° off square (a screen, not a BC rule)        | `CROSSING_SKEW_SCREEN_DEG`, `streamCrossingReview.ts`                   |
| Culvert taken to serve a modelled crossing   | 15 m along the road                                       | `DEFAULT_CULVERT_SEARCH_M`, `hydrology.ts`                              |
| Culvert taken to serve a mapped crossing     | 1 m along the road, same stream                           | `LEGACY_CULVERT_ASSOCIATION_M`, `crossingPlan.ts`                       |
| Grade limits in the standards                | 0.1–100 %                                                 | `STANDARD_LIMITS.gradePercent`, `designStandards.ts`                    |
| Longest short pitch                          | 1–2,000 m                                                 | `STANDARD_LIMITS.shortPitchLengthM`                                     |
| Design speed                                 | 5–120 km/h                                                | `STANDARD_LIMITS.designSpeedKmh`                                        |
| Running-surface width                        | 2–30 m                                                    | `STANDARD_LIMITS.runningSurfaceWidthM`                                  |
| Clearing limit                               | 3–200 m                                                   | `STANDARD_LIMITS.clearingWidthM`                                        |
| Drain spacing                                | 5–5,000 m                                                 | `STANDARD_LIMITS.crossDrainSpacingM`                                    |
| Sight distance: target step along the road   | 4 m, then 1 m past the last target seen                   | `SIGHT_COARSE_STEP_M`, `SIGHT_TARGET_STEP_M`, `sightDistance.ts`        |
| Sight distance: eye stations                 | 10 m apart or wider, widened past 4,000,000 line samples  | `MIN_SIGHT_EYE_SPACING_M`, `MAX_SIGHT_LINE_SAMPLES`, `sightDistance.ts` |
| Turnout spacing                              | 300 m, centre to centre                                   | `TURNOUT_MAX_SPACING_M`, `turnoutSight.ts`                              |
| Turnouts needed                              | running surface under 8 m, unless Lanes is set            | `TURNOUT_SINGLE_LANE_MAX_WIDTH_M`, `turnoutSight.ts`                    |

The 2 % balance tolerance and the 25 m match distance are judgements, not standards. The first is
loose enough that rounding along a road does not raise a borrow pit, and tight enough that a few
hundred cubic metres on a kilometre of road does. The second is about the positional difference
between a 1:20,000 stream line and a flow line routed over 1 m LiDAR on a hillside.
