# Cable mechanics and landing reach: limits and checks

A D-line can take its sag from **Rope and load** instead of an assumed percentage of span. The
skyline is then solved as one static span between the yarder and tailhold support tops, and the
D-line profile draws where the loaded carriage runs, the empty skyline and the largest support
tension. The landing screen's **Maximum reach** finds, along each bearing, the farthest tailhold
whose single-span line clears the ground, with either sag model.

This guide says what those numbers mean, where they stop and what they never check. The code is
`cableMechanics.ts` (mechanics), `cableReach.ts` (reach search), `engine.ts` `analyzeCable`
(D-line profile), `profileOutputs.ts` (exports), `CableRiggingFields.tsx` and `MaxReachPanel.tsx`
(forms).

**Where it is.** Review → **D-line / cable geometry** → **Sag from**. The rigging fields open
under it. A line with rope and load can also be given intermediate supports: see
[Intermediate supports](cable-supports.md). The profile is the detail pane's **D-line** view. Maximum reach is the
**Landing** view's **Maximum reach** switch.

## Before you rely on it

- **Replace the example rigging.** The starting values (`EXAMPLE_RIGGING`) are an example 22 mm
  skyline carrying a 3,000 kg turn on a 500 kg carriage. They are not a recommendation or a BC
  standard. Enter the rope's catalogue mass, diameter, fill factor, modulus and minimum breaking
  force, your safety factor, carriage and turn.
- **Know how the skyline is tensioned.** _Allowable tension_ assumes the operator sets the
  skyline so that the larger support tension reaches breaking force ÷ safety factor with the load
  at mid-span. That is the tightest the rope may be. _Base tension_ starts from the empty skyline's
  tension at its lower support and lets the load raise it. The load then often exceeds the
  allowable; the profile says so.
- **Enter rope beyond the span in base-tension mode.** Rope paid out past the span (to the anchor
  or the drum) stretches with the span and lowers the loaded tension a lot: 200 m of it takes
  about 30 kN off a 200 m span in the checks below. If you do not know it, the result is
  conservative on tension and optimistic on clearance.
- **Clearance is to the carriage, not the turn.** Load clearance is from the carriage's point on
  the skyline straight down to the sampled ground. Add the turn's hang below the carriage and
  any lift you need to the minimum clearance.
- **Use the published LiDAR or your own bare-earth DEM.** Clearance comes from the same terrain
  samples as the assumed-sag profile, about every 2 m. On the regional DEM a knoll narrower than a
  cell is not there.
- **Unknown ground stays unknown.** A sample with no ground has unknown clearance, and the
  minimum is then unknown, never the minimum of the known part. Unknown ground at a support leaves
  the whole skyline unsolved.

## What the mechanics do and do not check

| Checked                                                                | Not checked                                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Static rope shape with the carriage at every position along one span   | Multi-span lines (see [Intermediate supports](cable-supports.md)), saddle friction |
| Largest support tension over every load position, and where it happens | Anchors, stumps, guylines, tailhold trees and spar trees                           |
| That tension against breaking force ÷ safety factor                    | Yarder, carriage, drum or tower ratings and line speeds                            |
| Carriage clearance to the sampled ground along the profile             | Dynamic, braking and impact loads; lateral yarding; side-hill and wind load        |
| The empty skyline at the same rope length                              | Running-skyline interlock and mainline/haulback tension                            |
| Unsolvable rigging: a load the rope cannot carry on any span length    | Rope wear, splices, temperature and creep                                          |

None of it is a rigging plan, an anchor assessment or a WorkSafeBC compliance check. Plan the
operation with the BC cable-yarding references and the equipment's own ratings.

## Limits and budgets

