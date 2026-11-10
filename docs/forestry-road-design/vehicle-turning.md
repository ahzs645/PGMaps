# Vehicle turning: steering lock, log loads and junction turns

The **Swept path** view (see [Switchbacks → Design vehicle swept path](switchbacks.md#design-vehicle-swept-path))
tracks a design vehicle through the road's own curves. This guide covers three additions to it:

- a **steering lock** check, which flags a turn the truck cannot steer even where the formation is
  wide enough;
- **loads that span two units**, such as logs lying on a jeep bunk and a pole-trailer bunk, and
  **BC MoTI logging-truck dimension sets** to start from;
- **Junction turns**: the swept path of the truck turning from one road into another and back out,
  at every junction of the active road.

The calculation is in `vehicleKinematics.ts` (shared tracking), `sweptPath.ts` (the road check) and
`junctionTurn.ts` (junctions). All three are free of DOM and network access.

## Before you rely on it

- **Enter your own truck.** A preset is a named set of dimensions with a stated source, not a
  design vehicle approved for your road. The BC MoTI presets are transcribed from the figures in
  the source below, and their source text names every value the figure does not give. Replace
  wheelbases, bunk positions, log lengths and the steering lock with the fleet's before relying on
  a result. Editing a preset renames it "(edited)".
- **Enter a steering lock.** Without one the lock is not checked: each turn shows its steering
  angle against "not entered", and nothing is flagged. The lock is the largest angle of the first unit's steer axle. Truck
  specifications often quote the turning radius instead; use the turning calculator to convert it.
- **Junction widths.** A design road's junction arms use its own formation widths at the junction
  station. A mapped road (a context line) has no known width, so the entered **Mapped road
  half-width** is used each side and the junction says so.
- **Junction geometry is local.** Each road is taken as straight near the junction, along its
  direction 15 m out. A road that curves within a vehicle length of the junction is not modelled as
  curving.
- **Haul direction.** No haul destination is entered, so turns in both directions are listed. Loaded
  trucks usually come out of the branch toward the mill: read the **Out** rows for the loaded
  movement and the **In** rows for the empty return.
- **Compare cut-backs, not flare radii.** In an obtuse corner a large flare radius adds little
  formation, so a mild 45° turn can need a larger radius than a 135° one. The cut-back (how far the
  flare's arc sits from the corner of the two edges) is the figure that grows with the turn.

## Steering lock

At a fixed steering angle δ, a single unit of wheelbase L turns about a centre on the line of its
rear axle (single-track model, no tyre slip). With the rear axle-group centre on radius
D = L / tan δ:

| Quantity          | Formula            |
| ----------------- | ------------------ |
| Steer-axle radius | √(D² + L²)         |
| Inner rear wheel  | D − W/2            |
| Inner front wheel | √((D − W/2)² + L²) |
| Outer front wheel | √((D + W/2)² + L²) |

W is the out-to-out width. `steeringGeometry` solves all of them from any one: the lock, the
steer-axle radius, the inner rear wheel radius or the outer front wheel radius. The **Turning
calculator** under **Steering** in the vehicle details uses it: edit any radius and the lock
updates. For a 5.9 m wheelbase at a 32.983° lock it gives a 10.838 m steer-axle radius and an
11.949 m outer front wheel, which the unit tests pin.

The road check measures the steering angle at every step as the angle between the first unit's
axis and the steer path's tangent, which is exactly the steering angle the single-track model needs
there. A turn is **beyond the lock** when the largest angle exceeds the lock by more than
`STEERING_LOCK_TOLERANCE_DEG`. This is the angle the path really demands, not the steady-state
`asin(L/R)`: a short curve tighter than the steady minimum radius can stay within the lock because
the truck never settles on it, and a long one approaches the steady value. On an R8 curve of 160°,
a 5.9 m wheelbase reaches 45.4° (steady 47.5°), well past a 33° lock, while the wheels fit a
12 m formation. On R15 it needs 23.2°.

A turn beyond the lock is shown in red ("Beyond steering lock") whether or not the wheels fit; the
**Widen** figure still states only the wheel deficit. The Review row "Design vehicle stays on the
running surface" needs attention when any turn is beyond the lock. **Find smallest radius that
fits** in the switchback tool only accepts radii within the lock.

## Loads on two units

A load lies on the straight line between a bunk on one unit and a bunk on a later unit, and extends
ahead of the front bunk and behind the rear bunk by the entered overhangs. It is drawn and measured
like a unit body, so it widens the body envelope, which is reported but not required to fit (it may
pass over a fill shoulder but strike a cut batter or a tree). It does not steer the units: the
trailer's own wheelbase from its hitch does that. A telescoping reach or pole is modelled at its
entered length, so the distance between the bunks changes slightly through a turn. With the bunks
placed on the truck's hitch and the trailer axle, the load reproduces the older "logs as a unit"
model within 0.05 m; the unit tests check this.

## BC MoTI dimension sets

Source: BC Ministry of Transportation and Infrastructure, _Supplement to TAC Geometric Design
Guide_, 2019 edition, Section 720 Design Vehicles (April 2019), Figures 720.A and 720.B
(pages 720-4 and 720-5) and Table 720.A. The chapter PDF downloaded on 10 November 2026 had SHA-256
`137c2cc658b8d465116d2ab2fab31bbda719096443cda35da213c421409ad154`. The supplement uses LG3 for
load sweep and LG5 for offtracking, as an envelope for long-load logging trucks on highway
intersections.

| Preset                        | Units (wheelbase, overhangs, hitch)                                                                                    | Load                                                  | Lock   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| LG5 truck, jeep, pole trailer | Truck 5.90 m; jeep 6.59 m, kingpin 0.32 m ahead of the truck tandem; pole trailer 5.95 m, 1.60 m behind the jeep axles | Bunks 10.80 m apart; logs 4.20 m ahead, 1.80 m behind | 28.31° |
| LG3 truck, tri-axle trailer   | Truck 6.80 m, hitch 2.76 m behind its tandem; reach 3.99 m; trailer 4.65 m                                             | Bunks 10.35 m apart; logs 2.50 m ahead, 3.85 m behind | 32.98° |
| WB-15 (BC)                    | Tractor 5.50 m; semitrailer 11.00 m                                                                                    | none                                                  | 26.06° |

All widths are 2.60 m. The figure's "pin offset" is positive ahead of the axles; PGMaps' hitch
offset is positive behind them, so the signs are flipped.

**Values the figures do not give, marked "confirm" in each preset's source:**

- **Bunk positions.** The figures give the distance between bunks but not where they sit. LG5's
  rear bunk is taken over the pole-trailer axle and its front bunk 3.34 m behind the jeep kingpin;
  LG3's front bunk over the truck's drive-axle centre and its rear bunk 1.05 m ahead of the trailer
  axles. Both put the bunks the figure's distance apart when travelling straight, and agree with the
  figures' drawings to within about 0.4 m.
- **Steering lock.** The figures give none. Each lock is the angle that reproduces Table 720.A's
  minimum outside-front-wheel radius at 0–15 km/h (13.6 m for the LLT vehicle, 13.7 m for WB-15
  (BC)), with the 2.60 m width as the wheel track. That gives 32.98° for LG3 and 26.06° for WB-15,
  and 28.31° for LG5, whose shorter wheelbase reaches the same 13.6 m radius at a smaller lock. A
  fleet truck may steer tighter or wider.

## Junction turns

**Junction turns** (a fold at the end of the Swept path view) lists every junction of the active
road with every turn through it.

**Finding junctions.** A junction is where one of the active road's ends lies within
`JUNCTION_SNAP_M` of another road in the project (another design road or a mapped road), or another
road's end lies within that distance of the active road. The road that ends there is the
**branch**. Roads that cross with no end at the crossing are not junctions here. Two design roads
that both start within `JUNCTION_SNAP_M` of the same point are read as alternatives drawn from one
start, such as a route comparison or a contour variant, and the panel counts them instead of listing
a turn between them; a mapped road meeting that start is still a junction. Each road leaving
the junction point is an **arm**, with its direction taken over `JUNCTION_TANGENT_REACH_M` and its
own left and right formation half-widths; a road passing through the junction has two arms.

**Turns.** For each junction there is a turn from each arm of the through road into the branch
(**In**) and from the branch into each of them (**Out**), left or right. Each row gives the change
of heading and how sharp it is (under 45° mild, under 90° moderate, under 135° sharp, otherwise
hairpin), offtracking, the largest steering angle, how far the wheels are off the formation, how far
the body or load passes beyond it, and the corner flare that would make the wheels fit.

**Steer path.** The steer-axle centre comes in along one arm's centreline, follows a circular arc
of the **Turn radius** tangent to both centrelines (tangent length R·tan(Δ/2) on each arm, for a
change of heading Δ), and leaves along the other's centreline, with a straight run of twice the
vehicle length (at least 30 m) either side. The turn radius starts at the vehicle's steady minimum
at its lock, rounded up to 0.5 m, or 15 m without a lock. The axle groups trail by the exact
no-slip step for a pivot moving along a straight step, tan(θ'/2) = tan(θ/2)·e^(−s/L) (the closed
form of the tractrix), at `JUNCTION_STEP_M` steps. For a 10 m unit through a 90° turn of radius 12 m
this gives 3.475 m offtracking, which an independent fine-step integration of the trailing equation
reproduces; the unit tests pin it.

**Formation.** The union of every arm's strip (from the junction outward), a disc of the narrowest
half-width at the junction point, and a circular **flare** of the entered radius in every corner
between neighbouring arms whose angle is between `MIN_FLARED_CORNER_DEG` and
`MAX_FLARED_CORNER_DEG`. The wheels fit when every wheel point is inside the formation less the
clearance: every edge moved in by the clearance and every flare radius grown by it, so a sharp
corner is rounded by the clearance.

**Required flare.** The smallest flare radius, in `FLARE_SEARCH_STEP_M` steps up to the flare
limit, at which the wheels fit; a larger flare only adds formation, so a bisection finds it. The
same radius is applied to every corner. "Cut back" is how far that flare's arc sits from the corner
of the two formation edges, R·(1/sin(α/2) − 1) for an inside corner of α. When no flare up to the
limit fits, the row gives how far off the wheels are: a flare does not widen the edge they leave.

**On the plan,** while the fold is open, the selected turn (at first the worst) is drawn with the
road's swept-path colours: the wheel envelope in orange, the body and load envelope dashed purple,
and wheel points beyond the formation less the clearance in red.

**Worked figures** (6 m formations both roads, 0.3 m clearance, steer radius at the lock's minimum
rounded up, no flare). For the 45° and 135° rows the branch leaves the through road at 45°: out of
it, one direction is a 45° bend and the other a 135° turn back round the acute corner. The 90° row
is a branch at right angles. In and out turns through the same corner give the same figures here,
because the arms have equal widths:

| Vehicle    | Turn | Offtracking | Wheels off | Flare R needed | Cut back |
| ---------- | ---- | ----------- | ---------- | -------------- | -------- |
| LG5, R12.5 | 45°  | 2.46 m      | 1.69 m     | 24 m           | 2.0 m    |
| LG5, R12.5 | 90°  | 3.90 m      | 4.52 m     | 18 m           | 7.5 m    |
| LG5, R12.5 | 135° | 4.74 m      | 7.22 m     | 13.5 m         | 21.8 m   |
| WB-15, R13 | 45°  | 2.87 m      | 2.08 m     | 32 m           | 2.6 m    |
| WB-15, R13 | 135° | 5.90 m      | 7.86 m     | 16 m           | 25.8 m   |

This is the field rule in numbers: the loaded truck turning out toward the mill should make the
mild turn. A branch that leaves at 45° toward the mill needs about 2 m of corner fill; the same
branch pointing away from the mill needs over 20 m.

## Limits and budgets

| Limit                                    | Value                    | Enforced by                                                        |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| Steering lock                            | 5–60°, optional          | `sweptPath.ts` `VEHICLE_LIMITS.steeringLockDeg`; project parser    |
| Lock tolerance                           | 0.1°                     | `vehicleKinematics.ts` `STEERING_LOCK_TOLERANCE_DEG`               |
| Loads per vehicle                        | At most 2                | `sweptPath.ts` `VEHICLE_LIMITS.loads`; project parser              |
| Load bunk position behind its pivot      | −15 to 30 m              | `sweptPath.ts` `VEHICLE_LIMITS.loadBunkM`; project parser          |
| Load overhang ahead / behind the bunks   | 0–20 m                   | `sweptPath.ts` `VEHICLE_LIMITS.loadOverhangM`; project parser      |
| Junction turn radius                     | 3–200 m                  | `junctionTurn.ts` `JUNCTION_LIMITS.steerRadiusM`                   |
| Corner flare radius                      | 0–100 m                  | `junctionTurn.ts` `JUNCTION_LIMITS.flareRadiusM`                   |
| Road half-width at a junction            | 0.5–30 m (clamped)       | `junctionTurn.ts` `JUNCTION_LIMITS.halfWidthM`                     |
| Straight run either side of the turn     | 5–300 m                  | `junctionTurn.ts` `JUNCTION_LIMITS.leadM`                          |
| Steer-path step                          | 0.25 m                   | `junctionTurn.ts` `JUNCTION_STEP_M`                                |
| Road end counted as meeting another road | Within 5 m               | `junctionTurn.ts` `JUNCTION_SNAP_M`                                |
| Arm direction taken over                 | 15 m from the junction   | `junctionTurn.ts` `JUNCTION_TANGENT_REACH_M`                       |
| Junctions listed per road                | 12; the rest are counted | `junctionTurn.ts` `MAX_JUNCTIONS`                                  |
| Corners that get a flare                 | 5–170° between arms      | `junctionTurn.ts` `MIN_FLARED_CORNER_DEG`, `MAX_FLARED_CORNER_DEG` |
| Flare search step                        | 0.5 m                    | `junctionTurn.ts` `FLARE_SEARCH_STEP_M`                            |
| Sharpest turn modelled                   | 175° change of heading   | `junctionTurn.ts` `MAX_TURN_DEG`                                   |

The junction inputs (turn radius, flare radius, mapped-road width) are view settings and are not
saved with the project. The steering lock and loads are saved on the road's vehicle check; files
saved before they existed open without them.

## Built-in assumptions

- **Kinematic, low speed.** No tyre slip, tandem scrub, suspension or load compliance, speed,
  superelevation, grade, traction or braking.
- **Centreline steering.** The steer axle follows the road's centreline (the road check) or the
  centreline arc (junctions), as on a single-lane road. On a wider road a driver swings out first
  and uses the whole width, so the junction result is conservative there.
- **No reversing.** A turn sharper than 175° is reported as needing reversing, not tracked; three-point
  turns are not modelled.
- **Loads ride the bunks.** A load swings with the line between its bunks. Log flex, droop and
  movement on the bunks are not modelled.
- **Telescoping reaches** are held at their entered length.
- **The road check keeps its follow-the-leader step** (each axle pulled toward its new pivot), which
  its published results were measured with and which runs about 0.05 m conservative at 0.25 m steps.
  The junction check uses the exact step.

## Failure modes

- **"Not enough road for an R… turn".** The arc's tangent is longer than the road on one side of the
  junction (an acute junction, or a short spur). Lower the turn radius if the truck can steer it, or
  lengthen the road.
- **"…needs reversing".** The two arms point almost the same way. The truck cannot make it forward.
- **No junction found.** The roads do not end within 5 m of each other, or the road it joins is not
  loaded. Draw or load it.
- **A turn beyond the lock with wheels that fit.** The formation is wide enough but the truck cannot
  steer that tight: a larger radius is needed, not more width.
- **A mapped road's width is assumed.** Its junction rows depend on the entered half-width.
- **A curving road near the junction** is read as straight along its first 15 m; check the turn on
  the plan.
- **Wheels off with no flare that fixes it.** The wheels leave an outside edge or a road's far edge;
  widen that road or change the turn radius.

## Verification

`vehicleKinematics.test.ts` pins the steering geometry for both reference trucks, the BC MoTI
presets' reproduction of the Table 720.A radii and their bunk spacing, the exact step's offtracking
against an independent fine-step integration (R30, L12.5, 180°: 2.723 m; R12, L10, 90°: 3.475 m),
the lock check on R8 and R15 curves, the switchback radius search under a lock, the two-unit load
against the load-as-a-unit model, and saving and reopening a vehicle with a lock and loads.
`junctionTurn.test.ts` covers the 3.475 m junction offtracking, the lock flag, the flare search and
its cut-back, mirror-image turns, the skewed junction, the tangent-room and reversing messages, and
finding junctions between design roads and with a mapped road. `JunctionTurnPanel.test.tsx` checks
the listing and that the plan overlay is drawn only while the fold is open and cleared on unmount.
