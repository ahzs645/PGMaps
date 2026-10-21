# Forestry road design workspace

`/dev/forestry/road-design` is the road-planning workspace in the forestry toolkit.
`/dev/forestry/roads` is its route alias. The layout follows the connected-view
pattern used by the water-temperature workspace: a plan, longitudinal profile,
cross-section, terrain preview, quantity/mass chart and station schedule operate
on the same selected alignment and chainage. This is preliminary planning and
geometric design, not a certified construction or cable-logging design system.

## Reference-to-feature mapping

The implementation was informed by the user-supplied material below. PDF page
numbers are the actual PDF page index. The 2019 PDF has different printed slide
numbers. These are workflow references, not specifications for proprietary
RoadEng or Forsite algorithms. No copyrighted screenshots, slide decks or
vendor source code are included in this repository.

| Reference                                                                                                  | What it demonstrates                                                                                                                                | Implementation relationship                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-01-21-FPBC-s-Innovation-Forest-Management.pdf`, p45                                                  | Roads/grades/crossings, skid trails, landings, timber profiles, streams; ArcPro and RoadEng examples                                                | Shared road plan/profile/section; editable geometry; context crossing review                                                                                         |
| Same, p46                                                                                                  | DEM-sampled D-line with yarder/tailhold heights and offsets, deflection assumption                                                                  | Separate geometric D-line and terrain-clearance profile                                                                                                              |
| Same, pp34–38                                                                                              | Point clouds, bare-earth DTM, hillshade/contours, slope/aspect, drainage/wetness                                                                    | Distinguish source terrain from visual layers and derived hydrology                                                                                                  |
| Same, pp43–44; screenshot 9:42:01 PM                                                                       | Virtual cruising and individual-tree/species/volume summaries                                                                                       | These remain separate forestry inventory tools; a terrain DTM cannot supply those attributes                                                                         |
| `Craig-Robinson-LiDARForestOpertations-FPICIF-2019_v22-compressed.pdf`, pp56–59 (printed slides 66, 68–70) | Slope tools, stream profiles, live road-pegging grades and lengths, completed route profile                                                         | Terrain/stream transects, horizontal editing, route/segment grade and distance, ground profile                                                                       |
| Screenshot 9:41:19 PM                                                                                      | Connected Section/Profile/Plan, selected station, ditch/culvert annotation, template/material bands, mass haul                                      | Connected chainage, cut/fill sections, widening assignments and mass balance; material horizons/culvert sizing are not inferred                                      |
| Screenshots 9:46:12–9:46:45 PM                                                                             | Road, urban/rural and landing cross-section templates                                                                                               | Parameterized road template, independent left/right widths and landing/turnout ranges                                                                                |
| Screenshots 9:48:17 and 9:48:24 PM                                                                         | Pegging layout: Section, Profile, Data and Plan with a shared cursor and grade annotation                                                           | Connected engineering workspace, plan edits and station navigation                                                                                                   |
| `image(20261021-050719).png`                                                                               | Manual/optimized alternatives, material layers, mass-haul and cost breakdown                                                                        | Manual alternatives, a separate bounded terrain-cost route suggestion, and explicit unit-rate scenario costs; no proprietary optimizer or unsupplied material strata |
| `Pasted text(20261021-051007).txt`, RoadEng “Forest Road Planning Basics” webinar transcript               | Crop/thin LiDAR; landing/D-line exploration; peg horizontal route; design vertical grade; widen by station; duplicate/spur; refine corridor terrain | Workflow ordering, separate horizontal/vertical controls, turnout/landing semantics and terrain provenance                                                           |

The transcript's example turnout reaches 6 m of extra width on the left from
stations 210 to 240 m, with transitions over 200–210 m and 240–250 m. In this
workspace's range convention that is a start of 200 m, end of 250 m and 10 m
taper. Its landing uses a left-only template
from approximately station 660 m to the road end. It explicitly distinguishes a
simple deflection picture from a cable tension/load calculation. It also
explains why preserving full point density in a road corridor can be useful
while thinning the surrounding visualization. Those examples are not mandatory
road-design criteria or universally appropriate LiDAR processing parameters.

## Architecture and ownership

- `src/pages/dev-forestry-roads/types.ts` is the project/model contract.
- `engine.ts` contains deterministic geometry, profile, section, quantity,
  intersection and geometric cable calculations. It accepts any
  `ElevationSource`, and has no DOM or network dependency.
- `terrain.ts` adapts the synthetic training terrain, published native 1 m
  LiDAR DTM, imported GeoTIFF and coarse regional DEM. It carries source
  resolution, horizontal CRS, vertical reference and checksum.
- `routing.ts` provides deterministic, bounded terrain-cost A\* route
  assistance. Its inputs and returned geometry are separate from the designed
  vertical profile and earthwork-cost calculation.
- `terrainDisplay.ts` makes bounded hillshade, slope, elevation and contour
  previews from the selected source; those display products never replace the
  terrain sampler used for calculations.
- `project.ts` validates versioned project files, imports WGS84 line/polygon
  context, and exports projects, GeoJSON, station CSV and printable HTML.
- `Charts.tsx` and `TerrainPreview.tsx` visualize the shared model. The selected
  station belongs to the host workspace; a chart does not maintain its own
  independent chainage.
- No new server, raw-LiDAR processing service or per-user virtual machine is
  required. Heavy LiDAR processing remains in the existing `scripts/lidar/`
  pipeline; road geometry operates on its bounded published terrain product.

## Terrain choices

### Offline training hillside

The optional training example (`?example=training`) is explicitly synthetic,
located near Prince George only for map context. Its analytical terrain needs
no network request; the basemap can still request map resources. A fresh normal
session loads the published real LiDAR terrain; saved projects restore their
own source. The analytic hillside has a slope, drainage depression and bounded
footprint. Both route alternatives, the synthetic stream/review area,
landing/turnout, D-line and design grades are example inputs. They are not
surveyed or optimized roads. A basemap underneath the example does not make
its terrain real. The synthetic function reports missing data outside its
recorded demonstration extent.

The initial vertical controls sample the terrain at a few stations to provide
an editable starting grade, then remain independent of subsequent plan and
terrain changes. This initialization is not an earthwork or safety optimizer.

### Published BC LiDAR

The real-data option reads the same published products as `/dev/lidar`:

- Base: <https://pgmaps.ahmadjalil.com/data/lidar-analysis/bc-093g086/>
- Terrain: `dtm-1m.tif`, native 1 m, EPSG:3157 (NAD83(CSRS) / UTM zone 10N).
- Vertical reference: CGVD2013 (CGG2013), EPSG:6647, metres.
- Source LAZ SHA-256:
  `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`.
- The loader checks the source hash in `summary.json`, reads the published
  terrain checksum from `checksums.json`, and delegates GeoTIFF SHA-256 and
  1 m north-up/CRS checks to `dev-lidar/sourceGrids.ts`.
- `loadTerrainMetadata()` reopens a saved remote project against its recorded
  terrain checksum. It does not quietly replace the saved terrain with a
  newly published product. A mismatch is an error requiring explicit review.
- The initial real-data line is a draft across the tile to make editing and
  viewing possible immediately. It is labelled as needing review; it is not
  an existing road, a field traverse or a recommended route.

The DTM methodology, ground-support limits, source audit and accuracy caveats
remain documented in [LiDAR viewer](lidar-viewer.md). The road model reads the
source DTM rather than the 3 m Web Mercator display/height grid or MapLibre's
LOD-dependent terrain. The pinned EPSG:3157 transformation is reused so samples
agree with the existing LiDAR analysis. Bilinear interpolation references cell
centres; any missing neighbour leaves the sample missing. Interpolation does
not add measured resolution or establish survey accuracy.

### Imported GeoTIFF

Import requires a north-up, single-band bare-earth elevation raster and a
user-entered vertical reference. Preserve native cell values and no-data. Do
not treat a DSM/canopy-height surface as bare-earth ground. The application
cannot establish from pixel values alone that the submitted raster represents
bare earth; the source description matters.

Supported horizontal systems are WGS84 geographic, Web Mercator, BC Albers,
NAD83/WGS84 UTM zones 7–11, and NAD83(CSRS) / UTM 10N (EPSG:3157). Unsupported or
rotated grids and declared non-metre vertical/projected units are rejected.
Cell centres respect GeoTIFF PixelIsArea/PixelIsPoint metadata. The import
limits are 64 MB and 4,194,304 native cells; users must crop larger rasters
instead of receiving silently downsampled data.

An imported raster is embedded in the editable project JSON so it can be
reopened without a network request. Local raster projects use compact JSON to
avoid indentation multiplying raster file size. A SHA-256 records the original
GeoTIFF bytes; embedded values and geometry are validated on project import.
The stored checksum identifies the source file, not a newly created GeoTIFF.

### Regional DEM

Regional Terrarium terrain is a coarse screening fallback, not a LiDAR
substitute. The loader uses the existing DEM loader at zoom 12, limits a request
to 64 tiles, and preserves failed/missing tiles as no-data. The displayed
metres are tile sample spacing at the extent's latitude; original source
resolution may be coarser. Vertical datum and construction accuracy remain
unverified. A saved regional project does not embed the downloaded tile mosaic
and needs its alignment extent reloaded in a new session.

The terrain-type label must accompany results. A failed terrain load does not
activate the requested source. The current source, or the explicitly labelled
synthetic startup example, remains visible with an error. Dismissing a failed
startup/restore error must not enable an autosave that overwrites the saved
project. Synthetic or regional ground must never appear under a LiDAR label.

## Terrain display and connected views

The plan's hillshade, elevation colours, slope colours and contours come from
the selected source, including an imported DEM. The plan currently samples a
preview grid with a maximum dimension of 192 cells; the display helper accepts
32–384. The aspect ratio determines the other dimension. Its displayed sampling
distance therefore varies with the source extent and is usually coarser than
the native 1 m LiDAR grid. Hillshade and slope are calculated from neighbouring
preview samples. Slope colours use **degrees**; road grades and route-search
grade limits use **percent**.

Contours start at a **1 m vertical interval**. Marching squares interpolates
the preview samples, resolves saddle cells and joins shared segment endpoints.
The display counts the required segments before creating geometry. If the
60,000-segment budget would be exceeded, the interval doubles to 2 m, 4 m and
so on until the layer fits. The returned interval appears in the plan overlay;
the code does not truncate a dense layer while continuing to call it “1 m”.
Every fifth contour interval is marked as an index contour in the layer data.

Contour interval, display sample spacing and native source resolution are
different quantities. A 1 m contour interval does not imply 1 m horizontal
display resolution, centimetre height accuracy or a surveyed surface. Missing
preview samples remain transparent, and contour cells with missing corners are
omitted. Display sampling can still miss small source features or gaps between
its samples. Calculated station elevations, sections and routing checks query
the native terrain adapter directly; they do not read a contour, rendered
image, 3D mesh or MapLibre terrain LOD.

The 3D view is a separate display mesh: 30 cells across each dimension, with a
bounded selection of road stations for rendering. Orbit and follow-station
modes, camera rotation and vertical exaggeration change the presentation only.
The follow window spans 240 m around the selected station. Neither the mesh nor
vertical exaggeration changes profile elevations or quantities. Plan, profile,
section, mass curve and station schedule share the selected horizontal chainage.

## Geometry and calculations

### Horizontal alignment and chainage

Horizontal controls are WGS84 longitude/latitude. A local spherical
azimuthal-equidistant metric frame supplies plan geometry. Chainage represents
horizontal distance, not slope length.
Interior PIs may carry circular-curve radii. Tangents and circular fillets are
used where they fit. A radius that cannot fit its neighbouring tangents or
would overlap an adjacent curve leaves a sharp PI and an explicit warning;
the model must not silently adjust the requested radius.

Station positions and arc lengths use the fitted geometry. Curved pieces are
also represented by chords no longer than 5 m and no wider than 2 degrees of
arc for exported centreline display and context-intersection searches. Those
intersection stations are geometric approximations at that chord tolerance.
The selected-road map can additionally join adjacent analysis stations for
grade colouring; its drawn chords are not a replacement for the curve model.

Imported GeoJSON keeps the input vertices and initially assigns zero radii.
A third GeoJSON coordinate is not taken as a ground observation or invented
vertical grade. Explicit non-WGS84 CRS declarations are rejected instead of
being treated as longitude/latitude.

### Vertical alignment

Independent PVIs contain station, formation-centre elevation and optional
vertical-curve length. Tangent grade is 100 times elevation change divided by
horizontal station difference. Interior vertical curves are parabolic where
they fit. Overlapping/unfit curves retain the tangents and report the issue.
A PVI beyond the shortened route end remains visible as a warning; the model
does not silently discard a previously entered design control.

One PVI defines a constant elevation. With two or more PVIs, the first and last
tangent grades extend outside the control-station range, so endpoint controls
should be checked after a route is lengthened or shortened. Horizontal edits
do not silently move the vertical controls or refit their elevations to ground.

A road with no vertical controls explicitly uses terrain-following formation.
That behaviour is called out in the results; it must not be described as a
completed designed grade. Separate `profiles` in the project represent ground
transects/stream profiles. They are not added to the engineering-alignment list,
and their GeoJSON role is `terrain-profile`.

### Cross-section and widening

Cross-section offsets are negative to the left and positive to the right when
looking along increasing chainage. A positive crown crossfall drains away from
the formation centre. Left/right running widths are separate. Cut/fill batters
are horizontal:vertical ratios, and the V-ditch is added only on a cut side.
Daylight is found against the terrain source; unresolved or out-of-footprint
daylight prevents a complete section.

Landing and turnout ranges can affect left, right or both sides. Their extra
width tapers in/out; overlapping ranges use the maximum extra width per side
rather than stacking widths. Added landing width is unsurfaced; added turnout
width contributes to surfacing. The base road is still surfaced. A separate
3D graded landing pad or an arbitrary road-template authoring language is not
part of this implementation.

### Quantities, mass and cost

Cut/fill cross-sectional areas integrate the difference between terrain and
formation, separating intervals that cross from cut to fill. Interval volumes
use average end areas. `surfaceDepth` calculates additional surfacing volume;
it does not lower the formation or imply a subsurface material layer.

Only intervals bounded by complete sections enter quantity and cost subtotals.
Coverage is the supported interval length divided by route length. Missing
intervals cannot be bridged by an invented continuous mass curve: accumulation
stops at the first gap. The reported balance is

`cut volume × reusable-cut factor − fill volume`.

Unit-rate scenario cost includes cut, fill, surfacing and cleared footprint.
The cost expression is cut m³ × cut CAD/m³ + fill m³ × fill CAD/m³ + surfacing
m³ × surfacing CAD/m³ + clearing m² × clearing CAD/m². Clearing is the sampled
daylight-to-daylight footprint; no extra clearing buffer is assumed.
The default rates are illustrative inputs, not current market quotes. There
is no haul optimizer, geological stratum classification, cut-material
suitability test, mobilization or structure estimate. Thresholds such as
maximum grade and minimum radius are editable planning assumptions, not a
claim of compliance with a particular BC road class.

### Deterministic terrain-cost route assistance

“Suggest terrain-cost alternative” runs `A*` on an eight-neighbour grid
between the current road's endpoints. It is deterministic route assistance,
not an AI model or a call to an external optimizer. It creates an editable
alternative and preserves the original alignment. It does not design PVIs,
fit road curves, minimize earthwork dollars or reproduce RoadEng's optimizer.

The search uses horizontal distance with an additional penalty for sampled
ground grade. A stream-segment intersection adds a fixed relative penalty
equivalent to 80 horizontal metres; this is a routing preference, not a bridge
or culvert price. Missing terrain and avoidance-polygon boundaries block an
edge. Endpoints inside avoidance polygons are rejected, with polygon holes
respected. The entered maximum grade constrains sampled **ground** slope;
it does not prove that a designed road can be constructed at that grade.

Candidate grid edges are sampled at intervals no greater than 5 m during the
search. Before returning a route, every chosen segment is checked again at
intervals no greater than 1 m. A failing segment is excluded and the search
can retry, up to four attempts. Returned vertices are retained without
unconstrained smoothing, which could otherwise cross an exclusion or change
the checked grade. All terrain reads still use the selected source: checking a
coarse regional DEM at 1 m spacing does not turn it into 1 m terrain.

The search is local and bounded. Endpoints must be at least 2 m and no more
than 15 km apart. The search margin is 35% of the direct separation, clamped
to 80–1,000 m; the grid has approximately 96 nodes per axis at most and at
least 2 m spacing. Route assistance accepts grade limits above 0% and at most
60%. Failure means no verified route was returned within these constraints
and budgets, not that no field-designed road is possible. The resulting
sharp PIs, grade, earthwork sections and crossing locations still need review.

### Context and D-lines

Stream/existing-road crossings are geometric intersections with supplied
lines. Review/harvest polygons are supplied context; avoidance warnings test
whether the centreline enters an avoidance polygon, respecting holes. They do
not compute the affected road earthwork footprint or imply that all constraints
have been discovered. No imported streams does not mean no streams exist.

D-lines use terrain at the supports plus entered yarder/tailhold heights and
an assumed parabolic sag. Deflection is a percentage of horizontal span. The
entered sag is the midpoint drop below the straight support-to-support line,
not a cable length or a tension parameter. The clearance profile is sampled;
if any sample is unsupported, the minimum
clearance is unavailable. The result is a geometric screen, not a cable force,
payload, rigging, anchor or operating-safety calculation. It does not estimate
crown clearance unless a suitable separate surface is explicitly used.

## Scope boundaries

The following capabilities appear in the references or would require more
inputs, but are not implemented by this workspace:

- Browser ingestion/classification of LAS/LAZ point clouds, new ground TIN
  generation, raw-point thinning or a full-density corridor reprocessing job.
  Use the existing LiDAR pipeline or an external GIS to prepare a bounded
  bare-earth GeoTIFF; the workspace preserves that raster's native cells.
- Geological/material horizons, rock and soil classification, material
  suitability, optimized borrow/waste allocation, haul scheduling and an
  optimizer for vertical alignment or total construction cost.
- Arbitrary template libraries, a separately graded 3D landing pad,
  superelevation/runoff design, spirals, intersection design and a connected
  road-network topology or automatic spur snapping. A spur can be stored as
  another manually connected alignment.
- DEM-derived stream extraction, flow accumulation, wetness, watershed
  delineation or an aspect layer in this road page. Supplied streams and
  polygons provide the crossing/constraint context. Culvert/bridge capacity,
  drainage structure dimensions and geotechnical stability are not solved.
- Radial landing-to-tailhold coverage exploration, safe operating envelopes,
  cable force/tension, equipment/payload selection and anchor capacity.
  The implemented D-line is one span with entered endpoint heights and sag.
- Tree/species/DBH, merchantable timber volume, piece size or inventory recovery
  from bare-earth terrain. These require their own inventory data and tools.
- Native RoadEng/CAD project output, a survey stakeout package or dedicated
  per-chart PNG export. The supported outputs below are the interoperability
  contract; the printable report supports the browser's Print / Save as PDF.

## Computation and file budgets

- At most 20 alignments and 2,000 horizontal control points per project;
  individual alignments at most 100 km.
- At most 500 vertical controls and 200 widening ranges per alignment.
- At most 20 ground profiles and 2,000 total profile vertices.
- At most 500 context features / 50,000 vertices; 2,000 context intersections
  per road analysis.
- Curved centreline tessellation: at most 30,000 pieces; context intersection
  search: at most 5,000,000 candidate segment checks per analysis.
- Requested station spacing: 2–100 m. The 3,000-station limit includes curve,
  widening and crossing events. Spacing increases with a visible warning if
  needed; too many mandatory events requires splitting the road.
- Cross-section half-width: 5–100 m. Sampling pitch is the larger of 0.25 m
  and full transect width / 220; exact template/daylight breakpoints are added.
- Horizontal radii: 0–10,000 m. Vertical elevations: −12,000–12,000 m and
  curve lengths: 0–10,000 m. Distinct vertical stations must be at least
  1 mm apart. Imported/project latitude must be strictly between −85° and 85°.
- At most 100 D-lines. A calculated span is 0.01 m–10 km, with 20–1,000
  sample intervals and an even count that retains the midpoint. Support
  heights are 0–100 m and supported sag is 0–30% of horizontal span.
- Route search: at most 20,000 relevant context vertices, 450,000 terrain
  samples and 2,000,000 geometry checks. Each attempt visits at most 10,000
  grid nodes; four attempts cap total visits at 40,000. Budget exhaustion
  returns an error rather than an unchecked shortcut.
- GeoTIFF: 64 MB / 4,194,304 cells. Project JSON: 120 MB. Large embedded
  rasters may exceed browser storage quotas even though project-file export
  remains available.

These bounds constrain browser work. They do not certify that a particular
station interval captures every terrain feature; coarser source terrain and
sparse stations can miss small ditches, scarps or sharp cut/fill transitions.

## Exports and restoration

- Project JSON: `pgmaps-road-project-v1`, full editable alignment/vertical/
  widening/template/settings/context/cable/profile state and terrain provenance.
- GeoJSON: WGS84 linework, control/design properties, crossings and context;
  design elevations retain their explicitly named vertical reference in
  properties. Ordinary line geometry is not silently given ellipsoidal Z.
- Station CSV: numeric chainage, ground/design heights, grades, areas/volumes,
  mass, completeness/flags and source metadata. Unknown values stay blank.
  Text fields are quoted and protected against spreadsheet formula injection.
- Printable HTML: selected road summary, profile, full station schedule,
  crossing review, source provenance and assumptions. User text is escaped;
  the document has no scripts or network resources.

The UI can import line/context GeoJSON and zipped shapefiles. Shapefile
conversion produces geographic GeoJSON before the same geometry validation;
check that the source's projection metadata is present and correct. Project
JSON is the editable round-trip format. Importing an exported road GeoJSON as
linework preserves its spatial vertices and names, but does not reconstruct
independent PVIs, templates, widenings or every project field from those
properties.

Repeated imported line/context IDs must be renamed when merging into an
existing project. Duplicate IDs, nonfinite data, invalid ranges, conflicting
CRS/raster metadata and unsupported schemas are rejected. A failed restore
must not be treated as a successful loading of a different terrain.

Autosave uses browser-local IndexedDB, validates before replacing the saved
project, and retains the last valid save when an intermediate edit is invalid.
Training-mode saves use a separate key from the normal current project. A
failed initial restore keeps normal autosave disabled until an explicit
successful recovery/source action. Undo/redo history is in-memory; downloading
the project remains the portable way to preserve work across browsers/devices.

## Validation

Meaningful unit checks cover analytical flat/cut/fill sections, slopes/ditches,
short final intervals, circular and vertical curves, side-specific tapers,
crossings, polygon holes, missing coverage and mass gaps. Actual encoded
GeoTIFF fixtures check PixelIsArea/PixelIsPoint centres, known bilinear values,
edge round-trip tolerance, no-data and strict recorded-hash restoration.
Project checks cover round-trip, finite/range/CRS validation, unchanged
GeoJSON vertices, independent profiles, no-data persistence, CSV injection and
HTML escaping. Route tests exercise determinism, endpoints, grades,
exclusions, gaps and bounded failure.

Run the relevant local checks with:

```sh
npx vitest run src/pages/dev-forestry-roads
npx tsc -b
npx eslint src/pages/DevForestryRoads.tsx src/pages/dev-forestry-roads scripts/forestry/check-road-terrain.ts
```

The browser suite checks rendered MapLibre sources/layers and real pointer
interactions, linked station selection, pegging, vertical edits, one-sided
widening, alternatives/exports, ground-only profiles, phone/fullscreen
layouts and protection of a saved project after a failed terrain restore.
Most workflows use explicitly synthetic training terrain and a stub basemap;
they do not substitute for a real-source check. Run from the repository root:

```sh
npm run toolkit:build
npx playwright install chromium
npm run e2e -- tests/e2e/forestry-road-design.spec.ts --project=chromium --workers=1
```

Playwright starts its configured local Vite server. The repository's optional
`PGMAPS_E2E_BASE_URL` and `PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` settings allow an
already running deployment/server and a supplied Chromium executable. Do not
change data products or weaken rendering assertions to make a browser run pass.

The public-source smoke check downloads and verifies the existing DTM, reads
known route points, verifies out-of-footprint no-data, runs actual sections and
quantities, and checks same-process restored-sampler equivalence. The raster
unit tests separately exercise a fresh recorded-hash fetch and mismatched
bytes. The smoke script writes no generated data:

```sh
node --import tsx scripts/forestry/check-road-terrain.ts
# When Node supports this flag and the environment requires its configured proxy:
node --use-env-proxy --import tsx scripts/forestry/check-road-terrain.ts
```

For a live visual check, open the normal route without `?example=training`,
confirm the real-source label and finite elevations, then inspect the plan,
profile, a complete section and a missing/unresolved section. A successful
fetch, unit suite or synthetic browser workflow alone does not prove the live
terrain and every connected pane rendered correctly. Keep actual run outcomes
with the change/review record; these commands describe verification rather than
claiming an unperformed test run.
