# Known issues

These are places where the workspace does something other than what its controls or the
[contract](../forestry-road-design.md) say. The list was first written from a code review on
2026-10-22 and rechecked against the code after that day's fixes. Entries marked **confirmed**
were reproduced; **read** ones were found by reading the code. Remove an entry in the same change
that fixes it, and add one, with the file and function, when you find a new defect.

## Open: route searches (found 2026-11-09)

- **A found road can have incomplete sections (confirmed).** The corridor search
  (`evaluate` in `corridorOptimizer.ts`) and the terrain-cost search (`segmentCost` in
  `routing.ts`) check for ground under the centreline only. On the published LiDAR tile, where
  0.9 % of cells are gaps scattered across the hillside, roads found between new ends often read
  "97% of sections complete": a batter runs onto a gap a few metres to one side. Such a road
  cannot lead a goal in **Find the best route**, and the row says so. The search would need to
  keep a clearance from gaps, or price ground near them.
- **A found terrain-cost route can keep sharp corners (confirmed).** `roadFromRoute` in
  `routeFit.ts` gives a corner the largest curve its tangents hold only from what its neighbours
  leave; it does not shrink a neighbour's curve to make room. On a 20 m search grid with a 35 m
  minimum radius, several corners of a route can stay sharp. **Reduce points, fit curves** with a
  larger deviation removes most of them.
- **Ground grade along fitted curves is compared, not checked against the limit (confirmed fixed
  in part).** `roadFromRoute` refuses a fit whose ground reads steeper than the route as found, over
  20 m chords, by more than one percentage point (`ROUTE_FIT_GRADE_WINDOW_M`,
  `ROUTE_FIT_GRADE_SLACK`). Before that, a suggested skid spur that zig-zagged across a 15 % slope
  to hold 12 % was fitted straight up it within 16 m: listed at 730 m, added as 516 m at 15 %. A
  route that holds its grade with short zig-zags is now kept as found, with its sharp corners
  flagged. The grade limit itself is still held by the designed profile afterwards.
- **"Had no line left to try" is not proof (confirmed).** The corridor search keeps one arrival
  per cell and heading (`best` in `corridorOptimizer.ts`), so a search that ends with no candidate
  has not tried every line: a second search leaning toward the end found a road in a tube where
  the even search had reported none. **Find the best route** therefore still tries the next step.

## Open: route search, Reduce points and the profile optimizer (found 2026-11-09, second round)

Found while fixing the second set of walkthrough defects; **confirmed** by a reviewer's probe
unless marked.

- **Reduce points reports less movement than it made.** `fitPolylineAlignment` (`polylineFit.ts`)
  measures the fitted line at its vertices and arc samples only, not along its tangents: one line
  read "moved at most 31.8 m" where the two-way distance was 34.8 m. The limit itself held in 400
  random runs. Densifying the fitted line makes the check about ten times slower on long lines.
- **Reduce points runs in one go.** 2,000 points over 40 km took 13 s on one thread, and 100 km
  took 76 s, with no progress or Cancel (`farthest` in `polylineFit.ts`, called from `reduce` in
  `CurveTools.tsx`).
- **Reduce points refits every curve and drops spirals without saying so** (read). The line is read
  along the centreline and fitted afresh, so an 80 m curve came back as 35.9 m at 5 m deviation and
  a 30 m spiral was gone; the notice gives only counts and the tightest radius (`reduce`,
  `CurveTools.tsx`).
- **The terrain-cost search notice lists costs as search scores.** With an avoid-where-practical
  area the message reads "ranked by search score ($221,284, …)" while the roads' records hold
  229,782: the list prints `cost`, which leaves the avoidance penalty out (`suggestRoutes`,
  `routing.ts`).
- **"Curves fitted within 8 m" can be exceeded by the tightened curves.** `roadFromRoute`
  (`routeFit.ts`) reports the deviation limit of the polyline fit; the larger curves it then gives
  sharp corners moved one road 8.47 m from its route (`roadFromGridRoute`, `routeComparison.ts`).
- **A control added at a typed station lands on the nearest analysis station.** "Control at selected
  station" at 0+437.3 made a control at 0+440.0 (`nearestStation` in `VerticalDesignControls.tsx`).
