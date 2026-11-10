# Sight distance along the road

**Design → Sight distance** checks whether a driver can see far enough to stop. Each eye station
looks ahead and back along its lane, over the surface the road leaves, and the distance it sees is
compared with the stopping sight distance its grade needs. The same check is a row in the Review
list ("Stopping sight distance along the road"), and the profile's band row **Sight** shows it by
station once the bands are open. The curve table in the same section gives the clearing each
horizontal curve needs on its inside.

The calculation is `sightDistance.ts`. It has no DOM, terrain or network access: it reads the
calculated stations of a road, so it can be checked outside a browser.

## Before you rely on it

- **Enter a design speed.** It is taken from the road's **Curve design**, else from **Design
  standards**. Without one the Review row is not assessed.
- **Friction is a wet-pavement figure.** Left blank, braking friction comes from TAC's
  wet-pavement table for the design speed (0.40 at 30 km/h down to 0.28 at 110 km/h, taking the next
  higher tabulated speed between rows). Gravel, snow and ice can be lower. Enter your own value when
  the road's surface or season calls for it.
- **Single lane means both vehicles stop.** A road whose running surface is narrower than 6 m is
  read as single-lane unless you choose otherwise. It then needs the sum of both vehicles' stopping
  distances, each on its own grade, seen to an oncoming vehicle's height (1.30 m by default). A
  two-lane road needs one stopping distance to a 0.38 m object in the driver's own lane.
- **The surface is rebuilt from the stations.** Between two calculated stations the surface is
  joined linearly at equal offset; on the road prism it follows the design profile exactly. A
  station interval wider than about 20 m smooths ground features between stations. Use a finer
  station spacing, or terrain with fewer gaps, before relying on a short margin.
- **Missing terrain is unknown.** A sightline that crosses a sample with no elevation is unknown,
  never clear. The Review row stays not assessed while any look is unknown, unless a shortfall is
  already proven elsewhere on the road.
- **Trees are optional.** Enter **Trees beyond clearing** to stand vegetation of that height
  beyond the clearing edge (or beyond the catch point where no clearing width is calculated).
  Blank leaves vegetation out, which is optimistic on a treed hillside.
- **Distances are measured along the road.** The distance a driver sees is the difference in
  chainage between eye and target, not the straight chord between them. On a curve the chord is
  shorter than the distance travelled, and stopping distance is a travelled distance.

## How the distance needed is worked out

SSD = V·t/3.6 + V² / (254.28·(f + G)), with V the design speed (km/h), t the reaction time
(2.5 s by default), f the braking friction and G the grade as a decimal, positive uphill in the
direction of travel. G is the mean grade over the stopping distance (the grade over a first
estimate from the grade near the eye), as AASHTO recommends, rather than the grade at the eye.

A grade so steep downhill that f + G ≤ 0 gives no stopping distance; the look is then unknown.

## How the distance seen is found

- Eyes stand at calculated stations at least 10 m apart (and always the road ends), on the
  driver's path: the centreline on a single-lane road, the centre of the right lane for the
  direction of travel on a two-lane road.
- The eye is the surface at the path plus the eye height (1.05 m, or 2.33 m for a logging truck).
  Each target is the surface at the path plus the object or oncoming-vehicle height.
- Targets are tried every 4 m along the road; past the first one not seen, every 1 m from the last
  one seen. A look stops at the first target not seen, at the distance needed, or at the road end.
- A target is seen when the straight 3D line from the eye clears the surface at every 1 m sample
  between them, in plan. The surface is the designed section (formation, ditches, batters) between
  the catch points, ground beyond them, and trees beyond the clearing edge when entered.
- A look toward a road end that runs out of road before the distance needed is listed as "near a
  road end" and is not judged: the road beyond it is not modelled.

The profile alone (no plan curvature) is in `profileSightDistance`, which keeps the steepest rise
from the eye so far ("the horizon") and costs one comparison per target.

## Clearing on the inside of curves

For each horizontal curve the section lists the clearance needed from the centreline on the inside
so that the level-ground distance can be seen around it: M = R·(1 − cos(S/2R)) from the driver's
path of radius R, and M = R·(1 − cos θ) + ((S − L)/2)·sin θ with θ = L/2R when the sightline is
longer than the curve length L. It is compared with the narrowest clearing on the inside over the
curve, and shown red when short. It needs no terrain: it is a check of the clearing width, not of
what stands in it. The 3D check covers cut banks and trees.

## Limits and budgets

