# Expanding Dev Projects sustainably

New projects should use the existing package contract and renderer. The catalog
reads the generated summary index; it loads a full package and its workspace only
when opened. Keep map-engine and renderer imports behind the workspace's lazy
boundary. Catalog metadata helpers must stay free of map-runtime imports.

Catalog search and type filters always search the full index. Featured browsing
is an initial curation choice, not a search restriction. Render one responsive
representation, in pages of 12, and keep filtering near the reader. Do not replace
pagination with an accumulating “load more” list without a DOM bound.

Reusable ownership boundaries:

- `pages/DevProjects.tsx`: catalog and routing, summary/package loading.
- `maps/project-workspace/`: generic portal/recipe workspace and lightweight
  shared presentation metadata. Story, research, and score renderers load lazily.
- `maps/project-story/storySources.ts`: source lifecycle, request deduplication,
  cancellation, independent failure and retry. No global collection cache.
- `components/ui/map-layer-order.ts`: restores authored draw order when a slower
  source arrives after a later layer.
- `components/ui/map-shared-source.ts`: map-local source leases. Sharing requires
  identical data and feature identity; all owners release their paint layers
  before the source is released. Existing map components retain isolated sources
  unless a source key is explicitly supplied.
- `maps/project-explorer/adapters/`: shared filter predicates and derived counts.
- `hooks/usePagination.ts` and `components/ui/pagination-controls.tsx`: bounded
  list navigation reused by catalogs, ranked locations, and record dialogs.

## Regression gates

Run the project package skill's audit and renderer loop when adding capabilities.
The tests below protect the growth-sensitive behavior:

- `projects-catalog.spec.ts`: 320/390/1024/1440px; bounded rows/cards, full search,
  reachable actions, and no MapLibre download during catalog browsing.
- `project-usability.spec.ts`: mobile map access, reading position, retries,
  timeline/filter agreement.
- `project-story-layouts.spec.ts`: every scene forward/back in panel, scrolly,
  and slides at phone/desktop sizes, canvas stability, console errors.
- `storySources.test.ts`, `map-shared-source.test.ts`, `map-layer-order.test.ts`, and
  `filterResearchRecords.test.ts`: lifecycle and data invariants.

For a production preview, set `PGMAPS_E2E_BASE_URL` to skip starting a dev server.
`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH` selects an installed browser and its normal GPU
instead of the default software-rendering test setup. Report which was used;
software-GPU timings are not user performance benchmarks.

Use real phone/Safari checks for memory, pinch gestures, keyboard behavior, and
sustained frame rate before claiming device performance. When a source grows,
measure both compressed transfer and expanded geometry/property size. Large
first-scene sources need data-level simplification or tiled delivery; scene-based
loading delays a cost but cannot remove it. Keep scraper-owned optimizations and
snapshots in `vendor/bcdatamapper`, following the root AGENTS.md workflow.
