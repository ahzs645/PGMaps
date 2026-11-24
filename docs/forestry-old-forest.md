# Old and old interior forest (Objectives A and B) in the block planner

**Compare → Old and old interior forest** calculates Objectives A and B of the 2004 Prince George order for one of its Map 2 units, or for units the reviewer pools under D.2: old forest against the unit's share of the Crown Forest Land Base (CFLB), old non-pine-leading forest against the implementation policy's Tables 8–10, and old interior forest against the required old forest. It runs for every schedule over the plan's eleven periods. Code: `src/pages/block-planning/oldForest/` (`units.ts`, `reads.ts`, `landBase.ts`, `oldForest.ts`, `recordText.ts`, `youngerStands.ts`, `pooling.ts`, `representation.ts`, `drawing.ts`, `oldForest.worker.ts`, `oldForestClient.ts`), the panel `OldForestSection.tsx` with `RepresentationSummary.tsx`, the map layer `useOldForestMap.ts` and `PlanMap.tsx`, the record `records.ts`. Research behind it: [Old forest under the Prince George order](research/prince-george-old-forest-2026-11-23.md).

The figures are VRI age-based and not field-verified. Nothing in the planner decides whether D.5(a) applies. D.5(a)'s _Recruitment analysis_ step shows the result beside the reviewer's own entry, and never writes into it.

## Decisions (24 November 2026)

The research note ended with eight open questions. Each is answered here, with the evidence. Change a decision only with new evidence, and change this page with the code.

