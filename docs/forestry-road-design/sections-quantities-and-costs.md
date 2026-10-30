# Sections, quantities and costs: limits and checks

See [Material requirements and economic allocation](material-allocation.md) for exact/quality fill requirements, economic material flows, construction directions, sidecast and layer pricing.

This guide covers road templates, cross-sections, earthwork and surfacing quantities, clearing,
ground materials, haul, culverts and the covered cost estimate. The calculations are specified in
the [workspace contract](../forestry-road-design.md#cross-sections-template-libraries-and-widening);
this page says when their results can be trusted and what they quietly assume.

See [gravel and aggregate sources](gravel-sources.md) for nearby BC candidate lookup,
zero-acquisition-price surfacing scenarios, source capacity/disable controls and
the optional delivered-cost borrow/waste allocation.

## Before you rely on a quantity or cost

- **Complete sections = 100 %.** The headline tile and the cost dialog subtitle show the share of
  road length with complete sections. Below 100 %, every quantity and cost is a _covered
  subtotal_: missing intervals count as nothing, not as an average. Never compare a partial total
  with a complete one.
- **Daylight reached on both sides.** A section is complete only when both batters meet ground
  inside **Section reach each side** (the cross-section half-width, default 35 m). On steep side
  slopes, flat batters or a grade line far above or below the ground, a batter can still be in the
  air (or underground) where the reach ends. The station is then flagged "batter runs past the
  N m section reach", drawn as a red dashed band out to the reach on the plan, and left out of
  quantities. The Design and Review tabs say which stations and offer **Extend reach to 100 m**;
  if it still does not close, the line needs to come closer to the ground.
- **A vertical alignment exists.** Without one, the formation follows the sampled centreline
  ground, so cut and fill come only from crossfall, ditches and batters.
- **The right template at each station.** Check the template band on the profile and the section
  name (`… · transition` inside a transition). A transition returns to the base section at the
  end of its range; it does not blend into the next named template.
- **Material horizons entered.** Without horizons all cut is _unclassified excavation_ at the base
  cut rate, fully reusable at the reusable cut factor. The terrain says nothing about rock, soil
  or organics.
- **Rates replaced and dated by you.** The only direct unit-price preset is placeholder numbers (see
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

| Limit                                | Value                                                                                                                       | Enforced in                                                                | When exceeded                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Station spacing                      | 2–100 m                                                                                                                     | `engine.ts` `validate`                                                     | Calculation error                                                                |
| Calculation stations                 | 3,000 including breakpoints                                                                                                 | `engine.ts` `MAX_STATIONS`                                                 | Spacing widens with a warning; too many breakpoints is an error (split the road) |
| Section reach each side (half-width) | 5–100 m                                                                                                                     | `engine.ts` `validate`                                                     | Calculation error                                                                |
| Section sampling pitch               | larger of 0.25 m and 2 × half-width / 220                                                                                   | `engine.ts` `sectionAt` (`step`)                                           | Fixed; template and daylight breakpoints are added exactly                       |
| Lane width per side                  | 0.1–50 m                                                                                                                    | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Crossfall                            | base crown 0–20 %; side value −20 to 20 %                                                                                   | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Cut and fill batters                 | 0.1–10 H:V                                                                                                                  | `TemplateComponents.tsx`, `project.ts` `parseTemplate`, `validateTemplate` | Field clamps; file rejected; calculation error                                   |
| Ditch                                | width 0–10 m, depth 0–5 m, bottom width 0–ditch width                                                                       | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Surfacing depth                      | 0–2 m                                                                                                                       | `templates.ts` `validateTemplate`                                          | Calculation error                                                                |
| Library and inputs per alignment     | 50 templates, 200 assignments, 32 materials, 200 horizons                                                                   | `templates.ts` `validateEngineering`                                       | Calculation error; add buttons disable at the limit                              |
| Assignment transition                | ≤ half its range; ≤ 1,000 m in files                                                                                        | `validateEngineering`; `engineeringProject.ts`                             | Calculation error                                                                |
| Landing and turnout widening         | 200 ranges, extra width 0–50 m, taper ≤ half the range                                                                      | `engine.ts` `validate`, `widthExtras`                                      | Error; an oversized taper is shortened silently                                  |
| Design-speed rules                   | 1–150 km/h, e max 0–20 %, f 0–1, runoff 0–1,000 m, L 0–50 m                                                                 | `project.ts` `parseCurveDesign`                                            | File rejected                                                                    |
| Culvert ditch dip                    | ditch at most 4 m below the hinge; dip grade 0.1–50 %                                                                       | `engine.ts` `MAX_DITCH_DIP_DEPTH`; `engineeringProject.ts`                 | Dip stops at 4 m                                                                 |
| Material inputs                      | rate 0–10,000 $/bank m³, reusable 0–1, compaction 0.1–2                                                                     | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected; calculation error                                   |
| Reusable cut factor                  | 0.1–2                                                                                                                       | `sidebar/ReviewTab.tsx`, `project.ts` `parseSettings`                      | Field clamps; file rejected                                                      |
| Horizon depths                       | 0–1,000 m below ground; no overlap in station and depth                                                                     | `validateEngineering`                                                      | Calculation error                                                                |
| Material section work                | 15,000,000 section-sample × layer pairs                                                                                     | `engineering.ts` `calculateEngineering`                                    | Calculation error                                                                |
| Haul allocation                      | 20,000,000 comparisons; 20,000 movements                                                                                    | `engineering.ts` `allocateHaul`                                            | Calculation error, not a truncated allocation                                    |
| Haul distances                       | free haul ≤ 100 km; overhaul limit ≥ free haul and ≤ 100 km                                                                 | `validateEngineering`                                                      | Calculation error                                                                |
| Haul rates                           | free-haul, overhaul, endhaul, loading, borrow and waste 0–100,000                                                           | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected; calculation error                                   |
| Mobilization                         | 0–10⁹ $                                                                                                                     | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected; calculation error                                   |
| Contingency                          | 0–100 %                                                                                                                     | `validateEngineering`                                                      | Calculation error                                                                |
| Borrow and waste sites               | 100; access ≤ 100 km; capacity ≤ 10¹² m³ or unbounded; rate 0–100,000 $/m³; fixed cost ≤ 10⁹ $                              | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected; calculation error                                   |
| Culverts                             | 100; span 0.2–500 m, diameter 0.1–20 m, skew ±80°, cover 0–100 m; ditch dip 0.1–50 % or none; ≤ 10⁶ $/m; fixed cost ≤ 10⁹ $ | `EngineeringControls.tsx`, `engineeringProject.ts`, `validateEngineering`  | Field clamps; file rejected; calculation error                                   |
| Culvert barrel profile               | 40 intervals plus centre and formation-edge samples                                                                         | `engineering.ts` `calculateCulvert`                                        | Fixed                                                                            |
| Stream association tolerance         | 1 m between culvert station and crossing                                                                                    | `engineering.ts` `calculateCulvert`                                        | Culvert and results marked incomplete                                            |
| Base rates in the cost dialog        | 0–10,000 per unit; default borrow and waste 0–100,000; haul class and loading fields 0–100,000                              | `CostBreakdown.tsx` `setting`, `haulRate`                                  | Field clamps                                                                     |
| Haul transfers listed                | 100 per page                                                                                                                | `EngineeringSummary.tsx`                                                   | Paginated                                                                        |

The full list of project budgets is in
[Computation and file budgets](../forestry-road-design.md#computation-and-file-budgets).

## Built-in assumptions

**Default section.** `DEFAULT_TEMPLATE` (`terrain.ts`) is a 3 m + 3 m formation with a 3 % crown,
0.75H:1V cut, 1.5H:1V fill, a 1 m wide by 0.5 m deep V ditch and 0.25 m of surfacing. The
**Template starting point** options (`templateFromStarter` in `templates.ts`) set a few values:
_Forest single lane_ 3 + 3 m at 4 %, _Forest double lane_ 4.5 + 4.5 m at 4 %, _Wide landing_ 12 m
left and 3 m right at 2 % with no surfacing, _Crowned road_ 3.5 + 3.5 m at 2 % with no ditch (width,
depth and bottom width 0) and 0.3 m of surfacing. Every starter except _Current road section_ also
clears all side-specific values, both side ditch bottom widths included, and caps the shared ditch
bottom width at the ditch width. The other symmetric values are copied from the current road. The
new template is validated before it is added; one out of range is refused with a message. None is
a BC road-class standard. Left and right ditch bottom widths are set in the template's side
editor.

**Section geometry.** Negative offsets are left looking up-station, on the plan, the section, the
templates and the tables. A ditch is built only where ground at the hinge is above the formation
edge, so a fill side never gets one. Each batter is searched outward from the hinge (or ditch) at
the sampling pitch and refined by bisection. The first crossing with ground is the daylight, so a
narrow bench or gully narrower than the pitch can be stepped over.

**Superelevation and widening.** With a design speed set (defaults in `CurveTools.tsx`: 40 km/h,
8 % maximum, side friction 0.15, 30 m runoff, no widening vehicle), e = V²/(127 R) − f, between 0
and the maximum. The section rotates about the centreline, and the inside falls at least at its
crown. Widening is L²/(2R) on the inside, counted as surfaced width. On a spiralled curve both run
in over the longer of the runoff and the spiral, ending at the SC (see
[Alignment and optimization](alignment-and-optimization.md#built-in-assumptions)). The start of a
runoff is not a calculation station, so the change in crossfall and width there is spread over the neighbouring
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
sample. A legacy stripping horizon classifies excavated cut only: it does not remove ground
under fill or create replacement fill by itself. Explicit **Stripping before construction** ranges now remove ground
before the section is built, including beneath fill, and create the corresponding replacement
fill. See [Physical section assemblies and preparation](section-assemblies.md) for the separate
prepared-ground surface, material-sensitive batters, component/course quantities and limits.

**Nearest-source haul.** With no material policies and economic mode unset, allocation (`allocateHaul`) visits fill intervals in chainage order and takes the
nearest remaining usable cut in the same unbroken run of complete sections. It is a repeatable
scenario, not an optimum. An interval's own cut is at distance zero, so it balances itself first;
any loading rate you enter is charged on that zero-distance volume too. Distance is chainage
difference plus the site's entered access distance. A gap in coverage splits the road into
separate runs, and a site outside a run is never used. Reachability registers the site's chainage
at the calculation stations' micrometre precision, so an exact road-end site remains reachable
when the final station rounds down. Haul distances retain the entered chainage. A new site copies
the default borrow or waste rate when you add it and keeps that rate afterwards. Economic mode instead solves the bounded material flow described in [the allocation guide](material-allocation.md), including material quality, construction direction and sidecast constraints.

**Haul in the cost breakdown** (`haulCostLines` in `engineering.ts`). Every haul, borrow, waste and
site row is quantity × rate = amount, and each group's rows add up to its cost:

- one distance row per haul class and volume basis, in m³·km. Free haul is charged over the whole
  distance; overhaul and endhaul only over the distance beyond free haul (`haulCharge`).
  Compacted (fill and borrow) and bank (waste) volumes are separate rows, never added;
- one loading row per class and basis, in m³, at that class's loading rate;
- borrow supply and waste disposal, one row per site at the site's own rate, plus one row at the
  default borrow or waste rate for volume no site could take;
- site preparation, one lump-sum row per site actually used.

In the table only the default borrow and waste rates are editable. Class rates are edited in the
fields below the table; site rates and fixed costs in Engineering → Haul. **Structures** shows the
culvert count and their installed total, with no rate.

**Culverts.** Cover is the minimum sampled subgrade-to-crown distance under the lane width only. It
excludes surfacing and is not checked under ditches or fill batters. The formation under the
barrel uses the section's own crossfall at each sample's station, superelevated on a curve
(`sectionCrossfall` in `templates.ts`). A dip deepens the left (inlet-side) ditch only, and only
where that ditch is built; the section's ditch-bottom point follows the dipped ditch
(`sectionCodePoints` in `sectionGeometry.ts`, up to `MAX_DITCH_DIP_DEPTH`).

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
`DEFAULT_ROAD_SETTINGS` (`terrain.ts`): cut $12/bank m³, fill $8/m³, surfacing $40/m³ and clearing
$1.50/m². Its source note, behind the (i) beside **Rate preset**, says these are round planning
numbers set in the code. They cite no published cost survey or appraisal manual, carry no price date, and
have no regional adjustment; they are the same everywhere in BC and in every year. Choosing the
preset preserves the separately entered reusable cut factor and material balance.
Any edit to the four prices shows _Custom · this project_.

Replace the preset before the number leaves the workspace: with your own contract or historical
rates, dated, for the area and season you are planning. BC's appraisal manuals cost road in $/km
from road-group equations, not per m³, so they cannot seed this table directly; the contract's
[Itemized scenario cost](../forestry-road-design.md#itemized-scenario-cost) section links them and
explains why.

**Cost status.** Calculation freshness and section coverage are labelled separately.
Coverage is complete at `COMPLETE_COVERAGE_PERCENT` (100 − 1e-5 %, in
`analysisResult.ts`); incomplete engineering is also identified. Neither establishes
pricing confidence or a complete budget. The amber review line above the table counts the
items; **Review** opens them in a dialog. They flag remaining placeholder
prices, unpriced work, material assumptions, unallocated haul and crossing/culvert
gaps. With haul off, it screens minimum borrow demand from the covered material balance
without adding an invented price or extrapolating missing intervals.

**Regional evidence and rate tools.** The BC reference browser links all eight regions
to current manual editions and primary supplier sources. Missing public prices remain
quote-required. Separate Interior subgrade and Coast bundled-road comparisons retain
their 2024 cost base and explicit applicability limits; they never replace the road's
unit rates. Download their JSON to retain temporary comparison inputs. The conversion
tools require an entered density or loose-to-compacted factor, full truck cycle and
payload, or net crew productivity as appropriate. See
[BC cost evidence and estimation roadmap](bc-cost-evidence.md).

## How problems show up

| What you see                                                             | Likely cause                                                                                                                    | What to do                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Left/Right daylight unresolved: batter runs past the N m section reach" | The formation is too far above (fill) or below (cut) the ground for the batter to close inside the reach; the plan draws it red | Bring the grade line closer to the ground; steepen the batter; **Extend reach to 100 m** |
| "Left/Right daylight unresolved: extend section or check terrain"        | Ground ran out (no-data) before the batter met it                                                                               | Check terrain coverage; import terrain that covers the corridor                          |
| "Missing terrain inside the road footprint"                              | A no-data hole under the formation, ditch or batter                                                                             | Fill or replace the terrain; the station stays excluded until then                       |
| Complete sections below 100 %, tile reads "Covered cut / fill"           | Any of the two flags above, at one or more stations                                                                             | Select flagged stations in the station table; fix before comparing alternatives          |
| Mass curve ends early                                                    | First incomplete interval                                                                                                       | Fix that interval; quantities after it are still in the totals                           |
| Totals change when you change station spacing                            | Coarse spacing stepped over gullies, scarps or cut/fill changes                                                                 | Use the finer spacing; or add breakpoints with assignments or horizons                   |
| "Station spacing increased to … m"                                       | Road too long for 3,000 stations at the requested spacing                                                                       | Split the road for site-level quantities                                                 |
| "Correct this alignment before calculating: …"                           | An input failed validation (overlapping assignments or horizons, overhaul limit below free haul, a template out of range)       | Read the message; quantities are unavailable until it is fixed                           |
| Both borrow and waste on a road that balances overall                    | Gaps split the runs, or nearest-source order left cut stranded                                                                  | Close the gaps; add sites; treat the allocation as one scenario                          |
| "Some borrow/waste has no reachable site capacity"                       | No site in that run, or capacity used up                                                                                        | Add sites in the run or raise capacity; until then its haul is not priced                |
| Culvert cover or grade shows "—"                                         | An invert missing, terrain missing along the barrel, or daylight unresolved                                                     | Enter both inverts; fix the section at that station                                      |
| "Barrel is shorter than the centred daylight span"                       | Span less than 2 × the farther daylight / cos(skew)                                                                             | Lengthen the span; check headwalls and skew in the field                                 |
| Rate preset shows _Custom · this project_                                | A base rate or the reusable cut factor was edited                                                                               | Expected; the source note no longer applies                                              |
| Overhaul m³·km in the cost dialog smaller than on the Haul tab           | The dialog charges overhaul and endhaul only beyond free haul; the Haul tab's m³·km is over the whole distance                  | Expected; use the dialog's rows for cost, the Haul tab for movement                      |
| A zero cost line                                                         | Its rate is zero                                                                                                                | Zero means unpriced; enter a rate or state the exclusion                                 |

## What it does not do

- Classify soil, rock or organics from terrain, or test material suitability.
- Strip or undercut beneath embankments, or model layer-specific fill.
- Optimize haul or borrow and waste globally, schedule construction, or survey site access.
- Size culverts hydraulically or check structural cover; see [Drainage](drainage.md).
- Grade a 3D landing pad, design intersections, or add new template component types.
- Produce a market quote. The estimate is a scenario built from rates you enter.
- Bridge a terrain or daylight gap with an assumed quantity.

See [Scope boundaries](../forestry-road-design.md#scope-boundaries) for the full list.
