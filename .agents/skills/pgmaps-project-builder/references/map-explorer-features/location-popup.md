# `location-popup`

Component: `src/maps/project-explorer/features/LocationPopupFeature.tsx`

```json
{ "type": "location-popup", "maxCategories": 5 }
```

This is a map-only feature rendered inside the shared `MapPopup`. It presents
adapter-normalized filtered counts and configured category labels/colours.
Keep coordinate selection and popup lifecycle in `ProjectExplorerMap.tsx`; keep
domain-specific record normalization in the adapter.
