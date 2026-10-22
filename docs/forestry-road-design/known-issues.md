# Known issues

These are places where the workspace does something other than what its controls or the
[contract](../forestry-road-design.md) say. The list was first written from a code review on
2026-10-22 and rechecked against the code after that day's fixes. Entries marked **confirmed**
were reproduced; **read** ones were found by reading the code. Remove an entry in the same change
that fixes it, and add one, with the file and function, when you find a new defect.

## Results that can be wrong

| Area    | Issue                                                                                                                                                                                                                                                                                                                                                                                               | Where                       | Status |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| Spirals | Where a curve's exit spiral meets the next curve's entry spiral (a reverse curve with no tangent between) and the runoff is longer than the spirals, each spiral keeps part of its own curve's superelevation at the shared point, so the crossfall flips from one side to the other there instead of passing through the normal crown. With runoff no longer than the spirals both are at 0 there. | `engine.ts` `curveDesignAt` | read   |

## Fixed on 2026-10-22

Exports and analyses made before these fixes can differ from current ones in these ways.

- Spirals: superelevation and widening no longer drop to 0 at the TS/ST when the runoff is longer
  than the spiral; they run in over the longer of the two, ending at the SC.
- Culvert cover uses the superelevated crossfall at each barrel sample, as the sections do.
- Section and stakeout ditch-bottom points are kept where a culvert dip deepens the ditch.
- Cost breakdown: every row is quantity × rate = amount. Haul is one row per class and volume
  basis plus loading rows; borrow and waste are one row per site; site preparation counts only
  sites actually used.
- Template starters other than "Current road section" clear every side-specific value, keep the
  ditch bottom inside the ditch and validate, so "Crowned road" from a U ditch no longer stops the
  road calculating. Left and right ditch bottom widths are in the side editor.
- `validateEngineering` and `validateTemplate` use the same bounds as the editor and project files
  (rates, mobilization, ditch dip, compaction, culvert size and cost, site rates, batters).
- "Complete" means coverage of at least `COMPLETE_COVERAGE_PERCENT` (100 − 1e-5 %) everywhere:
  the tiles, cost dialog, summary, report, GeoJSON status and pegging.
- Stakeout CSV: each catch point is written once (`left-catch`/`right-catch`), never `-0.000`; a
  point with no design gets a blank level instead of ground.
- LandXML: missing values are left out instead of written as 0; line, arc and spiral lengths and
  radii are measured in the export grid, with stations still in chainage.
- Shapefile: fields widen to fit; values that still do not fit are reported in the notice.
- Plot book: plans print the contour interval or "Contours unavailable"; the plot book and
  shapefile notices appear when the file is ready.
- Point clouds: the file is transferred to the worker rather than copied; a LAZ whose CRS only the
  decoder finds is accepted; the grid extent comes from ground points only; LAS coordinates written
  for classification cannot overflow. The earlier "int32 overflow past 2,147 m" entry was wrong:
  int32 millimetres hold 2,147 km.
- Drainage: a run is kept per road, for the three most recent roads that still exist; a run goes
  stale only on its own road's edits, road settings, terrain or drainage inputs, the panel says
  which, and a stale run is not drawn on the plan. Drainage inputs are remembered in the browser.
- Cost dialog: the haul class and loading fields accept up to 100,000, as everywhere else.
- Profile optimizer: a negative or missing K has its own error message.
- The header shows the autosave state as a dot on narrower screens.
- Contract text corrected for the ditch dip depth, free-haul pricing, route-search budget,
  training-mode autosave, breakline height properties, regional DEM restore and corridor
  optimizer limits.
