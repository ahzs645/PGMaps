# Old forest (Objective A) and old interior forest (Objective B) under the Prince George order

Research for the block planner, 23 November 2026. The eight questions at the end were decided on 24 November 2026 and the calculation built: see [Old and old interior forest in the block planner](../forestry-old-forest.md). This note records what the order defines, which public data could compute A and B, how the province and the Forest Practices Board have done it, and the decisions that belong to the owner before any of it is built.

**Short answer.** A and B can be computed from public data, except the Crown Forest Land Base (CFLB), which has no public layer for the TSA and needs a proxy or a reviewer's figure. The order's Map 2 units, which the planner had treated as unavailable, are public GIS on DataBC; the planner already reads the same layer for the Objective C reporting unit (`orderUnits.ts`).

## What the order defines

From the 2004 order and its implementation policy revised December 2005 (one PDF of 25 pages: the order on pp. 1–13, the policy on pp. 14–25).

| Item                       | Definition                                                                                                                                                                                                                                                                                                                                                                                                             | Where                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Objective A                | Old forest as a minimum percentage of the CFLB in each merged BEC (mBEC) unit on Map 2                                                                                                                                                                                                                                                                                                                                 | Order p. 7, Table 3              |
| Objective B                | Old interior forest as a percentage of the old forest **required** under A, not of all old forest                                                                                                                                                                                                                                                                                                                      | Order p. 10, Table 6             |
| Old forest                 | Stands older than 140 years "from available forest inventory sources"; older than 120 years in Moist Interior–Plateau (all variants), Omineca Valley SBSdk, SBSdw3, BWBSdk1, SBSmc2 and SBSmk1, and McGregor Plateau SBSmk1 and SBSmh. The ICH definition "requires more discussion" and was never settled                                                                                                             | Policy p. 1 (PDF p. 14)          |
| Natural Forest Areas (NFA) | Old stands killed or partly killed by mountain pine beetle count as old. Tables 8–10 set a minimum share of CFLB that must be old and not pine-leading                                                                                                                                                                                                                                                                 | Policy p. 3 (PDF pp. 16–17)      |
| Old interior forest (2005) | Old forest or NFA buffered inward by 200 m where the neighbour is NSR or age class 1–3 (60 years or less) and pine- or deciduous-leading, or NSR or age class 1–4 (80 years or less) with any other leading species; 0 m next to older classes "as long as area is >200 m wide"; 200 m from primary roads (FSRs), pipelines, railways and hydro corridors, none for secondary or tertiary roads. No minimum patch size | Policy pp. 2, 7 (PDF pp. 15, 20) |
| Old interior forest (2004) | The original method buffered 200 m against anything younger than the old-forest age                                                                                                                                                                                                                                                                                                                                    | Policy p. 6 (PDF p. 19)          |
| CFLB                       | Provincial Crown forested land, contributing and non-contributing; excludes private, federal and municipal land and woodlots. The order also excludes TFLs and community forests                                                                                                                                                                                                                                       | Policy p. 1; order p. 2          |
| What counts (D.1–D.4)      | D.1: the whole area of OGMAs made before the order, and later spatial retention areas, count toward A and B; parks _may_ count. D.2: units may be combined across districts. D.3: a representative share of epidemic-affected stands, with non-pine required. D.4: up to 20% younger stands, only where equal or better conservation benefit is shown                                                                  | Order p. 12                      |
| D.5(a)                     | Where A or B cannot be achieved, a recruitment strategy submitted to and approved by the minister's designate                                                                                                                                                                                                                                                                                                          | Order p. 12                      |

## Data

