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
- `timeline`: a standard sidebar decade selector plus the shared animated map
  timeline. The selector is a static filter; only the shared map-footer control
  is presented as the timeline. Search and category filters apply to every
  playback bucket, popup, legend count, and sidebar total. While playback is open,
  the chosen bucket drives the sidebar's decade; closing playback restores the
  previous static decade filter. Bucket histograms span the source decade range
  and include zero-result buckets.
- `category-filter`: category totals and filtering.
- `aggregate-records`: opens records assigned only to configured aggregate
  locations. Text supports a `{count}` placeholder.
- `search`: searches any configured combination of title, author, and tags.
- `ranked-list`: ranked mapped locations with a configurable page size (`limit`).
  Page controls expose all matching locations without mounting an unbounded list.
- `map-legend`: shared map legend using the configured categories; collapsed by
  default on phones. Map controls use the shared shell's mobile offsets.
- `location-popup`: mapped-location detail with a configurable category limit.

## Renderer anatomy

The renderer is partitioned so package options, code components, and model
guidance have the same boundaries:

- `ProjectMapExplorer.tsx` handles loading, errors, layout, and timeline state.
- `ProjectExplorerSidebar.tsx` renders configured sidebar blocks in package order.
- `ProjectExplorerMap.tsx` composes map layers, map-only features, and the shared timeline.
- `features/*.tsx` contains one file per `ProjectExplorerFeatureDef` option.
- `adapters/*` owns source-specific loading and normalization.
- reusable presentation belongs in `src/components/ui`, not inside an adapter or package.

The repo-local `.agents/skills/pgmaps-project-builder` skill mirrors this
structure with one focused reference per feature. When adding a feature, update
the TypeScript union, normalizer, component, composition switch, documentation,
skill reference, tests, and a working package example together.

## Data ownership and adapter contract

`baseUrl` must be HTTPS. PGMaps fetches the configured files at runtime; it does
not copy them into this repository.

`research-records-v1` is the only adapter currently implemented. It accepts the
same overview, record, location, and decade JSON shapes used by the Nechako
project. A future source with those shapes needs only a new project JSON. A
source with different shapes needs one new adapter, while the workspace and
capability blocks remain reusable.

## Planned feature-backed sub-projects

The Flood Study Library and BC Snowpack require parent projects whose child views
are generated from feature indexes rather than listed as independent catalog
packages. The proposed `feature-subprojects-v1` contract, route conventions,
licensing boundary, and implementation sequence are documented in
[`docs/flood-studies-snowpack-subprojects.md`](./flood-studies-snowpack-subprojects.md).

Aggregate-record dialogs use bounded 20-record pages. Keep paging and filtering
in their owning feature/adapter; do not truncate records silently or make the
map compositor manage list pagination. The shared pagination hook resets on
filter changes and clamps the page when a result set shrinks.
