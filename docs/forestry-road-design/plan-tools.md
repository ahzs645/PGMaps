# Plan tools: pegging at grade, point query, measure, road colours and follow station

The plan's toolbar, beside **Inspect** and **Edit points**, holds three tools of its own:

- **Peg at grade** (footprints icon) lays a grade line from the active road's end with the mouse.
- **Query a point** (magnifier icon) reads the station, offset and levels of any point, and goes
  to a typed station and offset.
- **Measure** (ruler icon) measures a distance, an area or a circle. It is the shared measure tool
  (`map-measure.tsx`, the one `/dev/interact` uses; see `docs/shared-ui.md`, **Drawing and
  measuring on a map**), and it stays available in an access investigation and on terrain alone,
  where Peg and Query are hidden.

The plan's **Layers** button, under the zoom buttons, switches the basemap between Map and
Satellite, the same choice as the visual-quality maps (`map-satellite-imagery.tsx`), remembered in
this browser. The imagery sits under the plan's layers and labels; over it the hillshade drops to
half opacity so the imagery reads through, while slope, aspect and elevation stay as they were.

**Map display settings** (the sliders button) adds two plan options: **Colour road by** (Plain,
Grade class or Cost per metre, with its **Scale and colours** fold) and **Follow station**. Both
are remembered in this browser; a browser that had the old **Colour road by** choice, or the
older **Colour by grade** box ticked, starts on it.

The calculations are `pegCursor.ts`, `pointQuery.ts`, `gradeClasses.ts`, `costColours.ts` and
`followStation.ts`.
They have no DOM, terrain fetches or network access, and carry the unit tests. The components
(`PlanTools.tsx`, `PegTool.tsx`, `PointQueryTool.tsx`) only route events to them.

## Before you rely on it

- **Pegs are a P-line.** Each peg is a horizontal point with radius 0, as in the pegging table.
  Give the angle points curves (the radius column, or **Fit sharp corners**) before reading
  quantities. The Review list flags sharp PIs until then.
- **The grade held is the ground's, not the road's.** A peg lands where the ground at the next peg
  is at the target grade from the ground at the last one. The designed profile, its cut and fill
  and its curves come afterwards. Check the profile once the line is on the road.
