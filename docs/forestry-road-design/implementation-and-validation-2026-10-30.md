# Reference extensions and verification — 30 October 2026

This implementation follows the [RoadEng / Terrain Tools audit](reference-gap-audit-2026-10-30.md)
against the supplied Drive folder. It adds working calculations, editable controls, persistence
and outputs; the original audit remains the dated baseline.

## Delivered behavior

| Audit item | Implemented behavior | Detailed contract |
| --- | --- | --- |
| G01 | Named/source-linked curve criteria, required versus applied superelevation, speed/radius conflict flags and final-connector rejection; rectangular radius/deflection widening tables and independent inside/outside widths. | [Alignment and optimization](alignment-and-optimization.md) |
| G02 | Explicit stripping ranges remove ground before construction, including beneath fills; separate stripping, replacement fill, clearing margins and costs. Original and prepared ground stay distinct. | [Section assemblies](section-assemblies.md) |
| G03 | Entered ground-material cut batters and exact/replaceable fill-material slope rules change actual section geometry and daylight. Replaceable fill uses the conservative flattest eligible entered slope; suitability is not inferred from terrain. | [Section assemblies](section-assemblies.md) |
| G04 | Station/layer exact-material and minimum-quality requirements, compatible borrow sources and explicit infeasibility. Independently assigned sides retain separate material demands even when their layer IDs match. | [Material allocation](material-allocation.md) |
| G05 | Bounded economic material-flow model with fixed source opening costs, capacities, quality, separate bank/compacted bases and objective reconciliation. An exact adjacent-chain formulation handles continuous linear tariffs without a dense source×destination matrix. | [Material allocation](material-allocation.md) |
| G06 | Forward/backward/blocked construction ranges, permitted local sidecast and shared capacity per range, plus actual movement and cost records. Existing-road directed loaded/return restrictions remain separate. | [Material allocation](material-allocation.md) |
| G07 | Ordered bench/slope/wall/key components, separate surface courses, reusable component files/library, feature/surface anchors, asymmetric transitions and semantic point codes. Ambiguous component transitions require an explicit step. | [Section assemblies](section-assemblies.md) |
| G08 | Touch-selectable/snap-to-flow pour points, exact cell-union upstream catchment polygons and watershed partitions, map display and GeoJSON output. Boundary/no-data truncation remains visible. | [Drainage](drainage.md) |
| G09 | Project-owned drainage settings and compact, fingerprinted evidence, per-crossing/culvert results, saved polygons, stale-export guards and report chapter. Unchecksummed live terrain requires a fresh run after reopening. | [Drainage](drainage.md) |
| G10 | Ground/design-centred profile bands, distinct sag/crest and station-range K/linear rules, tangent constraints and fitted control checks inside the bounded search. | [Alignment and optimization](alignment-and-optimization.md) |
| G11 | Named vertical children share horizontal geometry and can share or independently hold engineering inputs. Profile-specific cost evidence survives switching, deletion of another child and reopening; changed inputs make historical evidence stale. | [Drawings and vertical alternatives](drawings-and-vertical-alternatives.md) |
| G12 | Bounded joint plan/profile refinement with engineering or complete-access cost objective, cancellation and final adoption checks. Complete-access trials evaluate the proposed geometry rather than regenerating unrelated candidates. | [Alignment and optimization](alignment-and-optimization.md) |
| G13 | Per-stream and named-class crossing prices, persisted and exported, with duplicate contacts at shared vertices handled consistently. | [Alignment and optimization](alignment-and-optimization.md) |
| G14 | Corridor/AOI-preserving cloud thinning, compatible multi-cloud/grid mosaics, retained editable constrained TIN, graded pads and road/composite surfaces, named analytical snapshots and independent canopy/orthophoto backgrounds. | [Terrain preparation](terrain-preparation-and-survey.md) |
| G15 | Portable A3/A4 plot-book settings: ordered chapters, station ranges, scales, subviews, schedule fields, curve tables and safe field-based labels. Material takeoffs respect chapter ranges; drawings retain prepared ground and missing-data gaps. | [Drawings and vertical alternatives](drawings-and-vertical-alternatives.md) |
| G16 | KML/KMZ import, projected field traverses, closure/Bowditch reduction, side shots, saved field books, CSV, terrain LandXML and ASCII handoff. Native proprietary project compatibility is outside the available specification. | [Terrain and survey](terrain-preparation-and-survey.md) |

