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

1. **Area.** Choose the district and sub-unit (Table 7's targets show under the choice), the first year, and the baseline: draw a past disturbance or import GeoJSON polygons with a `year` property (a missing year is assumed five years before the start and marked).
2. **Blocks.** Draw a block with the shared map sketch (click corners; click the first corner or double-click to finish; Backspace takes a corner back) or import GeoJSON. Select a block for its gross area, its shapes, **Draw another shape**, and its overlap with loaded riparian zones.
3. **Schedules.** Add a schedule that follows another moved by some years, a copy to edit, or one that cuts nothing. The grid gives each block's year per schedule; a blank in a following schedule reads through (shown in italics), **Not cut here** overrides it and **Follow again** clears the override.
4. **Compare.** Every schedule's class shares at the year on the map, each class marked closer to or farther from its target since the period before, and how many periods each schedule moved a class away. **Explain a figure** opens the patch contributions and the field-date priorities for one schedule.
5. **Review.** The D.5(a)/(b) text and the rationale draft, and the rule review of the selected block, which reads the patch trend from the schedule under review at the year on the map.

The views are the map (the schedule and year chosen in the header, with a year player under it), **Patch classes over time** (one small chart per size class, one line per schedule, the order's target drawn grey) and **Periods and schedules** (every figure as a table). Every schedule is calculated in a worker; editing a review or the rationale never starts a run.

## Interfaces

Guided mode, Ribbon, Guided map and Dashboard (`public/block-planning-layouts.json`, registry in `src/pages/block-planning/interface/`) arrange the same commands and the same five step editors through the shared workspace kit (`docs/workspace-interfaces.md`). Switching keeps the plan, the selection and the year shown. The plan is kept in this browser (`pgmaps-block-planning`); **Save & export** writes the plan file.

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

The installer reads two named JSON members without extracting or executing files. It checks the source URL, provision, signature date, nine unit names, class keys, percentage ranges and totals before replacing the record. The table member's SHA-256 travels with exports. The order record also identifies D.5(a) recruitment strategy approval and D.5(b) rationale submission. Published targets, class limits, age window and merge distances are read from JSON. Legal applicability, later orders and review remain unresolved for user-supplied polygons. Full FRPA/FPPR interpretation and old-interior recruitment simulation are outside the patch calculation.

## Spatial method and validation

Method `pg-2005-buffer-v1` takes the union of all qualifying footprints aged 0–20 inclusive in each period. Overlaps count once. Starting with disjoint polygon parts, it applies the 2005 guidance's five size-dependent stages. At each stage it groups eligible neighbours transitively within the stated join distance, dissolves buffered neighbours and erodes the result by the same distance. A dissolved group keeps its identity through subsequent stages, including when its eroded shape has multiple parts. Unjoined shapes retain their original geometry. A group's envelope area determines subsequent eligibility and final class. Its original young hectares contribute to the denominator, excluding the bridged land. These are modelling interpretations pending comparison with the original GIS outputs. Printed thresholds are applied literally. Areas in the gaps at 50–<51 and >100–<101 ha remain unclassified and are reported in the denominator. A zero denominator produces undefined percentages.

The change in absolute distance from the target compares one class across two periods. The Board's Table 2 records 22.7% and 17.9% against 20% for the under-50 class in Fort St. James, Moist Interior–Mountain. That is a 0.6 percentage-point move closer. It tests the arithmetic only. The original inventories and the revised 2017 method used in the 2018 analysis are needed to reproduce the spatial comparison. Projected percentages cannot establish the legal trigger, the shortest practicable recovery or permission to harvest.

[Prince George order and revised implementation policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf) · [Forest Practices Board investigation, Table 2](https://www.bcfpb.ca/wp-content/uploads/2021/05/IRC235-PG-TSA-Biodiversity.pdf)

## Comparable implementations

Ontario’s Forest Management Planning Manual connects spatial harvest schedules to strategic analysis over short, medium and long horizons. The planning team documents adjustments and their effects on objectives. In PGMaps, dated polygons and alternative schedules preserve the inputs behind each projected distribution. [Ontario Forest Management Planning Manual](https://www.ontario.ca/files/2024-05/mnrf-cflpb-planning-manual-2024-05-16.pdf)

In New South Wales, large mines submit spatial rehabilitation data for the final landform plan, annual reporting and a three-year forward program. The regulator publishes a GIS submission schema. PGMaps uses the same design principle of giving the geometry, reporting period and evidence explicit fields. Each jurisdiction needs its own reviewed rule pack and filing format. [Mine Rehabilitation Portal](https://www.resources.nsw.gov.au/resources-regulator/mine-rehabilitation/rehabilitation-regulation-and-compliance/mrp) · [NSW rehabilitation requirements](https://www.resources.nsw.gov.au/resources-regulator/mine-rehabilitation/rehabilitation-regulation-and-compliance/regulating)