| Need                     | Source                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map 2 units              | `WHSE_LAND_USE_PLANNING.RMP_PLAN_LEGAL_POLY_SVW` filtered on the order's plan name: 1,930 polygons, legalised 2004-10-20. `LEGAL_FEAT_ATRB_n` pairs hold BECLABEL, NDZ_NAME, ORG_CODE (DPG, DJA, DVA), ORG_NAME, UNIT_IDENT (A1…, D1…, E1…), NDZ_SUB and OLD_RETEN (a fraction). No interior percentage field                                                                                                                       |
| Stand age and type       | VRI rank 1, `WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY`: `PROJ_AGE_1`, `PROJ_AGE_CLASS_CD_1`, `PROJECTED_DATE` (now 2025-12-31), `REFERENCE_YEAR`, `HARVEST_DATE`, `OPENING_IND`, `BCLCS_LEVEL_1/2`, `FOR_MGMT_LAND_BASE_IND`, `SPECIES_CD_1`, `SPECIES_PCT_1`, `STAND_PERCENTAGE_DEAD`, `EARLIEST_NONLOGGING_DIST_TYPE/_DATE`, `BEC_ZONE_CODE/BEC_SUBZONE/BEC_VARIANT`                                                           |
| OGMAs                    | `RMP_OGMA_LEGAL_CURRENT_SVW` (`LEGALIZATION_FRPA_DATE`) and `RMP_OGMA_NON_LEGAL_CURRENT_SVW` (`ORIGINAL_DECISION_DATE`)                                                                                                                                                                                                                                                                                                             |
| Parks                    | `WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW`                                                                                                                                                                                                                                                                                                                                                                                               |
| Ownership and exclusions | `WHSE_FOREST_VEGETATION.F_OWN`, `WHSE_FOREST_TENURE.FTEN_MANAGED_LICENCE_POLY_SVW` (woodlots, community forests), `WHSE_ADMIN_BOUNDARIES.FADM_TFL_ALL_SP`                                                                                                                                                                                                                                                                           |
| Disturbance              | Consolidated cutblocks and historical fire perimeters, already read by the planner (`baselineImport.ts`)                                                                                                                                                                                                                                                                                                                            |
| Linear corridors         | `FTEN_ROAD_SECTION_LINES_SVW` (FSRs), `GBA_RAILWAY_TRACKS_SP`, `GBA_TRANSMISSION_LINES_SP`, `OG_PIPELINE_AREA_PERMIT_SP`                                                                                                                                                                                                                                                                                                            |
| CFLB                     | No public layer for the TSA. FAIB's TSR THLB compilation (`prov_THLB_tsas.gdb.zip`, about 1 GB, Access Only) and the provincial proxy AFLB/THLB are file geodatabases unsuited to browser reads; a bcdatamapper cut by mBEC would serve. A proxy is VRI treed with `FOR_MGMT_LAND_BASE_IND = 'Y'` on Crown land less the excluded tenures, calibrated against the Board's CFLB figures (A3: 67,077 ha CFLB against 96,996 ha gross) |

The Map 2 layer checked against the planner's A units agrees everywhere except **A10, where the GIS holds 0.12 and the order and the Board say 17%**. It also settles printed typos: A2 is ESSFwc3; A5 is ESSFmv1, mv3 and wk2; A13 is tagged Moist Interior–Plateau and Omineca _Valley_, not Mountain. Alpine units have a blank UNIT_IDENT and 0.

## How others did it

- **TSR data package, April 2015.** mBECs are an LOWG custom dataset (2014, p. 27). Old forest is a cover constraint with ages and non-pine shares per unit (Table 28, pp. 49–51); NFAs count as old until regenerated and harvested. The A4 recruitment strategy approved December 2014 uses spatial "landscape biodiversity areas" that meet 72% of 59,208 ha, leaving 16,578 ha aspatial (p. 52). Interior forest was not modelled, only reported at years 0, 5, 10, 20, 30 and 40.
- **2017 AAC rationale** (pp. 35–36). Retain non-contributing old first, then THLB old, then recruit mature stands oldest first. Interior forest was handled by sensitivity runs only.
- **Forest Practices Board, IRC/235.** 2019 deficits in A4 and A24 (5,352 ha); six non-spatial and one spatial recruitment strategies approved 2012–14 over four mBECs (p. 6). VRI age is unreliable and VRI versions differ across the TSA (pp. 10–11). A4's non-legal OGMAs include stands that are not old (p. 12). The LLOWG computes A and B every year from licensee harvest, road and retention data (p. 18).
- **Castor** (bcgov) uses percent-of-zone cover constraints, as the TSR did. No public SELES or CHASE work for this order was found.

