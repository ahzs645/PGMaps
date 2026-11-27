# Visual quality, end to end on a district plan (26–27 November 2026)

What happened when `/dev/forestry/visual-quality` was driven from a licensee's district 5-year plan to a VIA report
with figures drawn by Nanite Forest: the run, every problem it found, what was fixed, what is still open and how to
pick it up. The plan, its block names and its viewpoints are the licensee's and stay outside the repository; here
they are "the plan", "block A" and "views 1–4".

## The run

1. **Load.** A loose shapefile (the `.shp`, `.dbf`, `.prj` and `.cpg`, beside ArcGIS's `.shx`, `.sbn`, `.sbx`,
   `.shp.xml` and lock files) dropped on the page: 110 polygons in BC Albers. Attributes: a block id filled on 10
   polygons, an operating area (`Operating_`, a truncated `Operating_Area`) on 98.
2. **Choose the block.** An inventory check (agent, DataBC's VLI viewpoints and arrows read as
   `viewpointInventory.ts` reads them) ranked the blocks with an inventory arrow aimed at them. Block A (47 ha) had
   four aimed views 0.6–3.4 km away; its ground is an inventory unit with an established objective of M.
3. **Identify.** Block A selected; the inventory landform holding it adopted (*Find a landform in the BC inventory*,
   M established); the four aimed views added (*Add the 4 with arrows at the block to views*); the other 103 blocks
   removed (*Remove blocks outside the assessment…*).
4. **Run.** *Assess from: A view* at view 1 (0.6 km); *Look up existing openings*; sample points raised to 15,000 at
   the run's own request. Ready run: perspective alteration 25.0% (reads MM against M's 7–18%), planimetric 6.6%,
   block A 9.2 ha seen.
5. **Report.** Save & export → *Package* → figures drawn by Nanite Forest → *VIA report* → Preview: four views
   captured, each with its before-harvest render, Nanite drawing each view's after and before pictures place by
   place, a 9-page PDF.

View 3 sees none of the blocks. An independent bare-earth check (Terrarium z13 and z14, the run's own
`computeAnalysis` under Node) found a knoll about 200 m out along its arrow standing ~30 m over every sightline:
0% is right.

## What it found, and what was fixed

