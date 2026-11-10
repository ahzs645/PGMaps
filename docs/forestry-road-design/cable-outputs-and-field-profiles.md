# D-line outputs, rigging sets and field profiles

A D-line's intermediate supports (see [Intermediate supports](cable-supports.md)) reach the plan, the
D-line files and a printable sheet; a suggested skyline from Extraction reach can be opened as a
profile and kept as a D-line; rope, carriage and load are saved once as named rigging sets; and a
D-line can read field-measured ground in place of the terrain. The calculation modules are in
`src/pages/dev-forestry-roads/dline/`: `frame.ts` (stations from the yarder), `supports.ts` (the
support list, stake-out and plan dots), `outputs.ts` (the CSV and report additions),
`riggingSets.ts`, `coverageAdopt.ts`, `fieldProfile.ts` and `sheet.ts` (the sheet's drawing). They
have no DOM or network access; `sheetExport.ts` gathers the inputs, checks a saved layout in the
cable-layout worker when no result is current, and renders the sheet with jsPDF.

**Where it is.**

- **Plan:** every D-line with a saved layout or an open edit shows its intermediate supports as
  violet dots; hover for the D-line, support number (and name), station from the yarder, height and
  which layout it is; click to open that D-line's profile with the cursor on the support.
- **D-line detail pane** (Profile → D-line): **D-line CSV** and **D-line report** carry the supports;
  **Stake-out CSV** appears once the line has a saved layout or an open edit.
- **Files → Save & export → Documents → D-line sheet:** the D-line on screen as a one-page PDF, with
  a preview and the **Issue stamp** tab.
- **Review → D-line / cable geometry** → a D-line on _Rope and load_: **Rigging set** under the
  rigging, and **Field-measured ground** under the intermediate supports (on every D-line).
- **Design → Extraction reach → Cable yarder:** after a run, click a line's number in **Suggested
  lines** to open it as a profile, then **Use as D-line**. **Rigging set** sits under _Rope and load_.

## Before you rely on it

- **Every output shows the layout the chart shows.** While a layout edit is open (**Adjust layout**
  or **Place supports by hand**), the plan dots and their click target, the D-line CSV and report,
  the Stake-out CSV and the D-line sheet all use the edited layout, as the D-line chart and the
  limits table do; otherwise they use the found layout. One rule picks it for all of them
  (`shownLayoutResult` in `cableLayout/useCableLayout.ts` and `dLineSupports` in `dline/supports.ts`,
  which ignores a result that is not of the open edit), and each says which: `support_layout` =
  `found` or `edited` in the D-line CSV, `layout` in the stake-out, the report's supports paragraph,
  the sheet's summary line ("Edited layout · …") and the plan dot's hover title. Until the edit's
  re-check finishes, its stations and heights are given without forces (`support_layout_source`
  reads `saved`). The edit's support names and categories reach the stake-out (`support_name`,
  `support_category`), the report and the sheet. **Discard edits** returns every output to the
  found layout.
- **Stations run from the yarder, horizontally, along the D-line.** Every support stands on the line
  (offset 0). The stake-out's ground is the D-line's own ground (the field profile where one is used),
  not a survey of the stake: check each site before it is rigged.
- **A saved layout is not a checked one.** Until **Find supports** or **Check saved layout** runs on
  the D-line as it is now, the plan, CSV, report and stake-out show the saved stations and heights
  only, say so (`support_layout_source = saved`), and give no forces or angles. The D-line sheet
  checks the saved layout itself before it prints.
- **A suggested line is the coverage screen's answer on its grid.** Opening it checks its supports
  as one layout at the screen's pre-tension on 1 m ground; that can still fail where the screen
  passed (a narrow knoll, see [Extraction reach](extraction-reach.md)). A kept D-line starts from
  those supports; refine them there.
