# `map-explorer-v1`

Use this mode for a filterable map backed by a runtime data adapter.

The complete contract and JSON example are in `docs/project-map-explorer.md`.
Use `research-records-v1` for Nechako-style tables or `geojson-points-v1` for
one record per point, as in `public/data/projects/ecolens.json`. Normalize
other source shapes in adapters.

When the endpoint is available and data verification is in scope, inspect one
payload for each configured file before claiming runtime readiness. Confirm the
adapter can normalize its records, locations, categories, coordinates, and any
timeline buckets. Verify that bundled data URLs resolve after the sync step.

## Partitions

- `ProjectMapExplorer.tsx`: status and layout orchestration.
- `ProjectExplorerSidebar.tsx`: ordered sidebar feature composition.
- `ProjectExplorerMap.tsx`: map feature composition.
- `features/<Option>Feature.tsx`: one option per file.
- `adapters/*`: loading, source normalization, filter state, derived summaries,
  and GeoJSON.

## Feature references

Read only the references for features being used or changed:

- [summary-stats](map-explorer-features/summary-stats.md)
- [timeline](map-explorer-features/timeline.md)
- [category-filter](map-explorer-features/category-filter.md)
- [aggregate-records](map-explorer-features/aggregate-records.md)
- [aggregate-boundary](map-explorer-features/aggregate-boundary.md)
- [search](map-explorer-features/search.md)
- [ranked-list](map-explorer-features/ranked-list.md)
- [map-legend](map-explorer-features/map-legend.md)
- [location-popup](map-explorer-features/location-popup.md)

Feature array order controls sidebar order. Map-only features are discovered by
type and composed in `ProjectExplorerMap.tsx`; they do not render sidebar rows.

## Adding a capability

Add a capability only when it represents a reusable interaction with a stable
configuration shape. Update the type union, normalizer defaults, one feature
file, the correct composition switch, documentation/reference, parser tests,
and a real package example together. If the UI is useful outside explorers,
extract it to `src/components/ui` first.
