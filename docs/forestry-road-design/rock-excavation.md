# Rock excavation and stripping to a ground layer: limits and checks

A ground material can be marked **Rock**. The top of its shallowest horizon is then the top of rock
at each station, and the road's template can cut rock its own way: a rock batter, a ledge where the
cut batter climbs out of rock, and a blasting (overbreak) level below the subgrade with a drainage
surface under the ditch. The quantities split the cut into common excavation, rock, shallow rock
and overbreak, each priced, and the mass balance counts the overbreak's swell. A **Stripping
before construction** range can also remove ground down to the top of a named material instead of
a fixed depth, so a fill is founded on subsoil or rock.

The code is `rockExcavation.ts` (template values, blasting level, rock areas, swell),
`groundHorizons.ts` (`rockIntervals`, `horizonTopDepth`), `assembledSection.ts` (rock batter,
ledge, removal depth), `engine.ts` `sectionAt` (where the rock section runs), `engineering.ts`
`calculateEngineering` (volumes, costs, mass and haul) and `stationReport.ts` (table and CSV). The
forms are `RockCutFields.tsx`, the material block in `EngineeringControls.tsx` and
`SitePreparationEditor.tsx`.

**Where it is.**

- Engineering → Ground → a material's **Excavated material type** → **Rock**, with its
  **shallow rock** and **overbreak** rates.
- Section → **Rock cut** for the road's own template; Engineering → Templates → a library template
  → **Rock cut** for a named one.
- Engineering → Ground → **Stripping before construction** → **Remove to**.

## Before you rely on it

- **Rock is where you say it is.** The terrain says nothing about rock. The top of rock is a depth
  below original ground that you enter as a horizon, by station range, from test pits, probes,
  outcrop mapping or a geotechnical report. Between two entered depths the rock surface is parallel
  to the ground, not interpolated across the section.
- **Nothing happens until a material is marked rock.** Without one, sections, quantities, costs,
  the station table and its CSV are exactly as before. A template's rock cut does nothing on its
  own, and a rock material without a template rock cut is only classified: drawn, reported and
  priced, with no ledge and no blasting level.
- **The blasting depth is below the subgrade, not the finished surface.** PGMaps' design line is
  the subgrade; surfacing sits above it. Lima VVA measures its 0.75 m from the finished surface, so
  enter Lima's depth less the structure thickness.
- **The depth holds only at the centreline.** The blasting level falls at its own crossfall,
  whatever the road's crossfall or superelevation. On the high side of a superelevated curve it is
  deeper below the subgrade; with a crossfall flatter than the road's it is shallower under the
  shoulder. Look at the section.
- **Replace the starting values.** **Cut rock with this template** fills in Lima VVA's new-project
  values (`ROCK_CUT_DEFAULTS`): 0.1H:1V rock batter, 0.5 m ledge, 0.75 m blasting depth, 10 %
  blasting fall, −25 % drainage fall and 1.0 m shallow depth. They are not a BC standard.
- **Enter the rock's own factor.** A rock material's compacted/bank factor is its bulking: 1.3 to
  1.5 is usual for blasted rock. The overbreak's swell, and all of the rock's usable fill, come
  from it.
- **Complete sections = 100 %.** As for every quantity, a station whose section is not closed
  reports no rock, and a range that strips to a material missing at a station leaves that station
  incomplete.

## Limits and budgets

| Limit                                 | Value                                        | Enforced in                                                              | When exceeded                        |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Rock batter                           | 0.1–10 H:V                                   | `rockExcavation.ts` `ROCK_CUT_LIMITS`, `validateRockCut`, `parseRockCut` | Invalid input left out; file refused |
| Rock ledge width                      | 0–10 m                                       | `ROCK_CUT_LIMITS`                                                        | Invalid input left out; file refused |
| Blasting depth below the subgrade     | 0–5 m                                        | `ROCK_CUT_LIMITS`                                                        | Invalid input left out; file refused |
| Blasting crossfall                    | −20 to 50 %                                  | `ROCK_CUT_LIMITS`                                                        | Invalid input left out; file refused |
| Drainage surface crossfall            | −100 to 0 % (0 is level; negative rises out) | `ROCK_CUT_LIMITS`                                                        | Invalid input left out; file refused |
| Shallow rock depth                    | 0–20 m                                       | `ROCK_CUT_LIMITS`                                                        | Invalid input left out; file refused |
| Shallow rock and overbreak rates      | 0–10,000 $/bank m³                           | `templates.ts` `validateEngineering`, `engineeringProject.ts`            | Invalid input left out; file refused |
| A stripping material marked rock      | Not allowed                                  | `validateEngineering`                                                    | Invalid input left out               |
| Removal material of a stripping range | Must be one of the road's materials          | `sectionAssembly.ts` `validatePreparation`                               | Invalid input left out               |
| Ledge search                          | The batter sampling step (0.05–0.25 m)       | `assembledSection.ts`, `step`                                            | Fixed                                |
| Rock-top crossing that starts a ledge | Within 10 µm of the top-of-rock depth        | `assembledSection.ts`, `leaving`                                         | No ledge at that crossing            |