- **The header shows the figures of a line being pegged beside the saved road's name.** While a
  road is being pegged or extended the tiles, plan and profile read the unfinished line
  (`displayedAlignment` in `DevForestryRoads.tsx`) and the road switcher still names the saved
  road. The searches now wait for **Finish road**; the header itself is unchanged.

## Open

- The gallery's example report (`docs/assets/forestry-roads/native-example-report.html` and
  `.pdf`) was exported before the 2026-11-09 change below. It still prints "the mass curve stops
  at the first gap" and "material is not moved across a terrain/daylight gap", and its haul figures
  were allocated run by run. Re-export it from the workspace (`roadReportHtml`, `project.ts`).
- **Economic material flow cannot solve an ordinary road under a stepped haul quote**
  (confirmed, 2026-11-09). `solveDenseMaterialAllocation` (`materialAllocation.ts`) builds one
  variable for every compatible cut-interval/fill-interval pair and solves it as a dense simplex
  tableau, which `MAX_ALLOCATION_TABLEAU_CELLS` caps at 3,000,000 cells. The sparse chain model
  (`solveSparseMaterialAllocation`) is exact only for a linear quote (`linearHaulSlope`): free-haul
  distance 0 m and one distance rate, or every rate zero. The default free-haul distance is 25 m,
  so entering any distance rate sends the road to the dense model, and about 90 intervals whose
  cut can be placed as fill (a 930 m road at 10 m stations) exceed the limit. The result is
  **Material plan not solved**; the road and quantities are unaffected. Until the dense model is
  replaced, set the free-haul distance to 0 m with a single distance rate, or widen the station
  spacing. An exact fix needs either a sparse simplex or a model that keeps explicit pairs only
  inside the overhaul limit and carries longer hauls on one-way chains entered beyond it.

Found on 2026-11-09 while reworking Review and the design standards; **read** unless marked.

- A permitted short pitch is still coloured as over the limit on the plan, in the 3D view and in
  the mapped-road panel. They compare each grade with `settings.maxGradePercent` directly
  (`PlanView.tsx`, the active road's segment colour; `TerrainPreview.tsx`, `maxGradePercent`;
  `MappedRoadPanel.tsx`) instead of `reviewGrades` (`designStandards.ts`). The station flags, the
  header's grade card and the Review grade row do apply the allowance.
- Route search, the corridor optimizer and the profile optimizer read the grade limit and the minimum
  radius only (`routing.ts` `suggestRoutes`, `corridorOptimizer.ts`, `verticalOptimizer.ts`). They
  ignore `project.standards`: no short-pitch allowance, no adverse limit. Route search keeps its own
  `routeSearch.haulGrades`, and the complete-route comparison its own connector-check limits.
- The standards' design speed is recorded and printed but not applied: `alignment.curveDesign`
  (`CurveTools.tsx`) keeps its own speed per road.
- A road added after the project is created takes `DEFAULT_TEMPLATE`, not the standards'
  running-surface width (`newAlignment` in `DevForestryRoads.tsx`, `starterAlignment` in
  `terrain.ts`). Review's template row raises the difference.
- The drainage check goes out of date when only the grade limit or the minimum radius changes,
  although neither alters the design surface: `drainageInputFingerprint` (`drainageEvidence.ts`)
  hashes every road setting. **Confirmed** in a walkthrough.
- Review's constraint row tests sampled centreline stations only (`avoidAt` in `engine.ts`): a road
  that clips an area between two stations, or whose batter reaches into one, is not raised there.

Found on 2026-11-09 while fixing Review, the grade rule and invalid inputs; **read** unless marked.

- A short dip under the limit starts a new pitch. `reviewGrades` (`designStandards.ts`) ends a run
  at the first station inside the sustained limit, with no minimum separation: 100 m at 16 % with a
  5 m dip to 11.9 % reads as two permitted pitches of under 50 m against a 50 m allowance
  (**confirmed** by a probe). Whether two pitches that close together are one is a standards
  decision the record does not hold.
- A short-pitch limit above both sustained limits applies to loaded-uphill grades at its full
  value: with an 8 % adverse limit and "20 % for 100 m", 50 m at 19.5 % loaded uphill is permitted
  (`pitchAllowance`, `designStandards.ts`). The guide says so; an adverse limit usually wants its
  own, lower allowance, which the record has no field for.
