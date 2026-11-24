# Application updates, caching, and the project index

PGMaps is a Vite single-page application deployed to GitHub Pages. It needs to balance three things:

1. an open tab must discover a deployed build without querying GitHub;
2. mutable catalogs and manifests must not remain stale behind the service worker;
3. hashed application assets and large map data should still benefit from caching.

## Deployed-version detection

`@plugin-web-update-notification/vite` stamps each production build with the short Git commit SHA. Vite emits:

```text
dist/pluginWebUpdateNotice/web_version_by_plugin.json
```

The same SHA is embedded in the plugin's generated browser script. The browser fetches the deployed version file and compares the two values. A mismatch means that a newer build has reached the hosting environment; it does not merely mean that a commit exists on GitHub.

The production client checks:

- immediately after loading;
- every five minutes while the page is visible;
- when the window regains focus or visibility;
- after a JavaScript or stylesheet load error;
- when `window.pluginWebUpdateNotice_.checkUpdate()` is called manually.

The plugin's default UI is disabled. `src/updates/useAppUpdate.ts` listens for `plugin_web_update_notice`, and `src/updates/AppUpdateNotice.tsx` shows it as a `Notification` in the app's shared notification stack (see [shared UI](shared-ui.md#floating-notifications)). Choosing **Later** suppresses that deployed version while still allowing a later commit to notify the user. Choosing **Reload** preserves the current route, query, and fragment while adding a fresh `_update` query value so GitHub Pages and intermediate caches must resolve the navigation again.

The version endpoint is always network-only in `public/sw.js`. The plugin also adds a timestamp to its request. Both protections are intentional: a cached version response would make the update detector ineffective.

## Service-worker update lifecycle

Production registers the base-relative `sw.js` with `updateViaCache: 'none'` and immediately calls `registration.update()`. If the worker source changed, `skipWaiting()` and `clients.claim()` activate it without waiting for every old PGMaps tab to close. Base-relative registration and precache URLs keep this working for both the custom-domain root deployment and a Vite subpath deployment.

The service worker becoming active does not replace JavaScript already executing in a tab. The deployed-version notification remains responsible for asking the user to reload the page.

Development unregisters service workers so cached production resources cannot interfere with Vite's development server.

## Cache policy

| Resource                                                       | Strategy                                                  | Reason                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| HTML navigation                                                | Network first, cached `/index.html` fallback              | New deployments should resolve their newest hashed assets; the app remains available offline. |
| Plugin version JSON                                            | Network only with `no-store`                              | Version checks must never be satisfied by Cache Storage or the HTTP cache.                    |
| Project index                                                  | Network first with `no-store`, canonical offline fallback | Additions and removals must be visible whenever the Projects UI loads.                        |
| Revisioned project packages                                    | Cache first                                               | The index changes the package URL whenever file contents change.                              |
| `manifest.json`, `index.json`, `catalog.json`, `metadata.json` | Network first with revalidation                           | These are mutable pointers to snapshots.                                                      |
| Everything under Vite's `/assets/`                             | Cache first                                               | Vite filenames are content hashed, whatever the extension.                                    |
| Other local static and data files, GeoTIFFs included           | Stale while revalidate                                    | Existing map data renders quickly and refreshes in the background.                            |
| Terrain and basemap tiles from the listed hosts                | Kept copy while fresh, then network, then the kept copy   | A map already looked at draws with no network. See **Third-party tiles**.                     |
| A request with a `Range` header                                | Left to the browser                                       | A partial response cannot be stored, and a stored whole file must not answer a range.         |

The hashed-asset rule matches the folder, not a list of extensions. An earlier rule matched only `.js` and `.css`, which left out MapLibre's worker (`maplibre-gl-worker-*.mjs`), the WebAssembly files and the fonts: offline, every map waited on "Loading map data" for ever.

Every lookup ignores the response's `Vary` header (`ANY_VARIANT`). A `crossorigin` script or stylesheet sends an `Origin` header even to its own site, and a server that answers `Vary: Origin` (Vite's preview does) then hides a stored file from it.

The worker owns four cache families: `pgmaps-shell-`, `pgmaps-data-`, `pgmaps-tiles-` and `pgmaps-offline-state-`. Activation deletes superseded versions of those and nothing else. Other code keeps caches under `pgmaps-` too (`pgmaps-terrarium-png-v1` for terrain tiles, `pgmaps-photo-depth-v1` for the downloaded depth models); deleting by the bare prefix discarded both each time `sw.js` changed. Never name another module's cache inside one of the four families.

## Offline tools

The road designer, the visual quality page and the block planner open with no network after one online visit. Two things make that true.

**The build lists what each tool needs.** `scripts/offline-precache-plugin.ts` writes `offline-precache.json` beside `sw.js`:

- the **shell**: what `index.html` loads before any page mounts, the workers a shell file starts later, and the files the page names from `public/` (`shellExtras`);
- one **group** per tool: every built file the tool can reach, lazily loaded ones included, and the files it reads from `public/` by address (`extras`, e.g. the road designer's `workspace-layouts.json`). A dialog never opened online is a chunk never fetched, so a cache filled only by what a visit happened to load cannot open it offline.

A file from `public/` has no hash in its name. The worker keeps it in the data cache, where its own fetch rule keeps it, and fetches it again whenever the manifest's `build` changes; `build` covers a digest of each such file's bytes.

The lists are generated from the bundle (`src/lib/offline/precacheManifest.ts`, DOM-free); never write a file name by hand. A group stops at the shell, because the shell's lazy references are every page in the app. The build fails when a group's roots match no built file, which is what a renamed page would otherwise do silently.

**The page asks, the worker fetches.** A tool's page calls `useOfflineTool('<id>')` (`src/lib/offline/offlineTools.ts`). A few seconds after it mounts, the service worker fetches every file of the group it does not hold and records the tool as kept. `main.tsx` asks again on every page load without naming a tool, so a later build's files are fetched for the shell and every kept tool without the tool being opened; the worker itself only changes when `sw.js` does. The same pass stores the `index.html` that names those files, so the offline fallback is never the page from the day the worker was installed. Nothing is fetched ahead when the browser's data saver is on.

To make another tool work offline, add a group to `offlinePrecache` in `vite.config.ts` and one `useOfflineTool` call to its page.

What "offline" covers:

- The code, every export and dialog, and the project or scene kept in this browser.
- Terrain and basemap tiles that were viewed online (see below).
- The road designer's own terrain: a project carries its imported terrain, a project on the published LiDAR sample reads the stored GeoTIFF, and one on regional terrain reads the stored tiles.

What it does not cover:

- Visual quality's inventory, vegetation and viewpoint reads, by default. They are read live from DataBC with no stored copy (`docs/forestry-visual-quality.md`), so a run needs a connection, unless the person turns on **Inventory copies** (below).
- Satellite imagery, and every other DataBC, NRCan and Sentinel read in the road designer.
- The block planner's DataBC reads: the order's unit, past harvests and fires, and the old-forest reads (VRI, OGMAs, parks, corridors). What a read returns is kept with the plan, so a plan whose unit and baseline were read online opens and calculates offline. The old-forest reads are kept only for the session, but their result travels with the plan (`docs/forestry-old-forest.md`).
- Files over the precache limit, which are kept the first time they are used online and listed as `deferred` in the manifest.

| Limit | Value | Constant |
| --- | --- | --- |
| Largest file fetched ahead | 6 MB | `OFFLINE_MAX_FILE_BYTES`, `vite.config.ts` |
| Shell JavaScript and CSS | 1.5 MB raw, 420 KB gzipped (the build fails above either) | `SHELL_BUDGET`, `vite.config.ts` |
| Files fetched at once | 4 | `PRECACHE_LANES`, `public/sw.js` |
| A built file no list names is dropped after | 30 days | `STALE_ASSET_MS`, `public/sw.js` |
| Delay before a tool's files are asked for | 4 s | `START_DELAY_MS`, `offlineTools.ts` |
| Delay before the refresh on every load | 8 s | `OFFLINE_REFRESH_DELAY_MS`, `offlineTools.ts` |

Measured on 18 November 2026: the shell is 44 files, 0.99 MB (0.26 MB gzipped); the road designer's group is 368 files, 20.6 MB (7.5 MB gzipped), 16 of them from `public/`; visual quality's is 190 files, 10.9 MB (5.1 MB gzipped); 136 files (4.3 MB, 1.4 MB gzipped) are in both and fetched once. Deferred: `whitebox-cli` (16.8 MB) for the road designer and the ONNX runtime (11.4 MB) for visual quality.

The shell budget exists because the shell is downloaded by every visitor to every page before anything draws, and one static import in the wrong file moves a whole library into it with no error anywhere.

## Third-party tiles

`TILE_HOSTS` in `public/sw.js` lists the map tile hosts whose responses are kept after they are viewed:

| Host | Fresh for | Why |
| --- | --- | --- |
| AWS Terrain Tiles (`s3.amazonaws.com/elevation-tiles-prod`) | 90 days | Open data, and S3 sends no `Cache-Control`. MapLibre's 3D terrain, hillshade and contours ask for these directly, outside the terrain loader's own store. |
| CARTO basemap (`*.cartocdn.com`) | 7 days | Style, sprite, glyphs and vector tiles of the default basemap. |

A copy younger than its limit is served without asking. An older one is refreshed when the network answers and served as it is when it does not. With no copy of its own and no network, the worker serves a tile from the terrain loader's cache if that holds one. The cache keeps the newest 4,000 entries (`MAX_TILE_ENTRIES`); the data cache keeps 1,500 (`MAX_DATA_ENTRIES`).

Add a host only when its terms allow keeping tiles. Esri World Imagery is not listed: its service reports `exportTilesAllowed: false`. Only a readable `200` is ever kept: an opaque response is charged megabytes of quota each, and a `206` is not the tile.

Only tiles a person has viewed are kept. There is no "download this area" step: fetching a region ahead is bulk download, which each host's terms have to allow first.

## Work kept in this browser

Road projects, visual quality scenes, block plans and field photos live in IndexedDB, in the same site storage as the caches above. A browser treats that storage as disposable unless it has been asked to keep it, so the write paths call `keepStoragePersistent()` (`src/lib/offline/persistentStorage.ts`): `writeProject` for a road project, `saveCurrentScene` for a scene and `storePlan` for a block plan. Chrome and Safari decide silently. Firefox asks the person, so the request waits until they have used the page, is made once a session, and is not repeated for 30 days after a refusal (`PERSIST_ASK_AGAIN_MS`). A new tool that keeps a person's work calls it from its own write path.

## Inventory copies

**Offline and storage → Inventory copies → Keep inventory copies** is off by default. Off, visual quality keeps nothing of what it reads from the BC inventories, and a read DataBC cannot answer is an error.

On, each of those reads is kept with the time it was read (`pgmaps-inventory-copies-v1`, the newest 400, `MAX_INVENTORY_COPIES`). When DataBC cannot be reached or answers a 5xx, the copy of the same request answers instead. The result carries the copy's own date, and a notice in the page says how many reads came from copies and how old the oldest is. A different area has no copy and fails as before. Turning the option off deletes every copy; clearing them from the list below leaves the option on.

The rule is `src/lib/offline/keptReads.ts` (DOM-free) and its browser binding `inventoryCopies.ts`. It runs in the page and in the analysis worker, not in the service worker, so it works on a development server too and applies only to the reads that ask for it. The switch is kept in Cache Storage (`pgmaps-inventory-option-v1`) because a worker cannot read `localStorage`. See `docs/forestry-visual-quality.md`, **Keep inventory copies**, for what a copy is and is not.

## Managing what is kept

**Offline and storage** in the site navigation (`StorageDialog`, `src/components/ui/storage-dialog.tsx`) shows everything PGMaps keeps in this browser and is the one place to control it:

- how much of the browser's allowance is in use, and whether the browser has agreed to keep it (**Protect** asks);
- the offline tools: whether each is ready, with **Keep offline** and **Remove**;
- **Keep inventory copies**, on or off;
- what was downloaded or worked out, each with its size and a **Clear** that first says what clearing costs;
- a person's own work, listed with its size and where it is managed. Nothing in that list is removed from this panel.

It reads one catalogue, `STORE_CATALOGUE` in `src/lib/storage/siteStorage.ts` (DOM-free). Every Cache Storage cache and IndexedDB database the app opens has an entry there, with a role:

| Role | Meaning | In the dialog |
| --- | --- | --- |
| `download` | Fetched or derived: app files, map data, tiles, depth models, depth estimates, inventory copies. | Sized, with **Clear**. |
| `work` | A person's own: road projects, RoadEng terrain files, scenes and photos, logo, Castor, Nechako, Labs. | Sized, linked to its tool, never cleared here. |

`siteStorage.test.ts` scans the source for every cache and database it opens and fails when one is not in the catalogue, so a new store cannot be added without becoming visible and clearable. A `download` entry that shares a database with work names the object stores it may clear, and `clearEntry` (`browserStorage.ts`) refuses a `work` entry and a `download` entry that names a whole database. Anything present that the catalogue does not list (a library's cache, a store from an older release) is shown under **Other**: a cache can be cleared, a database is only named.

IndexedDB reports no sizes, so a database's size is walked (`approximateBytes`): binary data by its length, text at two bytes a character, a long list of numbers by its length. It is an estimate, good to a few percent where the bytes are. Measuring never opens a database that is not already there, because opening one creates it.

What bounds storage without anyone opening the dialog:

| Store | Bound | Constant |
| --- | --- | --- |
| Tile cache | Newest 4,000 entries | `MAX_TILE_ENTRIES`, `public/sw.js` |
| Data cache | Newest 1,500 entries | `MAX_DATA_ENTRIES`, `public/sw.js` |
| Both, when the site is at 80% of its allowance or a cache write is refused for room | Cut to a quarter of those | `STORAGE_PRESSURE_SHARE`, `PRESSURE_KEEP_SHARE`, `public/sw.js` |
| Built files no list names | Dropped after 30 days | `STALE_ASSET_MS`, `public/sw.js` |
| Terrain loader's own tiles | 128 tiles, 7 days | `MAX_STORED_TILES`, `MAX_AGE_MS`, the toolkit's `terrainTileCache.ts` |
| Photo depth estimates | Pruned to the photos still in the set | `prunePhotoDepth`, `toolsStorage.ts` |
| RoadEng terrain files | Removed with the last project that names one | `projectLibrary.ts` |

Under pressure only tiles and data files give way. They can be fetched again; the projects and photos in IndexedDB beside them cannot, and a browser that runs out of room clears a site's storage all together. A cache write that fails never fails the request it was copying.

## Project index generation

`public/data/projects/index.json` is generated rather than hand-maintained. Run:

```bash
npm run projects:index
```

The generator recursively scans `public/data/projects`, excluding the index itself. It validates that every package contains a non-empty `slug` and `title`, rejects duplicate slugs, and records the first 12 characters of each file's SHA-256 digest:

```json
{
  "version": 1,
  "projects": [
    {
      "file": "where-is-north-bc.json",
      "revision": "0123456789ab"
    }
  ]
}
```

The client always requests the index freshly. It requests packages as `/data/projects/<file>?v=<revision>`, so unchanged packages remain cacheable while an edited package receives a new URL.

Commands:

```bash
# Rebuild generated Score Builder packages and the complete index
npm run projects:build

# Rebuild only the complete index
npm run projects:index

# Fail if the checked-in index is stale or invalid
npm run projects:index:check
```

Both `npm run dev` and `npm run build` run `projects:build` through their pre-scripts. The GitHub Pages deployment runs `npm run build` for every push to `main`, so its artifact always contains an index derived from that commit.

When adding or removing an authored project package, change only the package file and run `npm run projects:index` before committing. Do not edit revisions manually. Score Builder packages remain generated by `scripts/generate-scorebuilder-projects.ts`.

## Verification

After changing update or cache behavior:

```bash
npm run projects:index:check
npm test -- --run src/updates/useAppUpdate.test.ts src/lib/serviceWorker.test.ts src/lib/offline src/lib/storage
npx tsc --noEmit
npm run build
```

`src/lib/serviceWorker.test.ts` runs the real `public/sw.js` against a working stand-in for Cache Storage and the network; `src/lib/storage` covers the catalogue, measuring and clearing. `tests/e2e/offline-tools.spec.ts` opens each offline tool in a browser, cuts the network, reloads and opens a dialog never opened online, then drives the storage dialog. It needs the built site, so it is skipped unless `PGMAPS_E2E_PRODUCTION=1`:

```bash
npx vite build
npx vite preview --host 127.0.0.1 --port 42173 --strictPort &
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 PGMAPS_E2E_PRODUCTION=1 npx playwright test tests/e2e/offline-tools.spec.ts
```

The `offline-tools.yml` workflow runs the same by hand.

Inspect the built output and confirm that `dist/index.html` contains a `data-id="_pwun_"` script, and that `dist/pluginWebUpdateNotice/web_version_by_plugin.json` contains the current short commit SHA.
