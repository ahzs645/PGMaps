# `category-filter`

Component: `src/maps/project-explorer/features/CategoryFilterFeature.tsx`

```json
{ "type": "category-filter", "title": "Resource types" }
```

Categories, labels, and colours come from `workspace.data.categories`; counts
and selection state come from the adapter. The component uses shared
`SidebarSection` and `LegendItem`. Keep category normalization and cross-filter
count semantics in the adapter.
