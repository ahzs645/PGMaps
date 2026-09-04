# `summary-stats`

Component: `src/maps/project-explorer/features/SummaryStatsFeature.tsx`

Use for two or three compact headline metrics. Supported metrics are `records`,
`locations`, and `year-range`; supported icons are `book-open`, `map-pin`, and
`calendar`.

```json
{ "type": "summary-stats", "items": [{ "metric": "records", "label": "Records", "icon": "book-open" }] }
```

The adapter supplies the overview and filtered totals. Presentation uses shared
`StatGrid`/`StatTile`; extend those only for broadly reusable stat behavior.
The block also owns the clear-all-filters affordance because it summarizes the
active result set.
