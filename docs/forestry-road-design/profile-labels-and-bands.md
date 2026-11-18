# Profile labels, grade trouble and value bands

The road profile marks what a reviewer reads off a printed plan-and-profile sheet: tangents that
break a grade limit, the begin and end of each vertical curve, crest high and sag low points (and
the sags with nothing to drain them), and numeric bands of ground, design, cut or fill, grade,
crossfall and curvature under the plot. The same marks print on plot-book sheets when their
subviews are on.

The numbers come from two pure modules with no DOM access, so the screen and the sheet cannot
disagree: `profileAnnotations.ts` (tangent grades, curve points, label placement, the PVI drag
readout) and `profileBands.ts` (band values and the curvature diagram). The screen draws them in
`ProfileOverlays.tsx` and `ProfileValueBands.tsx`; the plot book in `plotBookProfile.ts`.

## Where to find them

- **Grade trouble.** On the profile, a design tangent over the project's grade limit is drawn red
  over the design line and its grade label turns red. A tangent over the sustained limit but within
  the short-pitch allowance is drawn amber and dashed. Hover the line for the limit it breaks.
- **While dragging a PVI.** A box beside the handle shows the PVI's station and elevation, the
  grade in and out (red when that tangent breaks a limit) and the deepest centreline cut and fill
  on the tangent each side, with the station. The two deepest points are also marked on the
  profile as bars between ground and design. The box goes when the drag ends.
- **Curve points.** BVC and EVC ticks, ▲ crest high points and ▼ sag low points, each with a
  rotated "name station · elevation" label. Each curve's length and K stay on the existing "VC"
  label at its PVI and in every curve point's tooltip. A sag low point with no culvert within
  15 m is red and reads "no culvert". High and low points are buttons: click, or Tab to one and
  press Enter, to select its station.
- **Value bands.** The profile header's **Value bands** button (next to the grade, curve,
  template and material bands) opens numeric rows under the plot. This browser remembers whether
  they are open. Click a value, or focus the bands and use ← and →, to select its station.
- **Plot book.** **Save → Plot book → Sheet setup**, in a plan and profile chapter: **Value bands**
  and **Curve labels** under **Show on plan & profile sheets**. Both are off until ticked, so a
  sheet printed before is unchanged.

## What is judged, and against what

- **Tangents run PVI to PVI**, as in the grade band. Vertical curves between them are judged by
  the engine's own grade checks and the Review list, not by this colouring.
- **The grade limit is the project's** (`gradeRule(project.settings, project.standards)`): the
  sustained limit, the adverse limit for loaded trucks climbing once a loaded direction is set, and
  the short-pitch allowance for a tangent no longer than its stated length.
- **The road's vertical standards** add signed windows by station range. A tangent is judged on
  the tightest window of every range it shares length with. A range that only touches a tangent's
  end does not hold it. A signed minimum is how a minimum grade is set: `0.5` holds a stretch to
  at least 0.5 % climbing, and `−4` allows descents no steeper than 4 %. The project has no
  separate "absolute minimum grade" setting.
- **High and low points** are where the design grade changes sign. On a fitted curve the point is
  where the parabola's grade is zero. At a PVI with no curve, or one whose curve could not be
  fitted, it is the PVI itself. A flat tangent beside a PVI has no single high or low point and is
  not marked; road ends are never marked.
- **A sag is drained** when an entered culvert is within 15 m of its low point along the road, the
  distance the drainage check takes a culvert to serve a cross-drain candidate. A sag low point
  is the bottom of a vertical curve; the drainage check's cross-drain candidates, drawn yellow on
  the plan, are where modelled flow leaves the road, and the two are not the same places. With no culverts
  entered, every sag is flagged.
- **Cut and fill depths are at the centreline**, ground minus design, from the analysed stations.
  They follow the analysis, so on a slow machine they can trail a fast drag by a frame.

## The bands

| Row        | Value                                                                                                     | Unknown when                              |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Ground     | Ground elevation at the centreline (m)                                                                    | Terrain is missing at the station         |
| Design     | Formation elevation at the centreline (m)                                                                 | The station has no design                 |
| Cut/fill   | C cut or F fill depth at the centreline (m)                                                               | Terrain is missing                        |
| Grade %    | Design grade at the station, positive climbing; it varies through vertical curves                         | The station has no grade                  |
| X-fall L/R | The section's crossfall each side (%), positive falling away from the centreline; bold when superelevated | Never: it is a design value               |
| Stake L/R  | Slope-stake offset each side (m), where the batter meets the ground; negative left; screen only          | That side of the section is incomplete    |
| Clearing   | Clearing width across the road (m), catches plus preparation margin; only when the road computes one     | The station has no clearing width         |
| Sidehill % | Ground cross slope across the road and its uphill side ("13 R"), from `sectionSideSlope.ts`; screen only  | Either side has under 5 m of known ground |
| Curvature  | 1/R, right turns above the line and left below, ramping over spirals; each arc labelled R and side        | Never: it is the fitted geometry          |

