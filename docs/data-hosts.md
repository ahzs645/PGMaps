# Data hosts

`src/config/data-hosts.json` says which `public/data` folders are served from
somewhere other than the Pages site. With no hosts listed, as now, everything is
served from this site exactly as before.

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
   GitHub Pages and the R2 bucket behind `data.map.ahmad.sh` both do.
2. Add the folder to that host's `folders`.

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

- Prebuild scripts write derived files into some synced folders:
  `build-ui-data.mjs` (`ui`, `census/variables`, `bc-assessment`, `geocoding`),
  `build-census-north-south-dissolved.mjs` (`census/canada-csd`),
  `build-echoscreen-project-data.mjs` (`boundaries/BCFWA`, `health`),
  `build-aqmap-forecast-zones.mjs` (`aqmap`) and
  `generate-boundary-search-index.mjs`. Those files must be published with the
  folder, or the folder listed more narrowly.
- Browsers ignore the `download` attribute on a cross-origin link, so a dataset
  download link to a remote folder opens the file instead of saving it.
- The Vite dev server's own `/data/smoke`, `/data/recent`, `/data/meta`,
  `/data/plotting` and `/data/geomet` routes (`aqmapApiPlugin.ts`) are not
  synced folders; do not list them.
