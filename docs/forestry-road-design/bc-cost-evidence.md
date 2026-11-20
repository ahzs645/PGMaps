# BC road-cost evidence and estimation roadmap

The idea and structure behind these tools, and how to extend them to another
province, rate or budget item, are in
[Cost estimating: the idea, the structure and how to extend it](cost-estimating-architecture.md).

Research checked **26 October 2026**; the evidence catalogue was extended on
**12–13 November 2026** and **14 November 2026** (see
[The evidence catalogue](#the-evidence-catalogue)). Cost locations, region
packs, the project budget, saved build-ups and low/high cases were added on
14 November 2026 (see [Cost locations and region packs](#cost-locations-and-region-packs)
onwards).
Amounts below are CAD unless a record says otherwise. This is an evidence
inventory for preliminary road planning, not a provincial survey of awarded
construction prices. A local list price, an appraisal allowance and an installed
contract rate describe different work.

## The evidence catalogue

**Cost references** in the cost dialog (formerly _BC references_) reads a
catalogue of 161 records, 12 worked estimates and 2 sources awaiting a readable
copy, plus the person's own records. It is evidence to read beside an estimate. No record converts
a currency, escalates a price or averages across sources, and browsing writes
nothing. Confirmed use of a record goes through the adoption form (see
[Adopting a record into a project rate](#adopting-a-record-into-a-project-rate)).
The one automatic exception is the explicitly unreviewed
[provisional cross-drain estimate](#provisional-cross-drain-estimates) below.

| Part | Records | What it holds |
| --- | --- | --- |
| BC local | 42, plus 7 quote-only leads | Supplier material and trucking prices from 12 suppliers, two municipal access fees and two maintenance supply awards |
| BC projects | 54 | 14 ministry contract awards, 14 crossing and deactivation project costs, 26 rates from five consultant estimates |
| Beyond BC | 53, from 13 sources | Alberta tender averages, consultant and US Forest Service estimates, New Zealand survey and field trials, England, Australia, and three funding references |
| Reviewed additions | 12, 4 worked estimates, 2 pending | McElhanney's Canim Lake South Road culvert Class D estimate (2025, Cariboo: line rates, the bonding, mobilization and engineering percentages, its contingency as context only, and all four options as worked estimates) and the City of Chilliwack's Payne Road culvert award with its ten bids (2025, South Coast). Ice Lake Road (Whitehorse) and Cinderella Creek (Highway 26) are listed as pending, with no amounts, until their sources can be read in full |

Each record keeps its own amount, unit, currency, price year or effective date,
source link and locator, and the date it was checked. Where the source states
them it also keeps tax, loading, delivery, placement, minimum purchase,
surcharges and availability. For a supplier price a term the source does not
state prints as _Not stated_, so an unknown inclusion never reads as included or
free. Terms that every record of one supplier shares print once under the group.

### Evidence types

The type says what a number can be used for. It is the first thing to read.

| Type | Use |
| --- | --- |
| Supplier price, supplier trucking rate | One supplier's published terms. Dated, year-only, undated, out-of-date and promotional lists are labelled apart. |
| Municipal fee, maintenance award | A recent local purchase or fee for a different product or use. Listed apart from supplier prices; they do not fill a construction-price gap. |
| Contract award | A disclosed maximum at award, without quantities or road length. Not a final cost and never a per-kilometre rate. |
| Completed project, approximate project cost | A reported or rounded cost for finished work. Compare only against matching scope. |
| Tender average | Checks whether a component rate is plausible once the pay-item specification matches. The contract count and quantity stay beside it: one contract and 28 contracts are different amounts of evidence. |
| Estimate | A rate inside an engineer's, consultant's or expert's estimate, read with that estimate's quantities and allowances. |
| Appraisal allowance, survey, field trial, maintenance model | Each follows its own method. A survey range is not a confidence interval, and a field-trial cost is read with the performance the treatment reached. |
| Funding reference | A grant ceiling or funding model. It shows what a programme pays, never what the work costs. |

### Where it shows

- **Region → Local material prices** lists the selected region's suppliers,
  each folded to its first price. Cariboo and Skeena have no comparable public
  construction-aggregate price, so they read _Local quote required_ with their
  quote-only suppliers; the Williams Lake winter-sand award and the New Hazelton
  fees sit under _Other local records_. A link opens the region's project
  records, whose region tag follows the location and is not a verified boundary.
- **Region → What each allowance covers** states, for the selected method,
  what the allowance covers, leaves out and prices separately (`appraisalScope.ts`),
  one folded row per allowance showing its unit and manual section,
  with the culvert tables (IAM Table 4-3, CAM Table 5-4) and the Interior
  manual's equipment and labour rates. The Interior comparison also shows the
  separate stabilizing-material allowance for the chosen road group
  (IAM 4.3.4.1: a constant by group, plus $4,277/km for ripped or quarry rock).
  It is never summed into the subgrade figure.
  The culvert tables list every tabulated diameter (`culverts/appraisalPacks.ts`).
  How each culvert of the road is treated (in the subgrade allowance, a table
  allowance or an engineered estimate) is shown with the culvert, beside its
  construction cost and never in place of it: see [Culverts](culverts.md).
- **Evidence → Records** filters every record by place (a country or a
  province/state), evidence type, the pack's region and words, and lists them
  nearest the project's cost location first: same region, same province or
  state, same country, elsewhere. Each group's summary names how near it is. **Evidence → Worked estimates** shows eight complete estimates with
  their quantities, rates, allowances and totals, so a rate is read inside the
  estimate it came from. Several share a project or source and are not
  independent samples.
- **Sources** keeps two fuel figures apart: the Interior appraisal fuel allowance
  ($10.23/hour on-road, $23.86/hour off-road) and the Hired Equipment Program's
  monthly adjustment (November 2026: +$26.10 and +$60.90). It also lists the
  provincial timber supply area and BEC layers that can propose an appraisal
  input for review, five references on estimating methods, and the sources
  awaiting a readable copy.
- **My records** holds the person's own quotes and finished jobs (see
  [Own records and preferences](#own-records-and-preferences)).

### Adopting a record into a project rate

Every record that can inform a rate has **Use for a project rate** under it, in
**Evidence → Records**, in a region's local prices and under **My records**. The
form writes nothing until **Save rate and source**:

1. **The rate.** Any rate the project or its active road holds
   (`adoptionTargets.ts`): the four project rates (cut, fill, surfacing,
   clearing); the road's haul and loading rates, default borrow and waste rates
   and mobilization; each ground material's excavation rate, and a rock
   material's shallow-rock and overbreak rates; each material site's rate and
   opening cost; the surfacing source's acquisition, processing, loading, haul
   and placement; each culvert's installed cost per metre; and every one-time
   project-budget item (lump sum, % of construction or per km). Each target
   states the basis its figure is entered on and the parts of the work it is
   meant to price. The tool does not guess which one a record is about.
2. **What the price is measured on** (bank, loose or compacted m³, tonne, metre,
   m², km, hour, lump sum, percent), or _Not stated by the source_.
3. **What the price includes** (excavation, supply, processing, loading, haul,
   placing, compaction, disposal, clearing, installation, mobilization), starting
   from what the target prices. A part beyond the target's own work that another
   line of the project already prices is an **overlap**: the form lists each one
   (_Haul is in this price and also in the road's overhaul rate (1.2/m³·km)_),
   and the reason must say how it was accounted for. BC's 2025 standard
   specifications (section 201) pay excavation and borrow as bundles that can
   include haul and placement; this is the check that keeps such a price from
   being counted twice.
4. **The specification matches,** ticked after reading the record's terms.
5. **The adopted rate,** typed by the user. It starts at the record's figure only
   when the record is one amount in the project's currency, in the rate's unit
   and, when stated, on the rate's basis (`adoptionPrefill`): a tonne, a yard, a
   loose volume for a bank rate, a range and every other currency start empty.
   No conversion or escalation is computed anywhere.
6. **A reason** for any difference between the record and the rate, required
   unless the record's own figure was kept unchanged, and always when there is
   an overlap.

Saving is one named undo step that sets the rate and stores, in
`project.rateEvidence` under the target's key, the observation as it was read:
record id, evidence type, title, source, place name and coded place, amounts,
unit, currency, price year or effective date, source URL, locator, checked date,
and **every term the record stated** (scope, tax, loading, delivery, placement,
minimum, surcharges, availability) with its cautions. Beside it go the typed
rate, the currency, the measured basis, the included work, the overlaps
accounted for, the reason and the adoption date, and the target's own name and
unit, so a line still reads if its material or culvert is later removed. The
stored observation is never refreshed from a later catalogue.

Keys: the four project rates keep their bare names (`cutRate`), so files from
before 14 November read unchanged; a road's rates are keyed by the road
(`<roadId>/haul.borrowRate`, `<roadId>/material:<id>.cutRate`,
`<roadId>/site:<id>.unitRate`, `<roadId>/supply.haulRate`,
`<roadId>/culvert:<id>.unitCost`), a budget item by `schedule:<id>`. A file with
any other key is refused.

The observation then shows in three places, so "why $74/m³ when the reference
says $33.70/tonne?" has an answer:

- **The cost dialog.** The rate's row reads _Rate adopted from $33.70/tonne ·
  CAD · 2026_ (material, rock, borrow, waste and mobilization rows included),
  and **Rate sources** under the table gives the source, locator, checked date,
  adoption date, measured basis, included work, reason, accounted overlaps and,
  folded, the terms as read. **Remove source** deletes the record from the
  project and leaves the rate's value alone.
- **The report.** _Rate sources_ under _Cost assumptions_, in the part that is
  always printed, with the same detail.
- **The project file.** `rateEvidence` is optional, so a project without it
  loads and saves exactly as before.

A rate edited after its adoption keeps the record, and all three places say the
rate is now a different figure that the record no longer explains; a rate whose
material, site or culvert was removed says so too.

These records cannot be adopted (`adoptionRefusal`) and show no button: funding
references, context-only records, municipal fees, maintenance awards, a
whole-project amount with no unit, and a record with no published amount. A
project file carrying one of them as a rate source is refused.

### Provisional cross-drain estimates

New ordinary 600 mm round cross-drains can start with **CAD $372.67 per installed
barrel metre**, with no added fixed allowance. The source is the catalogue's
`alberta-upa-2026-4`: **Culverts — Supply and Install (600 mm dia. CSP)** in the
[Government of Alberta's 2026 construction-price sheet](https://www.alberta.ca/system/files/custom_downloaded_images/trans-unit-price-averages.xlsx),
locator `'2026 UPA '!B39:H39`, checked **12 November 2026**. The record covers
**6,024 m across 21 contracts**, with tenders from **1 May 2025 to 30 September
2026**. It is the quantity-weighted average of the three lowest bids, for
600 mm corrugated steel pipe supplied and installed as a pay item. It is an
Alberta highway reference, **not a local BC quote or a final account**.

This is a stated planning assumption, kept separate from confirmed adoption:

- **CAD only.** No currency conversion, escalation, regional adjustment or
  cross-source average is made. The source year and location remain visible.
- **Matching ordinary cross-drains only.** The default assumes a round 600 mm
  single-barrel CSP cross-drain without embedment or an associated stream
  feature. A missing material means *cost assumes corrugated steel*, not that
  the pipe's material has been verified. Applying
  the price never changes the hydraulic material, roughness, geometry or
  design status. Stream crossings and other specifications need their own rate.
- **New batches show their price before Add.** Eligible new culverts receive
  the provisional rate and its provenance when the batch is added. The engine
  prices the installed barrel length and barrel count, using the same quantity
  as the rest of the estimate; the horizontal span alone can differ from the
  inclined barrel length. The designer can replace the batch's rate.
- **Saved values stay as entered.** Opening, importing or loading a project
  does not fill existing zeroes. **Use provisional estimates** explicitly fills
  eligible unpriced cross-drains in one named undo step, preserving entered
  rates, fixed costs and costs documented as carried elsewhere. Imported
  RoadEng culverts and previously marked defaults are excluded from that
  fill action.
- **Review remains outstanding.** `Culvert.costDefault` retains the frozen
  source snapshot and `status: unreviewed`. **Review culvert rates** opens the
  evidence and adoption path to confirm the specification and scope or replace
  it with a local quote.
  A later change of specification or currency flags the mismatch; a positive
  price alone does not confirm it. Only an explicit review can resolve the
  provisional status. A later catalogue does not rewrite the stored estimate.
- **One line on screen, the whole note in print.** The editor, the batch panel and the
  covered estimate show `culvertCostDefaultStatus`'s `headline` ("Provisional CAD
  372.67/m · Alberta 2026 tender average") and any mismatch, with its `notes` (the material
  assumption, the prompt to confirm) behind an (i) (`ProvisionalPriceTip`). The culvert
  schedule, the report and the CSV print the full `summary`. Culverts sharing a note are
  listed on one line, and the covered estimate offers **Review culvert rates** once.

The rate does not establish that local delivery, mobilisation, difficult
excavation, water management, protection works, taxes or other project scope
are covered; review the pay-item specification and each separate allowance.
Do not add an allowance for work already included in a chosen installed rate.
The Labrador mixed-diameter estimate, Canim Lake concrete-box estimate,
municipal fees and appraisal tables are not substitute defaults. Appraisal
allowances remain a separate comparison and never reduce an installed cost.

**Before a barrel is placed, the route comparison assumes 12 m per site.**
`DEFAULT_CROSS_DRAIN_COST` is `CROSS_DRAIN_COST_DEFAULT.unitCost ×
DEFAULT_CROSS_DRAIN_LENGTH_M`, **12 m × $372.67/m = CAD $4,472.04 per site**.
This is an explicit planning length, not a length measured from the road.
The entered lump-sum override still controls the comparison. In other currencies
no CAD default is applied: the allowance starts at zero with an unpriced warning,
and Find the best route keeps separate entered values for each currency.
Access comparisons likewise leave non-CAD cross-drains unpriced and say so.
Newly found roads keep the source and assumed-length note with their search
settings and report; older saved allowances are not relabelled or replaced.
After placement the engine uses actual barrel length and installed rate. A pipe
shorter than 12 m can therefore legitimately cost less than the search allowance;
that reduction is explained by quantity, rather than a missing price.

For the example's horizontal spans of 9.5 m, 8.5 m and 26.5 m, the multiplication
is **44.5 m × $372.67/m = $16,583.815**, approximately **$16,584**, before other
allowances. Known barrel fall can increase the installed length slightly. This
illustrates the provisional quantity-based price, not a BC contractor quote.

### Limits and upkeep

| Limit | Value | Where |
| --- | --- | --- |
| Currency conversion, escalation, cross-source averages | None | `costEvidence/costEvidence.ts`, `costEvidence/rateAdoption.ts` |
| Ways a record can change the estimate | Confirmed adoption; the narrow unreviewed 600 mm cross-drain default described above | `RateAdoption.tsx`, `culvertCostDefaults.ts`; browsing still writes nothing |
| Provisional cross-drain rate | CAD $372.67 per installed barrel metre; 600 mm round single-barrel CSP assumption, no embedment | `CROSS_DRAIN_COST_DEFAULT.unitCost`, `culvertCostDefaults.ts`; `DEFAULT_BATCH_PIPE`, `crossDrainBatch.ts` |
| Rates a record can be adopted into | Project rates, the active road's haul, material, site, surfacing-source and culvert rates, one-time budget items | `adoptionTargets.ts` |
| Adopted rate | Above 0, at most the target's limit: 10,000 per unit for the project rates, materials and per-m³ rates up to 1,000,000, lump sums up to 1,000,000,000, percentages up to 200 | `AdoptionTarget.max`, `adoptionTargets.ts` |
| Saved rate sources | At most 500 | `parseRateEvidence`, `rateAdoption.ts` |
| Adjustment reason | 8–500 characters; optional only when the record's own figure is kept | `ADOPTION_REASON_MIN`, `ADOPTION_REASON_MAX`, `rateAdoption.ts` |
| Interior stabilizing allowance | Road groups 2–12; none for group 1 or snow and ice roads | `interiorStabilizationPerKm`, `bcInteriorCost.ts` |
| Culvert tables shown | Six selected diameters; Interior Part A at 12 m only | `appraisalScope.ts` |

The records are generated: `scripts/forestry/cost-evidence/build-catalogue.mjs`
turns the three reviewed research packages, now kept beside it in
`scripts/forestry/cost-evidence/packages/`, and the reviewed additions in
`additions/` into `src/pages/dev-forestry-roads/costEvidence/*.generated.json`.
`npm run cost-evidence:build` rebuilds them; `npm run cost-evidence:check` (also
a unit test, `costSchedule.test.ts`) fails when a generated file differs from a
rebuild, and each package's own `checksums-sha256.json` is verified first, so a
hand-edited package fails too. Change a record in its package or in a new
additions file and rebuild, never by hand in the JSON. An additions file is one
review: each record in the catalogue's shape with its coded place, read from its
source on the date given, and a `pending` list for sources that could not be read
in full (named, linked, never priced). A newer research package is passed by
folder (`--bc-local`, `--bc-projects`, `--external`). `costEvidence.test.ts` checks
every record's shape and reconciles the worked estimates with their printed
totals. The stabilization constants, both culvert tables, the equipment, labour
and fuel figures and the allowance scopes were read from the 2026 manuals on
12 November 2026; the Coast manual's index was not reachable that day, so a
later amendment is not ruled out.

Not built yet: intersection of the road with the timber supply and BEC layers,
the official bridge and road-reactivation workbooks, and a pack for any
jurisdiction other than BC. The remaining market gap is current BC accepted
forestry-road schedules and final accounts matched to geometry and haul; **My
records** is where a person's own finished jobs now collect.

## Cost locations and region packs

A project has an optional **cost location** (`project.costLocation`,
`costPlaces/`): a country (ISO 3166-1, `CA`), a province or state (ISO 3166-2,
`CA-BC`), a region named by the scheme that defines it (`bc-nr:omineca`) and a
free-text town. The cost dialog's location line offers the region holding most
of the road's points, read against each pack's boundary file (BC: the
natural resource regions in `data/boundaries/BCNR/nr_regions.geojson`, loaded
through `withBase` only while the project has no location), or else the
person's home place. It is written only on **Use** or **Save location**, as one
undo step, with the date and whether it came from the road or was chosen.

The location:

- orders evidence nearest first (same region, then province or state, then
  country, then elsewhere) and labels each group with its distance;
- picks the **pack** whose regions, local evidence, budget items and reference
  tools the dialog shows;
- sets the currency rates are entered in, and with it the currency a record
  must be in to be offered as a starting figure.

It never weights, adjusts or averages a price. A project without a location
reads as before: CAD, the BC pack with no region chosen, catalogue order.

A **pack** (`costPlaces/packs.ts`) is one jurisdiction's knowledge: name,
currency (or the country's), tax notes, region scheme with its boundary file and
each region's guidance, extra budget items, and the reference tools it brings
(`bc-appraisal`, `bc-fuel`). Adding Alberta or the Yukon is adding a pack to
`COST_PACKS` and its records (with their `subdivision` and `regionId`) to an
additions file: nothing in the estimate engine changes. A place with no pack
still works at country level: its records filter and sort by place, its
currency comes from `COUNTRIES`, and the dialog's Region tab says there is no
pack yet.

| Limit | Value | Where |
| --- | --- | --- |
| Countries with a currency | CA, US, NZ, AU, GB, IE | `COUNTRIES`, `costPlaces/packs.ts` |
| Packs | British Columbia | `COST_PACKS` |
| Region suggestion | The region holding most of the active road's points; none outside every boundary | `suggestPlace`, `costPlaces/locate.ts` |
| Location writes | Only Use, Save location or Clear; opening the dialog writes nothing | `CostLocation.tsx` |

## Own records and preferences

**My records** (`costPlaces/costPreferences.ts`, `useCostPreferences.ts`) keeps
the person's own preferences in this browser, with Export and Import as a JSON
file: a **home place** (offered as a project's location when the road says
nothing), the **evidence types read first** within each distance from the
project, and **own records**, quotes and finished jobs in the catalogue's
record shape with a coded place, currency, unit, date, terms and an optional
link. A finished job can carry the breakdown the Interior Logging Cost Report's
road schedule separates (road length, subgrade, stabilization, structures,
other); the record then shows its own cost per km. Own records are marked _Own
record_, are adopted like any record, and never enter the catalogue, the project
file or another person's view. Preferences order and suggest; they never write a
rate or a location.

## Saved build-ups

The **Unit rates** calculators (material quote, truck cycle, equipment crew)
save their inputs as named build-ups in `project.rateBuildUps`
(`costEvidence/rateBuildUps.ts`), with where the input prices came from. A truck
cycle can be built from its parts: load, loaded travel at its speed, unload,
empty return at its speed, queue. **Apply** sets a rate whose basis matches the
build-up's result (material and truck: per compacted m³; equipment: per bank m³)
and stores the formula and result beside it as its source. Editing the build-up
later never moves the rate: the rate source says _The build-up now gives …;
apply it again_. Deleting it keeps the formula on the rate. The report lists each
build-up with its formula.

## Project budget

The **Project budget** section of the cost dialog (`costSchedule.ts`,
`projectBudget.ts`, `ProjectBudgetPanel.tsx`) lists everything a road budget
needs beyond the covered construction estimate, in six groups after the FHWA
Western Federal Lands Estimating Handbook (December 2025): investigation and
design, construction support, environmental work, contractor indirects, owner
and project costs, and future work. The pack adds its own (BC: GST, PST on
taxable materials, FPPR terrain and riparian assessments). Each item is
**priced**, an **allowance**, **included elsewhere** (naming the line),
**excluded** (with the reason) or **not assessed**, the default. A priced item
is a lump sum, a percentage of the construction estimate or an amount per km of
road. Mobilization reads as included when the estimate has a mobilization line.

The budget sits beside the construction estimate and never changes
`estimatedCost`: route searches and the profile optimizer compare roads on
construction alone. _Project budget_ = construction estimate + priced and
allowance items. Not-assessed items are counted and named, never read as zero.
Future work (maintenance, regravelling, inspections, deactivation) takes a first
year and an interval, and is costed over a stated horizon, undiscounted and, with
a discount rate, as a present value; it is kept out of the construction-period
budget. Only edits write `project.costSchedule`; the report prints the budget
after the cost assumptions.

| Limit | Value | Where |
| --- | --- | --- |
| Items stored | 100 | `SCHEDULE_LIMITS.maxEntries` |
| Percentage of construction | 0–200 | `SCHEDULE_LIMITS.maxPercent` |
| Horizon | 1–100 years, default 20 | `SCHEDULE_LIMITS`, `DEFAULT_LIFECYCLE` |
| Discount rate | 0–30 % a year, default 0 | `SCHEDULE_LIMITS.maxDiscountPercent` |

## Low and high cases

**Low and high cases** (`costScenarios.ts`, `CostScenariosPanel.tsx`) state a
low and a high multiplier for each driver: excavation productivity, rock
excavation cost, depth to rock, suitable share of cut, truck-cycle cost, haul
distance, aggregate supply, crossing structures and clearing. A case is a copy
of the road and settings with every driver at its low or high multiplier,
analysed in full by the same engine (as **Compare best and worst case** does for
terrain); neither is applied. The table shows the construction estimate,
excavation, borrow and waste, haul and structures for low, base and high, and
lists what each case changed. The bounds are the estimator's, not a confidence
interval; only the bounds are stored (`project.costScenarios`), never the
results. Multipliers run from 0.1 to 5. Surfacing thickness is a template
change, not a driver.

## What the supplied $1.373 million example reveals

The request supplied 50,318.6 bank m³ cut, 84,061.3 m³ fill, 1,557.9 m³ surfacing,
22,914.2 m² clearing, and 95.7% supported road length. Its four rates were the
workspace placeholders: $12, $8, $40 and $1.50 respectively.

At the default 0.9 compacted-to-bank reusable-cut factor, the displayed quantities
give an aggregate fill deficit of:

`84,061.3 − 50,318.6 × 0.9 = 38,774.56 compacted m³`.

This assumes the cut is suitable and can reach the fill. It is a lower-bound
screen for the covered portion, not a haul allocation. Barriers, unsuitable
material, separated supported runs and construction sequence can increase
borrow demand. The missing 4.3% of road remains unquantified.

The fill-placement line does not procure this missing material. As a sensitivity
example only, each additional $10/compacted m³ for its supply and haul would add
about $387,746 before other allowances. This is not a sourced market rate.
Quantities shown to one decimal place also explain small differences when a
reader multiplies displayed quantities: calculation amounts retain the
unrounded model quantities.

## Changes included with this evidence review

1. **Scope review in the cost dialog.** Calculation freshness, geometric
   coverage and cost completeness are described separately. Remaining
   placeholders, positive zero-cost quantities, disabled/unallocated haul and
   unresolved structures receive review prompts. No budget-confidence
   percentage is invented.
2. **A price preset preserves material assumptions.** Restoring the four
   placeholder prices no longer resets the reusable-cut factor.
3. **Eight-region source browser.** Every natural resource region has
   source-selection guidance and local supplier evidence or an explicit quote
   gap. Selecting a region does not assign geology or multiply project prices.
4. **Separate appraisal comparisons.** The 2026 Interior subgrade equations and
   Coast construction categories are implemented as pure calculations with
   missing-input and applicability checks, source dates and downloadable
   comparison records. They do not change the road's itemized estimate.
   The Interior comparison offers the road's measured sidehill as its uphill
   side slope (`MeasuredSideSlope.tsx`): the length-weighted median of each
   station's cross slope (`sidehillSummary`, `sectionSideSlope.ts`) over a
   station range, whole road by default. It fills the field only on **Use**,
   only in the comparison's temporary inputs, and the field then reads
   _measured suggestion_ with a visible note that it comes from the terrain
   model, not a field measurement. Typing a value clears that mark, and the
   JSON download records which one was used (`sideSlopeSource`).
   Every region gets the same two comparisons and the same road-informed help.
   The Coast comparison has no side-slope input, so it shows the whole road's
   measured sidehill against its 150% tabular-road screen
   (`COAST_TABULAR_SIDESLOPE_LIMIT_PERCENT`, `MeasuredSidehillScreen`) as a
   read-only check that never confirms eligibility; its download keeps it as
   `sidehillScreen`. Both comparisons take an optional length that only scales
   the $/km figure into a total, and both downloads record the region. The
   Interior road-group list marks the region's candidate groups without
   choosing one, and says so where a region lists none. A region's
   "project records" link opens exactly those records (`PROJECT_RECORDS`).
5. **Unit and production calculations.** Material quote conversion, truck-cycle
   costing and equipment productivity calculations require explicit conversion
   factors and operational inputs. Nothing assumes a density, swell factor,
   truck payload, cycle time or production rate.

The main cost report remains the existing itemized quantity × rate scenario.
These additions improve interpretation and rate preparation; they do not
automatically price omitted project work. Reference comparison inputs are
temporary and can be retained through their JSON download. They are not added
to the road-project schema.

## Geographic framework

Use BC's [current region/district list][regions] and the
[forest management unit map][units] for navigation. Confirm the exact appraisal
jurisdiction, timber supply area, supply block and TFL in the relevant manual.
The following group lists are candidate lookups, not a spatial crosswalk.

| Natural resource region | Appraisal references to investigate | Local pricing evidence |
| --- | --- | --- |
| Cariboo | Interior groups 4, 8, 12 | United Concrete & Gravel and 93 Mile Aggregates; quote required. Williams Lake winter-sand award listed apart |
| Kootenay-Boundary | Interior groups 10, 11 | Sullivan Stone, Creston (out-of-date list); BC Eco's undated Nelson-area promotion; MacKay and The Yard Depot, Cranbrook, quote routes |
| Northeast | Interior group 7 | DRS Energy, Fort St. John, public tonne list without effective date |
| Omineca | Interior groups 4, 5, 6, 7, 12 | GetGravel Prince George retail yard-volume list, closed for winter; bulk contract quote needed |
| Skeena | Interior groups 1, 2, 3 and coastal jurisdiction checks | JL's Excavating and Skeena Concrete, Terrace; Steti, Smithers; numeric price gap retained. New Hazelton access fees listed apart |
| Thompson-Okanagan | Interior groups 9, 11, 12 | Cantex, Summerland and Grizzly, Penticton, both effective April 1, 2026; Skwlāx, Chase, effective August 25, 2026 |
| South Coast | Coast construction categories and point-of-origin areas | Kel-Mor, Chilliwack, undated; Stockwell, Sechelt, effective January 1, 2025 |
| West Coast | Coast categories and point-of-origin areas, including Haida Gwaii | Ronin, Cowichan, effective July 18, 2026; Michael Oviatt, Campbell River, 2026 list; Sharecost, Nanaimo, undated |

Region-specific review should focus on conditions actually present: borrow and
quarry access, suitable cut, rock excavation, wet ground, bridges, stabilization,
winter construction, equipment/crew travel, camp and barge/ferry logistics.
These are questions to investigate, not attributes inferred from the region.

## Published material examples

The catalogue now holds every supplier record with its terms; the table below
is the October selection that started it.

| Primary supplier source | Observed price | Date and inclusions |
| --- | --- | --- |
| [Skwlāx, Chase][skwlax] | 25 mm WGB $13/t; 75 mm SGSB/BEF $12.75/t; pit run $7.35/t | Effective Aug 25, 2026. Taxes, loading fee and monthly fuel surcharge need separate treatment. |
| [DRS, Fort St. John][drs] | 3/4-inch minus $16/t; pit run $12.25/t | No effective date shown; loading, delivery, tax and volume terms require confirmation. |
| [GetGravel, Prince George][getgravel] | 3/4-inch minus $49.99/yd³; sandy fill $14.99/yd³ | Loaded into customer's vehicle, before tax; undated retail list, not a bulk forestry contract. |
| [Stockwell, Sechelt][stockwell] | 3/4-inch MMCD base $27/t; structural fill sand $13/t | Jan 1, 2025. Add $0.75/t environmental fee and taxes. Base is delivery-only; confirm separate delivery cost. |
| [Sharecost, Nanaimo][sharecost] | 3/4-inch MoT base $33/t, minimum 12 t; $55/yd³ yard listing | Live undated page; delivery fees apply. Larger commercial volume requires a quote. |
| [BC Eco, Nelson area][bceco] | $253.50 per advertised 10-yard road-gravel load | Undated limited-stock/time promotion, delivery extra; grading, tax and availability unconfirmed. |

The Sharecost page observed on the review date supersedes an indexed 2025 PDF
showing $26/t. Following Skwlāx's current rate-card link similarly found its
2026 sheet instead of the older 2025 truck rates. A search result or a filename
alone is not a reliable price date.

No usable public numeric list was found on the reviewed [United Concrete][united],
[Skeena Concrete][skeena] or [Steti][steti] pages. These identify local suppliers
for a scoped request. [MacKay's aggregate division][mackay] is a further
industrial quote route in Cranbrook. No supplier was contacted during this
review.

## How the official references should be used

### Interior

The [2026 Interior Appraisal Manual][iam] is effective July 1, 2026 and has a
2024 cost base. Its group 2–12 subgrade equations use side slope, road type,
moisture and BEC. One implemented example is group 4, long-term, 30% uphill side
slope, wet ESSF: **$25,347/km**. This is subgrade allowance, not a complete road
price. Small drainage and several clearing/preparation activities are already
included; larger structures and stabilizing material need separate treatment.

Group 1 follows Coast bank-height procedures through Interior ECE. Do not
replace an excavation $/bank-m³ rate with a $/km value or divide that value by
an arbitrary assumed quantity. The model refuses known out-of-scope conditions
and requires the user to review the applicability.

### Coast

The [2026 Coast Appraisal Manual][cam] is effective January 1, 2026, also with a
2024 cost base. Table 5-1 includes categories such as local-ballast OMLB
($72,601/km) and hard-rock MRK ($144,177/km), plus eligible isolation and
point-of-origin additions. These categories bundle road-construction work,
including their ballast/surfacing. Adding this allowance to the itemized road
cost would count overlapping work twice.

Isolation is based on eligible cutblocks' net cruise volume, not isolated road
length. Category, hardness, geographic area and eligibility remain explicit
inputs. The selected administrative region supplies navigation, not an
automatic addition.

### Engineering estimates and equipment

The current [Interior ECE procedures][interior-ece] and
[Coast ECE procedures][coast-ece] provide the more useful framework for unusual
work: detailed quantities, productivity, equipment, structures, end haul,
overland fill and documented costs. They are also useful when deciding which
activities belong in a quote. Formal appraisal eligibility and complete
construction-budget scope are separate questions.

The [2026–2027 BC Road Builders Blue Book][bluebook] is a commercially available
equipment reference. The appraisal manuals' selected equipment allowances
use an older rate edition and are generally all-found; adding an operator or
profit again can duplicate included costs.

The [Hired Equipment Program fuel adjustment][fuel] for November 2026 is
$26.10/hour on-road and $60.90/hour off-road (October: $25.50 and $59.50). This
is a program-specific monthly adjustment, separate from the Interior manual's
own appraisal fuel allowance of $10.23 and $23.86. Neither is a regional
multiplier, and neither is stacked on a quote that already includes the
applicable fuel cost.

## Converting prices onto the model's basis

Keep bank excavation, loose transported material, compacted fill and tonnes
separate. The model currently prices haul movements in compacted m³ for
cut-to-fill/borrow and bank m³ for waste. A per-tonne or loose-truck-volume quote
must be converted before comparison.

- **Material priced by tonne:** CAD/compacted m³ = CAD/tonne ×
  tonnes/compacted m³. State whether the density and invoice mass use dry or
  wet material consistently.
- **Material priced by loose yard:** CAD/compacted m³ = CAD/loose yd³ ÷
  0.764554857984 × loose m³/compacted m³.
- **Truck cycle:** CAD/compacted m³ = all-in CAD/hour × complete cycle
  minutes ÷ 60 ÷ compacted payload m³. The complete cycle includes loading,
  outbound travel, unloading, empty return and queue time as applicable.
- **Equipment/crew:** CAD/bank m³ = all-in crew CAD/hour ÷ net bank
  m³/hour. Net production should already reflect the applicable operating
  efficiency; do not apply the same loss twice.

The truck result is a route-specific complete-cycle CAD/m³ cost. Engineering's
distance-rate fields use CAD/(m³·km) with a separate loading component. Do not
paste the complete-cycle result directly into a distance-rate field; scope
loading and travel consistently before deriving those model inputs.

These are separate cost components. Add only the work absent from the source
quote, and do not move a material-supply component into the fill-placement line
while also charging it as borrow supply.

## Calculation priorities beyond this change

The audit of 14 November 2026 closed several items this table used to list:
rate evidence is now recorded per item with its terms, basis and included work;
survey, engineering and project allowances are budget items with an explicit
state; lifecycle costs and low/high cases exist. The structure behind them and
what comes next are in
[Cost estimating: the idea, the structure and how to extend it](cost-estimating-architecture.md).
What remains from the original list:

| Priority | Improvement | Inputs and acceptance conditions |
| --- | --- | --- |
| 1 | Price and allocate borrow, waste and haul | Use existing Engineering inputs; verify suitable material, actual sites, capacity and access. Unallocated material stays visible. |
| 1 | Complete geometry and crossings | Resolve missing terrain/daylight and review drainage structures; never scale 95.7% into a full road by an assumed average. |
| 2 | Strip beneath fills and replace unsuitable ground | Remove measured organic/weak layers before placing fill; add excavation/disposal/replacement without duplicating existing cut. |
| 2 | Model ROW clearing separately | Add a reviewed clearing envelope beyond daylight, plus separate grubbing and disposal where needed. Do not infer land tenure or timber value. |
| 2 | Strengthen haul physics | Loose volume, density, payload/weight limits, grade-dependent speeds, return trip, queueing and fleet productivity; preserve bank/compacted balance. |
| 2 | Expand scoped work items | Bridges, walls, geotextiles, rip rap, pit development and crew accommodation as reusable work items built from crew, equipment and production. |
| 3 | Actual-cost calibration | Retain tender scope, quantities, change orders and final costs; validate future predictions on comparable held-out jobs. |

The present cut classification is not a field investigation. Likewise, more
calculation precision cannot compensate for a missing bridge, unpriced haul or
the wrong aggregate specification. Improve quantities, scope and evidence
together.

## Verification and ownership

The source catalogue is human-reviewed app configuration, not a scraper-owned
snapshot. Its records are generated from the reviewed research packages (see
[Limits and upkeep](#limits-and-upkeep)). Maintain each primary URL, effective
date and inclusion note together.
Do not automatically roll a saved comparison to a newer manual edition.

Co-located tests cover numerical examples, missing/invalid inputs, applicable
limits, material-balance screening and unit conversions. The browser regression
checks preset preservation, eight-region navigation, both benchmark exports,
the separate stabilizing allowance, a region's evidence and its stated gap, the
evidence filters, a worked estimate's totals, the two fuel figures, unchanged
saved project values, an adoption (no button on a funding reference, an empty
rate field for a tonne price, the cost dialog's source line, the saved
`rateEvidence` and one undo taking back both), the cost location (suggested from
the road, written only on Use), a road-rate adoption with an overlap, a saved and
applied build-up, the project budget and the low and high cases, an own record,
and access to controls on a phone viewport.
These verify the implemented arithmetic and workflow, not agreement with
actual contractor bids.

[regions]: https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/ministry-of-forests-lands-and-natural-resource-operations-region-district-contacts
[units]: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-tenures/managementunitsmap_ftb.pdf
[iam]: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf
[cam]: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/coast-appraisal-manual/cam_2026_master.pdf
[interior-ece]: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior_ece_procedures_manual_july_1_2026.pdf
[coast-ece]: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/ndc_procedures_jan_25.pdf
[bluebook]: https://www.roadbuilders.bc.ca/blue-book/
[fuel]: https://www2.gov.bc.ca/gov/content/industry/construction-industry/transportation-infrastructure/hired-equipment-program/fuel-price-adjustment
[skwlax]: https://www.skwlaxaggregates.com/wp-content/uploads/2026/10/Skwlax-Aggregates-Price-List.pdf
[drs]: https://www.drsenergy.ca/products
[getgravel]: https://getgravel.com/products
[stockwell]: https://www.stockwellgravel.ca/pricing/
[sharecost]: https://sharecost.ca/bulk/base-fill-materials/road-base-34-mot-spec
[bceco]: https://bceco.ca/news/company-news-and-events/tandem-dump-truck-loads-of-road-gravel-for-sale/
[united]: https://www.unitedconcrete.ca/gravel
[skeena]: https://skeenaconcrete.com/
[steti]: https://www.stetitransport.ca/
[mackay]: https://mackaybuilds.com/divisions/aggregates-materials/
