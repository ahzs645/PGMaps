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
    map, so the story layer keeps the whole surface — otherwise every swipe
    would pan the map instead of moving the story.
  - `"slides"` — replicates [KnightLab StoryMapJS](https://storymap.knightlab.com/):
    map on top, a slide pane below with arrow gutters, dot navigation, keyboard
    arrows, and horizontal swipe on touch. The map stays interactive. The pane
    is as tall as the story's longest slide rather than a fixed fraction of the
    screen, so no slide is cut off and stepping never resizes the map; on a
    short screen it stops at 58% and the slide scrolls, with a fade at its foot
    marking the overflow.
  The mobile-sheet options below apply only to `"panel"`.
- `sceneTransition` — camera motion between scenes: `"ease"` (straight
  interpolation), `"fly"` (zoom-out-and-in flight), or `"jump"` (instant cut).
  Readers with reduced motion enabled always get an instant jump.
- `sceneTransitionMs` — duration of `ease`/`fly` transitions in milliseconds,
  clamped to 0-5000.
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
  layouts keep them on desktop only, where the pointer reaches the map.
- `cameraFit` — `"auto"` (default) re-fits every scene camera to the map pane
  it actually got. Scene zooms are authored against a desktop-sized map, and
  the same zoom on a phone — or in the short map pane of a `slides` story —
  crops the frame, so a province-wide scene arrives with the province running
  off the edges. `"auto"` zooms out by however much brings the authored ground
  extent back into view (one level per halving of the tighter axis, at most
  1.5 levels), never below the story's own `map.minZoom`, and never zooms in
  past what the scene asked for. Set a lower `map.minZoom` if a story still
  cannot fit its subject on a phone. `"off"` uses the authored zoom on every
  screen.
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

```json
"layerOverrides": {
  "health-authorities": { "fillOpacity": 0, "lineWidth": 2.6, "lineOpacity": 1 }
}
```

### Callouts and legends

`callout` renders a short pull-quote or statistic inside the card:

```json
"callout": { "label": "BCER zone", "value": "South West", "detail": "Optional line." }
```

The legend is derived automatically from the visible layers' categories plus any
labelled highlights. Set `legend` on a scene to replace it outright when the
derived one would be noisy:

```json
"legend": [{ "label": "Census North", "color": "#2563eb" }]
```

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
7. Use the built-in JSON button to download the normalized project package and
   confirm it can be imported again.

## Changing the renderer

`src/maps/project-story/ProjectStoryMap.tsx` renders every layout; the pure
parts (paint resolution, legend derivation, camera fitting) live beside it in
`storyScene.ts`, which is where new logic belongs if it can be unit tested
without a browser.

Adding a `workspace.options` field means four edits, in this order:

1. `ProjectStoryOptionsDef` in `src/lib/projectPackages.ts` — the field and a
   comment saying what it is for.
2. `normalizeStoryOptions` in the same file — validate the authored value and
   fall back to the default. Unknown values must never reach the renderer.
3. `src/lib/projectPackages.test.ts` — the three option tests assert with
   `toMatchObject`, so a field left out of them is silently untested. Add it to
   all three: defaults, valid values, and unknown-value fallback.
4. A bullet under [Story options](#story-options) above.

Three renderer invariants are load-bearing and easy to undo by accident:

- **Scene cameras are not used verbatim.** `paneZoomOffset` zooms out to keep
  the authored ground extent in frame on a smaller map pane, so the live zoom
  legitimately differs from `scene.camera.zoom` — most visibly on a phone. See
  `cameraFit` above.
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
- `src/maps/project-story/whereIsNorthBc.test.ts` is the authoring guard for the
  shipped story — it fails if a scene references a layer, place, or highlight
  target that does not exist.
- `tests/e2e/project-story-map.spec.ts` drives the rendered story in a browser.
