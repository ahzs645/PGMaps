# Forestry visual tools — hands-on trial, 12 November 2026

A shortlist of browser projects was proposed for the visual quality (VQO / VIA)
tool on `/dev/forestry/visual-quality`: EZ-Tree, maplibre-landmarks,
maplibre-gl-three, Giro3D/Piero, OpenForest4D, FORA, WSL Virtual Forest and the
ArcGIS viewshed sample. This note records what happened when each was actually
run, and where possible run against Prince George data and PGMaps' own tree
renderer. The question throughout is the VIA one: does it help show, honestly,
how much of a proposed block a viewer would see?

Evidence images are in `forestry-visual-tools-trial/evidence/`; the scripts
that produced them are in `forestry-visual-tools-trial/bench/` (see its README).

**Test conditions.** Headless Chromium with WebGL2 on SwiftShader (CPU). Every
page rendered correctly, but frame times are CPU raster times — useful as
ratios between two scenes, not as what a GPU laptop would do. Real data was
LidarBC tile `093g097_1_2_1` (2024, 1 m DEM and DSM, 8 pts/m² LAZ), a mixed
urban/river/forest tile in Prince George.

## Summary

| Project | Ran? | Against PG data / PGMaps? | Verdict for the VIA tool |
|---|---|---|---|
| EZ-Tree 1.1.0 | Yes | Yes — stand vs `treeGeometry.ts` | Useful for near trees, **only with B.C. presets and a screening calibration** |
| maplibre-landmarks 0.6.0 | Yes | Yes — 240 ha stand, terrain, eye level | **Not suitable as-is**: thins to 4,000 trees; eye level crashes with thinning off; no per-stem height |
| maplibre-gl-three 3.0.2 | Yes | Yes — trees on terrain, eye-level camera | **Works where deck.gl did not.** Candidate for near-field meshes after a MapLibre 6 upgrade |
| Giro3D 2.0.7 / Piero | Yes | Yes — LidarBC DEM and DSM, EPSG:3157 | Works after re-encoding the LidarBC GeoTIFFs; good companion view, separate bundle |
| OpenForest4D CHM viewer | Yes | Yes — PG CHM tile | Works after two edits; canopy on flat ground only; overlaps `dev-lidar` |
| FORA 1.9.2 | Yes | Yes — full 294 MB LidarBC LAZ | Produces a per-tree CSV PGMaps could draw; ground model needs the LidarBC DEM |
| WSL Virtual Forest | Yes | No (Unity WebGL, no API) | UX reference only; 350 MB download |
| ArcGIS viewshed sample | Yes | No (Esri SceneView) | UX reference for observer placement |
| EnergyPlanner, CesiumJS + ion SDK, Biosphere3D | Not run | — | Commercial, SDK-gated or desktop; not testable here |

## 1. EZ-Tree against PGMaps' near-tree mesh

`bench/maplibre/eztree.js`. 490 stems (600 stems/ha, a 200 m × 40 m strip
starting 12 m from the road), heights 22 m × U(0.55, 1.3), viewed from 1.6 m.
Crown width set the way `forest.ts` sets it: `crownWidthForClosure(45 %,
600/ha)` = 3.56 m. Three versions of the same stand:

| | Triangles | Frame (CPU, ratio) | Screen covered by trees |
|---|---|---|---|
| PGMaps `roadsideTreeMesh('pine')` | 0.35 M | 1× | **61.8 %** |
| EZ-Tree *Pine Medium*, width forced to 3.56 m | 3.64 M | 8× | **51.6 %** |
| EZ-Tree *Pine Medium*, its own proportions | 3.64 M | 13× | **73.2 %** |

![EZ-Tree vs PGMaps stand](forestry-visual-tools-trial/evidence/eztree-vs-pgmaps-stand.jpg)

**Found.**
- **The tree drawing is not neutral.** At the same location, density and
  crown closure, swapping the asset moved the share of the view hidden behind
  trees by 10 points one way or 11 the other. For a VIA, where screening
  decides whether a block is visible, a new asset needs calibrating (against a
  matched field photo or LiDAR) before it replaces the current one.
- EZ-Tree's presets are not B.C. trees. *Pine* has a crown width/height of
  0.46–0.65 with foliage from 5 % of the height; PGMaps' pine is 0.14 with the
  live crown from 50 %. Lodgepole, spruce, subalpine fir and aspen presets
  would have to be made.
- The npm library (1.1.0) has no LOD; the Full/LOD1/LOD2 switch is in the
  editor app only. Halving sections, segments and leaves by hand cut branch
  triangles 4× (10,032 → 2,508).
- Its leaf material is not instancing-safe (instanced copies drew bare
  stems); a plain alpha-tested material was needed. PGMaps would use its own
  shader anyway.
- Generation is fast (5–22 ms per tree) and seeded, so variants can be built
  at load rather than shipped.

## 2. maplibre-landmarks TreesLayer at a forestry view

`bench/maplibre/landmarks.js`. A synthetic 2.0 × 1.2 km forest polygon south of
Prince George (240 ha; at 600/ha that is ≈144,000 stems) on Terrarium terrain.

| Settings | Eye level (pitch 84°) | Oblique (60°) | Plan |
|---|---|---|---|
| Defaults (`scatter.forest = 600/ha`) | 4,000 drawn of 10,510 scattered | 4,000 drawn | 4,000 drawn |
| `farCutoff:false, thinBeyondM:∞, maxTrees:200k, density:1` | **RangeError, 0 drawn** | 143,646 drawn (update 389 ms) | 143,633 drawn |

![landmarks default vs strict](forestry-visual-tools-trial/evidence/landmarks-trees-default-vs-strict.jpg)

**Found.**
- Defaults draw a disc of 4,000 trees round the view centre and leave the rest
  of the stand as a flat fill (top right). A block outside that disc would read
  as open ground. Its own default forest density is 83 stems/ha.
