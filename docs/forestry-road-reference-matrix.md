# Forestry road reference matrix

## Audit scope and evidence

This is a functional audit of the road workspace at commit `455a5b3`, before the
second implementation pass on 2026-10-21. It records the baseline gaps; a row is
not an assertion that the subsequent implementation is already complete. Update
the verification ledger at the end as work is implemented and exercised.
For the subsequent implementation, read **Second-pass code review** and the
verification ledger below; the image-by-image baseline is retained as an audit
trail and is not a list of features still missing.
The [current workspace gallery](forestry-road-gallery.md) shows captures using
the actual native terrain and identifies demonstration engineering assumptions separately.

All **15 newly supplied `(2)` screenshots** were opened at full size. The earlier
uploads, webinar transcript, and two presentation PDFs were also considered. The
245-page **RoadEng Resource Road v11 tutorial**, document version 20 February
2025, supplies behavior where a static screenshot only exposes a button. Its PDF
page numbers equal its printed page numbers for the pages cited here. Pages 121
and 144 were additionally rendered and inspected. Installer archives were not
executed. No third-party screenshot, manual page, proprietary template, or
installer is copied into this repository.

The screenshot filenames below all begin `Screenshot 2026-10-20 at ` and end
` PM(2).png`; the uploaded filenames use a narrow nonbreaking space before PM.
The times are stable source identifiers, not timestamps of our application.

| ID  | Screenshot time | Pixels      | Main visible workspace                                                      |
| --- | --------------- | ----------- | --------------------------------------------------------------------------- |
| S01 | 9.41.19         | 2048 × 1104 | RoadEng Section / Profile / Plan, material bands, culvert, mass haul, costs |
| S02 | 9.41.32         | 1926 × 1412 | GIS slope-profile report over layered terrain map                           |
| S03 | 9.41.43         | 2048 × 1029 | Forsite D-line editor and profile, terrain/context layer tree               |
| S04 | 9.42.01         | 1736 × 998  | Individual Tree Analysis summary tabs and species table                     |
| S05 | 9.45.23         | 1505 × 1058 | Radial landing/deflection explorer, selected-ray profile                    |
| S06 | 9.46.12         | 1906 × 1011 | Template Editor, Resource Low Volume preview                                |
| S07 | 9.46.24         | 1904 × 1058 | Template Editor, roadway in a cut condition                                 |
| S08 | 9.46.38         | 1904 × 1065 | Landing template selected in reusable template tree                         |
| S09 | 9.46.45         | 1883 × 1068 | Landing template preview and assigned-template indicator                    |
| S10 | 9.47.00         | 1905 × 1019 | Add/Edit IP tool, Section / Data / Plan, alignment hierarchy                |
| S11 | 9.47.23         | 1892 × 1004 | Moving horizontal endpoint with section and grade feedback                  |
| S12 | 9.47.53         | 1909 × 1064 | Road offset lines in plan and matching section at 670.299 m                 |
| S13 | 9.48.06         | 1901 × 1059 | Profile with mass-haul subview, Section / Data / alignment panel            |
| S14 | 9.48.17         | 1875 × 1021 | Saved pegging layout, station / grade / horizontal-distance table           |
| S15 | 9.48.24         | 1876 × 1000 | Pegging at a moved endpoint, 9.0% feedback, synchronized cursors            |

The 15 screenshots contain **no true 3D road viewport**. The newly supplied manual
does: pp. 131 and 143–147 show road widening and culverts in linked 3D views.
These are separate sources and should be credited accurately in comparisons.

### Status vocabulary

- **Present:** a corresponding operation is implemented in the baseline code.
- **Partial:** a useful subset exists, but the observed workflow cannot be completed.
- **Missing:** no corresponding persistent model/control/calculation exists.
- **Data-dependent:** the operation needs measurements or records beyond a ground DEM.
- **Unspecified:** a visible button does not reveal its full behavior; do not invent
  undocumented algorithms or claim file-format compatibility.

“Acceptance” below describes an implementable PGMaps behavior, not a claim of
complete compatibility with the referenced commercial applications.

## Baseline code inventory