- **Grades are read on the ground trend.** On LiDAR-scale terrain (cells of 3 m or finer), the
  tool reads the same 12 m moving mean the route searches use (**Ground trend** in
  [Alignment and optimization](alignment-and-optimization.md#ground-trend), or the project's own
  `routeSearch.groundWindowM`). The pegging table's **Grade** column reads the terrain itself, so
  it can differ by a percent or so on rough ground. Missing ground is never averaged in.
- **Point query reads the calculated design.** The design level comes from the road's section,
  evaluated exactly at the station measured (`createRoadStationSampler`). It includes the
  formation, ditches and batters out to the catch points. Imported reference surfaces are not
  read, so a section built over one may differ slightly from the section chart.

## Pegging at grade

1. Select a design road you can edit. Mapped roads and the first-road placeholder cannot be
   pegged; the button says so.
2. Pick **Peg at grade**. The panel at the plan's lower left holds the **Grade (%)**, **Up** or
   **Down**, the **Step (m)**, **Straight legs** and the **Aim (°)**. The Aim stays blank, and
   **Add leg** off, until the cursor or a typed aim gives one. A grade or step outside its limits
   stays as typed, with the limits under the field, and no leg is placed until it is corrected.
   Picking a tool folds the plan's legend, which shares the lower edge; open it again from its
   header.
3. Move the cursor. A dashed leg runs from the last peg (the yellow dot) one step long, at the
   target grade, on the heading nearest the cursor. Its colour says up (orange), down (blue) or
   over the road's grade limit (red). The label beside it gives its grade and length.
4. **Click** to add the leg. **Alt-click** (Option-click) adds a straight leg to the clicked point,
   whatever its grade; **Straight legs** does the same for every click. **Right-click**,
   **Backspace**, **Undo leg**, or Ctrl/Cmd+Z while legs are held, removes the last leg.
   A straight leg clicked within `DRAW_SNAP_PX` screen pixels of another road ends exactly on it
   (`drawSnap.ts`), and the note says which road, so a run can join a road or end on one. A leg at
   grade is placed by the grade and is never moved onto a road; switch to a straight leg for the
   last peg.
5. **Enter**, a **double-click** or **Finish** adds every leg to the end of the road in one edit,
   which one Undo removes. **Escape** or the close button drops the legs and puts the tool down.

From the keyboard: with the map focused (Tab to it), **←** and **→** turn the aim 5° (1° with
Shift) and **Space** adds the leg. The panel's **Aim (°)** field and its buttons do the same from
anywhere. Keys never reach the tool while a field, button or dialog has focus, except Escape and
Backspace on a plan button.

The road drawing modes (**Peg road**, **Sketch a road**, **Extend road**, **Edit points**, the
draw tools) also put down on **Escape**, as their card's **Cancel drawing** does, from anywhere but
a field, a dialog or an open menu (`leavesDrawingOnEscape`, `PlanTools.tsx`). They are usually
picked from the ribbon, whose button still has focus.

Picking a road drawing mode, **Edit points**, a note tool or a plan pick puts the tool down. If the
road's end moves while legs are held (an Undo, or an edit elsewhere), the legs are dropped and the
tool starts again from the new end.

### Where no leg can be placed

The label at the cursor turns amber, says why, and a click adds nothing. Near the plan's right edge
the label sits to the left of the cursor, so it is not cut off. A grade in the message that rounds to
the target is printed with more decimals ("the ground runs −2.96 to …" against −3.0 %).

| Message                                                     | Cause                                                                 | What to do                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| "No leg at +8.0 % at 30 m … the ground runs −3.1 to +5.2 %" | No heading within 90° of the cursor reaches the grade at this step    | Lower the grade, lengthen the step, or aim along the slope    |
| "Every leg at … here crosses a gap in the terrain"          | Legs at the grade exist, but each crosses missing ground              | Aim another way, change the step, or load terrain for the gap |
| "No ground 30 m out this way"                               | The step runs off the terrain in every direction searched             | Shorten the step, or load terrain                             |
| "… part of this way has none"                               | No leg at the grade on the ground there is, and some of it is missing | As above; the answer may lie in the missing part              |
| "No ground under the last peg"                              | The road's end is off the terrain                                     | Alt-click a straight leg back onto the terrain                |
| "A straight leg is at most 2,000 m"                         | Straight leg too long                                                 | Add a peg on the way                                          |

## Point query

Pick **Query a point** and click the plan. The panel reads:

- **Road**: the nearest road to the point, active or not.
- **Station** and **Offset**: where the point is square to that road's centreline, curves
  included. Offsets are negative to the left looking up-station, as everywhere in the tool.
- **Ground**: the terrain at the point.
- **Design**: the design surface at that station and offset.
- **Cut/fill**: design minus ground; a cut is design below ground.

A dashed violet line joins the point to the centreline, and the station is selected in the
profile and section when the road is the active one. **Go to** locates a typed station and offset
on the active road. The station is evaluated where it was typed (`roadStationAt`), decimals
included, not snapped to a calculated station, and the station box shows it. The fields' arrow
steps (1 m, 0.5 m) do not limit what can be typed.

Unknown stays unknown:

- A point with no terrain under it has no ground level and no depth.
- Beyond the catch points there is no design surface, so no design level and no depth.
- A road whose section cannot be evaluated there (an invalid input) has no design level.
- A point before the road's start or past its end is measured from that end and says so.

## Measure

The tool opens measuring a distance; **Distance**, **Area** and **Circle** in its card start again
with that shape. Click to add points: a polygon closes on a click on its first point, a
double-click or **Close polygon**; a line ends on a double-click or **Finish line**; a circle takes
its centre, then its edge. Backspace takes the last point back, Escape puts the tool down, and
nothing is saved. Distances are great-circle on the map and areas are plan areas: neither follows
the terrain, so a slope distance is longer than the one read here.

**Draw area** and **Draw block** draw with the same interaction (numbered points, a rubber band
back to the first point, close on it or double-click), and their card reads the perimeter and area
as it goes. The plan's own click handler still places those points, so they are drawn where they
are clicked, without snapping, as before.

## Colour road by

How the road is coloured is one setting for the whole page (`roadColouring.ts`, kept by
`useRoadColouring.ts` in this browser under `pgmaps-road-colouring`, never in the project file).
The map settings' **Colour road by**, the cost dialog's **Colour road by this** and Save & export →
Map PDF → **Options** all read and change that one value through the same controls
(`RoadColouringFields.tsx`), so the plan and the printed map always agree. A new way to colour the
road is one entry in `ROAD_COLOUR_MODES`, its settings in `RoadColouring` and `parseRoadColouring`,
and its colouring function beside `gradeClasses.ts` and `costColours.ts`. With nothing changed,
each mode draws with the defaults below; **Reset** in the fold puts the mode's scale and colours
back.

**Grade class.** The active road's segments take the class of their design grade, judged on the absolute grade
against the project's grade limit: up to half the limit, to three quarters, to the limit, and
over it. A grade on a break belongs to the class below, so a road exactly at the limit is within
it. Segments with no terrain under them stay grey, as without the option. The legend lists the
classes the road shows. Other roads keep their own colours. Under **Scale and colours** the two
inner breaks (as percentages of the grade limit, default 50 and 75) and the three colours within
the limit can be changed; over the limit stays the plan's red and unknown its grey, so they still
read as the flags they are.

**Cost per metre.** Each calculation interval takes its cost per metre against the road's own
average $/m over its complete length (`costIntensityClasses`, `costColours.ts`) and is coloured on
a continuous ramp, by default viridis from pale yellow to deep purple, even in log scale from a
quarter of the average or less to four times it or more, so the average is the ramp's middle
(`costRampPosition`, `costRampColour`). Under **Scale and colours** the ramp can be any of the
toolkit's low-to-high or either-side-of-a-middle ramps (`COLOR_RAMPS`; the rainbow is not offered
for an amount), reversed, or a gradient of the person's own (its colours are kept with the
setting); the ends can be moved (low end 0.01–0.99 ×, high end 1.01–100 ×); and the colours can be
read against a typed **target $/m** instead of the road average, which makes roads comparable
with each other. The legend's heading then names the target beside the average, and its ticks read
"× target". An interval whose sections are incomplete is grey, and one where nothing is
placed is light grey. The legend draws the same ramp with its ends and middle in $/m, under a
heading that names the average, and lists the two greys below it; the other roads are listed under
their own **Other roads** heading. By default the whole
estimate is coloured; the cost dialog's **Colour road by this**, or picking a stretch in its
**Where it falls**, colours one row instead, and the legend names it with a **Whole estimate**
button to go back. The row is kept until the page reloads. The cost is spread only while this
option or the cost dialog is in use, and a dragged edit draws the road plain until it lands. See
[Where the cost falls](sections-quantities-and-costs.md#where-the-cost-falls).

## Follow station

With **Follow station** on, the plan pans to keep the selected station in view while you scrub
the profile, a chart, the slider or playback. It pans only when the station comes within 15 % of
an edge, at most four times a second. It holds still while the pointer is over the plan, because a
hover there moves the station, and for 1.5 s after you pan or zoom it yourself.

## Hovering the road

In Inspect and Edit, the pointer does not have to sit on the road's few pixels to move the
station (`planHover.ts`). It picks the road up within 16 px (`HOVER_CAPTURE_PX`) and then follows
it until the pointer is more than 48 px away (`HOVER_RELEASE_PX`), so a hand that drifts off the
line is not dropped. Farther away the station stays where it was. A quick swipe across the road
selects the station where the swipe crossed it, even when no pointer event landed near the line.
The cursor turns to a pointer while the hover is following the road. The station is always a
calculated station, the one nearer the pointer's foot on the road. A press (pan or bend-handle
drag) never scrubs, and a radial spoke under the pointer still takes precedence.