- With every limit off, the eye-level view throws `Maximum call stack size
  exceeded` in `scatter` (`n.push(...c)` spreading a large per-tile array) and
  draws nothing. That is an upstream bug, easy to fix, but it is the view a VIA
  needs.
- Trees carry only a key and a position (`MappedTree`); size comes from the
  model. Inventory height and crown width per stem cannot be passed without
  forking.
- Requires MapLibre ≥ 6.13 and three ≥ 0.186.

## 3. maplibre-gl-three at eye level on terrain

`bench/maplibre/three.js`. 160 EZ-Tree pines placed with
`map.queryTerrainElevation`, positioned through `getEcefMatrix` /
`lngLatAltToEcef`, camera from `calculateCameraOptionsFromTo` 1.6 m above the
drawn ground.

![maplibre-gl-three eye level](forestry-visual-tools-trial/evidence/maplibre-gl-three-eye-level.jpg)

**Found.** Trees sit on the drawn ground and stay locked to it from eye level —
the case `treeLayer.ts` documents deck.gl failing. The library handles the
EGM96 vertical datum itself. Its tuple `LngLat` (`[lng, lat]`) differs from
MapLibre's object form. Peer range is `three ^0.186.1`, which **excludes
0.187**, and MapLibre `^6.12`. Visibility analysis would still be our own; the
library only draws.

## 4. Giro3D with LidarBC rasters

`bench/giro3d/main.js`. DEM and DSM of tile `093g097_1_2_1` in EPSG:3157
(registered with a proj4 string), same camera.

![Giro3D DEM vs DSM](forestry-visual-tools-trial/evidence/giro3d-lidarbc-dem-vs-dsm.jpg)

**Found.**
- **LidarBC GeoTIFFs are not cloud-optimised**: LZW, one row per strip, no
  overviews, header at the end of the file. `nrs.objectstore.gov.bc.ca` honours
  range requests but sends **no CORS header**, so no browser app can read it
  directly; it needs our proxy or a copy.
- Giro3D's `GeoTIFFSource` failed on the original files ("ran off the end of
  the buffer before finding EOI_CODE"; also with workers off and an 8 MB block
  size). The same rasters re-encoded uncompressed loaded at once. Converting
  imports to COG (`gdal_translate -of COG`) on the way in would avoid both
  problems for any viewer.
- Peer `three ^0.180` cannot share a bundle with landmarks or
  maplibre-gl-three (0.186). It would have to be its own route or lazy chunk.
- From a low viewpoint the DSM (right) hides the hill the DEM (left) shows:
  the terrain-agreement gap in the planner review, item 4, is not cosmetic.
- Canopy height on this tile (DSM − DEM): 38.8 % of cells over 2 m, P90
  14.3 m, P99 26.5 m, max 42.4 m.

Piero itself returned 502 on the first attempt and loaded on the second.

## 5. OpenForest4D with a Prince George canopy tile

![OpenForest4D PG CHM](forestry-visual-tools-trial/evidence/openforest4d-prince-george-chm.jpg)

Ran on a 1 km PG CHM tile after two edits: UTM zone 11 is hard-coded in
`js/utils.js` (PG is zone 10), and `js/tile_meta_data.js` lists the tiles.
It draws canopy height on a flat plane — no ground — and needs exact 1 km
tiles. `dev-lidar` already covers canopy heat maps and tree isolation, so this
adds little beyond a reference for the height-distribution chart.

## 6. FORA on a full LidarBC point cloud

`bench/browser/fora2.cjs` drives the hosted app with the 294 MB LAZ.

![FORA PG segmentation](forestry-visual-tools-trial/evidence/fora-prince-george-segmentation.jpg)

**Found.**
- Loaded in ~37–45 s; read 49.23 M points and **kept 4.92 M (10 %)** for
  display and analysis. Heights normalised at load against its own grid-min-Z
  ground.
- Segmentation (defaults) took ~10 s: 18,100 candidates, 15,479 trees kept.
  Height P10/P50/P90 4.2 / 14.2 / 27.0 m; crown diameter 2.5 / 7.4 / 12.5 m.
- **Max height 62.2 m against a 42.4 m DSM − DEM maximum**: the automatic
  ground is wrong in places. The LidarBC DEM should be supplied as the external
  DTM.
- Species allometry defaults to Scots pine (European list); biomass and DBH
  are not B.C. figures. Height, crown and position are what is useful.
- The CSV has `CenterX`, `CenterY` (EPSG:3157), `H_auto`, `CD_auto` — exactly a
  `TreeInstance` (position, height, crown width). PGMaps' "surveyed" stands are
  VRI polygons, so per-tree LiDAR input to the visual-quality forest would be
  new. The same could come from `dev-lidar`'s tree isolation instead.

## 7. Reference applications

![Demo contact sheet](forestry-visual-tools-trial/evidence/demos-contact-sheet.jpg)

- **WSL Virtual Forest** — loaded 17,208 tree records (15,146 matched to a
  species model) and ~350 MB; under 1 fps on CPU. Good to see what a
  walk-through should feel like; nothing to integrate.
- **ArcGIS viewshed sample** — observer placement, direction, both angles and
  a preview inset all worked (1,275 requests). The clearest UX reference for
  placing a viewpoint.
- **EZ-Tree editor, landmarks demo, Giro3D oriented images, FORA, Piero** all
  loaded.

## 8. What a MapLibre 6 upgrade would touch

Landmarks and maplibre-gl-three both need MapLibre 6.

- 88 files import `maplibre-gl`; 5 use the default import, which v6 removed
  (`AqMapDeckLayers.tsx`, `AqMapLayers.tsx`, `WalkabilityDeckHeatmapLayer.tsx`,
  `DevNetworks.tsx`, `dev-view/RasterMapLayer.tsx`).
- v6 ships a separate worker module; under Vite the worker failed to load until
  `maplibre-gl` was excluded from `optimizeDeps`.
