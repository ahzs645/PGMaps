# Tree-crown isolation and canopy-height detail

The viewer adds `?view=trees` and improves `?view=canopy-height`. The first maps candidate crown footprints and treetops and crops original returns for inspection. The second switches from the overview to original 1 m height-grid pixels when zoomed in. Neither adds species predictions or finer measurement resolution than the inputs.

## Crown footprints and point isolation

There are 16,136 retained dominant-crown candidates from the existing local-maxima/watershed processing. A 1 m height surface is Gaussian-smoothed at sigma 0.7 m, peaks use 3 m minimum separation and at least 1 m local relief, and watershed regions extend across supported height ≥2 m outside roof buffers. Peaks require height ≥5 m; retained regions have at least 4 m² source-cell area. The existing candidate IDs and metrics are preserved. This is a canopy-surface partition, not independent 3D segmentation of complete trees.

`scripts/lidar/tree_isolation.py` exports source-cell membership as row/start/length runs and geographic display footprints simplified at 0.7 m. The exact retained regions contain 1,720,119 nonoverlapping 1 m cells. Metric area comes from source cells, not simplified polygons. Height/area filters, a tile-edge filter, source coordinates, treetop markers, footprint selection and a virtualized list expose all retained candidates. Colours distinguish candidate IDs and do not identify species.

Select a crown and choose **Isolate original returns in 3D**. The browser uses GeoLibre's public `EptStreamingLoader` to select intersecting EPT nodes and load at most 750,000 input returns. It retains only points inside the selected crown's exact source-cell columns, 2–80 m above the source DTM, excluding classes 2, 7, 12 and 18. Available decoded withheld/overlap attributes are screened; the interface explicitly reports when withheld attributes are unavailable. An expanded geographic bounding box prevents simplified display edges from excluding source columns; final membership always uses the metric grid.

The point reader reports loaded/intersecting nodes, budget/hierarchy limits and screened flags. Failed nodes and timeouts produce a retry state. Changing the candidate cancels the old selection and prevents stale results from replacing the new crop. The original full-cloud display is hidden during isolation. A MapLibre custom point layer preserves the original point geometry, shifting the selected treetop's ground elevation to zero for display; CSV exports retain the original orthometric elevations, normalized heights and EPT node/point identities. This crop is not advertised as a complete individual tree, a stem count, DBH or a species label. Overlapping branches, understory, merged crowns and unrecognized structures can remain; suppressed trees may be missed.

An offline check for `crown-1` read six intersecting EPT nodes containing 308,054 original returns and found 3,122 returns after crown-column, height, class and withheld screening. This independently checks the original dataset and geometry; it does not validate tree identity or replace browser/WebGL acceptance. Runtime counts can differ if decoded flag availability or boundary quantization differs.

```sh
/path/to/venv/bin/python scripts/lidar/tree_isolation.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --grids /path/to/analysis-grids.npz
/path/to/venv/bin/python scripts/lidar/inspect_tree_ept.py --crown crown-1
```

The offline check expects the prepared EPT tree under `public/data/lidar/bc-093g086` and enforces the same 750,000-input-return cost bound. Source grids/candidate files are verified by deployment; raw LAZ/EPT binaries are not duplicated in Git.

## Observed side profiles

In `?view=trees`, **Tree side profiles → Load selected tree profile** uses the same original-return crop as the native 3D view. Black points on white show an orthographic horizontal-offset/height projection. Rotate the horizontal axis from east–west (0°) to north–south (90°), or switch to height colours. Each point uses its source-DTM-normalized height; this is a terrain-normalized profile, rather than a perspective rendering or constant-elevation cross-section. All depths inside the crown columns are projected; there is no synthetic stem, connecting line, filled silhouette or shape inferred from height.

**Pin for comparison** keeps up to four crops / 150,000 original returns, plus the current selection. Select another crown on the map or list, then load/pin its profile. Expand the shared chart frame to compare a gallery sorted by observed maximum height. Both axes and every candidate use exactly the same metres-to-pixels scale, which stays fixed through rotation. Pins clear when changing workflow or reloading. **Download profiles SVG** exports the same figure with source identity, node coverage, crop flags, viewing angle and method in its metadata. Existing isolated-return CSV exports retain individual point lineage.

