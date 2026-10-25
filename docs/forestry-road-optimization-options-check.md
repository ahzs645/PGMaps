# Road optimization option checks

On 2026-10-24, three agents compared the pathway and profile objectives using the
actual saved Kamloops and Vernon roads from the
[new-area DEM journeys](forestry-road-new-area-check.md). Each option starts from
the same exported baseline for that comparison. The ordinary 12% grade and 25 m
minimum-radius limits remain unchanged.

## Desktop pathway objectives

All three preferences use the same edited Kamloops guide and a 100 m corridor
half-width. The input project SHA-256 is
`23146b0312f0de4ced2aa6a5540ba38b5b92661913992f18ca4701b08dfd0f52`.

| Preference       | Candidate length | Maximum sampled ground grade | Excess rise/fall | Fitted controls |
| ---------------- | ---------------- | ---------------------------- | ---------------- | --------------- |
| Shortest         | 204.94 m         | 11.46%                       | 7.78 m           | 10              |
| Balanced         | 209.42 m         | 11.66%                       | 7.24 m           | 12              |
| Contour-friendly | 209.42 m         | 11.66%                       | 7.24 m           | 12              |

All searches completed. Each review report contains the selected objective,
corridor width, original guide, settings, terrain checksum and actual candidate.
Each candidate was adopted as a new alternative, downloaded and reopened exactly
in a fresh browser. Original roads and DEM cells were retained, with zero browser
errors. An independent agent checked endpoint registration, actual fitted arcs
and source elevations against the original GeoTIFF.

Balanced and Contour-friendly legitimately select identical geometry here. Their
objective scores use different weights and cannot be compared numerically as a
shared score. The table's grades use the optimizer's at-most-1 m sampling; a denser
0.5 m check of fitted geometry measured 11.62% for Shortest and 11.91% for the other
two, still below 12%. These are sampled ground grades, not designed profile grades
or a continuous-surface guarantee. The reports retain their reconnaissance and
field-review warnings.

## Profile objectives and cost sensitivity

Both objectives use the same saved Vernon horizontal alternative: 206.42 m long,
K 4, 50 m PVI spacing, ±5 m depth, 0.5 m level steps and both ends tied to ground.
The horizontal alignment remains fixed.

With the actual baseline's missing optional engineering inputs, **Cut and fill**
and **Total cost** produce the same four-PVI profile: 6.91% maximum design grade,
535.23 m³ cut, 583.24 m³ fill, $11,088.75 cut/fill cost and $26,574.29 full base
estimate. This exercises both objectives without implying a haul calculation.

The touch-mobile browser tested both objectives on this baseline, then entered a
second hypothetical haul scenario through **Engineering → Haul**, including a
waste site at the exact road end. Both objectives were run again from that same
downloaded scenario baseline. All four results preserve the original alternative,
save successfully and reopen exactly in fresh browser contexts, including the
embedded DEM, settings, geometry and recomputed analysis. The full mobile cost
dialogs were opened for each result, with zero browser errors. The high-borrow
scenario below matches the independent engine comparison to rounding precision.
An independent fresh GeoTIFF decode and full analysis also match all four actual
mobile exports. Objective and search values are recorded in the test evidence;
the project saves the resulting geometry and engineering inputs, rather than an
optimizer search-history record.

The independent agent also supplied explicit hypothetical scenarios, retaining
the same terrain and geometric constraints. Both complete-site scenarios below
place borrow at station 0 and waste exactly at the road end, after the endpoint
registration fix described below.

| Illustrative scenario       | Cut/fill objective: full cost | Total objective: full cost | Difference |
| --------------------------- | ----------------------------- | -------------------------- | ---------- |
| Borrow $40/m³, waste $25/m³ | $36,220.11                    | $35,372.89                 | −$847.23   |
| Borrow $80/m³, waste $20/m³ | $40,687.60                    | $34,790.53                 | −$5,897.07 |
| Borrow $20/m³, waste $80/m³ | $33,986.36                    | $33,986.36                 | $0.00      |