- **Rigging sets are your entries.** A set is a name for a rope, carriage, load and clearance (and,
  saved from a D-line with support settings, its saddle-angle limits). Nothing checks it against a
  machine rating, and the sheet prints its name only where the D-line's rigging is exactly the set's.
- **Field shots replace the terrain only where they are.** Between two shots the ground is a
  straight line; before the first and after the last shot, and more than 2 m off the line, the
  terrain is read as before, and the section says which stations the shots cover. Shots are
  horizontal stations from the yarder; slope legs are reduced from the start you give.

## What each output carries

| Output               | Added                                                                                                                                                                                                                                                                                                                                                              | Only when                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| D-line CSV           | After every existing column (and the rope-mechanics columns): `rigging_set`; `support_layout` (found or edited), `support_layout_source`, `_status`, `_pre_tension_kn`, `intermediate_supports`, `supports_station_height_m`; the layout's load path, empty skyline and load clearance per sample; `ground_source`, `terrain_elevation_m`, `field_minus_terrain_m` | the line uses a set / has a layout / a current result / field shots in use |
| D-line report (HTML) | After the sample schedule: rigging set, intermediate supports (forces and angles from a current result), support stake-out, field-measured ground with each shot's difference to the terrain                                                                                                                                                                       | as above                                                                   |
| Stake-out CSV        | One row per support and anchor: point, label, station, offset 0, easting, northing, EPSG, longitude, latitude, ground, support height, saddle elevation, layout source, layout (found or edited), support name, support category                                                                                                                                   | the line has a saved layout or an open edit                                |
| D-line sheet         | Header and issue stamp; profile from the yarder (field ground and the terrain dashed); plan strip with contours, north arrow and scale bar; supports and stake-out; forces and angles; limits in three states; rigging; assumptions                                                                                                                                | the D-line's own inputs are valid                                          |

A D-line without supports, a rigging set or field shots exports exactly as before (a unit test pins
it). The sheet's rule in `INVALID_INPUT_RULES` is `unaffected`: no road input reaches a D-line. The
D-line's own invalid rigging, support settings or field profile refuse it (`dLineSheetUnavailable`),
as they disable **Supports CSV**.

## Limits and budgets

| Limit                    | Value                                                                   | Enforced in                                                                       | When exceeded                                  |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Rigging sets per project | 50                                                                      | `dline/riggingSets.ts` `MAX_RIGGING_SETS`, `parseRiggingSets`                     | Save refused; project file refused             |
| Rigging set name         | 1–80 characters, unique ignoring case and spacing                       | `dline/riggingSets.ts` `MAX_RIGGING_SET_NAME`, `riggingSetNameError`              | Rename refused; saving under a name updates it |
| Set values               | the rigging's own ranges; limits within `SUPPORT_LAYOUT_LIMITS`         | `cableMechanics.ts` `parseRigging`; `riggingSets.ts` `parseRiggingSets`           | Project file refused                           |
| Field shots per D-line   | 500 (slope legs 499)                                                    | `dline/fieldProfile.ts` `MAX_FIELD_SHOTS`                                         | Apply refused; project file refused            |
| Field station, elevation | −200 to 3,200 m from the yarder; −500 to 9,000 m                        | `FIELD_STATION_RANGE_M`, `FIELD_ELEVATION_RANGE_M`                                | Apply refused with the reason                  |
| Slope leg                | 0.1–1,000 m along the slope, −300 to 300 %                              | `FIELD_SLOPE_DISTANCE_RANGE_M`, `FIELD_SLOPE_PERCENT_RANGE`                       | Apply refused                                  |
| Field corridor           | 2 m either side of the line                                             | `FIELD_PROFILE_CORRIDOR_M`                                                        | Terrain read                                   |
| Field ends               | a station 5 cm outside the first or last shot reads that shot           | `FIELD_END_TOLERANCE_M`                                                           | Terrain read                                   |
| Field difference flag    | 2 m                                                                     | `FIELD_DIFFERENCE_FLAG_M`                                                         | Row marked, counted in the summary             |
| Field note, import file  | 500 characters; 1 MB                                                    | `MAX_FIELD_NOTE`; `CableFieldProfileSection.tsx`                                  | Cut; import refused                            |
| Sheet plan strip         | 1:500 to 1:50,000, the first that fits; 160 samples across for contours | `dline/sheet.ts` `PLAN_STRIP_SCALES`, `PLAN_STRIP_SAMPLES`                        | Largest scale used                             |
| Sheet contours           | 1, 2, 5, 10, 20, 25, 50 or 100 m, the first with ≤ 30 levels; index × 5 | `PLAN_CONTOUR_INTERVALS`, `MAX_PLAN_CONTOUR_LEVELS`; `contours.ts` segment budget | Interval widened and printed                   |
| Sheet tables             | as many rows as fit the column                                          | `dline/sheet.ts` `table`                                                          | "+N more rows: see the D-line report or CSV"   |

