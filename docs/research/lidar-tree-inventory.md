# Individual-tree inventory, ForestTools and FORA

The `/dev/lidar/inventory/` workspace links candidate crown outlines, original-return 3D and side profiles, review attributes, polygon summaries and stand tables. Processing is saved in app-owned assets. Browser controls filter these results and recalculate allometry; they do not run R or neural inference on an uploaded file.

## Executed comparison

Source SHA-256: `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf` (84,608,005 returns). Inventory run `339279edbc1bb1ea` uses seven complete 50 m cores, 1.75 planimetric hectares in EPSG:3157. Cores: `0-28`, `1-19`, `4-12`, `7-25`, `11-11`, `14-6`, `13-21`. These spatially selected examples are not a representative whole-tile inventory. Neural outputs are from the immutable preliminary snapshot dated 2026-10-21T14:22:50Z; whole-tile inference proceeds separately.

| Saved method                      | Candidates with observed height ≥5 m |
| --------------------------------- | -----------------------------------: |
| SegmentAnyTree                    |                                  763 |
| ForAINet                          |                                  407 |
| ForestTools smaller windows       |                                  435 |
| ForestTools reference windows     |                                  360 |
| ForestTools larger windows        |                                  220 |
| FORA fixed window                 |                                  132 |
| FORA variable mixed-forest window |                                  115 |

These are seven competing inventories, not 2,432 unique trees. Counts and one-to-one nearest-apex agreement are sensitivity diagnostics, not accuracy estimates. Roofs, merged crowns, low-return instances and boundary fragments require review. IDs are unique within the saved run and method; final neural seam merging will change identity.

ForestTools 1.0.4 actually ran `vwf`, `mcws` and `glcm` on the existing native 1 m CHM, using 16 m buffers. Radius functions are `0.04H+0.5`, `0.06H+0.5` and `0.10H+0.5`. Treetop minimum is 5 m; crown minimum is 2 m. Ownership is by treetop inside the core, while whole buffered crown polygons are retained. GLCM texture uses 32 grey levels, offset `(0,1)` and fixed 0–60 m discretization; it is segment texture, not a species classifier. The search radius is not crown width.

FORA's upstream `runSeg` was executed from commit [`e866d5b6a8cf0267515cd0fedef95043f3df3c01`](https://github.com/fora-platform/fora/tree/e866d5b6a8cf0267515cd0fedef95043f3df3c01). Both runs use every cached original core return, the existing per-return DTM heights, 1 m cells and 5 m minimum. Fixed radius is 3 m; variable radius uses the upstream mixed-forest preset. These runs have no halo, unlike the buffered ForestTools and neural methods. The adapter deliberately bypasses upstream inventory/allometry and its display cap. It verifies the commit and unmodified App.jsx before extracting segmentation functions. FORA is MIT licensed, copyright (c) 2026 Burhan Gencal; consult its LICENSE when redistributing its implementation.

## Attributes and estimates

Each row carries a run/method/core/label ID, canopy-apex location, observed height, crown geometry and area, equivalent-area diameter, ground elevation, slope/aspect, available return counts, boundary flags, VRI stand context and review status. Neural and FORA polygons are convex hulls of assigned original core returns; ForAINet prefers branch classes. Degenerate hulls remain points, without invented area. ForestTools outlines are watershed crowns. These geometries are different objects and may produce different allometric estimates.

- DBH uses Jucker et al. (2017), equation 6: `0.557 × (height_m × crown_diameter_m)^0.809 × exp(0.056²/2)`. Equivalent-area crown diameter is an explicit proxy. Global validation log scatter 0.45 supplies a sensitivity bracket, not a locally validated confidence interval. A manual DBH overrides the estimate. Sparse breast-height returns do not establish measured stem diameter.
- Volume uses Nigh (2016), TR106 equation 2, INTERIOR Tables 4/6: `exp(b0) × DBH_cm^b1 × height_m^b2`. Table 3 marginal fitting ranges are enforced. Total is inside-bark stem volume. Merchantable excludes a 0.3 m stump and wood above a 4 cm inside-bark top; the separate editable minimum DBH defaults to 12.5 cm. No defect deduction, sawlog/pulp allocation or product-grade model is implied. Unsupported species, out-of-range inputs and physically inconsistent estimates are unavailable, not zero.
- Default species is the VRI polygon's leading species, labelled as a stand-level assumption. Users may require reviewed species instead. A VRI join is not individual-tree species identification. Turkish species and Pinus brutia biomass equations from FORA are not transferred to BC.
- Retention (20%) and recovery (90%) are editable scenario assumptions. Recovered volume is `known merchantable × (1-retention) × recovery`; it is not measured harvest yield.

