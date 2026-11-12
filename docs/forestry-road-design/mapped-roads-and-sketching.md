# Mapped roads as roads, and sketched roads

A permitted road, FSR or user road in the project's context can be loaded as a road. Its
profile, sections and grades are then read on the project terrain, it can be compared with route
searches between its ends, and it can be copied as a design to edit. A road can also be drawn
freehand and continued from either end.

This answers a narrower question than "why was this road built?" It measures how a mapped line
sits on the terrain against this project's own limits. It does not date the road, establish who
built it or for which block, or recover the standard it was built to. Those need the evidence in
[Historical block access and crossings](access-history.md).

## Loading a mapped road

Three places load a mapped road:

- **Load as road** on a road's map card (click the road in Inspect mode).
- **Load as road · read its profile** on a road record in Access history, which starts a design
  from an investigation with that road as its first road.
- The **Mapped roads in this project** list in a design that has no road yet.

**Load mapped roads in view** (beside Start design in an investigation, under the Road buttons in a
design, and in the empty design's list) loads every mapped road with a part in the plan's current
view, each as its own road in its own colour, and the **Viewing road** switcher moves between
them. Roads already loaded are skipped. The project's 20-road and 2,000-point limits are shared
out by `loadMappedRoads`: smallest road first, each takes at most a fair share of the points left,
so short permit roads keep their detail and a long FSR is thinned harder to fit. Roads that do not
fit are named in the notice. The design opens on the road the terrain covers best, then the one
nearest the middle of the view, rather than a long FSR that runs off the terrain.

`mappedRoad.ts` joins the parts that share the road's permit section (`forestFileId` and
`roadSectionId`), or failing that its source row (`sourceId`). Each step attaches the part whose
nearer end is closest to either end of the line so far, reversing it if it was drawn the other
way. Parts are run up their recorded `segmentStartStation` when the source gives one. A part
whose nearest end is more than `MAX_JOIN_GAP_M` away is left out and reported, because the gap is
not on the record. Smaller gaps are bridged with a straight join, and the join lengths are kept
on the road.

The joined line is thinned with Ramer–Douglas–Peucker at half the terrain cell size, between
`MIN_THINNING_M` and `MAX_THINNING_M`. Vertices closer together than the terrain can tell apart
add nothing to the profile and spend the project's point budget. The tolerance is raised only when
the line would not otherwise fit the points the project has left.

The loaded road has no vertical controls, so the engine runs its formation along the sampled
ground and its grades are the ground's. Its corners have no curves. Its record — source,
permit and section, joined parts and source IDs, vertex counts, thinning tolerance and joins —
is kept as `Alignment.mappedRoad` and saved with the project.

### What changes for a mapped road

- It is drawn in its own colour from `MAPPED_ROAD_PALETTE` (the same colour in the road switcher and
  Compare alternatives), red where the grade passes the project's limit.
- Its line is held as recorded: Edit points and Extend are unavailable, and the point, vertical,
  curve and switchback editors are replaced by the **Mapped road** panel. **Copy as design** makes
  an editable road on the same line, with no record attached.
- The summary shows ground grade and grade range instead of cut/fill and cost, as a terrain
  profile does. In Compare alternatives its build cost, earthworks and disturbance read
  **Existing**, and nothing is ranked against them. Length and grade are compared normally.
- Route search and the corridor optimizer run between its ends as for any road. Their results are
  named after the record ("R03890 · A alternative …"), never "as mapped".

## The mapped-road review

The **Mapped road** panel reads the road against the project's design settings, which are not the
standard the road was built to. A road over them is not wrong: it may have been built to other
limits or for other traffic, or the mapped line may be off the road bench.

- **Steepest grade** is the steepest rise over `SUSTAINED_GRADE_WINDOW_M` of road, centred on each
  station, so a single noisy terrain cell is not reported as a pitch.
- **Over the grade limit** is the road length whose sustained grade passes the project's limit,
  listed as station ranges.
- **Tightest bend** is the circle through the points `BEND_CHORD_M` either side of each station.
  A digitized corner has no radius of its own; this reads it as the bend it implies at that chord.
- **Terrain coverage** is the share of stations with ground under them. Where the road runs off the
  terrain its grades are missing, never zero. **Load regional terrain over this road** reloads the
  regional DEM over the project's roads.
- Terrain coarser than `COARSE_TERRAIN_M` is flagged. The 22 m regional DEM smooths short pitches,
  so its grades are a floor; import LiDAR for the road's real grades.

