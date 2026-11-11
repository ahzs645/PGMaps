# Plan edits that are refused

A plan edit has to leave a road that can be built. Dragging a horizontal point, dragging a **+**
bend handle off the road, **Shift section**, pegging legs and typing a point's coordinates all go
through one check, `planEditCheck.ts` (`checkPlanEdit`), in every interface: Ribbon, Guided map,
Workbench and Dashboard. The check has no DOM access and carries the unit tests
(`planEditCheck.test.ts`).

An edit is refused, and the road is left exactly as it was, when it would:

- **make the road cross itself.** The notice names the two legs, for example "between points 1–2
  and 3–4". A road that meets itself is two roads joined at a junction.
- **leave a corner whose curve cannot fit even at the project's minimum radius.** That is a curve
  that needs more straight than a leg has (`tangent`), two curves that overlap on the leg between
  them (`overlap`), or a road that turns straight back on itself (`reversal`), the statuses the
  engine already gives each corner (`horizontalCurveFits`). The notice gives the radius, the
  straight the curve needs and the straight the shorter leg has.

While a drag is in progress the same check runs on the preview: the road turns rose, a ring marks
the crossing or corner, and a **Not allowed** label follows the handle. Letting go there leaves the
handle where the road still has it.

## What is not refused

- **What the road already had.** Only an edit that makes things worse is refused. A crossing or an
  unfitted corner that was there before never blocks another edit, so an imported line or an old
  project can still be repaired point by point. Crossings are counted, so a bend added on a leg
  that already crosses renames the crossing without being refused.
- **A corner whose entered radius no longer fits when the minimum radius would.** The edit is kept
  and the point's own note gives the largest radius that fits, as before.
- **Sharp corners.** A point with radius 0 (a peg) has no curve to fit. The Review list flags sharp
  PIs until they are given curves.
- **Hairpins.** A turn tighter than a curve allows is designed with **Design → Add a switchback**
  ([Switchback alternatives](switchbacks.md)), not by winding points round one another. The
  refusal notice says so for turns over 90°.

Deleting a point and route searches are not checked here: a search's own rules already keep its
roads open and fitted.

## Assumptions

- Crossings are read on the control line, the straight legs between points, not on the fitted
  curves. Each curve stays inside the triangle of its own corner, so the fitted road can differ
  only where another leg passes inside that triangle.
- The minimum radius is `settings.minRadius`, the same value a new bend point is given. With it at
  0 there are no curves to fit and only crossings are refused.

## Limits and budgets

| Limit                                    | Value                  | Enforced in                          | When exceeded                        |
| ---------------------------------------- | ---------------------- | ------------------------------------ | ------------------------------------ |
| Straight left on a leg for a bend handle | 1 × the minimum radius | `PlanView.tsx` `MIN_BEND_ROOM_RADII` | No **+** handle on that leg          |
| Bend handle spacing on screen            | 48 px                  | `PlanView.tsx` `MIN_BEND_SEGMENT_PX` | No **+** handle until you zoom in    |
| Drag before a bend is added              | 10 px                  | `PlanView.tsx` `MIN_BEND_DRAG_PX`    | Nothing added; the hint says to drag |