| Code area                                | Present baseline                                                                                                                                                      | Material gaps                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DevForestryRoads.tsx`                   | Shared displayed alignment/analysis, selected station, road/profile drawing, station playback, alternatives table, file workflows                                     | Hover pegging only updates the numeric banner, not the analysis of the moving endpoint; fixed panel arrangement; fixed station columns; no persistent view presets |
| `dev-forestry-roads/useRoadWorkspace.ts` | All roads analyzed with the same terrain source, settings and context; undo/redo; validated autosave and source restore                                               | New model fields must join the analysis dependencies and undo/save/restore path; visual state is currently component-local                                         |
| `dev-forestry-roads/DesignSidebar.tsx`   | Horizontal/PVI editing, a single cross-section, width tapers, criteria, basic unit rates, crossing list, cable support heights/sag                                    | No reusable full-template library, side-specific template assignments, material layers, stripping, structures, pits or haul planning                               |
| `dev-forestry-roads/types.ts`            | One `RoadTemplate` per road; width-only overrides; simple crossings; basic costs; simple `CableLine`                                                                  | No persistent material/structure/template-library/haul data model; no cable offsets or radial run model                                                            |
| `dev-forestry-roads/Charts.tsx`          | Ground/design profile, editable PVIs, cut/fill section, cumulative mass balance, geometric cable plot                                                                 | No engineering bands, material horizons, section point-code readout, view zoom controls, or interactive cable cursor                                               |
| `dev-forestry-roads/PlanView.tsx`        | Real-source hillshade/slope/elevation/contours, active route and alternatives, computed daylight footprint, station transect, point dragging, stream crossing markers | No template/ditch code lines, structure geometry, cable selection/cursor, radial overlay, layer tree, or live moving-peg tangent label                             |
| `dev-forestry-roads/TerrainPreview.tsx`  | Same-source sampled terrain, road formation ribbon, selected section, orbit/follow modes                                                                              | No material layers, ditch/batter/structure surfaces; a display mesh is not a full engineering terrain model                                                        |
| `dev-forestry-roads/engine.ts`           | Curved horizontal stationing, independent vertical design, sampled sections, cut/fill integration, crossings, bounded cable sampling                                  | No material allocation, stripping, full template-range resolution, structure geometry, pit events, or haul solution                                                |
| `dev-forestry-roads/project.ts`          | Validated JSON, geometry import/export, station CSV, printable report                                                                                                 | Every new engineering input/output needs validation, round-trip persistence, provenance and an export representation                                               |

## Prioritized implementation batches

| Batch                             | Priority       | Required functional result                                                                                                                                                          | Principal evidence                                     |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| B1 Connected workbench            | First          | Moving-peg preview across plan/profile/section/data; interactive station and code inspection; engineering bands; meaningful layouts and interval table                              | S01, S10–S15; manual pp. 78–80, 89–94, 133–142         |
| B2 Templates                      | First          | Named reusable templates, independent sides, preview without commit, assignment by station range, import/export library, complete parameter override semantics                      | S06–S09; manual pp. 116–132                            |
| B3 Materials and site preparation | First          | Explicit user-supplied material library and horizons, per-material cut quantities/costs, fill eligibility, stripping and clearing offsets                                           | S01; manual pp. 105–115                                |
| B4 Structures                     | First          | Editable culvert/cross-drain inventory and geometry linked to all views; optional ditch override; report/export with assumption status                                              | S01; manual pp. 143–147                                |
| B5 Earthwork movement and cost    | First          | Component cost ledger, borrow/waste events, documented haul allocation or explicitly manual movements, distance categories, material balance and incomplete-data handling           | S01, S10–S13; manual pp. 89–98, 106–107                |
| B6 Landing and cable exploration  | Next, parallel | D-line direction/offsets, selected cable and span cursor linked to plan; bounded radial explorer; adopt a selected spoke as an actual saved D-line                                  | S03, S05; 2026 presentation p. 46; webinar             |
| B7 Terrain/inventory handoff      | Next           | Ground-only profile summaries/export, source-specific layer controls, honest links to measured LiDAR forestry/canopy/inventory workspaces; import measured inventory when supported | S02–S04; 2019 presentation pp. 56–59; manual pp. 18–46 |
| B8 Reporting and review           | Across batches | Every input survives save/reopen/undo; quantities and point codes export; printable linked plots; per-feature revision/partial status                                               | S01–S15; manual pp. 133–175                            |

## Common regions appearing in multiple screenshots

These rows account for repeated toolbar and window regions. Individual-image
rows below identify the additional behavior rather than repeating identical
toolbar entries 10 times.

| Region / images                                      | Observed behavior                                                                                  | Baseline / gap                                               | Implementable acceptance                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zoom ribbon; S06–S15                                 | Zoom in/out, extents, window zoom, pan, numeric scale, scale lock                                  | Partial: map zoom/fit and fullscreen; charts always auto-fit | Provide chart fit/reset, horizontal range and vertical exaggeration controls. Map pan must not alter station or engineering results. Extent changes affect presentation only.                                                                                            |
| Window ribbon; S06–S15                               | Cascade/tile, switch/new window, add to panel                                                      | Partial: fixed plan/profile plus one detail tab              | Provide task presets such as design, pegging and quantities with resizable panels. Keep all panes on one selected road/station; no duplicate independent project state. Browser layout need not mimic desktop window management.                                         |
| Screen Layout; S06–S15                               | Named `normal.dlt` / `pegging.dlt`, Save/Retrieve/Delete, Display Status                           | Missing saved layout state                                   | Save/restore a bounded PGMaps layout preset, visible panes, dimensions and chart ranges independently of engineering inputs. State must not claim `.dlt` compatibility.                                                                                                  |
| Bottom navigation; S01, S05–S15                      | Jump station, alternate windows, zoom/pan controls                                                 | Partial: station input, arrows, playback and detail tabs     | Exact station entry should select the corresponding analytical section or an explicitly interpolated inspection; previous/next should visit meaningful report/design-event stations. Keyboard and mouse produce the same selection.                                      |
| Alignment panel; S06–S13                             | Current horizontal alignment, nested vertical alignment, add/copy/delete, compare with current     | Partial: separate named roads and comparison totals          | Preserve existing alternatives. Add a clear comparison selection and overlay of another design, with identical source/rates and partial coverage disclosed. Multiple vertical alternatives under one horizontal line are a separate feature, not implied by duplication. |
| Cost/status region; S01, S06–S13                     | Processed/unprocessed status, cut/fill/haul/pit costs, free/over/end haul volumes, processing time | Partial: one covered estimate and basic rates                | Show a reconcilable component ledger and calculation status. Editing a dependency recomputes or marks results stale; no old totals under new geometry. Distinguish absent input from zero cost.                                                                          |
| Project/save/export controls; S01, S03, S04, S06–S15 | External files, save/export, separate reusable tables                                              | Partial: project JSON/GeoJSON/CSV/HTML only                  | Retain formats already supported; add versioned library/profile/structure exports where implemented. Do not label a JSON download as a proprietary RoadEng table.                                                                                                        |

## Image-by-image region matrix

### S01 — 9.41.19: full engineering workspace

| Region / visible control                             | Observed behavior                                                                                     | Baseline / gap                                                                  | Acceptance                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top Home ribbon                                      | Read terrain/traverse, external files, Insert File, Recalculate Range, Assign by Range                | Partial: raster/geometry import and automatic whole-road recalculation          | Import supported source types with provenance. A station-range assignment must be a persisted engineering input and recalculate the affected geometry/quantities; do not provide an inert assignment button.                 |
| Templates / Ground Types / Reference Surfaces        | Separate reusable section, material and surface definitions                                           | Missing libraries/material model; only one raster source                        | B2/B3. Additional reference surfaces require explicit source/datum and use rules; never substitute canopy for bare earth.                                                                                                    |
| Measurement: AZ / HD, measure mode, polar/delta mode | Bearings/distances and offset measurement                                                             | Partial: pointer-leg length and endpoint grade, no bearing/measurement workflow | Show bearing, horizontal distance and elevation difference for a selected/previewed leg; permit a two-point measure that leaves alignment unchanged. Constraint-based point entry requires explicit bearing/length controls. |
| Section graphic                                      | Ground/template, cut/fill, station 1314.4, centerline cursor                                          | Present basic section; no material/code surfaces                                | Same station must remain selected when switching views. B2/B3 section surfaces should use actual resolved template/material data, with missing ground shown as a gap.                                                        |
| Section status table                                 | Station, horizontal/vertical offsets, side slopes, left/right clearance, cut depth                    | Partial: area and daylight readout only                                         | Inspect section at a cursor offset; report ground/design elevation, cut/fill depth, side, template code and units. Separate centerline cut depth from cursor depth and left/right daylight distance.                         |
| Profile geometry                                     | Existing ground, independent grade, vertical-curve labels and selected station                        | Present curves/PVIs, sparse annotations                                         | Show station/elevation/grade, curve start/end/length and grade-break information from the actual vertical model; selecting a PVI or curve moves common station.                                                              |
| Culvert annotation                                   | Named cross-drain and diameter attached to profile location                                           | Missing structure record; crossing flag only                                    | B4: a culvert is a saved engineering object with explicit dimensions/inverts/skew and type. Its plan/profile/section/3D position must derive from the same object. Diameter is an input, not inferred capacity.              |
| Mass-haul / Borrow-Waste subviews                    | Shared station axis, cumulative material balance, movement annotation                                 | Partial: cumulative balance in separate tab                                     | B5: maintain common x-axis and station cursor; display pit events and supported movement categories. No continuity across unknown terrain.                                                                                   |
| Bands beneath profile                                | Average left/right side slopes, template codes and two ground layers (`Overburden`, `Till - Compact`) | Missing                                                                         | Draw actual station-range bands with names and boundaries; click a band opens/selects that assignment and station. No decorative strata that do not affect calculations.                                                     |
| Plan                                                 | Contours, centerline, offsets, station/curve/structure labels, polygons                               | Partial: contour raster/lines, daylight footprint, context, selected transect   | Show resolved roadway edges, ditch/daylight code lines and structure geometry where calculated; use the same station coordinates as sections. Unknown footprints must remain unfilled.                                       |

### S02 — 9.41.32: terrain slope profile

| Region / visible control     | Observed behavior                                                                                    | Baseline / gap                                       | Acceptance                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Underlying GIS layer tree    | LiDAR contours, slope/aspect, DEM, hillshade, imagery, constraints                                   | Partial: one display selector and contour toggle     | Add layer visibility/legend controls for supported layers. Slope degrees and slope percent must be explicitly distinguished. Aspect can be derived from the same DEM; context remains separate. |
| Profile summary header       | Length, elevation difference, report spacing, maximum/minimum grade/elevation, vertical exaggeration | Partial: length/elevation range/max grade cards      | Add start/end elevation difference, ascent/descent, grade range, sample spacing and coverage. Report undefined values when endpoints or intervals lack data.                                    |
| Profile graphic              | Ground elevation versus distance with segment percent labels and span/reference line                 | Present ground-only profile, no interval annotations | Keep ground transects separate from road design. Permit a readable reporting interval and toggled segment labels; hover/selection must mark the same map location.                              |
| Analyze / Tools / View, zoom | Report inspection and presentation controls; unopened menu details unspecified                       | Missing chart zoom/report export                     | Provide supported fit/zoom/exaggeration and image/CSV export with source/datum/coverage. Do not infer unnamed menu commands.                                                                    |

### S03 — 9.41.43: D-line editor

| Region / visible control   | Observed behavior                                                                                                        | Baseline / gap                                                  | Acceptance                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forsite ribbon             | ITI, HEX, Deflection Line, Slope Profile, Road Peg, settings, clear graphics                                             | Road/profile/cable entry points present; other modules separate | Route each supported action to its real workflow. Clear temporary graphics must not delete saved roads/context. ITI/HEX are not ground-DEM road calculations.                                                                                   |
| Layer contents             | AOI, streams, contours, D-lines, road, tree points/crowns/species, slope classes, CHM, VRI, flow accumulation, hillshade | Partial terrain/context                                         | Toggles must target real loaded features. State which are measured, modeled, derived, or unavailable; no invented inventory layers.                                                                                                             |
| Feature and DEM selectors  | Choose an existing D-line and elevation raster                                                                           | Partial: saved cable dropdown; shared terrain source            | Selecting cable in list or map selects the same cable profile. Terrain selection changes map, cable profile and analyses together.                                                                                                              |
| Draw / Select / Run D-line | Create, select and evaluate a line                                                                                       | Partial: draw and auto-analyze; map cannot select cable         | Named map-selectable D-lines, edit endpoints, explicit selected state and same-source sampled profile. Automatic recomputation is an acceptable replacement for Run.                                                                            |
| Yarder settings            | Start/end orientation, offset, height                                                                                    | Missing orientation and offset                                  | Record endpoint orientation and horizontal offsets along the chosen line. Derived support coordinates and profile must agree; reversing a line should preserve intended physical supports.                                                      |
| Tailhold / D-line settings | Tailhold offset and height, block ID, name, deflection percentage, Reset                                                 | Partial: heights/sag only; no name editor/offset/block          | Editable name/association and validated offsets/heights/sag, reset to documented defaults without deleting geometry. Offsets must have a visible meaning, not be ignored.                                                                       |
| D-line profile             | Ground, chord, assumed cable, support labels, span/elevation change/deflection and cable/chord lengths                   | Partial: cable and terrain, minimum clearance only              | Show support positions, chord and sag geometry; report sampled minimum clearance and completeness. Add span cursor linked to a marker on the selected map line. Cable length is the sampled geometric length, not a loaded cable specification. |
| Export to PNG / Save       | Standalone profile output and saved analysis                                                                             | Partial: project persistence; no profile image                  | Export the current profile with source, assumed sag/supports and completeness; save its inputs in the project.                                                                                                                                  |

### S04 — 9.42.01: individual tree analysis

| Region / visible control                                 | Observed behavior                                        | Baseline / gap                             | Acceptance                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header / species composition                             | A tree inventory summarized by species                   | Data-dependent, absent from road workspace | Use supplied measured/modelled tree records with declared species provenance. Bare-earth terrain cannot identify species.                                                                                   |
| Tree Summary (Total Trees / tph) tabs                    | Totals and per-hectare statistics                        | Data-dependent                             | Preserve explicit sampled area and inclusion rules; per-hectare denominator must be stated. Tree candidates are not automatically a verified stem inventory.                                                |
| Log Summary (Merch Volume / Total Logs), Mean Piece Size | Merchantable volumes, logs and mean piece size           | Data-dependent                             | Require log/merchantability inputs or a documented inventory model; show unavailable when absent. Do not derive these from tree height alone.                                                               |
| Overview rows                                            | Gross, merchantable and net volume; stems; area          | Data-dependent                             | Aggregate imported fields with unit checks and missing-value counts; reported net/merchantable volumes remain distinct.                                                                                     |
| Height and DBH class rows                                | Species-wise height/diameter classes and mean height     | Data-dependent                             | Class boundaries explicit; count each tree once for mutually exclusive bins. DBH must be measured/supplied, not inferred from a cropped upper-canopy point cloud.                                           |
| Highlighted mean DBH and BA                              | Mean diameter and basal area per hectare                 | Data-dependent                             | Compute only from valid supplied DBH/area; distinguish arithmetic mean from quadratic mean diameter and report the chosen statistic.                                                                        |
| Settings / Export / status                               | Editable analysis settings, export, tree count/area/date | Missing road-tool integration              | Link to real existing LiDAR forestry/tree/species workspaces; add inventory import only when its schema and provenance are supported. A link does not count as implementing the entire tree-analysis table. |

Existing relevant app routes are `/dev/lidar/forestry/`, `/dev/lidar/canopy/`,
the LiDAR tree/species panels, and `/dev/forestry/avast-volume`. The existing
`TreeInspector.tsx` explicitly reports DBH unavailable for a crop beginning above
breast height. `SpeciesPanel.tsx` distinguishes recorded inventory composition
from experimental estimates. Preserve those qualifications when linking them.

### S05 — 9.45.23: radial landing explorer

| Region / visible control               | Observed behavior                                                  | Baseline / gap                             | Acceptance                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logging systems / equipment library    | Select cable-system/equipment configuration                        | Missing; data-dependent for loads          | A geometric explorer may use support heights and sag directly. Do not imply an equipment load/tension solution without equipment/cable specifications and equations.                                            |
| New / Edit / Delete D-line             | Manage saved analysis lines                                        | Partial: draw/delete, no map endpoint edit | Support selection, name/edit and deletion of actual saved cable lines; saved data and map/profile must remain synchronized.                                                                                     |
| Setup/config/calc, length/% deflection | Selected `Simple third point deflection` method and numeric inputs | Partial: parabolic assumed sag             | Name the implemented geometric method and its assumptions. Do not silently claim equivalence to the commercial method from a screenshot.                                                                        |
| Enable / Accept exploration            | Preview a landing-centered fan and retain a result                 | Missing                                    | Bounded native-source radial run with center, radius, bearing sweep/step, support heights, sag and minimum-clearance threshold. Preview is temporary; adopting a spoke creates a saved D-line.                  |
| Plan fan                               | Rays from one landing, green/red segments, terminal outline        | Missing                                    | Each spoke exposes its sampled clearance/completeness; missing terrain is a separate unknown color. Clicking a ray selects its profile. Any boundary is a geometric preview, not a safe operating-area polygon. |
| Left selected-ray profile              | Ground, support/cable geometry, current-ray marker                 | Partial individual cable chart only        | The selected map ray and chart must refer to one ID and source; changing center/parameters invalidates obsolete ray results.                                                                                    |

### S06 — 9.46.12: template table and preview

| Region / visible control                    | Observed behavior                                                    | Baseline / gap                                  | Acceptance                                                                                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Table / Save Table / Merge / e-Library | Reusable library, replace versus merge, external component library   | Missing                                         | Versioned PGMaps template-library import/export; explicit merge/replace, unique IDs, collision handling and validation. A local documented preset library can replace a remote e-library; do not claim proprietary table compatibility.        |
| Materials / Road Class                      | Material library and design constraints                              | Partial criteria only                           | B3 material editor; named project criteria with grade/radius/superelevation/width inputs where implemented. Presets remain assumptions unless backed by the selected standard.                                                                 |
| Template tree                               | Resource Low Volume, Rural, Urban, Landing, Fixed Sections           | Missing reusable library                        | Create/rename/duplicate/delete named templates and distinguish selected versus assigned. Do not claim urban/rock-fill geometry unless its components are actually modeled. Fixed-section point input needs its own validated geometry support. |
| Add/delete/copy/paste/reorder               | Component/template management                                        | Missing                                         | Each displayed control must modify a persistent definition. Prevent deletion of referenced definitions or offer a concrete reassignment.                                                                                                       |
| Properties / Codes / Layers                 | Numeric component controls, named points and layered surfaces        | Partial numeric one-template fields             | Side-specific component fields and surface/code metadata feeding calculations and all views. Labels cannot substitute for modeled surfaces.                                                                                                    |
| Main section preview                        | Terrain/template interaction, hatch fill, centerline, station        | Partial: edits apply immediately to active road | Separate candidate preview from commit, preview actual selected station, and show effects on cut/fill. Applying a range updates the road, plan footprint, quantities and source-connected 3D.                                                  |
| Preview navigation / OK / Cancel            | Typical conditions, zoom, split view, station preview, commit/cancel | Missing sandbox                                 | Manual pp. 121–122 confirm slope-left/right, cut/fill and four-way previews. Cancel discards candidate edits; preview shifts must not move the actual alignment.                                                                               |

### S07 — 9.46.24: template in a cut condition

| Region / visible control                        | Observed behavior                                                                         | Baseline / gap                            | Acceptance                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resource Low Volume selected                    | Same reusable definition evaluated against a different relative ground/formation position | Missing separate preview                  | Demonstrate the same candidate in cut and fill, including ditch activation and daylight; preserve the main road until Apply.                                             |
| Left ditch / running surface / right daylight   | Asymmetric earthwork with roadway below ground                                            | Partial single V-ditch and shared batters | Independent left/right ditch, crossfall and batter settings; material-aware slopes only when material inputs exist. Verify cut/fill classification and no-data behavior. |
| Bottom condition icons                          | Left/right slope, cut/fill, split, station navigation                                     | Missing                                   | Use labeled accessible controls for the documented preview functions; no opaque inert icons.                                                                             |
| Properties / Codes / Layers and library toolbar | Same library controls as S06                                                              | Missing/partial as S06                    | S06 acceptance applies to this image too; exercising a preview condition must not lose library edits.                                                                    |

### S08 — 9.46.38: candidate landing template

| Region / visible control                | Observed behavior                                                                  | Baseline / gap                            | Acceptance                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing highlighted in tree             | A candidate template can be selected without assuming it has already been assigned | Missing selected/assigned distinction     | Display candidate name and assigned name separately; choosing a candidate previews it and does not silently change the project.                      |
| Section preview and description         | Candidate roadway/ditch interaction and template description                       | Partial widening only                     | Landing template may change side geometry, surfacing, ditch and slopes, not merely add width. A full graded pad remains a separate geometry problem. |
| Underlying road Section/Data/Alignments | Library dialog sits over an active engineering project                             | Present common project, no library dialog | Preview uses the active road's real selected station and terrain. Closing the preview must return to the same map/station state.                     |

### S09 — 9.46.45: landing width and assignment state

| Region / visible control                    | Observed behavior                                               | Baseline / gap                 | Acceptance                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing selected; `Assigned: DF` at station | Candidate and currently assigned template are separate concepts | Missing                        | Preview must identify the active range/side assignment and candidate. Applying a candidate updates the saved assignment; Cancel leaves it unchanged.                                        |
| Broad landing formation and fill hatch      | Landing geometry creates substantially different earthwork      | Partial width taper            | B2 full-template range resolution plus B3 quantities. A right/left-only assignment affects only that side. Reject unsupported/not-daylighted geometry instead of painting a plausible fill. |
| Station and left/right preview context      | Preview at a specified station                                  | Partial shared section station | Exact event stations for range starts/ends and taper breakpoints must be sampled and selectable, including near road ends.                                                                  |
| Library/footer controls                     | Same as S06/S07                                                 | Missing/partial                | Shared acceptance above; stored template IDs must survive export/reopen and renaming.                                                                                                       |

### S10 — 9.47.00: horizontal IP editing

| Region / visible control                   | Observed behavior                                                  | Baseline / gap                                     | Acceptance                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/Edit IP tool in Plan                   | Add or edit an intersection point directly on terrain              | Present drawing/dragging; insertion is indirect    | Add/insert/move/delete a PI with a clear selected state, valid undo and neighboring geometry recomputation. Preserve existing points and independent vertical design unless the user changes them. |
| Section at station 0                       | Roadway, ditch, cut/fill and ground at current horizontal location | Present after analyzed route exists                | Moving the uncommitted endpoint should preview its section when sufficient geometry exists; a one-point draft must remain ephemeral.                                                               |
| Section status                             | Next/last grade, left/right superelevation and final side slopes   | Missing detailed readout/independent side controls | Report resolved values at the selected station with units; distinguish H:V from percent and design grade from endpoint ground grade.                                                               |
| Data: L-Stn, Cut Dp, Grade, V.Brk          | Editable/design-event schedule, not just sampled terrain           | Partial fixed analysis table                       | Add a design-control view for PVI station/elevation/grade break and a sampled-results view. Changes must feed the same design model and reject invalid ordering.                                   |
| Alignments tree / cost status / curve tabs | Horizontal and vertical alternatives and curve-specific inspection | Partial flat alternatives                          | Provide curve schedule/selection with fitted status and radius/length; impossible curves remain flagged. Keep comparison totals connected to current data.                                         |

### S11 — 9.47.23: moving-endpoint feedback

| Region / visible control         | Observed behavior                                 | Baseline / gap                                              | Acceptance                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan tangent and endpoint cursor | Unfinished alignment tracks the cursor            | Partial: numeric hover only; draft line uses clicked points | Append the hovered point to a bounded temporary analysis. Display the temporary tangent/endpoint without persisting it; click commits, Escape/Cancel removes only draft state. |
| Section changes with endpoint    | Cross-section previews location before committing | Missing live hover analysis                                 | Throttled preview recomputes the same displayed analysis supplied to profile/section/map/3D. Never leave a previous road's section beside a new draft label.                   |
| Grade/status near section        | Instant ground-grade estimate for current leg     | Present banner value only                                   | Show endpoint-ground grade, leg distance and bearing; mark no-data as unknown. Do not present an endpoint chord grade as the maximum grade sampled along the leg.              |
| Data / alignment panel           | Draft data coexists with saved design             | Partial                                                     | Saved project and analyses remain unchanged until Finish; export/autosave must not capture a half-created road.                                                                |

### S12 — 9.47.53: offset geometry and selected section

| Region / visible control                       | Observed behavior                                 | Baseline / gap                                                         | Acceptance                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashed parallel plan lines                     | Additional roadway/template offset geometry       | Partial daylight polygon only; exact screenshot line codes unspecified | Show labeled road edges, ditch lines and daylight where available, derived from section point codes. Do not guess which unlabeled dashed line is which. |
| Endpoint at station 670.299 / matching section | Plan and section identify the same station        | Present shared station                                                 | Coordinate/chainage consistency holds through edits, curved alignments and template changes. No use of control-chord distance as curved station.        |
| Section L/R slopes and grade                   | Local crossfall/batter and previous grade readout | Partial                                                                | B2/B3 resolved section readout; display missing values explicitly.                                                                                      |
| Horizontal Curves / Vertical Curves tabs       | Geometry-specific schedule                        | Missing schedule; controls exist                                       | Tabulate curves, tangents, grade breaks and warnings; selecting a row moves the shared station/map cursor.                                              |

### S13 — 9.48.06: profile and mass together

| Region / visible control              | Observed behavior                                              | Baseline / gap                          | Acceptance                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile window                        | Full terrain profile and selected endpoint                     | Present auto-fit chart                  | Add readable fit/zoom and selection while preserving full source coverage. Curve editing uses independent designed grade, not the ground path. |
| Mass-haul below profile               | Common horizontal station axis and synchronized range          | Partial: separate detail tab            | Quantities layout shows both at once with matching station domain; selecting either updates all connected panes.                               |
| Cross-section and Data beside profile | Current section and schedule remain visible during mass review | Partial: detail tabs mutually exclusive | Layout should allow relevant panes together, or provide an explicit responsive arrangement without losing state.                               |
| Cost and quantity region              | Haul categories and status                                     | Missing detailed cost/haul              | B5 totals reconcile to interval records and pit/movement events; unavailable/allocation-free results must not be labeled optimized.            |

### S14 — 9.48.17: dedicated pegging layout

| Region / visible control   | Observed behavior                                        | Baseline / gap                               | Acceptance                                                                                                                                   |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pegging.dlt` layout       | Plan, profile, section and data visible together         | Missing preset                               | A Pegging preset presents all four, sized for live feedback; switching layout changes no design data.                                        |
| Data: station / grade / HD | Leg table including current endpoint                     | Partial read-only collapsed chord table      | Persisted and current-preview legs distinguishable; length/grade units explicit; selected row highlights corresponding map leg and endpoint. |
| Plan 9.2% tangent label    | Immediate grade placed with the current segment          | Partial banner only                          | Attach a readable live grade label to the preview segment, with color/unknown state and collision-aware placement.                           |
| Red cursors in three views | One moving endpoint drives corresponding profile/section | Missing for hover, present committed station | Verify every pointer move at reasonable throttle updates all panes from one preview object. No independent interpolation in each view.       |

