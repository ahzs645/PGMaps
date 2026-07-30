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

## Tests

- `src/lib/projectPackages.test.ts` covers schema normalization, including the
  clamping and dropping of malformed scene fields.
- `src/maps/project-story/storyScene.test.ts` covers scene resolution: paint
  expressions for highlights and overrides, and legend derivation.
- `src/maps/project-story/whereIsNorthBc.test.ts` is the authoring guard for the
  shipped story — it fails if a scene references a layer, place, or highlight
  target that does not exist.
- `tests/e2e/project-story-map.spec.ts` drives the rendered story in a browser.