All new engineering inputs pass the same save/reopen and validation path as existing inputs.
Template/material library merges remap imported references; replacement/deletion guards prevent
orphaning site preparation, fill requirements, course/component materials, sidecast or quoted
source classes. Independent sibling profiles retain their own inputs.

## Integrated correctness fixes

Cross-feature review added regression checks for:

- approach-side preparation and geology at the terminal road station;
- stripping margins in actual plan/3D/drainage geometry and final exclusion checks;
- prepared-ground cut/fill bounds, keyed-foundation excavation, and incomplete sections when
  required preparation or active keys cannot be represented within the supported section;
- no double-counting of copied component IDs or material courses during transitions;
- separate original/prepared ground in CSV, plots and LandXML, including split surfaces across
  interior missing-data intervals;
- explicit matching vertical datums for measured 3D feature anchors and named reference surfaces;
- no lost comparison evidence or recursively expanding signatures between vertical children;
- no stale joint-refinement adoption over an edited/reopened project or changed terrain, and
  no late cleanup that clears a newer operation's busy state;
- grouped profile transitions that retain feasible tangent histories while restoring the
  existing ±12 m search workflow within the unchanged five-million-transition budget;
- cost fingerprints that detect changed grid/TIN contents even with unchanged recorded hashes,
  while independent display-layer opacity/visibility changes leave analytical costs current;
- material infeasibility remaining visible even when terrain coverage is 100%; and
- a real 320 px settings-dialog clipping defect, fixed at the fieldset boundary.

Live report-PDF verification also exposed SVG rasterization waiting behind the live map's GPU
work. Offscreen export canvases now request a CPU-backed context for their immediate pixel
readback. The full training report completed in about ten seconds with all 12 pages, 74 images
and the final station retained. The visible terrain canvas keeps its normal rendering policy.

The complete-access model version changed to `connected-access-2026-10-v3-content`.
Earlier saved comparisons remain historical and require recalculation rather than appearing
current under changed geometry, material or fingerprint rules.

## Scenario validation

The numerical scenarios load the actual published/native/regional sources used by the library.
The extended-engineering journey deliberately supplies **synthetic test geology, material
quality, prices, capacities and construction rules**. It is software verification, not a site
design or a claim that those materials or sources exist.

| Built-in scenario | Extended material/preparation/course journey | Drainage/catchment/evidence journey |
| --- | --- | --- |
| Prince George native LiDAR | Passed | Passed |
| Tabor Mountain access | Passed | Passed |
| Kamloops dry Interior | Passed; steep-grade warnings retained | Passed; truncated catchments remain flagged |
| Vernon upland | Passed; steep-grade warnings retained | Passed; truncated catchments remain flagged |
| Smithers Northwest | Passed | Passed; truncated catchments remain flagged |
| Training connected access | Passed | Passed |
| Training hillside | Passed | Passed |
| Training road reuse | Passed | Passed |
| Training local gravel | Passed | Passed |

The extended journey applies material-sensitive batters, 0.2 m preparation with outside
offsets, a bench, a 0.15 m material-specific course, exact fill requirements, economic allocation,
forward construction, local sidecast, explicit borrow/disposal, a named profile and authored A4
output. It uses an explicit **50 m requested station spacing** to bound the economic model;
event stations remain included. This scenario matrix uses entered continuous linear haul
tariffs with no fixed loading charge; discontinuous/loading-step tariffs exercise the bounded
general solver in separate unit cases. All nine prescriptions solve to the entered model's optimum,
and cut/fill/course/cost/coverage results match exactly after project serialization/reopening.
This does not establish station-spacing convergence or survey accuracy.

