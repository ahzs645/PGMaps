# Shared component release preparation

The audited extractions, additional browser validation, formatting cleanup and
hook-warning cleanup are committed on `codex/shared-components`.

## Published changes

- [Toolkit PR #5](https://github.com/ahzs645/geo-toolkit/pull/5) contains the generic
  controls, clipboard and map APIs. PG Maps pins toolkit commit
  `b895db8f6b61a0be1dd3cf54bed5097c02762995`.
- The toolkit's [full CI run](https://github.com/ahzs645/geo-toolkit/actions/runs/41123769362)
  passed before updating the host pin: type and boundary checks, lint, formatting,
  tests, independent consumer, watch recovery, nested workspaces, packed browser
  consumer and MapLibre 6 compatibility.
- [PG Maps PR #59](https://github.com/ahzs645/PGMaps/pull/59) separates the application
  refactor, formatting, warning fixes, specialist results and browser coverage
  into reviewable commits. Its Checks workflow enforces zero lint warnings and
  formatting alongside TypeScript and the full unit suite.
- The existing GitHub Pages workflow builds pull requests but skips deployment.
  These changes prepare the release; the PRs can be merged toolkit first, then
  PG Maps.

## Additional cleanup and preserved behavior

All **411 existing formatting failures** have been corrected. The **61 original
lint warnings** have been addressed, including further diagnostics exposed as
the compiler could analyze previously blocked components.

The fixes preserve native numeric step behavior, custom road stepping, camera
and mode memory, mutable virtualized results, route buffers, worker cancellation,
storage recovery, cached pins, preview retries, progress and frozen forest
updates during playback. Keyed async results reject stale responses, including
responses from a previous activation of the same resource.

Lint rules remain enabled. TanStack virtualizer owners explicitly opt out of
automatic compiler memoization and document that mutable API boundary. Narrow
annotations also document immediate error reporting from failed MapLibre/WebGL
or storage initialization; ordinary state resets and dependencies were fixed
structurally.

The specialist sidebar's remaining first-80 cap was removed with the shared
virtual list. Searches now examine every specialist and procedure. Its original
P50/P90/case metrics, filters, sorting and intentional popup summaries remain.

Upstream road-workflow commit `922873ac` was integrated during preparation. All
nine overlapping files were checked after reversing the NativeSelect adapter
and applying repository formatting: the upstream behavior was retained exactly.
Another 19 newly added selects across seven files adopted the shared native
control without changing their props, handlers or options.

## Validation

The merged application passed **2,757 unit/interaction tests** in GitHub Checks,
with one existing test skipped. TypeScript, zero-warning ESLint, global formatting
and the production build passed. The standalone toolkit suite passed 127 tests.
The PR's live checks are the source of truth for its latest commit.

Follow-up browser coverage exercises these real desktop/mobile workflows:

| Area | Cases and assertions |
| --- | --- |
| LiDAR rendering | Six cases use production roof/tree builders and shaders in WebGL2 and real MapLibre callbacks. Pixel colors, point sizing/clipping, projection paths, layer removal, GPU resource deletion, replacement contexts and shader failures are checked. |
| Shared map controls | Fifteen cases cover wait clusters/reveal/filtering, MSP virtualization and fiscal payments, boundary source/opacity/camera, uploaded-data visibility, interaction layers, local DEM height/terrain/observer controls and phone viewshed/sun controls. |
| Climate and early learning | Four cases cover exact quantile labels, null/suppressed values, unmapped rows, scrolling past row 80, wave/source changes, immutable releases, stale-loading isolation and mobile width. |
| Water temperature | Two existing cases cover date/aggregation/CSV controls and mobile retries, fullscreen, resizing and retained station selection. |
| Forestry preview | Four cases cover inventory suggestions, actual eye-level terrain/stand rendering, frozen updates during playback, pause/retry behavior, source-cache reuse and saved previews. |
| Specialist results | Two cases scroll a real 115-facility list to item 114, retain list/map/popup selection and metrics, and exercise patient/procedure filters and sorting. |
| Transit and Flatten | Five existing cases cover routing, walking comparison, sharing, held-drag heat, missing-data recovery, route buffers, endpoint dragging, elevation and city switching. |
| Toolkit virtualizer | Two cases cover subpixel offset stability, fast scrolling, changing headers, keyboard navigation and filtering. |

The forestry browser helper now opens enclosing disclosures before their child
controls. One Save-readiness assertion allows 60 seconds for SwiftShader to
prepare a full 150,000-stem stand. A complete regional-scenario calculation test
allows 15 seconds on shared CI runners. All feature assertions and production
timeouts, terrain limits and source budgets remain intact.

LiDAR generated snapshots and scraper-owned datasets were not changed. Source
snapshots used for verification were assembled through the existing sync scripts.