## Limits and budgets

| Limit                                  | Value                                  | Enforced in                                                          | When exceeded                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| Hover pick-up / let-go distance        | 16 px / 48 px                          | `planHover.ts` `HOVER_CAPTURE_PX`, `HOVER_RELEASE_PX`                | Station stays where it was               |
| Peg step                               | 1–500 m                                | `pegCursor.ts` `MIN_PEG_STEP_M`, `MAX_PEG_STEP_M`, `pegStepError`    | Field keeps it, shows the limits; no leg |
| Target grade                           | 0–30 % either way                      | `pegCursor.ts` `MAX_PEG_TARGET_GRADE`, `pegGradeError`               | Field keeps it, shows the limits; no leg |
| Headings searched                      | ±90° of the aim, 2° brackets           | `pegCursor.ts` `PEG_SEARCH_HALF_ANGLE`, `findGradePeg`               | "No leg at …"                            |
| Legs held before finishing             | 200                                    | `pegCursor.ts` `MAX_PEG_TOOL_LEGS`                                   | Leg refused; finish and peg on           |
| Straight leg                           | 2,000 m                                | `pegCursor.ts` `MAX_STRAIGHT_LEG_M`                                  | "A straight leg is at most 2,000 m"      |
| Double-click                           | second click within 400 ms and 6 px    | `pegCursor.ts` `PEG_DOUBLE_CLICK_MS`, `_PX`                          | Read as two clicks: two legs             |
| Aim keys                               | 5°, 1° with Shift                      | `pegCursor.ts` `PEG_AIM_STEP_DEG`, `_FINE_STEP_DEG`                  | —                                        |
| Road points                            | 2,000 per road, and across the project | `project.ts` `MAX_POINTS`                                            | Finish refused with the parser's error   |
| Centreline read for a query            | every 1 m, at most 20,000 pieces       | `pointQuery.ts` `POINT_QUERY_STEP_M`, `MAX_POINT_QUERY_SAMPLES`      | Longer roads read more coarsely          |
| Typed offset                           | ±1,000 m                               | `pointQuery.ts` `MAX_QUERY_OFFSET_M`                                 | Field changes it to ±1,000 and says so   |
| Cursor label                           | 224 px wide, 12 px from its point      | `pegCursor.ts` `CURSOR_LABEL_MAX_WIDTH_PX`, `cursorLabelSide`        | Drawn left of the point instead          |
| On grade                               | within 5 mm                            | `pointQuery.ts` `ON_GRADE_M`                                         | —                                        |
| Grade class breaks                     | ½, ¾ and 1 × the grade limit           | `gradeClasses.ts` `GRADE_CLASS_BREAKS`                               | —                                        |
| Grade class breaks (settable)          | 5–95 % of the limit, rising            | `roadColouring.ts` `ROAD_COLOURING_LIMITS.gradeBreak`                | Field changes it to the range, says so   |
| Cost ramp ends (default ¼ and 4 ×)     | low 0.01–0.99 ×, high 1.01–100 ×       | `roadColouring.ts` `ROAD_COLOURING_LIMITS.minRatio`, `.maxRatio`     | Field changes it to the range, says so   |
| Cost target                            | 0.01–1,000,000 $/m                     | `roadColouring.ts` `ROAD_COLOURING_LIMITS.targetPerMetre`            | Field changes it to the range, says so   |
| Cost "nothing placed" and "unknown"    | ½, 1, 2 and 4 × bins, used only to tell those two apart from the ramp | `costAttribution.ts` `COST_INTENSITY_BINS`         | —                                        |
| Follow margin                          | 15 % of the view, at least 40 px       | `followStation.ts` `FOLLOW_MARGIN_FRACTION`, `FOLLOW_MIN_MARGIN_PX`  | —                                        |
| Follow throttle; hold after a user pan | 250 ms; 1.5 s                          | `followStation.ts` `FOLLOW_THROTTLE_MS`, `FOLLOW_HOLD_AFTER_USER_MS` | —                                        |

## Built-in assumptions

- A leg's grade is between its two ends. Ground between them can be steeper; the pegging table's
  steepest sampled grade and the profile show it.
- The heading chosen is the one nearest the aim that holds the grade with full terrain coverage.
  Where two headings hold it, the nearer one wins; a leg can swing up to 90° from the cursor.
- A point query's station and offset come from the centreline read every metre: about 6 mm off on
  a 20 m radius curve.
- Grade classes use the design grade of each calculation interval, so a vertical curve inside an
  interval shows that interval's grade.

## What it does not do

- Change the road while legs are held. Nothing reaches the road before **Finish**.
- Peg from the road's start, or start a new road. Extend the road from its end, or peg a new road
  with **Peg road** first.
- Hold a design grade or a profile. Use the profile optimizer or the PVI table for that.
- Query a terrain profile or a mapped-road record: the tools are off for both.