The drainage journey checks **17 roads across all nine scenarios**: catchment cell-area
conservation, disjoint watershed areas, source resolution, evidence roundtrip, changed-input
staleness and regional-terrain recomputation. See the
[drainage check record](drainage-catchments-check-2026-10-30.md).

## Browser and mobile verification

The new touch workflows exercise actual rendered controls, source/layer state and downloaded
files. They cover 390×844, 320×568, short landscape 667×375 or 844×320/390, plus desktop where
appropriate. They check vertical profile independence, shared/independent engineering, curve
criteria, crossing classes, profile rules, section assemblies/preparation, material constraints,
catchments, terrain mosaics/backgrounds, survey books, configured drawings, reopening and
containment. The existing responsive suite covers fourteen viewport dimensions.

Tests use valid empty basemap styles where deterministic rendering is needed. Actual terrain
imports and calculations remain active, and map assertions inspect rendered/source state rather
than trusting descriptive sidebar text. The all-scenario mobile journey loads each library
scenario through the UI and checks panes, controls, project exports and preservation across
phone/short-landscape sizes. Mobile means Chromium touch emulation, not physical handset tests.

The final source passes **699 forestry unit tests** and **2,683 repository-wide unit tests**,
with one optional native-corridor test skipped. The complete repository run uses the normal
synced/generated snapshots from the pinned submodules; no scraper source or snapshot was changed.
`tsc -b`, repository ESLint and the package production build pass. ESLint retains 61 existing
warnings outside this work, and the build retains its large-chunk warnings.

Across the final verification batches, **94 unique Chromium browser cases passed** and
**14 opt-in cases were skipped** because their separate imported-area/options fixtures were not
configured. There are no unresolved failed cases. Repeated focused runs are counted once per
scenario/test, not as additional coverage. All nine real-source library scenarios passed at
390×844, 320×568 and 667×375, with project preservation and matching selected/displayed panes.
The new joint-refinement journey actually adopted a cheaper road, retained its original,
preserved endpoints/settings, and reopened the edited result at 320 px.

Verification used fixed production previews and one browser worker with software graphics.
An interrupted parallel attempt is excluded. Existing tests were corrected to read full numeric
costs, test hidden-label visibility, and compare persisted pane fractions at their documented
precision. The terrain pixel check retains exact restored pixels/dimensions; a test-only canvas
readback hint prevents Chromium changing raster backends between repeated pixel reads. Large
image captures have explicit time allowances; calculation and geometry assertions are retained.

## Reproduce

```sh
npm ci
npm run toolkit:build
npx vitest run src/pages/dev-forestry-roads --maxWorkers=2 --testTimeout=30000
# Repository-wide checks also require the normal synced/generated data from pinned submodules:
# npx vitest run --maxWorkers=2 --testTimeout=30000
npx tsc -b
npx eslint src/pages/DevForestryRoads.tsx src/pages/dev-forestry-roads
npx vite build

node --use-env-proxy --import tsx scripts/forestry/check-reference-scenarios.ts
node --use-env-proxy --import tsx scripts/forestry/check-road-drainage-scenarios.ts

# Against a running built preview, avoiding source-reload interference:
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42174 PGMAPS_ROAD_REFERENCE_LIVE=1 \
  npx playwright test 'forestry-road-' --project=chromium --workers=1
```

Optional live/import journeys have separate environment prerequisites documented beside their
tests. A skipped optional journey is not evidence of a passed workflow. Do not count repeated
focused and aggregate runs as additional independent test cases.

## Remaining boundaries

Native RoadEng/DWG compatibility cannot be implemented or verified from installer names and
screenshots; a documented file specification and receiving-software validation are still needed.
Open formats provide the implemented handoff.

All solvers retain explicit operation/memory limits. Economic material-flow optimality concerns
the entered bounded model; nonlinear/loading-step tariffs use the bounded general solver, and
joint road refinement is local rather than a proof over every possible road/pit/haul circuit.
Construction scheduling, structural wall/bridge analysis, geotechnical inference, hydraulic
approval and cable mechanics remain separate from the demonstrated reference workflows.
