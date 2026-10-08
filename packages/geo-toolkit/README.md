# Geographic toolkit

`@pgmaps/geo-toolkit` is the local, package-owned foundation used by PG Maps.
Its implementations live here; the old application paths are compatibility
exports or host adapters. It is private while its public API is being exercised.

## Build and use

From the repository root:

```sh
npm install
npm run toolkit:build
npm run toolkit:check
npm run toolkit:pack:check
npm run toolkit:example
```

The package also builds independently with `npm install && npm run build` in
this directory; `npm test` runs its independent package tests. Building requires TypeScript and Tailwind, not PG Maps data,
Vite plugins, a router, scraper submodules, or the PG Maps application.
The output includes ESM, declarations, CSS, native validators and the loader worker.

For development, run `npm run toolkit:watch` in a second terminal alongside the
host or example dev server. Changes rebuild compiled exports automatically;
failed builds retain the last working output, and successful builds remove
obsolete exports. `npm run toolkit:watch:check` verifies this recovery path.

```tsx
import { Map, MapFillLayer } from '@pgmaps/geo-toolkit/map'
import { MapSectionLayout, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace'
import { MapSidebarShell } from '@pgmaps/geo-toolkit/ui'
import '@pgmaps/geo-toolkit/styles.css'

export function EmbeddedMap({ features }) {
  return (
    <div style={{ height: 520 }}>
      <WorkspaceProvider theme="light">
        <MapSectionLayout sidebar={<MapSidebarShell title="Places">Your controls</MapSidebarShell>}>
          <Map center={[0, 0]} zoom={2} theme="light">
            <MapFillLayer data={features} fillColor="#38bdf8" />
          </Map>
        </MapSectionLayout>
      </WorkspaceProvider>
    </div>
  )
}
```

Map tiles remain caller-configurable. Import `stories/styles.css` for editorial
presentations. A workspace supplies scoped theme variables and interaction state;
use one provider per independent map experience. Standalone maps create a private
provider automatically. Host a persistent map above the views that share it.

## Entry points

| Entry | Responsibility |
| --- | --- |
| `/calculations` | Generic scoring, geometry and timeline changes; no React or map engine |
| `/index-lab` | Live Index Lab normalization, weighting, coverage and spatial/derived metric recipes |
| `/index-lab/react` | Configurable metric library, weight controls, ranked results and isolated state/controller |
| `/scales` | Palette sampling, classification, colors and exact serializable legend definitions |
| `/visualizations` | Donut SVG generation independent of a map |
| `/grids` | Source-pixel decoding, grid classification and optional deck.gl grid rendering |
| `/map` | MapLibre rendering, layers, markers, controls, source ownership and camera helpers |
| `/map/persistent-map` | Optional persistent canvas/provider integration |
| `/map/map-deck` | Optional deck.gl integration |
| `/workspace` | Responsive layout, scoped events, card stacks and media-query hooks |
| `/ui` | Sidebars, legends, dialogs, lists, tooltips, tabs and supporting controls |
| `/projects` | Serializable scene/layer contracts, validated JSON import/export and injectable repositories/share/export ports |
| `/projects/react` | Scene story rendering through supplied layer, map and host adapters |
| `/stories` | Complete native editorial presentation through supplied map/comparison adapters, reusable components and diagrams |

Fine-grained subpaths also support application compatibility imports. These are
provisional; prefer documented entry points in new consumers. Install the optional
React, MapLibre or deck.gl peers when using the corresponding modules.
See [API.md](API.md) for the supported surface, examples, styling and dependency
boundaries, and [RELEASING.md](RELEASING.md) for versioning and release checks.

## Semantics

Calculation normalization and display classification are separate. A resolved
scale and its `createScaleLegend` definition share exact breaks and missing-value
semantics; `ScaleLegend` renders their actual numeric intervals. Zero is valid.
Published source categories and thresholds remain supplied by the host.
Grid types retain original RGBA evidence, uncertain classifications and no-data
cells. Larger display cells do not add measured source detail.

The Index Lab adapter preserves its existing tie, coverage and method behavior;
the generic record scorer is a separate API. They are not silently substituted
for each other. Domain methods and source-specific catalogs remain host-owned.

## Current extraction boundary

PG Maps still owns datasets, specialized formulas, full application navigation,
project catalog normalization, source adapters, storage keys and report formats.
The reusable Index Lab UI receives metric definitions and a compute callback;
its engine does not choose a domain's scoring policy. Editorial and scene
renderers receive map/data adapters instead of fetching PG sources. Memory and
Web Storage repositories implement the generic persistence contract; a host can
supply remote storage, sharing and export transports. Full source-specific
explorer orchestration and a visual project authoring editor remain outside this
package. Raster block transport and router URL integration stay host-owned.

Embedded workspaces use their container width and container placement by default.
The mobile breakpoint is configurable. PG Maps adapters explicitly retain
viewport responsiveness/placement and the legacy navbar/window-event bridge.
Responsive utility styles use CSS `@scope` so nested workspaces remain independent;
use a modern browser with `@scope` support. See API.md for responsive options.

## Moving to a separate repository

Move this directory, including its build configuration, tests and documentation,
to the toolkit repository. Keep its package name and entry points. Publish a
version or use a packaged artifact, replace PG Maps' local workspace dependency,
and remove the toolkit workspace/source test aliases. PG Maps adapters, source
data, project catalogs and deployment preparation stay in PG Maps.
See `docs/toolkit-extraction.md` in the host repository for the verification gates.
