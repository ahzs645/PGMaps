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
  distance the drainage check takes a culvert to serve a modelled low point. With no culverts
  entered, every sag is flagged.
- **Cut and fill depths are at the centreline**, ground minus design, from the analysed stations.
  They follow the analysis, so on a slow machine they can trail a fast drag by a frame.

## The bands

| Row        | Value                                                                                                     | Unknown when                      |
| ---------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Ground     | Ground elevation at the centreline (m)                                                                    | Terrain is missing at the station |
| Design     | Formation elevation at the centreline (m)                                                                 | The station has no design         |
| Cut/fill   | C cut or F fill depth at the centreline (m)                                                               | Terrain is missing                |
| Grade %    | Design grade at the station, positive climbing; it varies through vertical curves                         | The station has no grade          |
| X-fall L/R | The section's crossfall each side (%), positive falling away from the centreline; bold when superelevated | Never: it is a design value       |
| Curvature  | 1/R, right turns above the line and left below, ramping over spirals; each arc labelled R and side        | Never: it is the fitted geometry  |

A terrain profile has ground and ground grade only. Values are printed only at calculated
stations, never interpolated between them. Stations on a round multiple of the spacing (1, 2, 2.5
or 5 × 10ⁿ m) are preferred; when the station interval does not divide it, every station far
enough from the last one kept is used. Unknown values print as —.

## Curve-point labels never overlap each other

Labels are placed by `placeLabels`: in order of importance (a flagged sag, then high and low
points, then curve ends), each label is kept only if no label already kept is closer than the gap.
Zoomed out, BVC and EVC labels go first and their ticks thin; a flagged sag keeps its label longest.
The tooltip always has the full text. They are placed apart from each other only: a curve-point
label can still cross a tangent's grade label or a PVI callout, which have their own thinning.

## Limits and budgets

| Limit                                        | Value                                                                           | Enforced by                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Culvert distance that drains a sag low point | 15 m along the road                                                             | `SAG_CULVERT_SEARCH_M` = `DEFAULT_CULVERT_SEARCH_M`                           |
| Gap between band values                      | 46 screen px; 60 on sheets                                                      | `BAND_VALUE_MIN_GAP_PX`, `profileBands.ts`; `SHEET_BAND_VALUE_GAP_PX`         |
| Values per band across one window            | 400                                                                             | `MAX_BAND_VALUES`, `profileBands.ts`                                          |
| Gap between rotated curve-point labels       | 13 screen px; 15 on sheets                                                      | `ROTATED_LABEL_GAP_PX`, `ProfileOverlays.tsx`; `SHEET_LABEL_GAP_PX`           |
| Gap between curve-point markers              | 5 screen px                                                                     | `MARKER_GAP_PX`, `ProfileOverlays.tsx`                                        |
| Sheet band rows and curvature diagram        | 6 × 17 px + 30 px; the profile is 232 px tall and the plan 320 px with bands on | `SHEET_BANDS_HEIGHT`, `plotBookProfile.ts`; `planProfileSheet`, `plotBook.ts` |
| Subview values in a saved file               | true or false; absent is off                                                    | `parseRoadReportSettings`                                                     |

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
