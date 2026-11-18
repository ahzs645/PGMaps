# Plan edits that are refused

A plan edit has to leave a road that can be built. Dragging a horizontal point, dragging a **+**
bend handle off the road, pulling a curve's radius handle, **Shift section**, pegging legs and
typing a point's coordinates all go through one check, `planEditCheck.ts` (`checkPlanEdit`), in
every interface: Ribbon, Guided map, Workbench and Dashboard. The check has no DOM access and
carries the unit tests (`planEditCheck.test.ts`).

An edit is refused, and the road is left exactly as it was, when it would:

- **make the road cross itself.** The notice names the two legs, for example "between points 1–2
  and 3–4". A road that meets itself is two roads joined at a junction.
- **leave a corner that could not take a curve even at the project's minimum radius.** Every
  corner is checked, including one entered with no curve (radius 0, a peg): a vehicle cannot drive
  a corner, so the road will need a curve there. The corner is given the smaller of its own radius
  and the minimum, and refused when that curve needs more straight than a leg has (`tangent`), two
  curves overlap on the leg between them (`overlap`), or the road turns straight back on itself
  (`reversal`), the statuses the engine gives each corner (`horizontalCurveFits`). The notice gives
  the radius, the straight the curve needs and the straight the shorter leg has, and says when the
  point has no curve yet.
- **bring the road's running surface back onto itself.** The fitted road is sampled, with corners
  entered without a curve taking the minimum radius, and two places on it are refused when their
  centrelines are closer than the half-widths facing each other: the template widths with turnouts,
  landings and curve widening (`effectiveWidths`). The notice names the two legs, the gap and the
  width needed. Two places are compared only when the road between them is longer than half a turn
  round a circle of their combined half-widths (`π/2 × (wᵢ + wⱼ)`), so a curve is never measured
  against itself, and the two legs either side of a corner left without a curve are not compared
  (that fold is the corner, which the curve rule judges).
- **take the road into an area marked Excluded.** An avoid polygon whose treatment is **Excluded**,
  explicitly or by the legacy no-price convention (`resolveConstraint`), refuses an edit that puts
  more of the fitted centreline inside it. The notice names the area and the nearest point.

While a drag is in progress the same check runs on the preview: the road turns rose, a ring marks
the crossing, corner, overlap or area entry, and a **Not allowed** label follows the handle. Letting
go there leaves the handle where the road still has it.

## What is not refused

- **What the road already had.** Only an edit that makes things worse is refused. A crossing, a
  corner that could not be rounded, an overlap or a stretch inside an excluded area that was there
  before never blocks another edit, so an imported line or an old project can still be repaired
  point by point. Crossings are counted, so a bend added on a leg that already crosses renames the
  crossing without being refused. Overlap and excluded length are compared with a tolerance of two
  samples, because chainages shift slightly whenever any point moves.
- **A corner whose entered radius no longer fits when the minimum radius would.** The edit is kept
  and the point's own note gives the largest radius that fits, as before.
- **Sharp corners that a minimum-radius curve could round.** A peg with radius 0 on legs long
  enough for the curve is allowed; the Review list flags sharp PIs until they are given curves.
- **Hairpins.** A turn tighter than a curve allows is designed with **Design → Add a switchback**
  ([Switchback alternatives](switchbacks.md)), not by winding points round one another. The
  refusal notice says so for turns over 90° and for surface overlaps between nearby legs.
- **Conditional, priced and riparian areas.** FPPR s. 50 lets a road into a riparian management
  area in three stated cases, and a conditional or priced area is a planning decision, so they stay
  with the route searches and the Review list: **Excluded and conditional areas kept clear** and
  **Road kept out of riparian areas except at crossings** ([Review](review-and-standards.md)).

Deleting a point and route searches are not checked here: a search's own rules already keep its
roads open and fitted.

## Bending a leg into an arc

A **+** dragged off a leg adds one point with a circular curve, and the road is drawn through the
handle as it moves (`bendThrough`, `bendArc.ts`). The new point is not put under the handle: it
goes beyond it, on the corner's bisector, by the curve's external distance E = R (sec(Δ/2) − 1),
so the middle of the fitted arc is where the handle is. Its numbered handle shows there during the
drag.

The radius is the one whose tangent takes half of the straight the two new legs have left, once
the curves at the neighbouring points have taken theirs at their new deflections. A small pull
therefore opens a long flat arc, and a longer one tightens it, down to the minimum radius and no
further. The other half of each leg stays straight, so the point can be moved afterwards, and the
legs either side bent again, before its curve stops fitting. The radius is kept to 0.1 m, rounded
down. The header notice gives it when the bend is added.

Where no curve through the place fits (the turn is too tight for the minimum radius on the legs
it has, or the place is on the leg itself, as with Enter on a focused **+**), the point is added
at the place with the minimum radius, as a bend always was, and the check above judges it. The
preview and the drop read the same function, so the road that was drawn is the road that is added.

### Pulling a curve's radius