## Pitfalls

- **Age in a year.** Age in year Y is `PROJ_AGE_1 + (Y − year(PROJECTED_DATE))`. VRI ages are already projected: never age again from `REFERENCE_YEAR`. Reset a stand whose `HARVEST_DATE` falls after the projection.
- **Thresholds are strict.** Older than 120 or 140, not equal to.
- **VRI reliability.** Age is a polygon average from mixed inventory vintages; the Board says age alone overstates old-forest quality.
- **Boundaries.** Use the legal units, never the current BEC map, whose lines have moved. Before mid-2005 the units lay in different districts.
- **A3 and A13.** Both SBSmk1 but separate units in the GIS and the Board's tables; the "combined with A13" note is D.2 pooling, done only by the reviewer's choice so no area counts twice.
- **D.1 double counting.** OGMAs and parks overlap each other and old VRI. Union them, count old area once and report "of which in OGMA or park". D.1 counts the whole area of pre-order OGMAs even where young.
- **Interior width.** The 0 m rule's "more than 200 m wide" needs a width test, such as the old patch's inward 100 m buffer being non-empty.
- **Size.** A whole unit is too many VRI polygons for the browser (A13 is about 545,000 ha gross). Read only the units a plan touches, or take pre-aggregated unit tables from bcdatamapper.

## Recommended design

Reads bounded to the plan's area, each through `fetch` passed in and kept DOM-free, as the Objective C reads are: Map 2 units; VRI with a narrow `propertyName` and the box in `CQL_FILTER` longitude first; OGMAs, parks, ownership and the tenure exclusions; FSRs, rail, transmission and pipelines.

Per unit and per projection year:

1. The CFLB area (proxy, or the reviewer's figure).
2. Each VRI polygon aged to the year. A schedule's block resets it to 0 in its cut year as stand-replacing; a partial cut is the reviewer's choice.
3. Old: older than the unit's threshold, or an NFA.
4. Interior: old less a 200 m inward buffer from young neighbours (60 years or less pine or deciduous, 80 years or less any other leading species), new blocks and primary linear features, with the width rule.
5. Set beside CFLB × A% and that × B%: surplus or deficit, and the first year in deficit.
6. The non-pine-leading share against Tables 8–10.

The reviewer's, never the model's: the CFLB figure or its calibration; whether parks count; D.2 and A3/A13 pooling; D.3 representativeness; D.4's 20% with its benefit statement; the ICH age; whether recruitment areas exist; the D.5(a) determination. Every figure prints "VRI age-based, not field-verified", and the Board's 2019 A and B figures stay a separate series, as the 2015 and 2018 C figures do.

## Open questions for the owner (decided 24 November 2026; see the guide's **Decisions**)

1. Which A10 value is authoritative: 17% (order, Board) or 0.12 (GIS)?
2. Which CFLB source: the VRI proxy, FAIB's AFLB/THLB through bcdatamapper, or a figure the reviewer enters?
3. Are NFAs old for ever, or only until harvested?
4. Should the planner offer an ICH old-forest age at all?
5. Should A3 and A13 be pooled by default, or never?
6. Model the 2005 interior method, the 2004 one, or both?
7. Should approved recruitment strategies (A4 and the other six) be importable as spatial "counts as old" areas?
8. May a computed deficit year prefill anything in the D.5(a) review, or is it display only?

## Sources

[2004 order and December 2005 policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf) · [Forest Practices Board, IRC/235](https://www.bcfpb.ca/wp-content/uploads/2021/05/IRC235-PG-TSA-Biodiversity.pdf) · [Prince George TSA data package, April 2015](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/tsr-annual-allowable-cut/prince_george_tsa_data_package.pdf) · [2017 AAC rationale](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/tsr-annual-allowable-cut/prince_george_tsa_rationale_2017.pdf) · [Legal Planning Objectives – Current – Polygon](https://catalogue.data.gov.bc.ca/dataset/2c02040c-d7c5-4960-8d04-dea01d6d3e9f) · [Castor](https://github.com/bcgov/castor)
