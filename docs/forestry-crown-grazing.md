# Crown grazing, agriculture reserve areas and reforestation in the block planner

Step 5's **Crown grazing and reforestation** section asks whether a block on grazing land, or in one of the 2006 Omineca agriculture development areas (ADAs) or settlement reserve areas (SRAs), can be cut. The test is that the stand must come back. The rules are the `bc.crown-grazing` pack (`packages/legal-rules/instruments/bc-crown-grazing.json`, `rules/bc/crown-grazing.json`). The record is `RangeReview` (`review/rangeReview.ts`), kept for one block in one schedule.

The record is keyed to the schedule's resolved shape and harvest year. If either changes, the old answers are shown as out of date and fresh ones are asked for. A schedule with no planned harvest can review silviculture on an existing opening; record the original harvest and its dates in the evidence.

Every answer is the reviewer's. The planner never says a block complies, that the order applies, or that an exemption is met. It explains which provisions the answers engage and what each one requires.

## The chain, provision by provision

This is why a block that cannot be reforested should not be cut. Each step was read from the primary text (below).

1. **The free-growing duty.** FRPA §29(0.1)–(3) applies to whoever harvests under a forest stewardship plan, a forest operations plan or a woodlot licence plan. That holder must establish a free-growing stand on the cutblock's net area to be reforested. FPPR §44(1) sets the deadlines: the plan's stocking standard by its regeneration date, and a free-growing stand within 20 years.
2. **The only relief is a restricted harvest.** FPPR §44(3) lifts the duty only where harvesting is restricted to purposes it lists:
   - (a) a safety hazard;
   - (b) seed collection, with an opening of 1 ha at most;
   - (c) removing felled trees from landings and rights of way;
   - (d) land that is, or will be, used exclusively for hay or grazing under a Range Act agreement;
   - (e) experimental harvesting;
   - (f) recreation sites and trails;
   - (g) pest-entrapment trees;
   - (h) commercial thinning, removal of individual trees or similar intermediate cutting;
   - (i) special forest products.

   For (h) and (i), §44(4) requires the plan's §16(4) stocking standard to be met for 12 months after harvest. A clearcut of beetle-killed timber is none of these.

3. **A grazing lease is not Crown range.** The Range Act's "Crown range" excludes Crown land leased under the Land Act (§1), and §3 grants grazing and hay rights only over Crown range. So §44(3)(d) cannot rest on a Land Act grazing lease. Seasonal grazing on land also managed for timber is not exclusive use either.
4. **The 2006 order limits harvest in ADAs and SRAs.** It was made under Land Act §93.4 for the Fort St. James, Vanderhoof, Prince George and Mackenzie forest districts, and signed on 21 November 2006. It manages timber there only under:
   - Part A: environmental or safety harvests proposed by government, agreed by the forests and agriculture ministries, under an operational work plan;
   - Part B: forest-health harvests, with "a clear indication" that sanitation harvesting will significantly assist in preventing spread to adjacent stands;
   - Part E: deviations the agriculture ministry determines.

   Part D adds that no area-based forest tenure will be established in these areas. Part II limits the order to Crown land and leaves alone the permits, licences, areas and range schedules in effect when it took effect.

5. **A Part B harvest cannot be planted.** Every Part C condition applies to a Part B harvest:
   - C.1: dead or infested timber only;
   - C.2: stumps at least 15 cm;
   - C.3: waste piled and burned or removed;
   - C.4: permanent access minimized and placed along lot lines and natural boundaries;
   - C.5: "No activities related to site preparation and artificial regeneration";
   - C.6: every proposal referred to the agriculture ministry.
6. **So the stand must come back by itself.** If natural regeneration will not meet the stocking standard by its regeneration date, the duty in step 1 cannot be met. That happens when grass and shrubs win, cattle browse and trample the seedlings, or there is no seed source. On those answers the block cannot be both harvested under Part B and reforested.

   The finding (`cannot-reforest-ada-sra`) lists the ways forward:
   - change the footprint or prescription;
   - leave the block out;
   - show that natural regeneration will meet the standard;
   - check whether removing individual dead trees from a living stand is an intermediate cut under §44(3)(h);
   - ask the agriculture ministry about a Part E deviation that allows planting.

