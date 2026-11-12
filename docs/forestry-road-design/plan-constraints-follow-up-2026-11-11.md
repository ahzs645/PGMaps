# Road constraints on the plan — follow-up, 11 November 2026

A DevTools trace of pegging on the Prince George LiDAR example (BC 093G086) started this work. The
plan edit check let a knot of radius-0 corners through, turning 162° and 127° on 20–25 m legs, and
each click took about 150 ms. This page records what was changed, what the research found, and what
is still open, in rough order of value.

## Done (PR #122)

| Change                                                                                                      | Where                                                                | Guide                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| Every corner, pegs included, must take a curve at `settings.minRadius`, or the edit is refused              | `planEditCheck.ts`                                                   | [Plan edits that are refused](plan-edit-limits.md) |
| A road whose running surface comes back onto itself is refused                                              | `planEditCheck.ts` (`surfaceOverlap`)                                | same                                               |
| A road taken into an avoid area marked Excluded is refused                                                  | `planEditCheck.ts` (`excludedAreas`)                                 | same                                               |
| Review: stream crossings square, with 15 m straight approaches                                              | `streamCrossingReview.ts`, `readiness.ts` (`crossing-approach`)      | [Review](review-and-standards.md)                  |
| Review: road kept out of riparian areas except at crossings (FPPR s. 50)                                    | `streamCrossingReview.ts`, `readiness.ts` (`riparian-areas`)         | same                                               |
| The folded switchback panel no longer rebuilds its sketch and swept path on every edit (~140 ms per click)  | `SwitchbackTools.tsx`                                                | —                                                  |
| E2E: the crossing-refusal test reads the handle against point 1; the switchback spec reads the road summary | `forestry-road-editing.spec.ts`, `forestry-road-switchbacks.spec.ts` | —                                                  |

## What the research found

Sources read 11 November 2026: BC _Engineering Manual_ (25 May 2026), _Forest Road Engineering
Guidebook_ (2002), _Fish-stream Crossing Guidebook_ (2012), FPPR, USFS and BLM low-volume road
guides, the NZ Forest Road Engineering Manual and Softree's RoadEng 11 help.

- **Minimum radius** by design speed: Table 3-5, 15 m at 20 km/h to 250 m at 80 km/h ("suggested
  alignment controls for average conditions"). Switchbacks typically 15–25 m (§3.5.3.1).
- **No largest turn without a curve** is published. Table 3-6 widens curves for turns of 20°–180°,
  which assumes every corner carries one.
- **No minimum distance between legs** of one road is published anywhere read. A true switchback's
  legs are 2R apart: 30 m at R 15 m.
- **No minimum tangent between reverse curves.** §3.5.3.1 asks for a short tangent on at least 2 %
  grade for drainage. A reverse crown needs 20 m of superelevation development (§3.5.2.5.1). Avoid
  broken-back curves; compound radii within 25 % of each other.
- **Crossings at right angles** with at least 15 m of straight approach (§2.3.3.1). No skew limit is
  published in BC; the 45° screen comes from Maryland SHA's culvert guidance.
- **Riparian management areas** (FPPR s. 50(1)): road only as part of a crossing, where locating
  outside raises sediment risk, or where there is no practicable option. Widths are slope distance
  (s. 47(4)).
- **Junctions** (§3.5.2.7): within 20° of a right angle, at least 5 m of tangent from the existing
  road edge, returns of at least 20 m radius, 100–150 m sight distance.
- **RoadEng** refuses a curve that does not fit its tangents and will not let adjacent curves
  overlap. Its documentation shows no warning for a PI with no curve.

## Open, in rough order of value

1. **Live refusal while pegging.** The Peg tool checks its legs only at **Finish**, so a whole run
   of pegs is refused at once. Run `checkPlanEdit` on the pending pegs as each one is placed, and
   show the same rose ring and **Not allowed** label the drag preview uses.
2. **Minimum radius from design speed.** When `curveDesign.designSpeedKmh` is set, offer Table 3-5's
   radius as `settings.minRadius`, and say when the entered minimum is below it. Keep the class-to-speed
   choice a person's, as the search presets do.
3. **Legs that share a slope.** The surface rule is the floor. Add a Review row comparing non-adjacent
   stations' catch points (`section`, calculated) so a lower leg's cut that reaches an upper leg's
   fill is raised, and quote the 2R switchback separation beside it. It needs terrain, so it belongs
   in Review rather than the drag check.
4. **Roads in one project meeting each other.** `checkPlanEdit` reads one road. A drag that makes one
   road cross another, or meet it outside §3.5.2.7's 20° and 5 m, is not refused or reviewed. Add a
   Review row on project junctions first; refuse only an unintended crossing.
5. **Riparian evidence by exception.** The riparian row accepts any current conditional-use review.
   Record which FPPR s. 50 reason applies (crossing, sediment risk, no practicable option) on the
   review, print it in the report, and test the road's footprint (clearing width) rather than its
   centreline. Note in the row that FPPR widths are slope distance and the screen is horizontal.
6. **A BC skew figure.** Replace the 45° screen if a BC or fish-passage source gives one, or move it
   into `project.standards` so a job can set it. Also check §2.3.3.1's "gentle curves at each end".
7. **Reverse and broken-back curves.** Review rows for compound radii more than 25 % apart, a
   broken-back curve, and a reverse curve with less than 20 m between (superelevation development).
   These are guidance, so "to do", never refused.
8. **Excluded slivers.** The plan check samples the fitted centreline every 1–5 m and can miss a
   sliver narrower than a step. Intersect the fitted centreline with each area boundary instead, as
   `constraintRouteIssues` does for searches.
9. **Soft warnings in the drag preview.** Conditional and riparian areas are never refused. The drag
   preview could still colour them amber with the area's name, so the designer sees it before Review.
10. **Switchback panel while open.** It still spends about 25 ms per edit simulating the whole road.
    Simulate from a few vehicle lengths before the turn and prove in a test that every reported
    figure matches the whole-road run, or move the run to a worker. `forestry-road-switchbacks.spec.ts`
    pins the numbers.
11. **Per-click cost elsewhere.** With the switchback panel folded, the trace's remaining main-thread
    time per click is the road analysis (`analyzeRoad`, ~4 % of samples) and the charts. Profile again
    after item 1 lands.

## How to check this work again

- Unit: `npx vitest run src/pages/dev-forestry-roads/planEditCheck src/pages/dev-forestry-roads/readiness src/pages/dev-forestry-roads/SwitchbackTools`.
  `planEditCheck.test.ts` replays the knot from the trace.
- E2E: `forestry-road-editing.spec.ts` (Excluded patch, pegged corners too close, crossing refusal)
  and `forestry-road-switchbacks.spec.ts`.
