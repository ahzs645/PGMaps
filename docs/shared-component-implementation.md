# Shared component implementation

The [component audit](shared-component-audit.md) is implemented in the working
tree. The changes share presentation and interaction mechanics while preserving
each app's data, calculation, editing and navigation policies.

## Completed work

| Area | Implementation and retained behavior |
| --- | --- |
| Form fields | Toolkit `FormField`, `NativeSelect`, `SelectField`, `NumberField` and `NullableNumberField`, with application compatibility exports. Road design, forestry, AVAST, Design Lab and Water Temperature use the shared fields; native selects are adopted across the remaining app forms. Existing native props, refs and explicit classes are preserved. |
| Numeric ranges | Toolkit `NumericRangeField` shares labels, value/unit readouts, descriptions and accessible range controls. A `renderControl` adapter retains custom sliders. Consumers include walkability, LiDAR, forestry, viewshed and AQMap controls. |
| Wait-map markers | Toolkit `clusterScreenPoints` and `useScreenPointClusters` replace duplicate projected-marker clustering. Priority, 54 px radius, 140 px margin, incremental centroids and singleton fallback are retained. ER still expands by zooming; specialists still reveal individual facilities. |
| Viewport observation | Toolkit `MapViewportSnapshot`, `observeMapViewport`, `useObserveMapViewport` and `useMapViewport` share settled-event subscriptions and cleanup. Boundary, data-table, air-quality and transit observers retain their event/initial-publication policies. `refreshKey` republishes when calculation inputs change without a map gesture. Existing fit helpers replace repeated bounds calculations where their behavior matches. |
| Walkability | Domain-local `WalkabilityFactorWeightRow`, `WalkabilityFactorControls` and `WalkabilityOptionControls` serve MISC and Index Lab. Factor metadata, 0–2 weights, 0.25 steps, dropped terms, report options, direct control, reset and show-off/collapse behavior remain available. |
| Clipboard | Toolkit `useClipboardText`, `CopyButton` and transport/controller helpers share pending/copied/failed state, timeout cleanup and stale-attempt handling. App callers retain URL/TSV generation, manual-copy UI and opt-in selection fallback. Outdoors distinguishes serialization failure from clipboard denial. |
| Result lists | MSP, climate vulnerability and early learning adopt shared search, count, state, row and virtual-list components. MSP passes every matching facility to its list, including matches beyond the former first-80 cap. Selection, payment periods, suppressed values and unmapped source rows are retained. |
| Climate legend | Existing `MapLegendPanel`, `MapSteppedLegend` and note components render the original colors and exact quantile interval labels. List filtering does not change the classification population; tied breaks and missing values retain their meaning. |
| Static loading | Wait maps, MSP and local EDI loaders use `useFetchData`; development-only EDI access and immutable release paths remain gated. Shared loaders now return cached-transform failures as error state, rerun repeated retries, and prevent superseded requests from repopulating invalidated caches. |
| Nechako lifecycle | Domain-local `usePortalWorkspace` shares session-bound clearing and local-vector styling across both interfaces. It preserves camera state, explicit browser saves and styling warnings; each page keeps its own routing and layout. |
| Paging | `PaginationControls` gains optional previous/next labels and a page formatter. Nechako JSON results and monitoring imports adopt it while retaining their own page sizes and table/preview content. |
| LiDAR GPU resources | Domain-local `coloredVertexLayer` shares shader/program/buffer/VAO lifetime and matrix upload between building meshes and tree points. Each caller retains geometry, color generation, shaders and triangle/point rendering. Cleanup also handles partial setup failures. |

## Field contracts

- `NativeSelect` forwards the native select props and ref, including multiple
  selection and native keyboard behavior. An explicit `className` is used
  unchanged; `FORM_INPUT_CLASS` is supplied only when it is omitted. Dense
  engineering controls therefore keep their existing desktop sizing.
- `FormField` connects labels and help/error text to direct native children and
  `NativeSelect`. Compound controls can supply `htmlFor` and `descriptionId`.
  Use `group` for multiple controls and `hintAction` for a help button outside
  the label, so the button does not become part of the control's name.