### S15 — 9.48.24: updated pegging state

| Region / visible control             | Observed behavior                              | Baseline / gap             | Acceptance                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint changed to 670.978 m / 9.0% | Small pointer move updates length and grade    | Partial numeric banner     | Numeric HUD, tangent label, leg table and selected endpoint all use identical preview coordinates and source. The new `(2)` image reads **9.0%**, not the value in an earlier upload. |
| Profile endpoint/vertical cursor     | Updated location corresponds to terrain sample | Missing live-hover chart   | Preview must use terrain sampling at the moved location and preserve holes; values cannot be cached from the previous cursor position.                                                |
| Cross-section center/cursor          | Updated endpoint section remains synchronized  | Missing live-hover section | Same selected temporary station and template as the plan/profile; commit makes the visible preview the saved geometry without a jump.                                                 |
| Video player overlay                 | Webinar title, controls, time 33:28 / 55:34    | Not an app feature         | Exclude video chrome from implementation requirements; use the transcript as workflow evidence.                                                                                       |

## Manual-supported behavior beyond the visible controls

| Manual pages | Behavior supported by text/figures                                                                                              | Baseline gap                                           | Acceptance / data limit                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 18–20, 29–46 | Bounded LiDAR import, terrain modelling, maximum triangle span, contour specification, density-aware thinning                   | Browser accepts processed GeoTIFF; no LAS/TIN workflow | Route to an explicit preprocessing workflow or implement bounded ground-class processing with CRS/no-data/source metadata. A coarse display raster is not native-data processing. Preserve sparse areas and holes. |
| 58–72        | Flow direction, depression fill, streams/ponds, drain-to-point and watershed tools                                              | Not in this road workspace                             | Terrain drainage is a separate derived-analysis layer. It does not by itself provide design flood, culvert capacity or fish passage.                                                                               |
| 78–87        | Create/edit/insert/delete horizontal IPs, horizontal/vertical curves                                                            | Most geometric primitives present                      | Add discoverable insertion/curve schedules and clear invalid-curve feedback, retaining original control points when curves cannot fit.                                                                             |
| 89–94        | Cumulative mass, shared-axis subviews, configurable haul classes and table columns/interval/totals                              | Basic balance only                                     | Select reporting interval without changing integration accuracy. Classify documented movements using editable thresholds. The example 24 m / 150 m values are not universal defaults or standards.                 |
| 95–98        | Station-accessed borrow/waste pits, access distance, material type, fixed/variable amounts                                      | Missing                                                | Persist pit capacity/quantity, material, access distance and cost. Manual planned movements are valid; automatic variable-volume balancing requires an explicit solver and must disclose its method.               |
| 101–104      | Road class specifications, curve widening                                                                                       | Basic grade/radius criteria and manual width ranges    | Model selected design criteria and implemented widening rules; show origin/assumptions. No compliance claim from an arbitrary preset.                                                                              |
| 105–110      | Named materials with cut/fill slopes, expansion, excavation/embankment/haul costs, quality; station-assigned subsurface layers  | Missing                                                | User-entered material library and depth/range assignments; preserve unclassified material when no data supplied. Ground DEM cannot identify geology.                                                               |
| 111–112      | Material layers change section appearance and slopes; fill-type assignment                                                      | Missing                                                | Geometry, per-material areas/volumes, map footprint and 3D respond to actual assignments. Required fill quality and material suitability are explicit user inputs.                                                 |
| 113–115      | Range-based stripping and clearing offsets; strip before section construction; stripped material excluded from reusable balance | Missing                                                | Bound removal by layer depth where known; record stripped volume separately, apply it once, and do not reuse it as suitable fill. Missing horizons remain assumptions.                                             |
| 116–120      | Reusable component templates; independent sides, surfacing, ditch dimensions and material-sensitive slopes                      | Partial                                                | Typed component parameters with deliberate units; duplicate/mirror side behavior; templates must be evaluated against terrain rather than drawn as a constant screen shape.                                        |
| 121–122      | Four typical ground previews, movable candidate, actual-station preview                                                         | Missing                                                | Isolated preview state, side/cut/fill presets, actual station mode, Apply/Cancel. Preview exaggeration must not change calculation inputs.                                                                         |
| 123–128      | New rock-fill template, component replacement, left/right station assignment, save/open/merge                                   | Missing                                                | General library/range functionality is implementable. Specialized keyed rock-fill geometry needs actual bench/key rules; a preset name alone does not implement it.                                                |
| 129–132      | Four-knot width override, default restoration, duplicating a group at another station                                           | Partial symmetric taper                                | Preserve explicit start/full-width/end-full-width/return knots or equivalent asymmetric tapers. Moving/duplicating a group preserves relative spacing and side.                                                    |
| 133–142      | Surface-to-surface quantities, named point codes, hover measurements, code lines in plan/profile                                | Missing layer/code model                               | Expose computed points/surfaces used by quantities. Codes such as center/edge/ditch/daylight must follow geometry, be inspectable and exportable.                                                                  |
| 143–147      | Culvert station, natural channel/cross drain, diameter, gradient, skew, ditch override; linked plan/profile/section/3D          | Missing structures                                     | Persist and render geometric culvert records; recompute when alignment changes. Distinguish manual inverts from auto placement. No claim of hydraulic sizing or structural adequacy.                               |
| 148–161      | Class/point labels, label position and profile bands                                                                            | Sparse labels                                          | Display selected meaningful engineering annotations with visibility controls; labels reference real object IDs and cannot conceal no-data.                                                                         |
| 162–175      | Multiple plot report chapters, page size, plan/profile/section subviews, legend                                                 | Basic HTML report                                      | Printable linked plots and station-range report with source, assumptions, units, coverage and revisions; prevent cut-off charts/tables in actual print preview.                                                    |

