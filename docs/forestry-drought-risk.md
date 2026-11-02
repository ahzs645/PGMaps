# Forestry drought risk: published explorer and browser calculator

`/dev/forestry/drought-risk` exposes two separate workflows in the forestry tools
library. Both execute in the browser, with no application server or climate-file
upload. The published table loads as a versioned static asset. The custom model
and its parser execute in a cancellable Web Worker loaded with the route.

## Browser forks and integration

| Project | Responsibility | Browser app |
| --- | --- | --- |
| [ahzs645/forDRAT](https://github.com/ahzs645/forDRAT) | Published results, exact parser, static explorer | [Published explorer](https://projects.ahmadjalil.com/forDRAT/) |
| [ahzs645/forestDroughtTool](https://github.com/ahzs645/forestDroughtTool) | Reusable TypeScript engine, original R reference, static calculator | [Custom calculator](https://projects.ahmadjalil.com/forestDroughtTool/) |
| PGMaps | Forestry navigation, shared UI, charting, worker lifecycle and map-link handoff | `/dev/forestry/drought-risk` |

Both forks retain the original repository history, source files and Apache-2.0
attribution. Each adds `web/` source and a deterministic `docs/` static build.
They require only TypeScript at build time and no npm runtime packages. PGMaps
mirrors the same pure TypeScript files, with immutable fork revisions and file
hashes recorded in `scripts/forest-drought/forks.lock.json`.

Verify the mirror before changing its pin:

```sh
node scripts/forest-drought/verify-fork-snapshots.mjs
node scripts/forest-drought/verify-fork-snapshots.mjs --remote
```

The first command is offline; the second also compares the exact pinned remote
bytes. Edit a shared calculation or parser in the corresponding fork, validate
and publish it, then update PGMaps' snapshot and lock deliberately. Do not allow
two independent implementations to drift. PGMaps-specific React components and
tests are not part of the fork snapshot. These specialized forestry methods do
not belong in the generic geo-toolkit.

## Published results

The immutable upstream source is
[`bcgov/forDRAT` at `ac51aafe`](https://github.com/bcgov/forDRAT/tree/ac51aafe7b66d039c990964a9acd809a2ea73848).
It contains a published CSV, not an implementation of its calculation workflow.
We preserve its 338,744 bytes and original classifications. The complete grid
has 6,120 unique rows: 204 BGC units × six periods × five soil moisture regimes.
Each row includes an AET/PET ratio and ten species' L/M/H/VH risk ratings.

The page requires an explicit BGC and soil selection. It provides a searchable
selector, species display filter, period comparison chart, full-precision ratio
table, species risk matrix, and comparison across soil regimes. CSV exports
retain all periods and species regardless of visual filters; the UI says so.
The original source and a provenance record can also be downloaded.

| Source period | Interpretation |
| --- | --- |
| 1961–1990, 1971–2000, 1981–2010 | Three historical reference periods |
| 2020 | Projection for 2011–2040 |
| 2050 | Projection for 2041–2070 |
| 2080 | Projection for 2071–2100 |

The older README omits 1971–2000 and calls the last anomaly period 2070 in one
place. The app preserves the CSV's six actual labels and records the discrepancy.
These are regional mature-forest/interior-species estimates using BEC v11 and
the stated ClimateBC 6.21 RCP4.5 ensemble preparation. A low rating does not
establish local species presence, planting suitability, regeneration success,
or current drought conditions. Sites wetter than subhygric are outside scope.

The complete dataset is validated before rendering: checksum, schema, number
of rows, all combinations, duplicate keys, finite ratios, soil labels and risk
codes. A mismatch withholds results and offers a retry. No runtime fallback
scrapes or reclassifies the source.

`public/data/forest-drought` is an app-owned, pinned reference snapshot,
explicitly preserved by `data:sync-from-bcdatamapper --clean`. It is not a new
scraper output. Recheck or restore it with:

```sh
node scripts/forest-drought/prepare-published.mjs --check
node scripts/forest-drought/prepare-published.mjs --from /path/to/forDrat.csv
```

## Custom calculations

The [model contract](forest-drought-model.md) describes equations, units, exact
soil parameters, deliberate wrapper changes and numerical limits. The user can
import a local daily CSV, select the original 50°/55°/60° latitude table, edit
the five soils, choose a summary policy and compare a temperature/precipitation
sensitivity adjustment. The standalone fork additionally accepts a JSON array
of twelve-month anomaly sets. The shared API supports up to nine scenarios.

Outputs include daily water balance, calendar-month and yearly summaries,
legacy ASMR classes, CSV downloads and reproducible JSON. Daily-average AET/PET
and total AET divided by total PET remain distinct quantities. The synthetic
example is labelled as a demonstration. Neither it nor user-defined anomalies
are presented as observed Prince George weather or official climate scenarios.

Changing climate or model settings invalidates old results immediately. Cancel
terminates the worker, and generation identifiers prevent late workers or file
reads from replacing newer inputs. Invalid data fail before calculation. Limits
bound CSV size, day count, number of scenarios and combined soil-day work.

The port intentionally does not silently reproduce the older cleaner's
`mean(ppt2,ppt3)` issue, join disconnected sampled years, or mix different summary
weights between baseline and future runs. Missing weather needs explicit
preprocessing. The old `bgcClim` forecast table and automated weather download
are not bundled as browser forecasts. Original data and R code remain available
in the fork; custom monthly-normal/anomaly and deterministic year-selection
helpers are exposed through the TypeScript API.

## Map handoff

A map or another PGMaps page may link to:

```text
/dev/forestry/drought-risk?bgc=SBSmk1&smr=4&period=2050
```

Only exact published BGC identifiers resolve; variant suffixes and case are
preserved. Soil and period parameters are validated, and a query change replaces
the selection atomically. Omit `smr` when it has not been assessed: the tool
requires the user to choose it. A matching identifier from a newer BEC map does
not verify boundary equivalence with BEC v11. This release does not draw or
infer verified BEC v11 site boundaries, and it does not derive soil regime from
BGC or from an arbitrary clicked map location.

## Evidence and checks

The [recorded R comparison](forest-drought-r-validation.json) covers 15 synthetic
cases, 7,680 daily rows and 84,501 scalar comparisons against the unchanged R
kernel, all at scaled tolerance 1e-10. Maximum scaled difference was about
4.19e-14. This validates tested daily numerical behavior, not ecological
prediction or equivalence of every older wrapper. The fork's CI runs R and the
compiled TypeScript implementation again on changes.

PGMaps' focused workflow verifies the pinned source and snapshots and serves
the actual production build. An unmocked delivery case checks the CSV's response
and checksum, production service-worker reload and the compiled worker; the
remaining cases exercise published selection/exports, corrupt-data recovery,
local input errors and phone layout. The CSV cache key includes its source hash
so an older snapshot cannot shadow a new pin. See the
[loading and deployment audit](forest-drought-loading-audit.md) for HTTP/CORS
observations and deployment constraints. Unit tests cover the data grid,
calculations, runtime input validation and linked selection.

```sh
npx vitest run src/features/forest-drought src/pages/forest-drought/query.test.ts
npx tsc --noEmit -p tsconfig.json
npx vite build
# In another terminal, serve dist/: npx vite preview --host 127.0.0.1 --port 42173
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 PGMAPS_E2E_PRODUCTION=1 npx playwright test tests/e2e/forest-drought.spec.ts
```

The measured ten-year, nine-scenario synthetic calculation took 274 ms under
Node v24.22.1 in development. This is not a mobile-browser guarantee. The work
budget and worker preserve responsiveness without introducing Rust/Wasm for
this workload. The standalone apps need an initial static download; they do
not currently promise offline reload or background synchronization.
