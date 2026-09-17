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
| **Mean slope · green-up height** | Mean ground slope over the block, and the regeneration height at which it stops reading as disturbance (Table 6). |
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

## What it does not model

Bare-earth terrain only. Standing timber, screening vegetation along the road,
retained patches inside a block, and roadside cut-and-fill are not in the DEM,
so a block screened in reality by a strip of leave trees will read as visible
here. Forest cover is not modelled either, so the planimetric denominator is the
landform's whole area rather than its "green" area, which reads low against a
landform carrying much non-forested ground.

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
| `src/pages/dev-forestry/DriveCamera.tsx` | Eye-level camera and playback |
| `src/pages/dev-forestry/TerrainSupport.tsx` | Hillshade, 3D terrain, and sky |

`terrain.ts`, `visibility.ts`, `vqo.ts`, and `shapeImport.ts` are pure and carry
unit tests; `analysis.ts` takes an `ElevationSource`, so a run can be driven
against synthetic terrain or real tiles outside a browser. `demLoader.ts` takes
an injectable decoder for the same reason — the browser path uses
`createImageBitmap` and `OffscreenCanvas`, which Node has neither of.

End-to-end coverage is `tests/e2e/forestry-visual-quality.spec.ts`, which stubs
the DEM with a synthetic flat-terrain tile so the expected answer is geometry
rather than whatever the real world does today.

## BC inventory data

None of the provincial layers are wired in yet. They exist and are queryable —
the DataBC ArcGIS service publishes established VQOs, visual sensitivity units
carrying `REC_EVQO_CODE`, `REC_VAC_FINAL_VALUE_CODE`, and
`REC_VSC_FINAL_VALUE_CODE`, VLI viewing points with elevations, and scenic
areas. Province-wide, VAC is populated on about 6,400 sensitivity units and an
established VQO on about 5,000, so coverage is real but partial and has to be
handled as missing rather than assumed.

Wiring them in is a separate decision, because PGMaps' convention is that
provincial data is snapshotted through the `bcdatamapper` submodule rather than
queried live from the browser (see `AGENTS.md`).

## Scenes

The scene — viewpoint, polygons, settings, thresholds — is saved to
`localStorage` under `pgmaps.forestry-visual-quality.v1` and exports as JSON.
The page opens on a worked example east of Prince George: a valley road looking
across at Tabor Mountain, with one block on the face the road sees and one just
over the height of land that it never does.

Imported shapefiles are reprojected through their `.prj` by shpjs. BC planning
data usually arrives in BC Albers; without the projection file its coordinates
land in the ocean off Africa, and the import reports the features as skipped.
