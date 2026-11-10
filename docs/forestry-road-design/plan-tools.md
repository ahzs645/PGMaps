# Plan tools: pegging at grade, point query, grade colours and follow station

The plan's toolbar, beside **Inspect** and **Edit points**, holds two tools of its own:

- **Peg at grade** (footprints icon) lays a grade line from the active road's end with the mouse.
- **Query a point** (magnifier icon) reads the station, offset and levels of any point, and goes
  to a typed station and offset.

**Map display settings** (the sliders button) adds two plan options: **Colour by grade** and
**Follow station**. Both are remembered in this browser.

The calculations are `pegCursor.ts`, `pointQuery.ts`, `gradeClasses.ts` and `followStation.ts`.
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
5. **Enter**, a **double-click** or **Finish** adds every leg to the end of the road in one edit,
   which one Undo removes. **Escape** or the close button drops the legs and puts the tool down.

From the keyboard: with the map focused (Tab to it), **←** and **→** turn the aim 5° (1° with
Shift) and **Space** adds the leg. The panel's **Aim (°)** field and its buttons do the same from
anywhere. Keys never reach the tool while a field, button or dialog has focus, except Escape and
Backspace on a plan button.

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

## Colour by grade

The active road's segments take the class of their design grade, judged on the absolute grade
against the project's grade limit: up to half the limit, to three quarters, to the limit, and
over it. A grade on a break belongs to the class below, so a road exactly at the limit is within
it. Segments with no terrain under them stay grey, as without the option. The legend lists the
classes the road shows. Other roads keep their own colours.

## Follow station

With **Follow station** on, the plan pans to keep the selected station in view while you scrub
the profile, a chart, the slider or playback. It pans only when the station comes within 15 % of
an edge, at most four times a second. It holds still while the pointer is over the plan, because a
hover there moves the station, and for 1.5 s after you pan or zoom it yourself.

## Limits and budgets

| Limit                                  | Value                                  | Enforced in                                                          | When exceeded                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
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