The shaded 0–2 m band is deliberately empty because the crop excludes those heights. Airborne scanning can also miss trunks, lower branches and suppressed trees; absent points cannot establish a bare stem, crown-base height or DBH. Projected width is angle-dependent and includes any neighbouring foliage/understory in the crown columns. Profiles help compare observed height/asymmetry and review sparse, merged or structure-like candidates, but do not validate tree identity or species. The `crown-1` offline figure, for example, preserves all 3,122 screened returns and exposes a narrow lattice-like form requiring review as a possible structure. It is not a confirmed tree or confirmed tower classification.

For an independent profile input with original node/point IDs:

```sh
/path/to/venv/bin/python scripts/lidar/inspect_tree_ept.py \
  --crown crown-1 --output /tmp/crown-1-original-returns.json
```

The optional output validates unique node/point identities, the accepted-return count and 2–80 m heights. LAS flag arrays are converted to Boolean before selection, avoiding integer-array indexing of binary flags. The browser still loads its own crop through GeoLibre; no precomputed silhouettes or additional raw-point hosting copies are used.

## Native canopy-height detail

The previous coloured overview has 6 m Web Mercator pixels, about 3.5 m on the ground at this tile. **Automatic 1 m detail** is enabled by default in the height workflow. At zoom 16 and above, the browser loads the existing `height-1m.tif`, verifies its SHA-256 and grid metadata, and renders its original cells with nearest-neighbour sampling and the same 0–40+ m colour scale. It preserves the overview while detail is loading or unavailable, switches only when the image source is ready, and restores overview coverage when detail is disabled or the map zooms out. No measurements finer than 1 m are synthesized.

The small `height-detail.generated.json` stores a bit-packed eligibility mask, exact grid bounds/corners and source hashes. Its 2,246,943 eligible cells exactly match the existing heatmap: finite height/support and more than 2 m Euclidean source-cell distance from rasterized roof patches. Masking is retained at every zoom, with no smoothing across missing cells. The source-grid image is georeferenced by its four transformed corners; this is a display warp over the small tile. Quantitative clicks use the exact metric source grid and original float values, rather than reading colours or enlarging the overview samples. These are processed canopy-surface heights, not survey accuracy or individual-tree heights. Unrecognized structures can remain.

The browser coordinate conversion uses the same EPSG:1946 NAD83(CSRS)→WGS84(2) Helmert operation as the pinned PROJ processing. Coordinate-frame rotation signs are converted for proj4's position-vector convention. Tests check source marker coordinates against the pipeline's metric coordinates, preventing the roughly metre-sized datum shift caused by treating CSRS as untransformed NAD83. Original orthometric elevations are retained separately.

The map status states overview, loading, native 1 m detail or fallback. The checkbox allows overview-only use. Opacity and the eye control apply to the active height layer, and workflow changes hide the native detail. Density remains the documented 21 m neighbourhood product. The downloadable coloured PNG remains the overview; original GeoTIFFs remain in the Files downloads.

```sh
/path/to/venv/bin/python scripts/lidar/height_detail.py \
  --analysis public/data/lidar-analysis/bc-093g086
python3 scripts/lidar/validate_tree_detail.py \
  --analysis public/data/lidar-analysis/bc-093g086
```

## Verification and maintenance

The validator checks source/input identities, all crown IDs/metrics against the original candidate product, exact cell counts, nonoverlapping assignments, grid agreement, mask byte/count integrity and agreement with the existing heatmap mask. Tests cover height/area/edge filtering, coordinate conversion, exact membership, bounded crop loading/cancellation, class/height/withheld screening, node-identity exports, finite GPU buffers, real GeoTIFF decoding/NoData/hash rejection and overview/detail transitions. The small tracked TIFF is synthetic test data, not a duplicate of the real source raster.

Profile tests cover the metric projection and rotation, per-return normalized heights, shared undistorted scale, point preservation/exclusions, empty crops, XML-safe self-contained export, bounded same-source pins and rendered inspection/export controls. An actual-source SVG was rasterized and visually inspected separately; this verifies the figure output, not browser interactions or WebGL.

Crown metadata is lazy-loaded only for tree inspection. The real source height/terrain grids are fetched on demand and cached by URL and hash. Individual crown crops use the existing private EPT data route; no new external data service or raw-point hosting copy is introduced. Independent field validation and visual browser/WebGL acceptance remain separate from data, adapter and SSR checks.