FTEN lines are often digitized permit lines and can sit metres off the built road. On LiDAR, a
road whose line misses the bench shows as sidehill grades and one-sided cross-sections.

## Starting a design from an investigation

**Start design** opens a design with no road. The project schema needs one alignment, so the
investigation's internal placeholder stays in the file as `designPlaceholderId`. It is never
analysed, drawn, counted in the project library, or listed in the road switcher. The first road
added — pegged, sketched, loaded or from the map card — replaces it (`withAddedAlignments`).

## Sketching and extending

**Sketch** takes freehand strokes: press, drag, release. The pencil stays in hand for the next
stroke until **Done sketching**. `sketchRoad.ts` thins each stroke at the larger of
`SKETCH_TOLERANCE_PX` screen pixels and `SKETCH_MIN_TOLERANCE_M`, so hand tremor is not read as
corners. The corners then take the project's minimum radius where their tangents allow
(`fitHorizontalRadii`), as a route-search result does.

A stroke that starts or ends within `EXTEND_SNAP_PX` of the active road's start or end continues
that road. Any other stroke is a new road. **Extend** pegs on from the active road's nearer end,
one click at a time. The old end becomes a corner and takes the minimum radius; existing curves
keep theirs.

## Pegging a road onto another road

**Peg road** adds a point per click; **Enter**, a double-click or **Finish road** adds the road in one
edit, and one Undo removes it. While pegging or extending, a click within `DRAW_SNAP_PX` screen
pixels of another road lands exactly on it (`drawSnap.ts`), and the drawn line follows the cursor
onto it before the click:

- Near a road's **end**, the peg takes that end, so the new road joins it end to end. An end in
  reach wins over a nearer point partway along.
- Near the **middle** of a road, the peg lands on its centreline, as drawn with its curves, and the
  header says the new road branches from it. The road it branches from is not changed.
- Design roads and existing roads on the map both snap; the road being extended does not.

A peg on another road's line is what joins the two: the network planner attaches a road to the
line it touches by projecting onto that line's segments (see
[Connected network](connected-network.md)). Streams, areas, terrain profiles and D-lines are drawn
where they are clicked.

A road with a vertical profile, widenings, engineering inputs or crossing records can be extended
only from its end. Adding at the start would move every station those inputs are measured from.

A sketched road is a planning sketch. Its grades and quantities mean as much as the line does.
**Optimize sketched road corridor** under Find the best route searches within a band around it.

## Limits and budgets

| Limit                                                                                       | Enforcing code                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Parts of one road more than 25 m apart are not joined                                       | `MAX_JOIN_GAP_M`, `mappedRoad.ts`                                 |
| Mapped lines are thinned at half a terrain cell, 0.5–5 m, raised only to fit the budget     | `MIN_THINNING_M`, `MAX_THINNING_M`, `thinMappedRoad`              |
| Sustained grades are read over 50 m of road                                                 | `SUSTAINED_GRADE_WINDOW_M`, `mappedRoad.ts`                       |
| Bends are read across 20 m chords                                                           | `BEND_CHORD_M`, `mappedRoad.ts`                                   |
| Terrain coarser than 5 m is flagged as smoothing grades                                     | `COARSE_TERRAIN_M`, `mappedRoad.ts`                               |
| Sketch strokes are thinned at the larger of 4 screen pixels and 2 m                         | `SKETCH_TOLERANCE_PX`, `SKETCH_MIN_TOLERANCE_M`, `sketchRoad.ts`  |
| A stroke within 14 screen pixels of a road end continues that road                          | `EXTEND_SNAP_PX`, `sketchRoad.ts`                                 |
| A pegged point within 12 screen pixels of another road lands on it                          | `DRAW_SNAP_PX`, `drawSnap.ts`                                     |
| Stroke points closer than 1.5 screen pixels are not captured                                | `SKETCH_CAPTURE_PX`, `PlanView.tsx`                               |
| At most 20 roads and 2,000 horizontal points per project, mapped roads included             | `MAX_PROJECT_ROADS`, `MAX_PROJECT_POINTS`, `DevForestryRoads.tsx` |
| Loading roads together gives each at most a fair share of the points left, smallest first   | `loadMappedRoads`, `mappedRoad.ts`                                |
| Up to 20 distinct colours for mapped roads, none the plan's design, grade or terrain colour | `MAPPED_ROAD_PALETTE`, `mappedRoad.ts`                            |
