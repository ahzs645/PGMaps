# Imagery feeds and the imagery timeline

A map that shows imagery by date does it with one shared timeline over a **feed**: a source that
offers the same ground at many dates as XYZ tiles. The timeline does not know any one source. A new
source is one feed object, and every page with a timeline can offer it.

| Part | Where | What it does |
|---|---|---|
| Feed contract | `src/lib/imageryFeeds/feed.ts` | `ImageryFeed`, `ImageryFrame`, `ImageryTileLayer`, `ImageryCapture`; `checkFrames`, `shownChange`. DOM-free |
| Feeds | `src/lib/imageryFeeds/waybackFeed.ts`, `gibsHlsFeed.ts` | Esri Wayback, NASA GIBS daily Landsat and Sentinel-2. DOM-free, `fetch` passed in |
| Registry | `src/lib/imageryFeeds/index.ts` | `IMAGERY_FEEDS` in chooser order, `imageryFeedById` |
| Timeline state | `useImageryTimeline` (`src/components/ui/imagery-timeline.tsx`) | The feed's frames, the one chosen, the frames that change the map centre, what a frame captured there |
| Strip | `ImageryTimeline` | The toolkit's `MapTimeline` along the map's bottom, with the capture date, the "only changes here" switch and the period labels |
| Map layers | `useImageryFrameHandoffs`, `ImageryFrameLayers` | One hand-off a frame layer, so a new date loads behind the one shown and swaps in one frame |

Users today: the road designer's plan (`PlanView.tsx`, Wayback only, layer `road-wayback`) and the
outdoors planner's **Dated imagery** (`src/maps/outdoors/BaseLayers.tsx`, a chooser over
`IMAGERY_FEEDS`, layer `outdoors-dated`).

## What a feed gives

Required:

- `listFrames(context)`: every frame, **oldest first**. A frame is an `id` (stable: the caches and
  the hand-off key on it), a `date` (YYYY-MM-DD, UTC) and 1 to `MAX_FRAME_LAYERS` (4) tile layers,
  drawn bottom first. A feed whose dates are known without asking (GIBS) builds them; one with a
  catalogue (Wayback) reads it. Throw with a message a person can act on.
- Its words: `label` (the chooser), `description`, `dateMeaning` (the strip's accessible name: say
  what the date is, a mosaic release or a pass), `loadingText`, `retryLabel`.
- `period`: `'year'` for a feed with a few frames a year, `'month'` for a daily one. The axis labels
  one per period, and clicking a label opens that period with a label a frame.
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

`context.fetch` is called as a method by the feeds; the timeline hands in a function that calls the
real one unbound, because the browser's `fetch` refuses any `this` but the window (it failed every
Wayback place check with *Illegal invocation* until that was done; `imagery-timeline.test.tsx` pins it).

## Adding a feed

1. Write `src/lib/imageryFeeds/<name>Feed.ts` meeting `ImageryFeed`, free of DOM access, its
   network reads through `context.fetch` with `context.signal`, and a test that runs `listFrames`
   through `checkFrames` with a fake `fetch`.
2. Add it to `IMAGERY_FEEDS`. The outdoors planner offers it at once; the road designer offers
   Wayback only, by choice.
3. Check the host's terms allow the use, and add its credit to each tile layer's `attribution`.
   Never add its host to the service worker's `TILE_HOSTS` without its terms
   (`docs/app-updates-and-caching.md`).
4. Measure a date change on a real map (`scripts/map-loading/setups/outdoors-layers.mjs` with
   `OUTDOORS_LAYER='Dated imagery'` and `OUTDOORS_FEED=<id>`): no frame without the layer.

A source that is not XYZ tiles (a COG per date, such as the road designer's Sentinel-2 reads) can
become a feed through a MapLibre protocol (`addProtocol`) that serves its tiles, as the canopy layer
does; the timeline need not change.

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

## What was measured

Real Chrome on the Metal GPU, live hosts, 21 November 2026, four date steps on each:

| Map | Feed | Frames without the layer | Note |
|---|---|---|---|
| Road designer plan | Esri Wayback | 0 of 37 | `road-wayback.mjs`; the designer's 5 Wayback e2e tests pass on the shared timeline |
| Outdoors planner | Esri Wayback | 0 of 44 | *Captured 2023-04-27 · 46 cm*, 13 of 199 releases change the picture in central Prince George at zoom 15 |
| Outdoors planner | NASA daily passes | 0 of 74 | Days with no pass over the spot draw nothing, as they should; GIBS answered 11 tiles with HTTP 500 |
