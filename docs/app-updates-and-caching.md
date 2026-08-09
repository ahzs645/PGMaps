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

The plugin's default UI is disabled. `src/updates/useAppUpdate.ts` listens for `plugin_web_update_notice`, and `src/updates/AppUpdateNotice.tsx` renders the PGMaps notification. Choosing **Later** suppresses that deployed version while still allowing a later commit to notify the user. Choosing **Reload** preserves the current route, query, and fragment while adding a fresh `_update` query value so GitHub Pages and intermediate caches must resolve the navigation again.

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
| Vite `/assets/` JavaScript and CSS                             | Cache first                                               | Vite filenames are content hashed.                                                            |
| Other local static and data files                              | Stale while revalidate                                    | Existing map data renders quickly and refreshes in the background.                            |

Only caches whose names begin with `pgmaps-` are considered owned by this worker. Activation deletes obsolete PGMaps cache versions but does not touch unrelated origin caches.

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
npm test -- --run src/updates/useAppUpdate.test.ts
npx tsc --noEmit
npm run build
```

Inspect the built output and confirm that `dist/index.html` contains a `data-id="_pwun_"` script, and that `dist/pluginWebUpdateNotice/web_version_by_plugin.json` contains the current short commit SHA.
