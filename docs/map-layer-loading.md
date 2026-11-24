# Map layer loading

How anything a map loads because of where the camera is, or because a choice changed, gets on
screen: as the map moves, without disappearing, and without the map and the words beside it
disagreeing unsaid. This is the contract for a new layer and the checklist for an old one. The
process that applies it, with the measuring script, is the skill
`.agents/skills/pgmaps-map-layer-loading/SKILL.md`.

It was written in November 2026 after a trace of the road designer showed the canopy height layer
vanishing on every pan and returning 1.5 s after the pan stopped. The cause was a pattern, not a
bug: read one picture of the *settled* view, and hide the old one while the map moves. Five layers
were moved off that pattern or its relatives; the figures are under [What was measured](#what-was-measured).

## The rule

1. **Nothing is removed because the camera moves.** What is drawn stays drawn, at its own place on
   the ground, until its replacement is ready. A layer is taken off only for a stated state the
   person can read: switched off, below its least zoom, a failed read.
2. **Loading starts while the map moves**, throttled, not after it stops. Waiting for the settled
   view is the exception and needs a reason (see [When the settled view is right](#when-the-settled-view-is-right)).
3. **A superseded read is aborted**, and a request that leaves the view is dropped. Loading during
   a move must not cost a public host more than the journey needs.
4. **A swap is one frame.** The outgoing picture and the incoming one are never both absent and
   never both drawn where either is translucent.
5. **When the map lags a choice, say so.** If the legend, a readout or the sidebar already names the
   new choice while the map still shows the old one, the map says it has not caught up
   (`MapHandoffNote`). A figure computed over more ground than the view states the area it covers.
6. **It is measured, not judged by eye.** A layer passes `scripts/map-loading/measure.mjs` before it
   ships, and the numbers go in its own guide.

## Choose the pattern

Work down the list and take the first that fits.

| What the layer is | Pattern | Building block |
|---|---|---|
| A raster that already is, or can be cut into, XYZ tiles: a tile server, a WMS, a Web Mercator COG whose internal blocks line up with map tiles | **Tiles.** A MapLibre `raster` source. For a file with no tile server, an `addProtocol` handler that reads one block a tile | `MapRasterLayer`; the canopy layer's `chmTileProtocol.ts` is the worked example |
| The same tile layer, but its *source* changes: a timeline release, a year, a scenario, a species | **Hand-off.** The shown layer stays until the next has its tiles, then they swap in one frame | `useMapLayerHandoff`, `MapRasterHandoff`, `MapHandoffNote` (`@/components/ui/map-raster-handoff`, from the toolkit) |
| A tile layer that only changes *place* in the stack (Map ↔ Satellite) | **Change its `beforeId`.** `MapRasterLayer` and `MapTerrain` move the layer and keep its tiles; a remount asks the host for every tile again | The layers' own `beforeId`; `useReliefPlace` (`@/components/ui/map-regional-relief`) keeps a place as the style changes round it |
| One picture per view that cannot be tiled cheaply: another projection, a search or a rating over the window, pixels computed from several reads | **View window.** Read 1.5 × the view, keep it while the view stays inside, ask for the next during the move | `useViewWindow` (`@/components/ui/map-view-window`, from the toolkit), with `MapImageLayer`'s `image` for the picture |
| Vector or gridded data cut into blocks on a pyramid | **Blocks in view during the gesture**, a bounded number of GPU uploads a frame, the prefetch ring after it | `MapCategoricalRaster`, `ViewportBlockLoader` scope `'visible'` |
| Features read by bounding box from a live service (WFS, ArcGIS) | **View window** over the read; keep the features drawn until the next answer; for more than one read a view, snap to a fixed grid and cache by cell | `useViewWindowRead` (`@/components/ui/map-view-read`), over `useViewWindow`; no shared grid reader exists yet (see [Not built](#not-built)) |
| Something drawn from a scene, a block or a click, not from the view | None of this applies | — |

### Tiles: what MapLibre does for nothing

Verified in the installed MapLibre 6.18 source. This is why tiles come first.

- Tiles are requested on every frame of a move. No code of ours decides when.
- While an ideal tile loads, MapLibre draws **already loaded** children (3 levels down) or parents
  (up to 10 levels up). It never fetches a parent as a stand-in, so a fast zoom-out shows new
  ground empty until its tiles arrive.
- A loading tile that leaves the view is aborted, and the abort controller reaches an
  `addProtocol` handler. Pass its signal to the read.
- An `addProtocol` handler for a raster source may return an `ImageBitmap`, used without decoding.
- A source `maxzoom` overzooms past it. `tileSize` 512 at map zoom *z* draws tile zoom *z*.
- `raster-fade-duration` (300 ms unless set) cross-fades arrivals. Classes drawn nearest want it
  short (the canopy layer uses 150); `0` pops.
- Nothing prefetches a ring round the view, and nothing debounces. Bound concurrency to a public
  host yourself, in the handler.

What MapLibre does not do, the toolkit's layers do: `MapRasterLayer` follows a changed `beforeId`
with `moveLayer` and a changed `tiles` with `setTiles` (tile by tile, so two versions show side by
side meanwhile), and `MapTerrain` moves its hillshade. Never remount a tile layer with a `key`:
that is what blanks it. A source that must change as a whole uses the hand-off.

### A file as tiles (`addProtocol`)

Do this when a file's own layout matches the tile grid, as Meta's canopy COGs do: Web Mercator,
512 px blocks, one file a zoom-10 tile, so a 512 px map tile at zoom 10–16 is exactly one block of
one image and costs one byte range. Check the layout against a real file first, and find an
overview by its width, never its IFD number.

- The tile maths is DOM-free with `fetch` and the reader passed in (`chmTiles.ts`), and a unit test
  shows a tile holds exactly the cells the old window read held.
- The handler is registered once, reads with the tile's abort signal, caps reads at once
  (`CHM_TILE_MAX_REQUESTS`), shares one header cache, and asks for a missing file once.
- A tile with nothing in it returns no data, which MapLibre draws clear. A failed tile is counted
  for the layer's card; it never blanks its neighbours.
- Measure the decode on the page's thread. Under a few milliseconds a tile it needs no worker
  (the canopy's is 1.7 ms median).
- A file in another projection (Sentinel-2 is UTM) needs a warp a tile. Use a view window instead
  unless that cost is worth paying.

### Hand-off: a tile layer whose source changes

`docs/shared-ui.md`, **Swapping a tile layer without a blank**, is the full contract. In short:

```tsx
const handoff = useMapLayerHandoff('my-layer', value ? { key: value.id, value } : null)
// …inside the <Map>:
<MapRasterHandoff handoff={handoff} opacity={0.8} layer={(value) => ({ tiles: [value.tiles] })} />
<MapHandoffNote handoff={handoff}>Loading the new layer. The map still shows the previous one.</MapHandoffNote>
```

- The request must stay non-null across the change. A page that sets its overlay to `null` while it
  checks or fetches something for the next choice turns the hand-off off and blanks the map anyway:
  hold the last good value until the next is known (`usePublishedTiles`'s `shownTileId`). The
  measuring script caught exactly this on CCISS.
- Order and read only `handoff.shownLayerId`.
- Add `MapHandoffNote` wherever a legend, readout or sidebar follows the choice at once. It shows
  only after `HANDOFF_NOTE_DELAY_MS` (400 ms), so a quick swap says nothing.

### View window: one picture, or one read, a view

`docs/shared-ui.md`, **View windows**, is the full contract. The parts people get wrong:

- Never pass `visible: … && !moving` to the reader, and never return `null` while the next picture
  is read or prepared. Hand the map the picture and its corners as **one pair**.
- Give `MapImageLayer` the pixels (`image`, an `ImageBitmap` made with `createImageBitmap`), not a
  PNG behind an object URL: no encode, request or decode (`usePreparedImage`, Sentinel-2).
- Pick the resolution from the **view**, then read the larger window at it, or the picture gets
  coarser than it was.
- Keep what the window feeds apart from what the *choice* feeds. A pan must not run a catalogue
  search, reset a selection or re-rate a list when the things already listed still cover the new
  window (`catalogueServes`, Sentinel-2).
- Figures read over the window cover more than the visible map. Print the area.
- An option left unset, or passed as `undefined`, keeps its default (`viewWindowRule`, toolkit
  8b16710). Before that fix an `undefined` replaced the default with an overscan of 1 and no
  throttle, which read a new window on every frame of a drag (62 reads in 3 s on the outdoors
  planner's cutblocks); `map-view-read.test.tsx` and the toolkit's `view-window.test.ts` pin it.
- For features read by box, `useViewWindowRead` keeps the last answer drawn while the next is read,
  keeps it after a failed read and reports the error, aborts the read a newer window supersedes, and
  takes the layer off only below its `minZoom`, which the caller states. A WFS layer read at full
  detail reuses its window at every zoom (`level` constant); an ArcGIS layer generalised to the zoom
  (`maxAllowableOffset`) reads again at each zoom level up to a cap.

### Blocks

`MapCategoricalRaster` loads the blocks the view shows on its throttled `move`, uploads at most
`GESTURE_BLOCK_UPLOADS_PER_FRAME` to the GPU a frame, leaves the prefetch ring for `moveend`, and
keeps the coarser level while a gesture zooms in. `loadWhileMoving={false}` and Save-Data give the
settled view. `docs/shared-ui.md` and `docs/cciss-site-suitability-integration.md` hold the limits.

## When the settled view is right

Loading during the move is the default, not a law. These load on the settled view on purpose, and
their tests pin it:

- **A scripted camera.** A story chapter flies to a view; what matters is the destination
  (`StoryClimateLayers`, `EditorialMap`, which keeps its previous features and bridges from a
  coarser cached view).
- **A read with a hard price a request**, where a pan would spend it on ground the person passes
  over: a paced public catalogue, a job on someone else's server. Keep the picture up; delay only
  the read.
- **A view-relative figure**, such as a table of what is in view. It follows the settled view
  through `useObserveMapViewport`. It still must not clear what it shows while waiting.

In each case rule 1 still holds: nothing disappears.

## Measure it

`scripts/map-loading/measure.mjs` drives a real Chrome on the real GPU through a 2 s drag, a zoom in
and a zoom out (the journey of the original trace), or through steps of your own, and samples every
rendered frame from inside the map's `render` event. It hides every other layer over magenta, so
"empty" is counted in pixels, not guessed.

```sh
npx vite --config scripts/map-loading/vite.frozen.config.ts --host 127.0.0.1 --port 42320 --strictPort
node scripts/map-loading/measure.mjs \
  --url 'http://127.0.0.1:42320/dev/forestry/road-design?interface=ribbon&example=training' \
  --map '[data-testid="road-plan-view"] .maplibregl-map' \
  --layer road-canopy-height --host source.coop \
  --setup scripts/map-loading/setups/road-canopy.mjs --center -122.6,54.0 --zoom 14 --label after
```

A setup file (`scripts/map-loading/setups/`) holds what only that page knows: the clicks that turn
the layer on, and any `actions` to measure as phases of their own (a period change, a release
step). The script's header lists every option.

| Column | Meaning | Pass |
|---|---|---|
| `framesWithoutLayer` | Frames where the layer or its source was not on the map | **0**, or the run fails |
| `framesAllEmptyDuringGesture` | Frames of the gesture with the whole view empty when it does not end that way | **0**, or the run fails |
| `peakExtraEmptyShare` | The most of the view left empty that later filled | Small on a pan (the canopy: 0.014). A fast zoom-out is larger (0.23): MapLibre fetches no parents |
| `filledMsAfterGesture` | How long after the gesture the last of it filled | 0 on a pan |
| `requestsDuringGesture`, `firstRequestMs` | Whether loading started during the move | Above 0 on a pan that exposes new ground; 0 is right when overscan covered it |
| `requests` | The cost to the host | Compare with the baseline; explain a rise |
| `longFrames`, `worstFrameMs` | Frames over 50 ms | 0 from the layer's own work |

Rules for a run:

- **Baseline first.** Run the untouched code in the same minutes: `https://pgmaps.ahmadjalil.com`
  runs main, or serve a detached worktree. Timings on this machine are upper bounds; other sessions
  share it.
- **The frozen server.** `vite.frozen.config.ts` does not watch or reload, so a run is not
  interrupted by another session's edit. It serves modules stale: restart it after every edit, and
  stop it by the PID listening on its port.
- **Look at the pictures.** The script saves one mid-drag and one after each phase. A number can be
  right while the picture is wrong (colours, alignment, a seam).
- **A zero is not proof by itself.** `framesWithoutLayer` is 0 for a layer that never appeared;
  check `finalEmptyShare` and the pictures show it drawn.
- deck.gl layers have generated ids: follow them with `--layer-prefix`, or pass `--no-isolate` and
  read presence, requests and long frames only.

## What was measured

Real Chrome, Metal GPU, live hosts, 19 November 2026. Before is main at fc5abf3f.

| Layer | Pattern | Before | After |
|---|---|---|---|
| Canopy height (road designer) | Tiles through `pgmaps-chm://` | Gone on 178 of 179 frames of a 2 s drag, back 1.5 s after | Never gone; first read 0.5 s into the drag; 15 → about 55 requests for the journey, each one block |
| Sentinel-2 (road designer) | View window | Source missing on 2,595 of 3,189 frames; 3 searches | 0 of 1,322; 1 search; 42 → 36 reads |
| Wayback release change | Hand-off | Imagery gone 270–360 ms over 6 changes, 3.2–3.8 s on a slow link | Never gone, same requests |
| NRCan and regional relief on Map ↔ Satellite | `moveLayer` | Nothing drawn 0.6 s; 16 tiles asked for again | Never gone; no requests |
| CCISS / portal blocks | Blocks during the gesture | 52% of new ground drawn at release | 97–100%; no long frames; a fast zoom-out 14 → 28 requests |
| CCISS original tiles, period change | Hand-off + note | Layer removed for the availability check and the reload | 0 frames without it |
| Outdoors planner cutblocks, forest roads, sightlines (21 November) | View window over the read | First read 3.1 s into the drag, after it stopped; up to 18% (cutblocks) and 27% (sightlines) more of the view empty mid-drag | First read 0.6 s into the drag; 2–6% more empty mid-drag; 4 reads a 3 s drag; never gone |
| Outdoors planner rail, hunt zones, lake charts (21 November) | View window over the read | Not measured before (same reader as above) | Never gone; 4 reads a 3 s drag, none on a zoom-in inside the window |
| Outdoors planner dated imagery, date change (21 November) | Hand-off + note, the shared imagery timeline | Gone on every frame of each of 4 day changes (a remount per day) | 0 frames without it, Wayback and NASA feeds; the road designer's Wayback on the same code 0 of 37 |
| Sentinel-2 scenes as tiles (21 November) | Tiles through `pgmaps-s2` (`addProtocol`), read and warped in a worker | Read on the page's thread: 7–11 long frames a date step, worst 311 ms | 0 of 106 frames without it; at most one long frame (68 ms) |
| Block planner old forest, year change (24 November) | One source per drawing, kept up while the worker draws the next; legend note after `HANDOFF_NOTE_DELAY_MS` | New layer | 0 frames without it over three year changes (8 frames each); stubbed DataBC, software rendering in a Linux container (`--executable`), so frame timings are not comparable |

## Not built

Known gaps, so nobody assumes they are covered.

- **Slow tile hosts still leave edges empty.** NRCan's 1 m relief takes 0.5–1.7 s a tile; a pan
  shows 6–8% of the view empty for about a second and a zoom-out up to 62%. Not cancelling tiles
  while zooming, 1024 px tiles and a larger cache were measured and did not help; a coarse stand-in
  under a translucent layer double-draws. MapLibre has no ancestor preload.
- **No shared grid reader for bounding-box vector reads.** The view window covers one read a view.
  Snapping to grid cells, caching by cell and aborting cells that leave the view (OpenLayers' tile
  loading strategy) would be the next building block; nothing in the app needs it yet.
- **Other layers that still remount on a change of data**, not of camera: `ScoreBuilderMap`'s image
  source (wants `updateImage`), `NativeSuitabilityLayer` (its image is deleted on unmount).
- **Layers that redraw on `moveend` only** and show empty edges until then: `StreetCanvas`
  (`/dev/flatten`), the census chunks in `/dev/boundaries`, the transit heat surface (which already
  carries its old frame across).

## Where this lives

The generic pieces are in the toolkit (`packages/geo-toolkit/src/map/`, documented in its
`API.md`), and PGMaps reaches them through compatibility entry points as it does the rest of the
toolkit (`docs/toolkit-extraction.md`):

| Piece | Toolkit | PGMaps entry point |
|---|---|---|
| View-window rule and hook | `view-window.ts`, `use-view-window.ts` | `@/components/ui/map-view-window` |
| Hand-off rule, layers and note | `map-layer-handoff.ts`, `map-raster-handoff.tsx` | `@/components/ui/map-raster-handoff` |
| Tile and hillshade layers that follow `beforeId` and `tiles` | `layers/raster.tsx`, `layers/terrain.tsx`, `layers/place.ts` | `@/components/ui/map-layers` |
| Image layer that takes pixels and a credit | `layers/canvas.tsx`, `layers/image-pixels.ts` | `@/components/ui/map-layers` |
| `map.transform` for deck.gl on MapLibre 6 | `map-transform.ts`, called by `useDeckOverlay` | `@/components/ui/map-deck` |

A change to any of these goes to the `ahzs645/geo-toolkit` repository first, through its CI, and
then the submodule pointer moves. The toolkit has no component tests, so the hand-off's is here
(`src/components/ui/map-raster-handoff.test.tsx`, mocking the toolkit modules it imports).

`ImageryTimeline` and its frame hand-offs (`src/components/ui/imagery-timeline.tsx`, over the feeds in
`src/lib/imageryFeeds/`; `docs/imagery-feeds.md`), `useViewWindowRead` (`src/components/ui/map-view-read.ts`,
the box read over the view window) and
`RegionalReliefLayer` (`src/components/ui/map-regional-relief.tsx`, with its DOM-free placement
rules in `src/lib/mapReliefPlace.ts`) are app code for now, shared by the road designer and the
outdoors planner; both could move to the toolkit with the rest.

`MapCategoricalRaster` and the canopy protocol stay in the app: they depend on PGMaps' data paths,
workers and a domain's files. So does the measuring script, which drives PGMaps' own pages.

## Sources

Read in November 2026; the behaviour named is in each project's own source.

- OpenLayers `ImageWMS` / `ImageLayer`: `ratio` 1.5, reuse while the view is inside the image, the
  old image kept until the new one loads. The model for the view window.
- Leaflet `GridLayer`: loads during a pan on a 200 ms `updateInterval`, `keepBuffer` 2.
- deck.gl `TileLayer`: `refinementStrategy: 'best-available'`, tiles out of view aborted;
  deck.gl-geotiff (MIT): 50 ms settle, range reads on the COG's own block grid.
- maplibre-cog-protocol (MIT): a COG as XYZ tiles through `addProtocol`; 256 px tiles, Web Mercator
  only, ignores the abort controller. Read for the idea; ours is written for one block a tile.
- Leaflet.NonTiledLayer (ISC): two images and a key, the stale reply dropped.
- Cesium `Globe`: `preloadAncestors`, what MapLibre lacks.