A terrain profile has ground, ground grade and sidehill only.

The Sidehill row is coloured at every calculated station, not only the labelled ones, so a steep
stretch shows at any zoom: each station stands for the road half-way to its neighbours, and runs of
one class join (`sidehillSpans`). Under 20 % is untinted, 20–40 % and 40–50 % take rising grey tints
(display steps only), 50–60 % is amber (past the Interior appraisal equation,
`INTERIOR_SIDESLOPE_LIMIT_PERCENT`) and 60 % or more red (the full-bench screen,
`FULL_BENCH_SIDESLOPE_PERCENT`). The plot book's bands leave the row out: `profileValueBands` adds it
only when given `sidehill`.

The Stake and Clearing rows are RoadEng's `L-Ssl`/`L-Ssr` band and clearing width
(`stakeRows`, `profileBands.ts`). Like Sidehill they are on screen only: `profileValueBands` adds them
when given `stakes`, so the plot book's sheets keep their rows. Whether the Clearing row shows is
decided over the whole road, never the window, so the bands keep their height while panning.

Values are printed only at calculated
stations, never interpolated between them. Stations on a round multiple of the spacing (1, 2, 2.5
or 5 × 10ⁿ m) are preferred; when the station interval does not divide it, every station far
enough from the last one kept is used. Unknown values print as —. A value on the plot's left or
right edge starts or ends there instead of centring over the row title in the margin
(`bandValueAnchor`).

