# Toolkit extraction

The reusable foundation is isolated in `packages/geo-toolkit`, with the local
package name `@pgmaps/geo-toolkit`. PG Maps depends on it through an npm workspace
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

`examples/toolkit-consumer` is a separate Vite application using package exports
and compiled CSS. It imports no PG Maps source, router, theme provider or data.
It contains a two-metric index, a classified grid and donut, story interactions,
and two independent embedded workspaces with separate themes, plus scene story
navigation and injected storage/export transports. Its browser checks
assert real MapLibre readiness/layers, score recomputation, story interactions,
independent mobile cards, container resizing/state preservation, import/export
round trips and container bounds. Basemaps use inline styles so the
example does not require external tile services.

## Commands

```sh
npm run toolkit:build
npm run toolkit:check
npm run toolkit:lint
npm run toolkit:format:check
npm run toolkit:test
npm run toolkit:watch:check
npm run toolkit:example:build
npm run toolkit:example:test
npm run toolkit:nested:test
npm run toolkit:pack:check
npm test
npx tsc -b
npx vite build
node scripts/audit-map-colors.mjs --check
```

`npm run dev` and `npm run build` build the toolkit before PG Maps preparation.
After editing toolkit source during a running Vite session, rebuild the toolkit
to refresh the compiled package, or keep `npm run toolkit:watch` running. Watch
builds preserve the last valid artifact after compilation errors and remove
obsolete outputs after a successful rebuild. PG Maps production checks can invoke
TypeScript and Vite directly when generated scraper data is already prepared.

`toolkit:pack:check` installs the packed artifact into a temporary consumer outside
the repository and builds it. Add `-- --offline` with a warmed npm cache, or run
`node scripts/toolkit/check-packed-consumer.mjs --browser` after building to verify
the packed browser example too.

Color inventories follow package ownership and compatibility reexports. Run
`node scripts/audit-map-colors.mjs` after moving or adding palette definitions.
Project parser/audit/renderer invariants continue to apply through the source
compatibility paths; do not add unsupported JSON fields for portability.

`.github/workflows/toolkit.yml` runs boundary, lint, format, focused compatibility
tests, watch recovery, example browser and packed artifact checks on pull requests
and main. It initializes the small json-url npm dependency, without scraper data.
Root lint/format commands now also cover package/example sources. The package
inherits the repository's MIT license; `API.md` defines supported and compatibility
exports, and `RELEASING.md` defines versioning and the later repository transition.

## Remaining work and future split

Specialized domain methods, dataset transports, indexed result storage, report
implementations, project catalog normalizers, imported-document adapters and
full source-specific explorer orchestration remain host-owned. The toolkit has
working Index Lab, native editorial and scene presentation interfaces; a visual
project authoring editor, remote sharing service and generic report designer
would be additional product work. No separate repository or release is created
by this in-repo refactor.

Before moving to another repository:

1. Keep the independent consumer passing against the packed artifact.
2. Move package-local tests/build configuration alongside the source and keep
   behavioral compatibility tests in PG Maps.
3. Preserve the package name and exports, version schema/behavior changes, and
   establish the repository's license and release process.
4. Replace the local `file:packages/geo-toolkit` dependency with the released
   version, remove the toolkit workspace entry and source paths/test aliases,
   and delete the local directory after PG Maps builds against the release.
5. Continue improving shared behavior in the toolkit while adapting PG-specific
   policies in PG Maps. Existing datasets retain their documented ownership.
