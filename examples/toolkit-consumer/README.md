# Standalone toolkit consumer

This small React website imports only the public `@pgmaps/geo-toolkit` package.
It has no PG Maps source aliases, routes, datasets, theme provider, or data-build
steps. All observations and places are fictional. Basemaps use local background
styles so no external map services or credentials are needed.

From the repository root:

```sh
npm run toolkit:build
npm run dev --workspace @pgmaps/toolkit-consumer
npm run build --workspace @pgmaps/toolkit-consumer
npm run test:browser --workspace @pgmaps/toolkit-consumer
```

The example exercises the reusable Index Lab controller, metric library, weight
editors, method controls and results with an injected local catalog and comparison
universe. Its 0–100 results are normalized to 0–1 for the shared map scale and
legend. It also renders a lossless classified source grid (including missing and
uncertain cells), reusable donuts, map donut markers, category diagrams and
carousel slots. Map workspaces own their mobile feature cards, respond to their
container widths and support theme changes without replacing their map canvases.

The scene-project example uses `SceneStoryRenderer` with a host-owned inline-data
map adapter. Its repository and JSON export transport are injected; switch
between the provided memory and browser-storage adapters to save/load a title,
download the project JSON or import it again. The host validates its own schema
through the shared codec interface. The separate native editorial document uses
`EditorialDocumentRenderer`'s complete default shell with chapters and narrative
actions for category selection, map-view changes and chapter navigation. Its
declared GeoJSON source is provided at `public/example/habitat-grid.geojson`.

The browser tests verify actual MapLibre layer/source state, live score updates,
search preserving the normalization universe, container resizing, theme changes,
mobile card isolation, scene navigation, storage persistence, JSON round trips,
and the editorial renderer's default shell. Build the toolkit before running
them. In an environment with system Chromium, set
`PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium` when running browser tests.

When the toolkit moves to another repository, replace the workspace dependency
with its published version or local package tarball. No source imports need to
change.
