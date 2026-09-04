# `ranked-list`

Component: `src/maps/project-explorer/features/RankedListFeature.tsx`

```json
{ "type": "ranked-list", "title": "Locations", "limit": 30 }
```

The adapter supplies already-filtered, descending items. The feature delegates
bar rendering to shared `src/components/ui/ranked-bar-list.tsx`. Selection
identifies a map entity; it must not duplicate map popup content.
