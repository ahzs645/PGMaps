# Drawings and vertical alternatives

The **Compare** detail view folds **Profiles on this road** under its table. It keeps several
named profiles under one horizontal road, rather than duplicating the horizontal control points.
The plan, base section template and widening ranges are shared. A plan edit therefore changes
the geometry sampled by every sibling profile.

Once a road has two or more profiles, the profile pane's header carries a **Profile shown** list
(`ProfileSwitcher.tsx`), so the profile on screen can be changed where it is drawn. It switches
only: adding, renaming, removing and comparing profiles stay in the Compare view. The profile
optimizer's notice points to both when it saves its result as a named profile.

**Add profile** retains the original profile as a sibling and selects a copy for editing. Editing
PVIs, vertical standards and control points affects the selected profile only. Selecting another
profile saves the current edits before loading that profile. The overlay and table compare each
profile using the same terrain and project sampling settings; missing sections remain missing.
An infeasible material prescription displays **Material plan infeasible** instead of a favorable
cost subtotal, even with 100% terrain coverage. Other incomplete engineering/catch-line results
display **Incomplete cost**. Quantities remain available for review.

**Shared materials, haul and structures** applies the active road's engineering definition to
all profiles. **Independent engineering per profile** starts each sibling with a copy, then saves
material, site-preparation, culvert and haul edits independently. Returning to shared inputs uses
the selected profile's engineering definition for all siblings. Terrain and base unit rates remain
project-wide; the base template and width ranges remain shared in either mode. Each child retains
its own complete-access comparison evidence. Switching restores that child's record; changing
shared or profile-specific inputs marks it stale through the ordinary input fingerprint. A new
duplicate starts without an adopted comparison, while the original record remains with its child.

The active profile remains in `Alignment.vertical` so existing engines and exports keep the same
contract. The named children are in `verticalAlternatives`, selected by
`activeVerticalAlternativeId`. `verticalAlternativeCostMode` is explicit. The project commit and
file parser snapshot the active design into its child record. Analysis materializations remove
the child metadata and reuse the parent's exact horizontal points and section inputs.

### Library and definition changes

Library merge remaps imported material IDs inside imported component/layer definitions. Existing
assignments, site preparation, fill requirements, source identities and sidecast restrictions
retain their existing material IDs. An imported template must include the material definitions
it refers to; a same-ID material in the destination is not a substitute for an incomplete library.

**Replace library & clear assignments** explicitly clears the active design's named-template
assignments and ground-material horizons. Other work is retained. Replacement is rejected if a
remaining base-section component/layer, preparation range, fill requirement, haul site or sidecast
restriction, or reviewed project-wide source quote, would lose or silently change its material definition. A custom demand requirement
tied to a removed named-template assignment must be explicitly reassigned or removed first.
The error leaves the project unchanged; merge is the safe choice when retaining that work.

In independent-profile mode a library import changes only the selected child's engineering
library. Sibling definitions, assignments and cost evidence remain intact. The active child's
profile edits are snapshotted before the import. Deleting a referenced template/material is
blocked until its live references are explicitly reassigned or removed.

## Author a plot book

Open **Save**, select **Plot book PDF** or **Plot book HTML** and switch its pane to **Sheet setup**; **Preview** redraws the book as you edit. Drawing settings travel in project JSON as
`reportSettings`, schema `pgmaps-road-report-v1`. They do not change calculation station spacing.