| Limit                            | Value                                                                     | Enforced in                                                                       | When exceeded                                            |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Rigging field ranges             | see `RIGGING_LIMITS` (e.g. safety factor 1–10, skyline mass 0.05–50 kg/m) | `cableMechanics.ts` `RIGGING_LIMITS`, `riggingFieldErrors`, `parseRigging`        | Field clamps; project file refused                       |
| Base tension below the allowable | base < breaking force ÷ safety factor                                     | `cableMechanics.ts` `riggingErrors`                                               | Profile says why it is not solved; file still loads      |
| Load the rope can hold           | allowable > half the payload + carriage weight                            | `cableMechanics.ts` `riggingErrors`                                               | Profile says why it is not solved                        |
| Mechanics span                   | 1–3,000 m horizontal                                                      | `cableMechanics.ts` `MAX_MECHANICS_SPAN_M`                                        | Profile says why it is not solved                        |
| Load positions solved per span   | 81, cosine-spaced (denser near the supports)                              | `cableMechanics.ts` `LOAD_PATH_POSITIONS`                                         | Fixed; the profile interpolates between them             |
| Tension tolerance                | 0.5 % over the allowable before a span is flagged                         | `cableMechanics.ts` `TENSION_TOLERANCE`                                           | Flagged as exceeded                                      |
| Longest rope searched            | 1.6 × the chord                                                           | `cableMechanics.ts` `lengthForTension`                                            | "No skyline length keeps this load within the allowable" |
| Reach bearings                   | 72                                                                        | `radialDeflection.ts` `MAX_RADIAL_SPOKES`                                         | Bearing spacing widens, with a warning                   |
| Farthest tailhold                | 10–2,000 m; shortest line ≤ farthest                                      | `radialDeflection.ts` `MAX_RADIAL_RADIUS_M`, `cableReach.ts` `validReachSettings` | Field clamps; run refused                                |
| Ground samples per bearing       | 1,001 at ≥ 2 m spacing (≤ 72,072 terrain lookups per run)                 | `cableReach.ts` `MAX_REACH_SAMPLES`, `MIN_REACH_SPACING_M`                        | Spacing widens past 2 m only for a cap over 2 km         |
| Tailhold step                    | 2–100 m, rounded to whole samples                                         | `cableReach.ts` `validReachSettings`                                              | Field clamps; run refused                                |

A reach run with rope mechanics solves up to one span per tried tailhold (72 bearings × 200
tailholds with a 2 km cap and a 10 m step). Each takes well under a millisecond, and a tailhold whose
straight chord already fails the clearance is rejected without solving. The search runs in
cooperative slices (`cooperative.ts`), so **Cancel** stops it at the next slice.

## Built-in assumptions

### The span

The rope is an elastic catenary carrying a point load (Irvine 1981, _Cable Structures_, ch. 2–3).
For a rope of unstrained length L₀ the horizontal tension H is the same along the whole span. The
vertical tension rises by the rope's weight per unstrained metre w along it and steps up by the
load F where the carriage hangs. Each stretched element has length dp·(1 + T/EA) and runs in the
direction of its tension, so integrating from the near support gives, piece by piece where the
vertical tension V runs linearly from Va to Vb over a length ℓ:

```text
Δx = H·ℓ/EA + (H/w)·[asinh(Vb/H) − asinh(Va/H)]
Δz = (Va + Vb)/2 · ℓ/EA + (1/w)·[√(H² + Vb²) − √(H² + Va²)]
```

The far support's horizontal distance and height close the two equations for H and the near
support's vertical tension. They are solved by Newton's method with the analytic Jacobian and step
halving, started from a parabolic estimate and, along the load path, from the neighbouring
position's solution.

**Rope length.** In _allowable_ mode L₀ is found by bisection so that, with the load at mid-span,
the larger support tension equals breaking force ÷ safety factor. In _base_ mode L₀ is the length
at which the empty rope's tension at the lower support equals the base tension; with rope beyond
the span, that rope is straight, carries the mean of the two support tensions and gives up length
to the span as it stretches (the fixed-length case of Zweifel 1960 and Pestal 1961).

**Load path.** With L₀ fixed the load is moved from support to support at 81 positions. The
carriage's positions trace the load path; the profile interpolates it at each terrain sample. The
largest support tension over all positions is reported with the support and load position. In
allowable mode it is the allowable, with the load at mid-span.

**Running lines.** Half the mainline and haulback weight per metre is added to the skyline's own
weight, Pestal's usual allowance for running lines hanging from the carriage. Their tension is not
modelled.

**Metallic area.** E·A uses the nominal circle of the entered diameter times the fill factor.

