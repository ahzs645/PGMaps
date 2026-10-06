# `ranked-list`

Component: `src/maps/project-explorer/features/RankedListFeature.tsx`

```json
{ "type": "ranked-list", "title": "Locations", "limit": 30 }
```

The adapter supplies already-filtered, descending items. `limit` is a page size;
all matches remain reachable through shared pagination. The feature delegates
bar rendering to shared `src/components/ui/ranked-bar-list.tsx`. Click filters records and focuses the map entity. Click again clears inclusion.
Right-click or the accessible exclude button excludes all records carrying that
location tag; restore reverses it. Facet rows remain available to switch filters
and undo exclusions. Popup detail stays in the map feature.