7. **The forest plan carries the order too.** A plan that adopts the order binds its holder through FRPA §20.22, as BCTS Prince George's FSP does (below). A plan's own extra commitments bind the same way.

Next to that chain, the pack reviews the grazing tenures the work touches:

- the lease's terms and the grazing policy's review with the lessee;
- the Range Act agreement and its approved range plan (FRPA §§32–35);
- range developments, which need the minister's written authorization (FRPA §51);
- natural range barriers (FRPA §48), with the measure an FSP must specify (FPPR §18).

## Land Act reserves and designated use areas

A block can sit in a Land Act designation instead of, or as well as, a lease or an ADA. Tantalis records three kinds, by the subtypes the 2021 Crown land policy lists (§3): a §15 reserve (`SEC 15 OIC RESERVE`), a §16 withdrawal from disposition (`SEC 16 MAP RESERVE`) and a §17 conditional withdrawal (`SEC 17 DESIGNATED USE AREA`). A §17 designation for agriculture and grazing is the common case on range.

- **What §17 does.** The minister may designate Crown land "for a particular use" (§17(1)) and "impose any terms and conditions ... on the use of land designated" (§17(1.1)). The land is then "withdrawn from disposition under this Act for any purpose that is not, in the opinion of the minister, compatible with the purpose for which the land has been designated" (§17(2)). Dispositions under the Land Act are leases, licences and grants. A timber sale licence is a Forest Act tenure, and the reforestation duty is FRPA's, so §17 itself neither forbids the harvest nor lifts the duty (`land-act-designation`).
- **What can restrict the forest work is the designation's terms.** The 2021 policy (§5.4) says a conditional withdrawal "will contain terms that specify the use (or uses) that may be authorized", recorded in the land use report for a tenure application. That is policy, not the Act, and it postdates a designation made before November 2021. Whether a term binds a timber sale licence or the plan's stocking standard is for the land manager and the district to settle (`designation-terms`).
- **A designation is not a lease.** The Range Act's Crown range excludes only Crown land leased under the Land Act, so a Range Act agreement can cover a designated area. FPPR §44(3)(d) then turns on that agreement and the ground's exclusive use for grazing or hay, never on the designation (`designation-not-lease`).
- **Grazing and planting share the ground.** Range Planning and Practices Regulation §44: a range agreement holder who knows grazing "will cause significant interference with the establishment of a free growing stand under section 29" must remove the livestock and keep them out, unless the minister exempts the holder from keeping them out once measures prevent it recurring (`range-holder-livestock`).
- **When it was designated.** GATOR, searched by the Crown lands file with tenure history on, gives the interest's received and effective dates and its document number. The signed notice of establishment gives its terms. The 2021 policy sets a standard term of 10 years, up to 30 with a mandatory review every 5. Of the 2,364 §17 designations in Tantalis on 24 November 2026, 735 carry an expiry of 9999: ask the land manager whether such a record was reviewed or continued.

For one §17 agriculture and grazing designation near the Fraser River (1,376 ha, effective 12 May 2014), the read found 1,370 ha under one active grazing licence and 1.0 ha inside an ADA polygon. For a block there, the questions are the designation's terms, the grazing licence's range plan, and whether the ground will be grazed exclusively. The 2006 order's Part C.5 is not one of them, unless the block reaches that hectare.

## When the harvest is allowed but planting is not

The usual sticking point is a Part B harvest the order allows, followed by ground that cannot be planted (C.5). The free-growing duty does not go away, so the question becomes how it is met or narrowed. These are the routes the review checks, in the order the texts give them:

