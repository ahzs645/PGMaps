# Walkability Factor Masks

## Purpose

The MISC > Walkability equation builder updates the Mobility Index heatmap when factor weights or option toggles change. Rasterizing the source layers in the browser made each first recalculation slow: the worker had to download every source layer, build the city boundary mask, buffer features and scan grid cells.

Instead, every component mask the worker can ask for is built ahead of time. At run time the worker downloads them once, applies the current weights and toggles, and adds the scores into the final grid. Arbitrary weights and every supported option combination still work.

## Where the file lives

```text
vendor/bcdatamapper/datascrapers/walkability/output/heatmap/factor_masks.json   (committed, in bcdatamapper)
public/data/walkability/heatmap/factor_masks.json                              (copied by the data sync, git-ignored)
```

It sits in bcdatamapper beside `citywide_mi_grid.json`, the grid it is built on, and reaches the app with the rest of the walkability output through `npm run data:sync-from-bcdatamapper`. PGMaps does not commit a copy.

It is built by PGMaps, not bcdatamapper, because the masks must be exactly what the worker would rasterize live: `scripts/build-walkability-factor-masks.mjs` loads `src/maps/pgdata/walkabilityLiveHeatmap.worker.js` itself (`scripts/lib/walkability-factor-masks.mjs`) and runs its `factorMask`. bcdatamapper's own grid builder keeps a separate copy of the factor list with its own buffering, so building the masks there would not guarantee that.

The file holds:

- Grid metadata: rows, columns, cell size, no-data value and image coordinates.
- A bit-packed city-boundary mask.
- A bit-packed mask for each factor component and distance or buffer (147 today), keyed as `componentMaskKey` keys them. A key holds the whole factor definition, so a factor changed in the worker finds no mask and the worker rasterizes it live.
- `inputs`: the SHA-256 of each of the 24 files the masks were built from, by the URL the worker reads it at. There is no build time in the file, so a rebuild from the same inputs writes the same bytes.

## Rebuilding

Rebuild after walkability source data, the factor definitions, the variant logic or the rasterization changes:

```bash
npm run data:sync-from-bcdatamapper
npm run walkability:build-factor-masks
```

The script reads the synced files in `public/data`, writes both copies and takes about 25 s. Then commit the bcdatamapper copy there, push it, and move the submodule pointer in PGMaps (AGENTS.md, **Updating submodule data**).

`src/maps/pgdata/walkabilityFactorMasks.test.mjs` fails, naming the change, when:

- a mask the worker can ask for is missing, or
- a source file the app serves no longer matches the hash the masks were built from.

So a bcdatamapper data refresh that touches a walkability source fails PGMaps' unit tests until the masks are rebuilt, rather than leaving the live heatmap to rasterize in the browser with nothing reported.

## Why not compute them in the browser

Measured on 24 November 2026 (Apple silicon, Node 22):

| | Prebuilt masks | Rasterize in the browser |
| --- | --- | --- |
| Download | 13.6 MB raw, about 0.45 MB gzipped (Pages compresses JSON) | 41 MB of source layers |
| Work before the first result | Decode and combine | About 25 s of geometry work for all 147 masks |

The worker still falls back to rasterizing the source layers when the file is missing or invalid, so a local checkout without synced data still recovers.

## Runtime behavior

The worker first loads `/data/walkability/heatmap/factor_masks.json` through `withBase`. If the encoding, cell size and grid size match, it combines the masks directly; if a mask it needs is missing it falls back to rasterizing the source layers.
