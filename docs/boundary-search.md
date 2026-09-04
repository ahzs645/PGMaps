# Boundary search catalog

`/dev/boundaries` has two deliberately separate search modes:

- **Find any boundary** searches the generated catalog across sources and levels, including layers that are not on the map yet.
- **Filter boundaries on map** filters only the currently selected and loaded layers.

The global catalog is generated after scraper-owned data has been assembled in `public/data`:

```bash
npm run boundaries:search-index
```

The generator reads registered boundary snapshots, extracts scalar text and identifier properties without copying geometry, validates stable result IDs, and writes:

```text
public/data/boundary-search/manifest.json
public/data/boundary-search/catalog.json.gz
```

The manifest carries a content revision used in the catalog request URL. The catalog is loaded lazily when the global search is first used.

Both `predev` and `prebuild` run the generator after `data:sync-from-bcdatamapper`. The GitHub Pages workflow therefore compiles the catalog from the exact `bcdatamapper` revision assembled for that deployment. `public/data/boundary-search` is generated deployment output under the already-ignored `public/data` tree and must not be force-added to PGMaps.

Adding records or scalar properties to an existing registered snapshot updates the next catalog automatically. Adding a new source or level requires a deliberate entry in `scripts/generate-boundary-search-index.mjs` so unrelated or restricted datasets are never indexed by directory scanning.

Province-wide Dissemination Block search is intentionally excluded. Its geometry is remote PMTiles and does not have a complete local property snapshot. If DB search is added, generate a separately versioned and prefix-sharded index in `vendor/bcdatamapper`, publish it next to the DB PMTiles on R2, and expose its manifest through the same client search interface.
