# RoadEng / Terrain Tools comparison — 30 October 2026

This is the pre-implementation audit. See the subsequent
[implementation and validation record](implementation-and-validation-2026-10-30.md)
for the delivered extensions and current test results.

PGMaps already implements most of the connected road-planning workflow. The substantial
remaining differences are in how materials change the constructed road, how material movements
are constrained and optimized, terrain preparation, watershed inspection, and drawing authoring.
Adding another template or haul panel alone would not close these differences.

This review compares `/dev/forestry/road-design` at **`37058a7`** with the supplied
[Drive folder](https://drive.google.com/drive/folders/1VbnFAPZb3P1CkCrCM9vrxeLDEDGh432j).
It is a source-code and documented-workflow audit, with four focused engine checks. It is not
a side-by-side runtime test of the commercial products or a fresh browser acceptance run.
No application code was changed by this review.

## What was reviewed

| Supplied file | Inspection and evidential limit |
| --- | --- |
| [RoadEngResource10.zip](https://drive.google.com/file/d/16fC0ZbaxLrAct2S56nVIB-1BT1zqibn-/view) | Downloaded and listed. Contains `RoadEngResource_x64_10.0.664.0.exe`, not a training-data directory. Static executable/container inspection only; not installed or run. |
| [TerrainToolsForestry10.zip](https://drive.google.com/file/d/1tOygJHjDfgDDjOxGfQHePJhlq1MTULkX/view) | Downloaded and listed. Contains `TerrainToolsForestry_x64_10.0.664.0.exe`. Static executable/container inspection only; not installed or run. |
| [TerrainTools10.zip](https://drive.google.com/file/d/18qs-e-OHBlj6wnAaYMZnNTEEgDt9Iqun/view) | Downloaded and listed. Contains `TerrainTools_x64_10.0.664.0.exe`. Static executable/container inspection only; not installed or run. |
| [RoadEng_Tutorial_11.exe](https://drive.google.com/file/d/1HAAc2xcS6EabDBrUPKj6SuSouHFeCYnd/view) | Metadata inspected. Download rejected: 518,846,048 bytes exceeds the Drive connector's 268,435,456-byte limit. Its packaged examples remain unverified. |
| [V11_RoadEngResourceRoad - FINAL PDF.pdf](https://drive.google.com/file/d/1sMul7UhenA3b7ZXph6m6tz6UENylQQ33/view) | Downloaded; extracted its 245-page text, reviewed its contents and relevant workflow sections. Document version **20 February 2025**. This is the primary functional evidence below. Page references use PDF/printed page numbers. |

The three version 10 archives are product packages, not three independent sets of requirements.
The version 11 manual covers Survey/Map, Terrain, Location and optional Softree Optimal tools
(pp. 8–12). Product names alone do not establish which licensed function groups are enabled.
Exact version 10 tier differences, installer-only functionality and numerical equivalence remain
unverified. This report does not claim exhaustive parity with every executable in the folder.

Repository evidence includes the current model, geometry, engineering, terrain, hydrology,
optimization, export and UI source; the current limits guides; and the older
[reference matrix](../forestry-road-reference-matrix.md). The older matrix contains historical
gaps that later changes closed; it must not be read as today's missing-feature list.

## Already present — retain these

| Area | Current implementation evidence |
| --- | --- |
| Connected workbench | Plan, profile, section, 3D, data and engineering bands share road/station state; pegging, horizontal edits, PVIs and alternatives. `DevForestryRoads.tsx`, `Charts.tsx`, `EngineeringBands.tsx`. |
| Layouts | Resizable panes, visible-panel controls and **named saved layouts** with their own device-local pane sizes. `LayoutPicker.tsx`, `RoadPaneLayout.tsx`. |
| Alignment geometry | Circular curves, clothoid spirals, parabolic vertical curves, grade/K/control checks, superelevation and inside widening. `engine.ts`, `verticalStandards.ts`. |
| Templates | Named libraries, independent left/right parameters, range assignments/transitions, actual-section preview, landing/turnout widening. `templates.ts`, `EngineeringControls.tsx`, `TemplateSandbox.tsx`. |
| Materials and earthworks | Station/depth horizons, material cut quantities, usable fraction, bank/compacted conversion, cut-only stripping, cost ledger, mass balance. `engineeringTypes.ts`, `engineering.ts`. |
| Pits and haul | Capacity-limited borrow/waste sites, access distances, setup costs, haul classes, movement table, optional delivered-cost site selection. `engineering.ts`, `gravel.ts`. |
| Connected access costs | Reviewed road topology, directed loaded/return paths, restrictions and dated condition/bridge evidence, rehabilitation, material-source capacity and complete alternative-cost ledgers. `roadNetwork.ts`, `fullCostComparison.ts`. |
| Final connector checks | Fitted geometry, signed loaded grades, terrain/section coverage, cut/fill footprint, clearing allowance, exclusions and crossing review. `connectorChecks.ts`. |
| Terrain and drainage | GeoTIFF/LAS/LAZ, ground classification, grid/TIN-with-breaklines preparation, contours/slope/aspect; existing-versus-design D8 flow, accumulation, ponds, crossing diversion, Rational/Manning pipe screening. `pointCloud.ts`, `tinSurface.ts`, `hydrology.ts`. |
| Reports and interchange | Project/library JSON, GeoJSON, zipped shapefile, LandXML alignment/profile/sections, stakeout/engineering CSV, map/report PDF, A3 plan/profile/section plot book. `FilesDialog.tsx`, `designExports.ts`, `plotBook.ts`. |
| Cable planning | Editable D-lines and fixed-radius radial exploration, linked profiles, entered support heights/offsets and geometric sag/clearance. `cableGeometry.ts`, `radialDeflection.ts`. |

## Prioritized gaps

**P1** means address before stronger quantity/design claims or routine engineering comparison.
**P2** means a substantial workflow extension. These are recommended priorities, not a list of
features the user has authorized for implementation.

| ID / priority | Missing or incomplete capability | Reference and current evidence | Concrete completion criterion |
| --- | --- | --- | --- |
| G01 / P1 | **Road-class design rules and warnings.** Speed, friction, e-max and minimum radius are independent entries. A required superelevation above the cap is silently capped. Widening uses one vehicle-length formula, not the reference's radius/deflection lookup and separate inside/outside widening. | Manual pp. 101–104. `engine.ts` `curveDesignAt` and `analyzeRoad`; `CurveDesign` in `types.ts`; `CurveTools.tsx`. Reproduced below. | A named, sourced criteria set; explicit failure when radius/speed/e-max conflict; inspect required versus applied crossfall; table-driven and side-specific widening where selected. Preserve entered assumptions separately from a published standard. |
| G02 / P1 | **Pre-construction stripping/undercut beneath fill.** Current stripping classifies material already in the excavation prism; it does not lower original ground before constructing embankment, create replacement fill, or provide range-based inside/outside strip offsets. | Manual pp. 113–115. `GroundMaterial.purpose`, `StratumAssignment`, `engineering.ts` `calculateEngineering`; reproduced below. | Independent site-preparation ranges and strip footprint/depth; a stripped-ground section; separate removed material; changed earthwork, replacement fill, haul, cost and plotted footprint without double counting. |
| G03 / P1 | **Material-sensitive section geometry.** Ground horizons change classification and price, but materials carry no cut/fill batter properties and do not change the section at layer boundaries. | Manual pp. 105–112, especially p. 111. `GroundMaterial` in `engineeringTypes.ts`; `RoadTemplate` in `types.ts`; `templates.ts`; reproduced below. | Explicit material slope rules and section transitions through horizons; recompute daylight, volumes, 3D and drainage surface from the same resolved geometry. User-entered geology remains required. |
| G04 / P1 | **Fill-material requirements by station and template layer.** A reusable fraction cannot express minimum quality, exact non-substitutable fill, or rock-fill/surfacing layers with their own material demands. External sources support broad fill/surfacing/waste uses, which is useful but different. | Manual pp. 112–113 and 231–238. `GroundMaterial`, `AlignmentEngineering`, `HaulSite` and `EarthworkInterval` in `engineeringTypes.ts` / `engineering.ts`; source uses in `fullCostPlanning.ts`. | Station/layer fill specifications, material suitability/substitution rules, compatible borrow supply, material-specific demand and conservation, and an explicit infeasible status for unmet requirements. |
| G05 / P2 | **Minimum-cost material-flow allocation.** Internal haul consumes nearest available cut in fill-chainage order. Delivered-cost sites and the connected full-cost allocator are heuristics; neither is an OptiHaul-equivalent economic flow solution. Costs can change the best allocation and pit opening combination. | Manual pp. 223–238. `engineering.ts` `allocateHaul`; `fullCostComparison.ts`; [full-cost guide](full-cost-alternatives.md). | A bounded, documented economic allocator across material demands, compatible sources, capacities, opening/handling/haul costs and volume bases. Check small cases against a known optimum; distinguish an optimum from a budget-limited heuristic. |
| G06 / P1 | **Construction-direction and sidecast constraints.** No station-range rule prevents moving excavated material up-chain/down-chain; no permitted sidecast ranges/capacity per metre. One-way restrictions on existing network roads do not provide these construction rules. | Manual pp. 238–241. `HaulSettings`, `HaulSite`, `HaulMovement`; `allocateHaul` uses absolute chainage distance. | Movement-direction ranges, barriers/construction stages and allowed sidecast quantities; allocations, disposal totals, costs and movement graphics must respect them. |
| G07 / P2 | **Composable section components.** The tree editor exposes a fixed lane/ditch/slope chain. It cannot assemble keyed-in rock fill, benches, retaining components, several surface layers or reference-feature/surface-driven components. Widening has one symmetric taper length. | Manual pp. 116–142, keyed-in rock-fill example pp. 122–128. `RoadTemplate`, `WidthOverride`, `TemplateComponents.tsx`. | Typed component assemblies and evaluated points/surfaces, reusable components, material-layer links and independently controlled transitions. Reproduce the keyed-in rock-fill example geometrically, rather than naming a wide template after it. |
| G08 / P2 | **Interactive drain-to-point and watershed polygons.** Accumulated area at road features exists; selecting an arbitrary pour point, snapping it to flow and returning its catchment boundary does not. | Manual pp. 63–72, especially polygon result p. 65. `hydrology.ts`, `DrainagePanel.tsx`. | Select/snap a pour point, derive and inspect upstream polygons and watershed partitions, report area, and export geometry with terrain extent/no-data qualifications. |
| G09 / P1 | **Portable drainage evidence.** Inputs are browser-local; runs live in memory. Project JSON and standard reports do not carry drainage settings, results or run provenance. This is a repository workflow gap identified during comparison, not a claim about undocumented installer save behavior. | `RoadProject` in `types.ts`; `DevForestryRoads.tsx` drainage state; `DrainagePanel.tsx`; [drainage guide](drainage.md#what-it-does-not-do). | Save settings in the project; preserve a compact result summary/fingerprint and export flow/catchment/crossing evidence. Reopen on another device with the same inputs; recompute or clearly mark stale. Large raw grids need not be embedded. |
| G10 / P2 | **Richer vertical optimization constraints and search band.** Search uses one K, levels around ground, and several imbalance prices; it does not directly search separate sag/crest/range K requirements or a band about the current design. Final validation rejects failures, but cannot recover a feasible candidate the restricted search never considered. | Manual pp. 198–206. `verticalOptimizer.ts` options, level ladder, single-K search and five-price loop; `VerticalStandards` has global sag/crest K. | Search around ground or a chosen profile; enforce distinct sag/crest and range constraints during optimization; retain final checks. Evaluate material/haul objective explicitly and disclose search bounds. |
| G11 / P2 | **Multiple vertical alternatives under one horizontal alignment.** Each PGMaps `Alignment` owns one `vertical` array. Duplicating a road supports comparison, but cannot keep shared horizontal geometry and several independent vertical children synchronized. | Manual pp. 205–210. `Alignment` in `types.ts`, `CompareAlternatives.tsx`, workspace/project state. | Shared horizontal parent with named vertical alternatives, shared versus per-alternative inputs made explicit, comparison overlays and costs, and persistence/undo across that hierarchy. |
| G12 / P2 | **Joint horizontal/vertical economic refinement.** Route/corridor search, profile optimization and complete-cost ranking are separate stages. Complete-cost comparison ranks a finite candidate set; it does not continuously refine both plan geometry and profile against the complete ledger. | Manual p. 12 and pp. 180–220. `routing.ts`, `corridorOptimizer.ts`, `verticalOptimizer.ts`, `fullCostRun.ts`, `fullCostComparison.ts`. | A candidate-refinement loop with a consistent engineering state and objective, endpoint/control constraints and final geometry/coverage checks. Do not equate finite-candidate ranking with a global solution. |
| G13 / P2 | **Per-feature crossing-cost classes.** Avoid polygons can be blocked or priced per metre; avoid linework can block a crossing. However, the terrain route search has one global stream `crossingCost`, unlike different crossing prices assigned to named stream groups. | Manual pp. 184–188. `RouteSearchOptions` in `routing.ts`, `ContextFeature` in `types.ts`. | Persist feature/group crossing costs and resolve precedence; prove that changing one stream group's price can change the suggested route. Retain existing no-go line/polygon behavior. |
| G14 / P2 | **Strategic terrain preparation and composite surfaces.** Point-cloud processing produces a single bounded ground grid. There is no full-density corridor plus coarser surrounding AOI workflow, retained editable TIN, multi-cloud mosaic, independent imported CHM/ortho background stack, or graded pad/intersection/composite-surface handoff. | Manual pp. 12, 27–57, especially pp. 37–45 and 51–57. `TerrainMetadata`, `pointCloud.ts`, `tinSurface.ts`, `terrain.ts`; [terrain limits](terrain-and-point-clouds.md#what-it-does-not-do). | Preserve corridor density through region-based thinning; source-stack/CRS controls; retained/exportable surfaces and design-surface merge with provenance. A landing widening is not a separately graded 3D pad. |
| G15 / P2 | **Drawing and report authoring.** Current labels, tables, PDF and A3 plot book exist. Missing are user-defined label expressions/placement, configurable chapters/subviews, arbitrary table columns and curve-table placement. Plot-book spacing has function parameters but no authoring UI. | Manual pp. 133–178. `plotBook.ts`, `FilesDialog.tsx`, `DesignSchedules.tsx`, `planAnnotations.ts`. | Versioned report/layout settings, chapter/range/scale controls, selectable fields, curve/structure/material tables, label styles and portable output settings. Keep analytical sampling separate from report intervals. |
| G16 / P2 | **Survey and CAD handoff.** Pegging enters bearing/distance/ground-grade candidates, but there is no traverse reduction/adjustment and side-shot field-book workflow. The road workspace cannot import KML/KMZ or native RoadEng/CAD designs; LandXML export has no terrain surface/corridor. | Manual pp. 11–12 and 16–17. Import accept/dispatch in `DevForestryRoads.tsx`; `FilesDialog.tsx`, `designExports.ts`; [export limits](exports-and-project-files.md#what-it-does-not-do). | Prioritize KML/KMZ and documented survey/terrain interchange; explicit source CRS, datum and units; round-trip fixtures in intended receiving tools. Native proprietary formats require a separately established specification. |

## Focused checks run against the engine

Four checks were executed with Node 24 / `tsx`, importing the existing pure geometry and
engineering modules. These were temporary audit probes, not new repository tests. They use
synthetic flat ground to isolate the behavior; they do not establish real-site accuracy.

| Check | Input and observed result | Interpretation |
| --- | --- | --- |
| Stripping beneath fill | Straight 100 m road, flat ground 800 m, formation 802 m, 6 m formation width, zero crown/ditch/surfacing, 1:1 batters. Add a 0–0.2 m stripping horizon over the road. Fill stays **1,600 m³**; stripping is numerically zero (about `1.21e-14 m³`). | Confirms G02. This is cut classification, not pre-section ground removal. |
| Stripping suitability guard | Set a stripping material's reusable fraction to 1. Analysis rejects it: `Stripping must have zero reusable fraction.` | Existing protection works. **Do not add “stripping can be reused as fill” to the gap list.** |
| Speed/radius conflict | 90° curve, radius 25 m, speed 40 km/h, friction 0.15, e-max 8%, minimum radius 25 m. Current formula requires **35.3937%**; applied e is **8%**. No speed/superelevation/radius flag. | Confirms G01's warning gap. The only analysis warning says no vertical alignment was entered. |
| Material versus geometry | Straight cut case: ground 800 m, formation 798 m, same 6 m / 1:1 section. Assign rock throughout, then remove the horizon. All **11 common-station sections** are identical; cut is **1,600 m³** in both. Excavation changes from **$3,200 to $16,000** at entered rates. | Confirms G03: classification/cost changes, not a material-specific batter. Horizon events can add stations, so the check compares common chainages. |

The full Vitest, build and browser suites were **not rerun** for this documentation-only audit.
Repository test files and earlier audit outcomes were read as supporting evidence, not counted
as tests executed in this review.

## Coverage of the manual

| Manual pages | Workflow coverage in PGMaps | Remaining findings |
| --- | --- | --- |
| 7–13 | Browser workspace and linked views replace desktop module navigation. | Survey and surface handoff G14/G16; exact licensing/version differences unverified. |
| 14–26 | Shapefile/GeoJSON context and LAS/LAZ import; feature inspection. | KML/KMZ and general terrain/CAD authoring G14/G16. |
| 27–46 | Ground grid/TIN preparation and source-derived contours. | Retained editable surfaces and strategic AOI/corridor thinning G14. |
| 47–57 | Basemap and active-terrain display. | Independent imported background stack and surface assembly G14. |
| 58–72 | Flow, accumulation, streams/ponds and road drainage comparison. | Pour-point/watershed geometry G08; portable evidence G09. |
| 73–88 | Road placement, horizontal/vertical edits and curves. | Design-rule depth G01; alternative hierarchy G11. |
| 89–98 | Mass chart, station data, pits, haul classes and costs. | Economic allocation and construction restrictions G05/G06. |
| 99–104 | Radius, e, runoff and automatic inside widening. | Road-class rules, warning and widening tables G01. |
| 105–115 | Materials, horizons, conversion factors and cut-only stripping. | Physical material slopes, fill requirements and stripping G02/G03/G04. |
| 116–147 | Parameter templates, ranges, point codes, culverts and ditch dips. | Composable multi-layer sections G07. **Culvert ditch dips are already implemented.** |
| 148–178 | Automatic labels, tables, PDF and fixed plot book. | Drawing/report authoring G15. |
| 180–220 | Route/corridor/profile searches and complete alternative-cost comparisons. | Constraint/search depth, per-stream costs, hierarchy and joint refinement G10–G13. |
| 223–242 | Material volumes, conversions, movement table and cost ledger. | Required fill quality, economic flows, sidecast/direction G04–G06. |

## Recommended build order

1. **Make the current quantities and checks more complete:** G01–G04 plus G09. These affect
   whether an otherwise plausible road has the right section, material demand and review record.
2. **Add buildable material movements:** G06, then G05. Establish quality and direction rules
   before optimizing a cost function over movements that may be unsuitable or impossible.
3. **Extend section and drainage tools:** G07/G08, with one geometry source feeding quantities,
   3D, drainage and exports.
4. **Deepen design alternatives and search:** G10–G13. Carry the same criteria, materials and
   costs through candidate generation, optimization, comparison and adoption.
5. **Expand authoring and handoff:** G14–G16, selected according to the actual field/CAD workflow.

Each engineering addition needs persistence, validation, undo and consistent exports as part
of its completion criteria; a visible control is not sufficient.

## Boundaries and documentation corrections

Do not infer additional missing requirements for tree/species inventory, merchantable volume,
cable tension/anchors, bridge structural design, fish passage or geotechnical stability from
installer names. Those may be useful separate products, but this supplied manual does not
establish all of those as demonstrated workflows or requirements for this app.

The old [reference matrix](../forestry-road-reference-matrix.md) is useful history but says some
now-implemented features are absent: named saved layouts/pane resizing, culvert ditch overrides,
hydrology screening and plot-book exports. Its baseline tables must be read with their dates.
Conversely, the newer complete-cost/network work does not close material-quality rules,
pre-section stripping, programmable components or construction-direction constraints.

The highest-value next work is **the physical material/site-preparation model and design-rule
checks**, followed by constrained material movement. PGMaps already has the broad planning UI
and much of the road/network cost workflow to support those additions.