- The grade flag rounds its limit to two decimals (`trim`, `designStandards.ts`): a 12.345 % limit
  flags "Grade exceeds 12.35%" beside a warning that says 12.345 %.
- With haul allocation off, Review's earthwork row compares the covered totals only and can read
  "Cut and fill balance within tolerance" on a road with unknown lengths (`assessReadiness`,
  `readiness.ts`). Its measured line says "(covered sections only)" and the terrain row raises the
  gap, but the row itself is met.
- A constraint's review date and a stream assessment's dates still accept a day that does not
  exist (`parseConstraintPolicy`, `constraints.ts`; `dateText`, `streamClass.ts`). The standards'
  confirmation date and the issue date now use `isCalendarDate` (`projectIssue.ts`).
- While an input is invalid, the valid edits made since are applied one field or one list entry at
  a time (`withoutInvalidInputs`, `analysisResult.ts`). An edit to another field of the invalid
  entry itself is applied too, so a stripping range with an impossible station range and a new
  depth is calculated at its last valid range and the new depth.

Found on 2026-11-09 while fixing the station box, imports and the hand-run specs.

- **The first-visit example card covers a phone's Save button (confirmed).** `ExampleStartNotice`
  (`ProjectHeader.tsx`) stays until it is dismissed or another project is opened, and importing
  your own terrain is not "another project". On a phone the notification stack runs along the
  bottom above dialogs, so the card sits over **Save project JSON** in Save & export
  (`forestry-road-new-area-mobile.spec.ts` now dismisses it). It needs a rule for when it goes:
  on the first edit or import, or when a dialog opens.
- **Map notes add their own layers (read).** `NotesLayer` (`PlanNotes.tsx`) calls `map.addSource`
  and `map.addLayer` outside the plan's ordered group, and is not one of the exceptions in
  `docs/forestry-tool-standard.md`. Its layers sit under the whole group, contours included,
  wherever the terrain image was added before them, and under the terrain image if it was not.
- **A 3D shapefile or KML line cannot state its datum (read).** `readSpatialImport`
  (`spatialImport.ts`) keeps heights only for a GeoJSON feature carrying `referenceVerticalDatum`,
  and the import dialog has no field for one, so a surveyed line from any other format anchors a
  section component to ground. The component's own reference surface is the way round it.
- **A typed station does not carry a vertical-check message (read).** `checkVerticalDesign`
  messages are put on the nearest calculated station (`analyzeRoad`, `engine.ts`), so a station
  typed beside a failed control shows its own flags and grade flag only (`roadStationAt`,
  `stationAt.ts`).

## Fixed on 2026-11-09

