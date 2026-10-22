# Forestry road design workspace

`/dev/forestry/road-design` is the road-planning workspace in the forestry toolkit.
`/dev/forestry/roads` is its route alias. The layout follows the connected-view
pattern used by the water-temperature workspace: a plan, longitudinal profile,
cross-section, terrain preview, quantity/mass chart and station schedule operate
on the same selected alignment and chainage. This is preliminary planning and
geometric design, not a certified construction or cable-logging design system.

See the [reference matrix](forestry-road-reference-matrix.md) for the functional
comparison and completed checks, and the [workspace gallery](forestry-road-gallery.md)
for actual native-terrain views with their entered engineering assumptions.

## Reference-to-feature mapping

The implementation was informed by the user-supplied material below. PDF page
numbers are the actual PDF page index. The 2019 PDF has different printed slide
numbers. These are workflow references, not specifications for proprietary
RoadEng or Forsite algorithms. No copyrighted screenshots, slide decks or
vendor source code are included in this repository.

| Reference                                                                                                  | What it demonstrates                                                                                                                                | Implementation relationship                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-01-21-FPBC-s-Innovation-Forest-Management.pdf`, p45                                                  | Roads/grades/crossings, skid trails, landings, timber profiles, streams; ArcPro and RoadEng examples                                                | Shared road plan/profile/section; editable geometry; context crossing review                                                                                                         |
| Same, p46                                                                                                  | DEM-sampled D-line with yarder/tailhold heights and offsets, deflection assumption                                                                  | Separate geometric D-line and terrain-clearance profile                                                                                                                              |
| Same, pp34–38                                                                                              | Point clouds, bare-earth DTM, hillshade/contours, slope/aspect, drainage/wetness                                                                    | Distinguish source terrain from visual layers and derived hydrology                                                                                                                  |
| Same, pp43–44; screenshot 9:42:01 PM                                                                       | Virtual cruising and individual-tree/species/volume summaries                                                                                       | These remain separate forestry inventory tools; a terrain DTM cannot supply those attributes                                                                                         |
| `Craig-Robinson-LiDARForestOpertations-FPICIF-2019_v22-compressed.pdf`, pp56–59 (printed slides 66, 68–70) | Slope tools, stream profiles, live road-pegging grades and lengths, completed route profile                                                         | Terrain/stream transects, horizontal editing, route/segment grade and distance, ground profile                                                                                       |
| Screenshot 9:41:19 PM                                                                                      | Connected Section/Profile/Plan, selected station, ditch/culvert annotation, template/material bands, mass haul                                      | Connected chainage, template/material bands, entered culvert geometry, cut/fill sections, material-aware mass and cost; geological layers and hydraulic capacity are not inferred    |
| Screenshots 9:46:12–9:46:45 PM                                                                             | Road, urban/rural and landing cross-section templates                                                                                               | Named reusable template library, independent left/right components, station assignments/transitions, four-condition previews, landing/turnout ranges                                 |
| Screenshots 9:48:17 and 9:48:24 PM                                                                         | Pegging layout: Section, Profile, Data and Plan with a shared cursor and grade annotation                                                           | Connected engineering workspace, plan edits and station navigation                                                                                                                   |
| `image(20261021-050719).png`                                                                               | Manual/optimized alternatives, material layers, mass-haul and cost breakdown                                                                        | Editable alternatives, bounded terrain-cost route assistance, supplied material horizons, deterministic haul allocation and detailed scenario costs; no proprietary/global optimizer |
| `Pasted text(20261021-051007).txt`, RoadEng “Forest Road Planning Basics” webinar transcript               | Crop/thin LiDAR; landing/D-line exploration; peg horizontal route; design vertical grade; widen by station; duplicate/spur; refine corridor terrain | Workflow ordering, separate horizontal/vertical controls, turnout/landing semantics and terrain provenance                                                                           |

The supplied [RoadEng v11 resource-road tutorial](https://drive.google.com/file/d/1sMul7UhenA3b7ZXph6m6tz6UENylQQ33/view),
document version 20 February 2025, is an additional primary workflow reference.
Chapter 11 (pp89–98) demonstrates mass/haul reporting and pit inputs; chapter 13
(pp105–115) separates ground materials and stripping; chapters 14–16 (pp116–142)
cover named templates, station overrides and reporting; chapter 17 (pp143–147)
shows drainage-structure placement and section/profile inspection. This workspace
implements its own documented calculations below. Its deterministic allocation
is not Softree Optimal/OptiHaul, and its cut-only stripping classification does
not reproduce the tutorial's removal of original ground beneath fill.

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

- `src/pages/dev-forestry-roads/types.ts` and `engineeringTypes.ts` are the
  project/model contracts. Optional per-alignment engineering preserves older
  `pgmaps-road-project-v1` files without fabricating materials or structures.
- `engine.ts` contains deterministic geometry, profile, section, quantity,
  intersection and geometric cable calculations. It accepts any
  `ElevationSource`, and has no DOM or network dependency.
- `templates.ts` resolves station/side assignments and validates bounded
  engineering inputs. `engineering.ts` intersects material horizons with
  excavated sections, allocates supported haul movements, samples culverts and
  produces material-aware mass and itemized costs. Both are pure calculations;
  compiled road geometry is supplied by the engine rather than reconstructed
  from rendered map lines.
- `cableGeometry.ts` resolves support offsets and yarder/tailhold orientation
  consistently for the cable engine, map and exports.
- `terrain.ts` adapts the synthetic training terrain, published native 1 m
  LiDAR DTM, imported GeoTIFF and coarse regional DEM. It carries source
  resolution, horizontal CRS, vertical reference and checksum.
- `routing.ts` provides deterministic, bounded terrain-cost A\* route
  assistance. Its inputs and returned geometry are separate from the designed
  vertical profile and earthwork-cost calculation.
- `terrainDisplay.ts` makes bounded hillshade, slope, aspect, elevation and contour
  previews from the selected source; those display products never replace the
  terrain sampler used for calculations.
- `project.ts` and `engineeringProject.ts` validate versioned project files,
  portable template/material libraries and WGS84 line/polygon context. Outputs
  include projects, libraries, GeoJSON, station/engineering CSV and printable HTML.
- `profileOutputs.ts` derives D-line measurements and CSV/HTML outputs from the
  current calculated cable profile, and exports selected-section coordinates,
  levels and point codes. `sectionGeometry.ts` supplies the same semantic points
  to these exports and the linked views; neither reads rendered map elevations.
- `EngineeringControls.tsx` stages numeric template edits separately from saved
  definitions. Preview, Save and Discard are explicit operations; the host shares
  the resulting preview analysis across its connected views.
- `Charts.tsx` and `TerrainPreview.tsx` visualize the shared model. The selected
  station belongs to the host workspace; a chart does not maintain its own
  independent chainage. `chartScale.ts` picks the round axis ticks.
  `RoadPaneLayout.tsx` arranges the connected views for each layout.
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

The plan's hillshade, elevation colours, slope/aspect colours and contours come from
the selected source, including an imported DEM. The plan currently samples a
preview grid with a maximum dimension of 192 cells; the display helper accepts
32–384. The aspect ratio determines the other dimension. Its displayed sampling
distance therefore varies with the source extent and is usually coarser than
the native 1 m LiDAR grid. Hillshade, slope and aspect are calculated from neighbouring
preview samples. Slope colours use **degrees**; road grades and route-search
grade limits use **percent**.

Aspect is the **downslope compass bearing**, clockwise from geographic north:
0°/360° north, 90° east, 180° south and 270° west. Its cyclic colour legend uses
the same east/north gradients as hillshade and slope, without additional terrain
queries. Flat terrain is neutral grey; missing centre or required neighbour
samples remain transparent. Context toggles hide actual loaded feature kinds in
the map only; they do not remove constraints from calculations or project data.

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

## Workspace layout and readouts

The header holds the **view layout** picker (the shared `AppSelect` combobox): the
linked overview (plan | profile / detail) or the four-view plan · profile · section ·
data and pegging layouts ((plan / data) | (profile / detail)). The tree keeps the same
shape in every layout, so switching layouts keeps the plan's map mounted.

Every pane boundary is a `ResizableSplit` separator (`src/components/ui/resizable-split.tsx`):
drag it, or focus it and use the arrow keys (Shift for larger steps); double-click
restores the default. The controls sidebar and the connected views share one more
boundary. Each layout stores its own sizes in `localStorage` under
`pgmaps-road-panes:<layout>:<split>` (`pgmaps-road-panes:sidebar` for the sidebar);
storage that refuses writes leaves the defaults in place. Below 1280 px the view
panes stack (below 1024 px the sidebar too), each with a handle underneath that
resizes its height, so a phone page still resizes vertically.

The profile's pan, zoom, fit and vertical-exaggeration controls and its visible
station range float in the top-right corner of the chart; the top-left carries a
slope-profile summary (length, elevation difference, maximum and minimum grade,
elevation range). Station ticks fall on round chainages with minor ticks, the
elevation axis is titled on the left, PVIs carry a leader and rotated station
callout, tangent grades are labelled along the drawn line, curves read
`VC <length> K=<k>`, and the selected station is labelled at the top of its cursor.

The section is labelled with its station above the centreline and `◂ L` / `R ▸`
in the top corners, and the axis reads “Offset (m) · looking up-station”. Under it,
a `ReadoutGrid` gives the section status block: L-Stn, centreline cut depth (Cut
Dp, ground minus formation; negative is fill), grade, ground and formation levels,
half-widths, crossfall, cut and fill batters, daylight offsets, cut and fill areas
and the template on each side. Each abbreviation has its full definition as a
hover title. Station, pegging and curve schedules use `EngineeringTable`: a
quantity and unit header, ruled columns, fixed decimals and a tinted selected
row that the station table keeps scrolled into view.

There is no footer or status row. The planning basis the footer used to state
(concept planning; the terrain's vertical reference; native DEM sampling with
missing ground left missing, or synthetic ground that is not survey data; earthworks
by average end areas; field and engineering review required for construction) is the
hover title of the terrain badge in the header, and is documented here and in
[Geometric quantities and coverage](#geometric-quantities-and-coverage). The
starting alignment on the published LiDAR tile is an editable example, not an
existing or optimized road; its name says “review required”. Action notices
(exports, optimizer results, restores) replace the header subtitle for eight
seconds in a polite live region instead of occupying a dismissible row.

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
`horizontalCurveSummary()` lists only fitted arcs, with start/end chainages,
arc length and radius. A rejected requested radius must not appear as a fitted
curve in the schedule.

Imported GeoJSON keeps the input vertices and initially assigns zero radii.
A third GeoJSON coordinate is not taken as a ground observation or invented
vertical grade. Explicit non-WGS84 CRS declarations are rejected instead of
being treated as longitude/latitude.

### Vertical alignment

Independent PVIs contain station, formation-centre elevation and optional
vertical-curve length. Tangent grade is 100 times elevation change divided by
horizontal station difference. Interior vertical curves are parabolic where
they fit. Overlapping/unfit curves retain the tangents and report the issue.
`verticalCurveSummary()` reports each requested curve with a validity flag,
incoming/outgoing grades in percent, and K in metres per percentage point of
grade change. Zero grade change has no finite K. A requested curve that fails
the fit/overlap checks is annotated as unfitted.
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

### Cross-sections, template libraries and widening

Cross-section offsets are negative to the left and positive to the right when
looking along increasing chainage. The section is drawn the same way, as road
sections conventionally are: viewed looking up-station, the road's left on the
left of the plot. The engine samples ground at `bearing + 90°` × offset, the plan
draws left half-widths and daylight at `bearing − 90°`, and each template's left
components and `side: 'left'` assignments resolve onto the negative offsets, so
left and right agree across plan, section, templates, bands and tables. The
`cross-section orientation` tests in `engine.test.ts` pin this for eastbound,
westbound and northbound roads against ground built from the travel direction
alone; the same check against the published LiDAR tile put the plan's left and
the section's negative offset within one section sample (0.15 m) of each other at
every probed station.
Formation-centre elevations are subgrade
levels. Positive crossfall falls away from the centreline; a negative side
crossfall rises away from it. Each side can independently override crossfall,
cut/fill H:V batters, ditch width/depth and surfacing depth. Omitted side values
inherit the symmetric template setting. The V-ditch is added only on a cut
side. Daylight is solved against the supplied terrain source; missing terrain
or unresolved daylight within the section width prevents a complete section.

Each alignment may store named template definitions and station-range
assignments. An assignment applies to the left, right or both sides. It can
step directly to the assigned template or interpolate every numeric component
from the base section over an entered transition distance inside each end of
the range. Transition length cannot exceed half the range. A transition returns
to the base section at the range end; it is not an automatic interpolation into
the next named template. Same-side ranges cannot overlap. Independent left and
right ranges, and ranges that touch at an endpoint, are allowed. A touching
boundary uses the assignment that starts there.

Assignment endpoints and transition breakpoints become calculation stations.
A step also receives a nearby station on the opposite side of the discontinuity,
so a short assigned section is not spread across an ordinary station interval.
The profile's template bands and the selected section use these resolved
values. Named templates have four synthetic condition previews that use the
same section engine: cut, fill, and ground rising toward either side. Those
previews do not change the project terrain or its quantities.

Numeric library edits remain an unsaved candidate until **Save template**.
**Preview at station** evaluates that candidate against the active terrain and
temporarily supplies its analysis to the linked views. **Discard changes** restores
the saved definition and closes the candidate preview. Closing a preview alone
does not persist the candidate. Assignments and library exports use saved
definitions; selecting or previewing a candidate is not an assignment.

The portable `pgmaps-road-library-v1` JSON format stores template and material
definitions. Merge preserves existing definitions/assignments and gives imported
colliding IDs distinct names. Replace swaps the definitions and clears their
station assignments/horizons. Presets are editable starting dimensions, not a
road-class standard or an inferred site-specific design.

Landing and turnout ranges add width after the station template resolves.
Their extra width tapers in/out; overlapping width overrides use the maximum
extra width per side rather than stacking widths. Added landing width is
unsurfaced; added turnout width uses that side's resolved surface depth. The
resolved road width retains its own surface depth. A wide landing template is
therefore different from an unsurfaced extra-width override: the template
replaces the selected side's base dimensions and can set its surfacing to zero.
There is no separate graded 3D landing-pad model or arbitrary component-expression
language.

### Geometric quantities and coverage

Cut/fill section areas integrate the difference between terrain and formation,
splitting intervals that cross between cut and fill. Earthwork volumes use
average end areas at the actual horizontal station separation. Surface volume
is additional material above formation; it does not lower subgrade. The
surfacing calculation integrates horizontal width times entered vertical
thickness on each side. A midpoint Simpson evaluation preserves the quadratic
product when width and depth both transition linearly.

Only intervals bounded by complete sections enter earthwork, surfacing and
clearing subtotals. Clearing is the sampled daylight-to-daylight footprint with
no assumed extra buffer. Coverage is supported interval length divided by route
length. Adding stations can discover gaps or unresolved batters that a coarser
run missed; more stations do not guarantee a larger supported quantity.

Missing intervals cannot be bridged by an invented continuous mass curve:
cumulative mass stops at the first gap. Quantities after that gap can still
contribute to covered subtotals, and their interval quantities remain available.
A numerical calculation error returns an unavailable analysis with an explicit
message, not a plausible complete road with zero quantities.

### Ground horizons and excavated materials

Ground materials contain an entered excavation rate in CAD/bank m³, reusable
fraction, and conversion factor in compacted m³ per reusable bank m³. Station
ranges assign those materials between vertical depths below original ground.
A null bottom depth extends the material below the entered finite horizons.
Two horizons cannot overlap in both station and depth. Horizon endpoints become
calculation stations. The approach-side horizon applies at the road endpoint.
These layers are user-entered assumptions or observations: the bare-earth DTM
does not identify rock, soil, organic depth or suitability.

For each complete section, layer area is the exact clipped integral of
`max(ground − formation − top depth, 0)` minus the corresponding bottom-depth
integral. This includes the intersected portions of cut batters and ditches;
it does not classify an entire footprint with a uniform rectangular depth.
Layer interval volumes use the same average-end-area method as total excavation.
Their sum, including explicit **unclassified excavation**, equals total bank cut.
Unclassified excavation uses the road's default cut rate, reusable fraction 1,
and the road's reusable-cut conversion factor. Missing sections retain null
layer areas and interval volumes, rather than zero.

For each classified interval:

- Usable compacted cut = bank cut × reusable fraction × compaction factor.
- Unusable bank cut = bank cut × (1 − reusable fraction).
- Material excavation cost = bank cut × its entered excavation rate.

A material marked as excavated stripping must have reusable fraction zero.
Its intersected cut quantity and excavation cost are reported separately, and
it is excluded from reusable mass. This is **cut-only stripping classification**:
it does not remove original ground under an embankment, deepen the construction
formation, add replacement fill, extend stripping beyond daylight, or perform
the full stripping procedure in chapter 13 of the supplied tutorial. Ordinary
unclassified cut is never relabelled as stripping.

Material-aware cumulative mass is usable compacted cut minus compacted fill.
The reported covered balance applies the same expression to supported subtotals.
When no engineering definitions are present, this reduces to the original
`cut volume × reusable-cut conversion factor − fill volume` calculation.

### Haul, borrow and waste scenarios

Haul allocation is disabled by default. Enabling it runs a deterministic
allocation scenario, not a global optimum: fill intervals are visited in
chainage order and draw from the nearest remaining reusable cut in the same
continuously supported road section. Material conversion factors are retained
for every movement. A site or source on the other side of a terrain/daylight gap
cannot supply that interval. This can produce both borrow and waste even when
the entire route's net mass balance appears favourable.

Remaining fill demand is compacted-volume borrow. Remaining reusable cut and
all nonreusable material become bank-volume waste. Available sites are considered
in order of road-chainage distance plus the entered access distance, subject to
their capacities. Borrow capacity and supply rate use compacted m³; waste
capacity and disposal rate use bank m³. A site's fixed preparation cost is
charged once when it is used. These are entered access distances and capacities,
not a surveyed access route, geometric pit-volume calculation, environmental
approval, material compatibility test or construction schedule.

The movement classes use entered free-haul and overhaul distance limits.
Distances at or below the free-haul limit incur zero additional haul cost;
those up to the overhaul limit use the overhaul rate; greater distances use
the end-haul rate. For either paid class:

`haul CAD = transported m³ × max(0, distance − free-haul distance) / 1000 × selected CAD/(m³·km)`.

The selected rate applies to all distance beyond free haul, not to a second
increment beyond the overhaul threshold. Borrow/cut-to-fill movement volume is
compacted m³; waste movement volume is bank m³. The result stores their volume
and m³·km summaries separately. Bank-waste work must not be added to a compacted
haul-work statistic without an explicit conversion basis.

Unallocated borrow/waste is reported when no reachable site capacity remains.
Its default supply/disposal unit rate is included in the scenario subtotal, but
its unknown haul distance, haul work and haul cost are excluded. The haul and
engineering results remain incomplete. Nothing silently creates an unlimited
pit, a zero-distance disposal site or a movement across missing terrain.

### Culvert inventory, geometry and cover

Culverts are explicit station-based structures, with an optional associated
stream-feature ID or a cross-drain purpose. Association records the user's
chosen crossing; it does not choose hydraulic capacity or retarget the station
when the road later changes. If the associated feature has no current road
intersection, or its nearest intersection is more than 1 m from the entered
culvert station, the structure and engineering results remain incomplete with
an association-review warning. Existing geometry, cover and cost calculations
remain available at the entered station. Multiple intersections are compared
by distance to that station; an unrelated feature cannot satisfy the association.
Entered horizontal span, diameter and skew define a centred
barrel line. Zero skew is perpendicular to the road; positive skew rotates
clockwise from the right-facing perpendicular. The left endpoint is the entered
inlet and the right endpoint is the outlet.

The along-barrel profile samples the native terrain and the road's fitted path,
vertical design and resolved crossfall. Invert level varies linearly between
entered endpoint inverts; crown level is invert plus the entered diameter.
Signed pipe grade is 100 times outlet-minus-inlet elevation divided by horizontal
span. A level or rising outlet receives a flow-direction/grade review flag.
Both inverts are required to calculate grade and cover. A single known endpoint
can remain visible while the intervening profile stays unknown.

Cover is the minimum sampled **subgrade-to-crown** separation within the road
formation. It excludes surfacing thickness and does not establish structural
cover capacity. Missing terrain anywhere along the barrel, unsupported road
formation, or unresolved centre-section daylight leaves required coverage
results unknown. A requested cover exceedance is reported alongside the actual
sampled value. Sampling does not certify the continuous minimum between points.

The required centred daylight span is
`2 × max(left daylight, right daylight) / cos(skew)`.
Using the farther side on both ends matters for asymmetric sections: the sum of
left/right offsets would not ensure a barrel centred at the road centreline
reaches both batters. This is a centre-cross-section span check; longitudinal
terrain changes, steep skewed roads, inlet/outlet headwalls and actual end
placements still require review. A culvert beyond the current route end is
excluded from geometry and cost with a warning.

Circular internal area is `π × diameter² / 4`. When both endpoint inverts are
known, actual inclined barrel length is
`sqrt(horizontal span² + invert elevation difference²)`. Internal volume is
area times that inclined length, and installation cost is inclined length times
the entered CAD/metre rate plus fixed cost. When inverts are unknown, actual
barrel length remains null; volume and cost use horizontal span provisionally,
with an explicit warning. Internal volume describes void space, not concrete,
metal or excavation quantity.
No hydraulic sizing, peak discharge, headwater/tailwater solution, erosion
protection, fish passage, bridge design or geotechnical stability is inferred.

### Itemized scenario cost

The cost report separates classified/unclassified cut, excavated stripping,
fill placement, surfacing, clearing, structures, haul, borrow supply, waste
disposal, site preparation and mobilization. Mobilization is an explicit fixed
amount. Contingency is the entered percentage of that subtotal, and total is
subtotal plus contingency. Material excavation rates replace the default cut
rate only in their assigned horizons; fill/surface/clearing retain the entered
road rates.

These are user-input scenarios, not current market quotes. Zero rates identify
unpriced work. Partial coverage, unknown structure inputs and unallocated haul
are retained in the result warnings/completeness. Editable maximum grade,
minimum radius and cover thresholds are planning assumptions, not a claim of
compliance with a particular BC road class.

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

D-lines retain their original endpoints and can move either physical support
along that original line by an entered offset. Positive offsets move inward;
negative offsets extend outward. Yarder orientation assigns the yarder and
tailhold heights to the chosen physical endpoints. Resolution happens once for
the engine, map cursor and exports; it does not mutate the original controls.
Offsets that collapse or reverse the effective span are rejected. Terrain is
sampled at the resolved supports.

The resulting support elevations and entered heights define an assumed
parabolic sag. Deflection is a percentage of the effective horizontal span. The
entered sag is the midpoint drop below the straight support-to-support line,
not a cable length or a tension parameter. The clearance profile is sampled;
if any sample is unsupported, the minimum
clearance is unavailable. The result is a geometric screen, not a cable force,
payload, rigging, anchor or operating-safety calculation. It does not estimate
crown clearance unless a suitable separate surface is explicitly used.

Radial exploration applies that same D-line model to a fixed-radius fan centred
at a selected landing station. The user enters radius, starting bearing,
clockwise sweep, angular step, yarder/tailhold heights, sag and required
clearance. Each spoke queries the active terrain source. Spokes are classified
as meeting the entered geometric clearance, conflicting with it, or unknown;
any support/interior terrain gap keeps the minimum clearance unknown. A ray's
known-ground percentage reports its actual sampled coverage.

Map spokes, the results table and a selected ray's profile/distance cursor are
connected. A selected ray becomes a persistent D-line only through explicit
adoption. Changing the landing, terrain or settings invalidates the fan. Full
circles omit a duplicate 360-degree ray; partial sweeps retain their ending
bearing. This is a fixed-radius comparison of assumed sag geometries, not an
automatic maximum-reach search, safe operating envelope, equipment selection,
cable-tension or payload solution.

## Scope boundaries

The following capabilities appear in the references or would require more
inputs, but are not implemented by this workspace:

- Browser ingestion/classification of LAS/LAZ point clouds, new ground TIN
  generation, raw-point thinning or a full-density corridor reprocessing job.
  Use the existing LiDAR pipeline or an external GIS to prepare a bounded
  bare-earth GeoTIFF; the workspace preserves that raster's native cells.
- Automatic geological inference, material testing/suitability, layer-specific
  fill requirements, full stripping/undercut beneath fill, geometric borrow-pit
  excavation volumes, globally optimized borrow/waste allocation, construction
  scheduling, and vertical/total-construction-cost optimization. User-defined
  horizons and the deterministic allocation scenario are implemented.
- Arbitrary programmable template components, a separately graded 3D landing
  pad, automatic standards-based superelevation/runoff design, spirals,
  intersection design and road-network topology or automatic spur snapping.
  Named parameter templates, signed side crossfalls and linear station
  transitions are implemented; a spur can be a separate manually connected road.
- DEM-derived stream extraction, flow accumulation, wetness or watershed
  delineation. Aspect display is implemented from the active terrain. Supplied streams and
  polygons provide the crossing/constraint context. Entered culvert geometry,
  sampled cover and installed-cost scenarios are implemented; culvert/bridge
  capacity and geotechnical stability are not solved.
- Automatic maximum cable reach, safe operating envelopes, cable force/tension,
  equipment/payload selection and anchor capacity. Fixed-radius radial
  exploration and individual D-lines use entered heights and assumed sag only.
- Tree/species/DBH, merchantable timber volume, piece size or inventory recovery
  from bare-earth terrain. These require their own inventory data and tools.
- Native RoadEng/CAD project output, a survey stakeout package or dedicated
  per-chart PNG export. The supported outputs below are the interoperability
  contract; the printable report supports the browser's Print / Save as PDF.

## Computation and file budgets

- At most 20 alignments and 2,000 horizontal control points per project;
  individual alignments at most 100 km.
- At most 500 vertical controls and 200 widening ranges per alignment.
- Per alignment: at most 50 named templates, 200 template assignments,
  32 materials, 200 station/depth horizons, 100 culverts and 100 haul sites.
  Same-side template overlaps and overlapping station/depth material horizons
  are rejected. Side crossfall is −20% to 20%; template width is 0.1–50 m per side.
- Material intersections: at most 15,000,000 section-sample/layer pairs.
  Haul: at most 20,000,000 source comparisons and 20,000 emitted movements.
  Exceeding a budget returns an explicit calculation error, not truncated
  quantities or an invented allocation. Movements are paginated in the UI.
- Culvert horizontal span: at most 500 m; skew: −80° to 80°. The barrel
  profile has 40 regular intervals plus formation-edge/midpoint samples.
  Haul-site access distance is an entered value of at most 100 km. Capacities
  can be explicitly unbounded; finite capacity is at most 10¹² m³.
- At most 20 ground profiles and 2,000 total profile vertices.
- At most 500 context features / 50,000 vertices; 2,000 context intersections
  per road analysis.
- Curved centreline tessellation: at most 30,000 pieces; context intersection
  search: at most 5,000,000 candidate segment checks per analysis.
- Requested station spacing: 2–100 m. The 3,000-station limit includes curve,
  widening, template, horizon, structure, site and crossing events. Spacing increases with a visible warning if
  needed; too many mandatory events requires splitting the road.
- Cross-section half-width: 5–100 m. Sampling pitch is the larger of 0.25 m
  and full transect width / 220; exact template/daylight breakpoints are added.
- Horizontal radii: 0–10,000 m. Vertical elevations: −12,000–12,000 m and
  curve lengths: 0–10,000 m. Distinct vertical stations must be at least
  1 mm apart. Imported/project latitude must be strictly between −85° and 85°.
- At most 100 D-lines. A calculated span is 0.01 m–10 km, with 20–1,000
  sample intervals and an even count that retains the midpoint. Support
  heights are 0–100 m and supported sag is 0–30% of horizontal span. Support
  offsets are −200 to 200 m at each end and must preserve a positive span.
- Radial D-line exploration: radius at most 2,000 m and at most 72 spokes;
  the angular step widens when necessary to respect the spoke budget. The
  worst case is 72,216 terrain lookups (1,001 profile samples plus two support
  samples per spoke). No missing support is replaced by a default elevation.
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
  widening/template/settings/context/cable/profile state, optional engineering
  definitions/assignments/materials/structures/haul assumptions and terrain provenance.
- Library JSON: `pgmaps-road-library-v1`, portable named template and material
  definitions, with explicit merge or replace behavior.
- GeoJSON: WGS84 linework, control/design properties, crossings and context;
  culvert barrel lines, stationed borrow/waste sites and optional engineering
  inputs; design elevations retain their explicitly named vertical reference in
  properties. Ordinary line geometry is not silently given ellipsoidal Z.
- Station CSV: numeric chainage, ground/design heights, grades, areas/volumes,
  mass, completeness/flags and source metadata. Unknown values stay blank.
  Text fields are quoted and protected against spreadsheet formula injection.
- Engineering CSV: material bank/compacted quantities, culvert inventory,
  each allocated haul movement with explicit volume basis, and itemized costs;
  unknown fields remain blank and every row retains source provenance.
- Selected-section CSV: signed left/right offsets, WGS84 coordinates, semantic
  section codes, ground/design elevations, ground-minus-design cut/fill depths,
  completeness and source provenance. Actual cut-side ditch and daylight points
  use the calculated section; unavailable ground or exterior design stays blank.
- D-line CSV and printable HTML: effective supports and sampled profile, yarder
  orientation, signed offsets, horizontal span, signed support rise, inclined
  support chord, assumed sag, sampled geometric cable length and clearance
  coverage. Stale or empty profiles are rejected. Missing support ground leaves
  dependent geometry unknown; an interior terrain gap can retain assumed cable
  geometry while clearance remains unknown. Geometric length is not a purchase
  length, catenary or cable-load specification.
- Printable HTML: selected road summary, profile, full station schedule,
  crossing review, material quantities, culvert review, haul scenario, itemized
  costs, source provenance and assumptions. User text is escaped;
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
crossings, polygon holes, missing coverage and mass gaps. Engineering fixtures
check asymmetric templates and superelevation, exact simultaneous width/depth
transitions, short stepped assignments, clipped material-area conservation,
cut-only stripping, material conversion factors, culvert skew/cover/unknowns,
capacity-limited borrow/waste, separate volume bases and transfers prohibited
across unsupported gaps. Cable checks cover moved supports, yarder orientation
and sag on the resolved span. Radial fixtures include flat ground, a valley,
a ridge, support/interior gaps, bearing wrap, budget enforcement and adoption. Actual encoded
GeoTIFF fixtures check PixelIsArea/PixelIsPoint centres, known bilinear values,
edge round-trip tolerance, no-data and strict recorded-hash restoration.
Project checks cover round-trip, finite/range/CRS validation, unchanged
GeoJSON vertices, independent profiles, no-data persistence, CSV injection and
HTML escaping. Route tests exercise determinism, endpoints, grades,
exclusions, gaps and bounded failure.
Aspect fixtures cover compass direction, flat/no-data states and actual display
pixels. Section/output fixtures cover resolved point codes, geometric D-line
measurements, missing terrain, stale results and escaped export metadata. Orientation
fixtures pin left-of-travel ground and template components to negative section
offsets. Pane-size fixtures (`src/components/ui/pane-sizes.test.ts`) cover pixel
limits, untouched neighbours and stacked heights; axis fixtures (`chartScale.test.ts`)
cover round 1–2–2.5–5 ticks and their decimals.

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
The dedicated view suite checks chart navigation without model mutation,
shared profile/band/mass ranges, actual aspect/context source changes, section
level edits and connected four-pane layouts. It also drags and keyboard-resizes
every pane boundary, checks sizes survive a reload per layout and reset on
double-click, resizes stacked panes at phone width without horizontal overflow,
and checks the header layout picker, the absent footer and status row, the
profile toolbar's position on the chart and the section's up-station labels.
Most workflows use explicitly synthetic training terrain and a stub basemap;
they do not substitute for a real-source check. Run from the repository root:

```sh
npm run toolkit:build
npx playwright install chromium
npm run e2e -- tests/e2e/forestry-road-design.spec.ts tests/e2e/forestry-road-views.spec.ts --project=chromium --workers=1
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