## Connections that every new feature must preserve

1. **One terrain source.** Native elevation sampling for profile, section, road,
   cable, radial preview and quantities uses the same `TerrainSource` and source
   metadata. Display sampling/LOD is declared and never used as an analytical
   replacement. Restoring a source must verify its recorded provenance.
2. **One displayed alignment analysis.** Saved roads, temporary pegging and
   ground-only transects may change what is displayed, but all panes receive the
   same displayed geometry/analysis. Only Finish persists a draft road.
3. **One road station.** Plan marker, profile cursor, section, 3D, station row and
   mass cursor use the same horizontal chainage along the actual curved model.
   Control-point chord distance is a distinct metric.
4. **Cable distance is separate.** A selected D-line has its own along-span
   distance/cursor, shared by its chart and map. It must not overwrite the road
   station merely because both are measured in metres.
5. **Stable object selection.** Map clicks and lists select the same road,
   structure, material/template range, or radial spoke IDs. Renaming cannot
   break references. A temporary radial ray is not a road alignment.
6. **Exact events are represented.** Template boundaries, widening knots,
   material changes, pits and structures enter the station/event schedule.
   Coarsening a bounded sampling interval must not drop these design events.
7. **Resolved geometry drives all representations.** Plan edges, ditch lines,
   daylight polygons, section codes and 3D surfaces come from the same resolved
   section model. Do not use a constant map buffer after variable-width edits.
