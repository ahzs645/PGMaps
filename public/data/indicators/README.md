# PGMaps Index Lab Indicator Catalog

`indicator-catalog.json` defines source-ready indicator metadata for future PGMaps Index Lab composites. Each indicator includes the required fields:

- `id`
- `label`
- `domain`
- `module`
- `unit`
- `higherIsWorse`
- `source`
- `geography`
- `year`
- `confidence`
- `citation`
- `processingNotes`
- `limitations`

The catalog is intentionally pragmatic: many indicators can map to existing PGMaps assets under `public/data`, while others identify near-term public or licensed datasets worth ingesting next. Treat citation strings as source anchors for implementation research, not as proof that PGMaps already includes every upstream layer.
