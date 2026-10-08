# Stories and project contracts

These modules physically own the shared editorial presentation, document contract,
validation and diagram behavior. PGMaps imports them through compatibility exports;
there is no second implementation in the application.

## Portable authoring

Import `NativeEditorialDocument` from `@pgmaps/geo-toolkit/stories/model/types`
and `parseEditorialDocument` / `validateEditorialDocument` from
`@pgmaps/geo-toolkit/stories/model/validate.mjs`. The validator also works in ordinary
Node ESM scripts without React, a DOM, Vite or PGMaps data. `parseEditorialDocument`
throws an error listing invalid content; validation returns errors for review.

The existing `pgmaps-editorial-v1` schema name is preserved for compatibility.
Its data is not limited to PGMaps: a host supplies category registries, source URLs,
map definitions, camera views, prose, diagrams and actions. TypeScript scene/layer
contracts live in `@pgmaps/geo-toolkit/projects/storyTypes`. Runtime normalization
of the PGMaps catalog envelope remains in the app; the toolkit does not invent
catalog metadata, storage behavior or source adapters.

## Compose a reading experience

Use `@pgmaps/geo-toolkit/stories/components/index` for covers, chapter navigation,
carousels, scroll sidecars, photo tours and expandable media. Content and map
slots are React nodes or render callbacks supplied by the host. Category selection,
chapter navigation and map actions are host-owned; diagrams communicate through
`onSelect`. Import `@pgmaps/geo-toolkit/stories/styles.css` once. Its selectors are
scoped to editorial/story diagram classes and it includes diagram styles.

Create a bounded `.editorial-story` scrolling container, pass its ref as
`scrollRoot`, and set `--editorial-viewport` to the measured container height.
Keep map nodes stable across steps. Set `data-theme="dark"` on the container or
use an ancestor `.dark` class; override the `--editorial-*` palette variables for
branding. The host owns its header spacing, navigation buttons and map popup CSS.

`stories/storyScene` exposes camera pane fitting, category paint, highlights and
legend derivation. Optional transports supply `buildLegend`'s `layerLegend`
callback; the package does not import PGMaps' climate manifest adapter.

## Implemented boundaries

- `SceneStoryRenderer` provides panel, scrolly, slides and sidecar reading UI
  with a persistent host `renderMap` surface, scene navigation, linked choices,
  layer toggling/reset, legends and map-action state. Slides retain all cards for
  stable height. PGMaps consumes the shared controller, scene cards and complete
  sidecar presentation while retaining specialized native transport orchestration.
- `EditorialDocumentRenderer` owns complete validated native editorial content,
  category selection, view actions, chapter actions, map-region lifecycle,
  docked/floating scroll sidecars, galleries, tours and data-driven diagrams.
  It accepts `renderMap`, `renderComparison` and optional `renderShell` adapters.
  PGMaps uses that renderer with its own native map transport and comparison
  synchronization/picking adapters. The native editorial
  validator supports GeoJSON polygon/point and polygon PMTiles maps. Climate-grid
  transports and editorial slideshow sidecars are not part of this document
  contract; use native scene stories for those capabilities.
- ArcGIS imported documents retain their source graph adapters and service handling
  in PGMaps. They consume the same portable presentation components, but are not
  converted into invented native document data.
- A visual project editor is a separate future capability. This extraction provides
  validated JSON authoring and composable UI, not a new editor.

Radial diagrams require a real acyclic parent-child tree. Category dots preserve
input coordinates and distinguish measured from illustrative data; category
highlighting does not alter a step's denominator. Legend categories and map paint
share the authored category definition. Palette changes do not change calculation
results.

## Project storage and export

`@pgmaps/geo-toolkit/projects` is a pure, framework-independent entry point for
`ProjectCodec`, asynchronous `ProjectRepository`, collection storage, JSON
import/export and share/export ports. A codec supplies the host schema parser and
project ID; its optional `prepareExport` strips host runtime fields. Memory and
WebStorage repositories provide working implementations, including independent
snapshots, replacement by ID, bounded collections and cancellation checks. Async
storage failures reject; a host can choose its own fallback policy.

Use `@pgmaps/geo-toolkit/projects/react` for the optional renderer/controller
convenience exports or import directly from `/stories`. Pure document types,
validation, defaults and the scene reducer also have `/stories/contracts`.
Export/share destinations are injected and are never contacted implicitly. PGMaps
retains its parser, catalog metadata, local key and synchronous session fallback
while delegating storage and JSON file transport to these generic APIs.
