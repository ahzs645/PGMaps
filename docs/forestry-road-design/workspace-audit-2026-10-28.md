# Road workspace audit and browser verification — 28 October 2026

The changes were verified against the local PGMaps application. The public road-design URL
was inspected as a baseline; this record does not claim that the changes have been deployed.

## Defects reproduced and checked

- The selected-station input applied edits only on blur or Enter. Typing and arrow keys now
  update the map station, profile and section while the field stays focused. Empty intermediate
  text retains the current selection.
- An active named-template preview did not follow later candidate edits. Width arrow-key edits
  now redraw the section immediately; Discard closes the preview and restores the saved value.
- The training example had no Projects entry when there was no saved project. Its library is
  now available, and a scenario load replaces terrain, roads and context together.
- Terrain-display gradients around valid cells next to no-data produced white pinholes. The
  display now uses available one-sided gradients. The source sampler still returns missing
  elevations where the source has gaps.
- The 3D structure picker could shrink underneath adjacent toolbar buttons. Preventing toolbar
  children from shrinking restores actual pointer access to the picker in the linked layout.

## Browser regression result

The final combined Chromium run passed **17/17 tests** in 2.8 minutes:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 \
PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium \
npx playwright test tests/e2e/forestry-road-planning.spec.ts \
  tests/e2e/forestry-road-design.spec.ts --project=chromium --workers=1
```

The ten existing workflows cover linked map/chart geometry, pegging, turnout and profile edits,
alternatives, project round-trips, ground-only profiles, phone/fullscreen layout, failed-terrain
restore protection, engineering libraries, culverts/haul and radial D-lines.

The seven added checks cover:

1. Station typing and next/previous keyboard selection before blur.
2. Formation-level arrow keys redrawing the profile before blur.
3. Active template preview edits and discard without saving.
4. Live route cost refresh and removal of the actual MapLibre preview after an infeasible constraint.
5. The eight-scenario library, matching terrain/context and the local-gravel enable/disable scenario.
6. Uploaded road-condition evidence in project JSON and exclusion of closed roads from reuse.
7. Separate FSR connectors from either road endpoint, exact interior-segment junctions and preservation
   of the original alignment.

## Actual data and connected views

An isolated browser loaded the native LiDAR example and each of the four regional landscape
loaders. Final Tabor and Smithers examples were checked again after their geometry revisions.
The map terrain footprints matched the chosen places and profiles contained real source samples.

| Final browser check         | Terrain and result                                                              | Loaded public context                                            |
| --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Prince George native sample | Verified 1 m DTM; 930 m draft; 100% complete sections                           | No road tenures or harvest polygons returned for this small tile |
| Tabor Mountain              | Regional DEM; 1,042 m draft; 10.7% maximum design grade; 100% complete sections | One mapped harvest polygon                                       |
| Smithers / Ganokwa area     | Regional DEM; 1,041 m draft; 3.6% maximum design grade; 100% complete sections  | 14 road sections and two harvest polygons                        |

The browser also fetched the DataBC ArcGIS road service with the actual
`FILE_TYPE_CODE = 'B40' AND LIFE_CYCLE_STATUS_CODE = 'ACTIVE'` filter. It returned an active
Forest Service Road record. Road and special-use-permit service requests succeeded across origins
from the local application; this was checked in Chromium, not inferred from a command-line fetch.

The real Tabor FSR journey used the default 12% route-grade limit and the explicitly selected
regional-terrain screening option. It produced a 4,157 m proposed connection to **4843 · WILLOW FSR**.
The final point lay exactly on the returned FSR segment. The original road controls were unchanged,
and the original Tabor project remained in the browser library alongside the separate regional
connection project. No page errors were recorded.

## Interpretation limits retained

- Regional terrain is labelled as coarse screening data. A complete section calculation does
  not establish source accuracy or construction suitability.
- Public layers can return no records or fail independently of terrain. Scenario warnings are
  retained, and the application does not substitute invented roads or blocks.
- FSR discovery is bounded to nearby mapped active sections. A mapped junction does not establish
  legal access, bridge capacity, maintenance status or a field-verified road condition.
- Tenure award and retirement dates remain tenure facts. They are not construction-age or
  condition estimates. User condition assumptions and known construction years are recorded separately.
- The gravel example has zero acquisition price, a finite 1,000 m³ supply and a delivered rate of
  $7.46 per compacted m³ after processing, loading, haul and placement. Remaining demand uses the
  base surfacing rate. Disabling the source returns all demand to that base rate.
- Gravel supply costs feed engineering totals and the total-cost vertical optimizer. Horizontal
  terrain routing retains its entered road cost per metre; it does not discover a truck haul route
  to a stockpile.

See [existing-road evidence](existing-roads.md), [alignment and optimization](alignment-and-optimization.md)
and [terrain checks](terrain-and-point-clouds.md) for the source and calculation contracts.
