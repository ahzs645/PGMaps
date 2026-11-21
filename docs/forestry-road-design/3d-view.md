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
| **Fit** | Fits actual coarse ground and design vertices. Empty corners of the enclosing box no longer determine the picture's size. Finer ground (the band along the road, or the canvas preview's focus window) does not move the fit. |
| **Cut and fill / Finished / Subgrade** | What the road is drawn as while batters are shown. **Cut and fill**, the default, is the formation the canvas preview draws: the road's lanes between stations, and each batter in strips, coloured cut (`CUT_BATTER_FILL`) or fill (`FILL_BATTER_FILL`) and a road stretch that fails the reviewed grade standard in its own colour, unlit, with their mesh lines; the legend keys the colours. Loaded direction and permitted short pitches are judged as in Review. Simplified faces and the WebGL centreline check the intervals between their retained stations. **Finished** and **Subgrade** draw that one exact design TIN in a single colour. The exact surfaces overlap outside the formation, so they are not drawn as two competing opaque surfaces. |
| **Auto quality / High quality / Efficient** | Sets the ground sampling, the fine band's cell budget, the slope texture's size and the screen-pixel budgets below. Choosing one rebuilds the scene once; it never changes with the camera. Auto reduces screen pixels during camera movement and sharpens after it stops. |
| **Slope / Elevation / Plain** | Colours sampled ground. Slope is in true, unexaggerated metres, and in the accelerated view comes from a texture baked from the source ground (below); lighting follows the drawn geometry. These colours are not aerial photography. |
| **Orthophoto** | Appears when the project has a visible imported orthophoto. Uses that layer's CRS, retained RGB(A) pixels and opacity. A selector appears if more than one is available. No imagery request is made by the viewer. |
| **Batters** | With batters shown, the drawing includes the formation and its earthworks, and the display ground is stitched to their outer edge (below). Hiding them draws the road alone and cuts only that visible footprint out of ground. |
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
| [`TerrainPreview.tsx`](../../src/pages/dev-forestry-roads/TerrainPreview.tsx) | Shared station, camera, controls, source sampling, stable fit geometry, the accelerated view's band geometry and slope bake, the canvas preview's focus window, labels and fallback selection. |
| [`terrainSceneGeometry.ts`](../../src/pages/dev-forestry-roads/terrainSceneGeometry.ts) | Shared export-CRS frame, exact design buffers and seams, bounded subtraction of the chosen design footprint from display ground, the stitch, skirt edges and unfinished-batter curtains. |
| [`terrainScenePresentation.ts`](../../src/pages/dev-forestry-roads/terrainScenePresentation.ts) | Combines ground/design/line/culvert inputs, image coordinates and availability notices without querying the terrain. |
| [`TerrainGpu.tsx`](../../src/pages/dev-forestry-roads/TerrainGpu.tsx) | React-owned canvas and lazy renderer lifecycle. The Three.js module is loaded only when this pane needs it. |
| [`terrainGpuRenderer.ts`](../../src/pages/dev-forestry-roads/terrainGpuRenderer.ts) | GPU buffers, materials, lighting, texture, depth, clipping, picking, requested frames and resource disposal. |
| [`terrainRenderQuality.ts`](../../src/pages/dev-forestry-roads/terrainRenderQuality.ts) | Pure screen-pixel limits, independent of engineering calculations. |
| [`terrainMesh.ts`](../../src/pages/dev-forestry-roads/terrainMesh.ts) | Bounded, fixed-grid display sampling, cached missing/finite values and explicitly estimated gap patches. |
| [`terrainBandMesh.ts`](../../src/pages/dev-forestry-roads/terrainBandMesh.ts) | The same grid with the cells along the road split into whole fractions of a cell, watertight against the coarse cells, and the road's band segments (`roadBandSegments`). |
| [`terrainSlopeTexture.ts`](../../src/pages/dev-forestry-roads/terrainSlopeTexture.ts) | The slope texture baked from the source ground over the window, in slices, and its texture coordinates. |
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