| #   | Question                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A10: 17% or 12%?                        | **17%.** The order's tables are the targets. Where DataBC's legal layer carries a different `OLD_RETEN`, the panel and the summary say so and use the order's figure (`gisDisagrees`).                                                                                                                                                                                                                                                                                                                                                  | Four sources say 17%: the order's Table 3 (p. 6), the policy's Table 10, the 2015 TSR data package (old 17%, non-pine 14%, A7 and A10), and the Board's 2019 table (required 6,655 ha = 17% × 39,145 ha). Only the GIS layer's `LEGAL_FEAT_ATRB_7` says 0.12. `units.test.ts` checks every unit's targets against the Board.                                                                                                              |
| 2   | Where does the CFLB come from?          | **A VRI proxy by default:** treed (`BCLCS_LEVEL_2 = 'T'`) on the forest management land base (`FOR_MGMT_LAND_BASE_IND = 'Y'`) within the unit, on the Crown land the order applies to (private and other non-Crown land, woodlots, community forests and TFLs left out; see Method). The reviewer may state a CFLB (the LLOWG's, say) with its source. It then takes the proxy's shares: every area is measured on the proxy's ground and scaled by the stated CFLB over the proxy's. A prepared FAIB land base is future work (below). | No public CFLB layer exists for the TSA, and FAIB's THLB/AFLB files are about 1 GB file geodatabases. Against the Board's 2019 figures (below), the proxy's hectares were 4% under to 38% over before the excluded ground was left out, and are 4% under to 3% over since. Hence shares, not hectares: a stated 39,145 ha for A10 beside old forest measured on the first proxy's 53,936 ha would have overstated the surplus by a third. |
| 3   | Are NFAs old for ever?                  | **Old until harvested.** A beetle-killed stand keeps its VRI age, so no special rule is needed. A harvest record after the projection, or a block, resets it.                                                                                                                                                                                                                                                                                                                                                                           | The policy (p. 3) counts NFAs as old; the 2015 TSR data package counted them old until regenerated and harvested.                                                                                                                                                                                                                                                                                                                         |
| 4   | ICH old age?                            | **Older than 140**, as the LLOWG and the Board counted A22, A23 and E13. The age basis prints with every result.                                                                                                                                                                                                                                                                                                                                                                                                                        | The policy's footnote leaves ICH "requires more discussion"; the Board's table lists 141 for all three.                                                                                                                                                                                                                                                                                                                                   |
| 5   | Pool A3 and A13?                        | **Never by default.** One unit is assessed alone unless the reviewer pools units under D.2 (_Pool with other units_, see **D.2: pooling units**). Whether units are similar mBECs is the reviewer's judgement.                                                                                                                                                                                                                                                                                                                          | The order's "combined with A13" is D.2-style pooling. The GIS and the Board keep A3 and A13 apart.                                                                                                                                                                                                                                                                                                                                        |
| 6   | 2005 or 2004 interior method?           | **2005 by default**, the 2004 method as an option.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The policy records the 2005 revision as agreed by the Landscape Objective Working Group on 22 June 2005.                                                                                                                                                                                                                                                                                                                                  |
| 7   | Import approved recruitment strategies? | **Yes, spatial ones:** _Add areas_ takes GeoJSON polygons, each with its approval reference, and D.1 counts them whole. Aspatial strategies (most of the approved ones) cannot be drawn and are not counted.                                                                                                                                                                                                                                                                                                                            | D.1 counts "any new spatially located old forest retention areas established after the enforcement of this order" whole. The Board names one spatial and six non-spatial strategies (2012–14).                                                                                                                                                                                                                                            |
| 8   | May a deficit year prefill D.5(a)?      | **Display only.** The analysis step shows the first shortfall beside the reviewer's entry; the determination, the analysis named and every other field stay the reviewer's.                                                                                                                                                                                                                                                                                                                                                             | AGENTS.md: a D.5 determination is always the reviewer's answer.                                                                                                                                                                                                                                                                                                                                                                           |

Three more choices the order forced, each a switch in the panel:

- **OGMAs.** D.1 counts "the entire area" of OGMAs whole, whatever their age. Legal OGMAs always count. Non-legal ones count by default, since the Board found the LLOWG counting them, and can be switched off.
- **Parks.** D.1 says parks "may contribute", so they are off by default and switched on by the reviewer.
- **Corridors.** The 2005 method buffers forest service roads, railways, pipelines and hydro corridors. FSRs (`FTEN_ROAD_SECTION_LINES_SVW`, _Forest Service Road_), railways, transmission lines and pipelines are read (Method, **Reads**).

## Method

- **Units.** The 48 units of Tables 1–6 are data in `packages/legal-rules/rules/bc/prince-george/2004-biodiversity-order.json`, with the non-pine minimums from policy Tables 8–10. The Board's 2019 table (Appendix 1) is in `packages/legal-rules/observations/fpb-irc-235.json`. A unit's old age comes from the policy's rule (`oldAgeRule`). `units.test.ts` holds it equal to the Board's age on all 49 rows, and the Board's required hectares equal to the order's percentages.
- **Reads** (`reads.ts`). These run in the worker, live from DataBC, and are kept for the session:
  - the unit's Map 2 polygons;
  - VRI rank 1 stands touching them;
  - legal and non-legal OGMAs and parks;
  - FSRs, railways, transmission lines and pipelines;
  - the ground the order does not apply to (`landBase.ts`, below).

  Each read follows the unit's own shapes (`INTERSECTS` per part, by POST), never its box. A10's box holds 153,680 VRI polygons against 6,333 that touch the unit. The one exception is the TFL layer, asked with each part's convex hull (`readAcrossParts`'s `byHull`): a TFL is one very detailed polygon, and intersecting A10's 6,974-vertex part with TFL 52's 32,214-vertex boundary timed out at DataBC's gateway every time (504 after 60 s), while the hull asks for the same licences and the clip that follows is exact. A unit with more than `MAX_STANDS` (30,000) stands is refused and needs the prepared tables below.

- **Pipelines.** No one layer holds them all, so three are read, and a right-of-way's area is buffered by 200 m like a line:
  - rights-of-way on Crown land, `WHSE_TANTALIS.TA_CROWN_RIGHTS_OF_WAY_SVW` with `TENURE_SUBPURPOSE = 'GAS AND OIL PIPELINE'` and `TENURE_STAGE = 'TENURE'` (applications left out). A10's five, the largest a strip with 1,082 km of boundary, are the only pipelines in the three units checked;
  - the BC Energy Regulator's rights-of-way, `WHSE_MINERAL_TENURE.OG_PIPELINE_AREA_PERMIT_SP`, where `CONSTRUCTION_DESC = 'Constructed'`;
  - its segments, `WHSE_MINERAL_TENURE.OG_PIPELINE_SEGMENT_PERMIT_SP`, where `STATUS` is `Active`, `Deactivated` or `Abandoned` (the cleared right-of-way stays; `New` and `Removed` are left out).

  The two Regulator layers cover the north (3,659 rights-of-way and 1,597 segments between 53° and 56.5° N, 121° and 126° W) but hold nothing in A5, A6 or A10.

