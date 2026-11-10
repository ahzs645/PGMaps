# Data hosts

`src/config/data-hosts.json` says which `public/data` folders are served from
somewhere other than the Pages site. With no hosts listed, everything is served
from this site.

## Current hosts

| Host           | Base URL                                            | Folders                                                                                  |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bcdatamapper` | `https://projects.ahmadjalil.com/bcdatamapper/data` | `canada-admin`, `cciss`, `census`, `citypg`, `drought`, `forest`, `network-availability` |

bcdatamapper publishes these from its own repository
(`vendor/bcdatamapper/docs/pages-site.md`). Its `pages/site.json` is the one
list of how they are laid out: the sync reads it for local runs instead of
keeping its own copy. The first six took about 400 MB (compressed) out of the
Pages build; `census` is another 265 MB uncompressed.

That site is at 819 MB of GitHub Pages' 1 GB limit, which its build enforces.
`boundaries` (205 MB) does not fit beside it, so the next large folder needs
another host or room made there first.

### Versions

Pages serves one version of the bcdatamapper site: the last publish. A data push
to bcdatamapper `main` reaches the live app without a PGMaps deploy, so the
submodule pointer no longer pins these folders. It records the data PGMaps was
last checked against.

The deploy runs `scripts/check-data-hosts.mjs`, which:

- **fails** if a host's `version.json` cannot be read, or does not list a folder
  the app sends there;
- **warns** if the live bcdatamapper folders differ from what the pinned
  submodule would publish. It compares the per-folder fingerprints from
  `pages/site.mjs`, not commit IDs, so an unrelated bcdatamapper commit does not
  trigger it.

On that warning, either move the pointer forward (the live data is right), or
roll the site back: in bcdatamapper, run **Publish data site** by hand with the
pinned commit as `ref`. Run the check locally with
`node scripts/check-data-hosts.mjs`.

Playwright's dev server sets `VITE_DATA_HOSTS_LOCAL=1`, so e2e runs use the
synced snapshots, not the live host.

The app asks for every data file as `/data/<folder>/...` and resolves it through
`withBase` (`src/lib/dataUrl.ts`). A folder listed under a host resolves to that
host's `baseUrl` with the same layout below it:

```json
{
  "hosts": [
    {
      "name": "bcdatamapper",
      "baseUrl": "https://projects.ahmadjalil.com/bcdatamapper/data",
      "folders": ["canada-admin", "census"]
    }
  ]
}
```

With that file, `/data/census/catalog.json` loads from
`https://projects.ahmadjalil.com/bcdatamapper/data/census/catalog.json`, and
`/data/boundaries/...` stays on this site.

A folder can be a top-level folder (`census`), a sub-folder
(`canada/cell-sites`) or a single file (`restaurants.json`). Matching is by whole
path segments, so `census` does not take `census-old`. `src/lib/dataHosts.test.ts`
rejects the file if a folder is listed twice, sits inside another host's folder,
or a `baseUrl` is not an absolute http(s) URL.

## Moving a folder

1. Publish the folder at `<baseUrl>/<folder>/` with the same layout it has in
   `public/data`, including anything PGMaps' prebuild scripts write into it (see
   below). The host must send `Access-Control-Allow-Origin` for the app's origin;
   GitHub Pages and the R2 bucket behind `data.map.ahmad.sh` both do. For
   bcdatamapper, add it to `pages/site.json` there
   (`vendor/bcdatamapper/docs/pages-site.md`) and remove its mappings from
   `scripts/sync-bcdatamapper-data.mjs` here.
2. Add the folder to that host's `folders`. `src/lib/dataHosts.test.ts` checks
   that bcdatamapper publishes every folder listed for it.

That is the whole change on the PGMaps side:

- `scripts/sync-bcdatamapper-data.mjs` stops copying the folder into
  `public/data` and removes a copy left from an earlier sync, so it leaves the
  Pages build. It refuses a folder that covers an app-owned path
  (`appOwnedDataPaths`), because no scraper host publishes those.
- The deploy's data cache key includes the config file, so the next deploy
  rebuilds `public/data` without the folder.
- The service worker gives the host's files the same cache rules as `/data` on
  this site; `main.tsx` passes the host origins in the registration URL.

To try a bcdatamapper change locally before it is published, run with
`VITE_DATA_HOSTS_LOCAL=1`. The sync then copies every folder and the app reads
them all from `public/data`.

## Writing data requests

Fetch data through `fetchJson`, `fetchBytes` or `fetchGzipText`
(`src/lib/fetchJson.ts`), which apply `withBase`. A URL handed to something that
fetches it itself (MapLibre `data` or `tiles`, deck.gl, a worker, an `<a href>`)
must go through `withBase` first; a bare `'/data/...'` there always loads from
this site. Do not build data URLs from `import.meta.env.BASE_URL` either:
`withBase('/data/...')` already adds the deploy base. `withBase` is idempotent,
so resolving an already-resolved URL is harmless.

## What a remote folder changes

- A remote folder is not in `public/data` during a build. No PGMaps script
  writes into a synced folder, and the deploy only copies what bcdatamapper
  commits, already built. Three things still read synced folders from disk:
  - Build scripts. `generate-boundary-search-index.mjs` reads `boundaries`,
    `census` and `walkability`; `build-ui-data.mjs` reads `geocoding`,
    `restaurants.json`, `bc-assessment` and `census/variables`. Both write only
    the app-owned `boundary-search` and `ui`. The index resolves every input
    with `createDataSourceResolver` (`scripts/lib/data-source-path.mjs`), which
    returns the submodule's copy of anything in bcdatamapper's
    `pages/site.json`; `build-ui-data.mjs` names the submodule path of its one
    census file. Do the same for the next folder that moves.
  - Unit tests. A test that opens a moved folder's file reads the submodule
    (`src/maps/project-story/testing/readStoryData.ts` for story layers), so
    the suite passes after a normal sync.
  - bcdatamapper's own builds. `bc-assessment:build` reads that repository's
    census and boundary snapshots, not `public/data`.
- `build-aqmap-forecast-zones.mjs` copies bcdatamapper's forecast zones into
  `aqmap`, which is why that folder needs its copy published with it.
- In development, `DevBoundaries` looks for dissemination-block chunks under
  `/data/census/bc-db-chunks`, which now resolves to the host and is not
  published there. Run with `VITE_DATA_HOSTS_LOCAL=1` to use locally built
  chunks. Production reads them from `data.map.ahmad.sh` as before.
- Browsers ignore the `download` attribute on a cross-origin link, so a dataset
  download link to a remote folder opens the file instead of saving it.
- The Vite dev server's own `/data/smoke`, `/data/recent`, `/data/meta`,
  `/data/plotting` and `/data/geomet` routes (`aqmapApiPlugin.ts`) are not
  synced folders; do not list them.
