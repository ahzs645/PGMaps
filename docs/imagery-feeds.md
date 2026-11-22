# Imagery feeds and the imagery timeline

A map that shows imagery by date does it with one shared timeline over a **feed**: a source that
offers the same ground at many dates as map tiles. The timeline does not know any one source. A new
source is one feed object, and every page with a timeline can offer it.

| Part | Where | What it does |
|---|---|---|
| Feed contract | `src/lib/imageryFeeds/feed.ts` | `ImageryFeed`, `ImageryFrame`, `ImageryTileLayer`, `ImageryCapture`; `checkFrames`, `shownChange`. DOM-free |
| Feeds | `src/lib/imageryFeeds/waybackFeed.ts`, `sentinel2Feed.ts`, `gibsHlsFeed.ts` | Esri Wayback, Sentinel-2 L2A scenes, NASA GIBS daily Landsat and Sentinel-2. DOM-free, `fetch` passed in |
| Registry | `src/lib/imageryFeeds/index.ts` | `IMAGERY_FEEDS` in chooser order, `imageryFeedById` |
| Tile protocols | `src/components/ui/imagery-protocols.ts` | The browser modules that serve a feed's own tile scheme (`pgmaps-s2`), registered before its layers draw |
| Timeline state | `useImageryTimeline` (`src/components/ui/imagery-timeline.tsx`) | The feed's frames, the one chosen, the frames that change the map centre, what a frame captured there |
| Strip | `ImageryTimeline` | The toolkit's `MapTimeline` along the map's bottom, with the capture date, the "only changes here" switch and the period labels |
| Map layers | `useImageryFrameHandoffs`, `ImageryFrameLayers` | One hand-off a frame layer, so a new date loads behind the one shown and swaps in one frame |

Users today:

- The road designer's plan (`PlanView.tsx`): Wayback only, layer `road-wayback`, test ids `road-wayback-*`.
- The outdoors planner's **Dated imagery** (`src/maps/outdoors/BaseLayers.tsx`): a chooser over
  `IMAGERY_FEEDS`, layer `outdoors-dated`, test ids `outdoors-dated-*`.
- The MMGIS workbench's **Historical imagery** (`src/pages/dev-mmgis/DatedImageryPanel.tsx`): picks
  one date of a feed and adds its layers as mission overlays. A mission is saved and shared as plain
  HTTPS tile addresses, so it offers only the feeds without a `tileProtocol` (`MISSION_IMAGERY_FEEDS`).

## What a feed gives

Required:

- Its frames, **oldest first**, from one of:
  - `listFrames(context)`: every frame, for a feed whose dates do not depend on place. One whose
    dates are known without asking (GIBS) builds them; one with a catalogue (Wayback) reads it.
  - `listFramesAt(place, context)` with `listAreaKey(place)`: the frames over the map centre, for a
    feed searched by place (Sentinel-2). The timeline lists again only when the centre moves to
    another area key, keeps the last list meanwhile, and carries the chosen date to the new list.

  A frame is an `id` (stable: the caches and the hand-off key on it), a `date` (YYYY-MM-DD, UTC) and
  1 to `MAX_FRAME_LAYERS` (4) tile layers, drawn bottom first, each with its `maxZoom` and, where
  needed, `minZoom` and a `name` (`Landsat`, `Sentinel-2`). Throw with a message a person can act on.
- Its words: `label` (the chooser), `shortLabel` and `frameNoun` (labels and overlay names: *Browse
  Wayback releases*, *Wayback · 2024-03-21*), `description`, `dateMeaning` (the strip's accessible
  name: say what the date is, a mosaic release or a pass), `loadingText`, `retryLabel`.
- `period`: `'year'` for a feed with a few frames a year, `'month'` for a daily one or one whose
  listed dates fall within a year (Sentinel-2's 48 newest). The axis labels one per period, and
  clicking a label opens that period with a label a frame.
- `playbackMs` and `placeMaxZoom` (the deepest zoom it has real tiles for).

Optional, each offered only when present:

- `framesChangingAt(frames, place, context)`: the frames, oldest first, that change the picture at
  the map centre. The strip then lists only those by default, with a switch named `changesLabel`
  and explained by `changesHint`. Without it every frame is listed and no place is read.
- `captureAt(frame, place, context)` and `describes(frame)`: what a frame captured at the map
  centre (date, resolution, supplier). The strip prints *Captured …*; a frame that cannot say
  prints nothing.
- `placeKey(place)`: when two nearby places get the same answer (Wayback keys by the tile under
  the centre), so the timeline asks once.
- `tileProtocol`: the MapLibre protocol its tiles use when they are not plain HTTPS. Add its
  register function to `imagery-protocols.ts`; an unknown name throws rather than drawing blank tiles.

`context.fetch` is called as a method by the feeds; the timeline hands in a function that calls the
real one unbound, because the browser's `fetch` refuses any `this` but the window (it failed every
Wayback place check with *Illegal invocation* until that was done; `imagery-timeline.test.tsx` pins it).

A new feed never sees another feed's frames. The render in which the timeline notices a new feed
still holds the old list, and handing it to the new feed crashed the planner when the source
changed from NASA to Wayback (Wayback's `describes` read a NASA frame's empty source). The hook
treats the old list as gone in that render (`ownList`), and the switch test pins it with a feed that
refuses frames that are not its own.

## Sentinel-2 as a feed