- **Ground the order does not apply to** (`landBase.ts`). The order applies to Crown land and excludes woodlot licences, tree farm licences and community forest agreements (order p. 2); the policy's CFLB leaves out private, federal and municipal land (policy p. 1). Three layers are read, each verified by `DescribeFeatureType` and its records in A5, A6 and A10:
  - **not provincial Crown**: FAIB's ownership layer `WHSE_FOREST_VEGETATION.F_OWN` (521,749 records), by its `OWN` code. 40–49 (private, treaty settlement land), 50–59 (national parks, First Nation reserves, military and federal parcels) and 80–89 (municipal parcels, local and regional parks) are left out. 60–69 (provincial parks, the forest management unit, reserves and designations), 70–79 (tenures, read below), 91 (unknown designation) and 99 (Crown leases) stay;
  - **woodlots and community forests**: `WHSE_FOREST_TENURE.FTEN_MANAGED_LICENCE_POLY_SVW`, `LIFE_CYCLE_STATUS_CODE = 'ACTIVE'`, told apart by the file's letter (W woodlot licence, K community forest agreement; checked against all 3,631 records and their holders). N, a First Nations woodland licence, stays: the order does not name the tenure, which was created in 2011. The Tano T'enneh licence N2E covers parts of all three units checked;
  - **tree farm licences**: `WHSE_ADMIN_BOUNDARIES.FADM_TFL_ALL_SP`, the licences' current boundaries.

  `prepareUnit` takes the excluded ground out of the unit before anything is counted, so the CFLB proxy, old forest, non-pine and D.1's counted areas leave it. Ground two layers hold is reported once, under the first of non-Crown, TFL, woodlot, community forest. The record keeps, by kind, the records read, the hectares in the unit and the proxy CFLB on them, and the panel and the summary print them. Two things stay on that ground: a young stand there still makes an edge, and old forest there shapes interior (an old patch across a tenure boundary is one patch, and the boundary is no edge), though its interior is never counted. A unit with none of this ground calculates exactly as before. A record made before calculation 2 (`OLD_FOREST_CALCULATION`, part of the key) reads as out of date. Tenures are read as they stand today, also for the 2019 check.

- **Age.** A stand's age in year Y is `PROJ_AGE_1 + (Y − year(PROJECTED_DATE))`; the ages are already projected and are not aged again. A stand harvested since the VRI was made counts from its harvest. Before the projection date, a stand harvested after Y has an unknown age in Y. It is counted apart and never as old; the 2019 check states its area.
- **Resets.** Past disturbances after the VRI projection, and each schedule's blocks, make their ground young from their year.
- **Old forest.** Old CFLB ground, plus ground counted whole under D.1, less reset ground. Old non-pine-leading excludes stands whose leading species code starts with P.
- **Interior** (`interiorOf`). Old ground less 200 m from edges, then only the parts more than 200 m wide (the part survives an inward 100 m buffer).
  - Edges under the 2005 method: stands 60 years or younger that are pine- or deciduous-leading, other stands 80 or younger, unaged land-base ground, reset ground, and the corridors. Neighbours outside the unit are read whole, so a young stand across the boundary still makes an edge. Non-forest makes none.
  - Edges under the 2004 method: anything younger than old.
  - Interior is the costly step, so it is calculated for every period of the schedule under review and for the first and last of the others.
- **Robustness.** Projected coordinates are snapped to 1 cm, and an overlay that fails to node is retried on a 10 cm grid (`robust`).

