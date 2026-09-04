# `search`

Component: `src/maps/project-explorer/features/SearchFeature.tsx`

```json
{ "type": "search", "placeholder": "Search titles, authors, tags…", "fields": ["title", "author", "tags"] }
```

Only configured fields participate. Matching, normalization, and interaction
with other filters belong in the adapter. The component uses the shared
`SearchInput` and owns only the search/clear affordances.
