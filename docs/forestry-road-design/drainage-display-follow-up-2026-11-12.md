# Drainage display and station clicks — 12 November 2026

Two inputs started this work: a DevTools trace of clicks in the Drainage view, and a licensee's
imported block project, seven roads and 9.8 km on the 22.4 m regional DEM, with no designed
profiles and no culverts. On that project the plan showed a yellow dot every cell or two along
the road, labelled "Unrelieved low point", which read as the profile's sag low points; a dense
field of parallel blue flow lines; and each click in the Drainage view took 180–270 ms of main
thread. This page records what was found, what changed, what was measured, and what is still
open. Neither input is in the repository: the project is the licensee's, and the trace holds
local paths.

## Done

| Change                                                                                                                                                       | Where                                                                                                            | Guide                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A low point drains at least four cells as well as 0.05 ha                                                                                                    | `hydrology.ts` (`LOW_POINT_MIN_CELLS`)                                                                           | [Drainage](drainage.md#cross-drain-candidates-on-coarse-terrain)                                           |
| Outlets within 40 m of the last along the road, either side, are one cross-drain site with its stretch, outlet count and largest outlet                      | `hydrology.ts` (`crossDrainSiteGroups`, `CROSS_DRAIN_SITE_M`)                                                    | [Drainage](drainage.md#limits-and-budgets)                                                                 |
| Route comparison takes the 40 m from the same constant                                                                                                       | `routeComparison.ts`                                                                                             | [Alignment and optimization](alignment-and-optimization.md)                                                |
| On cells coarser than 2 m the candidates are a screen: a panel notice, and Review reads the row as not assessed, never met                                   | `hydrology.ts` (`DITCH_DETAIL_CELL_M`), `DrainagePanel.tsx`, `readiness.ts`                                      | [Review checks](review-and-standards.md), [Drainage](drainage.md#cross-drain-candidates-on-coarse-terrain) |
| "Unrelieved low point" and "ditch low point" renamed "cross-drain candidate" on the plan, legend, panel, Review, evidence report and status line             | `planLegendModel.ts`, `DrainagePanel.tsx`, `readiness.ts`, `drainageEvidence.ts`, `DevForestryRoads.tsx`         | [Profile labels](profile-labels-and-bands.md)                                                              |
| Candidates drawn as a yellow sleeve along the road and, from zoom 14.5, a dashed line across it, instead of dots                                             | `crossDrainMarks.ts`, `PlanView.tsx`                                                                             | [Drainage](drainage.md#cross-drain-candidates-on-the-plan)                                                 |
| Flow lines carry `thresholdRatio` and `widthCells`, measured on their own flow; the plan leads with large, convergent lines and fades the rest in by zoom 16 | `hydrology.ts` (`extractStreams`, `longestFlowPath`), `planLegendModel.ts` (`STREAM_ZOOM_STOPS`), `PlanView.tsx` | [Drainage](drainage.md#flow-lines-by-zoom)                                                                 |
| Saved drainage evidence from before the change reads out of date                                                                                             | `drainageEvidence.ts` (`DRAINAGE_ALGORITHM_VERSION`)                                                             | [Drainage](drainage.md)                                                                                    |
| The station table and each of its rows are memoized; a station change redraws two rows                                                                       | `StationTable.tsx`                                                                                               | this page                                                                                                  |
| Number formatters cached in the station table and the profile bands; profile grade spans cached per road, profile and view                                   | `StationTable.tsx`, `EngineeringBands.tsx`                                                                       | this page                                                                                                  |

Tests: `crossDrainSites.test.ts`, `crossDrainMarks.test.ts`, `StationTable.test.tsx`, and new
cases in `hydrology.test.ts`, `readiness.test.ts` and `EngineeringBands.test.tsx`.

## What the low points were

A low point was a footprint cell where at least 500 m² of design-surface flow leaves the prism.
Flow accumulation counts the cell itself, and one 22.4 m cell is 503 m², so on regional terrain a
single cell passed alone: every cell where the ground fell away from the road was listed. The
duplicate rule kept the largest within 10 m on the same side, which is shorter than one cell, so
almost nothing merged. With no culverts on the project every one of them was "unrelieved".

The ditch itself is the deeper problem. The template's 1 m ditch is far narrower than a 22 m cell,
so the design surface cannot carry water along it, and flow reads as leaving the road wherever
the ground falls away. A count of such places on coarse terrain is not a count of missing
culverts, which is why the Review row no longer treats it as one.

After the change, the 3.6 km main road reads 75 outlets in 30 sites. One sidehill site joins 24
outlets over 728 m: a stretch that needs several cross-drains, which the table shows as its span.

## What the blue lines were

D8 on a smooth hillside sends flow down parallel strips one cell wide. On 22.4 m cells a strip
passes the 1 ha stream threshold about 450 m down the slope, so a "stream" was drawn every 22 m
across it. On 1 m LiDAR the same strip would need about 10 km, so the effect is specific to coarse
terrain.

Contributing area alone could not separate the strips from real channels: the uphill strips run
down to the road, and their area at the road is several times the threshold. The measure that
does is width, contributing area over the longest flow path, in cells. A first version took it at
each line's last cell, which is the confluence it ends on, so a strip that ran into the ditch
read as large as the ditch: median 18 times the threshold and 8 cells wide. Taken at the line's
own last cell, the median is 4.7 times and 3 cells.

The zoom stops were chosen on that road's design-surface network, 293 lines and 51.6 km of drawn
line:

| Shown when zoomed out         | Lines | Drawn length |
| ----------------------------- | ----: | -----------: |
| Every line                    |   293 |      51.6 km |
| 2× threshold and 2 cells wide |   204 |      28.1 km |
| 5× threshold and 3 cells wide |   128 |      12.0 km |
| 5× threshold and 5 cells wide |   104 |       8.9 km |
| 5× threshold and 8 cells wide |    76 |       5.1 km |

The plan uses the third row at zoom 12, the second at zoom 14.5 and every line at zoom 16. At the
500 m scale it then shows the main convergent channels and the road; the smaller lines fade in
from the 200 m scale. The stops were judged on this one road and terrain.

## Why yellow, a sleeve and a tick

The first marks were translucent amber bands over the road. They disappeared: amber (`#d97706`)
is the default road colour, the within-grade road class and "mostly cut", and this project's
main road was amber. A yellow (`#eab308`) sleeve, two thin lines either side of the road drawn
with `line-gap-width`, reads on any road colour. The dashed tick across the road from zoom 14.5
sits where a culvert would go, so a candidate becomes a culvert in the same place once one is
added. Both are drawn in metres along the road, so zooming out shrinks them onto the road
instead of leaving a field of dots.

## What a station click cost

The trace recorded four clicks in the Drainage view against the dev server (13.7 s, dev build).
Each took 180–270 ms of main thread. In the three clicks that did not recalculate the road:

| Work                                                                  | Per click (dev) |
| --------------------------------------------------------------------- | --------------: |
| Application code                                                      |      101–105 ms |
| — of which the station table, redrawing every row's formatted numbers |           86 ms |
| — of which the profile's grade bands (`profileGradeSpans`)            |        14–15 ms |
| React reconciliation of the page                                      |        40–85 ms |
| MapLibre (worker messages for the plan's sources)                     |        16–21 ms |

The fourth click changed the road and recalculated it (`analyzeRoad`, about 280 ms) and the
block figures (`blockFacts`, about 95 ms); that work is expected on an edit.

Most of the formatting cost was `Number.prototype.toLocaleString` with options, which builds a
new `Intl.NumberFormat` on every call: the station table's `fixed` had 153 ms of self time in a
single task and the bands' `number` 28 ms. Both now keep one formatter per precision, and the
grade spans are cached, so a repeat request for the same road and view is a lookup.

The station table is a memoized component with memoized rows. `StationTable.test.tsx` counts
the cells it formats: a page re-render with the same road formats none, and a station change
formats two rows.

After the change, long-animation-frame timing in the browser pane put a station click at about
35 ms of rendering followed by a timer task of about 45 ms, with nothing blocking. An earlier
reading of 450–540 ms from the same pane was its frame pacing, about one frame a second while
emulating a viewport, not work; measure the pane with long-animation-frame entries, not with
`requestAnimationFrame` round trips.

## Checks run

- Drainage, Review, route comparison, legend, table and profile-band suites passed. The full
  `src/pages/dev-forestry-roads` run passed apart from `ribbonCoverage.test.ts`, which fails on
  other uncommitted ribbon work; timing-sensitive files (optimizer, vehicle path, full-cost
  runs) failed under load in some parallel runs and passed when run on their own.
- `tsc -b`, ESLint and Prettier passed on the changed files at the time of the change.
- The project was loaded in a local preview, the check run, and the plan read at the 500 m,
  200 m and 100 m scales, the legend and the panel's table and notice checked. The only console
  errors were the NRCan hillshade service's CORS refusals.

## Open, in rough order of value

1. **Unattributed timer work after a station click.** About 45 ms (dev) runs in a `setTimeout`
   after each click; long-animation-frame entries do not name its source. A CPU profile of a
   station click would say which effect it is.
2. **The page re-renders on every station change.** `station` is page state, so every pane that
   is not memoized reconciles on each click (40–85 ms in dev). The design sidebar already reads
   the station through `useLiveStation`; the profile and detail panes could follow.
3. **Zoom stops on LiDAR.** `STREAM_ZOOM_STOPS` was chosen on one 22.4 m road. On 1 m terrain
   sheet-flow strips are rare and widths run larger, so the stops should be checked on the
   published LiDAR road before they are relied on there.
4. **Cross-drain spacing.** A site spanning hundreds of metres needs several cross-drains; the
   check reports the span but not how many. `standards.maxCrossDrainSpacingM` could turn a span
   into a count.
5. **Ditch flow on coarse terrain.** Rather than only marking candidates as screening, the burn
   could route a ditch sub-cell (as a flow line rather than a raster) so coarse terrain still
   carries water along the road. That is a model change, not a display one.
