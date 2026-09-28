# JSON map stories

PGMaps project packages can render a scroll-driven map when `workspace.type` is
`"story-map"` and `workspace.schema` is `"story-map-v1"`.

The complete working example is
`public/data/projects/where-is-north-bc.json`. Add a package filename to
`public/data/projects/index.json` to make it appear in `/dev/projects`.

A story renders inside the standard `MapSectionLayout` shell, so it inherits the
same chrome as every other PGMaps map page: a collapsible, resizable narrative
sidebar on desktop, a drag-to-expand bottom sheet on mobile, the shared legend
panel, and light/dark theming. Author the data; the renderer supplies the design.

## Story contract

The normal project-package fields (`title`, `summary`, `layers`, `scenes`,
`files`, and so on) remain the catalog and download contract. A map story adds:

```json
{
  "kind": "map-story",
  "layers": [
    {
      "id": "areas",
      "label": "Example areas",
      "type": "boundary",
      "checked": true
    }
  ],
  "scenes": [
    {
      "label": "Opening",
      "kicker": "01 · Context",
      "title": "A card title",
      "text": "The narrative shown in the scrolling card.",
      "focus": "Short map-state label",
      "visibleLayerIds": ["areas"],
      "placeIds": ["example-place"],
      "camera": {
        "center": [-125, 54],
        "zoom": 5,
        "bearing": 0,
        "pitch": 0
      }
    }
  ],
  "workspace": {
    "type": "story-map",
    "schema": "story-map-v1",
    "accent": "#047857",
    "map": {
      "center": [-125, 54],
      "zoom": 5,
      "minZoom": 3,
      "maxZoom": 12,
      "basemap": "auto"
    },
    "places": [
      {
        "id": "example-place",
        "label": "Example place",
        "coordinates": [-122.7, 53.9],
        "note": "Optional popup copy.",
        "color": "#047857"
      }
    ],
    "layers": []
  }
}
```

Each scene is declarative. When its card becomes the active one, the renderer
eases the camera to its position, replaces the visible layer set, applies its
highlights and overrides, and shows only its listed places. Readers can still
open the Layers panel and change the map stack by hand; a **Reset** action
appears while the stack differs from the scene's own.

`workspace.accent` colours the story chrome and is the default highlight
outline. `workspace.map.basemap` is `"auto"` (follow the app's light/dark
theme), `"light"`, or `"dark"`.

## Story options

`workspace.options` tunes how the renderer presents the story. Every field is
optional; omitted fields keep the defaults shown here:

```json
{
  "options": {
    "layout": "panel",
    "sidecarVariant": "docked",
    "storyTheme": "paper",
    "storyCover": true,
    "chapterNavigation": true,
    "narrativeSide": "left",
    "narrativeWidth": "medium",
    "sceneTransition": "ease",
    "sceneTransitionMs": 1150,
    "mobileSheet": "half",
    "mobilePeekSceneText": false,
    "mobilePeekTicker": false,
    "legendCollapsed": "auto",
    "mapControls": "auto",
    "cameraFit": "auto",
    "slidesSwipeHint": "off"
  }
}
```

