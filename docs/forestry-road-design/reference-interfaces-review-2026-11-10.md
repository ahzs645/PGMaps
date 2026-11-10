# How the reference tools handle interaction — 10 November 2026

The [field review](field-review-and-reference-repos-2026-11-10.md) and the
[licensing page](reference-repo-licensing-and-conversion.md) took **methods** from 14 forestry-road
projects. This page records a second read of the same projects for **interaction**. It covers:

- the order a user works in;
- how input is entered;
- what feedback appears while working;
- how results, errors and infeasible cases are shown.

Each finding is set against PGMaps' road-design tool as it stands on `main` at 8906d24f. It ends
with a ranked backlog.

Sources were the projects' own manuals, help pages, dialog layouts (Qt Designer files), screenshots,
command prompts and public user guides. Interaction designs are ideas, not code, so this is a review
only. Nothing was copied into PGMaps: no code, dialog files, text or images. One exception to
disclose: the 3D-CHA project has no licence. A reviewer read about forty lines of named constants at
the top of its main script before checking the licence note. Nothing below relies on them; its
section uses only the README and figures.

## Sources, and how much each says

| Project                  | Interface                                                         | Material read                                                                    | Depth                                                     |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| SEILAPLAN 3.8            | QGIS plugin: setup dialog, profile window, report                 | Three PDF manuals, three dialog layouts, about 54 screenshots                    | Rich                                                      |
| Sylvaccess 3.6           | PyQt desktop app writing rasters                                  | Notice PDFs, screenshots                                                         | Good on inputs and outputs; thin on harvest-system choice |
| Topografia (GeoRoad)     | QGIS plugin with floating dialogs                                 | 21 of its own dialog layouts (13 more belong to a charting library), code wiring | Good; its HTML help is an empty stub                      |
| forestroaddesigner       | QGIS dock and map tool, after PEGGER                              | 45-page manual (quick guide in Annex V), two dialog layouts                      | Rich                                                      |
| SylvaRoad (QGIS port)    | QGIS dialog                                                       | Dialog layout, Word notes, images                                                | Thin: the port never produced a result                    |
| ForestRoadNetwork plugin | QGIS Processing forms                                             | README, images                                                                   | Thin: standard forms                                      |
| 3D-CHA                   | Research scripts                                                  | README and figures                                                               | No interface                                              |
| Lima VVA                 | Windows desktop app: document with plan, profile, section windows | Full English help                                                                | Rich                                                      |
| RFLTools                 | AutoCAD / Civil 3D commands                                       | Lesson PDFs, setup and QSection PDFs, command list, dialogs, demo GIFs           | Good; lessons 3 and 4 are one repeated page               |
| QuickTurn                | AutoCAD commands                                                  | README, command prompts, two GIFs                                                | Thin                                                      |
| ALSroads                 | R functions                                                       | README, function docs, public user guide                                         | Good on running; thin on spotting failures                |
| roads (LandSciTech)      | R functions                                                       | Three vignettes                                                                  | Good                                                      |
| LANDIS-II Forest Roads   | Text parameter file, output rasters, cost log                     | User guide                                                                       | Little interaction                                        |
| SmartLog-ACO             | Command-line script with plots                                    | README                                                                           | Little interaction                                        |

## What the tools do well, in short

- **SEILAPLAN treats the optimizer's answer as a starting point.**
  - **Editing:** the user moves a support's station, height and lean, adds or deletes supports,
    switches end anchors, or places every support by hand. The line is re-checked about 300 ms after
    each change.
  - **Comparing:** a table puts the optimized and current values side by side, and clicking a limit
    row marks where on the profile it applies.
  - **Organising:** parameter sets and supports are named, and a plan sketch shows support types.
  - **Reporting:** a short report, and a technical report with stake-out coordinates per support.
- **Sylvaccess takes landings as input.** Each is marked yarder above, below or either, and existing
  or proposed. Every forest cell records the landing it leaves by, so catchments can be mapped. Lines
  are chosen by weighted criteria, including volume per metre of line, and two runs can be compared.
