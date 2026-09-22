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

## Forestry visual quality

- `docs/forestry-visual-quality.md` is the contract for `/dev/forestry/visual-quality`: what each reported percentage means, what the sightline model does and does not include, and the run's cost limits.
- Read its **Drive the view** section before touching `src/pages/dev-forestry/DriveCamera.tsx`. The eye-level camera depends on MapLibre behaviour that fails silently — an omitted `roll` argument reaches `jumpTo` as `undefined` and leaves the transform's projection matrices null from then on.
- Do not move the 3D stand onto a deck.gl overlay. Under this camera `map.transform.elevation` is a camera-fitting residual (about −294 m at Tabor Mountain), not the ground under the map centre, and deck.gl derives its camera height from it — so its camera lands at sea level while MapLibre's is on the hillside, and nothing draws with no error reported anywhere. `treeLayer.ts` takes MapLibre's own `modelViewProjectionMatrix` for that reason.
- Anything that needs the camera's ground position during a drive must take the viewing station, not `map.getCenter()`. Pitched at the horizon from eye level, the map centre is kilometres away on the skyline.
- MapLibre publishes no camera position — `getFreeCameraOptions` is Mapbox-only and `transform.cameraPosition` is internal. `treeLayer.ts` takes the view direction from the projection matrix's w-row gradient instead, which cannot disagree with the matrix that drew the ground.
- The tree silhouettes in `impostor.ts` are generated, not assets. Keep it that way: it is what makes the stand redrawable for a different species mix, and it keeps third-party vegetation assets and their licences out of the repo.
- Green-up height is area-weighted over slope classes, per the 1998 procedure's Step 5 — not `vegHeightForSlope(meanSlope)`. Table 6 is a step function, so the two disagree on mixed ground. `analysis.ts` accumulates it per sample; do not recompute it from `meanSlopePercent` in a panel.
- The planimetric denominator is the landform's **treed** area, per the 1998 procedure's "total green (forested) portion". It comes from VRI rank-1's `BCLCS_LEVEL_2`, live from DataBC's WFS (`bcVegetationInventory.ts`) — not the ArcGIS service, which carries only the VRI *Dead* layer. Dividing by the whole landform reads the figure about 27% low at Tabor Mountain, enough to cross a class.
- In `bcVegetationInventory.ts` the bounding box goes in `CQL_FILTER`, never the WFS `bbox` parameter: WFS 2.0 with `EPSG:4326` is latitude-first, CQL's `BBOX` is longitude-first, and mixing them silently returns the wrong part of BC. Keep `propertyName` narrow too — the layer has 189 attributes and GeoServer will not generalise geometry.
- Never put `glyphs: ''` in a stubbed MapLibre style. The style then never finishes loading, `isLoaded` stays false, and every effect gated on it no-ops while the tests still pass — which hid 3D terrain and the 3D stand being switched off in the whole forestry e2e suite. Assert map state (`getTerrain()`, a layer id) rather than the sidebar text describing it.
- `vqo.ts` holds two threshold scales on purpose: perspective-view ranges define the objective, planimetric ranges are the timber-supply proxy, and they are not interchangeable. Judge a number against the scale it was measured on.
- Visual sensitivity units use the full-resolution `visualInventorySnapshot.ts` spatial shards, owned by `bcdatamapper` and synced to `public/data/forest/visual-inventory`. Keep source coordinates intact: a 30 m simplification distorted small units. Live harvest/RESULTS queries in `bcVisualInventory.ts` and VRI remain per-place exceptions. A nearest sensitivity unit is a review candidate, never an automatically verified visual landform.
- `MapSectionLayout` gives the page one fixed-height sidebar slot and that slot does not scroll, so everything the sidebar renders — `AssessmentPanel` included — belongs inside `MapSidebarShell`'s scroll container, which is what the `assessment` prop on `Sidebar.tsx` is for. Stacked beside the shell instead, a panel pushes the shell's lower half and the bottom of its scroll port off the screen, where scrolling never reaches them; nothing overflows visibly to give it away.
- Keep `terrain.ts`, `visibility.ts`, `vqo.ts`, `shapeImport.ts`, `reverseViewshed.ts`, `roadSnap.ts`, and `forest.ts` free of DOM and network access. They carry the unit tests, and `analysis.ts` runs against any `ElevationSource`, which is what lets a run be checked outside a browser. `roadSnap.ts` takes a structural `RoadQueryMap` rather than a MapLibre map for the same reason.

## Project packages

- For project-package creation, renderer changes, capability additions, or package audits, read `.agents/skills/pgmaps-project-builder/SKILL.md` and only the references it routes to for the active project mode.
- `docs/project-map-explorer.md` is the contract for `map-explorer-v1`. Keep each feature option in its own file under `src/maps/project-explorer/features/`; keep data-source normalization in `adapters/`, shared presentation in `src/components/ui/`, and orchestration in the top-level explorer files.
- Audit a repository-ready package with `node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs public/data/projects/<package>.json` before handing it off. Use `--draft` only for an explicitly incomplete review artifact and resolve its warnings before registration.
