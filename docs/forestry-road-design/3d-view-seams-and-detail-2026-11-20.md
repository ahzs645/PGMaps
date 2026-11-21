# 3D view: seams, detail loading and what other tools do (20 November 2026)

This is the record of one day's work on the road designer's 3D view. It says what was reported,
what was measured, what other tools do about the same problems, what was built, and what the
browser checks found that the unit tests had not. The view's contract is
[3d-view.md](3d-view.md); this file explains why that contract reads as it does.

## What was reported

The owner sent a 12-second DevTools trace of the 3D view and two screenshots, with three complaints:

- the edge where the ground meets the road looked ragged, and worse at high zoom;
- zooming in and out made it worse "with how it loads the details";
- there were see-through holes beside a fill batter.

## What the trace and the code showed

The trace was a dev build on a display with a pixel ratio of 1. It held six wheel bursts. After
each of the last five the page blocked once:

| Time in trace | Main-thread block |
| --- | --- |
| 1.46 s | 184 ms |
| 2.74 s | 168 ms |
| 3.59 s | 144 ms |
| 5.11 s | 69 ms |
| 6.77 s | 131 ms |

Each block was one whole scene rebuild: re-meshing the ground (46–60 ms), cutting it against the
whole road again (35–50 ms), and recreating every buffer and material (23–38 ms, of which about
10 ms was linking the shaders again). The cause was the detail patch. From 2× zoom the view meshed a
finer square round the camera's focus and dropped the coarse cells under it, and it replaced that
square at zoom 2, 4, 8 and 16 and at every pan of half a window.

Reading the code against the trace's frames gave six causes:

1. **The stitch weakened as the ground got finer.** A cut ground vertex was moved to the footprint
   edge only when the gap was within half of its own ground face's relief. A 10 m face on a slope
   has plenty of relief; a 1 m face has almost none. Measured with the real cut on a synthetic 30 %
   slope with 0.2 to 0.6 m of roughness:

   | Ground cell | Seam vertices left open | Typical open gap |
   | --- | --- | --- |
   | 10 m, 5 m | 0 % | none |
   | 2.5 m | 1–3 % | 0.3–0.4 m |
   | 2 m | 2–11 % | 0.3–0.4 m |
   | 1 m | 27–38 % | 0.2–0.3 m |

   Height Auto then drew those gaps two or four times taller. So zooming in, which swapped in finer
   cells, made the edge worse.
2. **The rule was per face.** Two ground faces sharing a seam point could disagree about it. That
   happened at 2 to 7 % of seam places and drew a spike at each.
3. **Every open place was a hole.** The ground under the footprint is always removed, so wherever
   the stitch declined, the page showed through.
4. **Each zoom octave rebuilt everything**, as the table above shows, and the seam was cut again
   against the new cells, so it changed shape as the zoom changed.
5. **The patch's border cracked.** Its edge vertices took their own sampled heights while the
   coarse edge beside them was a straight line. In a tilted view the border is on screen.
6. **Slope colour came from the mesh.** It was computed from vertex normals, so 10 m cells read
   smooth, 1 m cells read blotchy, and the colour changed at every swap.

## What other tools do

