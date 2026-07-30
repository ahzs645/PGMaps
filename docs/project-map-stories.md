# JSON map stories

PGMaps project packages can render a scroll-driven map when `workspace.type` is
`"story-map"` and `workspace.schema` is `"story-map-v1"`.

The complete working example is
`public/data/projects/where-is-north-bc.json`. Add a package filename to
`public/data/projects/index.json` to make it appear in `/dev/projects`.

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
    "map": {
      "center": [-125, 54],
      "zoom": 5,
      "minZoom": 3,
      "maxZoom": 12
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

Each scene is declarative. When its card becomes active, the renderer applies
its camera, replaces the visible layer set, and shows only its listed places.
Readers can still open the Layers panel and change the map stack manually.

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

## Authoring workflow

1. Copy the working example and change its slug, title, narrative, and sources.
2. Keep layer IDs identical across top-level `layers`, scene
   `visibleLayerIds`, and `workspace.layers`.
3. Use local repository snapshots when reproducibility matters. Use HTTPS
   GeoJSON for sources that are stable, appropriately licensed, and CORS
   enabled.
4. Add the filename to `public/data/projects/index.json`.
5. Open `/dev/projects?project=<slug>` and scroll through every scene.
6. Use the built-in JSON button to download the normalized project package and
   confirm it can be imported again.
