# Forestry visual quality (`/dev/forestry/visual-quality`)

A screening tool for the question a visual landscape assessment starts from:
**from this road, how much of that cutblock can you actually see?**

Pick a viewpoint — a spot beside the road, or a length of road driven end to
end — drop in the blocks as a zipped shapefile or GeoJSON, and the page traces a
sightline from every viewing station to every point on every block, over the
real shape of the ground. It then reports the visible share against a visual
quality objective, and lets you stand on the road and look at the result.

## Two percentage scales, and why both are reported

This is the thing to understand before reading any number off this page.

A visual quality objective is **defined** by how much alteration is visible in
**perspective view** — what a person standing at a viewpoint actually sees.
Timber supply analyses cannot model perspective, so they use a second, much
looser set of **planimetric** percentages applied to flat map area. The two are
not interchangeable:

| Class | Perspective view | Planimetric denudation |
| --- | --- | --- |
| Preservation | 0% | 0 – 1% |
| Retention | 0 – 1.5% | 1.1 – 5% |
| Partial retention | 1.6 – 7.0% | 5.1 – 15% |
| Modification | 7.1 – 18.0% | 15.1 – 25% |
| Maximum modification | 18.1 – 30.0%+ | 25.1 – 40% |

Perspective ranges: *A Guide to Visual Quality Objectives* (QP371691, Mar 2013).
Planimetric ranges: *Procedures for Factoring Visual Resources into Timber
Supply Analyses* (Mar 1998), Table 3, which states they "apply to the total
forested or 'green' area of the landscape and should be applied
planimetrically".

A 12% alteration is **modification** in perspective view but only **partial
retention** planimetrically. Judging a perspective number against a planimetric
threshold therefore passes alterations the objective does not allow, so the page
computes both and judges each against its own scale. Both threshold sets are
editable — a district holding a scenic area to its own numbers should use those.

### What the numbers mean

| Number | What it is |
| --- | --- |
| **Visible %** | Share of the block's ground area seen from anywhere along the road. The direct answer to "how much of it can we see". |
| **Share of its apparent size in view** | The same question weighted by how the block presents itself from the assessment viewpoint — foreshortened ground counts for less than ground facing the road. |
| **Alteration in perspective view** | The blocks' apparent area over the landform's visible apparent area, from the assessment viewpoint. The scale the objective is defined on. |
| **Planimetric denudation** | The blocks' map area inside the landform over the landform's area, visible or not. The scale timber supply models against. |
| **Mean slope · green-up height** | Mean ground slope over the block, and the regeneration height at which it stops reading as disturbance (Table 6), area-weighted over the block's own slope classes. |
| **Foreground / middleground / background** | Visible hectares split at 1 km and 8 km, following the BC visual landscape inventory. |

The **assessment viewpoint** is the station along the road where the blocks
together show the most ground — the critical viewpoint an assessment would be
written from. Every perspective number is measured there.

### Alteration applies to a landform, not to a landscape

The 2013 guide is explicit: "Percentage alteration numbers must be applied to
readily identifiable landforms (not applied against an entire visible
landscape). A landform is a distinct topographic feature, is three-dimensional
in form, and is generally defined by ridges, valleys, shorelines, and skylines."

So the denominator on this page is a polygon marked as a **landform**, and only
the parts of blocks falling inside it count toward its alteration. Without a
landform the page reports per-block visibility and says the denominator is
missing rather than inventing one.

### Visual absorption capability

A landform can carry a VAC rating, which narrows the planimetric allowance from
the class range to a single figure (1998 Table 4):

| Class | Low VAC | Medium | High |
| --- | --- | --- | --- |
| Preservation | 0 | 0.5 | 1 |
| Retention | 1.1 | 3.0 | 5 |
| Partial retention | 5.1 | 10.0 | 15 |
| Modification | 15.1 | 20.0 | 25 |
| Maximum modification | 25.1 | 32.5 | 40 |

Where a landform has no rating the class maximum is used instead. BC's inventory
leaves VAC unpopulated across much of the province, so that is the common case.

### Partial cutting

Partial cuts are judged on what is left standing rather than on denudation, so
`partialCutClass()` implements the 2013 guide's own grid: volume or stems
removed against residual tree height, returning the class most likely achieved.
It is exposed as a helper rather than wired into the visibility run, which
models clearcuts.

## Existing harvest and cumulative alteration

An objective is met or missed by what is on the ground **plus** what is
proposed, so "Look up this view" also pulls the province's consolidated
cutblocks and the results report existing + proposed = cumulative.

