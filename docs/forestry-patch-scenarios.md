# Block planning and Prince George forest patch scenarios

Open **Forestry tools → Block planning** at `/dev/forestry/block-planning`. The planner answers one question: if a block is cut now, later, in another shape or not at all, how does the shared landscape's young-forest patch distribution move against the 2004 Prince George order's Objective C targets over the next fifty years? An empty plan opens on step 1 with **Open the sample** (a synthetic teaching landscape) and **Open a plan file**.

## The plan

A plan (`pgmaps-block-plan/v2`, `src/pages/block-planning/plan.ts`) has five parts, and only the last two are opinions:

| Part      | What it holds                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Area      | Historic forest district and natural disturbance sub-unit (the Objective C reporting unit), the first projection year, the inventory's source and date, and the plan, tenure and order versions relied on |
| Baseline  | Past harvests and stand-replacing disturbances every schedule shares, each with a kind, a year and whether that year came from the source, was entered, or was assumed                                    |
| Blocks    | Each proposed block: a name and one or more shapes. A second shape is a reconfigured version of the same block                                                                                            |
| Schedules | When each schedule cuts each block, or that it does not, and which shape. A schedule can follow another moved by a number of years; its own entries override the followed schedule block by block         |
| Reviews   | Per block, the rule packs chosen and the evidence entered; and the landscape's D.5 rationale draft                                                                                                        |

One schedule is marked as the proposal under review; new blocks start in it at the first projection year. Every edit is a function in `edits.ts`, so each interface does exactly the same thing. Files written by the planner before blocks and schedules were separate (`pgmaps-patches-v1`, `pgmaps-block-plan/v1`) open through `migrate.ts`, which turns reference footprints into the baseline, merges a polygon drawn identically in the proposed and alternative schedules into one block, and says what it changed.

## The five steps

