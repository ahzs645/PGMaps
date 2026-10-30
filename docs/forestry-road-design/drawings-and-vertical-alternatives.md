# Drawings and vertical alternatives

The **Compare** detail view contains **Vertical alternatives on this road**. It keeps several
named profiles under one horizontal road, rather than duplicating the horizontal control points.
The plan, base section template and widening ranges are shared. A plan edit therefore changes
the geometry sampled by every sibling profile.

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

Open **Save → Configure plot book**. Drawing settings travel in project JSON as
`reportSettings`, schema `pgmaps-road-report-v1`. They do not change calculation station spacing.

You can choose A3 or A4 landscape paper and add, reorder, rename or remove chapters:

| Chapter | Controls and contents |
| --- | --- |
| Plan & profile | Station range, maximum metres per sheet, physical horizontal scale or auto-fit, profile vertical exaggeration, plan/profile/mass subviews, contours and legend. |
| Cross-sections | Station range and report interval; equal axis scales or a fixed physical print scale. Original ground, prepared ground when present, and design remain separate. |
| Station schedule | Station range, report interval and selected/reordered columns in their selected order. Calculation-interval volumes retain their own analytical intervals. |
| Horizontal curves | Fitted circular portions intersecting the chapter's range. BC/EC on a spiralled curve refer to its circular arc. |
| Culvert inventory | Entered structures in the range, geometric length/cover/grade, installed cost and review warnings. |
| Material quantities | Cut/stripping, reusable material, unsuitable bank volume and excavation cost over the selected range. Range boundaries clip the engine's linear average-end-area integration; missing intervals stay excluded. |

Curve tables can also be added as a chapter automatically, or inset at the top right of each
plan. An inset shows the first eight curves in that window with an explicit count note; use the
full curve-table chapter for the complete schedule.

Report intervals select existing analytical sections through the same `sectionStations` helper
used by design exports. They do not interpolate a new engineering solution. At a fixed physical
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

| Limit | Enforcing code |
| --- | --- |
| 12 named profiles per horizontal road | `verticalAlternatives.ts`, `MAX_VERTICAL_ALTERNATIVES` |
| Each child uses the ordinary 500-PVI/profile and engineering validators | `project.ts` parser through `parseVerticalAlternativeFields` |
| Child IDs unique; active child must exist; retain at least one child | `verticalAlternatives.ts` |
| 16 authored chapters; 500 generated sheets | `reportSettings.ts`, `MAX_REPORT_CHAPTERS`, `MAX_REPORT_SHEETS`; `plotBook.ts` preflight/add budget |
| Report interval 2–1,000 m; sheet length 10–10,000 m | `parseRoadReportSettings` |
| Fixed horizontal scale denominator 50–100,000 or auto-fit | `parseRoadReportSettings` |
| Profile vertical exaggeration 0.1–20 | `parseRoadReportSettings` |
| Label expression 200 characters; known fields only; offsets ±100 drawing pixels | `validateLabelTemplate`, `parseRoadReportSettings` |

Outputs retain source terrain/datum, sheet numbering and the preliminary-planning title block.
An empty table reports that no records are available. A missing terrain contour layer reports
**Contours unavailable**; a deliberately hidden contour subview reports **Contours hidden**.
Partial quantities cannot establish the cheapest complete design.

The authoring controls provide typed chapters and safe data labels. They do not implement an
unrestricted CAD layout editor, arbitrary executable label expressions, or native RoadEng template
formats. The report is a standalone SVG/HTML book with no scripts or network resources.
