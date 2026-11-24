# Old and old interior forest (Objectives A and B) in the block planner

**Compare → Old and old interior forest** calculates Objectives A and B of the 2004 Prince George order for one of its Map 2 units, or for units the reviewer pools under D.2: old forest against the unit's share of the Crown Forest Land Base (CFLB), old non-pine-leading forest against the implementation policy's Tables 8–10, and old interior forest against the required old forest. It runs for every schedule over the plan's eleven periods. Code: `src/pages/block-planning/oldForest/` (`units.ts`, `reads.ts`, `oldForest.ts`, `youngerStands.ts`, `pooling.ts`, `oldForest.worker.ts`), the panel `OldForestSection.tsx`, the record `records.ts`. Research behind it: [Old forest under the Prince George order](research/prince-george-old-forest-2026-11-23.md).

The figures are VRI age-based and not field-verified. Nothing in the planner decides whether D.5(a) applies. D.5(a)'s _Recruitment analysis_ step shows the result beside the reviewer's own entry, and never writes into it.

## Decisions (24 November 2026)

The research note ended with eight open questions. Each is answered here, with the evidence. Change a decision only with new evidence, and change this page with the code.

| #   | Question                                | Decision                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A10: 17% or 12%?                        | **17%.** The order's tables are the targets. Where DataBC's legal layer carries a different `OLD_RETEN`, the panel and the summary say so and use the order's figure (`gisDisagrees`).                                                                                                                                                                                                            | Four sources say 17%: the order's Table 3 (p. 6), the policy's Table 10, the 2015 TSR data package (old 17%, non-pine 14%, A7 and A10), and the Board's 2019 table (required 6,655 ha = 17% × 39,145 ha). Only the GIS layer's `LEGAL_FEAT_ATRB_7` says 0.12. `units.test.ts` checks every unit's targets against the Board.                                                                                                        |
| 2   | Where does the CFLB come from?          | **A VRI proxy by default:** treed (`BCLCS_LEVEL_2 = 'T'`) on the forest management land base (`FOR_MGMT_LAND_BASE_IND = 'Y'`) within the unit. The reviewer may state a CFLB (the LLOWG's, say) with its source. It then takes the proxy's shares: every area is measured on the proxy's ground and scaled by the stated CFLB over the proxy's. A prepared FAIB land base is future work (below). | No public CFLB layer exists for the TSA, and FAIB's THLB/AFLB files are about 1 GB file geodatabases. Against the Board's 2019 figures (below), the proxy's hectares were 4% under to 38% over, while old forest's share of it was within a point of theirs on A6 and A10. Hence shares, not hectares: a stated 39,145 ha for A10 beside old forest measured on the proxy's 53,936 ha would have overstated the surplus by a third. |
| 3   | Are NFAs old for ever?                  | **Old until harvested.** A beetle-killed stand keeps its VRI age, so no special rule is needed. A harvest record after the projection, or a block, resets it.                                                                                                                                                                                                                                     | The policy (p. 3) counts NFAs as old; the 2015 TSR data package counted them old until regenerated and harvested.                                                                                                                                                                                                                                                                                                                   |
| 4   | ICH old age?                            | **Older than 140**, as the LLOWG and the Board counted A22, A23 and E13. The age basis prints with every result.                                                                                                                                                                                                                                                                                  | The policy's footnote leaves ICH "requires more discussion"; the Board's table lists 141 for all three.                                                                                                                                                                                                                                                                                                                             |
| 5   | Pool A3 and A13?                        | **Never by default.** One unit is assessed alone unless the reviewer pools units under D.2 (_Pool with other units_, see **D.2: pooling units**). Whether units are similar mBECs is the reviewer's judgement.                                                                                                                                                                                    | The order's "combined with A13" is D.2-style pooling. The GIS and the Board keep A3 and A13 apart.                                                                                                                                                                                                                                                                                                                                  |
| 6   | 2005 or 2004 interior method?           | **2005 by default**, the 2004 method as an option.                                                                                                                                                                                                                                                                                                                                                | The policy records the 2005 revision as agreed by the Landscape Objective Working Group on 22 June 2005.                                                                                                                                                                                                                                                                                                                            |
| 7   | Import approved recruitment strategies? | **Yes, spatial ones:** _Add areas_ takes GeoJSON polygons, each with its approval reference, and D.1 counts them whole. Aspatial strategies (most of the approved ones) cannot be drawn and are not counted.                                                                                                                                                                                      | D.1 counts "any new spatially located old forest retention areas established after the enforcement of this order" whole. The Board names one spatial and six non-spatial strategies (2012–14).                                                                                                                                                                                                                                      |
| 8   | May a deficit year prefill D.5(a)?      | **Display only.** The analysis step shows the first shortfall beside the reviewer's entry; the determination, the analysis named and every other field stay the reviewer's.                                                                                                                                                                                                                       | AGENTS.md: a D.5 determination is always the reviewer's answer.                                                                                                                                                                                                                                                                                                                                                                     |

Three more choices the order forced, each a switch in the panel:

- **OGMAs.** D.1 counts "the entire area" of OGMAs whole, whatever their age. Legal OGMAs always count. Non-legal ones count by default, since the Board found the LLOWG counting them, and can be switched off.
- **Parks.** D.1 says parks "may contribute", so they are off by default and switched on by the reviewer.
- **Corridors.** The 2005 method buffers forest service roads, railways, pipelines and hydro corridors. FSRs (`FTEN_ROAD_SECTION_LINES_SVW`, _Forest Service Road_), railways and transmission lines are read. Pipelines are not: no layer was checked for coverage, so interior next to a pipeline is overstated.

## Method

- **Units.** The 48 units of Tables 1–6 are data in `packages/legal-rules/rules/bc/prince-george/2004-biodiversity-order.json`, with the non-pine minimums from policy Tables 8–10. The Board's 2019 table (Appendix 1) is in `packages/legal-rules/observations/fpb-irc-235.json`. A unit's old age comes from the policy's rule (`oldAgeRule`). `units.test.ts` holds it equal to the Board's age on all 49 rows, and the Board's required hectares equal to the order's percentages.
- **Reads** (`reads.ts`). These run in the worker, live from DataBC, and are kept for the session:
  - the unit's Map 2 polygons;
  - VRI rank 1 stands touching them;
  - legal and non-legal OGMAs and parks;
  - FSRs, railways and transmission lines.

  Each read follows the unit's own shapes (`INTERSECTS` per part, by POST), never its box. A10's box holds 153,680 VRI polygons against 6,333 that touch the unit. A unit with more than `MAX_STANDS` (30,000) stands is refused and needs the prepared tables below.

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

The pool's CFLB is 35,242 ha (12,887 + 22,354, both proxies). A5 alone is short of old and old interior in 2019 (interior 1,411 of 1,495 ha); pooled with A6 there is no shortfall over the projection. Each unit's figures are its figures alone, to the hectare those of the Board table below.

With D.4 on from 100 years, A5 alone in 2019 has 2,497 ha of younger stands toward old forest and counts 747 ha (20% of 3,737); it stays short of old forest (2,807 + 747 < 3,737), while its old interior, 84 ha short, is met only with D.4 (299 ha counted of 1,529 ha the younger stands add). The pool counts 2,044 ha toward old (of 3,979 ha) and 818 ha toward interior (of 2,304 ha), without needing either. Through the worker, reading both units live and calculating three schedules with D.4 took 201 s; recalculating without D.4 from the session's reads took 61 s.

## Checked against the Board's 2019 figures

The panel's _Check against the Board's 2019 figures_ runs the baseline alone in 2019 and sets it beside the Board's Appendix 1 row (the 2019 LLOWG analysis). Run on 24 November 2026:

| Unit (old from)    | CFLB: proxy / Board | Old forest: modelled / Board | Old share of CFLB: modelled / Board | Interior: modelled / Board | Interior share of old: modelled / Board |
| ------------------ | ------------------- | ---------------------------- | ----------------------------------- | -------------------------- | --------------------------------------- |
| A5 (141, ESSF)     | 12,887 / 13,478 ha  | 2,807 / 4,534 ha             | 21.8% / 33.6%                       | 1,411 / 2,303 ha           | 50% / 51%                               |
| A6 (141, ESSF wk1) | 22,354 / 16,344 ha  | 9,535 / 7,124 ha             | 42.7% / 43.6%                       | 4,705 / 3,573 ha           | 49% / 50%                               |
| A10 (121, SBS wk1) | 53,936 / 39,145 ha  | 15,323 / 11,515 ha           | 28.4% / 29.4%                       | 6,685 / 4,585 ha           | 44% / 40%                               |

Defaults: legal and non-legal OGMAs counted, parks not, the 2005 interior method.

- **Shares agree where hectares do not.** The proxy's land base is 37–38% larger than the LLOWG's CFLB on A6 and A10, yet old forest's share of it is within a point of theirs, and interior's share of old within four. The extra ground looks like land the LLOWG left out (private land and excluded tenures are not removed from the proxy) with the same age structure. Hence decision 2's shares.
- **A5 does not agree.** Its land base matches to 4%, but old forest is 12 points short of the Board's share. Its 2019 VRI age profile has 2,011 ha within 30 years under the old age. Ages younger in today's VRI than in the LLOWG's inventory of 2019 would explain it; the method would not. A5's figures need the reviewer's inventory before they are relied on.
- **The 2005 method is the Board's.** The 2004 method gives interior of 246, 2,769 and 2,648 ha on these units, far below the Board's, while the 2005 method gives about the Board's share of old forest as interior. This supports decision 6.
- **D.1 matters at the margins.** Counting parks adds 382 ha to A5 and 1,335 ha to A10. Non-legal OGMAs add 556 ha (A6) and 636 ha (A10) of ground that is not old by age.
- **Time.** A unit's first calculation took 12 s (A5) to 80 s (A10) after a read of 20–80 s. A changed setting recalculates without reading again, 3–20 s a year with interior. Interior is calculated for every period of the schedule under review, and for the first and last of the others.

## Limits and what is not built

| Limit                   | Value            | Constant / where               |
| ----------------------- | ---------------- | ------------------------------ |
| Stands read per unit    | 30,000           | `MAX_STANDS`, `reads.ts`       |
| Interior buffer         | 200 m            | `INTERIOR_BUFFER_METRES`       |
| Narrowest interior kept | wider than 200 m | `INTERIOR_MIN_WIDTH_METRES`    |
| Board comparison year   | 2019             | `CALIBRATION_YEAR`, the worker |
| D.4 share of objective  | at most 20%      | `YOUNGER_STANDS_MAX_SHARE`     |
| Pool overlap refused at | 0.01 ha          | `POOL_OVERLAP_TOLERANCE_HA`    |

Not built (each is planned in [Block planner: next steps](forestry-block-planning-next-steps.md)):

- D.3 representativeness beyond the non-pine figure.
- Pipelines.
- Private land and excluded tenures (woodlots, community forests, TFLs) are not removed from the proxy CFLB.
- No map layer of old or interior ground yet.
- Units above 30,000 stands (A13 is about 545,000 ha gross), alone or pooled (A3 with A13), wait for the prepared tables in [Prepared tables for the block planner](research/block-planning-prepared-tables-2026-11-24.md).
