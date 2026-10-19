# Focused LiDAR workspaces

`/dev/lidar/` is the tool library. Six focused workspaces share the same original source, basemap controls, source metadata and map renderer:

| Route | Analyses and tools |
| --- | --- |
| `/dev/lidar/canopy/` | Canopy height, canopy density, vertical layers |
| `/dev/lidar/trees/` | Crown candidates, original-return profiles, point review/editing, segmentation comparisons |
| `/dev/lidar/forestry/` | Gaps, plots, canopy texture, opening edges, vegetation proximity |
| `/dev/lidar/species/` | Recorded composition, experimental held-out models, disagreement and field review |
| `/dev/lidar/buildings/` | Roofer models and roof-patch inspection |
| `/dev/lidar/transects/` | Native GeoLibre cross-section drawing, terrain-normalized profiles and exports |

The compact header switches tools. Each analysis selector is limited to the current workspace; downloads follow its analysis. Non-default analyses retain `?view=…`, for example `/dev/lidar/forestry/?view=plots`. Roof inspection can open directly with `/dev/lidar/buildings/?panel=roofs`. Unknown tools show a library message instead of silently opening an unrelated tool.

Old `?view=…` links on `/` (the standalone preview) or `/dev/lidar` normalize to the matching route with history replacement. Existing context/analysis/inspection aliases resolve to canopy/forestry/buildings respectively. New navigation uses ordinary React Router history; back/forward restores the corresponding tool and analysis.

## Ownership and state

- `workspaceTools.ts` owns tool IDs, titles, output descriptions, allowed analysis modes and canonical/legacy URL resolution. Every existing analysis belongs to exactly one tool.
- `useLidarNavigation.ts` owns route reads, canonical replacement and navigation. Both the Pages entry and standalone preview provide React Router; the Pages route is `/dev/lidar/*` with no route-dependent component key.
- `LidarWorkspace.tsx` composes the persistent map, sidebar, profile/transect pane, header and library. It is reduced from 1,021 lines to about 245. Navigating through the library hides the map container without destroying its instance.
- `useLidarWorkspace.ts` owns shared map state, source/analysis integration, tool activation and selection actions. `useLidarSummary.ts` isolates cancellable summary loading and retry. Existing tree, inspection and workflow-data hooks retain their own source checks and budgets.
- `LidarHeader`, `LidarSidebar`, `LidarMapSettings`, `LidarMapToolbar` and `LidarLegend` own their presentation boundaries and use shared UI primitives.
- `WorkflowPanel` dispatches to domain panels. Existing canopy, forestry, species and tree panels stay separate; `ScreeningPanel` owns gap/plot/proximity/model controls and model review state. `WorkflowDownloads` scopes products and documentation links to the active analysis.

Map centre, zoom and basemap survive tool changes. Overlays and point-cloud visibility follow the new task. Automatic workflow activation does not refit the map; the explicit **Fit whole tile** action and explicit feature selection move the camera. MapLibre can make sub-metre centre adjustments while changing pitch or resizing. Read-only camera attributes on its container support acceptance checks without exporting the map object.

The tool switcher remembers the last analysis used in each tool. Analysis parameters and selections are retained by mode in the shared controller for the current session; returning to trees restores the selected crown. Library cards intentionally open each tool's default analysis. Full reloads start at the URL's analysis and its default selection. Existing source-bound tree comparisons, review notes/edits and building/species review records remain browser-local with their existing export/import mechanisms; moving files does not migrate or discard their storage keys.

The document does not scroll. Tool-library cards, sidebars, profile panes and comparison galleries own their scroll areas. Hidden result panels unmount their virtual lists to avoid measuring zero-height rows.

## Hosting and verification

`src/App.tsx` registers the wildcard Pages route. `scripts/write-spa-fallback.mjs` emits real `index.html` entries for the library and all six tools, alongside the existing SPA fallback, so direct Pages links work. The private Sites adapter serves the same compiled entry for LiDAR document routes while retaining exact asset/data routes and server-only credentials.

`workspaceTools.test.ts` checks complete/non-overlapping tool ownership, all legacy analyses, canonical deep links and invalid/cross-tool parameters. The existing actual-data interface suite now checks that each analysis renders only its workspace's selector choices and that Roofer downloads appear only for buildings.

After preparing the original EPT/analysis files:

```sh
npx vitest run src/pages/dev-lidar
npm run build --ignore-scripts
npm run lidar:preview:build
npm run lidar:inspector:browser
```

The build command bypasses this repository's unrelated data-generation prebuild. The browser command uses the real compiled app and original EPT/DTM with an installed Chromium. `LIDAR_QA_ROUTES_ONLY=1 npm run lidar:inspector:browser` runs the focused routing extension; the default also repeats pointer picking, PNG download, tree reviews, method switching and native transect drawing. Route checks cover scoped selectors, the same retained map element, centre/zoom preservation, unchanged basemap, remembered analyses/filters and crown selection, browser history, deep-route reload, and desktop/phone no-document-scroll layouts. Screenshots and downloaded figures stay in ignored `test-results/lidar-inspector`.

Verification completed with 92 passing tests, both application/standalone builds and the default combined real-source browser check. It reported no page errors or failed HTTP responses; saved comparison/profile PNG export remained 97,129 bytes and the phone profile remained visible at 390×844. Desktop/mobile library and rendered canopy overview screenshots were inspected.

This reorganization changes navigation and code ownership. It does not rerun scientific processing, add field validation, change source coordinates, or turn crown/roof candidates into confirmed trees/buildings.
