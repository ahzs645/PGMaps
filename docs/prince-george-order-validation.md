# Testing the Prince George biodiversity order

PGMaps reproduced the two old-forest deficits reported in the 2019 Prince George Forest District inventory. The 2015 and 2018 observations also give a check on how the planner explains a landscape trend. The Forest Practices Board reported that approved recruitment strategies were in place. It could not determine overall young-patch trend from the distributions. The 2018 analysis used revised 2017 guidance, and the Board identified patch shape, location, forest structure and professional interpretation as material to the finding. [Board investigation FPB/IRC/235, pp. 6–8 and Appendices 1 and 4](https://www.bcfpb.ca/wp-content/uploads/2021/05/IRC235-PG-TSA-Biodiversity.pdf)

## Old forest and old interior forest

The tests compare all 25 Prince George district rows in Tables 3 and 6 with the Board’s Appendix 1. Both hectare minima agree within one hectare on every row using the printed inputs. No row had an old-interior deficit. These are figures for 2019. A current proposal needs its own dated inventory.

| Historical unit | Required old forest (ha) | Reported old forest (ha) | Difference (ha, printed values) |
| --- | ---: | ---: | ---: |
| A4 · McGregor Plateau | 53,760 | 49,295 | −4,465 |
| A24 · Wet Trench – Valley | 38,202 | 37,315 | −887 |
| A15 · Wet Mountain | 13,108 | 13,118 | +10 |

A15 illustrates the value of a field visit. The printed land base of 15,604 ha and the 84% target give 13,107.36 required ha before rounding. If 11 of the 13,118 reported old hectares were reclassified, the numerical result would fall below the minimum, holding the land base fixed. That is a threshold calculation. Whether any particular stands warrant reclassification needs inventory evidence.

For A4 the interior minimum is 10% of the **required** old hectares, about 5,376 ha. The reported 15,448 interior hectares exceeded that minimum even though total old forest was short. Table 3 identifies A3 as combined with A13. The tests replay Appendix 1 as published with those rows separate. A planning assessment needs the combined geography and accounting in the order. The A/B calculator currently expects verified area inputs. The block editor models young forest and does not derive old-interior hectares from stand polygons.

## Young forest patch sizes

The Table 7 check covers all nine target groups across the TSA. The historical replay below compares the four printed shares in each of the six Prince George district sub-units with published observations. Each comparison uses the change in absolute distance to that class’s target. The 2015–2018 reporting interval is three years. The block planner uses five-year projection intervals.

| Prince George reporting sub-unit | Classes closer to target | Classes farther from target |
| --- | ---: | ---: |
| McGregor Plateau | 3 | 1 |
| Moist Interior – Mountain | 1 | 3 |
| Moist Interior – Plateau | 0 | 4 |
| Wet Mountain | 4 | 0 |
| Wet Trench – Mountain | 3 | 1 |
| Wet Trench – Valley | 1 | 3 |

For McGregor Plateau, the share under 50 ha went from 10.4% to 8.5% against a 10% target. Its distance grew from 0.4 to 1.5 percentage points while the other three classes moved closer. PGMaps flags a trend for review if any class moves farther. Five of the six rows raise that flag. **The order supplies no numerical pass score for the entire distribution.**

Boreal Foothills – Mountain (A1) has old-forest objectives and no published Table 7 target. Leave the patch sub-unit unassigned for that case. Another kind of missing evidence occurs in Fort St. James, where Northern Boreal Mountains has a Table 7 target but Appendix 4 gives no 2015 or 2018 observations.

## Which parts of the order the software can evaluate

| Provision | What PGMaps can establish | Evidence a reviewer must supply |
| --- | --- | --- |
| I–III and E | The pack checks its source dates and the reviewer’s applicability entry. | Map 1 for C and Map 2 for A/B, historical district, Crown tenure and exclusions for woodlots, tree farm licences and community forests. Verify later old-forest orders for their area and effective date. |
| E, plan transition | The date window includes 20 October 2004. | Check the four-month rule for new FPC development plans and major amendments, Category A approvals on or before the effective date, and the submission date of an FRPA stewardship plan. |
| A and B | Numerical minimum and deficit for a supplied district unit and qualifying areas. | Eligible area, stand age, edge definitions, historical geography and forest condition. The installed A/B tables cover the Prince George district. |
| C | Young hectares, four class shares, gaps, movement over time and missing intervals. | Coverage of the entire district sub-unit, comparable methods, landscape pattern and professional interpretation. |
| D.1 | The JSON identifies contributions from existing OGMAs and new spatial old-forest retention areas. Parks and protected areas may contribute. | Confirm what was established, dates, overlap and eligible hectares. |
| D.2 | The JSON identifies an option for similar mBECs across districts for A/B. | Check the licensee’s geographic circumstances and combined area. C uses each sub-unit within its own district. |
| D.3 | The JSON identifies the epidemic or catastrophe provision. | Establish representativeness of affected stands and the required unaffected non-pine representation for the mountain pine beetle epidemic. |
| D.4 | The JSON records the 20% upper bound on younger classes. | Demonstrate equal or better conservation benefit and calculate eligible contributions to each objective. |
| D.5(a) | A reviewer determination that A or B cannot be achieved activates the recruitment workflow. | Consider timely and economic harvesting of timber rights, document the shortest practicable recovery, submit the strategy, obtain the designate’s approval and comply with it. |
| D.5(b) | A separate reviewer determination that C cannot be achieved activates submission of a rationale. | Set out results or strategies for the shortest practicable recovery, considering timely and economic harvesting of timber rights. |

The release tests exercise all 81 combinations of true, false and unknown for applicability, class movement, old-objective achievability and patch-objective achievability. They verify which actions appear for each branch. A C flag leaves the D.5 determinations open. D.1–D.4 and the plan-specific transitions in E remain matters for review. The pack’s coverage end date records the limit of the installed release. [Signed order, sections I–III and A–E, and revised implementation policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf)

## Reproduce the checks

From the repository root, run the following commands. The fixture preserves the published values and dates. The spatial tests use synthetic geometry to exercise the five merge stages, class boundaries, disturbance dates, holes, overlaps and alternative schedules. Reproducing the published maps would require the source cutblock and disturbance inventories, historical district and order polygons, and the original GIS processing choices.

```sh
npx vitest run packages/legal-rules/tests
node --test packages/legal-rules/tests/*.test.mjs
npx playwright test tests/e2e/block-planning.spec.ts
```