For the first two scenarios, Total cost chooses five PVIs and increases cut/fill
cost from $11,088.75 to $11,856.15, while lowering the complete modeled estimate.
Maximum design grade is 7.88%. End ties, K, complete sampled coverage, cost-line
arithmetic and site allocations pass, with no model warnings.

These scenarios use free/overhaul distance thresholds 50/300 m; distance rates
0/6/4; loading rates 0/0.6/2.6; $1,000 mobilization; 10% contingency; and two sites
with 1,000 m access, 10,000 m³ capacity and $500 setup each. Site unit rates match
the scenario's borrow/waste rates. They are illustrative assumptions, not measured
site inputs or construction quotes. A separate no-site scenario correctly retains
the warning that unknown supply/disposal haul costs are excluded.

Total cost ranks five tested imbalance-price candidates by their full analyzed
cost; it does not solve a global mass-haul optimum. Same-result cases are retained,
including the actual no-engineering baseline and the high-waste scenario.

## Defect found and fixed

The cost comparison exposed an endpoint registration defect. A road of
206.42075944818848 m has a final calculation station rounded to 206.420759 m.
The narrower geometry epsilon excluded a waste site entered at the exact true
endpoint, leaving 105.88 m³ falsely unallocated and omitting its haul/setup costs.

`engineering.ts` now registers site reachability at the same micrometre precision
as calculation stations. Distances and prices retain the entered chainage. Both
borrow and waste endpoint regressions failed before the fix and pass afterwards.
An actually off-road site remains unreachable, and the existing unsupported-gap
test still prevents material transfers across missing coverage. All ten profile
generations in the five-scenario exact-end comparison pass after the fix.

## Separate terrain-cost suggestion button

The eight-neighbour route helper was also exercised through the desktop/mobile
controls, requesting three alternatives at $180/m with the same 12% grade limit.
Vernon returned three distinct ranked routes of 209.24, 214.93 and 216.80 m. The
downloaded project retained all three and reopened exactly in a fresh mobile
context. Its sharp-corner and missing-profile warnings remain expected: this
helper does not fit horizontal curves or design a profile.

The same helper found no feasible route on the Kamloops guide inside its bounded
search. Its visible failure left the saved project exactly unchanged. This is a
different search from the successful corridor optimizer, and failure does not
establish that no road is possible.

## Reproduce and evidence

The browser comparisons are opt-in and require actual exported baselines from
the new-area journeys. No DEM bytes or generated project files are committed.

```sh
PGMAPS_ROAD_OPTIONS=1 PGMAPS_ROAD_OPTIONS_PROJECT=/path/to/kamloops-edited.road.json \
  npx playwright test tests/e2e/forestry-road-options-desktop.spec.ts \
  --project=chromium --workers=1 --reporter=line

PGMAPS_ROAD_OPTIONS_PROJECT=/path/to/vernon-horizontal.road.json \
  npx playwright test tests/e2e/forestry-road-options-mobile.spec.ts \
  --project=chromium --workers=1 --reporter=line

npx vitest run src/pages/dev-forestry-roads/engineering.test.ts \
  src/pages/dev-forestry-roads/verticalTools.test.ts \
  src/pages/dev-forestry-roads/routing.test.ts \
  src/pages/dev-forestry-roads/corridorOptimizer.test.ts
```

The four unit files pass all 85 tests; TypeScript, targeted ESLint, formatting and
whitespace checks pass. Browser screenshots, saved candidates,
reports, cost scenarios, independent checks and the separate route-helper script
are retained under `/workspace/scratch/road-optimization-options/`. Basemaps use a
valid isolated style; terrain and optimization calculations use the real saved
DEM cells. Mobile browser checks use touch-enabled Chromium emulation.

Refreshed `desktop-current.png` (1512 × 982) and `mobile-current.png` (390 × 844)
show the current interface. Direct measurements confirm that Settings, Fit and
Zoom buttons are all 32 × 32 px, and the distance scale is 8 px from both the left
and bottom map edges in both views.
