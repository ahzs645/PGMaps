# Toolkit API guide

`@pgmaps/geo-toolkit` is an ESM TypeScript package. There is no root import:
choose an entry point for the capability you need. PG Maps consumes these same
implementations through local compatibility exports.

## Supported surface

The entry points and named capabilities below are the intended API for new
consumers. Their declarations describe exact callback and data shapes. The
package is currently private at `0.1.0`; this documents the extraction boundary,
not a promise that every historical module is stable.

| Entry point                          | Supported capability                                                                                                                                 | Additional runtime peers                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/calculations`                      | `scoreRecords`, `normalizeValues`, coverage, drivers, sensitivity, geographic and timeline helpers; their configuration/result types                 | None                                                           |
| `/index-lab`                         | Index Lab state/results, normalization/coverage and spatial/derived recipes; their types                                                             | None                                                           |
| `/index-lab/react`                   | `IndexLab`, `useIndexLabController`, controls, result lists/cards and metric library components                                                      | React, React DOM                                               |
| `/scales`                            | `resolvePaletteScale`, `samplePalette`, `paletteInterpolator`, `paletteContrast`, color helpers, `createScaleLegend`; their options and legend types | None                                                           |
| `/visualizations`                    | `renderDonutSvg`, `DonutOptions`                                                                                                                     | None                                                           |
| `/grids`                             | `decodePngPixels`, `reconstructImageClassGrid`, `rasterGridCellRing`, grid constants and data types                                                  | None                                                           |
| `/grids/map-raster-grid`             | `createRasterGridLayer`, `RasterGridPick`                                                                                                            | `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`      |
| `/map`                               | `Map`, markers/popups, controls, routes, layer components, `MapStory` composition, camera/scale helpers and shared map style constants               | React, React DOM, MapLibre                                     |
| `/map/persistent-map`                | `PersistentMapProvider`, `PersistentMapHost`, `SharedMap`, `usePersistentMap`, `useMapBasemap`                                                       | React, React DOM, MapLibre                                     |
| `/map/map-deck`                      | Shared deck.gl overlay integration                                                                                                                   | React, React DOM, MapLibre, `@deck.gl/core`, `@deck.gl/mapbox` |
| `/workspace`                         | `WorkspaceProvider`, `MapSectionLayout`, responsive media hooks and `requestMapSearch`                                                               | React, React DOM                                               |
| `/ui`                                | Sidebar, list, dialog, feature-card, legend, tab, statistic and control components; `ScaleLegend`                                                    | React, React DOM                                               |
| `/projects`                          | Scene/layer types, codecs, repositories and JSON import/export/share ports                                                                           | None                                                           |
| `/stories/model/types`               | Native editorial document types                                                                                                                      | None; type-only                                                |
| `/stories/model/validate.mjs`        | `parseEditorialDocument`, `validateEditorialDocument`                                                                                                | None                                                           |
| `/stories` and `/stories/components` | `EditorialDocumentRenderer`, `SceneStoryRenderer`, editorial components and diagrams                                                                 | React, React DOM                                               |
| `/styles.css`, `/stories/styles.css` | Compiled, scoped component and editorial CSS                                                                                                         | None                                                           |

React and map-engine peers are optional at installation time. Install them when
using a corresponding entry point. Pure calculations, scales, donuts and grid
decoding do not import those peers. Importing `/map` requires a browser-capable
bundler because MapLibre's stylesheet is imported by the module. Deck.gl modules
remain separate from the normal map and pure-grid entry points.

Other wildcard subpaths exist so PG Maps' old file paths can reexport the moved
implementations. They are **compatibility surfaces**, not additional supported
APIs. In particular, loader internals/workers, source-ordering helpers, mobile
card stores, raw workspace event dispatch, SVG wedge builders and MapLibre donut
property adapters may change with their containing implementation. Export
presence alone does not make those modules part of the documented API. Prefer
the entry points above; do not import `dist` files or package `src` paths.

## Calculate, then resolve display semantics

Calculation normalization determines scores. Display classification determines
which colors represent scores. Persist those configurations separately so a
palette update cannot change a calculation.

```ts
import { scoreRecords, type ScoreRecord } from '@pgmaps/geo-toolkit/calculations'
import { createScaleLegend, resolvePaletteScale } from '@pgmaps/geo-toolkit/scales'
import { renderDonutSvg } from '@pgmaps/geo-toolkit/visualizations'
import { GRID_UNCERTAIN, reconstructImageClassGrid } from '@pgmaps/geo-toolkit/grids'