You can choose A3, A4, tabloid (11 × 17 in, ANSI B) or ANSI D (22 × 34 in) landscape paper and add,
reorder, rename or remove chapters. **Saved setups** at the top of the pane keep the whole setup
under a name in this browser, to apply in another project or share as a file; see
[Saved sheet setups](exports-and-project-files.md#saved-sheet-setups). A click on a sheet in the
preview opens its chapter here.

| Chapter             | Controls and contents                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan & profile      | Station range, maximum metres per sheet, physical horizontal scale or auto-fit, profile vertical exaggeration, plan/profile/mass subviews, contours and legend. Optional framing set by hand per plan sheet.   |
| Cross-sections      | Station range and report interval, plus a labelled section at every culvert; equal axis scales or a fixed physical print scale. Original ground, prepared ground and design remain separate.                   |
| Station schedule    | Station range, report interval and selected/reordered columns in their selected order. Cut and fill volumes are each row's total since the previous row, as in the station table.                              |
| Horizontal curves   | Fitted circular portions intersecting the chapter's range. BC/EC on a spiralled curve refer to its circular arc.                                                                                               |
| Culvert inventory   | Entered structures in the range, geometric length/cover/grade, installed cost and review warnings.                                                                                                             |
| Material quantities | Cut/stripping, reusable material, unsuitable bank volume and excavation cost over the selected range. Range boundaries clip the engine's linear average-end-area integration; missing intervals stay excluded. |

Plan & profile sheets can also carry numeric value bands under the profile and BVC/EVC, high and
low point labels on it; both are off until ticked (see
[profile labels and bands](profile-labels-and-bands.md)).

### Culverts on the cross-sections

A cross-section chapter draws a section at each culvert in its range as well as at its interval,
including a culvert that falls between two interval sections. The engine always calculates a
station at a culvert's chainage (`engineeringKnots`, `templates.ts`), so the section is the
analysed one, not an interpolation. Its cell is outlined in blue and labelled with the culvert's
name and opening (a round pipe's diameter, else shape, span × rise, and the number of barrels),
and the barrel is drawn between its invert and crown from the culvert's own profile, projected on
the section line where it is skewed. A culvert that falls on an interval section is labelled
there without adding one; the sheet's scale line then reads "Sections @ 20 m and culverts". An
analysis made before culvert stations were calculated draws the nearest section and says how far
off it is. A book with no culverts prints exactly as before. (`culvertSections`, `plotBook.ts`.)

### Station schedule volumes

The station schedule's rows are the station table's (`reportingRows`, `stationReport.ts`): the
same calculated stations the report interval picks, with each cut and fill volume the total of
every calculation interval since the previous row, so a 100 m row holds the whole 100 m. The
first row of the road sums nothing, and the first row of a chapter that starts part way holds
the road since the previous row of the whole road, as the station table does. With volumes
printed, the flags column also says what road with unknown earthwork a row leaves out. A
schedule without volume columns prints as before.

### Framing a plan sheet by hand

Each plan sheet is framed automatically: turned so its first and last stations run left to right
and centred on the road in its window. On a switchback that can clip a leg of the road. **Plan
sheet framing** under a plan & profile chapter keeps a framing for single sheets, saved with the
chapter as `planSheets`: the sheet whose stations include **Sheet at station** is moved by **Move
right** and **Move up** (metres on the ground, along the sheet) and turned by **Turn left**
(degrees, counter-clockwise; negative turns right). The north arrow and scale bar follow, and the
plan's heading says "framing set by hand" with the values. The profile and mass haul on that
sheet are not moved. The first framing listed for a sheet wins. A field put back to 0 is not
stored, and with no framing every sheet is drawn exactly as before.

Curve tables can also be added as a chapter automatically, or inset at the top right of each
plan. An inset shows the first eight curves in that window with an explicit count note; use the
full curve-table chapter for the complete schedule.

Report intervals select existing analytical sections through the same `sectionStations` helper
used by design exports (the schedule through `reportingRows`, which picks the same stations). They do not interpolate a new engineering solution. At a fixed physical
scale, the exporter shortens the plan/profile window to the printable horizontal width. Terrain
and highly exaggerated profiles may extend outside a frame and are clipped; the scale/exaggeration
note says so. Printing with browser **Fit to page** changes the physical scale. Use the selected
paper and 100% print scaling when a physical scale is required.

Station and grade labels accept text with the fields `{station}`, `{grade}`, `{ground}`,
`{design}`, `{radius}`, `{road}` and `{project}`. Numeric precision is written as `{grade:.1}`
for one decimal (0–4 decimals supported). There is no JavaScript evaluation or arbitrary field
lookup. Unknown values display as `—`; generated text is escaped before it enters SVG/HTML.
Label offsets affect drawing placement only.

## Limits and checks

| Limit                                                                           | Enforcing code                                                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 12 named profiles per horizontal road                                           | `verticalAlternatives.ts`, `MAX_VERTICAL_ALTERNATIVES`                                              |
| Each child uses the ordinary 500-PVI/profile and engineering validators         | `project.ts` parser through `parseVerticalAlternativeFields`                                        |
| Child IDs unique; active child must exist; retain at least one child            | `verticalAlternatives.ts`                                                                           |
| 16 authored chapters; 500 generated sheets                                      | `reportSettings.ts`, `MAX_REPORT_CHAPTERS`, `MAX_REPORT_SHEETS`; `plotBook.ts` preflight/add budget |
| Report interval 2–1,000 m; sheet length 10–10,000 m                             | `parseRoadReportSettings`                                                                           |
| Fixed horizontal scale denominator 50–100,000 or auto-fit                       | `parseRoadReportSettings`                                                                           |
| Profile vertical exaggeration 0.1–20                                            | `parseRoadReportSettings`                                                                           |
| Label expression 200 characters; known fields only; offsets ±100 drawing pixels | `validateLabelTemplate`, `parseRoadReportSettings`                                                  |
| 100 plan sheet framings per chapter; move ±5,000 m; turn ±180°                  | `reportSettings.ts`, `PLAN_SHEET_FRAMING_LIMITS`                                                    |

Outputs retain source terrain/datum, sheet numbering and the preliminary-planning title block.
An empty table reports that no records are available. A missing terrain contour layer reports
**Contours unavailable**; a deliberately hidden contour subview reports **Contours hidden**.
Partial quantities cannot establish the cheapest complete design.

The authoring controls provide typed chapters and safe data labels. They do not implement an
unrestricted CAD layout editor, arbitrary executable label expressions, or native RoadEng template
formats. The report is a standalone SVG/HTML book with no scripts or network resources.