## Built-in assumptions

- **Plan positions** follow the great circle from the yarder, as the support search samples ground
  (`dLineFrame.at`, `layoutRun`). Grid coordinates use the terrain's EPSG, else the local UTM zone,
  as the road stakeout does (`exportGrid`).
- **Labels:** Y yarder, S start support, 1… intermediate supports from the yarder, E end support or
  end ground anchor, A anchor. The plan and the D-line chart use the same numbers.
- **A suggested line as a D-line:** its ends are the screen's yarder and tail; its stations are
  scaled from the coverage grid to the D-line's great-circle length so the tail lands on the far
  end; tower and tail heights come from the line; the support settings take the yarder's system,
  loaded break limit, support spacing and anchor distance, the screen's 10 m clearance zones, and a
  height range wide enough to hold the screen's supports.
- **Rigging set on the yarder:** coverage always tensions each line to its allowable working
  tension, so applying a set sets `tensionMode` to `allowable`; a set otherwise identical except for
  its tension mode still shows as in use there.
- **Applying a set to the yarder is not a project edit.** The yarder's settings belong to the
  Extraction reach panel, not the project file, so the header **Undo** does not reverse it (it would
  undo the previous project edit instead). **Restore previous rigging**, shown under the picker after
  a set is applied, puts back the rope, load and break limit it replaced, until one of them is
  changed (`undoRiggingSet`). Saving, renaming and deleting a set are project edits and Undo covers
  them.
- **Slope legs:** horizontal run = slope distance ÷ √(1 + g²), rise = run × g, with g the slope
  as a fraction, chained from the start station and elevation (or the terrain there, on request).

## Failure modes

- **The plan shows supports in the wrong place after the line moved.** The saved layout is stations
  from the yarder; moving an end moves them along. Run **Check saved layout** or **Find supports**.
- **The sheet's preview says the D-line's rigging or settings must be corrected.** Fix the field
  named in Review; the sheet refuses rather than print a layout it cannot check.
- **A suggested line shows "The suggested supports do not fit the line."** The screen's stations no
  longer fit the D-line (for instance the far end is on unknown ground at 1 m). Use it as a D-line
  and run **Find supports**.
- **Field shots and terrain differ by a constant.** The shots' datum is not the terrain's: a
  station-and-elevation file of relative heights needs its first elevation set to the yarder's
  ground, or enter slope legs and take the start from the terrain.
- **The ground drops at the end of the profile.** The shots stop short of the far end; extend them
  or accept the terrain beyond.

## Provenance

The interaction follows the reviewers' description of SEILAPLAN's adjustment window, stake-out
table, parameter sets and field-profile import, and of Sylvaccess's selected-lines map (see
[How the reference tools handle interaction](reference-interfaces-review-2026-11-10.md), items 8 and
13 and tier 3). Nothing was taken from their code; the sheet, stake-out and reductions are PGMaps'
own.