On screen, both band sets (**Grade, curve, template & material bands** and **Value bands**) share
one scrolling area capped at 45 % of the chart, and the plot keeps at least 160 px (half a short
chart): with both open the bands scroll rather than squeezing the profile. Neither the plot nor
that area reserves a scrollbar strip (the app's scrollbar is drawn over the content), so a station sits at the same x in the
plot and in every band.

## Curve-point labels never overlap each other

The rotated BVC/EVC, high- and low-point labels also keep clear of the `VC 40 K=9.5` labels over the
PVIs (`rotatedLabelSide`, `ProfileOverlays.tsx`): one that would cross a VC label reads below the
line instead, and one blocked on both sides is left to its tooltip.

Labels are placed by `placeLabels`: in order of importance (a flagged sag, then high and low
points, then curve ends), each label is kept only if no label already kept is closer than the gap.
Zoomed out, BVC and EVC labels go first and their ticks thin; a flagged sag keeps its label longest.
The tooltip always has the full text.

On screen, curve-point labels and PVI callouts are one row (`planProfileMarks`,
`profileAnnotations.ts`): every rotated label competes for the same room, 24 px apart, a flagged
sag first, then high and low points, PVI callouts, curve ends. A vertical curve narrower than 16 px
on screen shows neither its BVC nor its EVC (its high or low point stays). When not every label
fits, those shown drop their elevation (`LP 3+121.5 · no culvert`). On Softree's 27.8 km sample
the whole road went from dozens of overlapping columns to about ten labels on a 380 px chart, the flagged sags; zooming to a
kilometre brings the curve ends, elevations and stations back. Plot-book sheets keep their own
thinning.

## Ground from the design file, and design-only roads

A road imported from a design file that records ground along its centreline (RoadEng station
levels of a road without a profile; a LandXML `ProfSurf`) keeps it as `fileGround`. Where the
terrain has no ground, the profile draws it dashed, labelled "Ground · design file", with the cut
and fill shading against it; the summary card gives its range and the station bar its level, "from
the design file". It is display only: sections, quantities and every band row still need terrain,
which gives ground across the road. A road with no terrain ground at all and no file ground is a
design-only road, not a gap: the plot is not hatched, it says "Design only · no terrain under this
road", the summary card says "No terrain" and the station bar a plain note. Hatching stays for
real gaps in a terrain that covers part of the road.

## What the profile has room to show

`profileLabelLayout.ts` decides what fits; the chart only draws it.

- **Ground grades split where the ground bends.** A road with no design profile is cut into about
  one piece per 110 px of plot, counted over the whole road at the current zoom, so zooming in adds
  pieces and panning keeps them still. Each split goes where the ground is furthest from its
  piece's chord, largest first, and stops when no bend reaches 0.5 m: straight ground stays one
  piece. A piece with a terrain gap splits at the gap's edge, so the gap reads Unknown on its own.
  The Ground band row uses the same breaks at the same width. Design tangents still run PVI to PVI.
- **One placement pass for the plot's text labels.** The station flag goes first, then red grade
  labels, junctions whose level differs by 0.05 m or more, other grade labels, then other
  junctions. Each takes the first spot that stays inside the plot and clears every label placed
  before it, every junction diamond and every PVI handle: a grade label above its line, then below,
  then grade only; a junction label right of its diamond, then left, then with a shorter name. A
  label with no room is left out and its tooltip keeps the text. Curve-point labels and PVI
  callouts keep their own thinning (below).
- **Crowded PVI handles thin out.** Where PVIs sit closer than `PVI_HANDLE_MIN_GAP_PX` (28 px)
  on screen, a handle is drawn only every 28 px, plus both ends and the selected PVI; the grade line
  is drawn whole, and zooming in brings every handle back to drag. A road full-benched from the
  ground it followed (`fullBench.ts`) has one PVI wherever its 22 m terrain bends, about 200 on
  the reference road, which drew as a solid row of rings.
- **Crossings share a tick.** Context crossings within 6 px of each other draw one thicker line;
  its tooltip lists them and a click selects the first. A crossing that a project road already
  marks as a junction (the other road was loaded from that feature, within 10 m) is drawn once, as
  the junction.
- **A mapped road does not cross its own record.** The engine leaves the features a mapped road
  was loaded from (`mappedRoad.contextIds`) out of its crossings. Thinned to the terrain, the road
  weaves across its own record, and each weave used to count as a crossing, a station and a
  profile line: one 3 km road showed 55.

## Limits and budgets

| Limit                                        | Value                                                                           | Enforced by                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Culvert distance that drains a sag low point | 15 m along the road                                                             | `SAG_CULVERT_SEARCH_M` = `DEFAULT_CULVERT_SEARCH_M`                             |
| Gap between band values                      | 46 screen px; 60 on sheets                                                      | `BAND_VALUE_MIN_GAP_PX`, `profileBands.ts`; `SHEET_BAND_VALUE_GAP_PX`           |
| Band area on screen                          | at most 45 % of the chart; the plot keeps min(160 px, half the chart)           | `ChartSlot`, `Charts.tsx`                                                       |
| Values per band across one window            | 400                                                                             | `MAX_BAND_VALUES`, `profileBands.ts`                                            |
| Gap between rotated labels on screen         | 24 screen px, curve points and PVI callouts together; 15 on sheets              | `ROTATED_LABEL_SPACING_PX`, `profileAnnotations.ts`; `SHEET_LABEL_GAP_PX`       |
| Curve ends shown                             | a curve 16 screen px wide or more                                               | `CURVE_ENDS_MIN_PX`, `profileAnnotations.ts`                                    |
| Gap between curve-point markers              | 5 screen px                                                                     | `CURVE_MARK_GAP_PX`, `profileAnnotations.ts`                                    |
| Design-file ground points                    | 10,000 a road                                                                   | `parseFileGround`, `project.ts`                                                 |
| Screen band rows                             | 9 × 16 px, 10 with a Clearing row, + 30 px curvature + 34 px superelevation     | `bandsHeight`, `ProfileValueBands.tsx`                                          |
| Sheet band rows and curvature diagram        | 6 × 17 px + 30 px; the profile is 232 px tall and the plan 320 px with bands on | `SHEET_BANDS_HEIGHT`, `plotBookProfile.ts`; `planProfileSheet`, `plotBook.ts`   |
| Subview values in a saved file               | true or false; absent is off                                                    | `parseRoadReportSettings`                                                       |
| Ground-grade pieces                          | about 1 per 110 px; at least 50 px each; at most 64 per road                    | `GROUND_GRADE_PIECE_PX`, `GROUND_GRADE_MIN_PIECE_PX`, `GROUND_GRADE_MAX_PIECES` |
| Ground bend that splits a grade              | 0.5 m off the piece's chord                                                     | `GROUND_GRADE_BEND_M`, `profileLabelLayout.ts`                                  |
| Crossings sharing one tick                   | within 6 screen px                                                              | `CROSSING_CLUSTER_PX`                                                           |
| Junction level difference printed            | 0.05 m or more; the tooltip always has it                                       | `JUNCTION_LEVEL_SHOWN_M`                                                        |

## Failure modes

- **The drag readout follows the selected station.** A PVI drag holds the profile's domain and
  moves the selected station onto the PVI each move; the readout shows for the PVI at the selected
  station while the domain is held. Pressing on a handle without moving it shows no box until the
  first move when the selected station is elsewhere.
- **A culvert is matched by station only.** A culvert on the other side of a fill, or one too small
  for the catchment, still counts. The drainage check (**Review → Drainage**) is the place for
  capacity and outlets.
- **Crossfall is the section's design crossfall.** It is not measured from terrain; for an existing
  road's measured crossfall use [the profile geometry tools](profile-geometry.md).
- **Vertical curves are judged elsewhere.** A crest curve steeper than the limit on its way to a
  tangent that is within it is not coloured here; the Review list's grade row reports it.