Invalid values are handled as every section input is: the results keep the last valid value, say
so, and the exports a contractor builds from are refused (`INVALID_INPUT_RULES`, see
[Sections, quantities and costs](sections-quantities-and-costs.md#while-an-input-is-invalid)).

## Built-in assumptions

**Top of rock.** It is the top depth of the shallowest horizon piece whose material is marked rock
(`rockIntervals` in `groundHorizons.ts`), below original ground at each section sample. Horizons
are resolved first, so a later horizon replaces an earlier one as usual. Two rock materials that
touch are one rock body: no ledge is cut between them. The section chart and the report draw the
line as **Top of rock**; it is on every sample with ground, inside and outside the road.

**Rock batter.** A rock material's own cut batter wins. Without one it takes the template's rock
batter, and without that the side's cut batter. A batter segment takes the material at its own
depth below original ground, as every material batter does
([section assemblies](section-assemblies.md#material-dependent-batters)).

**Ledge.** Where the cut batter, climbing from the ditch, rises out of rock into the material
above, a ledge of the template's horizontal width runs outward along the rock surface. The soil
batter starts at its outer end. The points are coded `left-rock-cut-top` / `right-rock-cut-top`
and `left-rock-ledge` / `right-rock-ledge` and appear wherever point codes do. A ledge needs the
batter search, so a template with a ledge or a rock batter is built by the assembled section
builder. A rock top lower than the ditch's outer top, or a batter that starts above rock, gets no
ledge. If stripped ground drops to the ledge, the section daylights there.

**Blasting level.** On each side whose formation edge is in cut, the level starts the blasting
depth below the subgrade at the centreline and falls outward at the blasting crossfall to the
ditch's inner bottom edge (the formation edge where there is no ditch). From there it rises at the
drainage crossfall. Its outer limit is the rock face: the design segment that leaves the ditch's
outer bottom edge, extended downward. The level is the higher of the two lines, so the face can
cut the corner of the blasted region, and it ends at the ditch's outer bottom edge. A V ditch
therefore has no drainage surface: its rock face starts at the ditch bottom. A side in fill at its
formation edge is not blasted. The level's breakpoints are added to the section as samples,
interpolated linearly between their neighbours, so every area the section already had is the same.
The chart draws the level as **Blasting level** where rock reaches down to it.

**Overbreak.** Rock between the design line and the blasting level is blasted and refilled in place
with its own blasted rock. Its volume is reported and priced, but it is not part of the cut
volume, and only its swell, (compacted/bank factor − 1) × overbreak, reaches the mass balance: as
usable fill in the material's reusable share, and as waste in the rest. A factor below 1 leaves the
void short; that shortfall is added to the interval's fill demand (`overbreakSwell`). Lima VVA's
balance counts (k_rock − 1) × V_deep the same way and ignores reusability; PGMaps applies the
material's reusable fraction to the swell.

**Shallow rock.** A column of rock cut is shallow when the rock's thickness from its surface (or
the stripped ground, where stripping has gone into rock) down to the blasting level, or down to
the design line where the column is not blasted, is at most the shallow depth. Shallow rock is part
of the rock cut. Its horizontal area is the width of those columns integrated along the road.

**Volumes on curves.** Rock and shallow rock are part of the cut, so with
**Curvature correction → Apply** they take each interval's whole-cut correction, as every
material does. Overbreak lies below the subgrade, so it is corrected by its own centroid (Pappus,
`curvedVolume.ts`). Shallow-rock area, like every horizontal area, is not corrected.

**Common excavation.** It is the bank cut of earthwork materials that are neither rock nor
stripping. Unclassified excavation, cut where no horizon is entered, is not counted in it: its
class is unknown.

**Prices.** Rock cut is priced at the material's excavation rate, except its shallow part at the
material's shallow-rock rate and its overbreak at its overbreak rate. A blank rate takes the
excavation rate, so turning a blasting level on never adds unpriced work. The cost breakdown shows
three rows per rock material (excavation, shallow rock and overbreak), and their amounts add up to
the material's excavation cost. A zero rate is listed as unpriced (`costReadiness.ts`).

**Haul.** A rock material's usable cut and swell go into the haul allocation as one source of that
material, at its compacted/bank factor. The overbreak's own refill is not hauled.

**Stripping to a ground layer.** A **Stripping before construction** range with **Remove to: top of
_material_** removes ground down to the top of that material's shallowest horizon at each station,
instead of its fixed depth. The removed ground is reported as the range's stripping material, never
reused, and the hole under a fill is filled, as for a fixed depth. With rock as the material this
is Lima VVA's fill termination on rock; with the material below the topsoil it is termination on
subsoil. A station where that material has no horizon is incomplete and says why. Lima falls back to
the next surface up; PGMaps does not, because missing ground stays unknown. Where the material's top
is at the surface, nothing is removed.

**Template transitions.** Inside a transition each side interpolates every rock value that both
templates give. A value, or a whole rock cut, that only one of them gives switches at the middle of
the transition. A one-sided assignment changes the rock cut of its own side only.

## How problems show up

| What you see                                                       | Likely cause                                                                   | What to do                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| No **Top of rock** line on the section                             | No material is marked rock, or no rock horizon covers this station             | Mark the material **Rock**; check the horizon's station range    |
| Rock columns missing from the station table                        | No material is marked rock                                                     | As above; rock columns appear only then                          |
| No ledge where the batter crosses the rock line                    | The template has no rock cut or a zero ledge; the crossing is inside the ditch | Turn on **Rock cut**; check the ditch depth against the rock top |
| No blasting level on one side                                      | That side's formation edge is in fill, or rock lies below the level            | Expected: nothing is blasted there                               |
| Blasting level shallower under the shoulder than at the centreline | The blasting crossfall is flatter than the road's crossfall or superelevation  | Steepen the blasting crossfall or deepen the level               |
| "Stripping to _material_: no _material_ horizon at this station"   | The range strips to a material whose horizon does not reach this station       | Extend the horizon, or end the range before here                 |
| Overbreak with no cost                                             | The material's excavation and overbreak rates are zero                         | Enter the overbreak rate; the cost dialog lists it as unpriced   |
| Mass balance lower after turning on a blasting level               | The rock's compacted/bank factor is below 1, so the refill falls short         | Check the factor: blasted rock bulks                             |

## What it does not do

- Infer rock, its depth or its quality from terrain, imagery or a point cloud.
- Take a top-of-rock surface from an imported grid; rock is a depth below ground.
- Interpolate the rock surface across the section between borings, or extend it past the ground's
  samples.
- Design a blast, check rock-face stability, rock fall or scaling, or size a catch ditch.
- Divide an embankment into a rock zone and ordinary fill.

## Provenance

- Functional specification: Lima VVA §5.2 (surfaces), §6.1 (rock slope, ledge, blasting level,
  drainage surface, shallow depth, fill termination), §6.3, §7.2–§7.3 and gaps G2 and G3
  (clean-room stage 1, 10 November 2026). Written from that specification; no code from Lima VVA
  (GPL-3.0-or-later) was used. The module names and structure are PGMaps' own.
- Deliberate differences from Lima: ground is never extrapolated past its samples (§5.4); a missing
  removal horizon leaves the station incomplete instead of falling back to the surface above; the
  blasting depth is below the subgrade; the overbreak swell takes the material's reusable fraction.
- Pappus' centroid theorem for the overbreak on curves: Hickerson, T. F. (1964), _Route Location and
  Design_; Meyer, C. F. & Gibson, D. W. (1980), _Route Surveying and Design_.
- Checked against the specification's hand-derived worked cases, not program output (Lima could
  not be run), in `rockExcavation.test.ts`:
  - T5 shallow rock: 6.30 m² of rock cut per metre, 1.80 m² shallow over 3.0 m; 63.0 m³, 18.0 m³
    and 30.0 m² over a 10 m strip.
  - T9 blasting level: 99.25 m at the centreline, 98.75 m at the ditch's inner bottom edge, 99.00 m
    at the rock face.
  - T4 mass balance: 1.0 × 1,000 + 1.4 × 500 + 0.4 × 100 = 1,740 m³ of cut; topsoil stays out.
  - Through the engine: a 10 m through cut in rock with a ledge, where the batter, ledge and soil
    batter close at 7.5 m and the overbreak matches the hand integral of the blasting level; and a
    fill founded on rock 0.5 m down, 2,125 m³ of fill and 580 m³ of stripping on a 100 m road.