`SENTINEL2_FEED` searches Element 84's Earth Search over a small box round the map centre (the
road designer's search, `src/lib/sentinel2/stac.ts`), keeps one scene a date, and draws each scene as
map tiles through the `pgmaps-s2` protocol (`src/lib/sentinel2/tileProtocol.ts`). Each tile is read
in a worker (`sentinelTiles.worker.ts`): the part of the scene's true-colour COG the tile covers, in
its UTM zone, at the coarsest overview the tile can use (`tileReadWindow`), then reprojected onto the
tile's 256 × 256 pixels, nearest neighbour, through a 16 × 16 projected grid (`warpTile`). No data is
clear. The strip prints the acquisition date and 10 m as what the scene captured, with the tile's
whole-scene cloud in its tooltip. The search, the UTM maths, the reader and the limits are the
designer's own, moved to `src/lib/sentinel2/` so both can use them.

## Adding a feed

1. Write `src/lib/imageryFeeds/<name>Feed.ts` meeting `ImageryFeed`, free of DOM access, its
   network reads through `context.fetch` with `context.signal`, and a test that runs its listing
   through `checkFrames` with a fake `fetch`.
2. If its tiles are not plain HTTPS, write the protocol (browser module, heavy work in a worker) and
   add it to `imagery-protocols.ts`.
3. Add it to `IMAGERY_FEEDS`. The outdoors planner offers it at once, and MMGIS too when its tiles
   are plain HTTPS; the road designer offers Wayback only, by choice.
4. Check the host's terms allow the use, and add its credit to each tile layer's `attribution`.
   Never add its host to the service worker's `TILE_HOSTS` without its terms
   (`docs/app-updates-and-caching.md`).
5. Measure a date change on a real map (`scripts/map-loading/setups/outdoors-layers.mjs` with
   `OUTDOORS_LAYER='Dated imagery'` and `OUTDOORS_FEED=<id>`): no frame without the layer, and no
   long frames from the feed's own work.

## Limits

| Limit | Value | Constant |
|---|---|---|
| Tile layers a frame | 1 to 4 | `MAX_FRAME_LAYERS` (`feed.ts`) |
| Places whose changes are kept | 64 a session, across feeds | `IMAGERY_PLACE_CACHE_SIZE` (`imagery-timeline.tsx`) |
| Capture records kept | 256 a session | `IMAGERY_CAPTURE_CACHE_SIZE` |
| Capture read | 150 ms after the frame settles, so a scrub asks once | `IMAGERY_CAPTURE_DELAY_MS` |
| A new date's hand-off | The previous frame stays until the next has tiles, at most 4 s | `LAYER_HANDOFF_TIME_LIMIT_MS` (toolkit) |
| Wayback | Catalogue 20 s, each tile-map or record read 10 s, tiles to zoom 18, play 2 s an entry | `WAYBACK_CATALOG_TIMEOUT_MS`, `WAYBACK_SPOT_TIMEOUT_MS`, `WAYBACK_MAX_TILE_ZOOM` (`src/lib/wayback.ts`), `WAYBACK_PLAYBACK_MS` |
| NASA daily passes | Newest day a week back, 240 days kept, tiles to zoom 12, play 1.5 s a day | `RECENT_IMAGERY_LAG_DAYS`, `RECENT_IMAGERY_ARCHIVE_DAYS`, `RECENT_IMAGERY_MAX_ZOOM`, `GIBS_HLS_PLAYBACK_MS` (`gibsHlsFeed.ts`) |
| Sentinel-2 dates | Last 2 years, under 60 % cloud, 100 items asked, 48 dates kept, listed again in another 0.1° cell | `SENTINEL_RECENT_DAYS`, `SENTINEL_CLOUD_MAX_PERCENT`, `SENTINEL_FEED_SEARCH_LIMIT`, `SENTINEL_FEED_MAX_SCENES` (`src/lib/sentinel2/limits.ts`), `SENTINEL_FEED_AREA_DEG` (`sentinel2Feed.ts`) |
| Sentinel-2 tiles | Zooms 9 to 14, 6 tile reads at once in one worker, play 1.5 s a scene | `SENTINEL_TILE_MIN_ZOOM`, `SENTINEL_TILE_MAX_ZOOM`, `SENTINEL_TILE_READ_CONCURRENCY`, `SENTINEL_PLAYBACK_MS` |

## Tests

- Unit: `feed.test.ts`, `waybackFeed.test.ts`, `gibsHlsFeed.test.ts`, `sentinel2Feed.test.ts`,
  `src/lib/sentinel2/tiles.test.ts` (tile window, warp, address), `imagery-timeline.test.tsx` (the
  hook with made-up feeds: located listing, feed switch, month periods, unbound `fetch`),
  `src/pages/dev-mmgis/DatedImageryPanel.test.ts` (overlays and their saved zoom).
- End to end: `tests/e2e/outdoors-layers.spec.ts` (NASA's days stepped, the switch to Wayback with
  its local changes and capture date), `forestry-road-sentinel2.spec.ts` (the designer's Wayback),
  `mmgis-parity.spec.ts` (adding a Wayback date to a mission).

## What was measured

Real Chrome on the Metal GPU, live hosts, 21 November 2026, four date steps on each:

| Map | Feed | Frames without the layer | Note |
|---|---|---|---|
| Road designer plan | Esri Wayback | 0 of 37 | `road-wayback.mjs`; the designer's 5 Wayback e2e tests pass on the shared timeline |
| Outdoors planner | Esri Wayback | 0 of 44 | *Captured 2023-04-27 · 46 cm*, 13 of 199 releases change the picture in central Prince George at zoom 15 |
| Outdoors planner | NASA daily passes | 0 of 74 | Days with no pass over the spot draw nothing, as they should; GIBS answered 11 tiles with HTTP 500 |
| Outdoors planner | Sentinel-2 scenes | 0 of 106 | Reading tiles on the page's thread gave 7–11 long frames a date step (worst 311 ms, nearly all GeoTIFF decoding); in the worker, at most one (68 ms) |
