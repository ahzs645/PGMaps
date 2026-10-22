# Known issues

These are defects found by reading the code while the limits guides were written (2026-10-22).
Each is a place where the workspace does something other than what its controls or the
[contract](../forestry-road-design.md) say. Most were found by reading the code; the ones marked
**confirmed** were also reproduced. Remove an entry in the same change that fixes it.

## Results that can be wrong

| Area                 | Issue                                                                                                                                                                                                                                                                                                            | Where                                                           | Status    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| Spirals              | When the superelevation runoff is longer than the spiral, superelevation and widening ramp up on the tangent, drop to 0 at the TS/ST, then rise again along the spiral. R 80 m, 20 m spirals and 30 m runoff give a ratio of 0.333 just before the TS and 0 at it.                                               | `engine.ts` `curveDesignAt` (around lines 391 and 410)          | confirmed |
| Haul cost breakdown  | The "Haul beyond free haul" row adds compacted and bank m³·km over the full haul distance. The amount next to it charges only the distance beyond free haul, plus the free-haul rate and loading, so quantity × rate does not equal the amount. The contract says the two volume bases are never added together. | `CostBreakdown.tsx` (around lines 175–181)                      | read      |
| Culvert cover        | Cover takes the formation level from the template crossfall, while sections use the superelevated crossfall, so cover on a superelevated curve is wrong.                                                                                                                                                         | `engineering.ts` (around lines 420–426)                         | read      |
| Stakeout CSV         | Every catch point is written twice: `left-catch`/`right-catch` duplicate the `left-daylight`/`right-daylight` points at the same offset. `cut_fill_m` can print `-0.000`.                                                                                                                                        | `designExports.ts` (around lines 139–141), `sectionGeometry.ts` | confirmed |
| LandXML and stakeout | A missing value is written as `0`, and a stakeout point with no design falls back to the ground level.                                                                                                                                                                                                           | `designExports.ts` `n()` (line 16) and around line 145          | read      |
| LandXML lengths      | Lengths and radii come from the spherical road model, while coordinates are projected. On an east–west line at Prince George, 983.0 m along the road is 985.8 m between its exported UTM points (0.29 %).                                                                                                        | `engine.ts`, `designExports.ts`                                 | read      |
| Section code points  | The ditch-bottom point matches only the template ditch depth, so a ditch deepened by a culvert dip probably loses that point in section outputs and exports.                                                                                                                                                     | `sectionGeometry.ts` (around lines 55–65)                       | read      |
| Point clouds         | Possible int32 overflow when classifying: `encodeLas` stores coordinates as millimetres from the tile's floor, which overflows past about 2,147 m. A sparse tile or a long diagonal corridor could hit it, and it would fail with a misleading "reordered the points" error.                                     | `pointCloud.ts` (around lines 481, 512 and 594)                 | not run   |

## Controls and state

| Area             | Issue                                                                                                                                                                                                                                              | Where                                                                           | Status |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Templates        | "Crowned road" sets the ditch width to 0 but keeps the ditch bottom width, and the per-side bottom widths are not cleared. From a U-ditch template the new template fails validation, and the whole road stops calculating.                        | `EngineeringControls.tsx` (around lines 354–363)                                | read   |
| Drainage         | Runs and their settings live only in page state. They are not saved with the project or autosave, and running another road replaces the run.                                                                                                       | `DevForestryRoads.tsx` (`drainage` state)                                       | read   |
| Drainage         | Changing rainfall, C, n, threshold or buffer does not mark a run stale, and a stale run keeps drawing on the plan with no warning outside the Drainage view. An edit to any alternative also marks it stale, because every analysis is recomputed. | `DevForestryRoads.tsx` (stale check and `drainage` prop), `useRoadWorkspace.ts` | read   |
| Training project | `?example=training` saves to its own key but never reads it back.                                                                                                                                                                                  | `useRoadWorkspace.ts` (around lines 116–119 and 163)                            | read   |
| Exports          | The shapefile and plot book report "Export downloaded." before their asynchronous build finishes. A failed contour build in the plot book is swallowed, leaving sheets with no contours.                                                           | `DevForestryRoads.tsx` (around lines 663–665 and 726–730)                       | read   |
| Shapefile        | DBF numbers too wide for their field are written blank, and text is truncated, without a warning.                                                                                                                                                  | `shapefile.ts` (around lines 72–73)                                             | read   |
| Point clouds     | The import copies up to 1 GB into the worker instead of transferring it, doubling peak memory.                                                                                                                                                     | `terrain.ts` `loadLas` (`runPointCloudWorker` call)                             | read   |
| Point clouds     | The LAZ CRS fallback through `lidar_info` in the worker is unreachable, because `loadLas` refuses a cloud without a CRS on the main thread first.                                                                                                  | `pointCloud.ts` (around line 418), `terrain.ts` `loadLas`                       | read   |
| Optimizer        | A negative K is rejected with the PVI-spacing error message.                                                                                                                                                                                       | `verticalOptimizer.ts` (around line 93)                                         | read   |

## Contract text that disagrees with the code

- The ditch dip goes to at most 4 m below the hinge in total (`MAX_DITCH_DIP_DEPTH`), not "up to 4 m
  deeper than the template ditch".
- Haul within the free-haul distance is free only while the free-haul and loading rates are zero.
- Route search may visit `40_000 × alternatives` states across up to three rounds per alternative,
  not 40,000 in total (`routing.ts`).
- The sketched corridor optimizer's 7 km planning-area limit, 1–30 % grade limit and 5–1,000 m
  minimum radius are not in `forestry-road-optimization.md` (`corridorOptimizer.ts`).
- Breakline heights are also read from `Z`, `ELEVATION` and `elev` properties (`tinSurface.ts`).
- A saved regional-DEM project re-fetches its tiles automatically for the current alignment extent,
  which may differ from the original request (`useRoadWorkspace.ts` `restore`).

## Smaller inconsistencies

- "Complete" is 99.99 % on the headline tiles, 99.999 % in the cost dialog and summary, and
  100 − 1e-5 in the engine.
- Engine bounds are wider than the editor and file-import bounds: batter slopes 0.05 vs 0.1,
  compaction factor up to 3 vs 2, culvert span from 0.1 vs 0.2 m.
- `validateEngineering` does not bound the free-haul rate, the loading rates or `ditchDipPercent`.
  Only the input fields and project parsing do.
- `verticalOptimizer.ts` describes `estimatedEarthworkCost` as the search's own estimate, but it
  is computed from the full analysis of the chosen line.
- The `compiledPath` cache key in `engine.ts` leaves out `spiralM`. It is harmless while every
  update creates a new alignment object.
- `PlanView.tsx` lists a `'crossing'` drainage role that `drainageRun.ts` never emits.
- The header's autosave status is hidden below the `xl` breakpoint.
