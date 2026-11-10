# Vertical clearance and an existing road's profile

**Design → Vertical clearance** drives a long low vehicle (a lowbed, or a rigid long load) along
the road's profile and lists where its underside hangs up on a crest or an overhang scrapes in a
sag: switchbacks, culvert dips and short vertical curves. Touching positions next to each other are one place
(`clearanceStretches`): the list shows each place once, at its deepest point, deepest first. On a mapped road the same section reads
the existing road's crossfall from the ground and its tightest crest and sag K.

The calculation is `profileGeometry.ts`, free of DOM, terrain and network access.

## Before you rely on it

- **Enter your own vehicle.** The starting values (12 m between axle groups, 0.30 m underside,
  2 m rear overhang with 0.45 m at its end) are an example, not a lowbed you own. They are not
  saved with the project.
- **It reads the profile, not the section.** A designed road is checked on its design profile, a
  mapped road on its sampled ground. Crossfall, superelevation and ruts are not modelled.
- **Missing elevation is not passed.** Positions where the ground is missing under the vehicle are
  counted as not checked.
- **Chainage stands in for distance along the slope.** On road grades they differ by under 1 %.
- **Crossfall at fixed offsets.** The existing road's crossfall is read at ±3 m with a crown at the
  centreline. A mapped line off the road bench reads the bank, not the road.

## How it is worked out

- **Hang-up.** With the axle groups standing on the road W apart, the underside is the line
  joining the tyre contacts raised by the clearance c. The vehicle hangs up where the road between
  the axles rises above it. On a parabolic crest of rate r = A/L per metre that happens when the
  mid-ordinate W²·r/8 exceeds c.
- **Overhangs.** Past each axle the body's clearance grows from nothing at the axle to the
  entered end clearance. It scrapes where the road rises above the line extended plus that
  clearance.
- **K of an existing road.** At each station a least-squares parabola z = a·s² + b·s + c is fitted
  to the ground over 40 m around it; its grades at the ends give A = 100·(g₂ − g₁) and K = L/|A|.
  A change under 0.5 % is straight. The tightest crest and sag are listed.
- **Crossfall.** Left % = −100·(z_crown − z_left)/(o_crown − o_left), right % = 100·(z_right −
  z_crown)/(o_right − o_crown), or one plane across without a crown. Each is smoothed by a
  least-squares quadratic in station over 9 stations, leaving missing samples out; a station with
  no sample of its own stays unknown.

## Limits and budgets

| Limit                        | Value                             | Enforced by                                      |
| ---------------------------- | --------------------------------- | ------------------------------------------------ |
| Vehicle positions            | every 0.5 m of rear-axle position | `VEHICLE_CLEARANCE_STEP_M`, `profileGeometry.ts` |
| Samples under the vehicle    | every 0.5 m                       | `vehicleClearance`                               |
| K window on an existing road | 40 m                              | `K_WINDOW_M`, `ProfileGeometryPanel.tsx`         |
| Crossfall smoothing window   | odd, 1–51 stations (9 by default) | `MAX_CROSSFALL_WINDOW`, `DEFAULT_CROSSFALL`      |

The section computes only while it is open.

## Failure modes

- **Hang-up on a crest.** The vertical curve is too short for the vehicle: lengthen it (raise K),
  or route the lowbed another way.
- **Rear overhang scrapes in a sag.** A culvert dip or a sag at a switchback is too sharp.
- **Many metres not checked.** The terrain has gaps under the road.
- **Odd crossfall on a mapped road.** The mapped line is off the road bench; trace the road on the
  terrain first.

## Provenance

- Functional specification: RFLTools §4.8 (least-squares vertical curve), §6.2 (existing
  crossfall from a surface) and §10 (vertical vehicle and load clearance), clean-room stage 1,
  10 November 2026. Written from that specification and the texts below; no code from RFLTools
  (GPL-3.0) was used. Unlike RFLTools, a gap in the ground is reported rather than smoothed over,
  and the clearance check reports numbers, not only a drawing.
- AASHTO (2018), _A Policy on Geometric Design of Highways and Streets_, 7th ed., §3.4.6 (parabolic
  vertical curves, K), and the low-clearance-vehicle guidance at humped crossings; TAC (2017) ch. 3.
- Checked against the specification's worked numbers (`profileGeometry.test.ts`): the crest
  z = 100 + 0.04 s − 0.0004 s² fits to g₁ +4 %, g₂ −4 %, K 12.5, BVC (0, 100), PVI (50, 102),
  EVC (100, 100) with no residual; a 10 m wheelbase with 0.10 m clearance hangs on a K 1 crest
  (mid-ordinate 0.125 m) and clears K 2 (0.0625 m).