### Why the assumed parabola is optimistic near the supports

The assumed-sag model draws a parabola below the chord with its deepest point at mid-span. A
carriage near a support pulls the rope into a sharp V there, so the loaded path hangs well below
that parabola close to the yarder and tailhold, even when both agree at mid-span. On the checks
below the load hangs 1.8–3.2 m lower than the parabola about a tenth of the span from a support. With the example
rigging the difference grows with span: 1.7 m on 150 m, 3.7 m on 300 m and 11 m on 800 m, all
level spans at a tenth of the span. Concave ground pinches close to the supports, which is where
this matters.

With the example rigging a level span sags 6.5–8.2 % of its length at mid-span under load (150 to
800 m), against the D-line default of 5 % and the landing screen's default of 3 %.

### Maximum reach

Each bearing's ground is sampled once from the landing out to the farthest tailhold. Tailholds
are then tried from the farthest inward every tailhold step on those samples: the first whose line
clears every sample by the minimum clearance is the reach. The line is the same one a saved D-line
draws: yarder and tailhold heights above the sampled ground, with the assumed sag or with rope
and load (the panel's clearance replaces the rigging's own). Before solving a rope, a tailhold
whose straight chord does not clear is rejected, because the loaded rope always hangs below it.

**Limited by** says what stopped the next tailhold out: _Clearance_, _Tension_ (rope and load
only), _Farthest tailhold tried_ (the reach may be farther; raise the cap) or _Unknown terrain_.

**Unknown ground.** A bearing whose ground is unknown before the cap has no reach: tailholds
beyond the gap were never tried. The table shows "≥ N m", the farthest line that clears before the
gap, and that line is the one the envelope and **Use selected D-line** take. A bearing with no
ground at the landing has no line at all.

**Envelope.** The envelope joins the spoke ends in bearing order; a partial sweep closes through
the landing. Where a bearing has no line it passes through the landing. It is a reach outline for
one landing, not a yarding area: it has no lateral yarding distance, side-slope rule or
deflection between supports.

## Reading the results

- **Profile footer.** _Minimum load clearance_ and, when below the minimum, by how much. The next
  line gives the maximum tension, its support (start or end of the resolved line), the allowable
  and whether it is exceeded, and the mid-span sag as metres and % of span. A % close to or above
  the assumed sag you were using means the assumed screen was too optimistic.
- **Exports.** The D-line CSV keeps every assumed-sag column in place and appends the load path,
  empty skyline, load clearance, tensions, rigging and the assumptions to each row, only for a
  line using rope and load. The HTML report adds a _Rope mechanics_ section and the loaded path to
  the plot. An export refuses a profile calculated with other rigging.
- **Reach CSV.** One row per bearing: status, reach, lower bound, where ground went unknown, what
  limited it, the tailhold position and every setting.

## Failure modes

| You see                                                          | It means                                                                                  | Do this                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "The allowable working tension is below half the load"           | The rope cannot hold the turn on any span                                                 | Check breaking force, safety factor, payload and carriage                     |
| "No skyline length keeps this load within the allowable tension" | Rope weight plus load exceed what the allowable holds at this span                        | Shorten the span, add a support (not modelled) or use a stronger rope         |
| "The base tension is too low to hold the empty skyline"          | The empty rope's own weight needs more than the base tension on this span                 | Raise the base tension                                                        |
| Max tension "exceeded" in base mode                              | The load raises the fixed-length skyline past the allowable                               | Lower the base tension, enter the rope beyond the span, or use allowable mode |
| Reach far shorter with rope and load than with the assumed sag   | The loaded carriage sags more than the assumed %, mostly near the supports                | Believe the rope; check the rigging matches the job                           |
| Every bearing "Farthest tailhold tried"                          | Nothing limits the line within the cap                                                    | Raise the farthest tailhold                                                   |
| A saved reach line's clearance differs slightly from the table   | The D-line samples its own span at its own spacing; the search used the bearing's samples | Expect a few centimetres; the D-line profile is the one to keep               |

## How the numbers were checked

The tests (`cableMechanics.test.ts`) compare the solver with numbers produced by running two
independent implementations of the published mechanics on the same inputs. No code from either
was used.

