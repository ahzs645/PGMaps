# BC road-cost data review for PGMaps

**Reviewed 12 November 2026. All prices are recorded in CAD.**

Repository reviewed: [ahzs645/PGMaps](https://github.com/ahzs645/PGMaps), main commit [55255522c950e2313bf6281bece5d0ca54045110](https://github.com/ahzs645/PGMaps/commit/55255522c950e2313bf6281bece5d0ca54045110).

This research package contains **42 local numeric records: 38 supplier material/trucking records from 12 suppliers, plus four supplementary municipal records**. It also provides official appraisal references, six quote-only supplier leads, and geographic data sources for the panel's missing inputs. Coverage spans all eight natural resource regions. Comparable public construction-aggregate prices remain unverified for Cariboo and Skeena; their municipal records do not fill that gap.

The deliverable is evidence for reviewed comparisons and scoped estimates. It is not a statistical survey of regional prices, a set of contractor quotations, or an implementation of every appraisal rule.

## 1. What was established

- The existing panel's **2026 Interior Appraisal Manual, effective July 1, 2026, with a 2024 cost base**, is supported by the primary PDF. Search results initially exposed older editions; direct current-source retrieval resolved the difference.
- Six additional numeric supplier sources improve the existing catalogue: **Cantex, Grizzly, Ronin, Michael Oviatt, Kel-Mor and Sullivan Stone**. Sullivan's undated list explicitly says its 2026 prices are forthcoming, so it is retained as stale evidence.
- The official material supports separate **stabilization, drainage, equipment and labour comparisons**, alongside the subgrade/construction comparisons already implemented.
- The monthly Hired Equipment Program fuel page now publishes **November 2026** values. Its program is distinct from the Interior manual's appraisal fuel allowances.
- A mapped TSA/supply block and a BEC polygon can help populate reviewed context. Rock content and absolute soil moisture cannot be inferred reliably from a natural resource region name.

## 2. Local evidence across the eight regions

Prices below are base amounts as published. Read the date, fee and delivery conditions together with the number.

| Region | Useful source evidence | Date, scope and remaining gap |
|---|---|---|
| **Cariboo** | [United Concrete & Gravel](https://www.unitedconcrete.ca/gravel) lists construction products at Quesnel, Williams Lake and 100 Mile House. [93 Mile Aggregates](https://93mileaggregates.ca/products/) adds a 100 Mile House supplier lead. | Neither reviewed product page provided a usable numeric construction-price list. Retain a quote-required status. |
| **Kootenay-Boundary** | [Sullivan Stone, Creston](https://sullivanstonecreston.ca/landscaping-2/): 3/4-inch road crush **$40 per source-listed yard**. [BC Eco, Nelson/Castlegar/Crescent Valley](https://bceco.ca/news/company-news-and-events/tandem-dump-truck-loads-of-road-gravel-for-sale/): **$253.50 per advertised 10-yard load**. | Sullivan is undated and says “2026 pricing coming soon.” BC Eco is an undated, limited-stock promotion with delivery extra. Neither is a confirmed current bulk forestry quote. |
| **Northeast** | [DRS Energy Services, Fort St. John](https://www.drsenergy.ca/products): 3/4-inch minus **$16/t**, pit run **$12.25/t**, 1.5-inch minus **$13.40/t**, 2-inch minus **$13.35/t**. | Public material list; effective date and loading, tax and delivery inclusions are unspecified. |
| **Omineca** | [GetGravel, Prince George](https://getgravel.com/products): 3/4-inch road crush **$49.99/yd³**, sandy fill **$14.99/yd³**. | Undated retail yard prices, loaded into the customer's vehicle, before tax. Page currently announces winter closure and earliest spring pickup/delivery April 20, 2027. This availability notice is not a dated 2027 price guarantee. |
| **Skeena** | [JL's Excavating, Terrace](https://jlsexcavatingltd.com/our-aggregates/) adds a useful product/specification lead to Skeena Concrete and Steti. | No comparable public numeric construction-aggregate list was established. Keep quote-required status; retain municipal access fees separately. |
| **Thompson-Okanagan** | [Cantex, Summerland](https://www.cantexcrushing.com/gravel-pit-summerland/): 3/4-inch MMCD minus **$15.38/t retail**, **$14.25/t contractor**. [Grizzly, Penticton](https://grizzlyex.com/wp-content/uploads/2026/04/AGGREGATE-PRICE-LIST-GREEN-MTN-ROAD-FACILITY-2026-1.pdf): 19 mm minus **$16.95/t**. [Skwlāx, Chase](https://www.skwlaxaggregates.com/wp-content/uploads/2026/10/Skwlax-Aggregates-Price-List.pdf): 25 mm WGB **$13/t**. | Cantex and Grizzly effective April 1, 2026; Skwlāx August 25, 2026. Loading, minimum purchases, freight and surcharges differ—see conditions below. |
| **South Coast** | [Kel-Mor, Chilliwack](https://www.kelmor.ca/product-page/3-4-inch-road-base-19mm): road base **$14.75/t**. [Stockwell, Sechelt](https://www.stockwellgravel.ca/pricing/): MMCD road base **$27/t**, structural fill sand **$13/t**. | Kel-Mor is undated. Stockwell effective January 1, 2025, adds **$0.75/t environmental fee** plus tax. Its road base is delivery-only; the sand is not marked delivery-only. |
| **West Coast** | [Ronin, Cowichan/Greater Victoria](https://roninearthworks.ca/rates): road base **$17.60/t**. [Michael Oviatt, Campbell River](https://www.michaeloviatttrucking.com/aggregate-supplied): 19 mm road crush **$19.99/t**. [Sharecost, Nanaimo](https://sharecost.ca/bulk/base-fill-materials/road-base-34-mot-spec): road base **$33/t**, minimum 12 t. | Ronin effective July 18, 2026; material at pit, haul separate. Oviatt labels its list 2026 and adds **10% fuel surcharge**. Sharecost is undated and charges delivery separately. |

### Commercial conditions that change the comparison

**Cantex:** Prices are FOB Summerland pit, loaded into the customer's truck. Delivery and applicable taxes are additional. Contractor qualification requires confirmation. The price for 75 mm minus is $15.27/t retail; pit run is $9.23/t retail.

**Grizzly:** Its current 2026 sheet supersedes the indexed 2025 sheet. Aggregate purchases have a $55/load minimum. That minimum does not establish a minimum charge for the separately listed $145/hour tandem truck. Truck/operator/fuel terms need confirmation.

**Skwlāx:** The list separately identifies a $10 loading fee with the unit written simply as “Unit”; do not infer per tonne or per load. Tandem trucking is $160/hour with a variable monthly fuel surcharge. Material, loading and trucking are distinct components.

**Ronin:** The $145/hour tandem rate includes truck, fuel and operator, with portal-to-portal billing. The listed 13–14 t capacity does not guarantee that payload on a particular corridor.

**Oviatt:** Retain its explicit tonne figures rather than deriving densities from its paired yard figures. The page's specification wording is “MMDC”; this review does not certify compliance with MMCD. Minimum/load-fee wording requires supplier clarification.

**Kel-Mor:** The storefront's headline $2 price is a bucket quantity. The tonne price is $14.75. Loader service is complimentary for orders over $30; smaller self-load quantities and delivered orders have different terms.

These conditions are stored per record so a material fee cannot become an hourly trucking surcharge accidentally.

### Supplementary Cariboo and Skeena records

These records add local evidence but belong outside an ordinary road-base price comparison.

| Record | Published amount | Permitted interpretation |
|---|---:|---|
| Williams Lake winter sand, Peterson Contracting award, July 14, 2026 | **$34.86/m³**, excluding applicable taxes/GST | A winter-maintenance purchase; council highlights describe approximately 1,500 m³. Delivery terms are not established by the cited minutes. |
| Williams Lake dried bulk highway salt, first contract year | **$275.80/t**, including applicable taxes | Maintenance-contract evidence; not construction aggregate. |
| New Hazelton municipal access gravel, Bylaw 393 | **$147/load** | Freight/taxes/GST included, with an additional 10% administration charge. Load volume and grading are unspecified. |
| New Hazelton access culvert, described as 400 mm / 15 inch | **$85.50/m** | Same inclusion/admin terms; material, gauge and installation scope are unspecified. The source's nominal metric/imperial wording is preserved rather than treated as exact conversion. |

Sources: [Williams Lake council minutes, resolutions 256/26 and 257/26](https://williamslake.civicweb.net/document/185157), [council highlights](https://williamslake.ca/m/newsflash/Home/Detail/985), [New Hazelton Bylaw 393, Access table on printed page 7](https://newhazelton.ca/wp-content/uploads/2026/09/BL-393-Fees-and-Charges-Bylaw.pdf).

## 3. What the appraisal allowances include

The most useful improvement to the panel is a visible scope comparison. A lower number can simply cover fewer activities.

| Reference | Included work | Separate or excluded work |
|---|---|---|
| **Interior tabular subgrade** | Clearing, grubbing, stripping, debris/stump disposal, ditches, turnouts, qualifying small culverts and eligible equipment transport. | Right-of-way tree felling/logging, blasting and landings; additional stabilization and larger structures need separate treatment. |
| **Interior additional stabilization** | Borrow preparation, loosening, loading, hauling, spreading and compaction. | Borrow-pit blasting and a new borrow-access road; special processed/geosynthetic work follows other procedures. |
| **Coast tabular road construction** | Subgrade and associated ballast/stabilization, landings/turnouts and the work represented by the selected rock category. | Culverts and bridges; eligible additional stabilization haul beyond 3.2 km and work outside tabular conditions. |
| **Supplier material list** | The named product and only the explicitly stated supply/loading service. | Unstated delivery, placement, compaction and other road works. |

Primary sources: [Interior Appraisal Manual, sections 4.3.2–4.3.4](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf), [Coast Appraisal Manual, section 5.3](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/coast-appraisal-manual/cam_2026_master.pdf), and [official Coast road-development training](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/coast-appraisal-data-submissions/appraisal-training-modules/module_5_development_cost.pdf).

### Additional official values worth exposing

The accompanying appraisal JSON preserves the published coefficients and example tables, with edition and scope.

- **Interior stabilization:** Cariboo candidate groups 4, 8 and 12 have base allowances of **$24,910/km**, **$28,260/km** and **$35,760/km**. Eligible ripped/quarry rock adds **$4,277/km**. The 2026 equation has a zero coefficient for haul distance; actual hauling still costs money in a project estimate.
- **Interior culverts, 12 m long:** 0.95 m diameter **$4,405 installed**; 1.20 m **$6,728**; 1.80 m **$14,525**. Part A is a structure total; Part B is a supply/delivery rate per metre. They are alternatives, not additive parts. Culverts below 950 mm are already included in ordinary tabular subgrade.
- **Coast road categories:** Local-ballast OMLB is **$72,601/km**; hard-rock MRK **$144,177/km**. The source includes eight categories, distinct additions and eligibility conditions. These are bundled comparisons.
- **Coast culverts:** Column A includes materials and installation; Column B is the materials-only alternative for applicable non-tabular calculations. Do not add B to A.
- **Equipment:** Published Interior base rates include excavator class 2 **$238.95/h**, dozer class 4 **$270.75/h**, gravel loader class 10 **$268.75/h**, dump truck 10.7 m³ **$170.45/h**, and grader class 6 **$214.85/h**. These use the manual's 2024–2025 Blue Book basis. All-found operator/benefit costs must not be added again.

The official [Interior ECE page](https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/interior-timber-pricing/interior-ece) also publishes July 2026 workbooks for bridges, road reactivation, portable platforms and support-centre distance. Exact links are in the JSON. The links were verified; workbook calculations were not audited.

### Two different fuel references

| Scheme | On-road addition | Off-road addition | Basis |
|---|---:|---:|---|
| Interior Appraisal Manual, July 2026 Appendix I | $10.23/hour | $23.86/hour | Appraisal equipment methodology |
| Transportation Hired Equipment Program, November 2026 | $26.10/hour | $60.90/hour | Program's current monthly adjustment |

The current monthly page was updated November 2, 2026 and uses October's average fuel price. These schemes must remain independently labelled. A fuel-inclusive supplier truck quote such as Ronin's is not a reason to add either supplement.

Sources: [IAM Appendix I](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf), [Hired Equipment Program](https://www2.gov.bc.ca/gov/content/industry/construction-industry/transportation-infrastructure/hired-equipment-program/fuel-price-adjustment).

## 4. Data that can help fill the panel's inputs

| Panel field | Source or method | Required boundary |
|---|---|---|
| TSA and supply block | [FADM TSA/TSB service](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/557), with TSA_NUMBER and TSB_NUMBER | Intersect the whole relevant road section. Resolve TFL exceptions and jurisdiction; a region dropdown alone is insufficient. |
| BEC zone | [Provincial BEC service](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/38), with zone/subzone/variant/phase | Offer mapped context for review, retain provenance and boundary conflicts. |
| Uphill side slope | Existing road geometry and terrain cross-sections | Measure across the hillside. Road grade runs along the road and is a different quantity. |
| Absolute soil moisture | Site evidence and the selected manual's classification/conversion rules | A broad BEC zone is not a measured moisture condition. |
| Section rock and terrain stability | Field/engineering evidence | Do not populate from region, a generic soil map or a visual terrain texture. |
| Road type, width, existing-road status, end haul and overland work | Reviewed road design and construction method | Keep applicability checks separate from geographic context. |

Both inspected geographic services support GeoJSON/pagination and advertise a 1,000-record response limit. This review checked metadata, not application CORS, corridor queries or provincial extraction completeness. Preserve source IDs, versions, extents and retrieval date. Split a road into appropriate sections when conditions or source boundaries change.

## 5. Practical PGMaps changes supported by this research

The relevant current files are:

- [bcCostReferences.ts](https://github.com/ahzs645/PGMaps/blob/55255522c950e2313bf6281bece5d0ca54045110/src/pages/dev-forestry-roads/bcCostReferences.ts): supplier catalogue and one global reviewed date.
- [BCCostReferencesPanel.tsx](https://github.com/ahzs645/PGMaps/blob/55255522c950e2313bf6281bece5d0ca54045110/src/pages/dev-forestry-roads/BCCostReferencesPanel.tsx): region/source presentation.
- [bcInteriorCost.ts](https://github.com/ahzs645/PGMaps/blob/55255522c950e2313bf6281bece5d0ca54045110/src/pages/dev-forestry-roads/bcInteriorCost.ts) and [bcCoastCost.ts](https://github.com/ahzs645/PGMaps/blob/55255522c950e2313bf6281bece5d0ca54045110/src/pages/dev-forestry-roads/bcCoastCost.ts): existing independent comparisons.
- [bc-cost-evidence.md](https://github.com/ahzs645/PGMaps/blob/55255522c950e2313bf6281bece5d0ca54045110/docs/forestry-road-design/bc-cost-evidence.md): current evidence and estimation guide.

Recommended implementation sequence:

1. **Refresh the evidence catalogue.** Add the six new supplier sources, preserve the older dates and promotions, show seasonal availability, and update the monthly fuel reference.
2. **Store numbers and scope separately.** Use amount, currency, source unit, price tier, effective date, check date, tax, loading, delivery, minimum, surcharge, locality and source fields. Keep quoted gaps as null.
3. **Expose a scope table.** Make overlapping and separately costed activities visible beside each comparison. A source name alone does not establish what the number covers.
4. **Add independently reviewed official component comparisons.** Stabilization and culvert examples are the strongest immediate additions; bridges/reactivation should follow a review of the official workbooks and full rules.
5. **Offer geographic suggestions.** Use TSA/TSB and BEC data as sourced suggestions with reviewer acceptance. Preserve the current distinction between comparison records and project rates.
6. **Save provenance with any adopted project rate.** If a user later applies a quote-derived unit rate, retain the quote and its conversions, source revision, included work and manual acceptance.

The delivered JSON is research data with explicit comparison-only flags; it is not a drop-in executable pricing module. No project estimate or repository source was changed in this research pass.

### Unit conversion and quote collection

Keep bank excavation, purchased loose material, compacted fill and mass distinct:

- A tonne price becomes CAD per compacted m³ only with a project-supported tonnes-per-compacted-m³ factor.
- A yard price can be converted geometrically to purchased m³, but compaction still requires a separate factor.
- An hourly truck price needs a complete cycle and a realistic payload before becoming a haul cost per quantity.
- Equipment cost per excavated m³ depends on a supported net production rate.

For a usable construction quote, collect product grading/specification, supply location, corridor destination, quantity/volume tier, dated validity, tax, loading, fuel, haul, placement/compaction, payload/access restrictions and any disposal or pit-development items. These are the unresolved inputs behind the current Cariboo and Skeena gaps.

## 6. Other evidence sources and limits

The provincial [Transportation Project Cost Estimating page](https://www2.gov.bc.ca/gov/content/transportation/transportation-infrastructure/transportation-planning/cost-estimating) identifies a restricted construction-cost database for consultants providing estimating services to the ministry. It should not be represented as an openly downloadable provincial unit-price dataset.

Public tender awards can support later calibration only when accompanied by scope, measured quantities, contract inclusions, date and final changes. A lump-sum award alone is not a transferable unit rate.

The January 2026 Coast master was verified directly, including the cited values. The manual's index was inaccessible during review, so this package does not establish that no later amendment exists. Supplier listings remain subject to change. No supplier was contacted.

## 7. Files and validation

| File | Contents |
|---|---|
| bc-local-cost-evidence.csv / .json | 42 priced records, original units and commercial conditions; JSON also retains six quote-only sources and rejected/historical leads |
| bc-appraisal-reference-data.json | Official scope matrix, 11 Interior subgrade equations, stabilization constants, Coast categories, selected culvert/equipment/labour values, fuel rules and workbook links |
| bc-monthly-fuel-reference.json | November 2026 Hired Equipment Program figures, independently labelled |
| bc-region-coverage.csv / .json | Eight-region coverage and unresolved gaps |
| bc-geographic-source-catalogue.json | TSA/TSB and BEC service metadata and suggested integration boundaries |
| bc-source-register.csv | 24 priced, official, geographic and data-access source entries; quote-only sources also remain in the local JSON |
| validation-summary.json | Counts, reviewed commit and completed data-integrity checks |

Validation covered JSON parsing, positive finite numeric values, unique record IDs, units, eight-region coverage, null prices for quote gaps and comparison-only flags. Primary values and key PDF tables were checked. A second review corrected inherited material minimums on truck rows and the distinction between Coast culvert material-plus-installation and materials-only columns. Application behavior and official workbook formulas were outside this research pass.

