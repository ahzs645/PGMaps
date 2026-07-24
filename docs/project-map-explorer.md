# Project map explorer packages

Dev Projects can render a native, reusable map explorer from a project package's
`workspace` object. The package selects a renderer, a data adapter, and an ordered
list of capability blocks:

```json
{
  "workspace": {
    "type": "map-explorer",
    "schema": "map-explorer-v1",
    "data": {
      "adapter": "research-records-v1",
      "baseUrl": "https://example.org/data/",
      "files": {
        "overview": "overview.json",
        "records": "records.json",
        "locations": "locations.json",
        "timeline": "timeline.json"
      },
      "categories": [
        { "id": "report", "label": "Reports", "color": "#f59e0b" },
        { "id": "other", "label": "Other", "color": "#94a3b8" }
      ],
      "aggregateLocationIds": []
    },
    "map": {
      "center": [-123.5, 53.9],
      "zoom": 6,
      "minZoom": 4,
      "maxZoom": 15
    },
    "labels": {
      "recordSingular": "record",
      "recordPlural": "records",
      "locationSingular": "location",
      "locationPlural": "locations",
      "yearPlural": "years",
      "loading": "Loading data…",
      "unavailable": "Data unavailable"
    },
    "features": [
      {
        "type": "summary-stats",
        "items": [
          { "metric": "records", "label": "Records", "icon": "book-open" },
          { "metric": "locations", "label": "Locations", "icon": "map-pin" },
          { "metric": "year-range", "label": "Year Range", "icon": "calendar" }
        ]
      },
      {
        "type": "timeline",
        "title": "Timeline",
        "granularity": "decade",
        "showLabel": "Show Timeline",
        "hideLabel": "Hide Timeline"
      },
      { "type": "category-filter", "title": "Categories" },
      {
        "type": "search",
        "placeholder": "Search…",
        "fields": ["title", "author", "tags"]
      },
      { "type": "ranked-list", "title": "Locations", "limit": 30 },
      {
        "type": "map-legend",
        "title": "Categories",
        "description": "Circle size represents record count."
      },
      { "type": "location-popup", "maxCategories": 5 }
    ]
  }
}
```

## Capability blocks

The `features` array is both configuration and display order. Omit a block to
remove that capability.

- `summary-stats`: record count, mapped-location count, and/or source year range.
- `timeline`: sidebar decade filter plus the shared animated map timeline.
- `category-filter`: category totals and filtering.
- `aggregate-records`: opens records assigned only to configured aggregate
  locations. Text supports a `{count}` placeholder.
- `search`: searches any configured combination of title, author, and tags.
- `ranked-list`: ranked mapped locations with a configurable result limit.
- `map-legend`: shared map legend using the configured categories.
- `location-popup`: mapped-location detail with a configurable category limit.

## Data ownership and adapter contract

`baseUrl` must be HTTPS. PGMaps fetches the configured files at runtime; it does
not copy them into this repository.

`research-records-v1` is the only adapter currently implemented. It accepts the
same overview, record, location, and decade JSON shapes used by the Nechako
project. A future source with those shapes needs only a new project JSON. A
source with different shapes needs one new adapter, while the workspace and
capability blocks remain reusable.
