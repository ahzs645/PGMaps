# Switchback alternatives: construction, views and checks

**Design → Add a switchback** appends a two-curve return bend to a copy of the
active road. It is a geometric starting point for an alignment alternative. The
entered dimensions and grade are sketch assumptions, not a road-class preset.
The original road, its named profiles and its connection evidence remain intact.

## Try the workflow

For a ready-made exercise, download [switchback-review.json](examples/switchback-review.json)
and select **Open** in the road workspace toolbar (title: **Open project**). It contains
the synthetic hillside baseline and left/right return alternatives, with the left
selected. Each adds 265.663706 m using R40 m curves, 50/10/80 m entry/middle/exit
straights and +3% initial grade; opposing centrelines are 90 m apart. The two
alternatives end at different destinations. Their complete sampled earthwork totals
illustrate the terrain response, not an equivalent-access cost ranking. All terrain,
dimensions and inherited rates are explicitly labelled training assumptions.

1. Open the road workspace and choose a designed road with at least two horizontal
   points and two vertical controls. Confirm the terrain source, datum and coverage.
2. In **Design → Add a switchback**, choose left or right, radius, entry straight,
   middle straight, exit straight and initial formation grade. Changing these
   inputs changes only the preview. The sketch is in local metres, with the
   existing end heading facing forward; it does not show the terrain.
3. Read the added length, opposing centreline spacing, new end station and new
   formation elevation. Select **Create switchback alternative** to add and select
   a separate road through the normal project update/undo path.
4. Use a layout showing **Plan, Profile and Section**. The selected station is
   shared. In **Plan · profile · section · data**, the data pane's **Horizontal
   curves** tab (beside **Samples** and **Vertical controls**) lists each fitted
   curve with selectable BC/EC or TS/SC/CS/ST events. On a phone, or in other
   layouts, choose **Stations** in the detail view picker for the same tabs.
   Expand a curve's review for widths, inside radii, grades, crossfall,
   completeness and conflicts. The profile's horizontal-curve band
   shows the full turn, with its circular part distinguished from transitions.
5. Move the new horizontal controls to suit the actual terrain. Set width and
   template ranges, verify drainage and inspect cut/fill limits. Round the join
   grade break with a fitted vertical curve where required. Review the whole
   return maneuver and both legs together.
6. Compare the alternative with the original only where the reported quantities
   and assumptions are comparable. Save the project; export the curve CSV and
   normal drawings/quantities with the terrain provenance.

The extension starts at the fitted formation level of the existing road end and
uses one entered constant grade. It does not optimize the profile or follow the
ground. Positive grade rises with increasing station. A different extension grade
creates a sharp grade break at the join until the designer adds a vertical curve.

## Construction geometry

The initial return bend comprises an entry tangent, two circular 90° arcs with a
straight between them, and an exit tangent pointing in the opposite direction.
All operations use the same spherical azimuthal-equidistant metric frame as the
road engine. The original controls and original centreline stationing are retained.

For radius `R`, entry length `A`, middle straight `M`, and exit length `E`:

```text
added horizontal length = A + pi * R + M + E
opposing centreline spacing = 2 * R + M
end formation = original end formation + added length * gradePercent / 100
```

For example, `R = 20 m`, `A = 30 m`, `M = 10 m`, and `E = 40 m` add
`142.831853 m` and separate the two opposing centrelines by `50 m`. At `+3%`, the
extension rises `4.284956 m`. These are geometry examples, not recommended dimensions.

A single almost-180° PI would require tangent length `R * tan(deflection / 2)`,
which diverges as the turn approaches 180°. The two-curve construction makes the
required tangent room explicit. Both curves must fit at the entered radius;
the generator rejects the alternative rather than silently reducing its radius.
The starter has no transition spirals. Add them through the normal curve controls
and recheck fit, runoff and widths if the design requires them.

## What the detailed curve review means

- **Full curve** includes entry spiral, circular arc and exit spiral. BC/EC are
  the simple circular events; a spiralled curve has TS/SC/CS/ST. Legacy circular
  start/end/length fields remain SC/CS and circular length for existing callers.
- **Inside formation radius** is `R - inside formation width`. Width includes the
  applied width ranges and curve widening at the calculated section.
- **Inside daylight radius** is `R - abs(inside daylight offset)`. An unresolved
  daylight makes completeness unknown. A known fold elsewhere is still reported.
- **Inner-edge grade screen** is `g_centreline * R / (R - inside width)` for a
  circular arc with constant sampled inside offset and crossfall. It is withheld
  for a missing independent profile, unknown grade, variable width/crossfall, or a
  nonpositive inside radius. It excludes spirals, runoff, wheel tracks and vehicle
  dynamics. Reported ranges are sampled values, not continuous extrema.