8. **Missing terrain remains missing.** Unknown ground produces gaps and partial
   quantities. No volume, material movement, radial clearance or filled 3D mesh
   may bridge an unknown interval as if measured.
9. **Inputs are independent of derived results.** Material assumptions, template
   assignments, structures, pit records and unit rates are persistent inputs;
   all charts/totals derive from them. Avoid parallel state copies in panels.
10. **Every edit reaches the shared calculation.** New dependencies must be in
    `useRoadWorkspace`/engine inputs and memo keys. An edit must recompute or
    mark results unavailable, never keep stale totals under updated inputs.
11. **Undo/save/open cover the complete feature.** Model, metadata, assignments,
    references and provenance round-trip together. Validation rejects invalid
    references, non-finite values, invalid ranges and excessive budgets without
    replacing the last valid save.
12. **Ground-only data stay ground-only.** Terrain profiles, streams, inventory
    context and cable rays must not acquire designed-grade/road-volume claims.
13. **View controls do not mutate design.** Zoom, exaggeration, layer toggles,
    preview layouts and template sandbox offsets only change presentation until
    a deliberate engineering edit is applied.
14. **Exports agree with visible state.** Source hash/datum, active road, event
    stationing, component quantities, partial coverage and assumptions in CSV,
    GeoJSON and reports match the displayed analysis revision.

