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
- **Ground grade along fitted curves is not rechecked (read).** `roadFromRoute` verifies that a
  fitted centreline has ground under it and enters no blocked area. The grade limit was checked
  along the grid route's straight legs, up to 16 m away. The designed profile is what holds the
  grade afterwards.
- **"Had no line left to try" is not proof (confirmed).** The corridor search keeps one arrival
  per cell and heading (`best` in `corridorOptimizer.ts`), so a search that ends with no candidate
  has not tried every line: a second search leaning toward the end found a road in a tube where
  the even search had reported none. **Find the best route** therefore still tries the next step.

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

Found on 2026-11-09 while fixing the station box, imports and the hand-run specs.

- **The first-visit example card covers a phone's Save button (confirmed).** `ExampleStartNotice`
  (`ProjectHeader.tsx`) stays until it is dismissed or another project is opened, and importing
  your own terrain is not "another project". On a phone the notification stack runs along the
  bottom above dialogs, so the card sits over **Save project JSON** in Save & export
  (`forestry-road-new-area-mobile.spec.ts` now dismisses it). It needs a rule for when it goes:
  on the first edit or import, or when a dialog opens.
- **The restored-session notice keeps its own timer (read).** `SessionRestoredNotice`
  (`ProjectHeader.tsx`) dismisses itself with `window.setTimeout`, so it can go while the pointer
  is on it. The shared `Notification` takes `duration` and holds the clock; `RoadRemovedNotice`
  (`LifecycleNotices.tsx`) already does.
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