| Problem | What established tools do | Taken here |
| --- | --- | --- |
| Ground meets design | Civil tools build one merged surface in which the design replaces the ground inside its boundary. Civil 3D [pastes the corridor surface](https://help.autodesk.com/cloudhelp/2024/ENG/Civil3D-UserGuide/files/GUID-38871FA0-E072-4F9B-8EEB-C102670C53D2.htm) into existing ground, with the [daylight lines as the corridor surface's boundary](https://help.autodesk.com/cloudhelp/2024/ENG/Civil3D-UserGuide/files/GUID-8BE80A7A-6EE4-4AEF-BBE0-ACD4E3641350.htm). OpenRoads [merges and retriangulates round the common edges](https://docs.bentley.com/LiveContent/web/OpenRail%20Designer%20Help-v15/en/Createcomplexterrainmodel.html). Trimble Business Center [replaces the first surface's data where the two coincide](https://help.fieldsystems.trimble.com/tbc/9309.htm). RoadEng [merges the designed surface into original ground](https://support.softree.com/knowledge-base/location-module/composite-surfaces) for presentation. | The stitch by edge kind: the ground is brought to every caught edge, so ground and design are one closed surface there. |
| Cracks between detail levels | Vertical skirts under tile edges: [Cesium](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html) and its [quantized-mesh format](https://github.com/CesiumGS/quantized-mesh), [Mapbox](https://github.com/mapbox/mapbox-gl-js/blob/main/src/shaders/terrain_raster.vertex.glsl), [chunked LOD](https://tulrich.com/geekstuff/chunklod.html), loaders.gl's [`skirtHeight`](https://loaders.gl/docs/modules/terrain/api-reference/terrain-loader). Or morphing each level toward the coarser one: [geometry clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry), [CDLOD](https://github.com/fstrugar/CDLOD/blob/master/cdlod_paper_latest.pdf). | A skirt under the ground's cut edge. The band's border needs neither: its edge vertices are put on the coarse edge's own line, so there is no crack to hide. |
| Shading that changes with detail | Shade from a texture computed from the elevation data, not from the mesh: the clipmaps' normal map, [MapLibre's hillshade](https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/src/render/draw_hillshade.ts), CDLOD's normal map. | The slope texture. Lighting still comes from the mesh. |
| Terrain meets a road in a game engine | The terrain is eased to the road over a falloff band: [Unreal's landscape splines](https://dev.epicgames.com/documentation/unreal-engine/landscape-splines-in-unreal-engine) use a cosine falloff, and EasyRoads3D blends the surrounding terrain back to the existing ground. | The blend beside a seam, as a display change only. |
| Holes without cutting the mesh | Cesium discards ground pixels inside a polygon in the shader ([ClippingPolygon](https://github.com/CesiumGS/cesium/pull/11750), added in 1.117). | Not taken. Three.js has no built-in equivalent, and the mesh cut is what gives the ground an exact edge to stitch. |

Not found in official documentation: how RoadEng's own 3D window treats the ground under the road,
how InfraWorks does it, and 12d Model's surface merge.

## What was built

In order, each described in [3d-view.md](3d-view.md):

1. **Stitch by what the edge is.** `previewEarthwork` returns the edges where a batter caught the
   ground (`seams`) beside the ones where it did not. The exact Finished and Subgrade surfaces give
   their own seams. `cutTerrainToDesign` brings ground on a seam to the seam's level at any cell
   size, once for each plan position, and never moves ground to an open edge.
2. **Skirt and curtain.** A ground-coloured skirt hangs under the ground's cut edge. A batter that
   did not reach the ground gets a translucent curtain, a dashed edge and an "Unfinished batter"
   legend row.
3. **A fine band along the road, meshed once** (`terrainBandMesh.ts`). The camera no longer changes
   the ground in the accelerated view. Every station is drawn up to a cap, so a road face and the
   batter strips beside it share their stations.
4. **Slope colour from a baked texture** (`terrainSlopeTexture.ts`), handed to the renderer without
   a scene rebuild.
5. **Near and far planes fitted to the scene**, **a closure pass** that keeps the ground watertight
   after a vertex moves, and **the blend** beside a seam. These three came out of the browser
   checks below.

## What the browser checks found

All the unit tests passed after steps 1 to 4. The first real-browser run still showed dark shards
about 1 m wide along batter outlines. Three things were behind what followed.

**Depth precision was the main cause, and it predated this work.** The view's camera stands about
4 km back on the training road and zooms by focal length. Near was set at 1/10,000 of the camera
distance and far at 8 times it, so a 24-bit depth buffer resolved only about 2.4 m at the road. The
skirt and the batters then won against ground metres in front of them. Painting the skirt red
confirmed that the shards were the skirt. The same fault had been drawing orange teeth along batter
edges and breaking the centreline into dashes before any of this work, so part of what was first
reported as a ragged seam was this. Nothing reported it. The planes are now fitted to what is drawn
(`terrainGpuSceneBox`).

**Lifting a seam vertex opened the ground beside it.** The cut splits ground faces along whole
lines, which leaves ordinary T-junctions: one face has a vertex on an edge its neighbour holds
whole. While nothing moves these are collinear and harmless. Once one end of such an edge is moved
to a seam, they are real gaps. A check of whole edges, not midpoints, counted 1,609 on the training
road's Cut and fill ground (worst 9 mm), 1,208 on its Finished ground, and 694 across synthetic
rough cases (worst 1.04 m). The closure pass gives every edge with a moved point all the ground
vertices lying on it; every case then has none.

**Moving only the seam's own vertices drew teeth on rough ground.** The whole lift was taken up
between the seam vertex and the next ground vertex, often a fraction of a millimetre to a few
centimetres away, so the ground between them stood nearly vertical. The training example could not
show this, because its ground is smooth and its lifts are under 3 cm. On generated rough ground
there were 74 to 144 such steps a scene, up to 0.59 m tall. The blend removed all of them. Building
it found two more faults: a fan triangle thinner than the seam tolerance stood up as a 6 cm fin once
its corners moved by different amounts, and plan-cell keys as large as 2^48 were hashed as doubles,
which was most of the blend's first cost.

Two smaller findings from the same runs:

- Without the texture, the band read as a red strip on rough ground: finer cells have steeper
  vertex normals than the coarse cells beside them. The texture gives both the same colour.
- The canvas preview paints every face, so it must never be handed the band. It shows the base mesh
  before the first accelerated frame and keeps its old focus square after a renderer failure.

## Numbers

| What | Before | After |
| --- | --- | --- |
| Seam vertices left open at 1 m cells | 27–38 % | 0 |
| Scene rebuilds while zooming 1× to 16× and panning | one per zoom octave and pan step, 69–184 ms each in the trace | none; the geometry revision stays the same |
| Long tasks during a wheel burst (headless Chrome, Metal) | one per swap | none |
| Ground gaps beside the footprint, training road | 1,609 (worst 9 mm) | 0 |
| Near-vertical steps beside a seam, rough ground | 74–144 a scene, up to 0.59 m | 0 |
| Depth resolved at the training road | about 2.4 m | fitted to the scene |

One rebuild at Auto on the training example (1.43 km, 171 stations), in Node on an Apple M4 Pro:
band mesh 11–24 ms, cut about 90–130 ms with the closure pass and the blend (the runs varied with
the machine's load), GPU ground buffers 22–26 ms. In a dev build in the browser, a
colour change or an Around station move is one long task of 170–240 ms. A rebuild now happens when
the design or a display setting changes, not when the camera moves.

## Choices and what they cost

- **Ground detail is set by the quality, not the zoom.** Auto's 30,000-cell band gives 2 m cells on
  the 1.43 km training road, and High's 80,000 gives 1.25 m. The old patch reached 1 m at 16×. Auto
  was held there so that a rebuild costs about what one zoom swap used to. The cut is the slow
  stage; when it is cheaper, raise `TERRAIN_BAND_MAX_CELLS`.
- **The blend moves display ground within about 2 m of a caught edge** by up to the lift there. It
  changes the drawing only. Source levels, the sampler, the analysis and exports are untouched.
- **A road too long for the budget gets a coarser band**, down to none. A tiled hierarchy is still
  the step for those roads.

## Not built, and not checked

- A tiled terrain hierarchy with screen-error selection, and moving the sampling, cut and buffer
  work to a worker.
- A cheaper cut. Fine cells inside the footprint are cut and thrown away.
- Lighting from a baked normal texture. On rough ground the band is still shaded a little
  differently from the coarse ground beside it.
- Per-pixel clipping of the ground.
- Curtains with the Finished or Subgrade surface, which leave incomplete stations out.
- The catch line still runs straight between stations, so a batter's outline zigzags on rough
  ground. That is the design's own catch points.
- Real LiDAR was not checked. Neither were context loss with the texture applied, or the notice for
  a dropped band in a browser.
- One test of `forestry-road-steep-3d.spec.ts` at 390 px wide timed out on the header's Open button
  before the 3D view opened. It was not compared with main.

## Checking a change here again

- Run the focused suite listed in [3d-view.md](3d-view.md), Verification.
- Run `tests/e2e/forestry-road-3d-renderer.spec.ts` in installed Chrome. It includes a test that
  zooms past 8× and back, pans, and expects the geometry revision not to change.
- Look at rough ground in a real browser. The training example is too smooth to show a seam fault.
  What worked: a project file with an inline 1 m raster of 821 × 241 cells, a 30 % side slope with
  bumps of 0.2 to 0.5 m over 2 to 15 m, and a 700 m road across the slope so it has cuts and fills,
  opened through Open. On a shorter road the band was 1 m and the lifts were too small to see.
- Use low views along the road at height ×4, on a cut and on a fill. From above, a seam fault is
  smaller than a pixel.
- Three counts catch what pictures can miss: ground edges used by one face that are neither on the
  footprint's outline nor on the window's border (watertightness, checked along the whole edge);
  ground edges under 5 cm long that rise over 5 cm beside a seam (steps); and
  `data-geometry-revision` through camera movement.
- If something shows through the ground along an outline, paint it a loud colour before reading the
  geometry. That is how the depth fault was told apart from a hole.
