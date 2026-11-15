# Road costs beyond BC: evidence and estimating methods for PGMaps

**Reviewed 12 November 2026 · America/Vancouver · Public-source research**

## Findings

The expanded research provides **53 catalogue records from 13 primary sources: 50 cost observations and three funding-context records**, covering Canada outside BC, the United States, New Zealand, England, Australia and Ireland. It also includes five additional methods references and eight worked examples or project-budget records. Several examples share a project or source; they are not independent statistical samples.

The most immediately useful additions are Alberta's itemized tender averages, US Forest Service road worksheets, New Zealand's machine-hour reconstruction study, and consultant estimates that expose quantities and allowances. Broad road-length ranges help explain variation, while detailed schedules explain how an estimate is built.

The companion JSON package is prepared for a reviewed PGMaps catalogue update. It has not been wired into the app. Every observation preserves its original currency, unit and cost basis. There is no currency conversion, inflation uplift, international average or automatic change to a route estimate.

## 1. Recent Canadian bid evidence

### Alberta: unit prices with quantities and contract counts

The official workbook's **2026 UPA** construction sheet covers tenders from **1 May 2025 through 30 September 2026**, in the workbook updated **31 October 2026**. Its figures combine the three lowest tender bids, weighted by quantity. They are neither retail quotes nor final paid costs.

| Pay item | CAD unit price | Reported quantity | Contracts |
|---|---:|---:|---:|
| Common excavation, G225 | $11.22/m³ | 3,852,330 m³ | 26 |
| Borrow excavation, G235 | $15.99/m³ | 695,100 m³ | 6 |
| Granular base, Des. 2 Cl. 25, B282 | $33.70/t | 1,316,195 t | 28 |
| 600 mm CSP supply and installation, D410 | $372.67/m | 6,024 m | 21 |
| Overhaul, G239 | $1.60/(m³·km) | 779,570 m³·km | 5 |
| Crush to stockpile, A345 | $6.99/t | 50,000 t | 1 |

Match the pay-item specification before using any figure. Tax treatment is unstated in the inspected material. Contract count, quantity and tender window belong beside the price. Other extracted rows include gravel crushing/hauling/stockpiling and truck haul; their small samples need particular care.