- Numeric fields retain incomplete drafts. `updateOn` chooses valid-change or
  commit-only updates; `clampOn` chooses immediate, blur/Enter or advisory bounds.
  Required blank values restore by default; zero is opt-in. Nullable blank values
  remain `null`, and `invalidValue="null"` is opt-in for imported forms.
- Source precision is preserved by default, including an untouched blur. Road
  adapters explicitly request `precision={6}` for their existing edit display
  and `stepMode="increment"` for their original keyboard stepping. Other fields
  retain native arrow-key step alignment. A `step` does not quantize every typed
  measurement.
- `NumericRangeField` emits a numeric value continuously. Hosts retain control of
  expensive recalculation and can provide formatted `display`, units, an inline
  or split header, native input classes, or a custom slider adapter.

## Ownership and compatibility

Generic controls, clipboard state and map mechanics live in `packages/geo-toolkit`
and are exported through its `/ui` and `/map` entry points. Existing PG Maps paths
are compatibility exports or adapters. The independent toolkit consumer's
`/controls` experience exercises these APIs without PG Maps dependencies.

Walkability catalogs and rules, Nechako sessions and local styles, and LiDAR
geometry/shaders remain in their application feature directories. Source-specific
fetching, streaming, live polling, terrain cameras, calculations, uncertainty and
provenance retain their existing contracts. Native form checkboxes are retained
where their form/acknowledgment semantics differ from layer-toggle buttons.

The toolkit remains a pinned submodule. Follow
[toolkit extraction](toolkit-extraction.md) for standalone checks and the
package-first publication/submodule workflow; local working-tree changes are not
a package release or a deployed application update.

## Verification

| Check | Result |
| --- | --- |
| Full app/toolkit unit and interaction suite (`npm test -- --maxWorkers=2 --testTimeout=30000`) | 339 files and 2,582 tests passed; one existing test skipped. The explicit timeout accommodates the existing terrain/cost calculations on the shared runner. |
| App TypeScript (`npx tsc -b`) and production bundle (`npx vite build`) | Passed. Source snapshots were assembled through the existing data-sync scripts; generated datasets remain ignored. |
| App ESLint | Passed with zero errors and 61 existing warnings. |
| Toolkit boundary/TypeScript, lint and formatting | Passed; toolkit lint retains its existing virtualizer warning. |
| Standalone toolkit unit suite | 31 files / 127 tests passed. |
| Independent consumer production build and compiled-control browser checks | Passed; two browser cases cover real drafts/nulls/commits, native off-step arrow alignment, units, ranges, multiple selection, refs, descriptions and clipboard fallback. |
| Packed consumer outside PG Maps | Passed: pure imports without rendering peers, exported declarations and independent application build. |
| App browser regressions | Both wait-map cases passed. Thirteen existing cases passed across AVAST exports, desktop/phone road controls, forestry workflows, Nechako styles, local DEM, result scrolling and water-temperature interactions. The road controls passed on rerun after restoring their direct input/label structure. |
| MSP real-list browser regression | Passed: a real 115-item virtual list mounts and selects item 114 after scrolling, preserves its map marker/detail, filters correctly, and retains cumulative and individual fiscal-year payments. |
| Whitespace and documentation links | Passed in both repositories. |

The global app formatting command still reports **411 pre-existing unformatted
files**. Each was checked against `HEAD`; all 22 formatting failures introduced
in previously formatted files were corrected. New source/test files and the
toolkit formatting checks pass. Existing build warnings about bundle size and
third-party CommonJS modules remain outside this refactor.

Regression coverage includes numeric drafts/nulls/precision/commit policies,
native select props and refs, range naming and values, clipboard rejection and
async races, cluster membership/order and viewport cleanup, full result-list
selection and payment periods, exact climate bands, EDI source switching and
production gating, loader retry/cache behavior, portal workspace lifetime and
paging, and LiDAR GPU allocation/cleanup. Browser suites exercise shared controls
in the independent toolkit consumer and both wait maps. The MSP browser
regression scrolls the real virtual list beyond index 80, then verifies map/detail
selection, filtering and fiscal-period payments.