- `layout` — the overall presentation:
  - `"panel"` (default) — the native PGMaps shell: scrollytelling sidebar on
    desktop, drag-to-expand bottom sheet on mobile.
  - `"scrolly"` — replicates the Mapbox/MapLibre storytelling template
    ([mapbox/storytelling](https://github.com/mapbox/storytelling),
    [opengeos/maplibre-gl-storymaps](https://github.com/opengeos/maplibre-gl-storymaps)):
    fullscreen map with chapter cards scrolling over it, left-aligned on wide
    screens and centered on phones, scroll position driving the camera. On
    desktop the story layer only claims the pointer where a card actually is,
    so the map behind stays pannable and keeps its zoom controls; a wheel over
    the bare map still scrolls the story. On phones the card lane covers the
    map, so reading mode keeps the whole surface for story scrolling. An
    **Explore map** button hides the card lane and enables direct map interaction
    and zoom controls. **Read story** restores the same reading position.
  - `"slides"` — replicates [KnightLab StoryMapJS](https://storymap.knightlab.com/):
    map on top, a slide pane below with arrow gutters, horizontally scrollable dot navigation, keyboard
    arrows, and horizontal swipe on touch. The map stays interactive. The pane
    is as tall as the story's longest slide rather than a fixed fraction of the
    screen, so no slide is cut off and stepping never resizes the map; on a
    short screen it stops at 58% and the slide scrolls, with a fade at its foot
    marking the overflow.
  - `"sidecar"` — an editorial story with a cover, named chapter navigation,
    and map chapters presented as docked prose, floating prose, or a slideshow.
    It reuses the same scene, source, camera, legend, and interaction contract.
    See [Editorial sidecars](#editorial-sidecars) for the reusable invocation.
  The mobile-sheet options below apply only to `"panel"`.
- `sidecarVariant` — the default presentation for `sidecar`: `"docked"`,
  `"floating"`, or `"slideshow"`. A scene's optional `presentation` overrides
  this choice for mixed stories. Other layouts ignore it.
- `storyTheme` — the sidecar's editorial palette: `"paper"` (default) or
  `"ink"`. This styles story content; `workspace.map.basemap` independently
  controls the map. Other layouts keep their existing app theme.
- `storyCover` — show a sidecar cover using the project title, summary, and
  opening map. Defaults to `true`; set `false` to start with chapters.
- `chapterNavigation` — show the named sidecar chapter navigation. Defaults
  to `true`.
- `narrativeSide` — sidecar desktop narrative placement: `"left"` (default)
  or `"right"`. Mobile keeps the map above readable prose.
- `narrativeWidth` — sidecar desktop narrative width: `"medium"` (default)
  or `"large"`.
- `sceneTransition` — camera motion between scenes: `"ease"` (straight
  interpolation), `"fly"` (zoom-out-and-in flight), or `"jump"` (instant cut).
  Readers with reduced motion enabled always get an instant jump.
- `sceneTransitionMs` — duration of `ease`/`fly` transitions in milliseconds,
  clamped to 0-5000. An already-settled camera matching the fitted destination
  skips the animation entirely, so a band-only change does not wait for a
  no-op camera movement. Real moves, including resets after manual panning,
  still use the configured transition.
- `mobileSheet` — where the mobile bottom sheet opens when the story loads:
  `"collapsed"` (map-first, narrative in the peek bar), `"half"`, or `"full"`.
  Desktop is unaffected.
- `mobilePeekSceneText` — when `true`, the collapsed mobile peek grows to show
  the active scene's narrative text (up to three lines), so the story can be
  read scene by scene with the map fully visible. Pairs well with
  `"mobileSheet": "collapsed"`.
- `mobilePeekTicker` — when `true`, a scene title too long for the peek bar
  marquee-scrolls instead of truncating, and the sheet chevron button is hidden
  to give the title the full width (the drag handle still expands the sheet).
  Reduced-motion readers keep the static truncated title.
- `legendCollapsed` — the Map layers panel start state: `"auto"` (collapsed on
  mobile only), `"always"`, or `"never"`. In `scrolly` the panel sits top-right
  on phones, the one corner the centred card lane never reaches.
- `mapControls` — `"hidden"` removes the zoom/compass map controls. Scrolly
  layouts show them on desktop and in mobile Explore map mode.
- `cameraFit` — `"auto"` (default) re-fits every scene camera to the map pane
  it actually got. Scene zooms are authored against a desktop-sized map, and
  the same zoom on a phone — or in the short map pane of a `slides` story —
  crops the frame, so a province-wide scene arrives with the province running
  off the edges. `"auto"` zooms out by however much brings the authored ground
  extent back into view — one level per halving of the tighter axis, at most
  1.5 levels — and never zooms in past what the scene asked for. `map.minZoom`
  does not cap it: that floor is about how far a reader may pinch out, so a fit
  that needs to go under it lowers the floor by exactly that much rather than
  letting the scene arrive cropped. Nothing needs tuning per screen size in the
  JSON. `"off"` uses the authored zoom on every screen.
- `slidesSwipeHint` — slides layout only: on touch screens, show a
  KnightLab-style "Swipe to navigate" intro overlay until the reader taps OK
  or swipes. `"fullscreen"` dims the whole story; `"pane"` dims only the slide
  pane, as KnightLab itself does. `true` is accepted as an alias for
  `"fullscreen"`; the default is `"off"`.

`public/data/projects/roadless-areas-bc-ecoregions.json` uses
`layout: "slides"` and `public/data/projects/bc-population-distribution.json`
uses `layout: "scrolly"` as working examples of the replicated layouts.
`public/data/projects/where-is-north-bc.json` sets `sceneTransition: "fly"`,
`mobileSheet: "collapsed"`, `mobilePeekSceneText: true`, and
`mobilePeekTicker: true` as a working example of the map-first mobile
presentation.

All story layouts expose **Sources and downloads** through the information icon
beside search in the shared toolbar, including the source note, detailed
interpretation, related links and story JSON. This replaces the floating text
button and the panel sidebar's separate source-note/JSON buttons. The icon has
an accessible label, supports keyboard activation, and receives focus again when
the dialog closes.
Slide legends scroll within the available map pane instead of clipping above it.

## Editorial sidecars

Use the existing `story-map-v1` workspace and opt in to the sidecar layout:

```json
{
  "options": {
    "layout": "sidecar",
    "sidecarVariant": "docked",
    "storyTheme": "paper",
    "storyCover": true,
    "chapterNavigation": true,
    "narrativeSide": "left",
    "narrativeWidth": "medium"
  }
}
```

This is a presentation capability, not a separate dataset or project type.
Reuse a story's exact `scenes`, `layers`, and source URLs to compare its styles.
The cover uses authored project metadata and the opening map; it does not require
third-party photography or a copied StoryMaps website. Paper and ink provide
bounded, reusable visual styles instead of allowing arbitrary CSS in packages.

Docked chapters put editorial prose beside the map on desktop. Floating chapters
place prose over a broad map. Slideshow stories advance discretely through the
same scene sequence. On a phone, narrative and map have separate reading areas
and an explicit map exploration control. Reading and exploration retain the
map instance and reading position. The existing `panel`, `scrolly`, and `slides`
layouts remain available and retain their own behavior.

For a mixed story, set `presentation` on individual scenes. Keep `text` as the
introductory paragraph and optionally add `paragraphs` for editorial detail:

```json
{
  "presentation": "floating",
  "text": "Economic regions and health authorities answer different questions.",
  "paragraphs": [
    "Their boundaries overlap without belonging to a single shared hierarchy.",
    "A crosswalk records the intersections and the denominator used for each share."
  ]
}
```

Presentation and paragraphs affect sidecars only. A missing presentation uses
the story's `sidecarVariant`. The parser drops unsupported presentation values
and non-string or empty paragraphs. Text is rendered as text, never raw HTML.

### In-chapter map actions

Sidecar scenes can offer additional views without changing the chapter:

```json
{
  "mapActions": [
    { "label": "Economic regions", "visibleLayerIds": ["economic-regions"] },
    {
      "label": "Health authorities",
      "visibleLayerIds": ["health-authorities"],
      "camera": { "center": [-123.5, 54], "zoom": 5.2 }
    }
  ]
}
```

Each action replaces the visible layer set. An empty set intentionally shows
only the basemap. A supplied camera uses the ordinary story camera fitting and
reduced-motion behavior; omitting it preserves the current camera. Navigating
to another chapter or resetting the scene restores authored scene state.
These actions differ from `interaction.items[].sceneLabel`, which navigates to
another scene. Scene highlights and style overrides remain those of the chapter.
Action layer IDs must exist in `workspace.layers`. Invalid actions are dropped;
valid action cameras clamp zoom to 0–22 and pitch to 0–85. The package audit
rejects out-of-range authored cameras instead of silently accepting them.

### Synchronized map comparison

A scene can reveal two synchronized maps with a comparison slider:

```json
{
  "visibleLayerIds": ["economic-regions", "health-authorities"],
  "comparison": {
    "leftLabel": "Economic regions",
    "leftLayerIds": ["economic-regions"],
    "rightLabel": "Health authorities",
    "rightLayerIds": ["health-authorities"]
  }
}
```

Both sides use the same camera and scene styles. Each side requires at least
one layer and a readable label; every referenced layer must also appear in the
scene's `visibleLayerIds`. GeoJSON and PMTiles are supported; native climate-grid
layers are not. Comparison scenes cannot also declare `mapActions`. This keeps
the two authored layer sets explicit. A reveal does not imply that boundaries
nest, align, or share a vintage: retain source dates and crosswalk limitations in
the chapter text. Popups are disabled while comparing so the revealed side does
not misleadingly pick an obscured feature from the other map.

## GeoJSON layers

Every `workspace.layers` entry references polygon GeoJSON and shares its `id`
with an item in the top-level `layers` array:

```json
{
  "id": "areas",
  "data": "/data/boundaries/example.geojson",
  "idProperty": "id",
  "labelProperty": "name",
  "fillColor": "#047857",
  "fillOpacity": 0.35,
  "lineColor": "#0f172a",
  "lineOpacity": 0.9,
  "lineWidth": 1.2,
  "attribution": "Source organization"
}
```

`data` can be a repository-root path or an HTTPS URL. External servers must
allow cross-origin browser requests. HTTP and protocol-relative URLs are
rejected when a package is imported.

For categorical fills, add a property-to-colour mapping:

```json
{
  "category": {
    "property": "north_south",
    "colors": {
      "North": "#2563eb",
      "South": "#f59e0b"
    },
    "fallback": "#94a3b8"
  }
}
```

Layer order in `workspace.layers` is draw order: later layers appear above
earlier layers. Top-level `layers` controls catalog labels and default
visibility; `workspace.layers` controls data and map styling.

## Native climate-grid layers

`format: "climate-grid"` streams BCDataMapper `bcdatamapper-native-grid-v1`
releases through the scraper-owned adapter and an interleaved Deck.gl overlay.
`data` is an HTTPS manifest URL (prefer a pinned release), not an embedded raster
or GeoJSON collection. The example collection is generated explicitly with
`npm run projects:climate-stories`; ordinary app builds do not contact PAVICS or
regenerate climate values. Processing and data remain in `vendor/bcdatamapper`
and R2. The generator authors only project metadata, scenes and presentation.

```json
{
  "id": "late-century-heat",
  "data": "https://data.map.ahmad.sh/climate/bc-climate-u6/releases/01b4b7e982f9b2e6d042/manifest.json",
  "format": "climate-grid",
  "climate": {
    "product": "txgt_29",
    "horizon": "2071-2100",
    "percentile": "p50",
    "season": "annual",
    "measure": "absolute",
    "baseline": null,
    "domain": [0, 100],
    "colors": ["#edf8fb", "#b3cde3", "#8c96c6", "#8856a7", "#810f7c"],
    "units": "days"
  },
  "idProperty": "cellId",
  "labelProperty": "value",
  "fillColor": "#8856a7",
  "fillOpacity": 0.78,
  "lineColor": "#ffffff",
  "lineOpacity": 0,
  "lineWidth": 0
}
```

Band selection must be explicit and match exactly once. Percentiles are
`p10`, `p50`, `p90`, or `null` for an archive without that dimension. Seasons
are `annual`, `spring`, `summer`, `autumn`, `winter`. `measure` is `absolute`
with `baseline: null`, or `source-delta` with a baseline `YYYY-YYYY` period.
Source-delta bands are used directly, never reconstructed by subtracting
marginal percentiles. Display units must match the selected band's metadata.

`domain` contains two finite increasing numbers; `colors` has 2–9 six-digit
hex colours. These form equal-width bins, clamped at either end, automatically
shown in the layer legend. Optional `breaks` supplies unequal bin edges instead:
exactly `colors.length - 1` finite increasing values (for example `[1, 10, 30, 60]`
with five colours). The first and last bins are open-ended. Keep the same scale across comparable scenes. These
are value bins, not health-risk categories. `fillOpacity` overrides work;
categorical styles, feature highlights, outlines and attribute joins do not
apply to climate cells. Climate cells draw below basemap labels and the story's
GeoJSON/PMTiles overlays, irrespective of their position in `workspace.layers`.
Author climate layers before contextual boundaries/points to reflect this order.

Only active climate layers draw. The climate controller remains mounted for the
story's lifetime, including introductory scenes with no climate layer. Geometry
indices and Float64 value blocks are fetched for the current viewport and decoded
without interpolation. An app-owned byte-budgeted LRU retains metadata, geometry
indices and compact Float64 bands across scenes: 96 MiB on desktop, 48 MiB when
opened at phone width. Value archives still download/decompress as a whole tile,
but only bands used by the current story are copied into the cache; unused
periods/percentiles/seasons are discarded. The active band is admitted first;
other story bands use spare capacity without evicting it. Copies own their
buffers, rather than retaining the full archive through subarray views. This is a
transport-cache limit, not a total browser/GPU memory limit. Returning to retained
periods reuses these compact bands; evicted bands may require fetching again.
The selected source band and its metadata are passed unchanged to the native
decoder, with no rounding, resampling, or changes to missing-value handling.

After the current view completes and the reader settles for 800 ms, the controller
may warm **one adjacent scene** in the last navigation direction, using its camera
fitted to the actual map pane. For views up to 40,000 source cells it also decodes
one next scene while the current section remains on screen. Navigation consumes
that staging slot only if the full layer selection, camera and pane dimensions
still match; otherwise it discards it and loads the actual view. Larger fine-grid
views warm bytes only. The prepared slot is separate from the transport byte cap,
holds at most one scene, and is cleared on consumption, replacement, hidden/data-saver
state or unmount. No speculative layers are drawn or made pickable.
Speculation processes at most 32 MiB of new decompressed archive/metadata bytes per attempt, never
evicts foreground cache entries, and stops on navigation, pan, unmount, hidden
tabs, or reported data-saver/2G/3G connections. Manual layer overrides disable
read-ahead. Speculative failures are silent; foreground failures remain retryable.
The same viewport and zoom gates apply before any fine-grid value blocks load.

Completed scenes swap as a unit. While loading, retained climate cells keep their
previous legend (explicitly labelled as such); colors, legend and picking then
switch to the new band. Existing grid geometry and Deck layer identities are reused
when cell IDs/missing-value masks match. Picking reads the current band's exact
properties, never stale properties on retained geometry. Errors, empty views,
zoom gates and turning off all climate layers clear the surface. Leaving the
story releases the cache and drawn/staging scenes. A 180,000-cell viewport budget
bounds each decoded scene; authored `minZoom`
(0–22, optional) adds a finer-grid gate. Snow stories use level 7 and start at a
local view, while retaining BC-wide source coverage. Zoom out farther and a
visible prompt replaces loading; no coarse synthetic grid is substituted.
Cells with missing source values stay transparent. Clicks show units, period,
percentile, scenario, cell ID and the stored numeric value. Loading, empty,
zoom-gated and retryable-error states are explicit. Other story layers remain
usable during an error. `StoryClimateLayers.tsx` owns the overlay and lifecycle;
`adapters/climateStore.ts` owns transport caching/read-ahead and geometry reuse;
`adapters/climateStyle.ts` owns pure display bins, and the native decoder stays
in the scraper submodule. Do not route these manifests through `storySources`.

## Scene tools

Beyond turning layers on and off, a scene can direct attention within a layer.

### Highlights

`highlights` spotlights the features matching a property value list. Matched
features keep their full fill and get a thicker outline in `color`; everything
else in that layer drops to `dimOpacity`. This is how a story says "this
boundary, these regions" without shipping a second dataset.

```json
"highlights": [
  {
    "layerId": "health-authorities",
    "property": "HLTH_AUTHORITY_NAME",
    "values": ["Northern"],
    "color": "#047857",
    "dimOpacity": 0.07,
    "label": "Northern Health"
  }
]
```

A highlight only reads if its `layerId` is also in the scene's
`visibleLayerIds`. When `label` is set, it is added to the scene's legend.

### Layer overrides

`layerOverrides` retunes an already-visible layer for one scene — most often
dropping a fill to `0` so a boundary reads as an outline over another layer.
It can also replace `category` so several scenes recolour one shared GeoJSON
source by different properties without loading duplicate map sources.

```json
"layerOverrides": {
  "health-authorities": {
    "fillOpacity": 0,
    "lineWidth": 2.6,
    "lineOpacity": 1,
    "category": {
      "property": "status",
      "colors": { "Current": "#047857", "Historical": "#d97706" },
      "fallback": "#94a3b8"
    }
  }
}
```

### Callouts and legends

`callout` renders a short pull-quote or statistic inside the card:

```json
"callout": { "label": "BCER zone", "value": "South West", "detail": "Optional line." }
```

The legend is derived automatically from the visible layers' categories plus any
labelled highlights. The legend omits the repeated scene subtitle (such as
“spring · P10”) and visible On/Off text. The full layer name and color scale remain;
each layer name is a toggle with `aria-pressed`, keyboard focus, and dimmed styling
when off. A temporary loading notice still identifies retained climate data.
Category swatches
are explanatory keys, not individual category filters. Set `legend` on a scene to replace it outright when the
derived one would be noisy:

```json
"legend": [{ "label": "Census North", "color": "#2563eb" }]
```

## Source loading and growth

Only visible layers mount map sources. GeoJSON (including gzip and attribute
joins) loads through `storySources.ts` and `useStorySources.ts`; PMTiles remains
streamed by the map. Do not add an eager `config.layers` fetch elsewhere.

The story owns an active-source store, deduplicated by data URL and join definition.
Changing styles over the same data reuses the collection; map fill/circle layers
use an opt-in shared source key so thematic styles do not independently index it.
Draw order follows the package layer order even when source requests finish out
of order. Successful sources publish independently. A failed source shows a named Retry
layers action, while other layers remain usable. Switching scenes aborts obsolete
requests and releases inactive collections; leaving the project releases all of
them. Returning to a released source may fetch/parse it again (HTTP caching still
applies). This is a deliberate memory bound, not a permanent project-wide cache.

A large source is still large when its scene becomes active. For growing datasets,
prefer simplified geometry, compact properties, or PMTiles over full observation
archives. Update scraper-owned datasets in the scraper submodule first. No renderer
change can substitute for a suitable source representation.

## Authoring workflow

1. Copy the working example and change its slug, title, narrative, and sources.
2. Keep layer IDs identical across top-level `layers`, scene
   `visibleLayerIds`, `highlights`/`layerOverrides`, and `workspace.layers`.
3. Confirm every `highlights.values` entry matches real feature values — a typo
   silently spotlights nothing.
4. Use local repository snapshots when reproducibility matters. Use HTTPS
   GeoJSON for sources that are stable, appropriately licensed, and CORS
   enabled.
5. Add the filename to `public/data/projects/index.json`.
6. Open `/dev/projects?project=<slug>` and scroll through every scene.
7. Use the toolbar information icon's **Download story JSON** button to download the normalized project package and
   confirm it can be imported again.

## Changing the renderer

`src/maps/project-story/ProjectStoryMap.tsx` owns scene selection, map state,
source loading, and composition. The legacy layouts remain there; editorial
presentation lives in `layouts/SidecarStory.tsx`, and the synchronized comparison
surface lives in `StoryComparison.tsx`. Keep new editorial UI in the layout
component rather than expanding the map orchestrator. The pure parts (paint
resolution, legend derivation, camera fitting) live beside it in `storyScene.ts`,
which is where new logic belongs if it can be unit tested without a browser.

Adding a `workspace.options` field requires coordinated contract edits:

1. `ProjectStoryOptionsDef` in `src/lib/projectPackages.ts` — the field and a
   comment saying what it is for.
2. `normalizeStoryOptions` in the same file — validate the authored value and
   fall back to the default. Unknown values must never reach the renderer.
3. `src/lib/projectPackages.test.ts` — the three option tests assert with
   `toMatchObject`, so a field left out of them is silently untested. Add it to
   all three: defaults, valid values, and unknown-value fallback.
4. A bullet under [Story options](#story-options) above.
5. The allowed option values in
   `.agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs`,
   along with the owning renderer behavior and an example package.

Three renderer invariants are load-bearing and easy to undo by accident:

- **Scene cameras are not used verbatim.** `paneZoomOffset` zooms out to keep
  the authored ground extent in frame on a smaller map pane, so the live zoom
  legitimately differs from `scene.camera.zoom` — most visibly on a phone —
  and `allowZoomFloor` lowers the map's `minZoom` when the fit needs to go
  under it. Both are deliberate; see `cameraFit` above.
- **Who owns the pointer differs by layout.** `panel` renders the legend and
  feature card inline over an interactive map; `scrolly` and `slides` pass the
  same chrome in as a `chrome` prop and hang it in a `pointer-events-none`
  overlay above the story. Interactive chrome added there needs its own
  `pointer-events-auto`, or it will look right and do nothing.
- **The slides pane renders every slide, not just the active one.** They stack
  in one CSS grid cell so the pane is as tall as the longest slide: that is
  what stops slides being clipped and stops the map resizing as the reader
  steps. Rendering only the active slide reintroduces both bugs.

## Tests

- `src/lib/projectPackages.test.ts` covers schema normalization, including the
  clamping and dropping of malformed scene fields.
- `src/maps/project-story/storyScene.test.ts` covers scene resolution: paint
  expressions for highlights and overrides, legend derivation, and the camera
  pane fit.
- `src/maps/project-story/climateStore.test.ts` covers byte budgets, release
  isolation/pinning, speculative admission, aborts/retries, geometry reuse, and
  bounded next-scene preparation/consumption.
- `tests/e2e/climate-band-performance.spec.ts` checks desktop/phone heat and
  seasonal precipitation band switches without refetching, even with a long
  configured camera animation and reduced motion disabled.
- `tests/e2e/project-climate-stories.spec.ts` traverses every climate story on
  desktop/phone, verifies warm period switches make no extra climate requests,
  and checks read-ahead, data saver, retained legends and current-band picking.
- `src/maps/project-story/whereIsNorthBc.test.ts` is the authoring guard for the
  shipped story — it fails if a scene references a layer, place, or highlight
  target that does not exist.
- `tests/e2e/project-story-map.spec.ts` drives the rendered story in a browser.
- `tests/e2e/project-story-layouts.spec.ts` traverses the shipped `panel`,
  `scrolly`, and `slides` examples in both desktop and phone viewports, including
  canvas sizing, pointer ownership, slide-stack stability, and console errors.

## Renderer verification loop

After changing a package, option, story renderer, or shared map shell, repeat
audit → focused tests → rendered inspection → fix until every affected gate is
clean. Use the canonical `/dev/projects/<slug>` route and inspect the browser
console as well as the visible result.

For shared renderer changes, cover all three layouts with the shipped examples:

- `where-is-north-bc` for `panel`;
- `bc-population-distribution` for `scrolly`;
- `roadless-areas-bc-ecoregions` for `slides`.

At desktop and phone sizes, traverse all scenes forward and backward. Confirm
scene selection, layer and place visibility, highlights/overrides, legend,
callouts, camera framing, controls, popups, and map-canvas sizing. Also exercise
the layout-specific interaction: panel sheet/peek behavior, scrolly pointer and
wheel ownership, or slides arrows/dots/keyboard/swipe, longest-slide sizing, and
overflow. Fix the owning layer and repeat the failed check; after renderer work,
repeat the complete browser pass for every affected layout.

Stop when the structural audit and relevant tests pass, all affected
layout/viewport combinations have been exercised, the console is clean, and no
visible defect remains. Record unavailable or CORS-blocked sources as
unverified; they are not passing checks.

The mobile scrolly Explore map mode must preserve the card scroller and map
instances; do not unmount them to switch modes. Slide changes reset only the
narrative scroll position, preserving the longest-slide grid measurement.

Sidecar verification additionally covers the cover start action, named chapter
navigation, docked/floating/slideshow presentations, both editorial themes,
in-chapter map actions and reset, and phone reading/exploration. Mixed
presentations still use one map instance; size changes re-fit the active camera
to the available pane. A comparison chapter must keep both cameras synchronized
while panning, zooming, advancing chapters, and resizing. Exercise its pointer
and keyboard reveal controls at desktop and phone widths. Verify that leaving
comparison restores the ordinary scene map and that comparison data uses the
same active-source loading path rather than a second eager fetch.

## Scene interaction examples

The **example** catalog folder (`/dev/projects?collection=example`) contains twelve
packages in `public/data/projects/example`: docked narrative, guided slides,
scroll-driven story, boundary comparison, relationship bars and linked hierarchy,
plus four editorial sidecars (docked, floating, slideshow and mixed), and the
complete imported Prague editorial story and the native editorial toolkit.
Regenerate the sidecars with `node scripts/generate-sidecar-examples.mjs`.
Regenerate their app-owned presentation with `node scripts/generate-story-examples.mjs`
and then `npm run projects:index`. The generator reuses the connected-geographies
package and reads the existing scraper-owned relationship snapshot for the three
Cariboo population shares; it does not copy or modify those source datasets.

A scene can optionally include an `interaction` block:

```json
{
  "interaction": {
    "type": "choices",
    "title": "Compare boundaries",
    "description": "Switch views at the same authored extent.",
    "items": [
      { "label": "Economic", "sceneLabel": "Economic" },
      { "label": "Health", "sceneLabel": "Health" }
    ]
  }
}
```

`sceneLabel` refers to a unique scene label within the package. A selection uses
normal scene navigation, including camera, legend, highlights and visible layers.
Use identical cameras for an A/B comparison. Manual pan/zoom is reset to that
scene's authored view when switching; this is not synchronized dual-map mode.
`choices` renders named buttons; `bars` renders selectable labelled shares (each
item requires `share` in [0,1] and may include a `detail` count string); `hierarchy`
renders ordered paths in columns, grouped by the optional item `group`.
Hierarchy arrows express authored membership, never an inferred crosswalk.
For bars, describe the denominator, year, coverage and meaning in the block copy.
Only relationships with valid scene targets render; package audit rejects missing
or ambiguous targets. Invalid block types, items and shares are discarded by the
parser. No block means no change to existing story cards.

`SceneInteraction.tsx` owns these controls. Non-slide cards with interactive
content use a separate scene-selection button, avoiding nested buttons. Slides
continue stacking all scene cards for stable pane sizing. Story arrow shortcuts
ignore focused controls, editable content, dialogs and maps so widget/map keys
are not also interpreted as chapter navigation.

## Native editorial documents

For JSON-authored covers, prose, galleries, map sidecars, comparisons, tours and
data-driven hierarchy/dot diagrams, set `workspace.document.schema` to
`"pgmaps-editorial-v1"`. The [native editorial contract](native-editorial-stories.md)
defines blocks, registries, map/view bindings and typed actions. The working
example is `example-native-editorial` in the example folder. This extends
`story-map-v1`; it does not replace scene packages or the imported-document path.

## Imported editorial documents

To reconstruct a complete authored StoryMaps document—including its original
cover, prose, images, sidecars, comparisons, tours and credits—use the optional
`workspace.document` adapter inside `story-map-v1`:

```json
{
  "type": "story-map",
  "schema": "story-map-v1",
  "document": {
    "schema": "arcgis-story-document-v1",
    "data": "/data/story-documents/prague/story.json"
  },
  "map": { "center": [14.42, 50.08], "zoom": 11, "minZoom": 0, "maxZoom": 22 },
  "layers": [],
  "places": []
}
```

The document adapter supplies its own maps and reading sequence, so ordinary
workspace layers may be empty. Top-level scenes remain catalog chapter
summaries. `ProjectWorkspace` selects `editorial/EditorialStory.tsx` for these
packages; it does not mount the ordinary scene renderer. The editorial renderer
uses the imported graph's layout and theme, rather than the ordinary story
options. It fills the project content area below the unchanged PGMaps navigation.
A compact project toolbar uses the shared `ProjectBackButton` to return to the
containing folder and a project title button to return to the cover. Publisher
identity stays in the cover byline and credits; it does not replace app chrome.
Editorial backgrounds, text, chapter navigation, floating cards, tour controls,
loading notices and credits follow the app theme. Authored text colors are
darkened as needed for contrast on the light reading surface. Photos, videos,
colored map data and original diagrams retain their colors; transparent diagrams
keep a dark mat and the cover keeps white text over its shaded imagery.
The story must never make the app navigation inert or install a fixed viewport
overlay for normal reading.

`example-prague` is a reconstruction of **The Diverse Prague** from the supplied
capture. Source text, illustrations, photographs, video, fonts, original map
symbolization and author credits are retained. The story is rendered by PGMaps;
it does not embed the original StoryMaps application. Captured WebMap definitions are source data interpreted by the MapLibre adapter;
the ArcGIS Maps SDK is not loaded. The original maps retain their live remote
services, so the imported document is not an offline tile archive. Failed maps
must show a loading/error state.

Import a supplied capture with:

```sh
node scripts/import-storymap-har.mjs '<capture.har>' '<story-item-id>' public/data/story-documents/<name>
```

`--fetch-missing` optionally retrieves referenced public media missing from the
capture. The importer extracts content and resources, never the original app's
JavaScript, account headers, cookies or analytics configuration. It records a
manifest with source URLs, asset hashes and missing-resource notes. Import only
content the task calls for, retain original credits, and keep provenance beside
its files. The supplied Prague mobile capture was empty; mobile verification
uses the original public story and responsive browser checks.

Documents/assets live under `public/data/story-documents`, an app-owned directory
preserved during scraper sync. Keep them outside `public/data/projects`, whose
recursive indexer treats every JSON file as a project package. Register only the
wrapper package and regenerate the catalog as usual.

The native graph's supported nodes include story, storycover, navigation, text,
image, video, separator, button, carousel, immersive, immersive-slide,
immersive-narrative-panel, webmap, swipe, tour, tour-map, credits and attribution.
Rich text is converted to allowed React elements; executable HTML, arbitrary
styles, scripts and unsafe URL schemes must never enter the DOM. Inline map
actions update the current map's authored viewpoint and layer visibility. Source
feature popups retain their authored title substitutions, visible field order,
labels and numeric formats. `nativeFeaturePopups.tsx` renders the shared
`MapPopupCard` and `KeyValueRows` inside a MapLibre popup; it requests the selected
feature's details lazily by object ID, rather than adding every attribute to all
viewport geometry requests. Values are React text, never executable source HTML.
Changing selection, closing a popup or leaving the map aborts the detail request.

Verify imported resource completeness and source preservation separately from
visual fidelity. Exercise every immersive slide and numbered tour stop in both
directions, inline actions, image expansion/carousels and map swipe, at desktop
and phone widths. A captured map definition alone does not prove its remote
service is available or rendered correctly.

### Reusable editorial components

For a section-by-section inventory, available authoring routes, and remaining
gaps, see the [story presentation reuse audit](story-component-reuse-audit.md).

`editorial/EditorialStory.tsx` adapts the imported node graph to content props.
The presentation components under `editorial/components/` know nothing about
Prague, ArcGIS resource IDs, or a particular map engine:

- `StoryCover`: `title`, `summary`, `byline`, optional `video` and `poster` URLs.
  An image-only cover uses the poster without playback controls; video honors
  reduced motion and has a play/pause button.
- `StoryChapterNavigation`: `{ id, label }[]`, `active`, and `onSelect`.
- `StoryCarousel`: ordered React media `items`, with bounded previous/next controls.
- `StorySidecar`: `{ id, content, media }[]`, a `scrollRoot` ref, `variant`
  (`docked` or `floating`), `side` (`left`, `right`, or `center` for floating
  illustrated sequences), and `width`
  (`medium` or `large`). Media and prose are React slots; map rendering remains
  the caller's responsibility. Centered floating sequences keep the card and
  uncropped illustration centered across the pane; imported documents opt in
  with `narrativePanelPosition: "center"`.
- `StoryTour`: `{ id, media, content }[]`, a `scrollRoot` ref and
  `renderMap(activeIndex, selectIndex)`. Scroll, arrows, numbered controls and
  map selections share the same reading position.
- `ExpandableMedia`: a stable media child with expansion, Escape and keyboard
  focus handling. Expansion preserves the map rather than mounting a second one.
- `useReadingSection`: the shared scroll activation rule for sidecars and tours.
- `useStoryFonts`: optional imported font files from `theme.localFonts`, loaded
  only while that document is mounted and scoped to editorial typography. No
  component hardcodes a project's asset path.

For example, another PGMaps feature can compose an editorial sequence directly:

```tsx
import { StoryCover, StorySidecar } from '@/maps/project-story/editorial/components'
import '@/maps/project-story/editorial/EditorialStory.css'

const scrollRoot = useRef<HTMLDivElement>(null)
return (
  <div ref={scrollRoot} className="editorial-story">
    <StoryCover title="A changing landscape" poster="/data/my-story/cover.jpg"
      byline="Source organization" />
    <StorySidecar id="landscape" scrollRoot={scrollRoot} variant="docked"
      slides={[
        { id: 'before', content: <p>The earlier landscape.</p>, media: earlierMap },
        { id: 'after', content: <p>The later landscape.</p>, media: laterMap },
      ]} />
  </div>
)
```

Give the scroll container a bounded height through a flex parent. The package
renderer measures that height into `--editorial-viewport`, so covers and sticky
maps fit the space left after PGMaps navigation and project controls. Direct
compositions should likewise set that CSS variable to their viewport height.
Desktop keeps docked/floating media alongside prose; phones retain a sticky
210-pixel media pane above the active narrative. Never calculate these panels
from the full window height after adding app chrome.

Comparison listeners and asynchronous map work must stop before a MapLibre map
is destroyed. Rapid traversal and leaving comparison are part of the editorial
browser regression test. Check PGMaps desktop links and the phone menu as well
as all story chapters: preserving reading flow must not disable navigation.

Imported comparisons use the shared `MapSwipe` reveal. Only its divider captures
drag input; the rest of the map remains pannable. The visible handle and capture
area share the same position, and the divider updates CSS without rerendering
the map trees. The passive map mirrors camera movement, but its feature queries
read the primary viewport and subscribe to the primary's `moveend`: mirrored
`jumpTo` calls emit their own `moveend` every frame and must never trigger data
requests. Desktop and phone browser tests assert no queries while dragging the
divider or panning, one refresh per feature layer when the pan ends, matched
cameras, and touch dragging without scrolling the story.

### Shared editorial basemap

Set `workspace.document.basemap` to `"pgmaps"` to replace the imported
basemap with PGMaps cartography that follows the app light/dark toggle.
`"pgmaps-dark"` keeps the basemap charcoal regardless of the app theme. The default `"source"` preserves the source
basemap. This affects basemap layers only: thematic polygons, historic imagery,
class breaks, visibility, credits and popup definitions remain original.
`public/map-styles/story-charcoal.json` is the reusable app-owned MapLibre style:
edit its land, water, road and label paint to tune future stories. It uses the
same CARTO vector tile service as other PGMaps maps, with OpenStreetMap/CARTO
attribution and hosted fonts. It is not a self-hosted or offline tile archive.
Shared source/layer IDs allow MapLibre to retain the basemap across chapter style
diffs; labels are composed above thematic layers. Failed thematic services still
produce a source warning. Prague opts into the automatic `"pgmaps"` mode.
`useEditorialBasemapTheme.ts` applies the light paint palette to the shared
layer IDs; theme changes retain the canvas, camera and loaded thematic features
without refetching geometry. The local JSON supplies the original dark paints.

### Imported map adapter

`editorial/adapters/arcgisWebMap.ts` translates source data into a MapLibre style;
`EditorialMap.tsx` mounts the shared PGMaps `Map` and marker components. ArcGIS is
the source format and service protocol, not an additional JavaScript map engine.
The adapter preserves source layer order, visibility, opacity and attribution.
It supports Web Mercator cached raster layers, MapServer/ImageServer exports,
vector basemap styles and polygon FeatureServer layers with supported simple,
unique-value or class-break fills. Feature queries are paginated for the visible
map area and draw progressively, with a loading indicator until all pages arrive;
the first 2,000-feature page draws immediately, followed by bounded groups of
three concurrent pages in object-ID order. Cancellation prevents stale viewport
results from publishing and failures retain an explicit partial-data warning;
source class colors and break thresholds remain authored data.

When zooming or panning a populated feature map, keep its previous geometry
until the replacement viewport finishes; only the initial empty view publishes
partial batches. The compact progress indicator identifies the detail update.
Movement aborts obsolete work immediately and queries start after 150 ms of
settled movement. Completed viewport results are cached per mounted editorial
map, with at most four entries, 60,000 features and 500,000 coordinate positions
(the limits apply across entries, not per entry). Oversized views still render
but are not cached. Reuse requires matching service, filter and fields, enclosing
bounds and equal or finer geometry precision; a coarser cached preview can remain
visible while finer data loads. Caches release with their story component.
Failed refreshes explicitly identify retained previous-view geometry.

Consecutive map slides retain one MapLibre canvas. Fetch the next document while
keeping the current style visible, then apply it through the shared map's style
diff. Editorial maps disable the shared map's loading overlay, including on
initial mount; an initial screen-reader status and compact update indicators
report progress without covering the map. Do not clear the document between branches or
key the map by resource ID: both recreate the canvas and flash the loader during
scrolling. A delayed-response browser test checks canvas identity and authored
layers through all seven Prague branches in both directions on desktop and phone.

Unsupported source projections, symbols or layer types must produce an explicit
source warning rather than an invented replacement. Original unavailable
services remain unavailable; importing their definitions cannot recover missing
imagery. The adapter's unit tests and actual source-rendering browser tests are
separate from content integrity checks.