Sources: [Alberta methodology and report link](https://www.alberta.ca/unit-prices-and-cost-adjustments); [official XLSX](https://www.alberta.ca/system/files/custom_downloaded_images/trans-unit-price-averages.xlsx), `READ ME`, `Report Title Page`, and `2026 UPA ` (sheet name includes a trailing space). Exact cells are recorded in the dataset.

### Consultant estimates: quantity and scope explain the rate

**Allnorth, Northern Labrador:** the February 2024 pre-feasibility report uses **2023 dollars** and a **ROM ±50%** estimate. Selected inputs are **$22/m³** for combined grading, including overhaul; **$32/t** for a 250 mm gravel driving surface; and **$1,000/m** for grouped 600–1,000 mm culverts including dewatering, excavation, bedding and riprap. The 809 km program totals approximately **CAD $2.09 billion**, with construction allowances, structures, maintenance depots, engineering and HST included. Its method uses mapped quantities and earlier Labrador bids adjusted for time and location. Its highway standards and scope make the total unsuitable as a generic forest-road kilometre price.

Source: [Allnorth report](https://www.assembly.nl.ca/business/electronicdocuments/Allnorth-ProjectSummaryReport-RoadToTheNorth.pdf), printed pp.125–128; Table 5.1 on PDF p.129.

**McElhanney, Kneehill County, November 2025:** a Class B estimate for twin 5.54 m structural-plate culverts lists **$50/m³ structural excavation**, **$100/m³ granular backfill** and **$30/t granular base**. The estimate combines provincial averages, local market evidence and engineering judgement, with separate traffic, environmental, mobilization and professional costs. This supports a major-crossing example with defined scope.

Source: [BF13480 estimate](https://pub-kneehillcounty.escribemeetings.com/filestream.ashx?DocumentId=4734), PDF p.7.

## 2. A complete US Forest Service estimate

The **Kilkenny** engineer's estimate, dated **21 October 2024**, demonstrates a transparent quantity-by-task workflow. All figures below are **nominal USD**.

| Component | Calculation | Extended cost |
|---|---:|---:|
| Mobilization allocation | 10 × $150 | $1,500 |
| Earth berms | 2 × $150 | $300 |
| Light linear grading | 1.32 miles × $3,500 | $4,620 |
| L-turnarounds | 5 × $500 | $2,500 |
| T-turnarounds | 3 × $600 | $1,800 |
| Aggregate 23A | 355 yd³ × $17 | $6,035 |
| Pit-run aggregate | 80 yd³ × $10 | $800 |
| **Works subtotal** | | **$17,555** |
| Engineering | Package allowance | $3,334 |
| **Total** | | **$20,889** |

This is localized reconstruction across existing road segments. Aggregate uses loose hauled volume and a government pit; Aggregate 23A includes a processing fee. The package flags ambiguous volume-conversion wording and a stale mobilization comment. It does not establish an overall new-road cost per kilometre.

Source: [Kilkenny road package](https://www.fs.usda.gov/sites/nfs/files/r09/hiawatha/publication/timber-sales/Kilkenny_Re-Offer4_Road_Package.pdf), quantities p.4, estimate p.5, notes p.18.

The **Herring** estimate, **15 August 2025**, independently follows the same approach: **USD $10,385 works + $2,314 engineering = $12,699**. It prices roadbed reconditioning, berm removal/reconstruction, temporary landings and aggregate placement separately. Its **$19/loose yd³** aggregate allowance includes a **$7/yd³** government processing fee and should not be catalogued as a commercial material-only quote. A discrepancy in the road assignment of berm work is retained in the source notes.

Source: [Herring road package](https://www.fs.usda.gov/sites/nfs/files/r09/hiawatha/publication/timber-sales/Herring%20Spec%20Road%20Package.pdf), estimate p.4, notes p.11.

The **Rocking Chair** timber-sale report provides a temporary-road assembly including clearing, excavation, drainage and eventual obliteration. Its selected 5.22-mile worksheet gives **USD $107,667 including profit**, then **$101,573** after its appraisal adjustment. No aggregate surfacing or bridge allowance appears on that sheet. A separate snow-plowing worksheet exposes equipment, operator, productivity and mobilization assumptions, including a workaround for repeated mobilization charges. Those records demonstrate why project cost and appraisal entries need distinct labels.

Source: [Rocking Chair SBA report](https://www.fs.usda.gov/sites/nfs/files/r01/helena-lewisclark/publication/timber-sales/20250530_RockingChairSBA_TSR.pdf), PDF pp.27 and 32.

## 3. Broader forest-road comparisons

These are original currencies and historical price bases. Their different work standards and evidence types make a pooled international average unhelpful.

| Setting and work | Published comparison | Price basis | Interpretation |
|---|---:|---|---|
| New Zealand spur road | **NZ$72,000/km mean; $10,000–150,000/km range** | 2018 survey | Managers' estimated average construction costs |
| New Zealand secondary road | **NZ$90,000/km mean; $35,000–150,000/km range** | 2018 survey | Different road class and traffic expectations |
| England commercial haulage road | **£50–300/m; approximately £100/m typical** | June 2023 prices | Expert range and model reference |
| England forwarder track | **£25–50/m** | June 2023 prices | Lower standard than a haulage road |
| Australian farm harvesting access | **A$18,000–25,000/km** | 2023 | Mostly flat or gently undulating farm terrain |

**New Zealand:** the survey covered 18 managers representing 426 km of annual new road construction. Respondents considered planning through drainage and surfacing. Its broad range reflects terrain, road standard, drainage and aggregate access; the range is not a confidence interval for a particular BC corridor. These are self-reported estimates, not audited final invoices.

Source: [Brown and Visser, 2018](https://forestengineering.org/wp-content/uploads/2021/01/Forest_Road_Tech_Review_Brown_and_Visser_NZJF_2018.pdf), printed p.24 / PDF p.2.

**England:** the report was published in 2025 but normalizes values to June 2023. The road figures exclude additional loading bays, turning areas, bell-mouth junctions and maintenance. An unambiguous unit is essential: uncertain ancillary rates were excluded from this extraction.

Source: [Forest Research, Woodland Establishment Costs in England](https://cdn.forestresearch.gov.uk/2024/05/Woodland_Establishment_Costs_Report.pdf), price basis p.14, roads p.44; [official publication list](https://www.forestresearch.gov.uk/staff/romain-thurin/).

**Australia:** the Green Triangle report concerns truck access across farm paddocks. Material access and haul strongly influence its range. It also asks whether extending a road costs less than forwarding timber farther: compare incremental road cost with additional forwarding cost per tonne multiplied by all timber served. That decision method transfers more readily than its road rate to mountainous BC.

Source: [Geddes Management / Green Triangle report, 2023](https://gtfih.com.au/wp-content/uploads/2023/07/Final-Report-Project-2-PIRSA-GTFIH-pdf-version.pdf), printed pp.45–48 / PDF pp.47–50.

## 4. Measured hours explain reconstruction costs

A 2024 New Zealand study recorded machine hours, applied representative hourly machine charges and used invoiced material costs. It normalized treatments to a **4.5 m road width** and extrapolated to cost per kilometre, **excluding GST**.

| Existing-road subgrade treatment | Diamond Hill, NZ$/km | Bridgeman, NZ$/km |
|---|---:|---:|
| Geogrid | $50,885 | $38,017 |
| Undercut and replace | $78,458 | $39,268 |
| Lime stabilization | $89,507 | $63,638 |

These are treatment costs, rather than complete new-road budgets. The lowest-cost geogrid treatment did not meet the wet-state design strength target at either site; none of the Bridgeman treatments reached it in the wettest condition. Aggregate choice and limited monitoring constrain interpretation. The lesson for PGMaps is to compare cost alongside the required performance and retain how the rate was calculated.

Source: [Hetherington, Evaluation of Subgrade Stabilisation Methods, 2024](https://fgr.nz/wp-content/uploads/2025/02/H071-Evaluation-of-Subgrade-stabilisation-methods-for-upgrading-historic-forest-roads.pdf), Tables 2–4, printed pp.26–29; discussion pp.30–32. Rounded display values above; original cents remain in the data.

## 5. Maintenance and funding are separate questions

### A repeatable maintenance calculation

Burnside's Norwich model uses a typical **7 m road**. Its gravel-application year is:

- Gravel: 400 tonnes × CAD $18/t = **$7,200**.
- Grading: 4 visits × 1.5 hours/km × $150/hour = **$900/km**.
- Dust control: **$1,160/km**.
- Total: **$9,260/km** in that year; **$2,060/km** in each of the other three years.

The four-year undiscounted arithmetic average is **$3,860/km/year**. That is our calculation for this limited maintenance program, not an all-inclusive road O&M rate. The gravel input is explicitly a 2023 cost. The 2024 report compares recurring work over 60 years, with stated inflation and discount assumptions.

Source: [Burnside, Norwich Gravel Road Summary](https://www.norwich.ca/media/hnbj4zux/delegation-burnside-roads-needs-study-gravel-road-review-memo-a.pdf), pp.7–9.

### Funding-model context

Indigenous Services Canada's O&M manual gives a **CAD $10,499.76/km/year Toronto-2023 base** for gravel roads, before location/remoteness factors. It covers a broader annual maintenance scope, including winter service. This is a Class D funding model, not a construction or tender rate.

Source: [ISC O&M cost reference manual](https://www.isc-sac.gc.ca/eng/1734037821474/1734037869905), sections 2–4, Table 1 D1B, Table 5.

Ireland's current **€66/m harvesting-road** and **€40/m upgrade/extension** figures are **grant ceilings excluding VAT**. They are preserved as funding context and are ineligible for price calibration.

Source: [Teagasc Forest Roads Scheme](https://teagasc.ie/crops/forestry/grants/forest-roads-scheme-2023-2027/), current grant table. Exact commencement of the €66 rate was not established; the current table was checked on the review date.

## 6. How the estimating approaches fit together

The following synthesis is a proposed PGMaps workflow drawn from the sources, with engineering assumptions retained for project review.

### A. Define the work and take off quantities

Start with new construction, reconstruction, maintenance or closure. Define running width, subgrade width, layer thickness, loaded-vehicle standard, existing condition and required service life. Then calculate quantities by material and operation: clearing area, stripping, common excavation, rock excavation, unsuitable material, fill, aggregate, drainage and structures.

A kilometre benchmark is most useful once those descriptors are available. A narrow temporary road on competent material, a maintained existing road and an all-weather road with structural crossings are different estimate objects.

### B. Build unit prices from resources where local bids are missing

For a consistent measured volume state:

**Unit cost = all-in crew cost per paid hour ÷ net production per paid hour.**

The hourly numerator should state whether it includes operator, fuel, maintenance, ownership, support equipment and supervision. The denominator must include the productivity losses appropriate to the work. Do not apply a delay factor again if the historical net production already includes it.

FAO develops activity-based road costs using machine rates and production, while NZFOA recommends historical machine-level records and comparison with completed work. FAO's 1992 example prices are retained as historical teaching material, not current unit rates.

Sources: [FAO road-cost method](https://www.fao.org/4/T0579E/t0579e06.htm), [machine-rate method](https://www.fao.org/4/t0579e/t0579e05.htm); [NZFOA machinery production](https://docs.nzfoa.org.nz/live/nz-forest-road-engineering-manual/5-road-and-landing-construction/5.9-estimating-machinery-production/).

### C. Model haul and material balance explicitly

For one truck on a consistent payable payload basis:

**Haul cost per payload unit = truck cost/hour × complete cycle hours ÷ payable payload.**

The cycle includes loading, loaded travel, unloading, empty return and queue time. Fleet output can be limited by loading or placement capacity, so multiplying a truck's theoretical output by truck count may overstate production. Those are modelling considerations, not new default rates.

Softree's published method separates material-dependent cut/fill costs, loading, distance-based haul, and borrow/waste locations. Its cost curves help select economical movements and equipment ranges. This illustrates why a nearby unsuitable source may be less useful than a farther suitable source and why loading should not be charged again when already included.

Source: [Softree Design Time Costing](https://support.softree.com/knowledge-base/optimization/design-time-cost-reporting/design-time-costing).

### D. Assemble the project budget

Use item costs plus explicit project allowances. For each allowance, record its basis and where it is applied: mobilization, source development, temporary access, traffic control, environmental work, engineering, overhead/profit, contingency, escalation and taxes as applicable. Unknown items remain visible and unpriced until a basis is established.

The purpose is to make omissions and overlaps reviewable. If a culvert assembly includes excavation and bedding, those components should not be added again elsewhere. If mobilization is shared across several work areas, its allocation should sum to the project allowance. Estimate-class labels from different organizations should retain their source definitions; a percentage contingency does not establish a statistical P80.

### E. Compare the whole ownership period where it matters

Construction cost is one decision input. For an access road used repeatedly, compare initial works, periodic resurfacing, routine maintenance, winter service, future closure and relevant timber-transport costs. Keep financial costs to the owner separate from wider economic benefits.

The World Bank's RED model supports economic comparison of low-volume-road investment and maintenance alternatives, incorporating traffic, road condition, seasonal conditions, user costs and sensitivity. It complements construction pricing rather than supplying a local unit-rate catalogue.

Source: [World Bank RED 4.0](https://datacatalog.worldbank.org/search/dataset/0065668/roads-economic-decision-model-version-4-0).

## 7. Recommended PGMaps catalogue behavior

I reviewed the current [cost-rate tools](https://github.com/ahzs645/PGMaps/blob/main/src/pages/dev-forestry-roads/costRateTools.ts), [quantity/cost documentation](https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/sections-quantities-and-costs.md), [full-cost alternatives](https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/full-cost-alternatives.md), and [cost evidence notes](https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/bc-cost-evidence.md).

The app already supports quantity × rate, explicit volume conversions, truck-cycle cost and crew-productivity cost. Its alternative comparison already accounts for physical source access, loaded/empty routes, material allocation, shared source capacities and several shared costs. Those existing tools provide the place to use better source evidence.

The most useful additions are:

1. **Source-linked observations.** Show original currency, price year, geography, cost status, work item, specification, quantity/sample size and scope. Separate source verification from suitability for the selected corridor.
2. **Complete estimate examples.** Let a user inspect the quantities, rates, allowances and total of a USFS or consultant example together. A single component should retain the parent estimate's scope.
3. **A visible inclusion record.** Identify supply, loading, haul, placement, compaction and project allowances as included, excluded, separate or unknown. Preserve the original wording when scope is unresolved.
4. **An explicit adoption step.** A user may select an observation, confirm specifications and adjust its currency/time/site basis before assigning it to a project input. Store the original observation alongside the adopted rate and adjustment rationale.
5. **Sensitivity and actual-cost feedback.** Vary uncertain rock quantities, unsuitable material, haul cycle, net production and aggregate source independently. Compare completed quantities, hours and invoices to the original assumptions for future calibration.

Keep the eight BC natural-resource regions as BC geography. Add external jurisdiction and work-type filters; do not assign overseas sources to BC appraisal road groups. A useful presentation for a quote-only supplier is **“Local quote required; comparable project evidence available.”** That gives users more information without misrepresenting a public price list.

## 8. Data boundaries and quality control

The package contains:

- `catalogue-records.json`: 53 normalized observations; source fields and original selected observations retained.
- `source-register.json`: 13 numerical sources plus five methods references.
- `worked-estimates.json`: eight worked examples/budgets, with overlap and derived calculations identified.
- `estimating-methods.json`: methods and proposed PGMaps interpretation.
- `catalogue-schema.json`: a research schema for review, not an existing app import contract.
- `catalogue-preview.md`: all selected observations in a readable table.
- `pgmaps-review.json`: inspected file URLs and blob identifiers.
- `corrections.json`: the earlier BC Masset record's geographic correction.
- `validation-summary.json` and checksums: source links, identifiers, currencies, arithmetic and interpretation checks.

Checks reconcile the USFS assemblies and Canadian selected rate extensions, allowing published rounding for tender averages. They preserve source inconsistencies instead of rewriting historical evidence. No full source publications are redistributed.

The previous BC project-evidence package has been corrected: **Masset/Haida Gwaii belongs to the West Coast natural-resource region**, rather than Skeena. This corrects the research tag and does not assign a timber supply area, supply block or appraisal road group. Source: [BC West Coast regional description](https://www2.gov.bc.ca/gov/content/environment/natural-resource-stewardship/cumulative-effects-framework/regional-assessments/west-coast).

The remaining market gap is a sufficiently detailed set of current BC accepted forestry-road schedules and final accounts, matched to geometry, terrain and haul. External evidence improves comparison and estimation structure; local quantities, quotes and production records still determine the project estimate.