**Tension-limited catenary.** 18 mm skyline, 1.85 kg/m, E·A = 100 kN/mm² on the full circle,
35,000 kgf ÷ 2.5 allowable, 2,500 kg turn and 400 kg carriage, 0.5 + 0.5 kg/m running lines.

| Span × drop (m) | Spare rope, reference / PGMaps (m) | Mid-span sag, reference / PGMaps (m) |
| --------------- | ---------------------------------- | ------------------------------------ |
| 200 × 0         | 0.190 / 0.191                      | 11.277 / 11.279                      |
| 300 × 60        | 0.519 / 0.528                      | 18.416 / 18.432                      |
| 300 × 100       | 0.506 / 0.517                      | 19.411 / 19.436                      |
| 500 × 150       | 1.498 / 1.537                      | 34.529 / 34.600                      |
| 700 × 200       | 3.086 / 3.181                      | 51.758 / 51.909                      |

Load path, sag below the chord at the reference's load positions:

| Span × drop | x (m)  | Reference (m) | PGMaps (m) | Parabola with the same mid-span sag (m) |
| ----------- | ------ | ------------- | ---------- | --------------------------------------- |
| 200 × 0     | 19.27  | 5.717         | 5.706      | 3.928                                   |
| 200 × 0     | 49.42  | 9.316         | 9.313      | 8.393                                   |
| 300 × 60    | 27.03  | 9.285         | 9.246      | 6.044                                   |
| 300 × 60    | 71.16  | 15.146        | 15.144     | 13.340                                  |
| 300 × 60    | 223.03 | 15.365        | 15.366     | 14.063                                  |
| 300 × 60    | 269.44 | 9.560         | 9.532      | 6.745                                   |

The reference carries half the running lines as a point load on the carriage; PGMaps spreads half
their weight along the skyline. The two give the same mid-span sag and drift apart a little as the
rope lengthens, which is the 0.4 % on the longest span's sag and 3 % on its spare rope.

**Fixed-length skyline.** 22 mm skyline, 23.2 N/m, E·A = 100 kN/mm² × 0.7 of the circle, 35 kN
load, base tension at the lower support, yarder 12 m and tailhold 10 m on straight ground.

| Span × rise (m) | Base (kN) | Rope beyond (m) | Zweifel loaded tension (kN) | PGMaps tension at the carriage (kN) |
| --------------- | --------- | --------------- | --------------------------- | ----------------------------------- |
| 200 × 58        | 40        | 0               | 171.84                      | 172.21                              |
| 200 × 58        | 60        | 0               | 182.83                      | 183.20                              |
| 200 × 58        | 80        | 0               | 192.75                      | 193.12                              |
| 200 × 58        | 100       | 0               | 202.84                      | 203.21                              |
| 200 × 58        | 60        | 40              | 174.16                      | 174.53                              |
| 200 × 58        | 60        | 200             | 152.14                      | 152.51                              |
| 300 × 88        | 60        | 0               | 183.15                      | 183.47                              |
| 100 × 28        | 60        | 0               | 181.48                      | 181.89                              |

Zweifel's method treats the rope as a parabola and the tension rise as uniform along it; the
catenary resolves both, and agrees within 0.4 %. Loaded tension barely depends on span length
(about 182–184 kN from 100 to 300 m here): only rope paid out beyond the span brings it down. On
this rope a 141 kN allowable is exceeded at every length, which the profile reports.

## References

- Irvine, H. M. (1981). _Cable Structures_. MIT Press. Elastic catenary with point loads.
- Zweifel, O. (1960). Seilbahnberechnung bei beidseitig verankerten Tragseilen.
  _Schweizerische Bauzeitung_ 78. Fixed-length skyline under load.
- Pestal, E. (1961). _Seilbahnen und Seilkräne für Holz- und Materialtransport_. Fromme, Wien.
  Running-line allowance and skyline checks.
- Dupire, S., Bourrier, F., Berger, F. (2016). Predicting load path and tensile forces during
  cable yarding operations on steep terrain. _Journal of Forest Research_ 21. Tension-limited
  span and load path.
