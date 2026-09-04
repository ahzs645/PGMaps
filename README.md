# PGMaps

PGMaps is the frontend map app. Data scraper tooling and scraper-related source documentation live in the `bcdatamapper` submodule:

## Agent-native maps with WebMCP

The project catalog and its interactive workspaces expose page-scoped
[WebMCP](https://webmachinelearning.github.io/webmcp/) tools. In a compatible
browser, a person and an agent can work on the same live map: find and open a
project, move through story scenes, control layers, filter a research map, and
select a place for visual inspection.

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
interface in browsers without WebMCP. Tool registrations live in
`src/lib/projectWebMCP.ts`, with lifecycle support in `src/lib/webmcp.ts`.
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

The scraper inventory is documented in [vendor/bcdatamapper/README.md](vendor/bcdatamapper/README.md).

## Application updates and project catalog

Production builds publish their Git commit SHA for in-browser update detection, and the project catalog is generated with content revisions so additions, removals, and edits do not remain stale behind the service worker. See [Application updates, caching, and the project index](docs/app-updates-and-caching.md) for the cache policy, project commands, and deployment verification steps.

## Data source policy

See [BC Data Catalogue and ArcGIS Live Usage](docs/bc-data-live-usage.md) for guidance on using BC Data Catalogue records and BC-published ArcGIS REST services in PGMaps. In short: licences are often permissive with attribution, but live APIs have operational limits, so large or core datasets should usually be synced and cached instead of queried directly from the browser.

## Walkability generated assets

The walkability equation builder uses committed bit-packed factor masks so arbitrary weights and supported option changes can update quickly in the browser. See [Walkability Factor Masks](docs/walkability-factor-masks.md) for the build command, committed asset policy, and why this project-level note lives in `docs/`.