- **forestroaddesigner pegs a grade line with the mouse.** The cursor holds a set grade and step, and
  the leg is coloured up, down or over the limit. A click commits the leg, right-click or Backspace
  undoes, and Ctrl-click forces a straight leg regardless of grade. A failed search shows on the map
  where it stopped, and the manual teaches trying a slightly steeper grade until it connects.
- **Topografia edits the profile by grade.** The user types a tangent's grade and chooses which end
  holds. While a PVI is dragged, the grades in and out are shown with the deepest cut and fill on
  each tangent, and tangents over the limit turn red. Its floating, unlinked windows are a pattern to
  avoid; PGMaps' linked views are better.
- **Lima VVA is a document with linked windows.**
  - **Profile bands:** numeric bands under the profile show ground and design elevation, cut and fill
    depth, grade, a curvature diagram and crossfall, on screen and on printed sheets.
  - **Profile grips:** they can hold one grade, move a whole grade segment, change a curve length,
    and snap to round grades.
  - **Navigation:** keys jump to the next PVI, curve point or flagged station.
  - **Sections:** the cross-section keeps its scale while stepping.
  - **History and reports:** undo history is named, and the report's sections can be chosen.
- **RFLTools:**
  - **Point query:** any point can be queried for station, offset, ground and design levels.
  - **Profile labels:** in BC style, marking the start and end of vertical curves, crest high points
    and sag low points, with K and length.
  - **Junctions:** other roads meeting this one are marked on its profile.
  - **Sight distance:** checked with conflicting sightlines drawn.
- **QuickTurn draws the vehicle at chosen positions.** ALSroads and roads are run from code; their
  guides teach reading the result tables and maps, not interacting.

## What PGMaps already matches or does better

- Plan, profile and section views linked by one station scrubber.
- PVI drag and double-click to add, and an editable PVI table.
- Chord grade shown live while pegging, and a form-based grade peg (bearing, distance, target grade).
- Failure messages that name the limit and the place.
- Templates by station range, and report chapters with station ranges and export previews.
- A plot book with an issue stamp.
- Since #104:
  - finding every mapped road in an area;
  - the truck at a chosen station, with pins;
  - sight distance as a Review row;
  - cable coverage and an intermediate-support optimizer.

## Ranked backlog

Ranked by value to a BC layout forester or road engineer per unit of effort, and by how well each
fits the sidebar, plan and chart layout. Effort: S under 2 days, M 2–5 days, L over a week. The last
column names where the idea comes from.

### Tier 1

| #   | Proposal                                                                                                                                                                                                                                                                                                                                    | Where                                   | Effort | From                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------ | ---------------------------- |
| 1   | **Grade-held pegging on the map.** The cursor sets direction at a set step and grade; the leg is coloured up, down or over the limit; click commits; Enter or double-click finishes; Escape cancels; right-click or Backspace removes the last point; Alt-click overrides. The solver (`findGradePeg`) exists; only a form drives it today. | Plan, Design → pegging                  | M      | forestroaddesigner, RFLTools |
| 2   | **Profile shows grade trouble.** Tangents over the limit turn red. While a PVI is dragged, show grade in and out and the deepest cut and fill on each adjacent tangent.                                                                                                                                                                     | Profile chart                           | S      | Topografia                   |
| 3   | **Profile labels.** Start and end of each vertical curve, crest high and sag low points with K and length, and a flag on sags with no culvert.                                                                                                                                                                                              | Profile chart, plot book                | S–M    | RFLTools (BC labelling)      |
| 4   | **Edit grades directly.** Type a tangent's grade in the PVI table or a popover, choosing which end holds. Shift-drag holds one grade, a whole segment can be dragged, grades snap to round values, and Delete removes a selected PVI.                                                                                                       | Profile chart, PVI table                | M      | Topografia, Lima, RFLTools   |
| 5   | **Adjust a cable layout.** Make the found layout editable, or start with none; re-check through the existing worker after each edit; show Found and Current columns; click a limit row to mark it on the chart and plan.                                                                                                                    | Review → D-line → Intermediate supports | M      | SEILAPLAN                    |
| 6   | **Show where a failed search stopped,** linked to its failure row, and **try steeper grades** (+2 %, +4 %) so a failure can read "connects at X %".                                                                                                                                                                                         | Plan, Find the best route               | S–M    | forestroaddesigner           |
| 7   | **Point query.** Click any point on the plan for station, offset, ground and design level and depth; type a station and offset to locate one.                                                                                                                                                                                               | Plan, header station box                | S–M    | RFLTools                     |
| 8   | **Cable supports on the plan and in exports, with a stake-out table,** and a suggested cable line that opens as a profile and becomes a D-line.                                                                                                                                                                                             | Plan, D-line exports, Extraction reach  | S–M    | SEILAPLAN, Sylvaccess        |