The selected point shows a round violet handle a little inside its curve. Dragging it toward the
inside of the curve widens the curve, and toward the point tightens it: the radius becomes the one
whose arc passes through the handle's place on the bisector, R = E ÷ (sec(Δ/2) − 1)
(`curveThrough`). Neither the point nor its neighbours move. The radius stops at the minimum
radius and at the largest the legs carry as the neighbouring curves stand, and the notice says
which when it stops. A corner left sharp because its entered radius does not fit takes the handle
at the point itself, and pulling it gives a radius that does fit. The change goes through the
same check as a moved point, because a wider curve moves the road. A curve with spirals keeps its
typed radius and has no handle; the radius field in **Horizontal points** is the keyboard route.

Dragging a numbered point never changes a radius. The curve keeps the radius it has and follows
the point; when it no longer fits, the corner is left sharp with its note, as before
([What is not refused](#what-is-not-refused)).

### What other tools do

- Autodesk Civil 3D gives an alignment a grip at each intersection point, which moves where two
  tangents meet; a triangular grip that changes only a curve's radius; and a circular pass-through
  grip that moves the place a curve passes through and its radius with it. The curve handle here is
  the pass-through grip, and a bend is a new intersection point placed from one.
- Bentley OpenRoads draws a radius manipulator on each curve of an alignment built by PI, dragged
  or typed, beside the handle at the PI.
- Softree RoadEng edits the radius in its Horizontal Curves panel and does not apply a curve that
  will not fit its tangents. A point drag here leaves an entered radius alone for the same reason.

## Assumptions

- Crossings are read on the control line, the straight legs between points, not on the fitted
  curves. Each curve stays inside the triangle of its own corner, so the fitted road can differ
  only where another leg passes inside that triangle.
- The minimum radius is `settings.minRadius`, the same value a new bend point is given. With it at
  0 there are no curves to fit: only crossings, surface overlaps away from corners, and excluded
  areas are refused.
- The surface rule reads the running surface only. Ditches, cut and fill slopes and clearing width
  depend on the terrain and are left out, so two legs that pass it can still share a slope. No BC
  standard gives a minimum distance between legs of one road (Engineering Manual, Forest Road
  Engineering Guidebook, USFS and NZ guides checked 11 November 2026): the surface rule is the
  geometric floor, and a switchback's legs are 2R apart, at least 30 m at the manual's 15 m
  switchback radius.
- Excluded areas are tested on samples of the fitted centreline; a sliver narrower than a sample
  step can be missed. The Review list tests the calculated stations.

## Sources

- BC Ministry of Forests, _Engineering Manual_ (25 May 2026), §3.5.2, Table 3-5 (minimum radius by
  design speed: 15 m at 20 km/h to 250 m at 80 km/h, "suggested alignment controls"), Table 3-6
  (curve widening for turns of 20°–180°, which assumes every corner carries a curve) and §3.5.3.1
  (switchback radius typically 15–25 m on lower-speed roads).
- Softree RoadEng 11 help, _Horizontal Curves Panel_: a curve that does not fit its tangents is not
  applied, and adjacent curves may not overlap. This check applies the same rule to every corner.
- Autodesk, _Civil 3D User Guide_, "About Editing Alignments Using Grips" and tutorial "Grip
  Editing an Alignment" (read 17 November 2026): the intersection-point, radius and pass-through
  grips. Bentley, _OpenRoads Designer Help_, "Complex by PI": radius manipulators on each curve.
- FPPR s. 50(1): road construction in a riparian management area only in the stated cases.

## Limits and budgets

| Limit                                    | Value                  | Enforced in                                                         | When exceeded                                                          |
| ---------------------------------------- | ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Straight left on a leg for a bend handle | 1 × the minimum radius | `PlanView.tsx` `MIN_BEND_ROOM_RADII`                                | No **+** handle on that leg                                            |
| Bend handle spacing on screen            | 48 px                  | `PlanView.tsx` `MIN_BEND_SEGMENT_PX`                                | No **+** handle until you zoom in                                      |
| Drag before a bend is added              | 10 px                  | `PlanView.tsx` `MIN_BEND_DRAG_PX`                                   | Nothing added; the hint says to drag                                   |
| A new bend's tangent                     | 0.5 of the free leg    | `bendArc.ts` `BEND_TANGENT_SHARE`                                   | Never more: the rest of each leg stays straight                        |
| Bend offset that takes a fitted arc      | 0.05 m off the leg     | `bendArc.ts` `MIN_BEND_OFFSET_M`                                    | Nearer, the point is added on the leg at the minimum radius            |
| Arc to the dragged place                 | 0.05 m                 | `bendArc.ts` `BEND_THROUGH_TOLERANCE_M`                             | Farther, the point is added at the place at the minimum radius         |
| Radius set from the plan                 | 0.1 m steps            | `bendArc.ts` `BEND_RADIUS_STEP_M`                                   | Rounded down, so the curve still fits                                  |
| Curve handle inside its arc              | 26 px                  | `PlanView.tsx` `CURVE_HANDLE_OFFSET_PX`                             | Drawn clear of the point's numbered handle                             |
| Sample step on the fitted road           | 1–5 m                  | `planEditCheck.ts` `MIN_PLAN_CHECK_STEP_M`, `MAX_PLAN_CHECK_STEP_M` | Never finer than 1 m or coarser than 5 m                               |
| Samples on the fitted road               | 6,000                  | `planEditCheck.ts` `MAX_PLAN_CHECK_SAMPLES`                         | Past 6 km the step grows; past 30 km it stays 5 m and the samples grow |
