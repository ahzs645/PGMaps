# Toolkit extraction

The reusable foundation is maintained in the public
[`ahzs645/geo-toolkit`](https://github.com/ahzs645/geo-toolkit) repository.
`packages/geo-toolkit` is a pinned Git submodule, with package name
`@pgmaps/geo-toolkit`. PG Maps depends on it through an npm workspace
link and uses its compiled artifacts in Vite. TypeScript and Vitest resolve the
local source so package edits and compatibility tests are checked together.

## Ownership

Implement shared behavior in the package. Existing paths under
`src/components/ui`, `src/lib` and editorial components are compatibility exports
or adapters, not second implementations. PG Maps adapters supply `next-themes`,
PG/BC camera defaults, DatasetInfo, navbar/dialog callbacks, toolbar references
and the legacy window event bridge. The toolkit cannot import PG Maps source,
`@/` aliases, `import.meta.env`, scraper submodules or application data paths.

Index Lab calls the package for generic normalization/scoring and metric recipe
computation. Region/domain definitions, source catalogs, colors, specialized
methods and result filtering remain application adapters. Extraction regression
fixtures preserve the original scoring behavior across method combinations;
the separate generic record-scoring API remains separate.
Its metric library, weight rows and result cards are also package-owned and used
by PG Maps through adapters. The standalone `/index-lab/react` controller and
interface accept a metric catalog and calculation callback. Presentation search
does not change the comparison universe used for normalization.

The scale resolver and legend definition use one domain, breaks, colors, missing
policy and boundary convention. Legend rendering preserves unequal numeric
intervals. Donut drawing is independent of map clustering. Raster decoding/grid
classification preserves source evidence and uncertain/no-data cells.

Project scene/layer contracts, native editorial types and validation, reusable
story components, diagrams and presentation CSS are package-owned. Runtime
catalog registration and native/imported story orchestration stay in PG Maps.
The complete native editorial presentation is composed by a package renderer
with PG map/comparison/shell adapters. Scene story presentation and a shared
scene controller use supplied layer/map adapters. These do not guess which
remote sources a host supports. Generic codecs, collection stores, repositories,
and import/export/share ports retain host validation, storage keys and transport
policies; PG Maps delegates its existing JSON/local collection mechanics.

Map layers are split into individual implementations and internal source/cluster
helpers behind stable exports. Responsive layout separates presentation from
sheet controllers, gestures and layout calculations. Independent providers
observe container width by default, including a narrow embed in a wide browser.
PG adapters explicitly retain viewport responsiveness. Scoped responsive CSS
requires a browser with CSS `@scope` support.
Editorial and scene reading layouts also follow their nearest workspace's
responsive mode, so a narrow story embed stacks on a wide desktop page.

## Independent consumer

The toolkit repository's `examples/toolkit-consumer` is a separate Vite application using package exports
and compiled CSS. It imports no PG Maps source, router, theme provider or data.
It contains a two-metric index, a classified grid and donut, story interactions,
and two independent embedded workspaces with separate themes, plus scene story
navigation and injected storage/export transports. Its browser checks
assert real MapLibre readiness/layers, score recomputation, story interactions,
independent mobile cards, container resizing/state preservation, import/export
round trips and container bounds. Basemaps use inline styles so the
example does not require external tile services.

Its `/charts` route demonstrates the chart toolkit with synthetic energy data:
a linked numeric timeline, supplied range bands, canvas scatter points, shared
range/series controls and full-window panels. Two instances verify independent
selection, zoom and range state, including a narrow embed in a wide browser.
Chart implementations live in `/visualizations/react` so pure visualization
helpers and donut imports remain usable without rendering peers. Water data
preparation and calendar/coverage rules stay in PG Maps adapters.

## Commands

```sh
npm run toolkit:build
npm test
npx tsc -b
npx vite build
node scripts/audit-map-colors.mjs --check
```

The package's own checks (boundaries, lint, format, tests, watch recovery, the
independent consumer, nested workspace and packed artifact) are run from inside
`packages/geo-toolkit` with the commands in its `RELEASING.md`.

`npm run dev` and `npm run build` build the toolkit before PG Maps preparation.
After editing toolkit source during a running Vite session, rebuild the toolkit
to refresh the compiled package, or keep `npm run toolkit:watch` running. Watch
builds preserve the last valid artifact after compilation errors and remove
obsolete outputs after a successful rebuild. PG Maps production checks can invoke
TypeScript and Vite directly when generated scraper data is already prepared.

Color inventories follow package ownership and compatibility reexports. Run
`node scripts/audit-map-colors.mjs` after moving or adding palette definitions.
Project parser/audit/renderer invariants continue to apply through the source
compatibility paths; do not add unsupported JSON fields for portability.

The toolkit repository's CI runs the package checks, including a MapLibre 6
build, on its own pull requests and main. PG Maps no longer duplicates them: its
`checks.yml` builds the pinned toolkit commit and runs `tsc -b`, lint and the full
unit suite, which includes the package's tests against PG Maps' dependency
versions. Root lint/format commands also cover the package sources. The package
inherits the repository's MIT license; `API.md` defines supported and compatibility
exports, and `RELEASING.md` defines versioning and consumer updates.

## Remaining host responsibilities

Specialized domain methods, dataset transports, indexed result storage, report
implementations, project catalog normalizers, imported-document adapters and
full source-specific explorer orchestration remain host-owned. The toolkit has
working Index Lab, native editorial and scene presentation interfaces; a visual
project authoring editor, remote sharing service and generic report designer
would be additional product work. The source repository is public; npm registry
publication remains disabled.

## Working with the toolkit submodule

Clone PG Maps with `git clone --recurse-submodules`, or initialize an existing
checkout with `git submodule update --init --recursive`. Deployment checkout
already initializes recursive submodules; keep that setting.

1. Edit toolkit behavior inside `packages/geo-toolkit`, or use a separate clone
   of `ahzs645/geo-toolkit`. The package owns its build config, tests, API docs,
   independent consumer and CI. PG Maps keeps its host compatibility tests.
2. Run the standalone checks documented in the toolkit's `RELEASING.md`, then
   commit and push toolkit changes to its repository first and confirm its CI
   passes.
3. Update the PG Maps submodule to the intended toolkit commit. Run
   `npm run toolkit:build`, the affected host checks and `npx tsc -b`.
4. Commit the `packages/geo-toolkit` pointer in PG Maps. A deployed host uses
   this pinned commit; a toolkit push alone does not update it.

The workspace link and local TypeScript/Vitest source aliases remain intentional
for submodule development. Do not add toolkit source files to the parent index.
The independent public repository builds with `npm ci && npm run build`, without
PG Maps or scraper submodules.

If a registry release replaces the submodule later, preserve the package name
and exports; remove the local toolkit workspace and source aliases only after
PG Maps passes its checks against the released artifact. Datasets retain their
documented ownership.
