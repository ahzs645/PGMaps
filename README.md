# PGMaps

PGMaps is the frontend map app. Data scraper tooling and scraper-related source documentation live in the `bcdatamapper` submodule:

## Agent-native maps with WebMCP

The project catalog and its interactive workspaces expose page-scoped
[WebMCP](https://webmachinelearning.github.io/webmcp/) tools. In a compatible
browser, a person and an agent can work on the same live map: find and open a
project, move through story scenes, control layers, filter a research map, and
select a place for visual inspection. Site-wide discovery tools can also open
Food Safety, air quality, census, Index Lab, boundaries, outdoors planning, and
other PGMaps experiences.

The Food Safety map adds a cross-dataset collaboration: an agent can filter
historical restaurant inspections, compare establishments by violations and
nearby mapped property-crime incidents, explain the radius, lookback, and
weighting used, then open the selected establishment and its inspection history
on the shared map. The ranking is explicitly exploratory context rather than a
guarantee of safety or food quality.

Try the deployed catalog at
[pgmaps.ahmadjalil.com/dev/projects](https://pgmaps.ahmadjalil.com/dev/projects).
ChatGPT's built-in browser supports these site tools. For local testing in
Google Chrome, enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome,
and run:

```bash
npm install
npm run dev
```

The implementation is a progressive enhancement: PGMaps keeps its full human
interface in browsers without WebMCP. Project registrations live in
`src/lib/projectWebMCP.ts`, site discovery in `src/lib/siteWebMCP.ts`, Food
Safety tools in `src/maps/foodmap/foodWebMCP.ts`, and lifecycle support in
`src/lib/webmcp.ts`.
The [challenge submission brief](docs/webmcp-challenge-submission.md) includes
the product story, implementation summary, demo script, and final checklist.

```text
vendor/bcdatamapper
```

Initialize submodules after cloning:

```bash
git submodule update --init --recursive
npm --prefix vendor/bcdatamapper install
```

The PGMaps npm data commands delegate into that submodule while keeping PGMaps as the working directory.

Deployable data snapshots live under the owning bcdatamapper source or scraper folders:

```text
vendor/bcdatamapper/datascrapers/*/output
vendor/bcdatamapper/data-sources/*/*/output
```

PGMaps hydrates its Vite static directory from those scraper-owned outputs before local dev and production builds:

```bash
npm run data:sync-from-bcdatamapper
```

GitHub Pages uses the clean variant before rebuilding generated datasets, so the deployed app still serves browser requests from `/data/...` without requiring PGMaps itself to own the bulky data files:

```bash
npm run data:sync-from-bcdatamapper:clean
```

Local runs reuse unchanged copies, UI datasets, EchoScreen layers, raster tiles and the boundary search index. Their input/output fingerprints live in the ignored `.vite/pgmaps-data` directory; changed inputs or missing/edited outputs regenerate automatically. Use `npm run data:build-ui -- --force` or `npm run boundaries:search-index -- --force` to explicitly rebuild those derived datasets. The clean sync still assembles a fresh deployment tree while preserving app-owned data.

The PM2.5 raster tile archive remains in `vendor/bcdatamapper`; deployment includes the extracted tiles.

The scraper inventory is documented in [vendor/bcdatamapper/README.md](vendor/bcdatamapper/README.md).

## Application updates and project catalog

Production builds publish their Git commit SHA for in-browser update detection, and the project catalog is generated with content revisions so additions, removals, and edits do not remain stale behind the service worker. See [Application updates, caching, and the project index](docs/app-updates-and-caching.md) for the cache policy, project commands, and deployment verification steps.

## Data source policy

See [BC Data Catalogue and ArcGIS Live Usage](docs/bc-data-live-usage.md) for guidance on using BC Data Catalogue records and BC-published ArcGIS REST services in PGMaps. In short: licences are often permissive with attribution, but live APIs have operational limits, so large or core datasets should usually be synced and cached instead of queried directly from the browser.

## Walkability generated assets

The walkability equation builder uses committed bit-packed factor masks so arbitrary weights and supported option changes can update quickly in the browser. See [Walkability Factor Masks](docs/walkability-factor-masks.md) for the build command, committed asset policy, and why this project-level note lives in `docs/`.

## Transit travel times

`/dev/transit` combines BC Transit schedules and City of Prince George street/path
data with a live travel-time heatmap, draggable origins, journey details and
shared views. See the [map guide](docs/dev-transit.md) and
[pipeline and city-adaptation guide](docs/transit-pipeline.md) for source ownership,
rebuilding, coverage checks and the configuration refactor needed for other cities.

## Terrain viewshed

`/dev/viewshed` adds live terrain visibility from a movable observer to the Dev
Library, using MapLibre and the existing PGMaps terrain/sightline code. It runs
on key-free overview tiles or a locally imported BC DEM. See the
[viewshed guide and BC terrain sources](docs/dev-viewshed.md).