| # | Found | Fix |
|---|---|---|
| 1 | The page took no dropped files; the picker read only a zip or GeoJSON | Drop anywhere on the page (`useFileDrop`); `readShapeFiles` joins a loose shapefile's parts by name, passes over ArcGIS's sidecars and refuses a `.shp` without its `.prj` (`shapeImport.ts`) |
| 2 | 100 of 110 blocks named "Polygon N" | Unnamed blocks take their operating area, numbered in file order ("Alder Flats 3"), matching dBASE's 10-character truncations (`featureGroup`, `blockNames`) |
| 3 | Pickers and the site title followed the plan's first polygon, not the block being worked on (landform search, *Facing*, the viewpoint list, the header, also after a reload) | `reviewerBlockId` (`blockFocus.ts`): the selected block, the assessed view's block, the block last selected, the views' blocks, then the first |
| 4 | A district plan buried the assessed block: 110 cards before *Landform and objective*, ~100 "beyond the 12 km view distance" results, no bulk remove | Long lists fold with a name filter (`FoldedBlockList`); results show assessed blocks first; *Remove blocks outside the assessment…* (one confirm, one scene update) |
| 5 | The under-resolved gap told the reviewer to raise sample points; following it never cleared it | The advice names the block, measures its area inside the landform and says when the sightline cap, not the setting, coarsened the grid (`analysis.ts` `underResolvedText`) |
| 6 | Before-harvest renders all failed in a throttled tab (a flat 60 s wait while the stand regrew) | The before step waits on timber progress like the capture (`waitForStand`, `viewCapturePlan.ts`) |
| 7 | After capturing, Save & export said "open the road view" for the engine | A closed or loading road view is *settling*; prepare opens it and waits (`visualsExports.ts`, `VisualsExportDialog.tsx`) |
| 8 | Nanite drew 1 of 4 views (only views saved where the reviewer stands) | The capture batch has the engine draw each place's after and before pictures before moving on (`useViewCapture.ts`, `ViewCaptureOptions.engine`) |
| 9 | Each place grew its stand three times | The last two placements' patches are kept (`patchCacheFor`, `forestPatches.ts`) |
| 10 | Views away from the station were portrait pictures (the pane's shape) | One 3:2 frame of the view's own lens when no landform ground is in sight to frame on (`figurePlanFor`) |
| 11 | Captions ran off the figure, printed "n/a%" and an engine layer id ("proposedOut") | Lines wrap to the box measured as printed; "not measured"; layer ids in words (`composeFigure.ts`, `CLASS_LAYER_WORDS`) |
| 12 | The summary table printed two values under four viewpoints; field observations were 13 near-identical sentences; figures put the station last; inventory rows took in units round a block outside the landform | One cell per viewpoint with its reason; one sentence per viewpoint; the station first, then the package order; rows only where the assessed landform or a seen block is (`viaReport/*`) |
| 13 | Nanite drew young and thicket trees as white cones | The engine painted class colours into `instanceColor` before the picture; now only while the flat class pass is on (`vendor/threejs-nanites`, `component-mesh.ts`) |
| 14 | Nanite kept each replaced final stand's impostor atlas (3–4 GB of multisampled half-float targets) | Disposed when the drawing is replaced (`pgmaps-scene.ts`) |
| 15 | The service worker served `/engines/` stale-while-revalidate: after every engine build the page ran the previous engine once | `/engines/` is network first (`public/sw.js`, `docs/app-updates-and-caching.md`) |
| 16 | The plan map's tools were a tall stack; the legend was inset and the scale sat under it | A top-left `MapToolbar` on desktop (phones keep the folding stack), the legend flush right, the scale bottom left |

Also added on the way: an engine worker restart between places (`restartEngine`), the road view's own stand released
from the GPU while the engine draws a place (`RELEASE_ROAD_VIEW_STAND_FOR_ENGINE`), the final stand's clipped radius
named on the sheet ("real-density stand to 3.2 km (stem budget)"), and the trace below.

## Open: the tab crashes during Nanite's first frame of one view

The tab dies ("Target crashed") when Nanite draws view 2 (2.0 km south of block A, looking north) right after PGMaps
captured it in the same batch: every time it was tried that way (seven runs). The same view rendered once when
Nanite drew it alone after the other captures.

**Where it dies.** The engine and the page now leave a trace that survives the crash (below). At view 1 the engine
builds its scene, draws its first live frame 2.3–2.7 s later (`build/firstFrame`), says ready, takes the capture
request and renders. At view 2 the scene builds normally (5.9 s, 58 tree types, a 7424 × 4096 four-sample atlas) and
`build/firstFrame` never comes: the tab dies while Nanite draws the first live frame of that scene, before PGMaps asks
for any capture and before the final stand reaches the engine. The page side was normal up to then (its final stand
grown to 1.34 M stems, page heap 0.84 GB).

**Ruled out**

| Suspect | Evidence |
|---|---|
| The page's memory | Heap 0.5–1.7 GB at every crash (limit 4.4 GB) |
| The machine | 48 GB, 55% free at the crash |
| The final stand's size | A 1.0 M stem cap crashed the same way (the cap is back at 1.5 M) |
| The final stand's transfer or merge | The engine never received the request |
| The road view's stand on the GPU | Releasing it during engine renders did not help (it got one view further once, then crashed the next run) |
| Engine memory carried between places | A fresh worker per place, and the atlas leak fixed, changed nothing |
| Hot reloads from other sessions | Reproduced on a built site (`vite-preview`), which has none |

**Next steps**

1. Save & export → *3D scene* (the JSON scene package) while standing at view 2, and load it in Nanite's own harness
   (`vendor/threejs-nanites`, `tools/AGENTS.md`). If the first frame dies there too, the cause is in the engine and
   PGMaps is out of the loop.
2. In the harness, trace the first frame pass by pass (`drawScene`, god rays, TAA, output) and the camera it is
   drawn with, then switch each off in turn (`?rays=0`, `?taa=0`, the far forest, the software rasterizer) until it
   survives. A view looking a long way north is the likeliest to differ in the far forest, the shadow map's extent
   and the cluster lists.
3. Ask the device for its errors on that frame: `pushErrorScope('out-of-memory' | 'validation')` around the first
   frame's submits, and whether `device.lost` fires before the process dies (the trace records it when it does).
4. When the cause is found, fix it in the engine repository, move the pointer, and run this recipe again to the end.

**Decide**

- Option A (`RELEASE_ROAD_VIEW_STAND_FOR_ENGINE`) is on but has not been shown to help; it makes each place regrow
  its stand. Keep, switch off or remove once the crash is understood.
- Imported blocks keep their own objective (Partial retention by default) after the site landform's established
  objective (M) is adopted; the run uses the landform's, but the block cards and results print PR.

## The trace

The engine posts `pgmaps-engine-trace` (`{ phase, stage, ms, detail }`) as each stage of a build, final stand and
capture ends, and on a GPU error or a lost device. The page adds its own steps (skyline, scene package, stand growth,
request made and posted) with its heap. The last 200 lines are kept in this browser as they arrive, because the
engine's worker shares the tab's process:

```js
JSON.parse(localStorage.getItem('pgmaps.forestryVisuals.engineTrace') ?? '[]')
```

Clear it before a run (`localStorage.removeItem(…)`), read it after the crash from any page of the same origin.

## Rerunning it

- Use a built site, not the dev server: other sessions' saves reload every dev page. `npx vite build` (the full
  `npm run build` stops at `tsc -b` when another session's tests do not type), `node scripts/write-spa-fallback.mjs`,
  then the `vite-preview` launch entry (port 4173). After an engine build, unregister the service worker once or
  reload twice (before the `/engines/` fix the first load ran the old engine).
- Feed files to the browser pane by serving the folder from a local server on `127.0.0.1` that allows the preview's
  origin, then dispatching `dragenter`, `dragover` and `drop` with a `DataTransfer` of `File`s on
  `[data-testid="visuals-interface"]`.
- A hidden pane throttles animation frames: each place takes about 3–4 minutes (capture, before render, two engine
  renders).
