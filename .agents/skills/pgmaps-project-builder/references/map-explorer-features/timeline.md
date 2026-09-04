# `timeline`

Components: `src/maps/project-explorer/features/TimelineFeature.tsx` and the
shared `src/components/ui/timeline.tsx`.

```json
{
  "type": "timeline",
  "title": "Timeline",
  "granularity": "decade",
  "showLabel": "Show Timeline",
  "hideLabel": "Hide Timeline"
}
```

The feature file renders the sidebar date filter and toggle. The map compositor
renders the shared animated timeline. The adapter owns date-bucket summaries
and bucket-specific GeoJSON. Do not fork timeline playback, responsive layout,
or height-offset behavior inside an explorer.

The v1 contract supports decade granularity only. Expanding granularity requires
adapter capability negotiation and synchronized parser, renderer, docs, tests,
and examples.
