---
name: pgmaps-map-layer-loading
description: Make anything a PGMaps map loads appear as the map moves, never vanish and pop back, and prove it with a frame-by-frame measurement. Use when adding a map layer whose content depends on the view or on a changing choice (tiles, a COG, imagery, a WMS, a timeline, live WFS or ArcGIS reads, blocks), when a layer flickers, blanks, disappears while panning or zooming, shows empty edges, "loads only after I stop moving", or goes blank when a period, release, year or basemap changes, when someone shares a DevTools trace of a map moving, or when auditing a page's layers for smooth loading.
---

# PGMaps map layer loading

`docs/map-layer-loading.md` is the contract: the six rules, the pattern table, what MapLibre gives for nothing, and what is not built. Read it first; this file is the order of work. `scripts/map-loading/measure.mjs` is the measurement.

## Ground rules

- **Nothing is removed because the camera moves.** A layer goes only for a state the person can read: off, below its least zoom, a failed read.
- **Measure before and after, in a real browser.** Unit tests cannot see a blank frame. Never report a layer as fixed from reading the code.
- **Public hosts are not ours.** Loading during a move must be throttled, capped and aborted; report requests for the test journey before and after. Add no host to the service worker's `TILE_HOSTS` without its terms.
- **The generic pieces are toolkit code** (`docs/map-layer-loading.md`, **Where this lives**): the view window, the hand-off, the tile, hillshade and image layers. A change to one goes to the `ahzs645/geo-toolkit` repository first, through its CI, then the pointer moves; never edit `packages/geo-toolkit` as part of a page fix. Build it there from a clean worktree: the shared checkout's toolkit may hold another session's edits.
- **Docs are contracts.** A limit changes with its constant, in the layer's own guide. Edit `docs/` with the Edit tool only; never run prettier there.

## 1. Find what the layer does today

If there is a trace (`.gz` of DevTools JSON), read it before the code: decode it with `python3 -I`, list `ResourceSendRequest` URLs against time, and extract the `Screenshot` frames into a contact sheet. The frames show what vanishes and when; the request times show whether loading waited for the stop.

Then in the code, look for the patterns that cause it:

- `visible: … && !moving`, or a hook that returns `image: null` while not visible or while the next is read or encoded.
- Bounds handed out only on `moveend`, after a debounce (`…_IDLE_MS`).
- A component that returns `null` while something is pending, unmounting its `MapImageLayer` or `MapRasterLayer`.
- `<MapRasterLayer key={…}>`: a remount on a change of source or of `beforeId`.
- A loader run with `loadNew = !map.isMoving()`.
- An overlay set to `null` while the page checks or fetches something for the next choice.
- A search, a rating or a selection keyed to the exact bounds, so every pan resets it.

Check whether the rule is deliberate before changing it: `git log -S` on the line, the layer's guide, a test that pins it. `docs/map-layer-loading.md`, **When the settled view is right**, lists the cases that stay.

## 2. Measure the baseline

```sh
nohup npx vite --config scripts/map-loading/vite.frozen.config.ts --host 127.0.0.1 --port 42320 --strictPort > tmp/map-loading/vite.log 2>&1 &
node scripts/map-loading/measure.mjs --url '<page on 127.0.0.1:42320>' --layer <layer id> --host <data host> \
  --setup scripts/map-loading/setups/<page>.mjs --label before
```

- Write the page's setup file in `scripts/map-loading/setups/` (turn the layer on; `actions` for a change of source). `road-canopy.mjs` (tiles), `cciss-tiles.mjs` and `road-wayback.mjs` (a change of source) and `road-relief.mjs` (a change of place) are the examples. The script prints the map's layer ids, so a wrong `--layer` is easy to see.
- For the untouched behaviour, point `--url` at `https://pgmaps.ahmadjalil.com` (main) or at a detached worktree's server. Do not `git stash` in the shared checkout.
- The server is frozen: restart it after every edit (`lsof -tiTCP:42320 -sTCP:LISTEN | xargs kill`), and stop it when done. Browse `127.0.0.1`, never `localhost`.
- Launching Chrome needs the sandbox off for that command. Poll with short waits: a tool call that times out during a long job kills the page's script.

## 3. Choose the pattern

Take the first row of the table in `docs/map-layer-loading.md` that fits:

1. **Tiles** if it is or can be cut into XYZ tiles. For a file, check its real layout first; if one block is one tile, write an `addProtocol` handler like `src/pages/dev-forestry-roads/canopy/chmTileProtocol.ts`.
2. **Hand-off** (`useMapLayerHandoff`, `MapRasterHandoff`, `MapHandoffNote`) if a tile layer's source changes.
3. **A changed `beforeId`** if it only changes place in the stack: the toolkit's layers move and keep their tiles.
4. **View window** (`useViewWindow`) if it is one picture or one bounding-box read a view.
5. **Blocks** (`MapCategoricalRaster`) if it is a block pyramid.

Before building anything new, look for a layer in the app already doing it right and generalise that: the user wants fixes as shared, opt-in building blocks in `src/components/ui`, `src/components/map` or `src/lib/map`, not page patches.

## 4. Build it

- Keep the rule DOM-free and unit-tested (the toolkit's `view-window.ts` and `map-layer-handoff.ts`, and `chmTiles.ts`, are the shape), with `fetch` and readers passed in; the hook or component over it stays thin.
- Hand the map a picture and its corners as one pair, as pixels (`MapImageLayer`'s `image`, an `ImageBitmap`), not a PNG behind an object URL. Abort what a new window or a tile leaving the view supersedes.
- Keep the layer's id, opacity, order and credit. Other code finds layers by id (`usePlanImageryOrder`, captures, specs).
- A test or a doc that pins the old wait-until-stopped behaviour is changed on purpose, to pin the new rule, and said so in the report.
- Panels lose "updates when you stop moving the map". A loading state must not change a card's height or blink for a quick read.
- Where a legend or readout follows a choice at once, add `MapHandoffNote`. Where a figure is read over more than the view, print the area.
- Check the capture paths still include the layer (`planCapture.ts` waits for the map's `idle`, which waits for tile sources).

## 5. Measure again and look

Run the same command with `--label after`. The run fails by itself when the layer was missing on any frame or the whole view went empty during a gesture. Then:

- Compare each column with the baseline (`docs/map-layer-loading.md`, **Measure it**, says what each means and what passes).
- **Open the screenshots** (`tmp/map-loading/out/<label>-*.png`) with the Read tool: mid-drag and after. Colours and alignment must match the old layer; magenta is the script's backing for empty ground.
- Check the cases the journey does not cover: off and on, below the least zoom and back, a failing or missing file (stub it with `page.route`), a change of source faster than its tiles arrive.
- Run the page's e2e specs, and check a failure against untouched code before blaming the change.
- `npx tsc -b`, `npx eslint <files> --max-warnings=0`, `npx prettier --check <src files>`, the unit tests.

## 6. Write it down

- The layer's own guide: the behaviour in a sentence, every limit with its constant.
- `docs/map-layer-loading.md`: a row in **What was measured**; move anything fixed out of **Not built**, and add what you found and left.
- `AGENTS.md`: one bullet for the layer's rule and the thing never to go back to, with the reason.
- The report: before and after numbers, requests to each host, what does not work, what was left out.

## Traps already paid for

- A hand-off whose request goes `null` for a moment (an availability check, a fetch for the next choice) blanks the map exactly as before. Hold the last good value (`usePublishedTiles`'s `shownTileId`).
- A raster source reports loaded before it has asked for a tile. Count it ready only once a tile of its own has landed and none is loading, or the map is idle.
- Two translucent layers drawn at once read darker. The incoming layer loads at opacity 0 and the swap has no opacity transition.
- `usePlanImageryOrder` on both layers of a hand-off makes each move the other above itself on every style change. Order only `shownLayerId`.
- MapLibre rounds raster zooms: a source with `minzoom` 12 draws from map zoom 11.5. Set the layer's own zoom range when a card says "paused below 12".
- MapLibre draws loaded parents but never fetches one. A fast zoom-out shows new ground empty until its tiles land; no map option changes that.
- A wider read window makes a "clear share" or "hectares changed" cover more than the map shows. Say the area.
- A label that wraps its dropdown has the chosen value in its accessible name, so `getByLabel(…, { exact: true })` finds nothing. Find the trigger inside the label (`setups/cciss-tiles.mjs`).
- deck.gl overlays draw nothing if `map.transform` is missing (the toolkit's `useDeckOverlay` puts it back for MapLibre 6). A deck.gl layer that never appears is that, not loading: check the console for "reading 'height'".