type Metric = 'access'
const records: ScoreRecord<Metric>[] = [
  { id: 'north', values: { access: 25 } },
  { id: 'south', values: { access: 75 } },
]
const results = scoreRecords(records, {
  metrics: [{ key: 'access', weight: 1, normalization: { method: 'minMax', min: 0, max: 100 } }],
  aggregation: { method: 'additive' },
})
const scale = resolvePaletteScale({
  colors: ['#eff6ff', '#1d4ed8'],
  domain: [0, 1],
  classes: 3,
  classification: 'manual',
  breaks: [0.2, 0.8],
  missingColor: '#94a3b8',
})
const legend = createScaleLegend(scale, { title: 'Access index', unit: '0–1' })
const rows = results.map((result) => ({ id: result.record.id, fill: scale.colorForValue(result.score) }))
const donut = renderDonutSvg({ counts: [2, 3, 5], colors: scale.colors, showCount: true })
const grid = reconstructImageClassGrid(
  new Uint8ClampedArray([255, 0, 0, 255]),
  1,
  1,
  [{ value: 1, rgb: [255, 0, 0] }],
  { cellPixels: 1, preserveSourcePixels: true },
)
const uncertain = grid.cells[0].value === GRID_UNCERTAIN
// legend is serializable; resolver functions are intentionally not saved.
export { results, scale, legend, rows, donut, grid, uncertain }
```

The generic scorer returns scores in `[0, 1]`. Index Lab's policy returns scores
in `[0, 100]` and deliberately preserves its historical normalization, tie and
coverage behavior. Choose an engine explicitly; they are not interchangeable.
Hosts supply metric catalogs, data availability, domain methods, units and
storage. A value filled with zero cannot prove that its source had coverage.

### Index Lab interface and state

The pure `/index-lab` entry exports `IndexLabMetric`, `IndexLabRecord`,
`IndexLabSettings`, `IndexLabState`, `createIndexLabState`, `indexLabReducer` and
`computeIndexLabResults`. Low-level `calculateIndexRows`, normalization/coverage
helpers, `computePointMetricRecipe` and `computeDerivedExpressionMetric` support
custom pipelines. Spatial recipes accept caller-supplied records and boundaries;
the package does not discover or fetch a geographic catalog.

`/index-lab/react` supplies the complete standard interface and its parts.
Provide a metric catalog and records to `IndexLab`; defaults are percentile
normalization, additive aggregation and neutral missing data. Provide explicit
coverage flags when a finite placeholder value does not represent a measurement.

```tsx
import type { IndexLabMetric, IndexLabRecord } from '@pgmaps/geo-toolkit/index-lab'
import { IndexLab } from '@pgmaps/geo-toolkit/index-lab/react'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace'
import '@pgmaps/geo-toolkit/styles.css'

const metrics: IndexLabMetric<'access'>[] = [
  {
    key: 'access',
    label: 'Access',
    shortLabel: 'Access',
    description: 'Measured service access',
    category: 'services',
    format: 'number',
    defaultWeight: 1,
  },
]
const records: IndexLabRecord<'access'>[] = [
  { id: 'north', label: 'North', values: { access: 25 }, coverage: { access: true } },
  { id: 'south', label: 'South', values: { access: 75 }, coverage: { access: true } },
]

