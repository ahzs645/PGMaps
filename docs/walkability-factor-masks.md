# Walkability Factor Masks

## Purpose

The MISC > Walkability equation builder needs to update the Mobility Index heatmap when factor weights or option toggles change. Rasterizing source geometry in the browser made the first live recalculation slow because the worker had to load every source layer, build the city boundary mask, buffer features, and scan grid cells.

The current approach prebuilds reusable component masks for every factor component. At runtime, the worker downloads those masks, applies the current equation weights and toggles, and combines scores into the final grid. This moves expensive geometry work out of the user interaction path while still supporting arbitrary factor weights and supported option combinations.

## Committed Asset

```text
public/data/walkability/heatmap/factor_masks.json
```

This file is a generated app asset, but it is intentionally committed. It is not ignored by Git. The raw JSON is about 13 MB, but it compresses to roughly 0.45 MB with gzip because bit-packed masks are highly repetitive.

The asset contains:

- Grid metadata: rows, columns, cell size, no-data value, and image coordinates.
- A bit-packed city-boundary inside mask.
- A bit-packed mask for each factor component and distance/buffer combination.
- Stable component keys matching `src/maps/pgdata/walkabilityLiveHeatmap.worker.js`.

## Build Command

Regenerate the asset after changing walkability source data, factor definitions, variant logic, or rasterization logic:

```bash
npm run walkability:build-factor-masks
```

Then verify:

```bash
npx tsc -b
git ls-files --others --ignored --exclude-standard -- public/data/walkability/heatmap/factor_masks.json
git status --short -- public/data/walkability/heatmap/factor_masks.json
```

The ignored-files command should print nothing. `git status` should show the mask asset as untracked before it is staged, or tracked after it has been added.

## Runtime Behavior

The worker first attempts to load:

```text
/data/walkability/heatmap/factor_masks.json
```

If the asset is available and matches the expected encoding and grid metadata, the worker combines prebuilt masks directly. If the asset is missing or invalid, the worker falls back to source-layer rasterization so local development still has a recoverable path.

## Why This Lives in docs/

This is project-level operational context rather than implementation detail for one function. The important decisions span data generation, committed assets, browser performance, and future maintenance. Keeping it in `docs/` makes the rationale discoverable from the repo root and keeps the worker comments focused on local code behavior.

The existing `docs/` folder already holds similar cross-cutting data and rebuild notes, so this follows the repo's current documentation pattern instead of creating a new convention.