- **Green-up.** An opening older than the green-up age stops counting, because
  regeneration has grown back into forest cover. The references give the green-up
  *height* a slope needs (Table 6), not how long a site takes to reach it, so
  the age is a stated planning assumption and is editable. The **height** is
  computed the way the procedure sets out — hectares in each slope class,
  weighted by area — rather than by reading one height off the mean slope. Every
  grid sample stands for the same ground, so that is the mean of each sample's
  own Table 6 height. It is not the same answer: Table 6 is a step function, so
  on a block that is half flat and half steep the mean slope lands in a class
  that barely exists. Around Prince George
  most recorded harvest is 2003–2005, which sits right on a 20-year default —
  moving it to 25 flips those openings back into the count.
- **Partial cuts.** `PERCENT_CLEARCUT` scales the contribution, so an opening
  that was 40% clearcut counts 40%.
- **No double counting.** A proposed block laid over an opening that still
  counts is not charged for that ground again; ground under a *recovered*
  opening is free for the proposal to claim.

## The green area, and where it comes from

The 1998 document is explicit: visual landscape management "applies a percent
denudation figure to the **total green (forested) portion** of the visual
landscape, whether the area is available for harvest or not." So the planimetric
denominator is the landform's treed area, not all of it.

That comes from **VRI rank-1** (`WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY`),
queried live from DataBC's WFS. `BCLCS_LEVEL_2` is exactly the distinction the
procedure turns on: `T` for treed ground, anything else for water, rock, or
clearing. It is not in the ArcGIS map service the rest of this page uses — that
service publishes only the VRI *Dead* layer — which is why there are two service
clients here.

It matters more than it sounds. Tabor Mountain's landform is **78.6% treed**:
3,527 ha green of 4,489 ha. Dividing by all 4,489 makes every planimetric figure
read **27% low**, and that crosses classes — an opening between about 176 and
225 ha is within Retention's 5% planimetric maximum on the whole-area
denominator and over it on the right one.

One query answers three questions, so it is made once per run:

| | From |
| --- | --- |
| The green area | `BCLCS_LEVEL_2 = 'T'` |
| Screening canopy | `PROJ_HEIGHT_1`, `CROWN_CLOSURE` |
| The drawn 3D stand | `SPECIES_CD_1` |

Two costs. GeoServer will not generalise geometry server-side, so the answer is
about 1 MB over a 4,500 ha landform against the tens of kilobytes the generalised
ArcGIS queries return — hence a tighter bounds clamp and a feature cap, and the
result reports truncation. And the bounding box goes in the `CQL_FILTER` rather
than the WFS `bbox` parameter: WFS 2.0 with a plain `EPSG:4326` bbox is
latitude-first while CQL's `BBOX` is longitude-first, and mixing the two returns
the wrong part of the province without erroring.

## Screening timber

Terrain is only half of what hides a block: a stand between the road and the
block blocks the view as a ridge does. `canopy.ts` rasterises stand heights into
a grid in the same Mercator space the sightline walks, so screening costs one
array lookup per profile step, and clears that canopy inside the proposal and
inside any opening that has not grown back.

Height and crown closure come from the same VRI rank-1 query as the green area,
so coverage is the whole landscape rather than managed openings. Screening stays
**off by default** — the query is multi-megabyte and the run is honest without
it — but switching it on is now a real answer rather than a partial one.

Stands more open than a crown-closure threshold do not screen at all. The
inventory carries no transmission model, so that cut-off is a stated assumption
rather than a published figure.

## What it does not model

Bare-earth terrain only. Standing timber, screening vegetation along the road,
retained patches inside a block, and roadside cut-and-fill are not in the DEM,
so a block screened in reality by a strip of leave trees will read as visible
here.

Where no vegetation inventory answers, the planimetric denominator is the
landform's whole area rather than its green area, and the figure reads low by
however much of the landform was never forest. The results panel says which
denominator was used.

The percentages are also only the numeric half of the test. The Forest Planning
and Practices Regulation defines the classes by visual dominance as well: how
large the alteration is in scale, whether it looks natural, and whether it is
rectilinear or geometric. A number inside the range does not by itself achieve
the objective — a visual design review decides that. Treat the output as a
screening pass that says where a real visual impact assessment is warranted,
not as one.

## How a run works

1. **Stations** — a spot viewpoint is one station; a corridor is sampled every
   `stationSpacingMeters` along the centreline, both ends included.