## Implementation verification ledger

Each batch needs at least one numerical fixture for its new calculation and one
end-to-end interaction that demonstrates the map connection. Do not count a
rendered label, model field or passing snapshot alone as completion.

The ledger records completed checks on **2026-10-21**. “Passed” applies to the
implemented scope, not every commercial/manual capability in the baseline. The
remaining differences are listed explicitly in the second-pass review.

| Batch | Numerical / integration evidence                                                                                                          | Connected browser evidence                                                                                                                                                                                                                                                         | Result                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| B1    | Peg distance/bearing/grade and terrain-gap fixtures; section point codes, widths and ditch geometry                                       | Moving peg changes profile/section/data without entering saved JSON; commit/undo works. Map/chart/table and task layouts share station. Zoom/pan/Fit/exaggeration leave project data unchanged; profile/bands/mass share their range.                                              | Passed for connected editing and existing task presets                                |
| B2    | Side/range resolution, transition boundaries, exact width/depth volumes; library round trips and ID remapping                             | Unsaved candidate preview changes actual map formation; Close/Discard restores it without saving. Save and side-specific assignment update geometry, bands and exports; library import and project reopen preserve inputs.                                                         | Passed for parameterized templates and supported assignments                          |
| B3    | Known layered cut split, reusable/unsuitable factors, entered rates, cut-only stripping and unclassified intervals                        | Entered material/horizon changes appear in section geometry, bands, material results and downloaded quantities; project/library save and reopen retain them.                                                                                                                       | Passed for entered horizons, classification and cut-only stripping                    |
| B4    | Endpoints, skew, cover, inclined barrel length, missing inverts and crossing-association fixtures                                         | Editing skew changes actual map barrel coordinates. Map/list/profile/section share station; separate culverts at the same station retain IDs, including 3D selection. Saved inputs and CSV contain the structure.                                                                  | Passed for geometric structure inventory                                              |
| B5    | Material conservation, capacity exhaustion, fixed site costs, haul category boundaries and no movement across gaps                        | Entered borrow/waste sites and haul settings create transfer rows and cost components; selecting a transfer updates the shared station. Structure/haul costs appear in downloaded quantities.                                                                                      | Passed for deterministic entered-input haul scenarios                                 |
| B6    | Radial flat/valley/ridge/no-data fixtures, bearing limits, support offsets, orientation, geometric summary and output guards              | Map/table spoke selection and profile cursor share physical coordinates. Changing landing invalidates preview; adoption saves a D-line. Offsets/orientation update map/profile; 175 m effective span agrees across views and survives reopen. D-line CSV/report download succeeds. | Passed for geometric radial and D-line screening                                      |
| B7    | Ground-only profile statistics/exports; compass aspect, flat/no-data and same-source pixel tests                                          | Ground transects disable road editing/quantities. Aspect changes the actual raster image; context toggles change actual map features without modifying project JSON. Separate native-source browser check loads the published 1 m DTM with its verified checksum.                  | Passed for terrain/profile/display workflows; inventory remains source-dependent      |
| B8    | Complete engineering JSON/library round trips, invalid-input rejection, empty/stale output guards, units/provenance and CSV/HTML escaping | Alternatives/undo/GeoJSON/project round trips pass; failed terrain restore preserves the saved source. Section, material and D-line outputs download with expected fields; D-line report includes its SVG.                                                                         | Persistence/output checks and sampled native-report A4 print-layout inspection passed |

