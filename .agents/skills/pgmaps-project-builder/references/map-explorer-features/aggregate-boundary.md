# `aggregate-boundary`

Component: `src/maps/project-explorer/features/AggregateBoundaryFeature.tsx`

```json
{
  "type": "aggregate-boundary",
  "title": "Nechako River",
  "data": "/data/boundaries/BCFWA/named_watersheds_stream_order_8_50m.geojson.gz",
  "idProperty": "boundaryCode",
  "featureId": "8886",
  "description": "Regional-only tags may refer to broader areas; this is not a spatial count."
}
```

Defaults to off; lazily fetches the collection with the shared gzip-aware loader.
The boundary adapter selects one Polygon/MultiPolygon by official identity and
anchors its count on the geometry. Missing identity/geometry is an error; do not
substitute a circle or silently select a similarly named polygon. The sidebar
provides a toggle, shading slider, and retry; the map uses the shared fill layer
and marker. When `aggregate-records` is also configured, its trigger is embedded
above the boundary toggle in a single section titled with the boundary name.
The publication count appears once in that trigger, not on the toggle.
Count is the filtered aggregate-only record total, following search,
category, decade and location filters, not a spatial containment calculation.
Explain the scope of aggregate tags in `description`. Visual state belongs to
the feature hook and is passed through orchestration to sidebar/map composition.
