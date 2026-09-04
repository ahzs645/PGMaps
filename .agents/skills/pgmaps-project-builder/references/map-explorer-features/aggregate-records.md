# `aggregate-records`

Component: `src/maps/project-explorer/features/AggregateRecordsFeature.tsx`

Use when records can be assigned to a configured aggregate region without a
specific mappable location.

```json
{
  "type": "aggregate-records",
  "triggerTemplate": "{count} regional records",
  "modalTitle": "Regional records",
  "modalDescription": "{count} records without a specific location"
}
```

`{count}` is the only template token. The adapter determines which records are
aggregate-only from `workspace.data.aggregateLocationIds`. The feature owns its
trigger and dialog; the shared dialog shell owns modal behavior.