The result is kept with the plan (`checks.oldForest`), keyed to the choices, baseline, blocks, schedules and first year. A changed input marks it out of date in the panel, the assessment record and the printed summary.

## D.4: younger stands

> "D.4. A Portion of Younger Age Classes. Where it can be demonstrated that equal or better conservation benefits would result, up to 20% of the Old Forest Retention and Old Interior Forest objectives may be comprised of younger age classes."

The benefit is a judgement, so D.4 is the reviewer's and never the model's (`oldForest/youngerStands.ts`).

- **Off by default.** _Assumptions you can change → Count younger stands toward up to 20% of each objective (D.4)_. Switched on, it needs the age from which younger stands count (no default; below the old age of every unit assessed) and a statement of the conservation benefit. Until both are given nothing is calculated and the panel says what is missing (`youngerStandsProblem`). Both are kept on the plan's choices (`oldForest.younger`) and in the record (`checks.oldForest.younger`), and changing either puts the record out of date.
- **What counts.** CFLB stands from that age up to the unit's old age, less reset ground and less ground already counted whole under D.1 (`d4OldSupplyHa`). Toward old interior, the interior the younger stands add when they are treated as old and make no edge (`d4InteriorSupplyHa`): interior is calculated a second time with them, so D.4 roughly doubles the cost of interior.
- **The ceiling.** What counts toward each objective is at most 20% of its requirement (`d4OldHa`, `d4InteriorHa`; `withYoungerCap`), never more. A pool applies the ceiling again to its summed supplies and requirements.
- **Kept apart.** `oldHa` and `interiorHa` never include D.4; the D.4 figures sit beside them in each year of the record, the panel (_held + D.4 / required_), the printed summary (two more columns) and the assessment record. D.4 never counts toward the non-pine minimum: D.4 names the old forest retention and old interior objectives only. The 2019 Board check runs without D.4, since the Board counted no younger stands.
- **Saying when it made the difference.** `firstShortfall` counts D.4 when it was on; `metOnlyWithD4` names the first year an objective is met only because of it, and `shortfallText` puts both in the one wording the panel, the summary and the record use ("no shortfall over the projection; old interior met only with D.4 from 2019"). D.5(a)'s evidence line says when a result leans on D.4, and when D.4 was counted without making the difference.
- With D.4 off no D.4 field is written and every figure is exactly as before (`youngerStands.test.ts`).

## D.2: pooling units

> "D.2. … where a forest licensee has similar mBECs in multiple forest districts, licensees and BC Timber Sales, may meet the combined requirement of those objectives over the combined area of the mBECs."

_Pool with other units (D.2)_ lists every unit of the order in the three districts; the reviewer adds the ones to pool (`oldForest.pooledWith`), each with an optional stated CFLB and its source. Nothing is pooled by default (decision 5), and the panel marks a pooled unit whose BEC as printed differs from the chosen unit's; whether they are similar is the reviewer's judgement (`oldForest/pooling.ts`).

- **Each unit as alone.** The worker reads each unit as it reads one (kept per unit for the session), prepares it against its own Map 2 shape and calculates it with its own old age, percentages and CFLB (stated, else its proxy). Retention areas are clipped to each unit.
- **Sums** (`poolFigures`). The pool's requirement is the sum of each unit's CFLB × its own percentage, the interior requirement the sum of each unit's, and what is held the sum across units. The non-pine minimum is summed over the units that state one and set against those units' non-pine old forest.
- **Never twice.** Units whose Map 2 polygons overlap by 0.01 ha or more are refused with the overlap named and no figures (`poolOverlaps`). Map 2's units share their boundaries exactly: A5 and A10, and A6 and A10, touch with 0 m² in common.
- **Too large to read live.** A unit past 30,000 stands is refused as needing the prepared tables (`tooLargeRefusal`), pooled or alone. A3 with A13 waits for them.
- **The record** names every unit pooled (`checks.oldForest.pool`, the chosen unit first), each with its own source, proxy CFLB, counts, per-schedule figures and 2019 calibration; `schedules` are then the pool's sums and the record's other fields the chosen unit's own. The panel shows each unit's old and interior forest for the first and last years beside the pool's; the summary names every unit and its CFLB.
- **The Board's 2019 comparison stays per unit**, because the Board's table is: it is run and shown for every pooled unit with a Board row, each beside its own row, never for the pool.
- **Interior across a shared boundary.** Interior is calculated in each unit and summed. An interior patch straddling the boundary between two pooled units is judged for its 200 m width in each unit separately, so the pool's interior can be slightly understated there.