- Review no longer passes a profile whose vertical curves the engine dropped. A curve longer than
  its tangents, or overlapping its neighbour, used to count as a curve ("All 2 grade breaks have a
  vertical curve") and to pass the minimum K on its entered length. The rows read the applied
  curves and name each dropped one with its station (`assessReadiness`, `readiness.ts`), and
  `checkVerticalDesign` (`verticalStandards.ts`) fails a dropped curve against a minimum K or curve
  length instead of judging the length that was typed.
- An invalid input leaves out only itself. The fallback used to replace the template, engineering,
  widenings and curve rules together with the last valid set, so a culvert price changed after an
  out-of-range width was ignored. `safeAnalyzeRoad` (`analysisResult.ts`) now puts back one
  difference at a time. Every result says what it leaves out: the header tiles, the charts alert,
  the cost dialog, a leading Review row and the first model flag. The report and map PDF are
  stamped; LandXML, stakeout, plot book, station and engineering CSVs, GeoJSON and shapefiles are
  refused (`INVALID_INPUT_RULES`, `exportCatalog.ts`). A ditch bottom can no longer be typed wider
  than its top (`ditchWidthRange`, `templates.ts`), and the project parser refuses one.
- A material plan that was not solved, or is infeasible, no longer states quantities. It reported
  all fill as unallocated borrow and all cut as unallocated waste: the cost breakdown listed
  default-rate rows its total left out, and Review read "22,165 m³ of borrow has no source"
  (`allocateOrReport` and `haulCostLines`, `engineering.ts`; `materialPlanMissing`,
  `engineeringTypes.ts`).
- Six Review rows read met when nothing was calculated: corners, stream crossings, riparian class,
  constraint areas, unit rates and structure prices. Each now reads not assessed, and every
  culvert is no longer "beyond the road end" of a road with no length (`assessReadiness`,
  `readiness.ts`; `assessCostReadiness`, `costReadiness.ts`).
- A short-pitch limit between the adverse limit and the grade limit is applied, to loaded-uphill
  pitches (`gradeRule`, `designStandards.ts`). A pitch is measured by the intervals its stations
  describe, so a 50 m pitch measures 50 m at the road end instead of 55 m, and 45 m at its start
  (`reviewGrades`).
- The Review list leads with what needs attention and folds the rest: about 820 px on the example
  road, from about 2,200 px (`ReadinessList`, `ReadinessPanel.tsx`).
- Review counts unpriced culverts from the records, not by splitting a sentence on commas, and its
  rates button leads to where the outstanding rate is edited. The cost dialog lists an unpriced
  culvert that has no inverts. The standards' confirmation date and the issue date refuse days
  that do not exist. A failed save is stated once in the header, and the project name and save
  state stay readable beside the road switcher down to 768 px.
- The station box no longer rewrites what is being typed. On a terrain profile, and on a road while
  an input was invalid, "8" became "10" and the next key made "105", because the box showed the
  nearest calculated station after every key. The text is now the box's own until Enter or blur
  (`StationBox.tsx`), a typed station is evaluated on the road shown while an input is invalid
  (`calculatedAlignment`, `useRoadWorkspace.ts`), and a note says when the nearest calculated
  station is shown instead (`typedStationNote`, `stationAt.ts`). A typed station also carries its
  radius, avoidance-area and grade flags and the reasons its section is incomplete.
- An imported 3D feature that states its vertical datum keeps its heights. Every picker read files
  through `readSpatialImport`, which dropped the third coordinate, so a component anchored to a
  measured line took ground at the intersection without saying so.
- Overlapping ground horizons can be saved. The calculation gave the overlap to the later horizon
  and the editor said so, but `parseEngineering` (`engineeringProject.ts`) still refused any
  overlap, so a fourth **Add material horizon** under an open-ended one, or a local layer over a
  whole-road one, left the project unsaved with "Material horizons cannot overlap".
- Undo on the deleted-road notice restores into the project the road came from only; the notice
  ends when another project is opened (`openedCount`, `useRoadWorkspace.ts`).
- Reference layers are added and ordered with the plan's other layers (`REFERENCE_LAYERS`,
  `ReferenceLayer.tsx`; `PlanView.tsx`), so a terrain image or an edit cannot put them out of view.
- The report's **Terrain and assumptions** prints the point-cloud import summary.

- A gap in the terrain data no longer breaks the mass-haul curve or the haul allocation. The mass
  ordinate is the known earthwork so far and is carried across an incomplete interval instead of
  reading "unknown after an incomplete section" to the end of the road (`analyzeRoad`, `engine.ts`;
  `calculateEngineering`, `engineering.ts`). Haul treats the road as continuous: cut beyond a gap
  reaches fill or a site before it at its full distance, in nearest-source and economic mode
  (`allocateHaul`; `materialAllocation.ts`; `sparseMaterialAllocation.ts`). A road with usable cut
  4,190 m³ against fill 4,151 m³ used to borrow 1,692 m³ and waste 1,923 m³, the waste
  "unallocated" beside an unbounded site. Quantities inside the gap are still unknown, excluded and
  flagged, and an entered blocked range still stops material. Station CSV, the report and the plot
  book now carry a mass value at and after a gap, and haul, borrow and waste on a road with gaps
  differ from older exports.
- The station table's rows add up to its Cum. tot. row at every reporting interval. A 100 m row
  holding a gap used to be blanked, so the visible cut rows summed to 2,536 m³ under a total of
  4,655 m³; it now reports the known part with a flag (`reportingRows`, `StationTable.tsx`). The
  first row of a narrowed range no longer counts the interval before the range.