### Completed verification runs

- **125 road unit/integration tests passed across 12 files** with
  `vitest run src/pages/dev-forestry-roads`.
- **10 workflow Playwright cases passed** in `forestry-road-design.spec.ts`
  (1.6 minutes), and **5 view Playwright cases passed** in
  `forestry-road-views.spec.ts` (35.5 seconds). These exercise real MapLibre
  sources, rendered features and pointer interactions on explicitly labelled
  synthetic training terrain. A deterministic empty basemap style avoids an
  unrelated external tile dependency; the map and analytical overlays remain real.
  After the final legend and template-preview presentation refinements, six
  relevant existing browser cases were rerun and passed; this is a subset rerun,
  not six additional cases.
  The radial map-selection case also passed three consecutive runs after making
  hover respect overlay selection and waiting for the exact rendered spoke before
  the test clicks it. The test verifies that moving the pointer onto a spoke does
  not move its landing station.
- **Native-source browser check passed:** the published 1 m DTM returned HTTP
  200, matched its pinned checksum, populated the real map and raised no runtime
  errors. This is distinct from the synthetic fixtures and does not convert 1 m
  horizontal cell spacing into a claim of vertical accuracy.
- **Sampled A4 print-layout inspection passed:** actual native-source exports
  produced a seven-page road report and a four-page D-line report. Road pages
  1–2 and D-line pages 1 and 4 were visually inspected: plots and provenance were
  readable, repeated table headers were present, and no clipped columns or rows
  were found on those pages. Text extraction was checked across all pages. This
  records the inspected outputs, not a guarantee for every page size or printer.
  The eight-image native-source gallery records actual application views with
  materials, inverts and rates explicitly identified as demonstration inputs.
- **Full TypeScript check passed.** The production `vite build` passed in
  7.32 seconds; existing dependency, Browserslist and large-chunk warnings remain.
  Targeted lint checks passed for the changed analytical and view modules.

### Recorded implementation and numerical evidence

These results establish specific calculation behavior. They do not replace the
connected interactions in the table above.

- `engineering.ts`, `templates.ts`, and `engineering.test.ts` cover independent
  template sides and tapered range resolution. An analytical case in which width
  and surface depth both vary gives 160.6667 m³ of surface material. An abrupt
  21–24 m assignment retains its event boundaries and gives 1,618 m³ of cut.
- The same suite partitions a known 1,600 bank-m³ cut into 900 m³ of shallow
  soil and 700 m³ of deeper rock; entered material factors give 1,200 m³ of usable
  fill and 450 m³ of unsuitable material. Entered rates total $12,000 in that
  fixture. These are synthetic test inputs, not estimates for the demonstration
  location. A 0.2 m stripping case removes 196 m³ once, with no stripping under
  fill; a short material range leaves the remaining volume explicitly unclassified.
- Culvert fixtures verify a 12 m pipe, 0.6 m diameter, −1% grade, 1.43 m cover,
  10 m required span and $1,700 entered cost; an asymmetric 60° skew case spans
  32 m. Missing terrain or unknown inverts produce unknown results rather than
  a guessed elevation. These are geometric tests, not hydraulic sizing.
- Haul fixtures verify conservation, entered rates beyond a 25 m free-haul
  threshold, borrow capacity exhaustion, fixed site cost charged once, and waste
  capacity. No movement is allocated across a missing-terrain interval. The
  numerical thresholds are test inputs, not standards.
- `radialDeflection.ts` and `radialDeflection.test.ts` cover flat ground,
  parabolic valley, interior ridge and no-data cases; full and partial bearing
  sweeps; a 72-spoke sampling cap; selected-ray GeoJSON and along-span map cursor;
  and adoption through project save/open. A 100 m span with 20 m supports and
  10% assumed sag has 10 m midpoint clearance on flat ground. A 30 m-deep
  parabolic valley has 40 m midpoint clearance and 20 m minimum at its supports.
  Missing support ground makes clearance unavailable even when most of the
  sampled ground is present. The panel invalidates a run when its landing,
  terrain source or settings change. This fixed-radius screening model does not
  estimate payload, tension or maximum operating reach.
- `cableGeometry.ts`, `cableGeometry.test.ts`, and the cable integration case in
  `engine.test.ts` verify signed support offsets and yarder orientation. Insetting
  a 100 m original line by 20 m and 30 m gives a 50 m effective span; support ground
  is sampled at the moved coordinates. Negative offsets extend the span. Moving
  the yarder to the physical end swaps support heights without reversing the
  distance axis. Collapsed/reversed spans are rejected, resolution is idempotent,
  and map cursors use the effective geometry. Original endpoints remain inputs.

- `projectEngineering.test.ts` passes **18 integration cases** covering complete
  engineering JSON round trips; portable template/material definitions; merge ID
  remapping without rebinding existing references; replacement clearing dependent
  assignments; invalid overlap/orphan/collapsed-cable rejection; quantities,
  units, provenance and incomplete statuses; effective D-line exports; unavailable
  analysis guards; and ground-only profile outputs. Culvert quantity units
  distinguish an inclined barrel length from a provisional horizontal length
  when inverts are unknown.
