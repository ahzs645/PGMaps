# PGMaps Agent Instructions

## Scraper-owned data

- `vendor/bcdatamapper` is the Git submodule and source of truth for scraper code, source archives, and deployable scraper snapshots.
- Treat paths copied by `scripts/sync-bcdatamapper-data.mjs` into `public/data` as generated build output. Do not force-add ignored copies of those files to the PGMaps repository.
- In particular, WARS artifacts belong only in `vendor/bcdatamapper/datascrapers/bc/wars/output`. Keep the manifest and deterministic compressed `*.gz` snapshots there; generate `public/data/wars` with `npm run data:sync-from-bcdatamapper`.
- Keep deployment checkout configured with recursive submodules. A build that does not initialize `vendor/bcdatamapper` cannot assemble scraper-owned data.

## Updating submodule data

1. Make and validate scraper/data changes inside `vendor/bcdatamapper`.
2. Commit and push the submodule change first.
3. Update the PGMaps submodule pointer without committing duplicate generated files under `public/data`.
4. Run `npm run data:sync-from-bcdatamapper` and the relevant tests/build from PGMaps.

Do not generalize this policy to app-owned files explicitly preserved by `scripts/sync-bcdatamapper-data.mjs`, or migrate other already-tracked datasets without reviewing their ownership and deployment path.

## Map stories

- `docs/project-map-stories.md` is the contract for `story-map-v1` project packages: the scene and layer schema, every `workspace.options` field, and what each `layout` replicates.
- Read its **Changing the renderer** section before editing `src/maps/project-story/`. It lists the files a new story option has to touch together, and the renderer invariants that break silently — scene cameras are re-fitted to the map pane rather than used verbatim, chrome in the `scrolly`/`slides` layouts sits in a `pointer-events-none` overlay, and the slides pane sizes itself by rendering every slide stacked.
- Story packages live in `public/data/projects/*.json` and are listed in `index.json`; regenerate that index with `npm run projects:index` after adding or renaming one.