Run live on 24 November 2026, A5 pooled with A6 (both Prince George Moist Interior – Mountain, ESSF, old from 141; the two lie 16 km apart), baseline only, defaults:

| Year | A5 old: held / required | A6 old: held / required | Pool old: held / required | Pool interior: held / required |
| ---- | ----------------------- | ----------------------- | ------------------------- | ------------------------------ |
| 2019 | 2,807 / 3,737 ha        | 9,535 / 6,483 ha        | 12,342 / 10,220 ha        | 6,116 / 4,088 ha               |
| 2026 | 3,538 / 3,737 ha        | 9,639 / 6,483 ha        | 13,177 / 10,220 ha        | 6,421 / 4,088 ha               |
| 2076 | 7,678 / 3,737 ha        | 11,705 / 6,483 ha       | 19,383 / 10,220 ha        | 14,670 / 4,088 ha              |

These figures were measured before private land and the excluded tenures left the land base. A6's proxy CFLB has since fallen from 22,354 to 16,526 ha (TFL 53 out; see the 2019 check below), so A6's and the pool's hectares held and required are now lower; A5 is unchanged. Run the pool again before relying on them. The pool's CFLB was then 35,242 ha (12,887 + 22,354, both proxies). A5 alone is short of old and old interior in 2019 (interior 1,411 of 1,495 ha); pooled with A6 there is no shortfall over the projection. Each unit's figures are its figures alone, to the hectare those of the Board table below.

With D.4 on from 100 years, A5 alone in 2019 has 2,497 ha of younger stands toward old forest and counts 747 ha (20% of 3,737); it stays short of old forest (2,807 + 747 < 3,737), while its old interior, 84 ha short, is met only with D.4 (299 ha counted of 1,529 ha the younger stands add). The pool counts 2,044 ha toward old (of 3,979 ha) and 818 ha toward interior (of 2,304 ha), without needing either. Through the worker, reading both units live and calculating three schedules with D.4 took 201 s; recalculating without D.4 from the session's reads took 61 s.

## D.3: representative stands

> "D.3. Epidemic or Catastrophic Events. A representative portion of stands that have been affected by an epidemic or catastrophic event may contribute to meeting the Old Forest Retention and the Old Interior Forest objectives. Due to the current Mountain Pine Beetle epidemic, licensees and BC Timber Sales must ensure a representative portion of stands that have not been affected by the epidemic (i.e. non-pine forest) are used to meet the Old Forest Retention and the Old Interior Forest objectives." (order, p. 12)

The policy says how (section 1, p. 3): a licensee "may ensure a representative portion of the stand is used … by: (a) maintaining the percentage of live timber that contributes to meeting the objective that is in proportion to the percentage of the area that is not affected by the epidemic or catastrophic event, or (b) by following Tables 8-10." Section 7 (p. 11) adds that "the current representative portion of non-pine forest for interior old forest is uncertain" and that licensees "are to strive for a representative portion of the current portion for pine leading and non-pine leading forests", the benchmark to be calculated through adaptive management.

So the texts measure representation by affected (pine-leading) and unaffected (non-pine) stands. (b) is the non-pine figure the panel already sets against Tables 8–10. Whether old forest is representative is the reviewer's judgement, so _Representative stands (D.3)_ in the panel is a summary that helps it and never a pass or fail (`oldForest/representation.ts`, `RepresentationSummary.tsx`). The three passages are quoted above the table.