1. **Is planting really barred?** Part C, C.5 included, applies only to Part B. After a Part A environmental or safety harvest, the order does not bar planting; the operational work plan may still say how the ground is left (`ada-sra-part-a-planting`). Planting is not barred either outside the order's legal boundary, on land that is not Crown land, or under a permit Part II leaves alone.
2. **Natural regeneration to the plan's standard.** FRPA §29 asks for a free-growing stand, not a planted one. If the plan has a stocking standard natural regeneration can meet, the duty is met that way. BCTS Prince George's FSP, for one, allows a 7-year regeneration delay where natural regeneration is used. Record the seed source, competition and grazing evidence.
3. **Ground reserved for agriculture leaves the net area to be reforested.** FPPR §1(2)'s definition excludes "areas reserved for purposes other than timber harvesting", and areas that in their natural state cannot support a stand to the standard. If the district agrees that the agricultural ground is such a reservation, set in the cutting permit or site plan, the duty does not reach it (`nar-reserved`). This is the district's call: the definition does not say who reserves the ground, and an ADA's mapping alone is not a reservation.
4. **Exclusive range use.** If the ground is, or will be, used exclusively for grazing or hay under a Range Act agreement, FPPR §44(3)(d) relieves the duty for the harvest. It does not work on a Land Act lease (`lease-not-crown-range`).
5. **Removing individual dead trees** from a living stand may be an intermediate cut under §44(3)(h): there is no free-growing duty, but the stand must meet the §16(4) stocking standard for 12 months after harvest.
6. **A Part E deviation.** The agriculture ministry may determine "limited and conditional" harvest that departs from Parts A to D, administered by the forests ministry. A deviation that allows planting is the route when none of the above fits.

