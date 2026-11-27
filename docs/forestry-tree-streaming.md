# Streaming trees in the road view

PGMaps builds one background scene from the road view's existing terrain and inventory. The bundled Worldgen and Nanite workers draw it immediately when their ground and coarse forest are ready. The camera then gets detailed trees in geographic tiles as it moves along the road. Reports and exported scene packages use the full stand for their requested viewpoint and format.

## Tile selection and handoff

- A live preview uses a fixed local east and north coordinate frame for the route. For road bounds up to 18 km across, the terrain extends 3 km past the route's widest side. Its posts are at least 15 m apart, with a cap of about 641 posts per side. Longer roads use a 6 km terrain window around the starting eye and can require a fresh background farther along the route. Tree tiles use one 256 m grid within each background scene.
- PGMaps generates detailed trees from the native 4 m placement band and reuses its geographic patch seeds across tile boundaries. Each stem belongs to one tile. The placement inputs include vegetation inventory, harvest and retention, water and other clearings. Terrain seating in each worker uses the ground that worker draws.
- Within 220 m, the tile queue favors proximity in every direction so nearby trees and useful shadow casters arrive first. Beyond that it requests detail within the camera's view plus 20° to each side, up to 625 m from the nearest tile edge. An elevation sample probe lowers the priority of tiles behind an apparent ridge. It is a scheduling hint so uncertain or partly visible tiles eventually arrive. An open valley keeps its far canopy and preferentially fills in the nearer visible slope.
- The sender prepares up to two tiles per update at least 120 ms apart. One update can be in flight. The active list holds up to 48 tiles, and a loaded tile can stay to 850 m to reduce churn when the camera turns or backs up. These messages reuse the existing terrain and VRI reads. Each worker checks the background generation before applying changes.
- The coarse forest supplies a picture while tiles load. An occupancy texture masks coarse fragments inside tiles with drawable detail. Adding detail and updating the occupancy texture happen together. Removing detailed trees restores coarse cover in those cells. Each worker clips its coarse canopy against the live viewing gap. Worldgen's streamed scatter and Nanite's instance and shadow passes apply the same gap to detailed trees.
- Worldgen reuses its model and impostor cache across streamed tiles. Nanite grows a shared set of species and crown-width variants for the preview, then reuses the GPU instance buffers and draw pipelines. Nanite has a 100,000-stem budget for active detail. If a tile would exceed that budget, its coarse fallback stays visible. The report path still uses its own tree models, attributes and full-density stand.

## Light and evidence

The external previews now offer exposure from −1 to +2 stops under View options. A stop doubles or halves the exposure of the lit image. The selected clock and sun direction still determine what casts shadows. The PGMaps assessment reads its own terrain, forms and sightlines.

Nanite's live preview restores diffuse sky light to the shaded foliage in its coarse canopy and stand impostors. The added light follows the environment's hemisphere light. At the same Purden Lake station, the far canopy crop went from mean luma 16 to 60 on a 255-point scale with the sun at 13.7° and default exposure. The sky crop stayed at 202. Worldgen's canopy at the same camera measured 70. Final capture class passes use their existing colours.

The coarse canopy is a lower-resolution interpretation of the inventory. Narrow cutlines and retention islands smaller than its ground sampling need careful inspection in both preview and report images. The two workers match tree placement inputs but have different representations, lighting and shadow calculations.

## Verification

Use Chrome with hardware acceleration. Run the same 1 km camera movement at Tabor Mountain and Purden Lake in each bundled engine. The probe holds a replacement tree message while the camera moves and records actual composited frames, package generations, tile acknowledgements and network requests. It writes the start, pending and settled images for looking at the canopy and shore.

```sh
npx vite --config scripts/map-loading/vite.frozen.config.ts --host 127.0.0.1 --port 42320 --strictPort
node scripts/forestry/tree-views/live-stream.mjs worldgen hill
node scripts/forestry/tree-views/live-stream.mjs worldgen valley
node scripts/forestry/tree-views/live-stream.mjs nanite hill
node scripts/forestry/tree-views/live-stream.mjs nanite valley
```

The probe outputs to `tmp/tree-streaming/`. It checks that the terrain generation holds while tile replies wait and that composited frames retain visible content. Inspect the saved images for continuity of the forest itself. Use worker completion telemetry separately for performance measurements, since screencast readback adds work.

### Results on the Apple M4 Pro

The hill drive ran from 1.05 to 2.05 km on the Tabor Mountain sample. The open-valley drive ran from 5.00 to 6.00 km along Hwy 16 at Purden Lake. Both paths cross the previous 200 m whole-package refresh boundary. With one tile update withheld for the drive, each renderer kept one background generation and still showed distant canopy in the sampled images. At Purden Lake the opening and shoreline stayed visible. On the hill the near fallback slabs looked blocky when the artificial delay exposed them. Incoming detailed tiles replace those slabs as their trees become drawable.

| Renderer and route | Nonblank composited samples | Tile messages during the move and release | Tree data transferred inside the browser |
| --- | ---: | ---: | ---: |
| Worldgen, Tabor Mountain | 42 of 42 | 3 | 0.81 MB |
| Worldgen, Purden Lake | 268 of 268 | 3 | 1.32 MB |
| Nanite, Tabor Mountain | 180 of 180 | 6 | 1.56 MB |
| Nanite, Purden Lake | 240 of 240 | 7 | 3.31 MB |

Both engines saved an analysis sheet from the regular Save viewpoint action. Changing exposure by one stop doubled the worker's reported exposure in both engines at Purden Lake. The camera, terrain generation and drawn solar elevation stayed fixed during that change.

The checks found two issues that an image-only smoke test would have missed. Starting Nanite with an empty detailed stand also left its GPU chunk-list storage and its compute dispatch guard sized for zero. The worker could acknowledge tile data without drawing detailed trees. Both now use the reserved capacity, and the browser probe requires both resident tiles and a positive count of drawn trees. At the same time, a replacement background made a weak test look successful if it checked the last screenshot only. The probe now tracks ready generations throughout the drive.

The drive's network activity went to the existing basemap and elevation tile hosts. Detailed tree transfers ran inside the browser with no new inventory request. Under concurrent local load, some screencast samples arrived seconds apart. Those captures show retained screen content and a steady terrain generation. Measure frame timing in a separate run with one renderer and no screencast readback.

## Next steps

1. **Measure frame pacing on the existing Mac.** Run one renderer at a time at 60 km/h over both reference routes, with the CPU test suite and screencast stopped. Record completed GPU frames and frame intervals through tile arrivals for cold and warm runs. Keep the delayed-tile probe as a separate visual continuity check.
2. **Improve the near fallback.** Replace the blocky close-range canopy slabs exposed by delayed tiles with a lower-detail representation of individual crowns. Compare matched views at the waterline, across the viewing gap and around narrow retention strips. Keep crown closure tied to the inventory and check that terrain seating and shadows agree as detailed tiles replace the fallback.
3. **Hold the background through long drives.** Prepare the next terrain and coarse canopy scene before the eye exits the current footprint. Keep drawing the current background while the replacement builds. Test a route beyond the 18 km buffered span with a deliberately late replacement and record the handoff frame by frame.
4. **Check a physical phone.** Repeat the hill and valley drives at phone resolution and record first draw, GPU frame timing and memory pressure. Exercise a longer drive and a saved-view capture. Treat the Mac's emulated phone layout as a layout check.

The repository's existing GitHub Actions handle the full app checks and Pages build, and the Chrome CLI probe runs locally against hardware. `PGMAPS_CHROME_ARGS` accepts a JSON array of host-specific arguments when another verified machine is available.