- **The (a) comparison as figures.** For the unit and the year on the map: the non-pine-leading share of the CFLB, non-pine old forest's share of old forest, and interior on non-pine old ground as a share of old interior (`pineSplit`). Nothing is said about whether they are in proportion.
- **The breakdowns**, each beside the CFLB proxy so the reviewer sees whether old forest is spread as the land base is: CFLB, old forest and old non-pine forest in hectares with each row's share of its column, and old forest as a share of the row's own CFLB, by
  - **leading species group**, from the first letter of `SPECIES_CD_1` (pine P; spruce S; true firs B; Douglas-fir F; hemlock H; cedars C and Y; larch L; other conifers J and T; deciduous; no species). Non-pine is every group but pine, as the non-pine figure counts it;
  - **BEC variant**, VRI `BEC_ZONE_CODE`, `BEC_SUBZONE` and `BEC_VARIANT` (verified by `DescribeFeatureType`), largest CFLB first;
  - **age class**, the provincial inventory's (1: 0–20 years, then twenty-year classes to 7: 121–140, 8: 141–250, 9: 251 and older), since neither the order nor the policy states classes. Ground a reset made young is its own row, as are unknown and missing ages. D.1 ground counted whole sits in its stand's own age class;
  - **site index class**, VRI `SITE_INDEX` in PGMaps' own 5 m steps (`SITE_INDEX_STEP_METRES`; under 10, 10–15, 15–20, 20–25, 25 m and over, none stated), since the texts state none.