- `terrainDisplay.test.ts` passes **7 cases** for downslope compass aspect,
  north-wrap continuity, all eight compass bearings, same-source plane colors at
  center and boundary pixels, flat terrain and missing cells/neighbors. Aspect
  reuses the hillshade/slope grid and performs no additional terrain samples.
  Flat is neutral grey; unavailable gradients remain transparent. Its display
  resolution is separate from the native source used by engineering analysis.
- `sectionGeometry.test.ts` passes **3 cases** for asymmetric formation edges,
  actual cut-side ditch bottoms, daylight and semantic point codes, including
  the absence of a ditch in fill and independent ground/design gaps.
- `profileOutputs.test.ts` passes **9 cases** for support rise, inclined chord,
  assumed sag, sampled geometric cable length, physical support offsets and
  orientation, unknown terrain, stale/empty profile rejection and escaped source
  metadata. Selected-section CSV includes signed offsets, source coordinates,
  actual section codes, separate ground/design levels and signed cut/fill depths.
  Unknown values remain blank. These exports reuse calculated geometry; they do
  not query a different terrain source or use rendered map elevations.

The earlier focused radial/cable run passed **11 tests in two files**. Those
cases, the later output/section/aspect fixtures and the other road suites are
included in the final **125-test** aggregate above; counts should not be added
together as though they were independent runs.

## Second-pass code review (2026-10-21)

This compares the current implementation with the baseline acceptance criteria.
“Implemented” here means the inputs, calculations and view connections exist in
code. The ledger above records the completed calculation, browser and production
build checks. Partial capabilities below remain partial despite passing tests.

| Area / source                          | Current implemented behavior                                                                                                                                                                                                                                                                                                                                                                                                                            | Scope still partial                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connected editing; S01, S10–S15        | Moving road drafts and numeric peg candidates use the displayed analysis shared by plan, profile, section, 3D and leg data. Only deliberate commit saves a draft. Profile and mass-haul range share a domain; map/chart/table station selection is shared. Curve schedules, resolved section readouts and engineering bands are present. Calculated cut-side ditch lines appear in plan/profile/section/3D; point codes are inspectable and exportable. | Three persistent task presets are provided; there is no user-named layout editor with saved pane sizes/chart ranges. Clicking a band selects chainage, not its assignment's editor by ID.                                                                                               |
| Template library; S06–S09              | Named templates, independent side controls, staged numeric candidate edits, Save/Discard, four synthetic condition previews, actual-station preview, range/side assignments and library merge/replace are implemented. Geometry and quantities resolve the same assigned templates.                                                                                                                                                                     | Templates are parameterized sections rather than arbitrary CAD component assemblies. Width transitions use one symmetric taper length, without independent entry/exit knots. Referenced-definition deletion currently removes its dependent ranges; the UI does not offer reassignment. |
| Materials; S01 and manual pp. 105–115  | User-entered material definitions and station/depth horizons drive classified areas, volumes, entered rates, reusable/unsuitable material and stripping totals. Unknown material stays unclassified. Horizons appear with section/profile data.                                                                                                                                                                                                         | Material records do not change batter geometry or enforce a required fill-quality class. Stripping classifies shallow excavated cut; it does not remove ground beneath fill before constructing a section, apply undercut or model clearing-offset ranges.                              |
| Structures; S01 and manual pp. 143–147 | Editable culvert geometry includes station, diameter, length, skew, inverts, cover and entered cost. Crossing associations are validated, and a shared culvert ID identifies the same structure in map/list/profile/section/3D, including structures at the same station.                                                                                                                                                                               | Ditch override geometry is absent. Results are geometric checks; no hydraulic sizing or structural capacity is implied.                                                                                                                                                                 |
| Quantities and haul; S01, S10–S13      | Material and component cost ledgers, borrow/waste capacities, movement allocation, free/over/end-haul categories and partial-data handling are implemented. Mass review uses the profile's station range.                                                                                                                                                                                                                                               | Allocation is a documented deterministic scenario using the entered inputs, not a proprietary economic optimizer.                                                                                                                                                                       |
| D-lines and landing; S03, S05          | Yarder orientation, signed support offsets, moved-support terrain sampling, a separate linked span cursor, and a bounded radial explorer are implemented. Selecting a spoke links map/table/profile; adoption creates an actual saved editable D-line. Summary/CSV/report distinguish horizontal span, support rise, inclined chord, assumed sag, sampled geometric length and clearance coverage.                                                      | Radial exploration compares fixed-radius candidates; it does not solve maximum operating reach. Sag is an assumed geometric parabola, without force, load or anchor analysis.                                                                                                           |
| Terrain and context; S02–S04           | Hillshade, slope, aspect, elevation and contours use the active source. Aspect has a compass legend and explicit flat/missing states. Context visibility is available by feature kind and changes presentation only. Separate ground transects and source-linked terrain/inventory workspaces remain distinct from road designs.                                                                                                                        | A bare-earth DEM cannot provide measured tree species, stem size, merchantable volume or geology. The workspace does not manufacture these fields or treat an inventory link as a completed site-specific cruise.                                                                       |
| Data and reporting; S01–S15            | Complete model JSON and library round trips, engineering/station/selected-section/D-line CSV, effective geometry GeoJSON and printable source-labelled road/ground-profile/D-line reports are implemented. Station tables have range and flag filters, coordinate visibility and covered interval totals. Ground-only outputs exclude road engineering quantities.                                                                                      | The report designer does not provide arbitrary column sets, a separate report sampling interval, or a configurable multi-chapter plan/profile/section/mass layout.                                                                                                                      |

### Remaining bounded interface differences

These are actual residual differences from the visible controls, rather than the
baseline's now-implemented engineering batches:

- **Band-to-editor selection:** band clicks inspect the correct station, but do
  not select a template/material assignment by ID or open that editor. The map
  station connection remains functional.
- **Referenced library deletion:** deletion is undoable and removes dependent
  assignments/horizons; a replacement-selection workflow is absent. This differs
  from preventing deletion until references are explicitly reassigned.
- **Independent measurement:** peg controls provide bearing, distance and
  ground-grade input/feedback. There is no separate two-point measurement tool
  that leaves all alignment geometry untouched.
- **Layout/report authoring:** the existing task presets and report filters are
  useful subsets of the desktop layout/report controls. Saved named custom
  layouts, resizable panes, arbitrary report columns and a full plot-book editor
  are not implemented.

Material-sensitive slopes, pre-section stripping beneath fill, asymmetric
four-knot widening and culvert ditch overrides remain partial manual workflows.
Proprietary file formats, measured inventory that has not been supplied, hydraulic
design and cable mechanics are separate capabilities; their absence must not be
hidden by similarly named buttons or presets.

### Completion language

An honest final comparison should distinguish implemented, partially implemented,
data-dependent and intentionally separate workflows. A sidebar section or link
is not equivalent to a complete material model, equipment library, tree inventory,
hydraulic design or proprietary optimization system. The screenshots and manual
specify useful workflows; they do not supply the site's geology, measured trees,
hydrology, equipment limits or construction authorization.