Transferring the duty (FRPA §29.1, with the minister's approval) moves who carries it; it does not lift C.5.

## What the review asks

Questions come from the evaluator's trace, as elsewhere in step 5: only the first unanswered fact of each open rule is asked. For a block in a mapped ADA, the questions run in this order:

1. Does the order apply?
2. Is the activity excluded by Part II?
3. Under which part is the harvest proposed?
4. Is there a free-growing duty?
5. Is the harvest restricted to a §44(3) purpose?
6. Will natural regeneration meet the standard?

| Rule                                                                                                                                                         | Provision                             | Raised when                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cannot-reforest-ada-sra`                                                                                                                                    | FRPA §29, order C.5, §44(3)           | Part B, duty applies, no §44(3) purpose, natural regeneration will not meet the standard |
| `ada-sra-planting-restriction`                                                                                                                               | Order C.5                             | Part B with site preparation, planting or seeding                                        |
| `ada-sra-no-pathway`                                                                                                                                         | Order Parts A, B, E                   | Harvest in the area under none of them                                                   |
| `ada-sra-part-a`, `ada-sra-part-b-basis`, `ada-sra-part-c1`, `ada-sra-part-c`, `ada-sra-referral`, `ada-sra-deviation`, `ada-sra-tenure`, `ada-sra-excluded` | Order Parts A–E, II                   | The part's own condition                                                                 |
| `free-growing`, `permanent-grazing-opening`, `intermediate-cut-stocking`                                                                                     | FRPA §29, FPPR §44(3)–(4)             | The duty applies; an opening kept for grazing; an (h) or (i) harvest                     |
| `exclusive-range`, `not-exclusive`, `lease-not-crown-range`                                                                                                  | FPPR §44(3)(d), Range Act §§1, 3      | The (d) exemption is claimed                                                             |
| `lease-terms`, `lease-review-with-lessee`, `lease-conflict`                                                                                                  | Land Act §§11, 38; grazing policy §11 | A grazing lease covers the area                                                          |
| `range-plan`, `range-development`, `natural-barrier`, `restricted-activity`, `fsp-ada-strategy`                                                              | FRPA §§32–35, 51, 48, 20.21–20.22     | The tenure, the development, the barrier or the plan clause is affected                  |

## Sources, as read

| Source                                                                                                                                                                                                                                                                                                  | What was checked                                                                                  | Read             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| [FRPA](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02069_01), current to 17 November 2026                                                                                                                                                                                           | §§1, 20.21–20.22, 29, 29.1, 32–35, 48, 51                                                         | 24 November 2026 |
| [FPPR](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004), current to 17 November 2026                                                                                                                                                                                            | §1(2) (natural range barrier, net area to be reforested), §§16, 18, 44, 45; every range reference | 24 November 2026 |
| [Range Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/04071_01), current to 17 November 2026                                                                                                                                                                                      | §§1 (Crown range), 2, 3–7                                                                         | 24 November 2026 |
| [Land Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96245_01), current to 17 November 2026                                                                                                                                                                                       | §§11, 15–17, 38, 93.4                                                                             | 24 November 2026 |
| [Range Planning and Practices Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/19_2004), current to 17 November 2026                                                                                                                                                         | §§43–44 (removal of livestock)                                                                    | 24 November 2026 |
| [2006 Omineca ADA/SRA order](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/ftstjames-vanderhoof-princegeorge-mackenzie_lrmps_luor_23nov2006.pdf) | Every page of the order, Parts A–E and II–V, and the four map sheets                              | 24 November 2026 |
| [LWBC Land Policy: Grazing](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/grazing_lands_policy_2004.pdf), effective 15 November 2004                                                                                          | §11 (timber on grazing leases), §§11.1–11.2 (consent)                                             | 24 November 2026 |
| [Land Use Operational Policy: Reserves, Withdrawals, Notations and Prohibitions](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/reserves.pdf), effective 23 November 2021, amended 9 May 2024                                  | §§1–3, 5.4 (conditional withdrawal), the Tantalis subtypes                                        | 24 November 2026 |

Policy is not law. The grazing policy is cited for how the Crown handles timber on a lease, and a later version may exist. The order names the Ministry of Agriculture and Lands and the Ministry of Forests and Range; the review reads them as today's agriculture and forests ministries, and the reviewer confirms who now administers each step. The order's maps are stamped as a visual representation not to be used for legal purposes.

## Examples in British Columbia

- **BCTS Prince George, FSP 24 Amendment 26** (2023), §5.1.1.3.1, covers FDUs 1–5. Its holder will conduct operations "in accordance with the direction" of the 21 November 2006 orders for the Prince George and Mackenzie TSAs and the Robson Valley TSA. It also caps permanent access at 7% of a block's gross area. Its §6.2 range barrier measure has three steps: update the range tenure areas each year from district staff; notify range holders through the operating plan referral; and, where a holder says a barrier will be lost, modify the activities or install an artificial barrier within 2 years. Its stocking standards (§7) have no separate case for ADA/SRA blocks. [FSP](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/bc-timber-sales/environmental-stewardship-sustainability/forest-stewardship-plans/prince-george/pg_fsp_24_amd26_ct_final_2024_01_24.pdf)
- **Fort Nelson FSP 508** (2021), §6.1, for BCTS, Canfor and the Fort Nelson Community Forest, has its own steps:
  - send range holders cutblock plans each year;
  - where a barrier is affected, agree mitigation before harvest and carry it out within one snow-free season;
  - if no agreement is reached, carry out alternative measures, such as cattle guards, debris fences or wing fencing.

  [FSP](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/bc-timber-sales/environmental-stewardship-sustainability/forest-stewardship-plans/peace-liard/bcts_tpl_fort_nelson_mult__licensee_fsp_508.pdf)

- **Forest Practices Board, FPB/SIR/42** (February 2015), _Mitigation of Forestry Impacts to Natural Range Barriers_, examined 10 field cases and the measures in 56 plans (46 FSPs, 10 woodlot licence plans). Only seven plans met all three steps of notification, assessment and implementation, and one was verifiable. Its case 6 is a one-kilometre rock fence built to replace a timbered barrier. [Report](https://www.bcfpb.ca/wp-content/uploads/2015/03/2015-SIR42-Natural-Range-Barriers.pdf)

## Comparing scenarios

For a shared-use block, compare the proposed footprint with one shape that keeps the livestock barrier and one schedule that changes the timing. Each schedule has its own record, so each can carry its own basis for the barrier, mitigation and stocking dates.

For a block in an ADA or SRA, the natural-regeneration answer decides the case. A shape that keeps a seed source next to the opening, or a smaller opening the grass will not close, can change it; record why.

For an existing opening, answer for the harvest that made it. A Part B harvest keeps Part C.5 for its reforestation, and planting needs a Part E deviation.

## Mapped evidence

**Read mapped tenures and areas** reads seven DataBC layers against the block shape the review is for, on the reviewer's click (`review/grazingEvidence.ts`, `review/GrazingEvidence.tsx`): three of tenures and orders, and four that are the public parts of the range plan (pastures, range developments as lines and as points, and natural range barriers). Each read follows the shape's own polygons (`INTERSECTS` per part, sent by POST through `wfsReads.ts`, as the old forest reads do), never its bounding box. Each area feature is clipped to the footprint in BC Albers through the old forest calculation's overlays (`overlapsWith`, `oldForest/oldForest.ts`) and listed with its overlap in hectares and its share of the footprint. A group's covered area dissolves its features, so ground two tenures share is counted once (the Range Tenure catalogue warns that tenures overlap). Overlaps under 1 m² are the overlay's rounding and are left out.

| Layer                                                                        | Read                                                                                                                                                                                                                                                           | Kept                                                                                                                                                                                                                              | Informs                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `WHSE_LAND_USE_PLANNING.RMP_PLAN_LEGAL_POLY_SVW`, geometry `GEOMETRY`        | `STRGC_LAND_RSRCE_PLAN_NAME` is _Agricultural Development Areas and Settlement Reserve Areas within 4 Forest Districts - Extent_ (980 polygons) or _Agricultural Development Areas within 1 Forest District - Extent_ (28), all `LEGALIZATION_DATE` 2006-11-21 | `LEGAL_FEAT_PROVID`, `LEGAL_FEAT_OBJECTIVE` (some use an en dash, e.g. _Settlement Reserve Areas – Vanderhoof_), the `STATUS` attribute (ADA, SRA or blank), `ENABLING_DOCUMENT_URL`                                              | `ada-sra-applicable`                     |
| `WHSE_FOREST_TENURE.FTEN_RANGE_POLY_SVW`, geometry `GEOMETRY`                | every life cycle (4,335 polygons: 1,609 active, 65 pending, 2,661 retired)                                                                                                                                                                                     | `FOREST_FILE_ID` and `MAP_BLOCK_ID`, `FILE_TYPE_CODE`, `FILE_STATUS_CODE`, `LIFE_CYCLE_STATUS_CODE`, `AUTHORIZED_USE`, `RETIREMENT_DATE`, `ADMIN_DISTRICT_CODE`                                                                   | `range-act-agreement`                    |
| `WHSE_TANTALIS.TA_CROWN_TENURES_SVW`, geometry `SHAPE`                       | `TENURE_SUBPURPOSE = 'GRAZING'` (620: 206 issued leases, 304 applications, 110 reserves or notations), or a Land Act designation of any purpose (`SEC 15 OIC RESERVE` 548, `SEC 16 MAP RESERVE` 6,036, `SEC 17 DESIGNATED USE AREA` 2,364)                     | `CROWN_LANDS_FILE`, `INTRID_SID`, `TENURE_STAGE`, `TENURE_STATUS`, `TENURE_TYPE`, `TENURE_SUBTYPE`, `TENURE_EXPIRY`, `APPLICATION_TYPE_CDE`, `TENURE_LEGAL_DESCRIPTION`, `TENURE_PURPOSE`, `TENURE_SUBPURPOSE`, `TENURE_DOCUMENT` | `land-act-lease`, `land-act-designation` |
| `WHSE_FOREST_VEGETATION.RANGE_PASTURE_POLY_SVW`, geometry `GEOMETRY`         | every pasture (4,319 polygons; 2,180 without a `RANGE_UNIT_ID`)                                                                                                                                                                                                | `RANGE_UNIT_ID`, `RANGE_PASTURE_ID`, `PASTURE_NAME`, `OWNERSHIP_CODE`, `DISTRICT_RESPONSIBLE_CODE`, `CAPTURE_DATE`                                                                                                                | `range-act-agreement`                    |
| `WHSE_FOREST_VEGETATION.RANGE_IMP_FEATURE_LINE_SVW`, geometry `GEOMETRY`     | every line (27,262: 25,082 fences, 2,103 stock trails, 76 water developments, 1 not named)                                                                                                                                                                     | `IMPROVEMENT_FEATURE_CODE`, `IMPROVEMENT_TYPE_CODE`, `FEATURE_CODE`, `FIELD_CONDITION_CODE`, `FIELD_OBSERVATION_DATE`, `OWNERSHIP_CODE`, `DISTRICT_RESPONSIBLE_CODE`, `CAPTURE_DATE`                                              | `range-development-affected`             |
| `WHSE_FOREST_VEGETATION.RANGE_IMP_FEATURE_PNT_SVW`, geometry `GEOMETRY`      | every point (18,203: 7,316 gates, 5,303 cattleguards, 3,850 water developments, 661 corrals, 463 salt, 180 cabins, 159 crossings and stock bridges, 152 exclosures, 119 others)                                                                                | the line layer's fields                                                                                                                                                                                                           | `range-development-affected`             |
| `WHSE_FOREST_VEGETATION.RANGE_NATURAL_BARRIER_LINE_SVW`, geometry `GEOMETRY` | every line (1,716: 1,598 topological, 64 vegetation, 54 water)                                                                                                                                                                                                 | `BARRIER_FEATURE_GROUP_CODE`, `BARRIER_FEATURE_CODE`, `BARRIER_DEPTH`, `FIELD_CONDITION_CODE`, `FIELD_OBSERVATION_DATE`, `DISTRICT_RESPONSIBLE_CODE`, `CAPTURE_DATE`, `FEATURE_CODE`                                              | `barrier-impact`                         |

Counts as read on 24 November 2026. The Range Tenure layer also carries `CLIENT_NAME`, which names private individuals: it is never requested (`propertyName` lists only the fields above), and no holder is read from Tantalis either.

- **Orders.** The 4-district plan is the Omineca order (Fort St. James, Vanderhoof, Prince George and Mackenzie). The 1-district plan's enabling document is `robsonvalley_lrmp_luor_23nov2006.pdf`, the Robson Valley LRMP order of the same date for the Headwaters Forest District (McBride area): a separate order, which the `ada-sra-applicable` fact does not ask about. Both orders' maps say they are "a visual representation and not to be used for legal purposes". A polygon is a candidate; the order's legal description and the district decide.
- **Range codes.** `FILE_TYPE_CODE` and `FILE_STATUS_CODE` are labelled from the dataset's own column comments in the BC Data Catalogue: E01 grazing licence, E02 grazing permit, E03 non-replaceable grazing permit, H01 haycutting licence, H02 haycutting permit, H03 non-replaceable haycutting permit; A active, AR archived, CA cancelled, I inactive, P pending, SU suspended. Other status codes the layer holds (RRS, AT, ID, IC, PE) print as DataBC gives them. `LIFE_CYCLE_STATUS_CODE` is the spatial boundary's status. Active tenures are listed first, pending and retired apart. `AUTHORIZED_USE` is for the whole tenure, in AUMs for E codes and tonnes for H codes. The catalogue notes that a boundary can take in private land or water that is not part of the grazing area.
- **Range plan.** The four `WHSE_FOREST_VEGETATION` layers are the parts of the range plan DataBC publishes; the plan itself, its schedule and the agreement holder are on the RAN file. The catalogue calls pastures administrative, not legal, boundaries, and defines a range development as infrastructure added to Crown rangeland to improve livestock management. A pasture is an area like the tenures. A range development or natural barrier is measured inside the footprint and within `NEAR_FOOTPRINT_METRES` (50 m) of its edge, because a fence or barrier along the boundary is cut, opened or moved by the falling and yarding beside it, and these layers are drawn from air photos, TRIM and sketch maps, which can put a boundary fence a few tens of metres to either side. A line is listed by its length in metres inside the footprint and within the margin (inside included); a point record is counted the same way, each point of a multipoint on its own. Lines and points are asked for with the footprint grown by the margin and 2 m more, since the request's ring is rounded to about a metre (`grownFootprint`); the measure itself is exact, in BC Albers (`linesNearFootprint`, `pointsNearFootprint`). A kind's total joins its lines, so a stretch two records share is counted once. Stretches under 1 cm are the overlay's rounding and are left out.
- **Development kinds.** `IMPROVEMENT_FEATURE_CODE` names the kind in the layer itself (FENCE, GATE, CATTLEGUARD, WATER DEVELOPMENT, CORRAL, CROSSING, BRIDGE, STOCK TRAIL, SALT, CABIN, EXCLOSURE, OTHER, as the catalogue's list of features has them); it is blank on one line of the 45,465 records, but the read does not count on that. The listed kinds are fence, gate, cattleguard, water development, corral, crossing (with the one BRIDGE, a stock bridge, as the catalogue's "crossings (e.g. stock bridge, underpass)" puts it) and stock trail; every other kind goes under _Other_ and prints as given. Where `IMPROVEMENT_FEATURE_CODE` is blank the kind is read from `FEATURE_CODE`, by the kind the records give each code most often (FI91600370 fence on 23,630 records, FI91600120 gate 6,747, FI91600070 cattleguard 4,979, FI19600010 water development 3,550, DC31700700 stock trail 2,100, FI91600080 corral 614, FA00000003 crossing 150), and the record says so. `FEATURE_CODE` is only the fallback because the two disagree: FI19600010 is also on 237 gates and 28 cattleguards. Codes spelt otherwise (2,347 begin `Fl`, with a lower-case L, and 7 begin `F1`) are not matched; every one of them has its `IMPROVEMENT_FEATURE_CODE`. `IMPROVEMENT_TYPE_CODE` (barb-wire, log, dugout, slip-wire…), `FIELD_CONDITION_CODE` and `OWNERSHIP_CODE` are free text in the layer (_provincial crown_, _private_, _highways_…) and print as given. `SYMBOL_ANGLE` turns a point's map symbol and is not read.
- **Natural barriers.** `BARRIER_FEATURE_GROUP_CODE` is the group (TOPOLOGICAL, VEGETATION, WATER) and `BARRIER_FEATURE_CODE` the barrier (steep slope, moderate slope, drop-off), both as given; `BARRIER_DEPTH` is the depth, height or width of a tree-line barrier in metres. The catalogue says vegetation and water barriers have their own datasets with special access restrictions, and that little has been updated since 2010. A mapped barrier is a candidate for FRPA §48 and the FSP's FPPR §18 measure. An unmapped barrier is not evidence that none exists, and the absence of mapped barriers proves nothing: the reviewer asks the agreement holder and the district, as the FSPs and the Board's 2015 report above do.
- **Tantalis.** An application (`TENURE_STAGE` APPLICATION) and a reserve or notation (`TENURE_TYPE` RESERVE/NOTATION) are listed apart from an issued lease (LEASE at stage TENURE). `APPLICATION_TYPE_CDE` (REP, NEW, PRE-T, PRE RNWL) and `TENURE_EXPIRY` (99 reserves carry 9999) print as given: the catalogue does not define them.

A layer DataBC did not answer prints _Not read_ with the reason, never _none_. A layer holding more than 500 records against the footprint (`MAX_MAPPED_FEATURES`) is marked incomplete. The read is kept on the review (`RangeReview.mapped`) with the date, shape and footprint signature it was read for. A changed harvest year keeps it, since the ground is the same; a changed shape shows it out of date until it is read again. It never answers a fact, enters the rule evaluation, `usePlanAnalysis` or a check's key. The assessment record carries it with `mappedCurrent`, and the printed summary shows it under the review as dated _mapped candidates_.

A live read on 24 November 2026 of a 500 m square (25.05 ha) centred on a vertex of ADA polygon PRG*76_273 (\_Agricultural Development Areas - Prince George W*) took 1.2 s. It found the ADA on 8.54 ha (34.1%), an active E01 range tenure on 12.10 ha (48.3%) and a retired one on 12.10 ha (48.3%), and a Tantalis section 17 designated use area (a reserve, not a lease) on 11.82 ha (47.2%).

Two live reads on 24 November 2026 of 600 m squares (36.08 ha) in the §17 designated use area east of Prince George (Crown lands file 7409068), all seven layers each, took 1.4 s and 1.2 s:

| Centre               | Pastures                                 | Range developments                                                                                               | Natural barriers |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| −122.6047°, 54.2258° | 1 (_Powerline_), 23.36 ha (64.8%)        | none mapped inside or within 50 m                                                                                | none mapped      |
| −122.5800°, 54.2090° | 5 (_5W_, _9_, _6_, _10_, _5E_), 27.81 ha | 7 fences, 2,567 m inside and 3,446 m within 50 m; 1 corral inside; 2 water developments within 50 m, none inside | none mapped      |

Both squares also lay in active range tenure RAN074718 (E01, 850 AUM a year for the whole tenure) and the designated use area; the first square's three _none mapped_ are what the layers hold there, not evidence that the ground has no fence or barrier.

## Not built

- A stocking-standard check. Whether natural regeneration will meet the standard is the reviewer's judgement, with its evidence; the planner models no regeneration.
- Later orders. The pack was checked against the 2006 order only. Confirm with the district that no later order amends it for the block.
- The Robson Valley order of the same date (Headwaters Forest District) is read on the map but has no rules of its own.
