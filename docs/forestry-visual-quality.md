# Forestry visual quality (`/dev/forestry/visual-quality`)

A screening tool for the question a visual landscape assessment starts from:
**from this road, how much of that cutblock can you actually see?**

Pick a viewpoint — a spot beside the road, or a length of road driven end to
end — drop in the blocks as a zipped shapefile or GeoJSON, and the page traces a
sightline from every viewing station to every point on every block, over the
real shape of the ground. It then reports the visible share against a visual
quality objective, and lets you stand on the road and look at the result.

## What the numbers mean

| Number | What it is |
| --- | --- |
| **Visible %** | Share of the block's ground area seen from anywhere along the road. The direct answer to "how much of it can we see". |
| **Share of its apparent size in view** | The same question weighted by how the block presents itself from the assessment viewpoint — foreshortened ground counts for less than ground facing the road. |
| **Altered share of the visible landscape** | The number a visual quality objective is actually written against: the blocks' apparent area over the *visible landscape's* apparent area. Needs a visual landscape unit to divide by. |
| **Foreground / middleground / background** | Visible hectares split at 1 km and 8 km, following the BC visual landscape inventory. |

The **assessment viewpoint** is the station along the road where the blocks
together show the most ground — the critical viewpoint an assessment would be
written from. Every perspective number is measured there.

### Visual quality classes

Class thresholds default to the percentages the Visual Impact Assessment
Guidebook pairs with the Forest Planning and Practices Regulation's classes:
preservation 1%, retention 5%, partial retention 15%, modification 25%, maximum
modification 40%. They are **editable on the page** — a district holding a
scenic area to its own numbers should use those.

Objectives attach per polygon. The scene-level verdict uses the objective set on
the visual landscape unit, since that is what a visual quality objective is
assigned to.

## What it does not model

Bare-earth terrain only. Standing timber, screening vegetation along the road,
retained patches inside a block, and roadside cut-and-fill are not in the DEM,
so a block screened in reality by a strip of leave trees will read as visible
here. Treat the output as a screening pass that says where a real visual impact
assessment is warranted, not as one.

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
| `src/pages/dev-forestry/vqo.ts` | Visual quality classes, thresholds, distance zones |
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

## Scenes

The scene — viewpoint, polygons, settings, thresholds — is saved to
`localStorage` under `pgmaps.forestry-visual-quality.v1` and exports as JSON.
The page opens on a worked example east of Prince George: a valley road looking
across at Tabor Mountain, with one block on the face the road sees and one just
over the height of land that it never does.

Imported shapefiles are reprojected through their `.prj` by shpjs. BC planning
data usually arrives in BC Albers; without the projection file its coordinates
land in the ocean off Africa, and the import reports the features as skipped.