With batters shown, the cut ground is then stitched to the footprint's edge. The display ground is
sampled more coarsely than the source ground the design met, so left alone it stands a little above
or below the catch line and saws in and out of it along the whole road. Whether an outline edge is
stitched is decided by what the edge is, never by the ground's relief or cell size:

- A **seam** is an outline edge between two stations on one side where both stations' batters reached
  their catch point (`previewEarthwork`'s `seams`; a side with no batter, where the road edge is the
  catch point, gives one straight seam along the road face's edge, and a stripped margin's outer edge
  is a seam too). For the exact Finished or Subgrade TIN, `terrainSceneGeometry` reads its seams from
  the TIN itself: the section builder ends each complete section at its two catch points, so a piece's
  outline edge joining one side's catch points at two stations is a seam (`seams`).
- An **open edge** is everything else on the outline: a batter that stopped at the section's reach or
  at missing terrain, the first and last sections, and each end at an incomplete stretch.

`cutTerrainToDesign` gives a ground vertex lying on a seam, in plan, the seam's level, at any ground
cell size. The level is decided once for each plan position, so every face sharing the point agrees;
where seams overlap in plan (a folded footprint, a switchback) the ground meets the one nearest its own
level. An open edge brings no ground to it; a vertex there moves only by a seam's blend (below).
Every footprint corner that lies inside a cut ground edge is put into that edge as a vertex (the
triangle-by-triangle cut alone does not do it), so the ground's cut edge follows the seam exactly,
with no T-junction at a station. Where a ground
edge ends at a moved point or has one on it, every ground vertex lying on that edge (a neighbouring
face's, moved or not) is put into it as well, so faces that met along the edge still meet once the
seam is lifted or lowered: the drawn ground stays closed beside the footprint.

Moving only the seam's own vertices would take the whole lift (the seam's level less the display
ground's, often 0.2 to 0.5 m on rough LiDAR ground, drawn two or four times taller) between a seam
vertex and the next ground vertex, which the cut often leaves a fraction of a millimetre to a few
centimetres away. That drew a row of near-vertical teeth along every batter outline. So the ground
beside a seam is **blended** to it, as road tools in game engines ease terrain to a road:

- A ground vertex on a seam lifts by the seam's level less its own ground level. Between two such
  vertices on one seam the ground's cut edge is straight, so the lift runs straight between them. A
  stretch of seam with no ground beside it has no lift.
- A ground vertex within the blend radius `R` of a seam point with ground beside it moves by the lift
  at the nearest such point, eased by a cosine from all of it on the seam to none at `R`. On a tie the
  seam listed first wins. Beyond `R` nothing moves. A vertex near an open edge moves only by a seam's
  blend.
- `R` is `TERRAIN_SEAM_BLEND_CELLS` (1.5) of the finest ground cell drawn beside the road (the band's,
  or the coarse cell when the band is left out) and at least `TERRAIN_SEAM_BLEND_MIN_M` (2 m)
  (`terrainSeamBlendRadius`): far enough to reach past the ground vertex next to the seam, near
  enough that the ground keeps its own relief a couple of cells out. The move adds at most the lift's
  change along the seam plus pi/2 times the lift over `R` to the ground's slope.
- The closure above covers every moved vertex, so the ground stays closed with the blend on. Where a
  cut polygon is fanned, a fan never uses a triangle thinner than the seam tolerance, and a fan from
  the polygon's centre puts the centre where the blend puts that point; such a sliver would otherwise
  stand up as a fin once its corners move by different amounts.

On generated rough ground (a 30 % side slope with 0.2 to 0.5 m bumps) the blend took the near-vertical
steps beside a seam (edges under 5 cm that rise over 5 cm) from 74 to 144 a scene to none, and the
tallest step a sliver draws from 0.46 m to 2 cm; the smooth training road had none before and none
after. It adds a few milliseconds to the cut: in Node, the training road's Cut and fill from 91 to
93 ms and its Finished surface from 182 to 190 ms (medians, old and new run in turn), helped by
looking plan cells up by array index rather than by a large number.

The stitch and the blend move display vertices only, in height only: plan positions and the area cut
out are unchanged, the input faces are never changed and no terrain is read. Source levels, the
terrain sampler, the analysis, quantities and every export are untouched. The canvas/SVG preview does
not blend.

Wherever the cut ground ends on the outline, seam or open, the accelerated view hangs a vertical,
ground-coloured **skirt** from that edge, as terrain renderers do at tile edges, so any gap that
remains shows ground and not the page. It hangs `TERRAIN_SKIRT_MIN_DEPTH_M` (5 m) or
`TERRAIN_SKIRT_DEPTH_CELLS` (2) coarse ground cells, whichever is more, before vertical exaggeration.
In a cut the batter rises to the catch line in front of it, and in a fill the batter falls to it, so
from above the ground the skirt is behind a batter or under the ground unless there is a gap. That
holds only while the depth buffer can tell them apart, so the camera's near and far planes are fitted
to the drawn scene (`terrainGpuSceneBox`): set at fixed shares of the camera distance, they resolved
only about 2.4 m at the training road, and the skirt and the batters showed through the ground as
shards along every outline. It is
display only: it cannot be picked, it is hidden in X-ray, it follows the window and cutaway clipping,
and it is drawn a little behind anything in the same place.

Where the formation is drawn (Cut and fill, batters shown), each open batter edge also gets an
**unfinished batter** curtain: a translucent face from the edge to the sampled ground at the same
offsets, in the canvas preview's dashed-edge colour (`UNFINISHED_BATTER_COLOUR`), with the edge itself
dashed, and a legend row. A curtain lower than `UNFINISHED_CURTAIN_MIN_HEIGHT_M` (5 cm) at both ends is
left out. The canvas preview keeps its dashed red edges.

The GPU therefore depth-tests ground outside the corridor against the exact road surface,
including deep cuts. With batters hidden or an exact TIN unavailable, clipping follows the
simplified surfaces actually being drawn. A clipping-budget exception discards the attempted
result and requests the canvas/SVG compatibility preview with an explanation; it never displays
a half-clipped ground mesh.

Missing source faces remain absent. Existing **Fill gaps** can add explicitly estimated display
patches only for enclosed unsupported components no wider or taller than 80 m, using at most
128 relaxation iterations. Measured vertices are unchanged; boundary-connected and larger gaps
stay open. All estimates stay out of the terrain sampler, analysis and exports. The stitch and the
blend move only display vertices, toward the design's catch line, which is on the source ground; they
never change survey heights, and an open edge is never closed by them. The stitch, blend, skirt and
curtains were checked in a browser on the training example and on generated rough ground
(Verification, below), not yet on real LiDAR.

### Ground appearance, images and structures

Natural ground shares identical vertices and computes smooth normals. Estimated vertices
remain separate from measured ones. Design faces use flat shading and preserve their original
breaklines.

In the accelerated view, **Slope** colours come from a texture baked from the source ground over the
display window (`terrainSlopeTexture.ts`), not from the mesh's normals. The colour is then a property
of the ground: the band and the coarse ground beside it, and every zoom, show the same colour for the
same ground. The texture samples the source once at each texel centre, takes the slope from its
neighbours in true metres, and leaves a texel transparent (all bytes zero) where the slope is unknown.
It is baked in slices on the page's thread (`runCooperatively`), so the page never stops for it, and a
new bake starts only when the window, the terrain, the frame or the quality changes. Until the first
texture is ready, outside its bounds and wherever it is transparent, the vertex colours show as before,
so an estimated gap patch keeps its tint. The shader lays the texture over the vertex colour as
`vertex × (1 − alpha) + texture`: zero bytes make a filtered sample premultiplied, and this keeps a dark
fringe off the edge of known ground. When Around station moves its window the texture in hand stays on
the ground, at its own place, until the next one is ready. The renderer takes the texture without a
scene rebuild (`setGroundTexture`), keeps it across a rebuild while the ground is coloured by slope,
and the skirt takes it too, at its own plan position. Lighting still follows the mesh normals, so on
rough ground the shading of the band can differ from the coarser ground beside it even where the colour
matches. Elevation, Plain and Orthophoto are unchanged. Ambient and directional lights give relief without a shadow-map or postprocessing
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
base-fit mesh keep their 128-side default. Zoom spans 0.35–16×.

In the accelerated view the ground is meshed once for the window: the coarse grid, with the cells
along the road split into finer cells (`terrainBandMesh`). The band follows the road's centreline
between consecutive stations, each stretch reaching the wider of its two stations' drawn half-widths
(road edge, catch point, stripped margin or, where a batter stopped short, its last design sample)
plus `ROAD_BAND_MARGIN_M`. Each coarse cell in it is split into k × k cells, k a whole number, as many
as the source resolution and `TERRAIN_BAND_MAX_CELLS` allow; a road too long for the budget gets a
coarser band, down to no band at all. Every station is drawn, up to `PREVIEW_GPU_MAX_STATIONS`, so a
road face and the batter strips beside it share their stations. The camera never changes the ground:
zooming, panning, turning and tilting reuse the buffers, and the seam is cut once against the band's
ground. The view reports the band's spacing as `data-detail-spacing` and in the rendering note.

The canvas/SVG preview never draws the band, because it paints every face. Before the first
accelerated frame it shows the base mesh. After a reported renderer failure or context loss, or when
the scene cannot be cut, it keeps its camera-following focus window as before: from 2×, a separately
sampled patch around the focus covers about twice the visible width, under the same quality/source
limits, snapped to coarse cells and half-window steps and prepared 180 ms after the view settles.
After a renderer failure the selected mesh budget drops to 128 while the canvas fallback is in use.
If cutting the band's ground passes one of the drawing budgets below, the scene is tried again on the
coarse ground before anything falls back to the canvas preview, and only then does the notice say
the finer ground was left out. The base fit, colour range and median elevation remain stable. Fit deduplicates shared coarse vertices; true-north and along-road headings are transformed
into the same projected frame as the geometry.

| Additional drawing limit | Bound | Response |
| --- | --- | --- |
| Exact design footprint | 250,000 triangles | Report an unavailable exact surface and retain simplified presentation. |
| Spatial-index memberships | 2,000,000 | Coarsen lookup cells only; design triangles are unchanged. |
| Ground polygon/triangle checks | 4,000,000 | Report the limit and use the complete canvas/SVG preview. |
| Clipped pieces per source face | 2,048 | Report the limit and use the complete canvas/SVG preview. A guard on one face only: the clip tests and clipped faces bound the whole cut. |
| Clipped output faces | 1,000,000 | Report the limit and use the complete canvas/SVG preview. |
| Seam blend radius | 1.5 of the finest ground cell beside the road, at least 2 m (`terrainSeamBlendRadius`) | Display ground farther from every seam is not moved. |
| Cached source samples | 524,288 in the accelerated scene (`MAX_CACHED_GPU_TERRAIN_VERTICES`); helper default 65,536 | Evict the oldest finite or missing result and reuse fixed-grid overlaps. Looked up by number, not by a text key. |
| Fine band cells (`TERRAIN_BAND_MAX_CELLS`) | Auto 30,000; High 80,000; Efficient 15,000 | Fewer divisions per coarse cell, down to no band; the canvas preview never draws it. |
| Band reach past the drawn road (`ROAD_BAND_MARGIN_M`) | 20 m | Added to each stretch's drawn half-width. |
| Stations drawn in the accelerated view (`PREVIEW_GPU_MAX_STATIONS`) | 2,000 | Thinned evenly past it. The canvas preview keeps 180 (`PREVIEW_CANVAS_STATIONS`) plus every station in its focus window. |
| Slope texture side (`TERRAIN_SLOPE_TEXTURE_SIDES`) | Auto 1,024; High 1,536; Efficient 512 texels; never finer than the source | The texel grows with the window. |
| Slope bake yield (`SLOPE_TEXTURE_YIELD_TEXELS`) | 1,024 texels between checks of the 12 ms slice | About 0.5–1 ms of work at the measured sampler cost. |

The named constants are in `terrainSceneGeometry.ts`, `terrainMesh.ts`, `terrainBandMesh.ts`,
`terrainSlopeTexture.ts`, `previewCamera.ts` and `terrainRenderQuality.ts`; the selected scene/cache
budgets are in `TerrainPreview.tsx`.
Keep this guide and the [terrain limits table](terrain-and-point-clouds.md#limits-and-budgets)
in step with them. These bounds do not cap the browser tab's total memory.

## Rendering lifecycle and fallback

The renderer requests a frame after data, camera, size or display settings change. It does not
run a perpetual animation loop. Auto's delayed sharpen requests one further frame. Camera changes
(zoom, pan, turn, tilt, the station-centre button, Fit) never rebuild the accelerated scene: they
reuse its buffers, and `data-geometry-revision` stays the same. The scene is rebuilt only when the
design, the window (Around station moving), the terrain or a display setting that changes the ground
or the road's drawing changes; a rebuild releases replaced geometry, materials and textures, except
the slope texture, which is handed over on its own. Scene geometry is still prepared on the main
thread.

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
  src/pages/dev-forestry-roads/terrainBandMesh.test.ts \
  src/pages/dev-forestry-roads/terrainSlopeTexture.test.ts \
  src/pages/dev-forestry-roads/previewEarthwork.test.ts \
  src/pages/dev-forestry-roads/terrainRenderQuality.test.ts \
  src/pages/dev-forestry-roads/terrainGpuRenderer.test.ts \
  src/pages/dev-forestry-roads/terrainGpuTexture.test.ts \
  src/pages/dev-forestry-roads/TerrainGpu.test.tsx \
  src/pages/dev-forestry-roads/TerrainPreview.test.tsx \
  src/pages/dev-forestry-roads/previewCamera.test.ts
npm run road-design:check-boundary
npm run road-design:build
```

**Browser verification was first done on 20 November 2026** (the two records below). Browser
execution was blocked in the 19 November implementation environment, so that session had no verified
screenshot, frame-rate result or target-device performance claim, and the added
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

**Band and slope texture, recorded 20 November 2026.** Unit checks: the focused suite above (run
without the two `terrainRenderQuality` and `terrainGpuTexture` files) and the whole
`src/pages/dev-forestry-roads` folder passed, as did ESLint, Prettier on the
changed source and tests, `road-design:check-boundary` and `tsc -b`. They now also cover the band's
reach, the station cap, the band's budget fallback, the renderer's texture hand-over and its vertex
sharing, and that zooming, panning and Around station never rebuild the accelerated scene while the
canvas preview keeps its focus window and never draws the band.

Timings in Node on an Apple M4 Pro, for the training example (1.43 km, 171 stations, a 1,601 × 956 m
window on 1 m ground, 10 m coarse cells), per rebuild at Auto: band mesh 11–24 ms, cut 71–91 ms and
GPU ground buffers 22–26 ms for 24,800 fine cells at 2 m, 104–138 ms in all, against 86–134 ms for
one zoom step's re-mesh before the band. At the earlier 80,000-cell budget the same rebuild took
183–226 ms. Sharing GPU ground vertices by number rather than by a text key took that stage from an
estimated 135 ms to 52 ms at 80,000 cells. The source sampler cost 0.41 µs a call on the training
terrain and 0.54 µs on a 1 m projected raster; a 1,024-texel bake of the training window took
260–380 ms in slices of 12.2–12.8 ms.

`forestry-road-3d-renderer.spec.ts`, with the test added for wheel zoom past 8× and back and a pan,
passed (7 of 7) in installed Chrome on SwiftShader against a local dev server. A throwaway script on
the same server, in headless Chrome on Metal (Apple M4 Pro), opened the training example's 3D view
at 1512 × 982, fullscreen: the geometry revision stayed at 1 through zooms to 4×, 8× and 16×, a pan
of half a window, low views and Fit, with no long task during the wheel bursts; a colour change
(which rebuilds) and an Around station move each took one long task of 170–240 ms in the dev build.
The slope texture was drawn about 30 ms after the first accelerated frame. On a generated rough 1 m
terrain with gaps, the texture kept the band and the coarse ground the same colour where vertex
colours had drawn the band as a red strip, and showed no dark fringe at an estimated gap or an open
one. The same runs showed dark, thin skirt faces standing above the ground along batter outlines at
4× and closer, on both terrains; they appeared with the band left out and disappeared with the skirt
hidden. Their two causes were found and fixed the same day (next record).

**Seam, depth and blend, recorded 20 November 2026.** The shards had two causes. The larger was depth
precision: the camera stands about 4 km back on the training road and zooms by focal length, and with
near at 1/10,000 of that distance and far at 8 times it a 24-bit depth buffer resolved about 2.4 m at
the road, so the skirt and the batters won against ground metres in front of them, and the centreline
and station lines broke into dashes. Painting the skirt red confirmed it. The planes are now fitted to
the drawn scene. The smaller was the ground itself: once a seam vertex is moved, a neighbouring face
that holds the same edge whole no longer meets it. A whole-edge check counted 1,609 such gaps on the
training road's Cut and fill ground (worst 9 mm) and 1,208 on its Finished ground, and 694 on
synthetic rough cases (worst 1.04 m); after the closure pass every case has none. One stretch of the
Finished ground is still flagged, a 0.2 mm sliver edge on the outline itself, inside the checker's
tolerance, and the skirt hangs there.

The blend was checked on a generated project: an inline 1 m raster of 821 × 241 cells with a 30 %
side slope and bumps of 0.2 to 0.5 m over about 2 to 15 m, and a 700 m road across it with cuts and
fills, opened through Open in the designer. Matched pictures before and after, in headless Chrome on
Metal at 1512 × 982 and height ×4: in low views along the road the ground spiked over the fill toe and
notched the cut's catch line before, and met both cleanly after; from above at 8× and closer the two
looked the same, because the steps are smaller than a pixel there. No hole, no skirt showing, no
broken line and no kink where the blend ends. The training example at stations 390 and 640 was
unchanged. `forestry-road-3d-renderer.spec.ts` passed 7 of 7 again after each change, and the
focused suite (126 tests in ten files), the whole `src/pages/dev-forestry-roads` folder, ESLint,
Prettier, `road-design:check-boundary` and `tsc -b` passed on the final state.

Not checked: real LiDAR; context loss and restoration with the texture applied; the notice for a
dropped band in a browser (unit tested by forcing the budget error). One test of
`forestry-road-steep-3d.spec.ts`, at 390 px wide, timed out on the header's Open button before the 3D
view opened; it was not compared with main. What was reported, what each cause was and what other
tools do are in the [record of this work](3d-view-seams-and-detail-2026-11-20.md).

## Remaining work

The accelerated view draws one coarse grid with one fine band along the road, meshed once. It does
not yet provide a tiled terrain hierarchy, screen-error selection or progressive streamed mesh levels.
On a very long road the band's fixed cell budget is shared along the whole road, so the band gets
coarser (fewer divisions per coarse cell) and, past about two divisions' worth, is left out; a tiled
hierarchy that refines what the camera sees is still the step for those roads.

Most of a rebuild is the cut of the band's ground against the design footprint
(`cutTerrainToDesign`, about 70–130 ms of the 100–200 ms measured above): fine cells inside the
footprint are cut and thrown away, and its lookups allocate per ground face. Making that cut cheaper
would let the band budgets grow.

Worker-based sampling, clipping and buffer preparation remain deferred; moving a large project
through those CPU stages can still block the main thread. Any worker protocol must preserve
source gaps, exact design topology, cancellation and the last complete displayed scene.

Lighting still comes from the mesh's normals, so on rough ground the band is shaded a little
differently from the coarse ground beside it; a normal texture baked with the slope texture would
remove that. Unfinished-batter curtains are drawn only with Cut and fill, because the exact surfaces
leave incomplete stations out. The catch line still runs straight between stations, so on rough
ground a batter's outline zigzags from station to station: that is the design's own catch points,
not a drawing fault.

Named saved 3D cameras, an along-road flythrough and a dedicated viewer image/scene-export
workflow remain deferred. Existing engineering exports and project persistence are unchanged.
Measured render-quality tuning, finer imagery delivery and cut-edge/seam inspection also remain
work to validate, rather than capabilities implied by the new renderer.
