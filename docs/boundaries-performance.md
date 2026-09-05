# Boundary explorer: interaction and performance

Review date: 2026-09-05. Scope: `/dev/boundaries`, with a regression check of the BCER raw/optimized comparison page.

## Changes

| Finding | Current behavior |
| --- | --- |
| Whole layers were dissolved and intersected during ordinary rendering, before requesting a comparison. | Comparison runs only after an explicit request, inside a module worker. Changing opacity preserves the result; hiding or replacing a comparison terminates obsolete work. |
| Geometry errors appeared as a valid zero-overlap result. | Invalid rings and clipping failures report an error. The user can retry. Legitimately disjoint boundaries display `0 km²`. |
| A feature-count limit did not protect against very detailed polygons. | Keep the 500-feature limit and terminate comparison jobs after 30 seconds. The UI remains usable and offers filtering/retry. |
| Mobile selection/comparison trays occupied the same bottom space as the sheet; the desktop comparison could be wider than the map pane. | Mobile details live at the beginning of the scrollable sheet. Desktop details are bounded by the map pane, with scrolling for short windows. |
| Add was below the global search form, and many actions had small touch targets. | Add remains in the sidebar header. Comparison, removal, ordering, and search-filter controls use mobile touch sizing. |
| Layer lists stopped after 120 items; global search stopped after 60. | Lists/search render 20 results per page, selection cards 12. All matches are reachable. Changing the query resets paging. |
| Adding or reordering a source remounted every map layer. | Stable source/level keys and shared `layerOrder` preserve mounted layers. Parent outlines and comparison surfaces have explicit order. Comparison GeoJSON retains stable identity between UI renders. |
| Census viewport chunks loaded concurrently without a limit and remained retained for every visited viewport. | At most four chunk fetches run concurrently. Obsolete pending requests are aborted. Keep active/rendered chunks plus at most 16 inactive chunks. |
| Failed census parent outlines automatically retried in a render/effect loop. | Failures remain visible until explicit retry; successful chunks are preserved when retrying failures. Ordinary pending source loads are cancelled on removal/navigation. |

## Extension points

- `src/maps/boundaries/boundaryDifference.ts`: pure polygon validation, dissolve, intersection, difference, and area calculations. Keep expensive geometry here, not in render-time memos.
- `boundaryDifference.worker.ts`: execution/error boundary. Never replace errors with fabricated measurements.
- `useBoundaryDifference.ts`: job identity, timeout, retry, cancellation, stale-result protection, and result release. Treat input features as immutable; camera and styling changes must not start a new geometry job.
- `PaginatedBoundaryList.tsx`: bounded list presentation using shared `usePagination` and `PaginationControls`. Do not add an unreachable `slice(0, limit)` list.
- `DevBoundaries.tsx`: source selection, source cache/request ownership, shared URL state, map orchestration, and sidebar composition. New independent operations should become modules under `src/maps/boundaries/` rather than additional geometry code in this page.
- Continue using shared theme tokens, map components, and mobile layout. Put mobile details inside the sheet instead of creating another overlay over it.

When adding a source, supply a stable source/level identity, honor `AbortSignal`, expose load errors/retry, preserve source ownership, and verify both a small and a large layer. Dataset snapshots remain governed by the root scraper/submodule policy.

## Validation

`tests/e2e/boundaries-usability.spec.ts` covers four widths (320, 390, 1024, 1440), explicit worker activation, opacity changes, cancellation, ordinary source retry, parent-outline retry, chunk concurrency/retry, later list pages, and global search pages. Existing BCER, census classification, named-watershed, and source-picker tests remain relevant.

Validation passed: 17 distinct browser checks, 11 focused unit tests, full TypeScript checking, scoped ESLint, and a production Vite bundle.

Geometry unit tests cover overlapping, disjoint, dissolved, and invalid polygons. Shared layer-order and search-index tests cover dependencies. Light/dark screenshots at all four widths showed no body overflow or uncaught page errors. These are desktop Chrome viewport/touch simulations, not a physical iPhone or Android benchmark.

Use a production Vite preview with hardware-backed Chrome for measurements. Block service workers in fault-injection tests so the cache cannot bypass mocked failures. Avoid interpreting SwiftShader CPU load or development-server overhead as production map performance.

## Remaining scaling work

- The current global search catalog is 34,189 records: approximately 3.1 MB compressed / 31.9 MB JSON. It loads on search focus. Moving parsing/search into a worker or partitioning its index is a separate worthwhile improvement before substantial catalog growth. A local Node sample took about 8–166 ms per query depending on match mode; this is not a mobile timing claim.
- Ordinary study-area loaders still have shared, process-lifetime region caches. The new bounded cache applies to census viewport chunks, not all dataset loaders. A broader byte-budgeted cache needs to account for other consumers before changing their ownership semantics.
- “Select all” across many search results can intentionally activate multiple complete source/level datasets. Source loading and geometry payloads can still be expensive; pagination limits DOM size, not download size.
- The BCER comparison page intentionally downloads and renders the raw source alongside its optimized snapshot. Keep this diagnostic workload separate from the explorer's normal optimized source path.