- **Required, capped and actual crossfall** are distinct. Entered speed/friction
  criteria produce a banking target; the section engine may retain an inside
  crown steeper than that target. The actual bank conflict applies while positive
  banking is active; an unbanked normally crowned section is treated separately.

Final connector checks now reject actual bank above entered e-max and local
inside formation/daylight folds at the existing dense circular-arc samples and
design breakpoints. See [Final connector checks](final-connector-checks.md).
The descriptive curve schedule uses the active analysis samples; it does not
replace that denser adoption check.

## Design vehicle swept path

**Swept path** (a tab beside **Curves** in the four-pane data pane, and a view in
the detail picker on phones) tracks a design vehicle through every fitted curve
and compares its outer wheel paths with the formation.

**Vehicle.** One to three rigid units. Each unit has a wheelbase (steer axle or
hitch to the axle-group centre), front and rear overhang, and, for all but the
last unit, a hitch offset from its axle group to the next unit's hitch. Width is
out-to-out. Three starting configurations are provided:

| Starting configuration           | Units                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Loaded log truck + pole trailer  | Truck 5.8 m wheelbase; logs pivot on the truck bunk, 9.5 m to the trailer bunk, 5 m overhang |
| Empty log truck, trailer carried | One unit, 5.8 m wheelbase, 3 m rear overhang                                                 |
| Tractor–semitrailer, WB-19 class | Tractor 6.6 m, fifth wheel 0.3 m ahead of the tandem; semitrailer 12.5 m kingpin to axles    |

**These are example dimensions, not certified design vehicles.** Replace them with
the fleet's truck, bunk spacing, log length and overhang, or with the design
vehicle in your criteria source. Editing a starting configuration renames it
"(edited)" and the source field records where the dimensions came from.

Three further starting configurations, LG5, LG3 and WB-15 (BC), are transcribed
from the BC MoTI Supplement to the TAC Geometric Design Guide, with a steering
lock and, for the log trucks, logs spanning two units. They are named dimension
sets with a stated source, not approvals, and their source text lists the values
the figures do not give. A vehicle can also carry a **steering lock**, which flags
a turn the truck cannot steer however wide the formation, and **loads on two
units**. [Vehicle turning](vehicle-turning.md) covers both, the turning
calculator, and the **Junction turns** check of turns into and out of the roads
that meet this one.

**Direction and clearance.** Choose up-station, down-station or both. With both,
each turn reports the direction that needs the most widening. The wheel clearance
is the margin kept between the outer wheel path and the formation edge; take it
from your road class or criteria, since PGMaps does not infer one.

**Calculation.** The steer-axle centre follows the fitted centreline (a single-lane
resource road) at 0.25 m steps. Each axle group trails its front pivot without
slip, the tractrix model behind offtracking templates, starting straight on the
first tangent. On a circular curve of radius R the rear axle of a unit with
wheelbase L settles on radius:

$$
R_{rear}=\sqrt{R^{2}-L^{2}}
$$

With a hitch over the rear axle, a semitrailer of wheelbase L₂ settles on
√(R² − L₁² − L₂²). The unit tests check the simulation against both. For R40,
these give about 1.6 m offtracking for the example pole trailer and 2.6 m for the
example semitrailer.

Wheel and body points are located against the centreline and kept as the widest
offset at each metre. A **turn** spans a curve plus one vehicle length either side;
turns that overlap merge, so a switchback's two curves are judged as **one 180°
turn**, with the trailer's state carried between them. For each turn and direction:

- Offtracking: the widest gap between the steer path and the last axle group.
- Articulation: the largest angle between units (above 80° is flagged).
- Wheel extent against the narrowest formation half-width on each side.
- Widening needed = wheel extent + clearance − formation half-width, per side.
- Body and load beyond the formation edge, reported separately because overhang
  may pass over a fill shoulder but strike a cut batter, tree or barrier.

**On the plan,** orange lines are the outer wheel paths, dashed purple lines the
body and load, and red where the wheels come within the clearance of the
formation edge. **Worst station** frames the whole turn on the plan and selects
its most critical station. Each curve's review in **Curves** names the turn it
belongs to and its result.

**While sizing a switchback,** **Add a switchback** shows the result for the staged
turn before it is created. **Find smallest radius that fits** searches 0.5 m steps
(5–200 m) for the smallest radius whose turn keeps the wheels on the formation
with the entered clearance; **Use R…** applies it. The search assumes offtracking
falls as the radius grows, which holds for this constant-width construction. If
no radius up to 200 m fits, the formation is too narrow for the vehicle and must
be widened instead.

