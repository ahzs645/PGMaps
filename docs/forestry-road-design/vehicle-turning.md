# Vehicle turning: steering lock, log loads, junction turns, drawn paths and turnarounds

The **Swept path** view (see [Switchbacks → Design vehicle swept path](switchbacks.md#design-vehicle-swept-path))
tracks a design vehicle through the road's own curves. This guide covers the additions to it:

- a **steering lock** check, which flags a turn the truck cannot steer even where the formation is
  wide enough;
- **loads that span two units**, such as logs lying on a jeep bunk and a pole-trailer bunk, and
  **BC MoTI logging-truck dimension sets** to start from;
- **Junction turns**: the swept path of the truck turning from one road into another and back out,
  at every junction of the active road;
- **the vehicle at a station** of the road, stepped a metre at a time and pinned, and **traces** of
  any point on it (a mirror, a corner, a log tip) along the road;
- **Drive a path**: the truck driven along any line drawn or imported on the plan, or along a
  junction turn, with a closed swept-area polygon, its area, the wheels' swept area, the steering
  the path demands with its side, and how much falls outside a landing or the road formations;
- the **steady-state turning template** and the **loop turnaround check** on a drawn landing,
  a pin or a screened landing candidate;
- **up to six units**, **rigid loads** that keep their length across the bunks, and **project
  vehicles**: a fleet saved in the project file and moved between projects as a vehicle file.

The calculation is in `vehicleKinematics.ts` (shared tracking, steady-state radii, outlines),
`sweptPath.ts` (the road check), `junctionTurn.ts` (junctions), `vehicleOnRoad.ts` (the vehicle
at a station and road traces), `vehiclePath.ts` (driving a path), `turningTemplate.ts` (the
template and turnaround fit), `vehicleLibrary.ts` (vehicle files and the project library) and
`vehicleTools.ts` (picking plan features, formation footprints, plan and export features). All
are free of DOM and network access.

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
- **A drawn path is the steer axle's path,** not the road edge: draw where the driver puts the
  front axle. Its corners are rounded by the fillet radius; a corner the fillet does not fit is
  refused rather than driven with a kink.
- **The template is steady state.** It shows the vehicle after it has settled on the circle. The
  entry into the loop and the way out are not in it: drive a path through the landing for those.
- **A loop turnaround that fits** means the largest circle the area holds is at least the outer
  body radius plus the wheel clearance. It does not check stumps, decks or ground in the middle,
  nor a wye or a backing manoeuvre, which are not modelled.
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

## Vehicle at a station and point traces

**Vehicle at a station** (a fold under the junction turns) draws every unit, load and axle of the
design vehicle with its steer axle exactly at the entered station, having driven from the road's
start (up-station) or end (down-station) as the road check does, by the same follow-the-leader
step. ◀ and ▶ move it a metre; **Pin** leaves a grey snapshot on the plan (up to `MAX_PINS`, a
view setting, not saved). Each turn card's worst-station button shows the vehicle there. The
label reads, for example, "Steer 23.6° L · articulation 31°": the steering angle the path
demands with its side, and the largest articulation between coupled units.

**Trace points along the road** follows any point fixed to the vehicle: a unit's four corners and
a load's two tips are listed, and any other point is entered as metres ahead of its unit's front
pivot (negative behind) and metres left of its axis (negative right, PGMaps' sign rule). Each trace
is drawn on the plan and reports its widest offset each side of the centreline, with the station,
and how far it passes beyond the formation edge. A trace beyond the edge is reported, not required
to fit: a mirror or log tip may pass over a fill shoulder but strike a cut bank or a tree.

## Drive a path

**Drive a path & turnarounds** (the last fold) drives the vehicle along a line chosen from the
plan: a line or sketch drawn with the map notes, an imported reference line, or the selected
junction turn (**Drive the selected turn as a path** in the junction list). A line is used only
when it is picked here; nothing is read as a path because of its shape.

**Steer path.** The steer-axle centre follows the line's vertices, each interior corner rounded by
a circular arc of the **corner fillet radius** tangent to both legs (tangent length R·tan(Δ/2) for
a turn of Δ). The radius starts at the vehicle's steady minimum at its lock, rounded up to 0.5 m
(15 m with no lock entered); 0 keeps the corners sharp, where the steering angle jumps. A freehand
sketch is first simplified to `SKETCH_SIMPLIFY_M`. **Drive the line from its other end** reverses
it. The axle groups trail by the exact no-slip step, as at junctions, every `DRIVE_STEP_M`.

**Parked heading.** Blank starts every unit straight along the path's first leg. A bearing starts
them straight along that heading instead, as a truck parked at an angle in a landing; the units
then swing in by the tractrix rule.

**Results.** Path length; the largest steering angle with its side and distance along; each
stretch where the angle passes the lock by more than `STEERING_LOCK_TOLERANCE_DEG` (drawn red on
the plan); offtracking, measured from the last axle group to the steer path extended back along the
parked heading; the largest articulation; the **swept area** of every unit and load as a closed
polygon (its outer boundary and any unswept island in the middle of a loop as a hole) with its
area in m²; and the **wheel area**, the area swept by every axle between its wheel extents. A
slider moves the drawn vehicle along the kept positions. **GeoJSON** and **KML** export the swept
area, the wheel area, the steer path, the lock stretches and the traces (WGS 84 longitude and
latitude).

**Footprint.** Tick any drawn or imported areas under **Stay on**, and leave **Count the design
roads' formations** on to add every design road's formation near the path (its left and right
formation widths at each metre). The run then reports the swept area and wheel area outside that
footprint (m²), how far the worst wheel point is beyond the footprint less the wheel clearance, and
how far the body passes beyond its edge. The wheels fit when no wheel point is closer than the
clearance to the edge.

**Swept area construction.** At every step the convex hull of each unit's (and each load's)
outline at that step and the step before is one piece, and the axles the same; the pieces are
joined with polygon-clipping in batches of `DRIVE_UNION_BATCH`, the page getting a turn between
batches (`cooperative.ts`), so **Cancel** works. On the inside of a turn a hull bridges the slight
concavity between the two positions of a side, so the area is overstated, never understated, by a
centimetre or two in a tight turn (the loop test measures under 5 cm at R12). If the clipper cannot
join a piece after retrying on a 1 cm grid, the piece is left out and the result says how many were.

## Turning template and loop turnarounds

The **turning template** is the vehicle after it has driven long enough on one circle that nothing
changes: each rear axle-group centre moves square to its radius, so a unit whose front pivot is on
radius R_f has its axle on √(R_f² − L²), and a hitch h behind the axle is on √(R_r² + h²) — for a
whole chain, SAE J695's R_n² = R² − ΣLᵢ² + Σhᵢ². `steadyStateTurn` gives the radii and
`steadyPose` the pose. The template is placed on a pin, or on a drawn or imported area, at the lock
(or an entered steer radius), turning left or right. It reports the steer radius and angle, the
outer body radius (the outermost body, load or wheel point), the inner wheel radius, the swept
annulus (outer body radius less the innermost point swept, a wheel or a load cutting inside the
wheels), offtracking and the **turnaround diameter**: the outer body diameter plus the wheel
clearance each side. The plan shows the steer-axle circle, the annulus, the circle needed and the
vehicle in its steady pose.

On an **area**, the template is centred in the largest circle the area holds (holes excluded),
found by subdividing cells to within `INSCRIBED_PRECISION_M` (the pole-of-inaccessibility search).
The **loop turnaround fits** when that circle's radius is at least the outer body radius plus the
clearance; otherwise the panel says how far short it is. Each **landing candidate** in the skid
reach panel gets the same note for its road's design vehicle (else the active road's) at the
lock: "loop turnaround fits" or "does not fit (… m short in radius)".

For a 6 m wheelbase truck, 2.6 m wide, 1 m front and 1.5 m rear overhang at a 30° lock: steer
radius 12.000 m, inner wheel 9.092 m, outer body 13.628 m, annulus 4.536 m, and with 0.5 m
clearance a 28.26 m turnaround. Driving it twice round a loop at that radius never passes the lock,
and its swept polygon's island and outer edge sit within 5 cm of the template's radii.

## More units, rigid loads and project vehicles

**Units.** A vehicle has one to `VEHICLE_LIMITS.units` (six) units, for a lowbed with jeep and
booster or a B-train with converter dollies. **Add a unit** appends one to the chain; **Remove**
drops the last and any load resting on it.

**Load length.** Each load is either **Overhangs from each bunk** (as before: the load reaches the
entered distances past both bunks, so its length follows the bunk spacing) or **Rigid**: the load
keeps its straight-travel length (ahead + straight bunk spacing + behind), rides the front bunk and
slides over the rear one, so the tail behind the rear bunk changes by exactly the change in bunk
spacing. With bunks 10.8 m apart and 16.8 m logs, a turn that closes the bunks to 10.6 m leaves
2.0 m behind the rear bunk where the overhang model keeps 1.8 m.

**Project vehicles.** **Save to project vehicles** keeps the current vehicle, with its source
text, in the project file (`vehicleLibrary`); the starting configuration lists them after the
presets as "Project vehicle: …", for every road in the project. A vehicle of the same name is
replaced. **Export vehicle file** writes them as a `pgmaps-vehicle-library-v1` JSON file and
**Import vehicle file** merges one, a vehicle of the same name replacing the project's. Every
vehicle read from a project or a file is checked by the same limits as the road's vehicle check;
a bad entry rejects the whole file. Projects saved before the library existed open without one.
The presets are unchanged: the BC MoTI dimension sets stay as transcribed from the Supplement.

**Inner wheel cut.** `lockFromInnerWheelCut` converts a manufacturer's inner-wheel cut angle and
kingpin track to the single-track lock this tool uses (D = L / tan δ_inner + T/2, lock
atan(L/D)), and `ackermannWheelAngles` goes the other way. Entering one as the other is a 2–4°
error: a 6 m wheelbase, 2 m kingpin track and a 40° inner cut is a 36.36° single-track lock.

## Limits and budgets

| Limit                                    | Value                      | Enforced by                                                        |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Steering lock                            | 5–60°, optional            | `sweptPath.ts` `VEHICLE_LIMITS.steeringLockDeg`; project parser    |
| Lock tolerance                           | 0.1°                       | `vehicleKinematics.ts` `STEERING_LOCK_TOLERANCE_DEG`               |
| Loads per vehicle                        | At most 2                  | `sweptPath.ts` `VEHICLE_LIMITS.loads`; project parser              |
| Load bunk position behind its pivot      | −15 to 30 m                | `sweptPath.ts` `VEHICLE_LIMITS.loadBunkM`; project parser          |
| Load overhang ahead / behind the bunks   | 0–20 m                     | `sweptPath.ts` `VEHICLE_LIMITS.loadOverhangM`; project parser      |
| Junction turn radius                     | 3–200 m                    | `junctionTurn.ts` `JUNCTION_LIMITS.steerRadiusM`                   |
| Corner flare radius                      | 0–100 m                    | `junctionTurn.ts` `JUNCTION_LIMITS.flareRadiusM`                   |
| Road half-width at a junction            | 0.5–30 m (clamped)         | `junctionTurn.ts` `JUNCTION_LIMITS.halfWidthM`                     |
| Straight run either side of the turn     | 5–300 m                    | `junctionTurn.ts` `JUNCTION_LIMITS.leadM`                          |
| Steer-path step                          | 0.25 m                     | `junctionTurn.ts` `JUNCTION_STEP_M`                                |
| Road end counted as meeting another road | Within 5 m                 | `junctionTurn.ts` `JUNCTION_SNAP_M`                                |
| Arm direction taken over                 | 15 m from the junction     | `junctionTurn.ts` `JUNCTION_TANGENT_REACH_M`                       |
| Junctions listed per road                | 12; the rest are counted   | `junctionTurn.ts` `MAX_JUNCTIONS`                                  |
| Corners that get a flare                 | 5–170° between arms        | `junctionTurn.ts` `MIN_FLARED_CORNER_DEG`, `MAX_FLARED_CORNER_DEG` |
| Flare search step                        | 0.5 m                      | `junctionTurn.ts` `FLARE_SEARCH_STEP_M`                            |
| Sharpest turn modelled                   | 175° change of heading     | `junctionTurn.ts` `MAX_TURN_DEG`                                   |
| Units per vehicle                        | 1–6                        | `sweptPath.ts` `VEHICLE_LIMITS.units`; `vehicleLibrary.ts` parser  |
| Project vehicles                         | At most 40, unique names   | `vehicleLibrary.ts` `MAX_LIBRARY_VEHICLES`                         |
| Vehicle file                             | At most 1 MB               | `vehicleLibrary.ts` `MAX_VEHICLE_FILE_BYTES`                       |
| Driven path length                       | 1–1,000 m                  | `vehiclePath.ts` `DRIVE_LIMITS.pathLengthM`                        |
| Driven path vertices                     | At most 500                | `vehiclePath.ts` `DRIVE_LIMITS.vertices`                           |
| Corner fillet radius                     | 0–200 m                    | `vehiclePath.ts` `DRIVE_LIMITS.filletRadiusM`                      |
| Sharpest path corner                     | 175°                       | `vehiclePath.ts` `MAX_VERTEX_TURN_DEG`                             |
| Drive step; positions kept               | 0.25 m; every 0.5 m        | `vehiclePath.ts` `DRIVE_STEP_M`, `DRIVE_RECORD_M`                  |
| Traced points per run                    | At most 6                  | `vehiclePath.ts` `DRIVE_LIMITS.traces`                             |
| Swept pieces per union batch             | 64                         | `vehiclePath.ts` `DRIVE_UNION_BATCH`                               |
| Sketch simplification                    | 0.5 m                      | `vehicleTools.ts` `SKETCH_SIMPLIFY_M`                              |
| Road formation read beyond the path      | 60 m; at most 4,000 strips | `vehicleTools.ts` `FORMATION_MARGIN_M`, `MAX_FORMATION_STRIPS`     |
| Road trace points kept                   | Every 0.5 m                | `vehicleOnRoad.ts` `ROAD_TRACE_RECORD_M`                           |
| Pinned vehicle snapshots                 | At most 6                  | `VehicleOnRoadPanel.tsx` `MAX_PINS`                                |
| Template steer radius                    | 3–200 m                    | `turningTemplate.ts` `TEMPLATE_LIMITS.steerRadiusM`                |
| Largest-circle search precision          | 0.05 m                     | `turningTemplate.ts` `INSCRIBED_PRECISION_M`                       |
| Turnaround footprint                     | At most 2 km across        | `turningTemplate.ts` `MAX_TURNAROUND_FOOTPRINT_M`                  |

The junction inputs (turn radius, flare radius, mapped-road width), the vehicle at a station, pins,
traces, driven paths and templates are view settings and are not saved with the project. The
steering lock, loads, their length mode and the units are saved on the road's vehicle check, and
project vehicles in the project's `vehicleLibrary`; files saved before they existed open without
them.

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
- **Rigid loads ride the front bunk.** A rigid load is anchored at its front bunk and slides over
  the rear one; a load anchored at its rear bunk is not modelled.
- **Rectangular outlines.** Each unit is a rectangle of the vehicle width from its front overhang to
  its rear overhang, each load a rectangle of its own width. Mirrors and decks wider than the body
  are traced as points, not added to the outline.
- **Wheels at the out-to-out width.** Axles are drawn and swept between the vehicle's out-to-out
  width at each axle-group centre, as the road check does: conservative where the body is wider
  than the tracks. Wheel angles are the single-track angle; the Ackermann functions are for
  converting a specification only.
- **One heading for a parked vehicle.** A parked heading starts every unit straight on it; units
  parked at different angles to each other are not modelled.
- **The steering angle at an arc's end** is taken from the neighbouring steer points, a quarter of
  one step's turn (about 0.3° at R12) off the exact tangent there; the axle positions themselves
  are exact.
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
- **"Vertex … turns …°: the vehicle would need to reverse".** A drawn line doubles back. Split
  the manoeuvre or draw a loop.
- **"An R… fillet does not fit between vertices …".** Two corners are too close for that radius:
  lower the fillet radius (if the truck can steer it) or move the vertices apart.
- **"The path (…) is shorter than the vehicle".** The run is reported, but the rear units have not
  finished the manoeuvre; lengthen the line past the turn.
- **"… cannot settle on an R… turn".** A trailer's pivot would be no farther from the centre than
  its wheelbase at that steer radius: the template has no steady pose. Enter a larger radius.
- **"… swept pieces could not be joined".** The clipper failed on near-coincident edges even on a
  1 cm grid; the swept area is understated by those pieces. Change the fillet or the path slightly.
- **"Loop turnaround does not fit".** The largest circle in the area is smaller than the outer
  body radius plus the clearance. A wye or a backing manoeuvre may still work; neither is modelled.
- **Wheels off with no flare that fixes it.** The wheels leave an outside edge or a road's far edge;
  widen that road or change the turn radius.

## Verification

`vehicleKinematics.test.ts` pins the steering geometry for both reference trucks, the BC MoTI
presets' reproduction of the Table 720.A radii and their bunk spacing, the exact step's offtracking
against an independent fine-step integration (R30, L12.5, 180°: 2.723 m; R12, L10, 90°: 3.475 m),
the lock check on R8 and R15 curves, the switchback radius search under a lock, the two-unit load
against the load-as-a-unit model, and saving and reopening a vehicle with a lock and loads.
`vehiclePath.test.ts` pins the QuickTurn specification's hand-checked vectors (below) and the
drive-a-path behaviour: the fillet, the reversing and fillet-fit refusals, the steering side and
lock stretches, the exact swept area of a straight run, traces, the footprint check, a parked
heading, and slicing and Cancel. `turningTemplate.test.ts` pins the steady pose, the template
radii, a vehicle driven twice round a loop at the lock settling on the template, the largest
circle in an area and the loop-turnaround fit. `vehicleOnRoad.test.ts` covers the vehicle placed
at a typed station both directions and road traces against the formation; `vehicleLibrary.test.ts`
six units, the rigid load mode, the project library and vehicle files; `VehicleTools.test.tsx` the
panels and their plan features.
`junctionTurn.test.ts` covers the 3.475 m junction offtracking, the lock flag, the flare search and
its cut-back, mirror-image turns, the skewed junction, the tangent-room and reversing messages, and
finding junctions between design roads and with a mapped road. `JunctionTurnPanel.test.tsx` checks
the listing and that the plan overlay is drawn only while the fold is open and cleared on unmount.

## Provenance

The vehicle-at-a-station view, point traces, driving a drawn path, the closed swept area, the
parked heading, the steady-state template, more units, the rigid load and the project vehicle
library were written for PGMaps from a clean-room functional specification of QuickTurn
(R. Livingston, AutoLISP, GNU GPL v2), `clean-specs/quickturn.md`, gaps G1–G6, G8–G10 and G13. No
QuickTurn code and none of its vehicle library values were used; the presets keep the BC Ministry
of Transportation and Infrastructure _Supplement to TAC Geometric Design Guide_ (2019), Section 720
dimension sets above.

The kinematics follow the published references the specification cites: the no-slip trailing
equation dθ/ds = sin(ψ − θ)/L (Sayers, M.W. 1986, Vehicle offtracking models, _Transportation
Research Record_ 1052:53–62); its exact solution for a straight step,
tan(α′/2) = tan(α/2)·e^(−s/L) (Prince, G.E. and Dubois, S.P. 2009, Mathematical models for motion of
the rear ends of vehicles, _Mathematical and Computer Modelling_ 49:2049–2060, p. 2052); the
steady-state relation R*rear = √(R² − L²) and its multi-unit form (SAE J695, \_Turning Ability and
Off Tracking — Motor Vehicles*); single-track and Ackermann steering geometry (Gillespie, T.D. 1992,
_Fundamentals of Vehicle Dynamics_, SAE, ch. 6); and the pole-of-inaccessibility search
(Garcia-Castellanos, D. and Lombardo, U. 2007, _Scottish Geographical Journal_ 123(3):227–233).

**Comparison with the reference vectors.** QuickTurn needs AutoCAD and could not be run; the
specification's §8 vectors come from an independent script written from the equations above.
PGMaps reproduces them as unit tests: steady offtracking R20 L10 2.6795 m, R12 L10 5.3668 m and R30
L12.5 2.7282 m with their steering angles (±0.001); tractor–semitrailer R20, L₁ 6, L₂ 12, 5.1676 m
(5.1646 m with the fifth wheel 0.3 m ahead); the tractrix step 23.982° and 62.476°; the transient
entry R12 L10 at the arc's end, φ 42.277° and rear radius 9.0856 m; the turning calculator and
inner-wheel-cut conversions; the rigid load's 2.0 m tail; and the steady pose's 13.7477 m and
23.578°. The maximum offtracking over a whole manoeuvre, driven as a filleted path at 0.25 m steps,
is within 0.01 m of the reference: 3.475 m (R12 L10 90°), 2.723 m (R30 L12.5 180°), 2.660 m
(R20 L10 180°) and 1.197 m (R15 L6 90°). The road check's follow-the-leader step on the same
tangent–arc–tangent reads within 0.08 m above it, as before.
