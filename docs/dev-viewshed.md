# Terrain viewshed development tool

Open **Dev Library → Viewshed**, at `/dev/viewshed`. This is a standalone MapLibre
GL JS terrain visibility experiment, using PGMaps' shared map and sidebar.
Drag the blue observer or tap the map; change observer height, target height,
radius or terrain detail. Arrow keys on the focused marker move it 100 m.
The 3D toggle changes map rendering, not numerical heights.

## What the colours measure

Green means the sampled target centre has an unobstructed terrain sightline.
Red means a known terrain sample blocks it. Grey means terrain is missing at
an endpoint or somewhere along an otherwise unblocked sightline. A known
obstruction can establish red even when another segment is unknown.

Numerical analysis reuses PGMaps' forestry `ElevationSource`,
`ElevationGrid`, `loadElevationGrid` and `testSightline`.
It does not call `queryTerrainElevation`: renderer LOD cannot change an answer.
Sightlines include Earth curvature, refraction coefficient 0.13, and heights
above local ground. Clearance is zero. Buildings, vegetation, Fresnel zones,
radio hardware and interference are outside this terrain-only experiment.
Each profile takes at most 1,200 steps; very fine imported DEMs can contain
features between those samples at a large radius.

A run samples at most 128 × 128 cell centres on a local Mercator grid, clipped
to the chosen geodesic radius. Cells are drawn with nearest-neighbour colours;
the entire cell is not independently tested. Counts/percentages describe those
sampled centres, including unknown samples, rather than surveyed ground area.
Both output cell spacing and DEM grid pixel spacing are displayed. Grid spacing
does not establish the source survey's resolution or vertical accuracy.

Continuous marker dragging submits observer updates at most every 400 ms,
while the native marker follows the pointer on every frame. The worker coalesces
changes for 120 ms, cancels obsolete fetches and yields
every four rows to stop obsolete calculations. Complete DEM mosaics are cached
(two mosaics, maximum 64 tiles each); partial mosaics are not cached.
The radius is bounded to 0.25–10 km. A request requiring more than 64 tiles
asks the user to reduce tile detail or radius. Old coverage disappears as soon
as inputs change, so it cannot be mistaken for a new observer's result.

## BC data sources

| Source | Use in this tool | Access and limits |
| --- | --- | --- |
| [AWS/Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Default overview, matching PGMaps' existing forestry terrain | Global bare-earth elevation; key-free Terrarium XYZ PNGs at `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Underlying source quality varies. See [source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). |
| [LidarBC open portal](https://lidar.gov.bc.ca/) and [official dataset](https://open.canada.ca/data/en/dataset/d08b2795-d192-4377-8056-eccef50296e6) | Preferred local bare-earth DEM where a suitable survey covers the chosen location | Open Government Licence – British Columbia; portal offers LiDAR and derived DEM/DSM downloads. Coverage, acquisition date, resolution and datum must be checked per dataset. |
| [NRCan HRDEM](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995) | Alternative terrain DTM for a cropped local GeoTIFF | CanElevation terrain/surface products, download and STAC resources. Inspect local coverage and product metadata. |
| [NRCan HRDEM Mosaic](https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b) | Candidate for a later regional data pipeline | [Official viewer](https://datacube.services.geo.ca/en/viewer/elevation/index.html) exposes terrain/surface and derived relief. WMS hillshade is a visual image, not numeric elevation for a sightline. |
| [GeoBC CDED DEM](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/elevation) | Coarser fallback for regional context | Province documents free gridded CDED downloads; do not treat the 1:250,000 product as local LiDAR detail. |

These links were researched on 2026-10-09. No province-wide LiDAR or HRDEM
snapshot is downloaded or claimed as the default in this change.

### Import a local BC DEM

Download a **bare-earth DEM/DTM** covering the observer and the full view radius.
In GIS software, crop a north-up single-band GeoTIFF at its native resolution
to at most 1,048,576 cells and 64 MB. Elevation values must be metres.
Record its actual vertical reference (for example CGVD2013 only when the source
metadata says so), then select the file in the sidebar.

Import reuses the existing forestry importer. Supported projections are EPSG:3005
BC Albers, EPSG:4326, EPSG:3857, and NAD83/WGS84 UTM zones 7–11. Rotated rasters,
non-metre vertical units and unsupported projections are rejected. No automatic
downsampling or fallback elevation fills missing cells.

The local raster stays in memory on this device. Numerical visibility uses it
exclusively; out-of-crop ground is unknown. The basemap hillshade/3D terrain still
uses AWS overview tiles, and the UI explains this mismatch. For a large hosted
BC dataset, build a separate attributed terrain snapshot pipeline in
`vendor/bcdatamapper`, producing native elevation assets and optional Terrarium
tiles for MapLibre; follow the scraper-owned data policy rather than committing
copied tiles to PGMaps' generated `public/data`.

## Reference and validation

[DroneRanger](https://github.com/mariohm1311/DroneRanger) is the feature reference
for a movable observer and live terrain coverage. Its current README states
that no reuse licence has been selected; no implementation code is copied.
This tool reuses PGMaps' own geometry and UI, without a Mapbox token or dependency.

Unit checks cover flat ground, ridge blocking and observer height, missing
endpoints/interior terrain, transparent exterior cells, and bounded requests.
Browser checks stub terrain and assert the actual MapLibre coverage layer,
terrain toggle, marker movement, cached height updates and source failures.

```sh
npx vitest run src/pages/dev-viewshed/analysis.test.ts
npx playwright test tests/e2e/viewshed.spec.ts
```
