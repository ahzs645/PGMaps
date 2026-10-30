# LiDAR import and interface audit

Verified 22 October 2026 against main `3ac9ff1b055b42ca62c359d9649f4e86b3dbf5fc`, with the import-workspace changes on top.

## What the application accepts

Before this change, GeoLibre offered a general point-cloud loader, but the inventory's “Import GeoJSON” meant only an area-selection polygon. Processed layers could not be restored as a project. The new **Import & data** workspace is `/dev/lidar/data/`, accessible through the tool selector, library and upload icon. Inventory now labels its separate control **Import boundary**.

| Input | Browser behavior | Limits |
|---|---|---|
| Ordinary LAS/LAZ | Header inspected before GeoLibre full-file loading | 2 million returns and 64 MiB, embedded CRS required |
| Local COPC LAZ | GeoLibre range-based streaming from the selected File | 750,000-point display budget; source is not embedded in a saved project |
| HTTPS COPC / EPT URL | Native streaming APIs; no ordinary LAZ fallback | CORS required; COPC server needs byte ranges; URLs are not saved |
| Single-band GeoTIFF, optionally gzip | Native samples retained; colored map preview and native-cell inspection | North-up pixel-is-area grid, 16 million cells/file, 20 million cells/project; preview ≤1024 px |
| GeoJSON, optionally gzip | Points, lines, polygons, multi-geometries and geometry collections; ID search and attributes | 200,000 features/file, 300,000/project; 2 million vertices/file |
| PGMaps project JSON | Revalidates SHA-256 and restores original processed bytes, CRS and layer controls atomically | 96 MiB saved JSON; cloud files/URLs must be reattached |
| Archive `.part`, NPY/NPZ, CityJSON, CSV, review JSON | Not general layer imports | Restore split archives first; use the archived processing scripts for array/source-row mappings. Existing workspace-specific review imports remain separate. |

Up to 10 processed layers and 128 MiB of retained original processed files fit one session. Gzip decoding stops at 96 MiB. Supported source CRSs are EPSG:3157, 4326, 3857 and WGS84 UTM zones north/south. Explicit CRS selection applies to GeoJSON/GeoTIFF, never silently changes a point cloud. Unknown CRS and malformed geometries produce actionable errors. Raster units remain those of the source file; DTM elevation is not canopy height.

**Viewing and processing have distinct scopes.** Imported layers and point clouds appear in this workspace. The canopy, forestry, species, tree inventory, comparison, building and volume tools still use the bundled examples. They do not rerun on a newly imported tile. R/ForestTools, neural inference, terrain processing and building reconstruction remain the archived Python/R/native processing pipeline. No browser inference or complete-census accuracy is implied.

Files remain in the tab's memory; switching tools retains the session. Closing/reloading requires project restore and cloud reattachment. The site does not upload local file bytes to its backend. Basemaps and explicitly connected streaming servers still receive their ordinary network requests. Reattaching a filename does not verify a point-cloud checksum or establish source equivalence.

## Checks with the actual archived files

| File | Result |
|---|---|
| `source.laz` | Header: 84,608,005 returns, 550,572,701 bytes, LAS 1.4 format 6, CRS present. Ordinary LAZ gate rejects before a full read. Original sample remains viewable via its existing EPT hierarchy. |
| `source-with-model-labels.laz` | Header: 84,608,005 returns, 625,994,944 bytes, ordinary LAZ, CRS present. Same gate; convert to COPC/EPT before browser streaming. |
| `sat-candidate-centroids.geojson.gz` | All 93,771 features loaded; candidate `0`, method, assigned returns and reviewed flag retained. SHA-256 `82c2e8ec87cc317b0d0301965c499516bf7fe410fe6e3afdce5081f54fa9cea1`. |
| `forainet-candidate-centroids.geojson.gz` | All 52,272 features loaded; candidate `0` and attributes retained. SHA-256 `2a9ecc526550420f7ed2d714bc97e87f3d14cd8e4da5d972aca1dcc0a575b5a5`. |
| `height-1m.tif` | 1,648 × 1,396 cells, 1 m EPSG:3157, 2,279,933 valid samples, NoData −9999, range 0–59.987976 m. SHA-256 `53258048d1d72e706120adb05487e04652cb2d3394666d97b20c20fd04af1898`. |
| `dtm-1m.tif` | Same footprint/resolution/valid count; elevation 601.804016–808.239990 m. SHA-256 `9e6326b8863c853fd449173a32908a2d67f9a5c32f2804b0c4dc001fce804181`. |
| Four-layer project | 17,811,128-byte project saved/restored; all four original checksums match. |

The two centroid layers are candidate summaries, not crown polygons or verified stem locations. Their IDs/colors are scoped to each source file. Matching numeric IDs across methods do not establish tree correspondence. Neither candidate count is a validated tree census.

## Interface review and regression checks

- The library/tool selector resolves all tools and legacy links. The library no longer mounts an invisible WebGL map.
- Imports load lazily and do not depend on the BC analysis summary succeeding.
- The import map has vector, satellite and no-basemap options. Provider IDs remain namespaced. The required vector insertion anchor is installed before context layers; sidebar changes trigger map resizing.
- Layer visibility, opacity, map picks, feature ID search, attribute inspection, native raster sampling, source download, fit, top/3D view, removal, clearing and project restore are connected to the session.
- Failed file imports preserve existing layers. Invalid project restores do not partially replace the session. Clearing/cancelling/unmounting prevents late asynchronous imports from reappearing. Removing a selected layer clears the previous feature selection.
- A new GeoLibre control owns each active point source; switching/removing it disposes the previous control. Native unrestricted loading and URL restoration are disabled in example maps so arbitrary files are not mixed with BC statistics.
- Top controls and messages have bounded scroll containers. Layer lists scroll internally; mobile layers use a dismissible overlay, closed initially. Map container resize follows these controls.
- Existing interaction coverage exercises inventory methods, polygon selection, review persistence and tree/stand exports; model variants and unavailable-model states; isolated neural trees; canopy/forestry/species classifications; tree profiles/editing; transects; roof inspection; VRI and volume assumptions/exports.

Validation passed: 146 tests across 35 LiDAR test files, TypeScript (`tsc -b`), and the production LiDAR preview build.

Automated tests use React test renderer and structural map/control adapters. They do **not** render actual WebGL, decode a local COPC through the GPU, verify mobile pixels or validate external provider CORS. The session has no supported browser-control runtime, so a full visual browser walkthrough remains outstanding. Production-build and deployed-asset checks are separate from browser behavior. GeoLibre's build emits an existing CommonJS/ESM warning in its WASM adapter; successful bundling does not resolve its runtime compatibility by itself.

## Using the browser-ready archive addendum

Download `bc-full-tile-import.pgmaps.json` from the archive's analysis folder. Open **Import & data → Restore project** and select that JSON. It contains the two full-tile candidate layers plus native height and terrain GeoTIFFs. Select a layer, toggle its visibility/opacity, search an ID and inspect attributes; select the raster to inspect native cell values. Use **BC sample EPT** to add the original cloud. The labelled ordinary LAZ is not embedded.

The project and its audit report are an addendum to the earlier split-archive manifest; they do not alter those packages or their checksums. Saving your own project creates a new local JSON. The project does not include inventory reviews stored separately in browser local storage.