2. **Samples** — each polygon gets a regular grid whose cells all cover the same
   ground area, so a sample count is an area ratio. Spacing comes from the
   sample budget, never finer than the DEM resolves.
3. **Terrain** — the DEM tiles covering the stations and every in-range polygon
   are fetched and blitted into one contiguous elevation mosaic.
4. **Sightlines** — every station-to-sample pair walks the ground profile a DEM
   cell at a time, comparing terrain against the ray after earth curvature and
   atmospheric refraction. The walk stops at the first obstruction.
5. **Reduction** — per-station visibility is kept rather than collapsed, which
   is what makes the along-the-road profile and drive mode free.

Visibility is held as a `stations × samples` matrix per polygon, so "can it be
seen anywhere along the road", "where is it worst", and "what does the driver
see right now" all read from one pass over the terrain.

### Elevation data

Elevation comes from the AWS Open Data [terrain tiles](https://registry.opendata.aws/terrain-tiles/)
archive in Terrarium encoding (SRTM/CDEM), which needs no API key. The map
renders its 3D terrain and hillshade from the same tiles, so the ridge that
hides a block in the numbers is the ridge that hides it on screen.

Terrain detail is a DEM zoom level: zoom 13 is about 11 m between samples in
central BC and is the default. A run is refused above 256 tiles — drop a zoom
level rather than wait.

### Cost and limits

A run is capped at 250,000 sightlines; past that the sample grid is coarsened
rather than the stations thinned, because losing a viewpoint loses a whole
answer while a coarser grid only blurs one. The defaults land around three
seconds for a 10 km corridor against two blocks.

If more than a third of the terrain tiles fail to load the run is refused
outright: ground the mosaic is missing never blocks a sightline, so a run built
on absent tiles would report everything as visible.

## Working backwards from the block

The forward run answers "how much of this block does this road see", which needs
you to already know which road matters. **"Which roads see the block"** answers it
the other way round: every road the basemap is currently drawing is sampled at
intervals, each station traces sightlines to a grid over the block, and the
result is a ranked list — the most it is ever exposed, the share of each road's
length it can be seen from, and how close that road comes.

Picking a road makes it the corridor, so the full assessment can then be run
along it for the figures an objective is actually judged on. The reverse run is a
coarser grid on purpose: it ranks roads, it does not produce a percentage anyone
should write down.

It reads the roads from the **rendered basemap**, so it answers for the current
view at the current zoom — roads off screen are not searched, and at a zoom where
the basemap does not draw resource roads they are not there to be found. (The
province's own Digital Road Atlas view is published with a null object-id field
and its spatial queries return nothing, so it is not a usable source.)

## Snapping the corridor to a road

A hand-drawn line is a guess at where the road goes, and the guess shows up in
the numbers: a vertex that lands in a gully or on the far bank puts a viewing
station somewhere no driver ever is, and that station reports seeing nothing.
**"Snap to the nearest road"** replaces the drawing with the road the basemap
draws, trimmed to the stretch that was drawn — so a short sketch along a highway
does not return the whole highway.

The road a drawing was tracing is the one its vertices sit closest to on average.
A line further than 250 m from every road on screen is left alone, with a note
saying so rather than snapping to something arbitrary. Note that at a zoom-11
view a single screen pixel is about 30 m, so drawing within snapping distance
means zooming in first.

Vector tiles split one road into many features and styles draw each of them twice
(a casing under a fill), so the candidates are deduplicated by geometry, merged
by name or highway number, and — for the unnamed roads that are most of the
resource network — chained together by shared endpoints.

## Drive the view

"Look from the road" puts the camera at eye height on the corridor and turns on
3D terrain. Play drives it along at a chosen speed; the profile chart doubles as
the scrubber. Facing a block pitches the camera at it, and the sample points
narrow to what *that* point on the road can see — red ground appears and
disappears as ridges pass in front of it.

Two MapLibre details this depends on:

- The camera is placed from an explicit position, altitude, and rotation
  (`calculateCameraOptionsFromCameraLngLatAltRotation`), not by framing a point
  at some zoom. Standing on a road needs a real eye height above the terrain.
  **Roll must be passed explicitly** — MapLibre copies the omitted argument
  through as `roll: undefined`, and `jumpTo` treats the key as present and
  normalises it to NaN, which leaves the transform's projection matrices null
  for every later frame.
- Pitch is clamped to 85°, MapLibre's supported ceiling. A block sitting above
  the horizon is framed slightly high rather than centred.

### Standing the timber up

"Stand the timber up" draws the stand as instanced 3D conifers on the terrain.
It is a drawn picture, not an inventory: timber fills the view at a height you
set, and the proposal, every existing opening, and the road corridor take it off
again. The point is that a cutblock then reads as a **gap in the canopy**, which
is what a visual quality objective is actually written about — a coloured
polygon on a bare hillside tells you where a block is, not whether you can see
it.

### How a stem is drawn

Two ways, and the panel switches between them so they can be compared at the
same camera and the same stem count.

**Billboards** (the default) put the tree in a texture and stand each stem up as
two triangles, turned to face the camera. It is what forest visualisers do,
because a stand you can see a cutblock across is tens of thousands of stems and
modelled geometry at that count buys detail nobody can resolve past a hundred
metres. At 41,000 stems that is **0.08M triangles a frame against 1.44M** for
cones — eighteen times less — and it looks far better, because a drawn
silhouette with a bole and drooping whorls reads as a tree and a cone never does.

**Solid cones** carry real geometry and real normals, so they light correctly
from any angle and are honest from directly above. They are kept for that, and
for comparison.

Species and height come from **RESULTS forest cover** wherever the province has
surveyed the ground — the same query that feeds screening already carries
`I_SPECIES_CODE_1` and `I_SPECIES_HEIGHT_1`, so a fifteen-year-old opening draws
as nine-metre regeneration of the species planted rather than as mature timber.
Coverage is managed openings only, so most of a view falls through to a regional
mix, and the panel says how much did. Run "Look up this view" first to have any
of it.

The silhouettes are generated in `impostor.ts` rather than shipped as assets:
four BC interior species (lodgepole pine's long clean bole and short crown,
interior spruce's spire to near the ground, subalpine fir narrower still,
trembling aspen's rounded crown over a pale stem), four drawn variants each,
into one 16-cell atlas. Nothing to license, nothing to download, and the stand
can be redrawn for a different species mix without an art pipeline. The default
mix is pine-leading with spruce and fir through it and a little aspen — a drawn
mix, not a cruise.

Two details the billboard path turns on:

- **Cut out, do not blend.** Blended foliage needs back-to-front sorting and a
  stand has no back to front. A hard alpha edge costs some aliasing and keeps
  the depth buffer honest, so trees behind a ridge stay behind it.
- **The view direction comes out of the matrix.** MapLibre publishes no camera
  position, and the one place it keeps internally is the value that misleads
  deck.gl. The row of the projection matrix that produces clip `w` measures
  distance from the camera along the view axis, so its gradient
  `(m[3], m[7], m[11])` is the view direction — enough to turn a cylindrical
  billboard, and it cannot disagree with the matrix that drew the ground.

### Growing the patch

Three things this needs to get right, all learned the hard way:

- **The patch follows the eye, not the map centre.** With the camera at ground
  level and pitched at the horizon, `map.getCenter()` is where the view ray meets
  the ground plane — ten-odd kilometres out and, in MapLibre's model, below sea
  level. A patch grown there is a two-pixel smudge on the skyline. The forest is
  grown around the current viewing station instead.
- **The road is a clearing.** A 28 m tree standing 15 m away subtends 62°, so at
  a true right-of-way width the near timber fills the frame and nothing beyond it
  can be judged. The corridor is buffered out of the stand, and the cleared width
  is a control — widening it is a viewing aid and moves no number.
- **Two shells.** A stocked stand out to a few hundred metres, then a much
  coarser one out to the block. At a kilometre a stem is a pixel or two and only
  the texture matters, so the same budget goes much further.

It draws through a **MapLibre custom layer**, not a deck.gl overlay, and that is
deliberate. deck.gl's MapLibre integration derives its camera height from
`map.transform.elevation`, documented as the ground elevation under the map
centre. Under this drive camera that value is a camera-fitting residual — about
−294 m at Tabor Mountain — and deck.gl's camera lands at sea level while
MapLibre's is on the hillside at 707 m. Nothing draws, with no error anywhere:
the layer is added, the model is built and instanced, `render` is called, and
`gl.getError()` is clean. Taking `modelViewProjectionMatrix` straight from the
render call sidesteps the question — the trees are projected by exactly the
matrix that projected the ground under them.

## Files

| Path | Role |
| --- | --- |
| `src/pages/DevForestryVisuals.tsx` | Page: scene state, map layers, drawing, import/export |
| `src/pages/dev-forestry/terrain.ts` | DEM tile maths and the elevation mosaic |
| `src/pages/dev-forestry/visibility.ts` | Sightlines, sampling, areas, perspective weighting |
| `src/pages/dev-forestry/analysis.ts` | The run itself — stations, grids, reduction |
| `src/pages/dev-forestry/analysis.worker.ts` | Off-thread wrapper: fetch terrain, then trace |
| `src/pages/dev-forestry/demLoader.ts` | Tile fetching and decoding, with an injectable decoder |
| `src/pages/dev-forestry/vqo.ts` | Visual quality classes, both threshold scales, VAC, green-up, partial cutting |
| `src/pages/dev-forestry/scene.ts` | The page's document: persistence, export, map features |
| `src/pages/dev-forestry/shapeImport.ts` | Zipped shapefile and GeoJSON import |
| `src/pages/dev-forestry/bcVisualInventory.ts` | Live DataBC lookup for sensitivity units, objectives, and VAC |
| `src/pages/dev-forestry/DriveCamera.tsx` | Eye-level camera and playback |
| `src/pages/dev-forestry/TerrainSupport.tsx` | Hillshade, 3D terrain, and sky |
| `src/pages/dev-forestry/reverseViewshed.ts` | Working backwards: which roads can see a block |
| `src/pages/dev-forestry/roadSnap.ts` | Roads from the basemap; locking a drawn line onto one |
| `src/pages/dev-forestry/forest.ts` | Cone geometry, stem placement, species mix, and the road buffer |
| `src/pages/dev-forestry/impostor.ts` | Drawn tree silhouettes and the atlas they are packed into |
| `src/pages/dev-forestry/treeLayer.ts` | The MapLibre custom layer that draws the stand |
| `src/pages/dev-forestry/ForestOverlay.tsx` | Which ground to grow, and when to regrow it |

`terrain.ts`, `visibility.ts`, `vqo.ts`, `shapeImport.ts`, `reverseViewshed.ts`,
`roadSnap.ts`, and `forest.ts` are pure and carry unit tests; `analysis.ts` takes an `ElevationSource`, so a run can be driven
against synthetic terrain or real tiles outside a browser. `demLoader.ts` takes
an injectable decoder for the same reason — the browser path uses
`createImageBitmap` and `OffscreenCanvas`, which Node has neither of.

End-to-end coverage is `tests/e2e/forestry-visual-quality.spec.ts`, which stubs
the DEM with a synthetic flat-terrain tile so the expected answer is geometry
rather than whatever the real world does today.

## BC inventory lookup

"Look up this view" asks DataBC's **Visual Landscape Inventory — Visual
Sensitivity Units** layer what the province says about the area on screen, and
clicking a unit adopts it as the landform carrying its own established objective
and VAC rating. That replaces the two inputs most worth not guessing at.

This is a **live query**, deliberately outside the `bcdatamapper` snapshot
pipeline (`AGENTS.md`). It is a lookup of a handful of polygons for one place
rather than a dataset the app ships, and it needs no key: the service answers
cross-origin, verified from a browser.

Three things make it practical:

- **Generalised server-side.** Full-resolution units run about 110 KB *each* —
  a Prince George-sized query is ~7 MB. `maxAllowableOffset` cuts the same query
  to about 30 KB, which is all a screening map needs.
- **Bounded.** The query bbox is clamped to 1.5° so a province-wide view cannot
  ask for a thousand polygons to answer a question about one place.
- **Honest about gaps.** Coverage is patchy and the page says so rather than
  filling in.

### What the inventory actually contains

Province-wide, about 5,000 sensitivity units carry an established objective and
about 6,400 a VAC rating. Locally it is thinner: of 36 units returned around
Prince George, 22 had an established objective and **none** had a VAC rating.
Unrated units are drawn on the map for context but kept out of the list, and a
landform with no VAC falls back to the class maximum.

Codes map as `P`/`R`/`PR`/`M`/`MM` for the objective and `L`/`M`/`H` for VAC —
note that `M` means modification in one field and medium in the other, which is
why they are never read through the same table.

The **VLI Viewing Points** layer in this service is empty (0 features
province-wide), so official viewpoints have to be placed by hand.

## Scenes

The scene — viewpoint, polygons, settings, thresholds — is saved to
`localStorage` under `pgmaps.forestry-visual-quality.v1` and exports as JSON.
The page opens on a worked example east of Prince George: a valley road looking
across at Tabor Mountain, with one block on the face the road sees and one just
over the height of land that it never does.

Imported shapefiles are reprojected through their `.prj` by shpjs. BC planning
data usually arrives in BC Albers; without the projection file its coordinates
land in the ocean off Africa, and the import reports the features as skipped.