| Limit                            | Value                                                 | Enforced by                                                         |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Reaction time                    | 0.5–5 s                                               | `SIGHT_LIMITS.reactionTimeS`, `sightDistance.ts`; project parser    |
| Braking friction                 | 0.05–0.8, or blank for TAC's value                    | `SIGHT_LIMITS.friction`; `BRAKING_FRICTION`                         |
| Eye, object and oncoming heights | 0.3–5 m (eye), 0–5 m (others)                         | `SIGHT_LIMITS.eyeHeightM`, `objectHeightM`, `oncomingHeightM`       |
| Trees beyond the clearing        | 0–80 m, or blank                                      | `SIGHT_LIMITS.vegetationHeightM`                                    |
| Read as single-lane              | running surface under 6 m                             | `SINGLE_LANE_MAX_WIDTH_M`                                           |
| Target step                      | 4 m, then 1 m past the last target seen               | `SIGHT_COARSE_STEP_M`, `SIGHT_TARGET_STEP_M`                        |
| Samples along each sightline     | every 1 m in plan                                     | `SIGHT_LINE_SAMPLE_M`                                               |
| Eye stations                     | 10 m apart or the station spacing, whichever is wider | `MIN_SIGHT_EYE_SPACING_M`                                           |
| Work per road                    | 4,000,000 line samples; past it the eyes spread out   | `MAX_SIGHT_LINE_SAMPLES`; the spacing used is printed in the result |

The section computes only while it is open, and the band only while the bands are shown. Results
are cached per calculated road. A 5 km road with stations every 10 m takes about a tenth of a
second.

## Built-in assumptions

- Stopping sight distance only: no passing, decision, intersection or headlight sight distance.
  Sag curves at night (headlight distance) are not checked; minimum sag K in Vertical standards is
  the proxy for that.
- The driver's path is the lane centre. Drivers cutting the inside of a curve see further.
- Objects stand on the surface at the driver's path, in the same lane (or the single lane).
- Trees are a wall of one height beyond the clearing edge. Brush, snowbanks and parked equipment
  are not modelled.
- The surface between stations is linear at equal offset, and the station polyline stands in for
  the centreline between stations. With stations at most 5 m apart on curves (the engine's chord
  limit) the polyline sits within about 5 cm of the arc on a 60 m radius.
- A hidden stretch of road shorter than 4 m between two targets that are seen can be missed.

## Failure modes

- **Not assessed: no design speed.** Enter one under Curve design or Design standards.
- **Not assessed: unknown.** A sightline crosses missing terrain, usually at a terrain tile edge or
  a no-data hole. Load terrain over the whole corridor, or accept that the check cannot be made
  there.
- **Short on a curve in cut.** The cut batter or the ground above it blocks the view. Flatten the
  inside batter, widen the inside of the curve (a sight bench), increase the radius, or lower the
  design speed.
- **Short over a crest.** The vertical curve is too short for the speed. Lengthen it (raise K).
- **Short only with trees entered.** The clearing on the inside of the curve is too narrow: the
  curve table gives the clearance it needs.
- **Many looks near a road end.** The road is shorter than the distance needed. On a spur, the
  check at its ends depends on the road it joins, which is not modelled.

## Provenance

- Functional specification: RFLTools §1–§3 and §13 (clean-room stage 1, 10 November 2026). Written
  from that specification and the standards below; no code from RFLTools (GPL-3.0) was used. Unlike
  RFLTools, missing elevation is reported as unknown rather than bridged, a look that runs off the
  road end is reported rather than read as a limit, and distances are measured along the road
  rather than as the plan chord.
- Transportation Association of Canada (2017). _Geometric Design Guide for Canadian Roads_, ch. 2
  (stopping sight distance, wet-pavement friction) and ch. 3 (horizontal sightline offset).
- AASHTO (2018). _A Policy on Geometric Design of Highways and Streets_, 7th ed., §3.2 (stopping
  sight distance, truck eye height), §3.3.5 (sight distance on horizontal curves), §3.4.6 (crest
  vertical curves).
- AASHTO (2019). _Guidelines for Geometric Design of Low-Volume Roads_, 2nd ed., and BC Ministry of
  Forests (2002), _Forest Road Engineering Guidebook_, 2nd ed. (single-lane roads: both vehicles
  stop).
- Checked against the specification's worked numbers (`sightDistance.test.ts`): SSD 29.68, 62.81,
  71.14, 57.59 and 84.57 m; the crest scan at eyes 100–250 m (143.18 … 82.05 m) and its closed form
  82.06 m; S = 49.34, 56.76 and 44.39 m around curves; clearance 8.03 m at R 60 and 4.89 m at R 100
  for 62.81 m.