- **The same calculation.** Every figure is the stand's own share of the same per-stand areas as the objectives (`unitYears` with `representation`): its CFLB ground, its old ground less resets, its non-pine old ground, scaled by a stated CFLB exactly as the figures are. Each breakdown adds up to the year's CFLB, old and non-pine figures (`representation.test.ts`). Interior on non-pine old ground is the interior less what lies on the rest of the old ground (pine-leading old forest and D.1 ground not old by age), the smaller overlay. D.4's younger stands are never in it.
- **Where it is kept.** Made for the schedule under review, every period, and kept on the record (`checks.oldForest.representation`, and each pooled unit's on its `pool` entry). It is an output, never a key's input: a record made before it reads as current, without the summary, and the panel asks to calculate again to see it. The printed summary quotes the texts and prints each breakdown for the first and last years.
- **Reads.** The four VRI fields were added to `VRI_FIELDS`. They change no figure and nothing counted, so `OLD_FOREST_CALCULATION` stays at 2.

Run on 24 November 2026 on A5 (1,923 stands, cached Map 2, OGMA and corridor reads, stands read again live with the new fields in 9 s), baseline only, defaults:

| Year | Non-pine share of CFLB | Non-pine share of old forest | Non-pine share of old interior |
| ---- | ---------------------- | ---------------------------- | ------------------------------ |
| 2026 | 73.9%                  | 94.3%                        | 95.9%                          |
| 2076 | 73.9%                  | 88.7%                        | 87.7%                          |

Pine is 26% of A5's CFLB and 6% of its old forest in 2026; ESSF mv1 and mv3 hold 63% of the old forest on 43% of the CFLB, SBS wk1 15% of old on 28% of the CFLB, and no old forest stands on sites of 20 m or more. Eleven periods with interior took 19.0 s without the summary and 19.2 s with it, and the figures were identical.

## A map of old and interior forest

_Draw on the map_ under the result (or **Old forest on map** in the ribbon's View tab) draws the calculation on the plan map for the schedule and year the map shows (`useOldForestMap.ts`, `PlanMap.tsx`):

- **Old, by an edge**: old forest within 200 m of an edge;
- **Old, too narrow**: old forest away from edges but in a part 200 m wide or less;
- **Old interior**: the interior counted;
- **200 m from an edge**: the band the edges cast over the unit (young stands, resets and corridors as the 2005 method draws them; anything younger than old under the 2004 method);
- **D.1, not old by age**: ground counted whole under D.1 that is not old, as an outline;
- **Younger, by D.4**: the younger stands D.4 counts, when D.4 is on;
- **Corridor (2005 method)**: the corridor lines and rights-of-way inside the unit;
- **Off the order's land base**: private, TFL, woodlot and community forest ground left out.

Rules:

- **The same calculation.** The shapes come from the worker's own run for that year (`unitYears` with `drawYear`), on the same session reads and prepared units as the record, through one worker the panel and the map share (`oldForestClient.ts`). The page never computes a shape. Each pooled unit is drawn as it is calculated alone. The legend gives each kind's hectares, measured before simplifying and not scaled by a stated CFLB; the old interior drawn is the interior counted. If the drawing's figures differ from the record's for that schedule and year (stands read again on another day), the legend says so (`drawingDisagrees`).
- **Display only.** Shapes are simplified by `MAP_SIMPLIFY_METRES` (10 m, JSTS's topology-preserving simplifier) in BC Albers and rounded to 6 decimals; no figure is read from them.
- **Only while it is on.** The worker draws only when asked, so a calculation without the layer costs what it did and its figures are unchanged (`representation.test.ts` pins figures equal with and without the drawing and the summary). A draw of one year took 2.5 s on A5 after the reads, 266 kB of shapes.
- **Loading** (`docs/map-layer-loading.md`). Every kind sits on one GeoJSON source, so a new drawing replaces them all in one `setData`. While the next schedule or year is drawn the last drawing stays up, and the legend says which year the map still shows after `HANDOFF_NOTE_DELAY_MS`; a newer request supersedes an older one still waiting in the worker. The layer is removed only for a state the legend states: off, no record, or a record out of date.
- **Session only.** Neither the switch nor the shapes are written to the plan file or the record.

## Checked against the Board's 2019 figures

The panel's _Check against the Board's 2019 figures_ runs the baseline alone in 2019 and sets it beside the Board's Appendix 1 row (the 2019 LLOWG analysis). Run on 24 November 2026, with the excluded ground left out and pipelines read:

| Unit (old from)    | CFLB: proxy / Board | Old forest: modelled / Board | Old share of CFLB: modelled / Board | Interior: modelled / Board | Interior share of old: modelled / Board |
| ------------------ | ------------------- | ---------------------------- | ----------------------------------- | -------------------------- | --------------------------------------- |
| A5 (141, ESSF)     | 12,887 / 13,478 ha  | 2,807 / 4,534 ha             | 21.8% / 33.6%                       | 1,411 / 2,303 ha           | 50% / 51%                               |
| A6 (141, ESSF wk1) | 16,526 / 16,344 ha  | 6,681 / 7,124 ha             | 40.4% / 43.6%                       | 3,006 / 3,573 ha           | 45% / 50%                               |
| A10 (121, SBS wk1) | 40,469 / 39,145 ha  | 11,615 / 11,515 ha           | 28.7% / 29.4%                       | 5,582 / 4,585 ha           | 48% / 40%                               |

Defaults: legal and non-legal OGMAs counted, parks not, the 2005 interior method.

What left each unit, as hectares in the unit and, in brackets, the proxy CFLB on them:

| Unit | Not provincial Crown                                      | TFL                             | Woodlot         | Community forest | Pipelines read        |
| ---- | --------------------------------------------------------- | ------------------------------- | --------------- | ---------------- | --------------------- |
| A5   | none                                                      | none                            | none            | none             | none                  |
| A6   | none                                                      | 6,385 ha (5,828), TFL 53        | none            | none             | none                  |
| A10  | 9,159 ha (7,988), 231 parcels: private, reserves, federal | 5,484 ha (5,138), TFL 52 and 53 | 344 ha (325), 5 | 17 ha (17), K2M  | 5 Crown rights-of-way |

The first run of the day, on the whole unit and without pipelines, read A6 at 22,354 ha CFLB, 9,535 ha old (42.7%), 4,705 ha interior (49% of old), and A10 at 53,936 ha, 15,323 ha old (28.4%), 6,685 ha interior (44%).

- **The excluded ground was the difference in hectares.** On the whole unit the proxy's land base was 37–38% larger than the LLOWG's CFLB on A6 and A10. With private land and the excluded tenures left out it is 1% over on A6 and 3% over on A10; A5 has none and stays 4% under. TFL 53 alone was A6's whole difference.
- **A10's old share moved closer, A6's moved away.** A10's old forest went from 28.4% to 28.7% of the CFLB (Board 29.4%). A6's went from 42.7% to 40.4% (Board 43.6%): its 5,828 ha of TFL CFLB was 49% old, the Crown remainder 40%, so leaving the TFL out lowered the share. That is what the inventory says, not a fault of the exclusion, which brought the land base to within 1%. What still separates A6 from the Board is 443 ha of old forest, and two things in the inventory would account for it: 262 ha of CFLB harvested between 2019 and the VRI projection, whose 2019 age is not kept and which is counted as not old though most was likely old when cut, and 1,006 ha of Crown CFLB within 20 years under the old age in 2019 (142 ha within 10), which an older inventory with slightly older ages would have counted. Neither is a method change; both are the VRI vintage question A5 raises.
- **Interior.** Interior's share of old is 45% against 50% on A6 and 48% against 40% on A10. Letting old forest on excluded ground shape interior across the boundary added 7 ha (A6) and 25 ha (A10). A10's pipelines take 85 ha of interior (5,667 without them).
- **A5 does not agree.** Its land base matches to 4%, but old forest is 12 points short of the Board's share. Its 2019 VRI age profile has 2,011 ha within 30 years under the old age. Ages younger in today's VRI than in the LLOWG's inventory of 2019 would explain it; the method would not. A5's figures need the reviewer's inventory before they are relied on.
- **The 2005 method is the Board's.** The 2004 method gives interior of 246, 2,769 and 2,648 ha on these units, far below the Board's, while the 2005 method gives about the Board's share of old forest as interior. This supports decision 6.
- **D.1 matters at the margins.** Counting parks adds 382 ha to A5 and 1,335 ha to A10. Non-legal OGMAs add 556 ha (A6) and 636 ha (A10) of ground that is not old by age.
- **Time.** A unit's first calculation took 12 s (A5) to 90 s (A10) after a read of 20–80 s (the land-base and pipeline reads add a few seconds; leaving the excluded ground out added about 10 s to A10's preparation). A changed setting recalculates without reading again, 3–20 s a year with interior. Interior is calculated for every period of the schedule under review, and for the first and last of the others.

## Limits and what is not built

| Limit                   | Value            | Constant / where               |
| ----------------------- | ---------------- | ------------------------------ |
| Stands read per unit    | 30,000           | `MAX_STANDS`, `reads.ts`       |
| Interior buffer         | 200 m            | `INTERIOR_BUFFER_METRES`       |
| Narrowest interior kept | wider than 200 m | `INTERIOR_MIN_WIDTH_METRES`    |
| Board comparison year   | 2019             | `CALIBRATION_YEAR`, the worker |
| D.4 share of objective  | at most 20%      | `YOUNGER_STANDS_MAX_SHARE`     |
| Pool overlap refused at | 0.01 ha          | `POOL_OVERLAP_TOLERANCE_HA`    |
| Map shapes simplified by | 10 m (display only) | `MAP_SIMPLIFY_METRES`, `drawing.ts` |
| D.3 site index classes  | 5 m steps        | `SITE_INDEX_STEP_METRES`, `representation.ts` |

Not built (each is planned in [Block planner: next steps](forestry-block-planning-next-steps.md)):

- D.3's summary breaks down old forest and the CFLB, not old interior: interior is split only into non-pine and the rest. It is made for the schedule under review alone, and for each pooled unit alone, never for the pool's sum.
- Tenures are read as they stand today, also for the 2019 check: a woodlot or community forest issued or retired since 2019 is treated as it is now.
- A pipeline that holds neither a Crown right-of-way nor a Regulator permit (one on private land under another regulator) is not read.
- The map does not draw what D.4's younger stands add to interior, and does not draw the excluded ground's old forest that shapes interior. It does not colour old forest by species or BEC.
- Units above 30,000 stands (A13 is about 545,000 ha gross), alone or pooled (A3 with A13), wait for the prepared tables in [Prepared tables for the block planner](research/block-planning-prepared-tables-2026-11-24.md).
