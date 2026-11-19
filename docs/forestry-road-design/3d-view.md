# 3D view: rendering, inspection and verification

The road designer's primary 3D view is a local **WebGL2 scene using Three.js 0.186.1**.
It draws sampled source ground, the selected engineering design surface and calculated culverts
with GPU depth testing. The earlier canvas/SVG preview remains available when acceleration or
bounded ground clipping cannot be used. This changes the picture, not the road calculation.

Open **3D** in the road detail panel. **Whole road** frames the corridor; **Around station**
shows a 240 m window centred on the shared selected station. The plan, profile, section and
station schedule continue to use that same chainage. See the
[workspace contract](../forestry-road-design.md#terrain-display-and-connected-views) and
[terrain source checks](terrain-and-point-clouds.md) for the underlying data rules.

## Controls and what they mean

| Control | Behavior |
| --- | --- |
| **Fit** | Fits actual coarse ground and design vertices. Empty corners of the enclosing box no longer determine the picture's size. A later detail patch does not move the fit. |
| **Finished / Subgrade** | Chooses one exact design TIN while batters are shown. These surfaces overlap outside the formation, so they are not drawn as two competing opaque surfaces. |
| **Auto quality / High quality / Efficient** | Sets the ground sampling and screen-pixel budgets below. Auto reduces screen pixels during camera movement and sharpens after it stops. |
| **Slope / Elevation / Plain** | Colours sampled ground. Slope is in true, unexaggerated metres; lighting follows the drawn geometry. These colours are not aerial photography. |
| **Orthophoto** | Appears when the project has a visible imported orthophoto. Uses that layer's CRS, retained RGB(A) pixels and opacity. A selector appears if more than one is available. No imagery request is made by the viewer. |
| **Batters** | With batters shown, the exact surface includes its supported formation and earthworks. Hiding them uses the simplified formation-only drawing and cuts only that visible footprint out of ground. |
| **Fill gaps** | Keeps the existing optional estimated ground patches, initially on. Estimates are marked in the drawing and never enter engineering calculations or exports. |
| **X-ray structures** | Makes ground translucent and shows buried culverts through intervening surfaces. The structures stay at their calculated locations and elevations. |
| **Cutaway at selected station** | Clips the picture at the selected cross-section and prints a display-only notice. Moving the station moves the clipping plane. |
| **Height Auto / ×1 / ×2 / ×4** | Scales the displayed scene vertically. Auto picks the smallest of ×1, ×2 and ×4 that makes the road's ground relief at least a tenth of its extent. Source levels and quantities stay unchanged. |
| **Wireframe** | Shows triangle edges for inspection. It does not change the source surface or add detail. |

Drag pans; right-drag, Ctrl-drag or Alt-drag rotates and tilts. Scroll/pinch zooms toward the
pointer. Double-click zooms in there, and Shift-double-click zooms out. Arrow keys pan,
Shift+arrows rotate/tilt, +/− zoom and Home fits. The compass turns north up; the station-centre
button moves the focus to the selected station. The scale bar is measured at the focus.

The GPU scene uses the same projection as the SVG labels and the existing pointer-anchored
camera. A road-surface ray hit selects the nearest calculated station in horizontal scene
coordinates. A culvert hit selects its ID and station. Ordinary ground occludes hidden road
hits; X-ray gives buried culverts priority. Selection overlays remain separate from the
engineering surface.

## Geometry and source contracts

The main modules live in `src/pages/dev-forestry-roads/`:

| Module | Responsibility |
| --- | --- |
| [`TerrainPreview.tsx`](../../src/pages/dev-forestry-roads/TerrainPreview.tsx) | Shared station, camera, controls, source sampling, stable fit geometry, detail window, labels and fallback selection. |
| [`terrainSceneGeometry.ts`](../../src/pages/dev-forestry-roads/terrainSceneGeometry.ts) | Shared export-CRS frame, exact design buffers and bounded subtraction of the chosen design footprint from display ground. |
| [`terrainScenePresentation.ts`](../../src/pages/dev-forestry-roads/terrainScenePresentation.ts) | Combines ground/design/line/culvert inputs, image coordinates and availability notices without querying the terrain. |
| [`TerrainGpu.tsx`](../../src/pages/dev-forestry-roads/TerrainGpu.tsx) | React-owned canvas and lazy renderer lifecycle. The Three.js module is loaded only when this pane needs it. |
| [`terrainGpuRenderer.ts`](../../src/pages/dev-forestry-roads/terrainGpuRenderer.ts) | GPU buffers, materials, lighting, texture, depth, clipping, picking, requested frames and resource disposal. |
| [`terrainRenderQuality.ts`](../../src/pages/dev-forestry-roads/terrainRenderQuality.ts) | Pure screen-pixel limits, independent of engineering calculations. |
| [`terrainMesh.ts`](../../src/pages/dev-forestry-roads/terrainMesh.ts) | Bounded, fixed-grid display sampling, cached missing/finite values and explicitly estimated gap patches. |
| [`previewCamera.ts`](../../src/pages/dev-forestry-roads/previewCamera.ts) | One perspective/focus model for GPU drawing, overlays and interaction. |

### One projected frame

`terrainSceneFrame` uses `exportGrid`: the terrain's supported projected CRS, or the same local
UTM grid used by engineering exports when terrain is geographic. The first station's projected
easting/northing becomes the local horizontal origin. Ground, section offsets, structures,
camera and picking all use that frame, including the grid's orientation. Section offsets are
projected from their geographic coordinates rather than added along an unconverted compass bearing.

The adapter retains source elevations in metres. The GPU subtracts a nearby elevation origin
before drawing and applies the selected vertical exaggeration to the scene. Neither operation
changes project coordinates, source heights, datums or analysis. This is not a vertical-datum
conversion.

### Exact engineering faces, with incomplete intervals left open

`terrainSceneGeometry` calls `designSurface('finished' | 'subgrade', ...)`, the same surface
builder used by engineering export. It keeps each point and triangle index, piece chainage
range and folded-face count; it does not retriangulate the surface. Local `Float32Array`
positions and `Uint32Array` indices go to the GPU. Double-precision footprint triangles remain
available for ground clipping.

Only consecutive complete sections produce an exact piece. Gaps and their reasons remain in
the adapter result; an incomplete design is labelled. Invalid-input guards are retained, and
an unavailable exact surface produces a notice and simplified presentation. Smooth ground
lighting must never smooth design breaklines or make an incomplete analytical section complete.

### Ground outside the designed corridor

`clipTerrainToDesign` subtracts the union of exact XY footprint triangles from convex sampled
ground faces. A bounded spatial index restricts candidate checks. Using triangles handles
overlapping or folded design footprints without relying on a possibly self-intersecting outer
ring. Each cut ground vertex is interpolated on its original sampled ground face; it is not
lowered to an invented road elevation. Face colour and estimated status are retained.

The GPU therefore depth-tests ground outside the corridor against the exact road surface,
including deep cuts. With batters hidden or an exact TIN unavailable, clipping follows the
simplified surfaces actually being drawn. A clipping-budget exception discards the attempted
result and requests the canvas/SVG compatibility preview with an explanation; it never displays
a half-clipped ground mesh.

Missing source faces remain absent. Existing **Fill gaps** can add explicitly estimated display
patches only for enclosed unsupported components no wider or taller than 80 m, using at most
128 relaxation iterations. Measured vertices are unchanged; boundary-connected and larger gaps
stay open. All estimates stay out of the terrain sampler, analysis and exports. A coarse ground
face can differ slightly from the source level at an exact catch point, so cut-edge seams still
need visual inspection; drawing must not repair those seams by changing survey heights.

### Ground appearance, images and structures

Natural ground shares identical vertices and computes smooth normals. Estimated vertices
remain separate from measured ones. Design faces use flat shading and preserve their original
breaklines. Ambient and directional lights give relief without a shadow-map or postprocessing
pipeline. The renderer requests antialiasing and uses sRGB colour output; hardware support and
the effective drawing size still determine the final edge quality.

Orthophoto coordinates are transformed through the image's own CRS. Imported image origins are
pixel centres; the outer corner is half a pixel away. Texture coordinates retain north-to-south
row order and cover only the image footprint. The renderer uses linear filtering, mipmaps and
up to 8× supported anisotropy, blending alpha and the layer's existing opacity over ground.
Transparent/no-data pixels and points outside the image do not stretch an edge colour across
the scene. Existing import/downsampling limits still apply: High quality cannot recover pixels
discarded when a large background was imported. The viewer does not download a new basemap or
orthophoto.

`terrainGpuTexture.ts` bounds both texture sides by the graphics device's `MAX_TEXTURE_SIZE`.
A long, thin image can exceed that limit even when its pixel area fits the import budget. In
that case the existing alpha-aware resampler creates a separate display copy with the same
geographic footprint; the project's original imported pixels and normalized UVs are unchanged.

Culverts use their calculated inlet/outlet inverts and entered rise, span, shape and barrel
count. Unknown endpoint elevations do not produce an invented barrel. Multiple barrels are
centred about the calculated site axis; their separation is schematic because the project has
no installation-spacing field. Box outlines retain corners; arch outlines are schematic.
The rendering tooltip states these limits. Vertical exaggeration is a display setting, so use
×1 when judging proportions.

## Resolution and bounded work

Source resolution, display-mesh spacing, image pixels and drawing-buffer pixels describe
different things. A larger drawing buffer improves the displayed edges; a denser display mesh
can retain more available source shape. Neither improves source accuracy or creates terrain
detail that the source does not contain.

| Quality | Longest-side ground sample budget | Settled device-pixel-ratio cap | Settled drawing-buffer area |
| --- | --- | --- | --- |
| **Auto** | 192 | 2 | 4,000,000 pixels |
| **High** | 256 | 2 | 8,000,000 pixels |
| **Efficient** | 128 | 1 | 1,500,000 pixels |

Auto uses DPR ≤1.25 and at most 1,500,000 pixels while the camera moves, then requests a sharper
frame after **350 ms** without another camera change. High and Efficient hold their selected
pixel budgets. Every mode also respects the device's actual DPR and an **8,192 px maximum side**,
or the renderer's smaller hardware limit. Effective DPR may be lower than the listed cap. These
are allocation/work limits, not measured frame-rate guarantees.

Ground spacing rounds upward on the existing 1/2/2.5/5/10 decade ladder. Both the selected side
budget and the terrain's stated source-resolution floor must be satisfied. The helper and stable
base-fit mesh keep their 128-side default. Zoom spans 0.35–16×; from 2×, a separately sampled
patch around the focus covers about twice the visible width, under the same quality/source
limits. That patch is snapped to coarse cells and half-window steps and prepared 180 ms after
the view settles. The base fit, colour range and median elevation remain stable.
After a reported renderer failure or context loss, the selected mesh budget drops to 128 while
the canvas fallback is in use. A clipping-budget fallback remains bounded by the selected mesh
budget. Fit deduplicates shared coarse vertices; true-north and along-road headings are transformed
into the same projected frame as the geometry.

| Additional drawing limit | Bound | Response |
| --- | --- | --- |
| Exact design footprint | 250,000 triangles | Report an unavailable exact surface and retain simplified presentation. |
| Spatial-index memberships | 2,000,000 | Coarsen lookup cells only; design triangles are unchanged. |
| Ground polygon/triangle checks | 4,000,000 | Report the limit and use the complete canvas/SVG preview. |
| Clipped pieces per source face | 256 | Report the limit and use the complete canvas/SVG preview. |
| Clipped output faces | 1,000,000 | Report the limit and use the complete canvas/SVG preview. |
| Cached source samples | 262,144 in the accelerated scene; helper default 65,536 | Evict the oldest finite or missing result and reuse fixed-grid overlaps. |

The named constants are in `terrainSceneGeometry.ts`, `terrainMesh.ts` and
`terrainRenderQuality.ts`; the selected scene/cache budgets are in `TerrainPreview.tsx`.
Keep this guide and the [terrain limits table](terrain-and-point-clouds.md#limits-and-budgets)
in step with them. These bounds do not cap the browser tab's total memory.

## Rendering lifecycle and fallback

The renderer requests a frame after data, camera, size or display settings change. It does not
run a perpetual animation loop. Auto's delayed sharpen requests one further frame. Camera-only
changes reuse buffers; data changes rebuild the scene and release replaced geometry, materials
and textures. Scene geometry is still prepared on the main thread.

React owns the canvas. Three.js does not reparent or remove it. Fullscreen and resize update
the same scene's dimensions and camera; an actual unmount releases the renderer. The canvas/SVG
preview remains visible until a complete GPU frame is ready. Unavailable WebGL2, renderer errors,
context loss and clipping-budget failure expose a reason and retain usable simplified drawing.
Context restoration can request a fresh GPU frame without replacing the project's source data.

The compatibility path retains the existing canvas ground, SVG formation/structure selection
and software occlusion cover (`terrainOcclusion.ts`). It is explicitly a simplified subgrade
preview. Exact-surface selection, quality, orthophoto, X-ray and cutaway controls require an
active GPU scene. The selected station and the analytical road are independent of that choice.

## Verification

**Implementation validation recorded 19 November 2026:** the initial standalone road-designer
build and its `verify-build` check passed. After integration with the latest main branch, all
71 focused tests across nine files and a strict TypeScript check of the renderer/integration
modules and their imported dependencies passed. The final standalone rebuild reached chunk
rendering after transforming 7,140 modules, but was terminated with exit 137 in the execution
environment. Full root-workspace and standalone-workspace typecheck attempts were also
terminated with exit 137. The final production build and those full typechecks still need a
successful run in a suitably resourced environment.

The geometry/presentation unit checks cover exact finished/subgrade export parity, projected
coordinate round trips, source-resolution floors and bounded sampling, missing/estimated
coverage, deep-cut and overlapping-footprint clipping, hidden-batter ground retention, multiple
culvert barrels and a real PixelIsArea RGB GeoTIFF imported in a different CRS. The camera and
render-size checks cover matching projection, fit and pixel budgets. Run the focused suite with:

```sh
npx vitest run \
  src/pages/dev-forestry-roads/terrainSceneGeometry.test.ts \
  src/pages/dev-forestry-roads/terrainScenePresentation.test.ts \
  src/pages/dev-forestry-roads/terrainMesh.test.ts \
  src/pages/dev-forestry-roads/terrainRenderQuality.test.ts \
  src/pages/dev-forestry-roads/terrainGpuRenderer.test.ts \
  src/pages/dev-forestry-roads/terrainGpuTexture.test.ts \
  src/pages/dev-forestry-roads/TerrainGpu.test.tsx \
  src/pages/dev-forestry-roads/TerrainPreview.test.tsx \
  src/pages/dev-forestry-roads/previewCamera.test.ts
npm run road-design:check-boundary
npm run road-design:build
```

**Browser verification is pending.** Browser execution was blocked in the implementation
environment, so the new GPU viewer has no verified screenshot, frame-rate result or target-device
performance claim from that session. The added
[`forestry-road-3d-renderer.spec.ts`](../../tests/e2e/forestry-road-3d-renderer.spec.ts) suite was
not run there. It checks requested/idle rendering, camera changes without geometry rebuilds,
quality bounds, surface/X-ray/cutaway changes, transect station selection, nested fullscreen, resize, repeated view switching
and unavailable-WebGL fallback. Run it against a prepared checkout with:

```sh
npx playwright test tests/e2e/forestry-road-3d-renderer.spec.ts --project=chromium --workers=1
```

The normal Playwright configuration starts its local server. `PGMAPS_E2E_BASE_URL` can instead
point to an already running prepared deployment; `PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` selects an
installed browser when needed. The suite's screenshots and counters become evidence only after
an actual successful run. Its software-rendered Chromium checks do not replace measurements on
the computers used for road planning.

Before release, also inspect real LiDAR and imported ground with deep cuts, tall fills, data
edges, incomplete sections, tight bends and multiple structures. Check fit and imagery in both
display windows, switch DPR/fullscreen sizes, and test context loss/restoration. Measure interaction
frame times, stationary work, preparation stalls and memory on representative integrated and
discrete GPUs; record the road, source, viewport, mode and hardware alongside each result.

## Remaining work

The current implementation supplies bounded local geometry and one finer focus patch. It does
not yet provide a tiled terrain hierarchy, screen-error selection, progressive streamed mesh
levels or a complete seam/stitching strategy between levels. Those are the next scalability
steps after browser measurements identify the actual cost.

Worker-based sampling, clipping and buffer preparation remain deferred; moving a large project
through those CPU stages can still block the main thread. Any worker protocol must preserve
source gaps, exact design topology, cancellation and the last complete displayed scene.

Named saved 3D cameras, an along-road flythrough and a dedicated viewer image/scene-export
workflow remain deferred. Existing engineering exports and project persistence are unchanged.
Measured render-quality tuning, finer imagery delivery and cut-edge/seam inspection also remain
work to validate, rather than capabilities implied by the new renderer.