Sources: [Jucker paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC6849852/), [BC TR106](https://www.for.gov.bc.ca/hfd/pubs/docs/TR/TR106.pdf), [ForestTools manual](https://andrew-plowright.r-universe.dev/ForestTools/doc/manual.html), [FORA](https://github.com/fora-platform/fora).

## Selection, review and exports

Draw a polygon or import one WGS84 Polygon/MultiPolygon as GeoJSON. Validation rejects unclosed, self-crossing, oversized or invalid-coordinate geometry. Area includes holes and is computed after projection to EPSG:3157. The denominator is intersection with known non-overlapping processing cores, not the whole requested area. Unprocessed land is unknown. Candidate membership uses the observed canopy apex, not fractional crown overlap or measured stem position.

Species × 5 cm DBH classes report detected candidates, candidates/ha, known basal area and available modelled volumes. Missing estimates are counted explicitly. This is not a complete census, regulatory stocking assessment, free-growing survey or timber cruise. Excluded reviews stay in exports but are removed from stand totals. Split/merged review statuses flag an issue; they do not edit point labels or create new instances.

Reviews are small source/run-scoped browser-local annotations. Export/import review manifests to preserve them across browsers. Manifest schema 1 rejects a mismatched run/source, unknown candidate IDs and invalid rows. Tree CSV, stand CSV, GeoJSON and per-tree original-point CSV are downloadable. GeoJSON retains run, source, support, query polygon, parameters, equations, coefficients and assumptions. Original-point IDs refer to source LAZ row indices; the app does not invent LAS classification or a classified LAS export.

All original points in a loaded core are retained in lazy gzip-base64 JSON assets; no gallery thinning. Three-dimensional instance inspection filters saved label columns. ForestTools profiles select returns ≥2 m in the crown's XY column, not independent 3D tree segmentation, and adjacent selections can overlap. FORA-inspired height percentiles, coefficient of variation, density ratios and histograms are computed only for the loaded core within the selected polygon. They are return metrics, not pulse density or foliage density.

## Reproduction and maintenance

The implementation separates allometry, geometry, summaries, review validation, lazy point loading and presentation under `src/pages/dev-lidar/inventory/`. Existing vector/satellite basemaps and shared comparison map/profile renderers are reused.

1. Prepare the source shards and native DTM/CHM through the existing LiDAR pipeline. Keep original source row indices and the immutable neural NPZ/JSON checkpoint hashes.
2. Run `scripts/lidar/foresttools_inventory.R <config.json>` with ForestTools 1.0.4, terra, sf and jsonlite. Config contains `height`, `output` and `tiles` with `id` and `[xmin,xmax,ymin,ymax]` bounds. This produces tops, crowns, texture CSV and `foresttools-run.json`.
3. Build the base inventory/point assets with `scripts/lidar/build_tree_inventory.py --root . --input <shards> --run <neural-production> --foresttools <outputs> --analysis <DTM-CHM-directory> --output src/pages/dev-lidar/inventory/inventory.generated.json`. Python needs numpy, rasterio, pyproj and shapely. First build can omit FORA output.
4. Check out the pinned FORA commit, then run `node scripts/lidar/run_fora_inventory.mjs <fora-checkout> src/pages/dev-lidar/inventory/points <outputs>`. It produces labels keyed by original source rows and `fora-run.json`.
5. Rebuild the inventory to incorporate FORA labels and provenance. Preserve the generated JSON assets together; a mismatched run is rejected by the point loader.
6. Run `npm test -- src/pages/dev-lidar`, `npx tsc --noEmit` and `npm run lidar:preview:build`.

Tests exercise the published equations, geometric area/holes and invalid imports, snapshot reconciliation, original-row label alignment, matching uniqueness, review scope and UI selection/filter/draw/export flows. Interface interaction tests mock WebGL; they do not establish visual correctness of the deployed GPU map. Live route and asset verification is separate.

Useful further FORA patterns include local coordinate origins for float precision, LAS format guards, linked plan/profile views and height filtering. PGMaps already has original-cloud transects and upload tools, linked from this workspace. Applying new local species, biomass or product-recovery equations requires an explicit supported model, input definitions and reference measurements rather than copying coefficients from another region.