- The station table has surfacing, stripping, borrow and waste volumes per row with totals, and a
  CSV button that exports the table at its reporting interval. The Station CSV gained four columns
  after `mass_balance_m3` (`interval_surfacing_volume_m3`, `interval_stripping_bank_m3`,
  `interval_borrow_compacted_m3`, `interval_waste_bank_m3`), so read it by header, not by position.
- A curve that does not fit says so where it was typed. A horizontal radius of 2000 used to become
  1000 without a word (the field's own limit, now the engine's 10,000 m), and an unfitted radius or
  vertical curve showed only in Stations → Curves or as "Unfitted" in a table. The note under the
  field gives the tangent needed, what is available and the largest value that fits
  (`horizontalCurveFits`, `engine.ts`; `curveFit.ts`).
- Turnout and landing entry: the form states that Start and End include the tapers and shows the
  full-width range. A typed entry taper of 7.5 m on a 15 m range became 5 without a word, because
  the field's limit used the raw shared taper; the limit now uses the tapers as applied and says
  when it holds a value (`limitedTaper`, `wideningEntry.ts`). Duplicate asks for the copy's start
  instead of stacking it on the original.
- Delete removes the point selected for editing. Moving or removing a point on a road with a
  designed profile now says that its PVIs kept their stations; one 30 px drag had taken cut from
  2,603 to 21,181 m³ with no hint why.
- Profile tangents too short on screen for their "grade · length" label (under 100 px) now show
  the grade alone down to 40 px, so a 129 m tangent on a whole-road view is no longer unlabelled.
- A typed station is kept. 85 used to land on 80 and 716.1 on 720, and a pit added from the
  selected station took the snapped value. The section is now evaluated at the typed chainage
  (`roadStationAt`, `stationAt.ts`), and a value past either end says it was held to the road.

## Fixed on 2026-10-26

- A grade line far above or below the ground no longer looks like the road breaking. Where a batter
  is still in the air (or underground) at the section reach, the plan used to drop the envelope
  at that station, so a tall fill drew as a widening fan that stopped dead. The station flag now
  says "batter runs past the N m section reach" (`beyondReachFlag`, `engine.ts`) instead of the
  catch-all "extend section or check terrain", which now means terrain ran out first. The plan
  draws those intervals as a red dashed band out to the reach, and the Design and Review tabs list
  them with **Extend reach to 100 m**. Station CSV and report flags read differently from older
  exports for these stations; quantities are unchanged.

## Fixed on 2026-10-24

- Reverse curves with closely spaced spirals now return to normal crown and zero curve
  widening at the midpoint of the intervening tangent. Opposing runoff is limited to each
  spiral plus half that tangent. The failure was reproduced with 20 m spirals, 30 m runoff
  and a 0.02 m tangent, and checked with unequal spiral lengths too (`spiral.test.ts`).
  Exact touching spiral trims are rejected as overlapping geometry, so the earlier description
  of a no-tangent case was corrected to the reproducible short-tangent case.

## Fixed on 2026-10-22

- Small source gaps no longer become conspicuous white holes in the 3D preview:
  Fill gaps adds explicitly labelled display estimates inside enclosed gaps up to
  80 m across. Switching it off restores source holes. Larger/boundary gaps stay
  open, and missing elevations remain missing in every analysis and export.
- Follow terrain grids are anchored to fixed ground coordinates rather than the moving
  camera window; the same source gap no longer flickers into different coarse cells.
  Zoom, pan and Fit are available, and ground/batters use a canvas with bounded sample caching.
- Pane drags preserve the map's WebGL backing buffer until release. Plot labels are
  nonselectable across the application, including future SVG and canvas charts.
- Save opens the file/export dialog, including map/report PDF downloads. Map controls and
  legends use the shared styled components. Panels can close and restore through screen presets.

Exports and analyses made before these fixes can differ from current ones in these ways.

- Terrain preview: missing centreline or section samples classify their coarse mesh cells as
  unsupported. Source-gap mode preserves those holes; optional display infill labels its
  estimates. Profile and section charts hatch missing intervals, and the selected station
  explains the source gap. Station entry shows tenths of a metre while retaining exact shared chainage.
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
