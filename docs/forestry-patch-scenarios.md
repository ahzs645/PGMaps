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
5. **Review.** Two parts. The Prince George order is reviewed once for the landscape: the patch trend is measured from the schedule under review over a chosen five-year interval, and the D.5(b) (rationale, submitted) and D.5(a) (recruitment strategy, submitted and approved by the minister's designate) pathways are checklists whose determinations are the reviewer's answers, never the model's. Every other instrument (FPPR 1.1.0 by default) is reviewed per block. Questions come from the evaluator's trace (`review/questions.ts`): a settled rule asks nothing, and an open rule asks the first unknown of each open alternative, so an empty FPPR case asks one question and each answer unlocks the next. Findings read in words and open the rule flowchart. [Crown grazing and reforestation](forestry-crown-grazing.md) has its own review for the selected block and schedule: whether the block can be cut given that the stand must come back. Releases are chosen per case; installing others happens on `/dev/legal-rules`.

What is still open is listed, in order, in [Block planner: next steps](forestry-block-planning-next-steps.md).

## Real data from DataBC

Step 1's **Unit boundary and DataBC** builds the baseline from public records instead of the sample.

- **The unit.** **Read the order's unit** reads the order's own polygons from DataBC's legal planning objectives layer (`RMP_PLAN_LEGAL_POLY_SVW`, plan "Prince George Timber Supply Area (TSA) Legal Order - Landscape Biodiversity Objective Order - Extent", legalised 2004-10-20; `orderUnits.ts`) and joins those of the chosen district (`ORG_CODE` DPG, DJA or DVA) and sub-unit (`NDZ_NAME`, `NDZ_SUB`) into one area. The layer's attribute pairs are checked by name on every polygon, never by position. A sub-unit without a second name (McGregor Plateau, Wet Mountain, Northern Boreal Mountains) carries a single space in `NDZ_SUB`, not an empty value; until 24 November 2026 the reader asked for an empty one and found none of their polygons. It also names the order's landscape units (`UNIT_IDENT`) the sub-unit falls in, which Objectives A and B are set by. **Load a boundary** takes the analysis's own boundary as GeoJSON instead.
- **Past disturbances.** Consolidated cutblocks (the road designer's source, `bcHarvest.ts`; built mostly from RESULTS openings, which are not read again) and historical fire perimeters (WFS, box in `CQL_FILTER` longitude first), each with its source year (`baselineImport.ts`, in a worker). Reads start 20 years before the earlier of the first projection year and 2015, so the plan can be checked against the Board. Each part of a scattered unit is read by its own box, joined only where that adds little area; each record is kept once and named by its opening or fire number. Cutblocks are paged by `OBJECTID` (`readCutblockPages`): the service cuts pages short on its transfer limit (105, 488, even 0 of 1,000 records, each flagged as having more), and a reader that stopped at the first short page lost 134 of Prince George Moist Interior – Mountain's 2,739 cutblocks. A page the service takes too long over comes back from the gateway as 502 or 504 after two minutes; it is asked again at half the size (from about 08:00 UTC on 24 November 2026 every read of Prince George Moist Interior – Mountain failed this way at 1,000 records a page, and 500 came back in a minute). Reading again replaces what an earlier read added and keeps what was drawn or imported. The read is recorded on the plan (`area.baselineRead`: from which year, how far past the unit, when).
- **Patches at the boundary.** With a unit, **Whole patches** (the default) reads disturbances 5 km past it (`BASELINE_MARGIN_METRES`), builds patches from all of them, classes each by its whole size and counts only its young forest inside the unit (the engine's `countWithin`). **Clipped** cuts every patch at the boundary first. The choice is `area.patchExtent`; without a unit the engine runs exactly as before.

## Checking the method against the Board

Compare's **Published 2015 and 2018** opens **Check the method against these figures** (`boardCheck.ts`, in a worker; kept with the plan as `checks.board`, so the assessment record and the printed summary carry it and say when it is out of date): the calculation run on the baseline alone at 2015 and 2018, each class beside the Board's share with the difference in points. It runs on request, says when the baseline was not read far enough back to hold 2015's young forest, and goes stale when the area or baseline changes. A difference tests today's records and the method together, never one of them: the Board used other inventories, and 2018 the revised 2017 guidance.

The check runs on the baseline's harvests alone. The Board's figures are the LLOWG's, which collects licensees' harvest, road and retention data, not fire perimeters, and leaving fires out brought the check closer in both years and both units tried. The projections keep fires: burned ground is young forest.

What it found (24 November 2026; DataBC's cutblocks and fires from 1995, the order's own unit polygons, whole patches; each row is the share of young forest in percent):

| Unit and year                                 | Run                 | Under 50 ha | 51–100 ha | 101–1,000 ha | Over 1,000 ha | Summed difference |
| --------------------------------------------- | ------------------- | ----------- | --------- | ------------ | ------------- | ----------------- |
| Prince George, Moist Interior–Mountain, 2015  | Board               | 7.7         | 14.9      | 32.0         | 45.3          |                   |
|                                               | **Harvests only**   | 15.1        | 10.7      | 29.4         | 44.0          | 15.5              |
|                                               | With fires          | 14.1        | 10.0      | 26.4         | 48.8          | 20.5              |
|                                               | Clipped, with fires | 26.8        | 17.5      | 55.8         | 0.0           | 90.8              |
| Prince George, Moist Interior–Mountain, 2018  | Board               | 4.3         | 6.1       | 35.7         | 53.9          |                   |
|                                               | **Harvests only**   | 12.6        | 7.1       | 23.8         | 55.7          | 23.1              |
|                                               | With fires          | 12.2        | 6.7       | 21.4         | 59.0          | 28.0              |
| Fort St. James, Moist Interior–Mountain, 2015 | Board               | 22.7        | 35.0      | 3.9          | 38.4          |                   |
|                                               | **Harvests only**   | 11.9        | 13.8      | 26.0         | 48.2          | 63.9              |
| Fort St. James, Moist Interior–Mountain, 2018 | Board               | 17.9        | 1.7       | 76.7         | 3.7           |                   |
|                                               | **Harvests only**   | 6.5         | 0.1       | 79.2         | 14.2          | 25.9              |
|                                               | With fires          | 2.0         | 0.0       | 23.1         | 74.9          | 142.3             |

The summed difference is the four classes' absolute differences from the Board, in points. What it shows:

- **Fires.** In Fort St. James in 2018 one fire made the largest class 74.9% against the Board's 3.7%; without fires the 101–1,000 ha class reads 79.2% against 76.7%.
- **Whole patches.** In Prince George, classing whole patches keeps the largest class within two points of the Board's in both years, where clipping at the boundary finds no patch over 1,000 ha at all.
- **Still unexplained.** The smallest class reads 7–8 points high in Prince George (and high in most other sub-units: see **The other ten sub-units**), and Fort St. James 2015 does not reproduce: these records hold only about 400 ha of young forest in that unit in 2015.

**Is it a time horizon?** Prince George Moist Interior – Mountain was run with every dating change that could explain an offset. For 2015 none brought it closer than the plain run (summed difference 20.5 with fires):

| Variant                                         | 2015      | 2018      |
| ----------------------------------------------- | --------- | --------- |
| As read (with fires)                            | 20.5      | 28.0      |
| Young window 0–19 years instead of 0–20         | 21.3      | 27.6      |
| The assessment year's own disturbances left out | 46.5      | 21.8      |
| Assessed one or two years earlier               | 29.8–36.3 | 21.0–22.3 |
| Assessed one year later                         | 28.8      | 43.7      |
| Harvest dated by its mid year                   | 22.5      | 30.9      |
| Harvest dated by its end year                   | 29.0      | 22.1      |
| Records under 1, 2 or 5 ha dropped              | 20.4–23.4 | 25.1–32.2 |
| **Fires left out**                              | **15.5**  | **23.1**  |

So there is no single offset, and the window and dating rules stay as the policy states them. 2018 alone fits better when its own year's records are left out, or when it is assessed a year or two earlier. That is consistent with the 2018 interim analysis having been run before that year's harvest records and fires were in. A tiny record (521 of 2,772 are under 1 ha) is not what inflates the smallest class.

**The other ten sub-units.** Run on 24 November 2026 from Node through `boardCheck` itself, one at a time, on the same reads as the browser's (the order's own unit polygons, whole patches with disturbances read 5 km past the unit, DataBC's cutblocks from 1995, harvests only). Each cell is the Board's share, then the model's, in percent of the young forest; the last two columns are in points.

| Sub-unit and year                              | Under 50 ha | 51–100 ha   | 101–1,000 ha | Over 1,000 ha | Largest class difference | Summed difference |
| ---------------------------------------------- | ----------- | ----------- | ------------ | ------------- | ------------------------ | ----------------- |
| Fort St. James, Moist Interior – Plateau, 2015 | 5.8 / 10.3  | 6.9 / 6.3   | 15.0 / 11.3  | 71.4 / 71.8   | 4.5                      | 9.1               |
| Fort St. James, Moist Interior – Plateau, 2018 | 4.8 / 9.9   | 5.4 / 5.2   | 14.0 / 9.4   | 75.9 / 75.4   | 5.1                      | 10.4              |
| Fort St. James, Omineca – Mountain, 2015       | 17.7 / 24.1 | 27.8 / 27.3 | 25.9 / 19.7  | 28.5 / 27.9   | 6.4                      | 13.8              |
| Fort St. James, Omineca – Mountain, 2018       | 15.4 / 21.9 | 28.4 / 20.3 | 21.7 / 34.5  | 34.5 / 22.8   | 12.8                     | 39.2              |
| Fort St. James, Omineca – Valley, 2015         | 11.7 / 16.4 | 14.5 / 13.0 | 39.2 / 31.4  | 34.6 / 38.4   | 7.8                      | 17.7              |
| Fort St. James, Omineca – Valley, 2018         | 10.1 / 13.9 | 10.3 / 8.9  | 27.5 / 23.6  | 52.1 / 53.0   | 3.9                      | 10.0              |
| Prince George, McGregor Plateau, 2015          | 10.4 / 16.1 | 13.2 / 13.1 | 27.6 / 27.4  | 48.9 / 42.6   | 6.3                      | 12.4              |
| Prince George, McGregor Plateau, 2018          | 8.5 / 12.2  | 9.0 / 9.7   | 34.8 / 26.5  | 47.7 / 51.3   | 8.3                      | 16.3              |
| Prince George, Moist Interior – Plateau, 2015  | 5.1 / 10.3  | 4.0 / 4.1   | 10.9 / 9.7   | 80.0 / 75.6   | 5.2                      | 10.9              |
| Prince George, Moist Interior – Plateau, 2018  | 4.3 / 10.9  | 3.2 / 3.9   | 9.2 / 9.8    | 83.3 / 75.2   | 8.1                      | 15.9              |
| Prince George, Wet Mountain, 2015              | 23.9 / 33.4 | 40.4 / 32.6 | 35.7 / 25.1  | 0.0 / 5.7     | 10.6                     | 33.6              |
| Prince George, Wet Mountain, 2018              | 17.9 / 22.8 | 28.6 / 18.0 | 42.4 / 36.6  | 11.1 / 21.0   | 10.6                     | 31.3              |
| Prince George, Wet Trench – Mountain, 2015     | 29.3 / 26.5 | 42.1 / 33.6 | 20.1 / 10.9  | 8.6 / 28.5    | 19.9                     | 40.3              |
| Prince George, Wet Trench – Mountain, 2018     | 22.1 / 19.2 | 20.6 / 17.7 | 42.4 / 29.1  | 14.9 / 32.9   | 18.0                     | 37.2              |
| Prince George, Wet Trench – Valley, 2015       | 24.8 / 28.4 | 32.1 / 27.7 | 33.5 / 25.1  | 9.7 / 17.9    | 8.4                      | 24.5              |
| Prince George, Wet Trench – Valley, 2018       | 25.7 / 27.5 | 26.2 / 23.6 | 32.4 / 33.7  | 15.7 / 14.2   | 2.6                      | 7.2               |
| Vanderhoof, Moist Interior – Mountain, 2015    | 6.1 / 13.0  | 9.1 / 7.7   | 10.5 / 15.4  | 74.3 / 63.4   | 10.9                     | 24.1              |
| Vanderhoof, Moist Interior – Mountain, 2018    | 4.8 / 9.5   | 5.1 / 3.1   | 9.2 / 13.9   | 80.9 / 73.2   | 7.7                      | 19.2              |
| Vanderhoof, Moist Interior – Plateau, 2015     | 6.4 / 12.8  | 3.8 / 5.1   | 10.5 / 11.2  | 79.2 / 70.7   | 8.5                      | 16.9              |
| Vanderhoof, Moist Interior – Plateau, 2018     | 6.4 / 12.9  | 3.6 / 5.1   | 10.0 / 11.2  | 80.0 / 70.7   | 9.3                      | 18.4              |

What each took, and what the run changed to get there. The cutblocks are those read in the unit's boxes and those kept within 5 km of it; the fires were read and left out, as the check does.

| Sub-unit                                 | Unit         | Order units                    | Cutblocks read / kept | Fires left out | Read  | Check   | Note                                    |
| ---------------------------------------- | ------------ | ------------------------------ | --------------------- | -------------- | ----- | ------- | --------------------------------------- |
| Fort St. James, Moist Interior – Plateau | 705,189 ha   | E2, E3, E4, E5                 | 18,748 / 10,259       | 92             | 507 s | 810 s   |                                         |
| Fort St. James, Omineca – Mountain       | 940,554 ha   | E9, E10, E11                   | 25,677 / 5,427        | 93             | 614 s | 649 s   | over 25,000 records: cap raised         |
| Fort St. James, Omineca – Valley         | 924,289 ha   | E12, E13, E14, E15, E16, E17   | 26,393 / 7,290        | 111            | 719 s | 726 s   | over 25,000 records: cap raised         |
| Prince George, McGregor Plateau          | 465,018 ha   | A2, A3, A4                     | 12,571 / 7,018        | 38             | 417 s | 150 s   | needed the sub-unit fix                 |
| Prince George, Moist Interior – Plateau  | 1,150,783 ha | A7, A8, A9, A10, A11, A12, A13 | 40,078 / 22,790       | 177            | 693 s | 3,151 s | over 25,000 records: cap raised         |
| Prince George, Wet Mountain              | 574,540 ha   | A14, A15, A16, A17             | 8,258 / 3,132         | 22             | 453 s | 51 s    | needed the sub-unit fix                 |
| Prince George, Wet Trench – Mountain     | 580,754 ha   | A18, A19, A20, A21             | 10,301 / 3,531        | 64             | 502 s | 1,238 s | unit grown polygon by polygon           |
| Prince George, Wet Trench – Valley       | 575,923 ha   | A22, A23, A24, A25             | 10,229 / 4,410        | 80             | 390 s | 6,202 s | unit grown polygon by polygon, in steps |
| Vanderhoof, Moist Interior – Mountain    | 154,181 ha   | D1                             | 23,758 / 8,151        | 90             | 496 s | 566 s   |                                         |
| Vanderhoof, Moist Interior – Plateau     | 1,233,792 ha | D2, D3, D4, D5, D6, D7         | 46,261 / 22,317       | 270            | 606 s | 3,339 s | over 25,000 records: cap raised         |

- **The browser cannot run six of them yet.** Four read more than the planner's 25,000 records (`MAX_BASELINE_RECORDS`); the run raised the cap in its own copy of the reader only, so their figures are the method's but the planner refuses the read. On both Wet Trench units the browser's 5 km grow (`grownUnit`, one buffer of the whole unit) ran out of a 5 GB heap; the run grew each polygon on its own and, for Wet Trench – Valley's 48,000-point polygon, in steps of 50, 200, 750, 2,000 and 2,000 m, which draws the same shape (the buffer of a union is the union of the buffers, and a disc grown by a disc is a larger disc). The slowest checks took 52 and 56 minutes (the two Moist Interior – Plateau units) and 1 hour 43 minutes (Wet Trench – Valley, after a first try stopped at an hour) in Node; the prepared tables in [the next steps](forestry-block-planning-next-steps.md) are their way into the browser.
- **The two units read again agree with the table above to the decimal.** Prince George and Fort St. James Moist Interior – Mountain, read again on the day, give 15.5 and 23.1, and 63.9 and 25.9.
- **Close on the plateau and valley units.** Five come within 9–18 points in both years: Fort St. James Moist Interior – Plateau, Fort St. James Omineca – Valley, McGregor Plateau, Prince George and Vanderhoof Moist Interior – Plateau. Wet Trench – Valley comes within 7.2 points in 2018 and 24.5 in 2015.
- **Far in Wet Mountain and Wet Trench – Mountain.** The model puts 6–20 points more young forest than the Board in patches over 1,000 ha and less in the middle classes. Clipping patches at the boundary does not explain it (table below): it changes Wet Mountain by at most 2 points, and on Wet Trench – Mountain it empties the largest class (0% against the Board's 8.6% and 14.9%). On Vanderhoof Moist Interior – Mountain whole patches are right: clipping sums 99.5–120.5 points from the Board against whole patches' 19.2–24.1.
- **The smallest class reads high almost everywhere.** In ten of the twelve sub-units the under-50 class is above the Board's in both years, by 1.8 to 9.5 points (3.7 or more in nine), Prince George Moist Interior – Mountain's 7–8 points among them; only Fort St. James Moist Interior – Mountain and Wet Trench – Mountain read low. Which class gives it up varies by unit. So it is not one unit's records: the LLOWG's analysis put into larger patches young forest that the model leaves in small ones, or left small openings out. Telling which needs the LLOWG's own inputs (the request in the next steps).

Whole patches against clipped, on the three units where the boundary could matter most (over 1,000 ha class, in percent; summed difference in points):

| Sub-unit and year                           | Board | Whole patches | Clipped | Summed, whole | Summed, clipped |
| ------------------------------------------- | ----- | ------------- | ------- | ------------- | --------------- |
| Prince George, Wet Mountain, 2015           | 0.0   | 5.7           | 4.0     | 33.6          | 31.7            |
| Prince George, Wet Mountain, 2018           | 11.1  | 21.0          | 20.2    | 31.3          | 31.3            |
| Prince George, Wet Trench – Mountain, 2015  | 8.6   | 28.5          | 0.0     | 40.3          | 37.7            |
| Prince George, Wet Trench – Mountain, 2018  | 14.9  | 32.9          | 0.0     | 37.2          | 30.5            |
| Vanderhoof, Moist Interior – Mountain, 2015 | 74.3  | 63.4          | 13.4    | 24.1          | 120.5           |
| Vanderhoof, Moist Interior – Mountain, 2018 | 80.9  | 73.2          | 30.6    | 19.2          | 99.5            |

Until each unit's check is close, its projections are unvalidated.

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