For the supplied example with the loaded pole-trailer starting configuration and
0.3 m clearance, the left R40 return needs 0.22 m more formation on the inside.
Staging a left switchback (50 m entry, 5 m middle, 80 m exit) at the end of the
training road, whose formation is 3 m each side, the tool finds R46.5 m as the
smallest fitting radius; at R20 the wheels need 1.87 m more.

**With a steering lock entered,** the search only accepts radii the vehicle can
steer, and a turn beyond the lock is flagged even when the wheels fit.

**Not modelled:** tandem scrub, tyre and suspension compliance, driver line, speed,
grade, traction and braking, reversing, mirrors and vertical clearance. The check
compares against formation half-widths, not cut batters, clearing limits or the
opposite leg.

## What is still separate

**Vehicle beyond the wheel check:** the swept path checks wheels against the
formation. It does not establish traction or braking on grade, reversing, tandem
scrub, or whether the body and load clear cut batters, trees and the opposite leg.
No automatic BC-standard switchback preset or road-class clearance is supplied.

**Terrain and earthworks:** positive local inside radii do not prove that opposing
legs, cut/fill batters or clearing areas are disjoint. Existing average-end-area
volumes integrate sections along centreline station; they are not a union of
curved swept solids. Incomplete terrain or unresolved daylight leaves totals
partial. Comparison displays suppress earthwork/disturbance savings for those
partial totals, and the mass cursor reports an unknown balance after a gap.

**Siting and optimization:** the generator does not select a bench, avoid unstable
ground, choose a culvert, find the cheapest location or solve a route to an endpoint.
It adds editable geometry. Terrain, drainage, material and endpoint constraints
must be reviewed using their own inputs and views.

## Saved-state behavior

The new alternative preserves the active road's template, materials, width ranges
and engineering settings at their existing stations. Review how those ranges end
or continue on the added length. It keeps the active vertical profile only; other
named profiles remain with the original road. The old final PVI's previously
ignored curve length is cleared on the copy before it becomes an interior point,
so extending it does not retrospectively round the original profile.

The copy clears the old endpoint's FSR connection, network entry, complete-cost
record and named-profile selection/cost-mode metadata. Those records describe the
old endpoint or old comparison. It rejects PVIs beyond the original road end and
a stale road-end formation level. The UI rejects a stale project, busy/read-only
state, missing end formation and the project alternative limit.

## Limits and budgets

These are computational construction limits; project review criteria may be tighter.

| Limit                                   | Value                | Enforced by                                    |
| --------------------------------------- | -------------------- | ---------------------------------------------- |
| Radius                                  | 5–1,000 m            | `switchback.ts` `SWITCHBACK_LIMITS`            |
| Entry / exit straight                   | 5–2,000 m each       | `switchback.ts` `SWITCHBACK_LIMITS`            |
| Middle straight                         | 1–2,000 m            | `switchback.ts` `SWITCHBACK_LIMITS`            |
| Initial grade                           | −30% to +30%         | `switchback.ts` `SWITCHBACK_LIMITS`            |
| Original horizontal / vertical controls | At least two of each | `createSwitchbackAlternative`                  |
| New vertical controls                   | At most 500 total    | `createSwitchbackAlternative` / project parser |
| Road alternatives                       | At most 20           | `SwitchbackTools.tsx` / project parser         |
| Supported formation elevations          | −12,000 to +12,000 m | `createSwitchbackAlternative` / project parser |
| Curve-fit / start-level agreement       | 0.001 m              | `createSwitchbackAlternative`                  |

## Verification and references

`switchback.test.ts` checks both turn directions, analytic arc lengths and spacing,
original position/profile preservation, high-latitude antimeridian behavior,
metadata reset, save/reopen and rejection paths. `SwitchbackTools.test.tsx` checks
staging, one-time adoption, shared-station selection, no terrain calls, and disabled
or stale states. `tests/e2e/forestry-road-switchbacks.spec.ts` drives the
rendered workspace: it stages the reference construction (265.7 m added, 90 m
spacing), checks commit-time clamping of an out-of-range radius, creates the
alternative, saves it and compares the untouched original, selects the new
curves' event stations and checks plan/profile/section agree, downloads the
curve CSV, finds the horizontal-curve band, undoes, and opens the example file.
It also creates a switchback by touch at 390×844 and 320×568 without horizontal
overflow. The reference review records the separately verified source and
UI limitations for this delivery.

See [the supplied-reference review](reference-review-2026-11-01.md) for the screenshot
matrix, current BC manual edition, sources and prioritized remaining work. The
Softree tutorial's two-IP switchback workflow informs the interaction; its example
dimensions are not imported as criteria.
