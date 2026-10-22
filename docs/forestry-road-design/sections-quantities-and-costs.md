# Sections, quantities and costs: limits and checks

This guide covers road templates, cross-sections, earthwork and surfacing quantities, clearing,
ground materials, haul, culverts and the covered cost estimate. The calculations are specified in
the [workspace contract](../forestry-road-design.md#cross-sections-template-libraries-and-widening);
this page says when their results can be trusted and what they quietly assume.

## Before you rely on a quantity or cost

- **Complete sections = 100 %.** The headline tile and the cost dialog subtitle show the share of
  road length with complete sections. Below 100 %, every quantity and cost is a _covered
  subtotal_: missing intervals count as nothing, not as an average. Never compare a partial total
  with a complete one.
- **Daylight reached on both sides.** A section is complete only when both batters meet ground
  inside **Section reach each side** (the cross-section half-width, default 35 m). On steep side
  slopes or flat fill slopes, raise it until the "daylight unresolved" flags disappear.
- **A vertical alignment exists.** Without one, the formation follows the sampled centreline
  ground, so cut and fill come only from crossfall, ditches and batters.
- **The right template at each station.** Check the template band on the profile and the section
  name (`… · transition` inside a transition). A transition returns to the base section at the
  end of its range; it does not blend into the next named template.
- **Material horizons entered.** Without horizons all cut is _unclassified excavation_ at the base
  cut rate, fully reusable at the reusable cut factor. The terrain says nothing about rock, soil
  or organics.
- **Rates replaced and dated by you.** The only rate preset is placeholder numbers (see
  [What the cost estimate covers](#what-the-cost-estimate-covers)). Material, structure, haul,
  borrow, waste and mobilization rates start at zero, which means unpriced, not free.
- **Haul turned on if balance matters.** Haul allocation is off by default. While it is off the
  estimate has no haul, borrow or waste cost, however unbalanced the road is.
- **Culverts complete.** Each culvert needs both inverts, a resolved section at its station and,
  if it is tied to a stream, a crossing within 1 m of its station. Until then its cover is unknown
  and its cost uses the horizontal span.
- **Station spacing suits the ground.** Spacing is a sampling choice. Halve it once and see whether
  the totals move; if they do, the coarser run was missing ground features.

## Limits and budgets

| Limit                                | Value                                                            | Enforced in                                                                | When exceeded                                                                    |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Station spacing                      | 2–100 m                                                          | `engine.ts` `validate`                                                     | Calculation error                                                                |
| Calculation stations                 | 3,000 including breakpoints                                      | `engine.ts` `MAX_STATIONS`                                                 | Spacing widens with a warning; too many breakpoints is an error (split the road) |
| Section reach each side (half-width) | 5–100 m                                                          | `engine.ts` `validate`                                                     | Calculation error                                                                |
| Section sampling pitch               | larger of 0.25 m and 2 × half-width / 220                        | `engine.ts` `sectionAt` (`step`)                                           | Fixed; template and daylight breakpoints are added exactly                       |
| Lane width per side                  | 0.1–50 m                                                         | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Crossfall                            | base crown 0–20 %; side value −20 to 20 %                        | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Cut and fill batters                 | 0.1–10 H:V in the editor and project files (engine 0.05–10)      | `TemplateComponents.tsx`, `project.ts` `parseTemplate`, `validateTemplate` | Field clamps; file rejected                                                      |
| Ditch                                | width 0–10 m, depth 0–5 m, bottom width 0–ditch width            | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Surfacing depth                      | 0–2 m                                                            | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Library and inputs per alignment     | 50 templates, 200 assignments, 32 materials, 200 horizons        | `templates.ts` `validateEngineering`                                       | Calculation error; add buttons disable at the limit                              |
| Assignment transition                | ≤ half its range; ≤ 1,000 m in files                             | `validateEngineering`; `engineeringProject.ts`                             | Calculation error                                                                |
| Landing and turnout widening         | 200 ranges, extra width 0–50 m, taper ≤ half the range           | `engine.ts` `validate`, `widthExtras`                                      | Error; an oversized taper is shortened silently                                  |
| Design-speed rules                   | 1–150 km/h, e max 0–20 %, f 0–1, runoff 0–1,000 m, L 0–50 m      | `project.ts` `parseCurveDesign`                                            | File rejected                                                                    |
| Culvert ditch dip                    | ditch at most 4 m below the hinge; dip grade 0.1–50 %            | `engine.ts` `MAX_DITCH_DIP_DEPTH`; `engineeringProject.ts`                 | Dip stops at 4 m                                                                 |
| Material inputs                      | rate 0–10,000 $/bank m³, reusable 0–1, compaction 0.1–2          | `EngineeringControls.tsx`, `engineeringProject.ts`                         | Field clamps; file rejected                                                      |
| Reusable cut factor                  | 0.1–2                                                            | `DesignSidebarBody.tsx`, `project.ts` `parseSettings`                      | Field clamps; file rejected                                                      |
| Horizon depths                       | 0–1,000 m below ground; no overlap in station and depth          | `validateEngineering`                                                      | Calculation error                                                                |
| Material section work                | 15,000,000 section-sample × layer pairs                          | `engineering.ts` `calculateEngineering`                                    | Calculation error                                                                |
| Haul allocation                      | 20,000,000 comparisons; 20,000 movements                         | `engineering.ts` `allocateHaul`                                            | Calculation error, not a truncated allocation                                    |
| Haul distances                       | free haul ≤ 100 km; overhaul limit ≥ free haul and ≤ 100 km      | `validateEngineering`                                                      | Calculation error                                                                |
| Contingency                          | 0–100 %                                                          | `validateEngineering`                                                      | Calculation error                                                                |
| Borrow and waste sites               | 100; access ≤ 100 km; capacity ≤ 10¹² m³ or unbounded            | `validateEngineering`                                                      | Calculation error                                                                |
| Culverts                             | 100; span 0.2–500 m, diameter 0.1–20 m, skew ±80°, cover 0–100 m | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected                                                      |
| Culvert barrel profile               | 40 intervals plus centre and formation-edge samples              | `engineering.ts` `calculateCulvert`                                        | Fixed                                                                            |
| Stream association tolerance         | 1 m between culvert station and crossing                         | `engineering.ts` `calculateCulvert`                                        | Culvert and results marked incomplete                                            |
| Base rates in the cost dialog        | 0–10,000 per unit                                                | `CostBreakdown.tsx` `setting`                                              | Field clamps                                                                     |
| Haul transfers listed                | 100 per page                                                     | `EngineeringSummary.tsx`                                                   | Paginated                                                                        |

The full list of project budgets is in
[Computation and file budgets](../forestry-road-design.md#computation-and-file-budgets).

## Built-in assumptions

**Default section.** `DEFAULT_TEMPLATE` (`terrain.ts`) is a 3 m + 3 m formation with a 3 % crown,
0.75H:1V cut, 1.5H:1V fill, a 1 m wide by 0.5 m deep V ditch and 0.25 m of surfacing. The
**Template starting point** options in `EngineeringControls.tsx` change only some values: _Forest
single lane_ 3 + 3 m at 4 %, _Forest double lane_ 4.5 + 4.5 m at 4 %, _Wide landing_ 12 m left
and 3 m right at 2 % with no surfacing, _Crowned road_ 3.5 + 3.5 m at 2 % with no ditch and 0.3 m
of surfacing. Every other value is copied from the current road. None is a BC road-class
standard.

**Section geometry.** Negative offsets are left looking up-station, on the plan, the section, the
templates and the tables. A ditch is built only where ground at the hinge is above the formation
edge, so a fill side never gets one. Each batter is searched outward from the hinge (or ditch) at
the sampling pitch and refined by bisection. The first crossing with ground is the daylight, so a
narrow bench or gully narrower than the pitch can be stepped over.

**Superelevation and widening.** With a design speed set (defaults in `CurveTools.tsx`: 40 km/h,
8 % maximum, side friction 0.15, 30 m runoff, no widening vehicle), e = V²/(127 R) − f, between 0
and the maximum. The section rotates about the centreline, and the inside falls at least at its
crown. Widening is L²/(2R) on the inside, counted as surfaced width. The start of a runoff is not a
calculation station, so the change in crossfall and width there is spread over the neighbouring
interval.

**Widening ranges.** Overlapping landing and turnout ranges take the larger extra width per side;
they do not add. Landing extra width is unsurfaced and turnout extra width is surfaced.

**Volumes.** Earthwork uses average end areas over the centreline chainage between stations. There
is no prismoidal correction and no curvature correction for asymmetric sections on curves, so on
tight curves with a high cut side the volume is approximate. A short final interval uses its real
length, not the nominal spacing (`engine.test.ts`). Surfacing is horizontal width × vertical depth
integrated with Simpson's rule. Clearing is the horizontal daylight-to-daylight width with no
buffer, so it understates a right-of-way that is wider than the earthwork footprint.

**Mass.** Without materials, mass is cut × reusable cut factor (default 0.9) − fill. With
materials, it is usable compacted cut − fill. The mass curve and the mass column stop at the first
incomplete interval; later intervals still count in the covered totals.

**Materials.** A new material copies the current base cut rate and reusable cut factor, with a
reusable fraction of 1. It is not linked to them afterwards, so later base-rate edits and preset
changes do not reach it. Horizons are vertical depths below original ground at each section
sample. A stripping material is cut-only: nothing is removed under fill and no replacement fill is
added.

**Haul.** Allocation (`allocateHaul`) visits fill intervals in chainage order and takes the
nearest remaining usable cut in the same unbroken run of complete sections. It is a repeatable
scenario, not an optimum. An interval's own cut is at distance zero, so it balances itself first;
any loading rate you enter is charged on that zero-distance volume too. Distance is chainage
difference plus the site's entered access distance. A gap in coverage splits the road into
separate runs, and a site outside a run is never used. A new site copies the default borrow or
waste rate when you add it and keeps that rate afterwards.

**Culverts.** Cover is the minimum sampled subgrade-to-crown distance under the lane width only. It
excludes surfacing and is not checked under ditches or fill batters. The formation under the
barrel uses the template crossfall, not the superelevated one, so check cover by hand on a
superelevated curve. A dip deepens the left (inlet-side) ditch only, and only where that ditch is
built.

## What the cost estimate covers

The **Covered estimate** tile opens `CostBreakdown.tsx`. Every line is quantity × rate over
complete intervals only.

| Without Engineering inputs      | With Engineering inputs, adds                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Excavation (bank m³ × cut rate) | Excavation by material, unclassified excavation and stripping, each at its own rate                   |
| Fill placement (m³ × fill rate) | Structures: culvert inclined length (horizontal span until both inverts are known) × $/m + fixed cost |
| Surfacing (m³ × surfacing rate) | Haul, borrow supply and waste disposal, only when haul allocation is on                               |
| Clearing (m² × clearing rate)   | Site preparation (once per site used), mobilization (lump sum), contingency (% of subtotal)           |

Fill placement applies to all fill, whether it comes from cut or borrow. Borrow supply is charged
on top. Excavation is charged on all bank cut, including the part that goes to waste.

**What the estimate has no line for.** Bridges and structures other than culverts, cross-drains
you have not entered as culverts, grubbing separate from clearing, stripping or undercut beneath
fill, drilling and blasting except through a material's own rate, erosion control and
revegetation, layout, survey and engineering, deactivation, maintenance, overhead and profit,
taxes, and escalation to a construction date. Haul, borrow and waste for an unbalanced road are
missing entirely while haul allocation is off.

**The rate preset.** `RATE_PRESETS` has one entry, _PG Maps placeholder rates_. It copies
`DEFAULT_ROAD_SETTINGS` (`terrain.ts`): cut $12/bank m³, fill $8/m³, surfacing $40/m³, clearing
$1.50/m² and a reusable cut factor of 0.9. Its source note says these are round planning numbers
set in the code. They cite no published cost survey or appraisal manual, carry no price date, and
have no regional adjustment; they are the same everywhere in BC and in every year. Choosing the
preset also resets the reusable cut factor, which changes the mass balance, not only the price.
Any edit to the five values shows _Custom · this project_.

Replace the preset before the number leaves the workspace: with your own contract or historical
rates, dated, for the area and season you are planning. BC's appraisal manuals cost road in $/km
from road-group equations, not per m³, so they cannot seed this table directly; the contract's
[Itemized scenario cost](../forestry-road-design.md#itemized-scenario-cost) section links them and
explains why.

**Cost status.** The dialog reads "current, complete" only when coverage is at least 99.999 % and
the engineering result is complete (all culverts resolved, no unallocated borrow or waste, no
culvert past the road end). Otherwise it reads "current, partial".

## How problems show up

| What you see                                                      | Likely cause                                                                                                                               | What to do                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| "Left/Right daylight unresolved: extend section or check terrain" | Batter does not meet ground inside the half-width, or ground is missing                                                                    | Raise **Section reach each side**; steepen the batter; check terrain coverage   |
| "Missing terrain inside the road footprint"                       | A no-data hole under the formation, ditch or batter                                                                                        | Fill or replace the terrain; the station stays excluded until then              |
| Complete sections below 100 %, tile reads "Covered cut / fill"    | Any of the two flags above, at one or more stations                                                                                        | Select flagged stations in the station table; fix before comparing alternatives |
| Mass curve ends early                                             | First incomplete interval                                                                                                                  | Fix that interval; quantities after it are still in the totals                  |
| Totals change when you change station spacing                     | Coarse spacing stepped over gullies, scarps or cut/fill changes                                                                            | Use the finer spacing; or add breakpoints with assignments or horizons          |
| "Station spacing increased to … m"                                | Road too long for 3,000 stations at the requested spacing                                                                                  | Split the road for site-level quantities                                        |
| "Correct this alignment before calculating: …"                    | An input failed validation (overlapping assignments or horizons, overhaul limit below free haul, a template out of range)                  | Read the message; quantities are unavailable until it is fixed                  |
| Both borrow and waste on a road that balances overall             | Gaps split the runs, or nearest-source order left cut stranded                                                                             | Close the gaps; add sites; treat the allocation as one scenario                 |
| "Some borrow/waste has no reachable site capacity"                | No site in that run, or capacity used up                                                                                                   | Add sites in the run or raise capacity; until then its haul is not priced       |
| Culvert cover or grade shows "—"                                  | An invert missing, terrain missing along the barrel, or daylight unresolved                                                                | Enter both inverts; fix the section at that station                             |
| "Barrel is shorter than the centred daylight span"                | Span less than 2 × the farther daylight / cos(skew)                                                                                        | Lengthen the span; check headwalls and skew in the field                        |
| Rate preset shows _Custom · this project_                         | A base rate or the reusable cut factor was edited                                                                                          | Expected; the source note no longer applies                                     |
| Haul line: quantity × rates does not give the amount              | The quantity is all m³·km over full distance, compacted and bank together; the amount charges only distance beyond free haul, plus loading | Check haul cost per movement on the Haul tab of the results                     |
| A zero cost line                                                  | Its rate is zero                                                                                                                           | Zero means unpriced; enter a rate or state the exclusion                        |

## What it does not do

- Classify soil, rock or organics from terrain, or test material suitability.
- Strip or undercut beneath embankments, or model layer-specific fill.
- Optimize haul or borrow and waste globally, schedule construction, or survey site access.
- Size culverts hydraulically or check structural cover; see [Drainage](drainage.md).
- Grade a 3D landing pad, design intersections, or add new template component types.
- Produce a market quote. The estimate is a scenario built from rates you enter.
- Bridge a terrain or daylight gap with an assumed quantity.

See [Scope boundaries](../forestry-road-design.md#scope-boundaries) for the full list.