1. **Area.** Choose the district and sub-unit (Table 7's targets show under the choice), the first year, and the baseline. **Unit boundary and DataBC** reads the unit and the past disturbances (below); a past disturbance can also be drawn, or imported as GeoJSON polygons with a `year` property (a missing year is assumed five years before the start and marked).
2. **Blocks.** Draw a block with the shared map sketch (click corners; click the first corner or double-click to finish; Backspace takes a corner back) or import GeoJSON. Select a block for its gross area, its shapes, **Draw another shape**, and its overlap with loaded riparian zones.
3. **Schedules.** Add a schedule that follows another moved by some years, a copy to edit, or one that cuts nothing. The grid gives each block's year per schedule; a blank in a following schedule reads through (shown in italics), **Not cut here** overrides it and **Follow again** clears the override.
4. **Compare.** Every schedule's class shares at the year on the map, each class marked closer to or farther from its target since the period before, and how many periods each schedule moved a class away. Where the Forest Practices Board published the reporting unit's 2015 and 2018 distributions (FPB/IRC/235, Appendix 4; `packages/legal-rules/observations/`), they are tabled with each class's movement and drawn in the charts as their own series, never joined to the projection: the two years used different inventories and 2018 the revised 2017 guidance. The **Planning index** ranks the schedules on measured indicators (distance from the targets, periods with a class moving away, area cut in the first ten years and over the horizon), each scaled 0 to 1 across the schedules and weighted, in Index Lab's manner. It is marked as not a legal test everywhere it prints and feeds no review, pathway or finding. **Explain a figure** opens the patch contributions and the field-date priorities for one schedule; both use the same calculation table and formula as Index Lab.
5. **Review.** Two parts. The Prince George order is reviewed once for the landscape: the patch trend is measured from the schedule under review over a chosen five-year interval, and the D.5(b) (rationale, submitted) and D.5(a) (recruitment strategy, submitted and approved by the minister's designate) pathways are checklists whose determinations are the reviewer's answers, never the model's. Every other instrument (FPPR 1.1.0 by default) is reviewed per block. Questions come from the evaluator's trace (`review/questions.ts`): a settled rule asks nothing, and an open rule asks the first unknown of each open alternative, so an empty FPPR case asks one question and each answer unlocks the next. Findings read in words and open the rule flowchart. Releases are chosen per case; installing others happens on `/dev/legal-rules`.

## Real data from DataBC

Step 1's **Unit boundary and DataBC** builds the baseline from public records instead of the sample.

- **The unit.** **Read the order's unit** reads the order's own polygons from DataBC's legal planning objectives layer (`RMP_PLAN_LEGAL_POLY_SVW`, plan "Prince George Timber Supply Area (TSA) Legal Order - Landscape Biodiversity Objective Order - Extent", legalised 2004-10-20; `orderUnits.ts`) and joins those of the chosen district (`ORG_CODE` DPG, DJA or DVA) and sub-unit (`NDZ_NAME`, `NDZ_SUB`) into one area. The layer's attribute pairs are checked by name on every polygon, never by position. It also names the order's landscape units (`UNIT_IDENT`) the sub-unit falls in, which Objectives A and B are set by. **Load a boundary** takes the analysis's own boundary as GeoJSON instead.
- **Past disturbances.** Consolidated cutblocks (the road designer's source, `bcHarvest.ts`; built mostly from RESULTS openings, which are not read again) and historical fire perimeters (WFS, box in `CQL_FILTER` longitude first), each with its source year (`baselineImport.ts`, in a worker). Reads start 20 years before the earlier of the first projection year and 2015, so the plan can be checked against the Board. Each part of a scattered unit is read by its own box, joined only where that adds little area; each record is kept once and named by its opening or fire number. Reading again replaces what an earlier read added and keeps what was drawn or imported. The read is recorded on the plan (`area.baselineRead`: from which year, how far past the unit, when).
- **Patches at the boundary.** With a unit, **Whole patches** (the default) reads disturbances 5 km past it (`BASELINE_MARGIN_METRES`), builds patches from all of them, classes each by its whole size and counts only its young forest inside the unit (the engine's `countWithin`). **Clipped** cuts every patch at the boundary first. The choice is `area.patchExtent`; without a unit the engine runs exactly as before.

## Checking the method against the Board

Compare's **Published 2015 and 2018** opens **Check the method against these figures** (`boardCheck.ts`, in a worker): the calculation run on the baseline alone at 2015 and 2018, each class beside the Board's share with the difference in points. It runs on request, says when the baseline was not read far enough back to hold 2015's young forest, and goes stale when the area or baseline changes. A difference tests today's records and the method together, never one of them: the Board used other inventories, and 2018 the revised 2017 guidance.

What it found on 23 November 2026 (DataBC's cutblocks and fires from 1995, the order's own unit polygons; each row the share of young forest in percent):

| Unit and year                                 | Run           | Under 50 ha | 51–100 ha | 101–1,000 ha | Over 1,000 ha |
| --------------------------------------------- | ------------- | ----------- | --------- | ------------ | ------------- |
| Prince George, Moist Interior–Mountain, 2015  | Board         | 7.7         | 14.9      | 32.0         | 45.3          |
|                                               | Whole patches | 14.1        | 10.0      | 26.4         | 48.8          |
|                                               | Clipped       | 26.8        | 17.5      | 55.8         | 0.0           |
| Prince George, Moist Interior–Mountain, 2018  | Board         | 4.3         | 6.1       | 35.7         | 53.9          |
|                                               | Whole patches | 12.2        | 6.7       | 21.4         | 59.0          |
|                                               | Clipped       | 23.1        | 14.5      | 62.5         | 0.0           |
| Fort St. James, Moist Interior–Mountain, 2015 | Board         | 22.7        | 35.0      | 3.9          | 38.4          |
|                                               | Whole patches | 12.2        | 13.8      | 26.0         | 48.0          |
| Fort St. James, Moist Interior–Mountain, 2018 | Board         | 17.9        | 1.7       | 76.7         | 3.7           |
|                                               | Whole patches | 2.0         | 0.0       | 23.1         | 74.9          |

In Prince George, classing whole patches puts the largest class within 3.5 and 5.1 points of the Board's and keeps its rise from 2015 to 2018, where clipping finds no patch over 1,000 ha at all: the unit's large patches cross its boundary. The smallest class reads 6–8 points high and the 101–1,000 ha class 6–14 low, likely small records in today's consolidated layer that the Board's inventory merged or lacked; this is not resolved. Fort St. James does not reproduce: these records hold only 404 ha of young forest in its unit in 2015, and the Board's own two years disagree sharply (the 101–1,000 ha class goes from 3.9% to 76.7% while the over-1,000 ha class goes from 38.4% to 3.7%), which the revised 2017 method and a different inventory may explain. A whole unit's check took 1–2.5 minutes. Until each unit's check is close, its projections are unvalidated.

**Save & export** offers the plan file, the assessment record (every schedule's periods, the published figures, both reviews' findings, the pathways and the index), the blocks and baseline as GeoJSON with each schedule's cut year, and a printable summary. Each preview is the file that downloads.

The views are the map (the schedule and year chosen in the header, with a year player under it), **Patch classes over time** (one small chart per size class, one line per schedule, the order's target drawn grey) and **Periods and schedules** (every figure as a table). Every schedule is calculated in a worker; editing a review or the rationale never starts a run.

## Interfaces

Guided mode, Ribbon, Guided map and Dashboard (`public/block-planning-layouts.json`, registry in `src/pages/block-planning/interface/`) arrange the same commands and the same five step editors through the shared workspace kit (`docs/workspace-interfaces.md`). Switching keeps the plan, the selection and the year shown. The plan is kept in this browser (`pgmaps-block-planning`).

## Explain a result and prioritize a field visit

Open **Explain the patch calculation** below the map. Pick a size class to see the young hectares divided by the reporting unit’s total young hectares, the target and the movement since the prior period. The contribution table names the input footprints behind each mapped patch. Their shared area counts once. A large current gap and a large move away from target can occur in different classes.

Under **Prioritize field measurements**, enter a plausible disturbance-date error in years. The worker changes one footprint at a time and recalculates both periods, including overlap and patch merging. It ranks cases where a date correction can reverse the Objective C review flag, identifies the smallest correction that does so, and shows changes in evidence availability and class measurements. Choose a range supported by the inventory. The tool has no preset accuracy estimate for VRI.

For a worked example choose **Landscape → Load Prince George sample**, **Proposed harvest**, map year **2031**, and a **±1 year** test. In this synthetic landscape Opening A and Harvest now can each reverse the flag. Opening A can move a current class share by about 66.67 percentage points. Harvest now can change the prior-period comparison while leaving the 2031 class shares unchanged. Opening B has no effect over the same range.

Use **Test a field measurement** for different lower and upper disturbance years or enter one observed year twice. Record the source. A missing input year supplied by the editor default is labelled in the comparison. The test assumes that geometry and all other dates stay fixed. Stand age from VRI needs a supported link to the date of a stand-replacing disturbance. Boundary uncertainty can be examined by redrawing or importing a surveyed footprint in a separate saved plan. The automated field-priority calculation covers dates only. Joint inventory errors and the relative likelihood of year estimates need additional evidence.

Both assessment exports include the displayed contribution table, source geometries and completed field comparisons for the active inputs. The scenarios are exploratory and leave the reviewer’s D.5 determinations independent. The historical benchmark covers all 25 Prince George district A/B units and six published C distributions. [Prince George order validation and worked historical cases](prince-george-order-validation.md)

## Install the source package

From the repository root, run the following against the original ZIP. The first command installs Table 7 and its provenance in the existing PR 144 order format. The second checks reproducibility.

```sh
python3 scripts/legal-rules/install-patch-order.py path/to/package.zip
python3 scripts/legal-rules/install-patch-order.py path/to/package.zip --check
```

The installer reads two named JSON members without extracting or executing files. It checks the source URL, provision, signature date, nine unit names, class keys, percentage ranges and totals before replacing the record. The table member's SHA-256 travels with exports. The order record also identifies D.5(a) recruitment strategy approval and D.5(b) rationale submission. Published targets, class limits, age window and merge distances are read from JSON. Legal applicability, later orders and review remain unresolved for user-supplied polygons. Full FRPA/FPPR interpretation and old-interior recruitment simulation are outside the patch calculation. What Objectives A and B would need, and the decisions left to the owner, are in [Old forest under the Prince George order](research/prince-george-old-forest-2026-11-23.md).

## Spatial method and validation

Method `pg-2005-buffer-v1` takes the union of all qualifying footprints aged 0–20 inclusive in each period. Overlaps count once. Starting with disjoint polygon parts, it applies the 2005 guidance's five size-dependent stages. At each stage it groups eligible neighbours transitively within the stated join distance, dissolves buffered neighbours and erodes the result by the same distance. With a reporting unit and whole patches, the footprints are those read up to 5 km past the unit; every stage runs on them all, and a patch's young hectares inside the unit are what it contributes to its class and the denominator (`Project.countWithin`). A patch with none inside is left out. A dissolved group keeps its identity through subsequent stages, including when its eroded shape has multiple parts. Unjoined shapes retain their original geometry. A group's envelope area determines subsequent eligibility and final class. Its original young hectares contribute to the denominator, excluding the bridged land. These are modelling interpretations pending comparison with the original GIS outputs. Printed thresholds are applied literally. Areas in the gaps at 50–<51 and >100–<101 ha remain unclassified and are reported in the denominator. A zero denominator produces undefined percentages.

The change in absolute distance from the target compares one class across two periods. The Board's Table 2 records 22.7% and 17.9% against 20% for the under-50 class in Fort St. James, Moist Interior–Mountain. That is a 0.6 percentage-point move closer. It tests the arithmetic only. The spatial comparison is the Board check above; the original inventories and the revised 2017 method would be needed to reproduce it exactly. Projected percentages cannot establish the legal trigger, the shortest practicable recovery or permission to harvest.

[Prince George order and revised implementation policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf) · [Forest Practices Board investigation, Table 2](https://www.bcfpb.ca/wp-content/uploads/2021/05/IRC235-PG-TSA-Biodiversity.pdf)

## Comparable implementations

Ontario’s Forest Management Planning Manual connects spatial harvest schedules to strategic analysis over short, medium and long horizons. The planning team documents adjustments and their effects on objectives. In PGMaps, dated polygons and alternative schedules preserve the inputs behind each projected distribution. [Ontario Forest Management Planning Manual](https://www.ontario.ca/files/2024-05/mnrf-cflpb-planning-manual-2024-05-16.pdf)

In New South Wales, large mines submit spatial rehabilitation data for the final landform plan, annual reporting and a three-year forward program. The regulator publishes a GIS submission schema. PGMaps uses the same design principle of giving the geometry, reporting period and evidence explicit fields. Each jurisdiction needs its own reviewed rule pack and filing format. [Mine Rehabilitation Portal](https://www.resources.nsw.gov.au/resources-regulator/mine-rehabilitation/rehabilitation-regulation-and-compliance/mrp) · [NSW rehabilitation requirements](https://www.resources.nsw.gov.au/resources-regulator/mine-rehabilitation/rehabilitation-regulation-and-compliance/regulating)