export function AccessLab() {
  return (
    <WorkspaceProvider theme="light">
      <IndexLab metrics={metrics} records={records} />
    </WorkspaceProvider>
  )
}
```

Use `useIndexLabController` plus `IndexLabControls`/`IndexLabResults` for a
custom layout. Its `compute` callback receives weights and settings; querying
and selecting results never redefine the normalization universe. Specialized
domain methods supply a custom callback and method controls. Initial props
apply on mount; use `replaceState` for an explicit reset or loading a saved
configuration. Updated catalogs change available metrics without silently
discarding the user's existing weight state. Hosts own URL/history/storage
adapters and source availability messages.

Controls use a stacked layout by default for narrow panels; compose
`IndexLabControls` with `layout="columns"` for wider views. Sparse absent
weights are zero. The calculation engine rejects nonfinite supplied weights;
the controller ignores invalid edits and sanitizes its initial state. A
negative weight expresses preference for lower metric values.

### Numeric scales and legends

`PaletteSampling` controls authored colors, unequal source positions, palette
`range` within `[0, 1]`, reversal and RGB/Lab interpolation. `PaletteScaleOptions`
adds numeric `domain`, requested `classes`, classification and `missingColor`.
`ResolvedPaletteScale` describes the shared renderer/legend result.
Palette ranges never crop the numeric domain.

- Equal intervals divide the supplied domain. Manual `breaks` must increase
  strictly inside it and determine the effective class count.
- Quantiles use finite observations inside the domain, deduplicate thresholds,
  and can produce fewer classes than requested. Constant domains have one bin.
- Exact break values enter the upper bin. Finite out-of-domain values clamp to
  the end colors. `null`, `undefined`, `NaN` and infinities are missing; zero is
  a valid observation.
- Use the same resolved scale for marks and `createScaleLegend`. The legend
  snapshots exact breaks, colors, unequal numeric bin widths and missing-data
  treatment. `ScaleLegend` accepts it with an optional `formatValue` callback.
- Keep comparison domains/breaks fixed across dates. Hosts retain published
  category identities, thresholds and semantic colors; no global palette
  substitution or automatic theme inversion is applied.

Categorical data can use explicit color registries and `colorForKey` for stable
fallback colors. Generic numeric classification should not be used to invent
new category thresholds.

### Donuts and grids

`renderDonutSvg` returns `{ svg, size, total }` without a DOM. Provide
nonnegative category counts in the same order as `colors`. Omitted category
counts are zero. `total` can preserve a known aggregate; otherwise counts are
summed. It controls the historical count-based marker sizing. `showCount` and
`centerStyle: 'white' | 'transparent'` preserve the original presentation.
`centerColor`, `textColor`, `textHaloColor` and `shadow` allow host styling while
leaving category colors unchanged. The default colors and shadow reproduce
existing markers. SVG attributes are escaped; this is a small donut renderer,
not an arbitrary SVG sanitization or rich-content API.

`GRID_NO_DATA` means transparent source evidence; `GRID_UNCERTAIN` means the
classification was ambiguous or outside its thresholds. `cellPixels` describes
globally aligned source-pixel boxes, not a new measurement resolution. Lossless
`rgba` evidence is retained only with `cellPixels: 1` and
`preserveSourcePixels: true`. Larger boxes use the documented agreement rules.
`decodePngPixels` accepts 8-bit RGBA PNGs and checks CRCs.

The optional `createRasterGridLayer` accepts `RasterGridLayerOptions` with a `tileUrl` callback, source zoom
bounds, palette and `colorForValue`, with optional hover/pick/error callbacks.
It fetches 256×256 XYZ source tiles and retains tile/cell metadata when picked.
Preserved source RGBA takes precedence over restyling; disable source-pixel
preservation explicitly when classification colors should be rendered. Styling
or zooming never creates additional source detail.

## Embed a responsive workspace

Import the toolkit stylesheet once. Give the workspace a definite height and
one provider per independent map experience. Supply initial camera coordinates
and your tile styles; the toolkit does not infer an application's region.

```tsx
import type { FeatureCollection, Geometry } from 'geojson'
import { Map, MapFillLayer } from '@pgmaps/geo-toolkit/map'
import { MapSectionLayout, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace'
import { MapSidebarShell, ScaleLegend } from '@pgmaps/geo-toolkit/ui'
import { createScaleLegend, resolvePaletteScale } from '@pgmaps/geo-toolkit/scales'
import '@pgmaps/geo-toolkit/styles.css'

const scale = resolvePaletteScale({
  colors: ['#eff6ff', '#1d4ed8'],
  domain: [0, 100],
  classes: 5,
  missingColor: '#94a3b8',
})
const legend = createScaleLegend(scale, { title: 'Access', unit: '%' })

export function EmbeddedMap({ features }: { features: FeatureCollection<Geometry> }) {
  return (
    <div style={{ height: 520 }}>
      <WorkspaceProvider theme="light" className="my-map">
        <MapSectionLayout
          sidebar={
            <MapSidebarShell title="Places">
              <ScaleLegend legend={legend} />
            </MapSidebarShell>
          }
        >
          <Map center={[0, 0]} zoom={2} theme="light">
            <MapFillLayer data={features} fillColor="#38bdf8" />
          </Map>
        </MapSectionLayout>
      </WorkspaceProvider>
    </div>
  )
}
```

The example uses a constant polygon fill to keep its layer input minimal. For a
classified view, supply the layer's property expression or per-feature color
from the same scale used for its legend. The host owns data loading and units.

`Map` accepts MapLibre options other than `container`, `style` and `trackResize`,
plus toolkit `styles`, `theme`, loading, controls and viewport props. `center`
and `zoom` establish the initial camera. Supply both `viewport` and
`onViewportChange` for controlled camera state. Default basemaps are Carto
light/dark URLs; custom `styles` can be URLs or MapLibre style specifications.
Use `controls={null}` for a bare canvas or supply custom controls. Map children
can access the instance and load status through `useMap`.

`MapSectionLayout` owns sidebar/bottom-panel layout and sheet interaction.
`WorkspaceProvider` owns event scope, card stack, theme and bounds. Container
placement is the embedding default; choose `placement="viewport"` only for a
full-page experience. Share a provider only when the maps are intentionally
part of the same interaction workspace. The persistent-map entry point retains
one canvas above changing views; its lifetime is a host architecture decision.

Responsive presentation defaults to `responsive="container"`: workspace width
below `breakpoint` (768 pixels by default) uses mobile sheets, even on a wide
desktop page. `responsive="viewport"` retains page-wide breakpoint behavior.
Placement and responsiveness are independent controls. `toolbar` accepts an
explicit host toolbar element; `rootElement` supports host-owned sibling
content. Routine embedded maps should let the provider measure its own root.
Dialog portals inherit workspace theme/bounds; `onDialogOpenChange` lets the
host coordinate its own chrome without the toolkit searching the document.
Editorial and scene reading layouts follow the nearest provider's responsive
mode too. Their existing story-specific thresholds remain independent of the
configurable sheet breakpoint; a nested viewport workspace keeps page-wide
reading layouts inside a container-responsive parent.

Typed layers use `MapStyleValue<T>` for literals or MapLibre expressions,
`MapFeatureId` for string/numeric selection IDs and `MapFeatureClickHandler` for
typed selection callbacks. `selectedIds` accepts readonly lists; `filter={null}`
clears a layer filter. Focused supported layer subpaths under `/map/layers/`
are `fill`, `circle`, `line`, `raster`, `heatmap`, `pie-cluster` and `pmtiles-fill`.
Use `PieClusterPointProperties` to describe category counts in point GeoJSON.
`MapCircleLayer` accepts `hoverEnabled={false}` to dismiss hover cards during
external interactions such as marker dragging; cards also dismiss while the
map moves or a pointer button is held.

## Theme and styling

Component CSS is scoped to `.geo-toolkit`; consumers do not need PG Maps'
Tailwind configuration. `WorkspaceProvider` adds that class and its explicit
`data-theme`. Override CSS variables on the provider using `className` plus CSS
loaded after the toolkit stylesheet, or using its `style` prop.

```css
.geo-toolkit.my-map {
  --primary: 215 80% 35%;
  --primary-foreground: 0 0% 100%;
  --ring: 215 80% 35%;
  --radius: 0.75rem;
}
.geo-toolkit.my-map[data-theme='dark'] {
  --primary: 215 80% 70%;
  --primary-foreground: 215 50% 10%;
}
```

Theme color variables use **space-separated HSL channels**, not complete
`hsl(...)` strings. Supported UI roles are `--background`, `--foreground`,
`--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`,
`--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`,
`--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`,
`--destructive-foreground`, `--border`, `--input`, `--ring` and `--radius`.
Chart roles `--chart-1` through `--chart-5` are theme presentation colors and
must not serve as stable category identities.

Responsive and dark variants use CSS `@scope` to stop at nested workspace
boundaries. Plan for Chromium/Edge 118+, Firefox 146+, and Safari/iOS Safari
26.4+ for that feature. Safari 17.4–18.x also implements it, but Safari
26.0–26.3 has an input/textarea styling regression. These are CSS feature
requirements, not a claim that every browser version has been tested. See
[MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/scope.json).

Map fill/outline colors and donuts are controlled by data/props, independently
of UI tokens. Changing the UI theme does not automatically replace a palette.
Keep reviewed light/dark palette variants under host control. Editorial stories
use their own scoped `--editorial-*` roles and stylesheet; see
[story integration](src/stories/README.md).

## Project and story boundaries

The project entry point exports structural scene/layer types plus reusable
codec/repository interfaces and adapters. `createProjectCodec` takes a host
parser, ID function and optional transport preparation function.
`parseProjectJson` and `exportProjectJson` validate both imported content and
exported transport forms. `createMemoryProjectRepository` supplies an in-memory
adapter; `createWebStorageProjectRepository` accepts a host storage port and
explicit key. Repository `list/get/save/remove` operations are asynchronous and
accept optional cancellation. The synchronous `createProjectCollectionStore`
adapter supports apps with existing synchronous lists.

`importProjectFile` accepts any object with an asynchronous `text()` method.
`exportProject` and `shareProject` require host-provided export/share ports;
there is no default upload endpoint. `downloadProjectJson` is an opt-in browser
download adapter. Parsers, catalog normalization, storage namespaces, retention
limits and network authentication remain host configuration.

Native editorial JSON can be validated outside React using
`/stories/model/validate.mjs`.
`parseEditorialDocument` throws for invalid content;
`validateEditorialDocument` returns `string[]` errors (empty means valid).

`EditorialDocumentRenderer` provides native editorial content, actions,
category selection, tours and chapter presentation around host-supplied
`renderMap`, optional comparison and shell adapters. `SceneStoryRenderer`
provides scene reading layouts with a host `renderMap` callback and optional
chrome. Both keep data transports outside the renderer. The host retains its
tile policies, loading, selection details, catalog and URL/storage integration.
Supply stable map nodes instead of recreating the map instance at every step.

`/stories/storyScene`, `/stories/sceneController` and
`/stories/diagrams/storyDiagrams` are supported pure helper entry points for
camera fitting, category/legend resolution, scene-state transitions and diagram
layout. `/stories` also exports their functions for React consumers. The
current extraction provides validated JSON authoring and reusable rendering;
a visual project editor remains a separate capability. ArcGIS source-graph
adapters and PG Maps' full catalog orchestration stay host-owned.

## Versions and reuse

During local development, run `npm run toolkit:watch` from the host repository
alongside its dev server. The watch build updates package exports without
discarding the previous working build on a compilation failure; it does not
run PG Maps' dataset preparation. `npm run toolkit:watch:check` exercises that
recovery path. `npm run toolkit:pack:check` verifies the actual distributable
artifact, including pure entry-point imports and its dependency boundaries.

Pin a package version or reviewed artifact, build against its declarations and
exercise the standalone consumer before updating a production site. During
`0.x`, a minor release may change the supported API; patch releases should
preserve it. Keep host adapters at compatibility boundaries. Review changes to
calculation semantics, published thresholds and saved project formats explicitly
even when a TypeScript build succeeds. Other websites receive improvements when
they upgrade their dependency and rebuild.

The package carries the repository's existing MIT license with its contributor
notice. Dataset, tile-provider, imagery and third-party dependency licenses
remain those of their respective sources; package licensing does not grant
rights to external data.