### Tier 2

| #   | Proposal                                                                                                                                                                | Where                       | Effort | From                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ | ------------------------------ |
| 9   | Numeric bands under the profile on screen and on sheets: ground and design elevation, cut and fill depth, grade, curvature, crossfall                                   | Profile chart, plot book    | M      | Lima VVA                       |
| 10  | Drag supports on the D-line chart, double-click to add one, drag to draw a no-support sector                                                                            | D-line chart                | M      | SEILAPLAN                      |
| 11  | Jump to the next PVI, curve point, flagged station, culvert or template change, by menu and keys; keep the section's scale while stepping and pin one outline behind it | Header, section chart       | S      | Lima VVA                       |
| 12  | Landings as input (yarder above or below, existing or proposed), with the catchment, area and mean distance of each                                                     | Extraction reach            | M      | Sylvaccess                     |
| 13  | A printable D-line sheet: profile, plan strip, support and stake-out tables, limits, assumptions; named rigging sets shared with Extraction reach                       | Review → D-line, Files      | M      | SEILAPLAN                      |
| 14  | Markers on the profile where another road meets this one, with **Add control here** at that road's level                                                                | Profile chart               | M      | RFLTools                       |
| 15  | Keep a found road's search settings on it and print them in the report; search presets for spur, block road and mainline, with sourced or "confirm" values              | Find the best route, report | S      | SylvaRoad, forestroaddesigner  |
| 16  | Colour the plan by grade class, with a legend; **Follow station** so the plan pans to the selected station                                                              | Plan                        | S      | forestroaddesigner, Topografia |
| 17  | Reusable sheet setups across projects, and 11×17 and ANSI D paper                                                                                                       | Plot book                   | S      | Lima VVA, RFLTools             |
| 18  | **Use this section for…** from the section pane, over a range dragged on the profile, listing stations where the batter never met the ground                            | Section chart, templates    | M      | Topografia                     |

### Tier 3

- Named undo history and checkpoints (Lima VVA).
- Harvest-system map by parcel (Sylvaccess, thin evidence).
- Volume-aware cable line selection from VRI or an imported raster (Sylvaccess).
- A field-measured ground profile for a D-line (SEILAPLAN).
- Support names and categories with plan symbols (SEILAPLAN).
- Comparing a run with a pinned earlier run (Sylvaccess).
- A draggable balance line on the mass-haul chart as a what-if (Topografia).
- Choosing which sections the report includes, and clicking an export preview to edit that part (Lima VVA).
- Conflicting sightlines drawn on the plan, and a turnout intervisibility check (RFLTools).

## Not worth taking

- Topografia's floating, unlinked windows.
- LANDIS-II's text parameter file, which is for batch simulation.
- SmartLog-ACO's script-and-plot loop.
- The SylvaRoad port's dialog, which reads settings from the wrong boxes.
- Pestal's support-tree size table, which stays out under the
  [cable supports](cable-supports.md) rule.
