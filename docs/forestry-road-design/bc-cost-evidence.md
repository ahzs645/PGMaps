# BC road-cost evidence and estimation roadmap

Research checked **26 October 2026**; the evidence catalogue was extended on
**12–13 November 2026** (see [The evidence catalogue](#the-evidence-catalogue)).
Amounts below are CAD unless a record says otherwise. This is an evidence
inventory for preliminary road planning, not a provincial survey of awarded
construction prices. A local list price, an appraisal allowance and an installed
contract rate describe different work.

## The evidence catalogue

**BC references** in the cost dialog reads a catalogue of 149 records and 8
worked estimates. It is evidence to read beside an estimate. No record converts
a currency, escalates a price or averages across sources, and browsing writes
nothing. A record reaches a project rate only when the user adopts it (see
[Adopting a record into a project rate](#adopting-a-record-into-a-project-rate)).

| Part | Records | What it holds |
| --- | --- | --- |
| BC local | 42, plus 7 quote-only leads | Supplier material and trucking prices from 12 suppliers, two municipal access fees and two maintenance supply awards |
| BC projects | 54 | 14 ministry contract awards, 14 crossing and deactivation project costs, 26 rates from five consultant estimates |
| Beyond BC | 53, from 13 sources | Alberta tender averages, consultant and US Forest Service estimates, New Zealand survey and field trials, England, Australia, and three funding references |

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

- **Appraisal → Local material prices** lists the selected region's suppliers,
  each folded to its first price. Cariboo and Skeena have no comparable public
  construction-aggregate price, so they read _Local quote required_ with their
  quote-only suppliers; the Williams Lake winter-sand award and the New Hazelton
  fees sit under _Other local records_. A link opens the region's project
  records, whose region tag follows the location and is not a verified boundary.
- **Appraisal → What each allowance covers** states, for the selected method,
  what the allowance covers, leaves out and prices separately (`appraisalScope.ts`),
  one folded row per allowance showing its unit and manual section,
  with the culvert tables (IAM Table 4-3, CAM Table 5-4) and the Interior
  manual's equipment and labour rates. The Interior comparison also shows the
  separate stabilizing-material allowance for the chosen road group
  (IAM 4.3.4.1: a constant by group, plus $4,277/km for ripped or quarry rock).
  It is never summed into the subgrade figure.
- **Evidence → Records** filters every record by place, evidence type, BC region
  and words. **Evidence → Worked estimates** shows eight complete estimates with
  their quantities, rates, allowances and totals, so a rate is read inside the
  estimate it came from. Several share a project or source and are not
  independent samples.
- **Sources** keeps two fuel figures apart: the Interior appraisal fuel allowance
  ($10.23/hour on-road, $23.86/hour off-road) and the Hired Equipment Program's
  monthly adjustment (November 2026: +$26.10 and +$60.90). It also lists the
  provincial timber supply area and BEC layers that can propose an appraisal
  input for review, and five references on estimating methods.

### Adopting a record into a project rate

Every record that can inform a rate has **Use for a project rate** under it, in
**Evidence → Records** and in a region's local prices. The form asks for four
things and writes nothing until **Save rate and source**:

1. **The project rate.** One of the four base rates in `project.settings`: cut
   (CAD per bank m³), fill (CAD per m³ placed), surfacing (CAD per m³ in place)
   or clearing (CAD per m²). The tool does not guess which one a record is about.
2. **The specification matches.** A tick the user gives after reading the
   record's scope, tax, loading and delivery terms.
3. **The adopted rate,** typed by the user. The field starts empty unless the
   record is one CAD figure already in the rate's unit (`adoptionPrefill`); a
   tonne, a yard, a square metre for a cubic-metre rate, a range and every other
   currency start empty. No conversion or escalation is computed anywhere.
4. **A reason** for any difference between the record and the rate (unit
   conversion, date, quantity, haul). It is required unless the record's own
   figure was kept unchanged.

Saving is one named undo step that sets the rate and stores, in
`project.rateEvidence` under the rate's key, the observation as it was read
(record id, evidence type, title, source, place, amounts, unit, currency, price
year or effective date, source URL, locator, checked date), the typed rate, the
reason and the adoption date. The stored observation is never refreshed from a
later catalogue.

The observation then shows in three places, so "why $74/m³ when the reference
says $33.70/tonne?" has an answer:

- **The cost dialog.** The rate's row reads _Rate adopted from $33.70/tonne ·
  CAD · 2026_, and **Rate sources** under the table gives the source, locator,
  checked date, adoption date and reason. **Remove source** deletes the record
  from the project and leaves the rate's value alone.
- **The report.** _Rate sources_ under _Cost assumptions_, in the part that is
  always printed.
- **The project file.** `rateEvidence` is optional, so a project without it
  loads and saves exactly as before.

A rate edited after its adoption keeps the record, and all three places say the
rate is now a different figure that the record no longer explains.

These records cannot be adopted (`adoptionRefusal`) and show no button: funding
references, context-only records, municipal fees, maintenance awards, a
whole-project amount with no unit, and a record with no published amount. A
project file carrying one of them as a rate source is refused.

Not covered: material, structure, haul, borrow, waste and mobilization rates,
which are per road; a record adopted for one of the four base rates explains
that rate only.

### Limits and upkeep

| Limit | Value | Where |
| --- | --- | --- |
| Currency conversion, escalation, cross-source averages | None | `costEvidence/costEvidence.ts`, `costEvidence/rateAdoption.ts` |
| Ways a record can change the estimate | One: the confirmed adoption form | `RateAdoption.tsx`; `BCCostReferences` receives only `adoption.onAdopt` |
| Rates a record can be adopted into | Cut, fill, surfacing, clearing | `ADOPTABLE_RATE_KEYS`, `rateAdoption.ts` |
| Adopted rate | Above 0, at most 10,000 CAD per unit | `ADOPTED_RATE_MAX`, `rateAdoption.ts` |
| Adjustment reason | 8–500 characters; optional only when the record's own figure is kept | `ADOPTION_REASON_MIN`, `ADOPTION_REASON_MAX`, `rateAdoption.ts` |
| Interior stabilizing allowance | Road groups 2–12; none for group 1 or snow and ice roads | `interiorStabilizationPerKm`, `bcInteriorCost.ts` |
| Culvert tables shown | Six selected diameters; Interior Part A at 12 m only | `appraisalScope.ts` |

The records are generated: `scripts/forestry/cost-evidence/build-catalogue.mjs`
turns the three research packages into
`src/pages/dev-forestry-roads/costEvidence/*.generated.json`. Change a record in
its package and rebuild, never by hand in the JSON. `costEvidence.test.ts` checks
every record's shape and reconciles the worked estimates with their printed
totals. The stabilization constants, both culvert tables, the equipment, labour
and fuel figures and the allowance scopes were read from the 2026 manuals on
12 November 2026; the Coast manual's index was not reachable that day, so a
later amendment is not ruled out.

Not built yet: adoption into the per-road material, structure and haul rates,
intersection of the road with the timber supply and
BEC layers, the official bridge and road-reactivation workbooks, and sensitivity
runs on rock, haul and production inputs. The remaining market gap is current BC
accepted forestry-road schedules and final accounts matched to geometry and haul.

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

| Priority | Improvement | Inputs and acceptance conditions |
| --- | --- | --- |
| 1 | Price and allocate borrow, waste and haul | Use existing Engineering inputs; verify suitable material, actual sites, capacity and access. Unallocated material stays visible. |
| 1 | Complete geometry and crossings | Resolve missing terrain/daylight and review drainage structures; never scale 95.7% into a full road by an assumed average. |
| 1 | Record rate evidence per item | Supplier/source, quote date/expiry, location, currency, unit basis, quantity tier, included activities, fuel/tax terms and estimator assumptions. |
| 2 | Strip beneath fills and replace unsuitable ground | Remove measured organic/weak layers before placing fill; add excavation/disposal/replacement without duplicating existing cut. |
| 2 | Model ROW clearing separately | Add a reviewed clearing envelope beyond daylight, plus separate grubbing and disposal where needed. Do not infer land tenure or timber value. |
| 2 | Strengthen haul physics | Loose volume, density, payload/weight limits, grade-dependent speeds, return trip, queueing and fleet productivity; preserve bank/compacted balance. |
| 2 | Expand scoped work items | Bridges, walls, geotextiles, rip rap, erosion control, pit development, mobilization/demobilization, crew accommodation and traffic/access work. |
| 2 | Survey, engineering and project allowances | Record explicit inclusion/exclusion for layout, investigation, design, monitoring, testing, administration, overhead/profit and applicable tax. |
| 3 | Construction phase and lifecycle | Separate new road, upgrade/reactivation, seasonal access, routine maintenance, deactivation and rehabilitation. |
| 3 | Sensitivity and uncertainty | Compare material suitability, rate, haul and ground-condition scenarios. A contingency percentage is not a calibrated P50/P80 estimate. |
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
`rateEvidence` and one undo taking back both), and access to controls on a
phone viewport.
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