- geo-toolkit already allows `^5.15.0 || ^6.0.0`; `maplibre-gl-lidar` 0.21
  allows `^6`.

## 9. Recommendation, revised by the trial

1. **Feed real trees to the existing renderer.** Import a per-tree list
   (FORA CSV or `dev-lidar` tree isolation, with the LidarBC DEM as ground)
   for the near band along the road, keep VRI-driven stands beyond it. Small,
   and improves the screening evidence directly.
2. **Draw the LiDAR ground the analysis uses** (planner review item 4). Convert
   imported rasters to COG and serve them through the proxy; the Giro3D DEM/DSM
   comparison shows how much the horizon moves.
3. **Calibrate before changing tree shape.** Add a screen-cover check (the
   mask method in `eztree.js`) to the regression suite, then build B.C. EZ-Tree
   presets and accept one only where it matches a matched field photo.
4. **MapLibre 6 trial on a branch, with maplibre-gl-three for near-field
   meshes.** Skip maplibre-landmarks for the VIA tool.
5. **Giro3D as an optional detail view** on its own route, if the inspection
   value is wanted beyond `dev-lidar`.

## 10. Second round: whole-forest renderers (12 November, afternoon)

A second shortlist proposed complete forest engines rather than parts:
threejs-worldgen, Nanite Forest, BakedVoxelLighting, VistaWASM, Sylva,
OpenWorldGen-SDK, Inkwell WebGPU Trees and yomotsu/vegetation. Each demo was
loaded (WebGPU works here on SwiftShader, so the WebGPU paths ran) and each
repository's source was read for how it builds species, lights foliage, draws
distant trees and takes data. Scripts: `bench/browser/demos2.cjs`, `gl2.cjs`,
`gpu.cjs`.

![WebGPU demos](forestry-visual-tools-trial/evidence/renderers-webgpu-contact-sheet.jpg)
![worldgen and Sylva on WebGL2](forestry-visual-tools-trial/evidence/renderers-webgl2-worldgen-sylva.jpg)

| Project | Licence (LICENSE file) | Ran here | Takes our DEM and tree list? | Verdict |
|---|---|---|---|---|
| threejs-worldgen | Apache-2.0 | Yes; WebGPU canvas reads back blank, `?webgl` draws (24,684 instances, 82 draw calls) | Height function yes; tree list no (Poisson placement) | Borrow species parameters and crown-depth AO |
| Nanite Forest | MIT (Lucy model non-commercial) | **Startup failed** on SwiftShader | No | Borrow coverage-preserving mip alpha |
| BakedVoxelLighting | MIT (generated textures, provenance unstated) | Loaded (88 MB), still baking at capture | No | Borrow whorl-group conifers, relit atlases |
| VistaWASM | **AGPL-3.0** | **GPU device lost**, 3.1 s a frame | **Yes**: `loadDemFromArrayBuffer`, `setTreeInstances` | Best design reference; AGPL and WebGPU-only, so ideas only |
| Sylva | MIT | WebGL2, 0.7 fps on CPU (6.3 M triangles) | No (noise terrain) | Native GLSL: card volume normals, crown self-shadow, HG transmission |
| OpenWorldGen-SDK | MIT | Demo URL 404 | DEM import yes; tree list no | Douglas-fir, aspen, birch parameters; crown AO |
| Inkwell WebGPU Trees | MIT | Demo URL 404 | No | Counter-example: thins distant trees without compensation |
| yomotsu/vegetation | MIT | Demo URL 404 | No | Fir frond geometry; a second coverage-preserving mip implementation |

**Conclusion.** None replaces the road view. Only VistaWASM takes a real DEM
and our own tree list, and it is AGPL and WebGPU-only (and could not hold a
frame on this machine). The engines are procedural worlds; the work that
matters for a VIA — the inventory's stand, the block, the eye — is ours either
way. So their techniques were re-implemented in the existing WebGL2 layer
rather than any engine adopted, as selectable renderers:

- **Lit shading** (Sylva's card normals and crown self-shadow; VistaWASM's wrap
  and back-light; crown-depth occlusion from OpenWorldGen-SDK and worldgen).
- **Detail when stopped**: our own detailed mesh generator (BakedVoxelLighting's
  whorl groups, VistaWASM's drooping spruce), drawn for the near stems only
  while the view holds still. EZ-Tree was not used at run time: its bark
  textures come from texture sites and its leaf textures carry no source, and
  `AGENTS.md` keeps third-party vegetation assets out of the app.
- **Coverage-preserving mipmaps** (Nanite Forest, yomotsu/vegetation).
- A pinned **screen-coverage test**, because two of the first detailed meshes
  changed screening by 20% and only the test showed it.

The contract (`forestry-visual-quality.md`) describes each.

![Road view: flat, lit, lit with detail, before harvest](forestry-visual-tools-trial/evidence/road-view-looks-roadside-demo.jpg)

The roadside demo's opening from the same eye: *Flat* (top left), *Lit* (top
right), *Lit* with detail when stopped (bottom left: the nearest 1,779 stems
drawn as meshes) and before harvest (bottom right). After harvest the block
carries slash and stumps against a hard timber edge. The dotted crowns along
the far edge are the existing cross-fade between the 0–300 m and 250–600 m
bands; an A/B with GPU-built mipmaps showed the same, so it is not the new
coverage-preserving mipmaps. It was left as it was.

## 11. MapLibre 6: done

PGMaps and geo-toolkit now run MapLibre 6.18. What it took:

- 30 files' default imports (`import maplibregl from 'maplibre-gl'`, `import
  type MapLibreGL …`) became namespace imports; three test mocks lost their
  `default` wrapper.
- About ten stricter types: `error` events carry `{ message }` rather than `Error`,
  `sourcedata`'s `source` is the full source spec, `createExpression` takes a
  key path, paint-property names and filter expressions are typed.
- **The worker.** MapLibre 6 finds its worker with a run-time
  `new URL('./maplibre-gl-worker.mjs', import.meta.url)` that neither Vite's
  dev pre-bundle nor the build can follow. `vite.config.ts` aliases the bare
  `maplibre-gl` to `src/lib/maplibre-gl-entry.ts`, which sets the worker URL
  from a `?url` import before any map exists, for every importer (toolkit,
  maplibre-gl-lidar, deck.gl) and without pulling MapLibre into the main chunk.
- geo-toolkit's dev dependency moved to `^6.18.0` (its peer range already took
  6); with it at 5, the workspace kept a second MapLibre and every exported Map
  type clashed. Its own check, lint, format and 231 tests pass on 6.18.
- The trial bench's HTML pages are excluded from Vite's dependency scan: the
  first commit of this trial put them where the scan found them, and their
  imports (EZ-Tree, maplibre-gl-three) stopped the dev server.

The visual-quality browser suite passes 21 of its 27 tests on MapLibre 6. The
other six also fail, the same way (controls not ready within their timeouts on
SwiftShader), on an untouched MapLibre 5 checkout of `main` run on this
machine; they were not a regression of the upgrade.

## 12. Other renderers fed our own scene

The second round found no engine that takes the inventory's stand. Rather than
adopt one, the road view now writes its scene out as a renderer-neutral file,
and each engine gets a small adapter, so the engines stay outside the app and
all draw the same evidence. Details and run instructions:
`forestry-visual-tools-trial/engines/README.md`.

- **The scene package** (`src/pages/dev-forestry/scenePackage.ts`, Sidebar →
  _3D scene for other renderers_): local metres, the terrain grid, every stem
  the road view draws (same patches and seeds; tested to match within 2 cm, no
  stem twice), openings, slash, road scars, the eye and lens, and each species'
  own detailed model. The roadside demo writes 15,945 stems, 802 slash piles and
  a 401 × 401 ground grid, 3.2 MB with models.
- **threejs-worldgen** (Apache-2.0), forked as a patch: its scatter now accepts
  fixed instances, and an example draws the package. It rendered the roadside
  demo from the road view's eye on WebGL2 (15,945 stems, 15,903 drawn).
  Its far impostors look like grey posts on SwiftShader; this needs a check on
  a real GPU.

![PGMaps road view and threejs-worldgen from the same package](forestry-visual-tools-trial/evidence/scene-package-pgmaps-vs-worldgen.jpg)

- **Nanite Forest** (MIT), forked as a patch: an example builds one Nanite type
  per species from the package's own models and places the package's stems.
  It typechecks against the library and runs its frame loop here. SwiftShader's
  WebGPU canvas reads back blank, though, and GPU stats never return, the same
  as Nanite's own examples. Not yet seen.
- **VistaWASM** (AGPL-3.0) is a **trial bench only**. A page of ours drives its
  public API with the package: `loadRawHeightmap`, `setTreeModel` with our
  models, `setTreeInstances` and `setCamera`. VistaWASM is installed by
  `npm install` in that folder only. It is never committed, never a dependency
  of the app and never deployed. The engine accepted the data, then lost its
  WebGPU device on this machine.
- **What the package loses in other engines.** VistaWASM and Nanite take one
  uniform scale per instance. A stem there keeps its height, but its crown
  width becomes its species' median. worldgen and PGMaps keep both.
- **EZ-Tree, again.** The forks use our own species models, not EZ-Tree's. EZ-Tree's
  geometry generator is MIT. Its bark textures were collected from texture sites,
  and its leaf textures state no source. Using its geometry with textures of our
  own would be fine; shipping its bundled textures would not (`AGENTS.md`).
- **Forks on GitHub.** This session's GitHub access covers only PGMaps and
  geo-toolkit, so creating the forks was refused. The patches and their base
  commits are in the repository instead. Forking the two upstreams and running
  `git am` makes them real forks.

## 13. On a real GPU, and chosen in the road view (13 November)

The second round ran on SwiftShader. This one ran the same scene package on an
Apple M4 Pro (Metal; headless Chrome 156 with the GPU on and the frame cap off),
and made the engines a choice in the road view itself: View options →
**Renderer** (`externalRenderers.ts`, `ExternalRoadRenderer.tsx`; contract in
`forestry-visual-quality.md`, **Choosing the renderer**).

![PGMaps, worldgen and Nanite in the road view](forestry-visual-tools-trial/evidence/road-view-renderer-switch.jpg)

**What was wrong in the adapters, now fixed** (diffs beside each patch in
`forestry-visual-tools-trial/engines/`, `0002-*.diff`, apply with `git apply`):

- **worldgen's "grey posts" were upside-down impostors**, on every backend, not a
  SwiftShader artefact. The bake stacks atlas cells bottom-up and three.js reads
  render-target textures top-down. `packages/scatter/src/impostor.ts` reads the
  row from the top; a far impostor also now takes its stem's own width ÷ height
  (it kept the preset's width). This is an upstream worldgen bug, worth reporting.
- **Nanite drew nothing** because the adapter's 4 × 4 colour layers were nearest
  filtered (three declares no sampler for those, the library samples them) and
  declared one mip level (`clamp(lod, 0, −0.001)` does not compile). Filtered and
  mipmapped as `examples/gltf.ts` does them, the stand draws. The library itself
  was never at fault: its own glTF example and the full forest ran here.
- Both adapters take the road view's `postMessage` bridge (`?embed`, hello →
  scene → camera, ready, stats, rebuild in page without reloading).

**Frame times, same package, same eye** (roadside demo at *View opening*, 15,909
stems; 1280 × 720 CSS px at 1.5×; 5 s held still with a forced redraw and 5 s
panning ±20°; machine shared with other sessions, so upper bounds):

| Renderer | Ready | Still: fps, median / p95 ms | Panning: fps, median / p95 ms | JS heap |
| --- | --- | --- | --- | --- |
| PGMaps road view (MapLibre, 1857 × 957 px canvas) | 5.9 s (whole page) | 216, 4.2 / 7.4 | 200, 4.8 / 7.2 | 279 MB |
| threejs-worldgen, WebGPU | 1.9 s | 174, 5.7 / 6.0 | 175, 5.7 / 6.0 | 127 MB |
| threejs-worldgen, WebGL2 | 3.0 s | 149, 6.5 / 7.7 | 146, 6.6 / 8.0 | 102 MB |
| Nanite Forest (WebGPU) | 2.5 s | 206, 4.9 / 5.2 | 200, 5.0 / 5.4 | 277 MB |

Chosen in the road view, an engine's frame and PGMaps' map draw together: the
page held 116 fps panning with worldgen over it and 135 with Nanite, each ready
about 2 s after it was chosen. Every renderer has headroom at this scene; none
is the bottleneck. For scale, Nanite's own demo (1 M trees, shadows, TAA,
grass) took 6–13 ms a frame here.

**Found on the PGMaps side, and fixed.** At this eye the package has the
opening's edge 8 m south of the road, so the engines facing south draw slash
from about 10 m, while PGMaps' road view drew a row of tall stems 15–30 m out
in that direction. No stem the road view held was there: the stems were the
ones 10–25 m *north* of the station, drawn in front because the camera stood
29 m behind it. `driveController.ts` placed the camera only when the station or
view changed, and MapLibre keeps zoom and centre through a resize, so after
*Fullscreen* the taller canvas put the camera further back from its target 40 m
ahead (solved from the frame's own matrix: x = y = w = 0 lies 29 m north of the
station). The canvas size is now part of the pose (`driveController.test.ts`).
Anything viewed or saved after resizing the road view before this fix was seen
from behind the station; the analysis, which runs from the station, was not
affected. The PGMaps timings above were taken in that state.

**Still different between the engines** (display, not evidence): Nanite takes
one uniform scale per stem (heights kept, crown widths become the species'
median), draws foliage opaque, and does not draw openings, slash or road scars;
worldgen's species are its own presets (feathery spruce and fir, white aspen
and birch trunks) and its haze is bluish. Screening must be judged on PGMaps.

**What the engines' own demos add, for later.** Nanite's forest gets its look
from ez-tree branches and leaf cards, sun shadows, god rays, TAA and a textured
floor with litter and grass; its bark and leaf textures are ez-tree's, whose
sources are unstated, so they stay out of anything PGMaps deploys. worldgen's
`threejs-trees` draws leaves procedurally (no image files, Apache-2.0), with 29
species presets; `threejs-water` draws lakes and rivers with reflection, glint,
foam and Beer–Lambert colour, and computes them from a DEM;
`threejs-weathering` and `threejs-sky` give snow, rain, fog, burnt states and a
sun placed by date, time and latitude. For a VIA the honest uses are real lakes
and streams (BC FWA, not computed) for water viewpoints, snow on openings for
a winter view, and the field visit's sun.

## 14. Richer engines, water and weather (13 November, later)

Asked to bring Nanite's demo look across and to try `threejs-trees`,
`threejs-water` and `threejs-weathering` (non-B.C. tree shapes accepted for
now, and the ez-tree images used regardless of their unstated licence, for a
local trial only). The engine work is in each folder's `0003-*.diff`
(`engines/README.md`); PGMaps gained what the engines need to be fed.

**PGMaps side.**

- The package carries `water`: the basemap's lakes and rivers cut to the
  terrain grid (`polygon-clipping`), each at the lowest ground round its shore.
  Uncut, the roadside demo's river system came through 45 km across.
- With an engine chosen, View options adds *When* (date and local time),
  *Ground* (bare or snow) and *Weather* (clear, overcast, rain, snowing), sent as
  `pgmaps-environment` with that day's UTC offset. A change never rebuilds the
  stand. In the app, 20 January 15:30 put the sun 5.6–5.8° up in the south-west
  in both engines.
- The road view's own camera fix (§13, *Found on the PGMaps side*).

**Engines** (screenshots: `evidence/road-view-engines-weather.jpg`):

- *worldgen*: each species grown from `threejs-trees` in two or three height
  classes at the package's own sizes (full mesh to 55 m, simplified to 120 m,
  coarse to 190 m, impostors beyond); `threejs-sky` sky and clouds, with haze
  taking the sky's horizon colour (the blue fog is gone); `threejs-water` lakes
  with reflections; cut ground with duff, about 500 stumps a hectare and slash
  heaps; snow, rain and wet materials from `threejs-weathering`.
- *Nanite*: ez-tree conifers and broadleaves with leaf cards, the demo's
  dithered leaf edges and TAA, three crown-width classes per species (crown
  width within 7.0% on average, 11.8% at the 90th percentile; heights exact),
  4096 shadow map, god rays, the demo's floor with litter, cut ground, slash,
  WaterMesh reflections, and the same weather. Its wind sway is off: its
  motion output broke every tree material inside the water's reflection.

**Frame times, same package and eye as §13** (uncapped; shared machine, so
upper bounds; PGMaps now with its camera at the station):

| Renderer | Ready | Still: fps, median / p95 ms | Panning: fps, median / p95 ms |
| --- | --- | --- | --- |
| PGMaps road view | 6.1 s (whole page) | 208, 4.3 / 7.8 | 195, 5.0 / 8.0 |
| threejs-worldgen, WebGPU | 2.3 s | 268, 3.6 / 4.3 | 268, 3.7 / 4.3 |
| threejs-worldgen, WebGL2 | 3.7 s | 177, 5.8 / 6.7 | 171, 5.6 / 10.3 |
| Nanite Forest (WebGPU) | 4.1 s | 168, 5.9 / 7.1 | 169, 5.8 / 7.2 |

In the app, with vsync, worldgen was ready 2.5 s and Nanite 2.2 s after being
chosen, both holding 60 fps. Worst cases: worldgen looking straight into the
stand ran 70–80 fps (leaf-card overdraw; nothing hides trees behind trees), and
Nanite's lake view took 11–18 ms a frame.

**A benchmark trap.** With the frame cap off (`--disable-frame-rate-limit`),
neither engine finished building inside the app: the engine page is on the same
site as PGMaps (another port on 127.0.0.1), so it shares PGMaps' main thread,
and the road view's animation loops running thousands of times a second starved
it. The same build took 1.8 s as a top-level page. Test the embedded engines
with vsync on; time them as pages of their own.

**Left to do.** worldgen's open snow reads as a flat sheet and its winter
aspens keep their leaves; Nanite's aspens read lime, its litter orange and its
crowns stay bright at dusk; neither draws B.C. tree shapes yet, so screening is
still judged on PGMaps.

## 15. Review of 13 November: the engines toward a VIA view

An outside review of the three repositories against the reference VIAs
(Gun Lake West Boat Launch, Marblehead CP421 VP2, Salisbury/Lost Ledge)
asked for one real viewpoint that can be reopened and regenerated into matching
reference, existing, proposed and measurement panels. Its source-level claims
were checked against the code before acting on them; all held.

**Done (batch 1: reproducible inputs).**

- *Stable trees.* worldgen chose each species' height classes from quantiles of
  the stems present and Nanite clustered crown ratios over them, so a harvest
  could move a retained stem into another class with other branches. Both now
  use a fixed ladder (worldgen heights 4·√2ᵏ m, 4–62 m; Nanite crown ratios
  ×1.31 from 0.08 to 1.2) seeded by species and rung; each engine's test removes
  40% of a stand and checks every kept stem's class, size and seed. PGMaps' own
  package was already stable (stems are seeded per grid cell); a test now pins
  it. Nanite grows 35 tree types for the demo stand instead of 18 (5.3 s build;
  growth workers capped at 2–6 after 35 at once ran out of WASM memory).
  Nanite's crown error is now measured on the drawn model: 6.7% mean, 12.0% at
  the 90th percentile.
- *The site's clock.* The date and time were read in the computer's time zone;
  they are now read on the site's (`siteTimeZone`), and the message carries the
  zone and the UTC instant.
- *One sun, and the sun drawn.* PGMaps sends NOAA's sun; both engines light
  from it (16:15 on 20 January at Prince George: 0.9° at 233.1° in both, where
  worldgen's own ephemeris had 0.6°). *Sun: True position* (the default) drops
  Nanite's 6° floor and worldgen's move of a night clock to dusk; *Kept to
  daylight* keeps them, and the status line says "lit as 6.0°" when the light
  differs from the sun.
- *Seating.* worldgen seats stems on its 15 m ground rather than their own
  heights; it reports the adjustment (demo stand: 0.6 m at most, 0.09 m mean).

**Left (in the review's order).**

1. *Camera and projection metadata* — the viewport and perspective saved with a
   package and replayed (work under way in another session, `sceneCamera.ts`),
   then checked through resize, save and reload, engine switch and export; and
   a choice, recorded per view, between a calibrated single perspective and one
   cylindrical panorama (the reference sheets fit as 60–141° cylinders; PGMaps
   captures perspective frames side by side).
2. *Real terrain to the skyline.* Both engines pad the package's 3 km grid with
   invented ground easing to its mean (worldgen to the far plane, Nanite 16 km);
   an assessment view needs sourced terrain through the visible horizon, sized
   from the viewpoint and its frame, finer than 15 m near the assessed landform,
   with missing data marked.
3. *The engine's image as the report figure* — done; see §16.
4. *Forest form and season* — species forms calibrated to the reference stands,
   leaf-off as a vegetation state that the screening mask uses too, and
   detail-transition checks.
5. *Ground, water and light* — river profiles and documented lake levels instead
   of one level from the lowest shore, stumps from the removed stems rather than
   500 a hectare, and an exposure held across a before/after pair.

## 16. The engine's picture as the analysis sheet's figure

*Save viewpoint* with an engine chosen now takes the analysis sheet's frames
from the engine (`engineCapture.ts`, protocol `pgmaps-capture`): a scene whose
terrain reaches a kilometre past the landform and blocks, then, for each frame
of the framing plan, the picture, a class pass in the sheet's palette (the
engine's trees white, its water orange) and depth along the view axis, from one
scene and one camera. PGMaps refuses a reply drawn from another camera, decodes
the pass with `ENGINE_CLASS_PALETTE`, and the sheet's outlines, callouts and
pixel measure come from it, with a line naming the renderer and its version.
The sightline figure stays PGMaps' run.

- *Alignment.* Both engines' cameras reproduce `projectToFrame`'s pinhole to
  under 0.001 px in their unit tests. In a picture, Nanite's class edges sat
  0.25 px from it in the median (0.73 px at worst); worldgen's ground classes
  disagreed with point-in-polygon on 0.024% of pixels, all on cell edges.
- *Cost.* Two 1200 × 900 frames: Nanite 0.56–0.68 s (24 TAA frames each for
  the picture), worldgen 0.14–0.17 s warm on WebGPU, 0.19–0.22 s on WebGL2.
  With the capture scene's larger terrain, *Save viewpoint* took 6 s in the app
  for either engine.
- *A reference lake viewpoint* (the landform 4 km away across the water, two
  50 mm frames, 79°): pixel measure 22.2% from PGMaps' map, 21.4% from Nanite's
  capture and 21.6% from worldgen's; sightline 21.2% in all three. The
  outlines follow each engine's own ridgelines.
- *What the pictures do not yet show.* Both engines draw stems only within
  about 600–650 m, so a hillside 4 km off is bare ground: the block is outlined
  but no cut is visible, and worldgen's haze greys the far slope. The capture
  says so in its `missing` notes, which the saved figure keeps
  (`FigureIllustration`), but the sheet does not print them. This is item 2 of
  §15 (real terrain and forest through the skyline), now the next step.
- VQO zone shading is not drawn on an engine's picture; the saved figure says
  so.

## 17. Reference viewpoints, one sky, outlines on the ground

Three reference VIAs were set up as scenes and drawn by all three renderers
under one sky (no cloud, no haze, 15 August 13:00): a lake viewpoint with the
consultant's landform traced back to the ground (with FTEN blocks and with
their drawn net block), a scenic viewpoint over a dam, and a lakeshore
campground whose blocks were later logged and photographed by the Forest
Practices Board. Each viewpoint is a 30 m stub starting at the printed point;
the two that stand in forest get a 120 m tree-free fan facing the view, as
their VIA photos show them open.

What changed to make the engines comparable:

- *Far forest and real skyline.* Capture scenes carry stems to half a
  kilometre past the landform (about 60–70k stems out to 7–9 km) and coarse
  terrain to 15 km from a skyline mosaic, in place of the engines' invented
  ground. worldgen draws far stems as cards, Nanite as wide clump types.
- *One sky.* `cloudCover` and `visibilityKm` in the environment, honoured
  exactly by both engines; *No haze* by default. worldgen's sun was also
  rebalanced against its sky (a sunlit white surface about 3.9× the horizon,
  from 1.4×), and its lake now reflects the far shore.
- *Outlines on the ground.* The ground pass (no trees) gives outlines and the
  pixel figure, as the VIAs' renders draw them over the forest; the screened
  pass (trees in their ground's class) gives a second figure.

Printed figures (percent):

| Viewpoint | VIA printed | Sightline (PGMaps) | PGMaps map pixel | worldgen ground / with trees | Nanite ground / with trees |
| --- | --- | --- | --- | --- | --- |
| Lake, their landform, their net block | 5.05 | 9.54 | 7.80 | 9.39 / 10.58 | 9.38 / 10.78 |
| Lake, their landform, FTEN blocks | 5.05 | 11.81 | 9.50 | 11.30 / 12.57 | 11.30 / 12.86 |
| Scenic viewpoint over the dam, VSU landform | 7.8 | 23.69 | 29.18 | 23.69 / 21.72 | 23.70 / 20.09 |
| Lakeshore campground, VSU landform | 3.9 | 17.12 | 17.92 | 17.32 / 13.77 | 17.26 / 14.12 |

- The engines' ground figures agree with each other to 0.06 points and with
  PGMaps' sightline figure to 0.2 points: two methods on the same terrain and
  polygons, which checks the capture cameras and framing.
- The gap to the printed figures is the inputs the earlier studies found
  (landform, gross FTEN blocks against drawn net blocks), not the renderer:
  with the consultant's own landform and block it falls to 4.3 points.
- Against the Board's after-logging photo, every renderer draws the cuts as
  bare tan ground that reads far stronger than the real, partly retained and
  greening blocks; the far forest reads sparse (worldgen) or blotchy (Nanite)
  against real closed canopy; a peak beyond the 15 km terrain is missing from
  both engines' skylines at the campground; and at the dam viewpoint the photo
  looks down from a higher vantage than the eye placed on the DEM.
- Reference images and block names stay out of the repository; the boards are
  kept with the VIA research files.

## 18. Closing the look gaps: cut age, closed canopy, skyline, viewpoints

Five changes, then the reference viewpoints again under one sky:

- *Skyline.* The missing peak at the campground stands 16.6–19.4 km away,
  past the 15 km terrain; a peak 26–32 km off was missing at the lake
  viewpoint too. A capture now scans the frames' skyline (`skylineReach.ts`,
  Terrarium z10 to 60 km, curvature and refraction k = 0.13) and adds a coarse
  `skylineTerrain` grid out to it (22 km at 88 m there, 36 km at 144 m at the
  lake), heights already dropped for curvature; both engines draw it and their
  far planes reach it.
- *Package cover.* `terrain.canopy` (crown closure per post, from the same
  stands, VRI closure and clearings the road view grows from), and each
  opening's `ageYears` and `retainedShare` (`sceneCover.ts`).
- *Engine looks.* Both engines green cut ground up with age (grey-brown soil and
  slash at one year, shrubs by five, green by ten) and shade forest ground by
  crown closure, so far stands read closed. Measured cut-to-forest brightness
  for one-year cuts, no haze: worldgen 1.5–1.6, Nanite about 3.7; the Board's
  hazed photo reads 1.1–1.3 (about 1.3–1.9 de-hazed by worldgen's estimate, 3.3–4.8
  by Nanite's), so the two engines bracket it.
- *Viewpoints.* Stood-at viewpoints get an automatic tree-free fan (120 m,
  ±70° about the view, display only) and an optional surveyed eye elevation.
  At the dam viewpoint the DEM reads 9.8 m *above* the printed 636 m, so the
  eye was not low: the trunks were forest grown to the eye.
- *Retention in the class pass.* `retained` masks are cut out of the blocks'
  class layers, as the run already treats them; every sheet's pixel figure had
  counted reserves as cut.

The campground case was also run as logged: the nine RESULTS group reserves of
the permit (66.8 ha) standing, the blocks harvested in 2022 and viewed in 2023.

| Viewpoint | VIA printed | Sightline | PGMaps map pixel | worldgen ground / with trees | Nanite ground / with trees |
| --- | --- | --- | --- | --- | --- |
| Lake, their landform and net block | 5.05 | 9.54 | 7.85 | 9.39 / 10.56 | 9.38 / 10.79 |
| Dam viewpoint, VSU landform | 7.8 | 23.69 | 29.18 | 23.69 / 21.74 | 23.70 / 20.04 |
| Campground, VSU landform, FTEN blocks | 3.9 | 17.12 | 17.92 | 17.32 / 13.77 | 17.24 / 14.11 |
| Campground as logged (reserves standing) | 3.9 | 13.33 | 13.00 | 12.63 / 9.22 | 12.58 / 9.55 |

As logged, every figure falls in the Modification range, which is what the
Forest Practices Board found the logging achieved from this viewpoint; the VIA
had predicted Partial Retention at 3.9%. Against the Board's photo the
engines now show the peak behind, a closed forest and muted one-year cuts with
their reserves; the cuts still read somewhat stronger than the photo's, whose
haze PGMaps' captures leave out by default.

## 19. Far forest, water and a final-render mode: findings and plan

A survey of the local reference collection, a diagnosis of our far trees and a
review of what other tools do (the case-specific write-up is kept with the VIA
research files, not here):

- *The references.* About 75 of the reference figures are fully modelled
  renders, mostly Visual Nature Studio; most comparisons so far were
  photomontages. Fifteen modelled renders already have a clean image and a
  fitted camera (cylindrical panoramas of 60–141°, not the printed 50 mm).
  They draw distant forest as a dense canopy of individual conifer sprites
  that reads as fine vertical texture at 3–7 km, and lakes as crisp mirrors;
  the paired photos show the same texture but blue-grey with distance and
  wind-rippled water.
- *Why ours read as shrubs.* Past 2.8 km each drawn stem stands for 400–1,000
  real trees and is widened to keep the stand's closure (55–58 m wide, 22 m
  tall), so it draws as a squat blob. At 3.5–6.5 km our vertical-edge ratio is
  0.56–0.8 against 1.81 in the render; trees cover 16–42% of the hillside
  against 80–95%; there is almost no shadow between crowns; colours are too
  saturated; PGMaps' sheet is upscaled 2.3× from the road-view canvas; and
  worldgen's impostor atlas has no mipmaps. Heights are right. Supersampling
  sharpens but does not change the shapes.
- *What others do.* VNS dissolves trees under 2–4 px tall to a canopy texture
  and draws full density above that; game engines draw a canopy surface raised
  by stand height with crown-scale shading, impostors in the middle distance and
  coverage-preserving mipmaps; lakes use planar reflections with Fresnel F0 near
  0.02 (three.js's `WaterMesh` uses 0.3) and wind roughness from Cox–Munk;
  final stills freeze the camera, wait for streaming, accumulate samples and
  tile (Unreal Movie Render Queue, Lumion photo mode, Google Earth Studio).

The plan: an *active* mode that stays fast (stand impostors in place of the
clump band, a canopy surface past ~4 px tree height, mipped cards, desaturated
canopy, cheaper reflections) and a *final* mode started at *Save viewpoint*
that regrows the frame's forest at real stem density with real crowns, draws
full planar reflections, waits for streaming, fits shadows to the frame,
accumulates 16–32 samples and tiles to sheet resolution, with two look
presets (the consultants' convention and a photo match). The ground class pass
never draws trees, so its figure is unchanged by the mode; the screened figure
is reported for both modes. Targets at 3.5–6.5 km: vertical-edge ratio ≥ 1.3,
shadow 0.04–0.10, saturation ≤ 0.2, tree or canopy cover ≥ 80%.

## 20. A reference library, a final mode and natural cover

A library of 40 reference viewpoints, built from the fully modelled VIA
renders in the local collection (14 with a fitted camera and the consultant's
traced landform; the rest from the printed position and bearing), is rendered
by a harness through PGMaps, worldgen and Nanite under one sky, with boards and
texture metrics against each reference. The library and harness are kept with
the VIA research files, not in this repository. All 120 renders ran; with the
harness's speed-ups (one page per case, a persistent cache, a "sheet ready"
signal, 8-sample drafts, two cases at a time) a case takes about 70 s instead
of 4.5 minutes.

Changes this round:

- *Final mode.* A capture asks the engine for `quality: 'final'`: a
  real-density stand of the frame's forest (`finalStand.ts`, up to 1.5 M
  stems, about 0.6–0.8 s to grow), accumulated samples, shadows fitted to the
  frame and full-resolution reflections; PGMaps' own map captures at up to 3×
  pixel ratio. *Wind* and *Look* (VIA convention or photo match) join View
  options.
- *Far forest.* Both engines replace the squat far stems with stand patches
  and a canopy surface past ~4 px tree height; vertical-edge ratio at
  3.5–6.5 km rose from about 0.65 to 1.0–1.5.
- *Water.* Fresnel F0 0.02, Cox–Munk roughness from the wind, planar
  reflections with the forest in them; sea from terrain at or below 0 m.
- *Natural cover.* `terrain.cover` per post from VRI BCLCS and slope (forest,
  sparse, shrub, herb, rock or bluff, water, cut); both engines draw rock
  bluffs, grass and shrub openings and keep trees off rock and water.
- *Fixed framing.* `scene.figureFrame` frames the sheet on a reference's
  bearing span (tiled ≤ 40° frames, about a cylindrical panorama), keeping the
  water and sky rows.
- *Sheet fixes.* PGMaps' class pass hid the map's layers but not the 3D trees
  (a custom layer `getStyle().layers` omits), so its outlines traced tree
  silhouettes; it is now the ground under the trees, like an engine's ground
  pass. Callouts sit in one ordered row (`rowPlacement`): no overlaps, no
  leader crossing another or running behind a box; blocks the view does not
  see are listed once in the facts.

Across the 40 cases the two engines' ground pixel figures agree to a median of
0.02 points (largest 0.62), and the ground pixel figure sits within a median
0.5 points of the sightline figure; the large differences (up to 33 points)
are fixed frames narrower than the landform, where the pixel figure counts only
the part in the picture. Open points: at some viewpoints our terrain or eye
differs from the consultant's (near hills they do not draw); the VNS renders
show more pale rock bands than VRI marks as rock; the renders draw dense forest
where VRI now records burnt or open ground; and Nanite's vertical texture is
still short of the target.
