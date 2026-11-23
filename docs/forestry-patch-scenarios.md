# Block planning and Prince George forest patch scenarios

Open **Forestry tools → Block planning** at `/dev/forestry/block-planning`. New plans open with an empty inventory and the FPPR profile. Under **Landscape**, choose **Load Prince George sample** for the synthetic worked example or enter the reporting unit for your own inventory. Select the historic forest district and natural disturbance sub-unit, then record the source, snapshot date and coverage. Clip GIS layers to that reporting unit before import.

## Review a block

Choose **Blocks**, enter a name, click **Draw block**, place the corners on the map, then click **Finish block**. Select any footprint to see its gross area measured with the shared block-sheet calculation. Import mapped riparian zones to measure overlap in BC Albers. Overlapping zones count once. The inventory file determines coverage and reserve boundaries. Stream classification, statutory buffers and completeness require source evidence.

Open **Legal review** for that block, schedule and projection year. Confirm instrument applicability and enter the legal assessment date and evidence, including verified net area to be reforested where relevant. The legal date is independent of the projected forest year. The Prince George pack reads its trend directly from the worker’s comparison with the preceding five-year period. A missing baseline leaves it unknown. Use **Export reproducible assessment** for the instrument snapshots, facts, traces and actions. **Export assessment JSON** saves the detailed landscape calculations and draft rationale.

**Switch interface** changes between the same guided and ribbon controls as the road-design and visual-quality workspaces. Project data belongs to the plan. The browser remembers the chosen interface per tool.

## Edit and compare

Choose **Shared baseline** for harvests and stand-replacing disturbances shared by every run. Choose **Proposed harvest** or **Alternative harvest** for events specific to a schedule. Enter the disturbance year and draw vertices on the map, then finish the footprint. To compare immediate and deferred harvest of the same polygon, import the same geometry in each schedule with a different ID and year. Orange outlines show input events across all dates in the selected schedule. Green shapes represent patches derived for the displayed year.

**Add disturbance GeoJSON** appends WGS84 Polygon and MultiPolygon features, including holes. A feature can specify `properties.id`, `properties.year` and `properties.scenario` (one of `reference`, `proposed`, `alternative`). Missing year and scenario use the editor controls. A missing ID uses the feature ID or the file name and row number. Each input must have a distinct ID. Record whether dates are observations or assumptions in the source notes. The model only represents stand-replacing disturbances.

**Save plan** writes the block boundaries, scenarios, zone layer, reviewer inputs, cited releases and selected view into one portable JSON project. **Open plan** also accepts earlier `pgmaps-patches-v1` GeoJSON projects. **Export schedule polygons** writes an ordinary GeoJSON layer for GIS exchange. The current draft is saved in IndexedDB on this device. The initial year defaults to 2026 and is configurable in the project. Use **First projection year** to change it in the editor. To reschedule a footprint, enter its new disturbance year and use **Set year** under **Manage footprints**. Eleven five-year snapshots compare all three schedules on the shared baseline. Exported assessment JSON includes the input project, complete order snapshot, calculation method ID, per-period areas and targets, selected derived geometries and rationale draft. Geometry is shown in WGS84 and measured in BC Albers (EPSG:3005).

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
