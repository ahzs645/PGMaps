# Forest stem volume and harvest scenarios

The practical next step for this airborne tile is an **area-based, field-calibrated volume model**. Counting candidate crowns and multiplying by height would also count some structures and would not provide stem diameter or wood volume.

The implemented workspace is `/dev/lidar/volume/`. It opens with a completed **BC VRI inventory baseline** over the actual tile; no field CSV is required. A separate Québec teaching example shows a field-backed LiDAR regression. Other views explain measurement practices and offer optional local calibration. No observed plot volumes were available for the BC tile, so the VRI baseline is explicitly an existing inventory estimate rather than local field truth. Synthetic test-suite responses are never loaded into the website as field data.

## BC VRI baseline and existing PGMaps conventions

The implementation was checked against `origin/main` at `0c5e454`, including `src/pages/dev-avast/vriFill.ts`, `VriWhatIfPanel.tsx`, `docs/forestry-avast-volume.md` and `src/pages/dev-forestry/bcVegetationInventory.ts`. It reuses the forestry WFS query builder (rank-1 endpoint, bounded longitude-first CQL filter, narrow fields) and follows AVAST's **sum of piece hectares × density**, with EPSG:3005 planar hectares. Geometry intersection is computed once; rule and selection changes only re-total those pieces.

`scripts/lidar/fetch_vri_volume.ts` explicitly refreshes a complete public WFS snapshot; it refuses truncation and preserves the response and request metadata under `scripts/lidar/sources/volume-vri.*`. `build_vri_volume.py` intersects original inventory polygons with the exact valid native LiDAR-height footprint, checks overlap before summing, preserves all net volume fields and computes CHM height/cover context separately. Neither VRI density nor stand volume is automatically scaled by LiDAR height or canopy cover. Within each piece, the inventory density is assumed uniform. Non-treed, unmapped, age-excluded and unavailable areas are reported separately from supported volume; missing values are not invented.

The fetched envelope contains 40 records, including 33 treed ones; only **30 inventory pieces, 24 treed**, intersect the supported tile. At 17.5 cm utilization, live only, all recorded ages:

| Result | Value |
| --- | --- |
| Supported LiDAR footprint, BC Albers | 228.17497 ha |
| Treed inventory area | 169.38973 ha |
| Non-treed inventory area | 58.78523 ha |
| Inventory net live volume | 36,796.19 m³ |
| Inventory projected date | 2025-12-31 |

The [VRI data dictionary](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/data-management/standards/vegcomp_poly_rank1_data_dictionaryv5_2019.pdf) defines `LIVE_STAND_VOLUME_125/175/225` and the corresponding dead fields as **net m³/ha** at the respective utilization levels, already deducting decay, waste and breakage. The UI therefore applies no second defect deduction or gross-to-merchantable conversion. All 22.5 cm volumes are unreported here; selecting that option clears volume numbers to unavailable. Dead volumes are mostly null; requesting dead inclusion adds only reported components and labels the live-only remainder as a **partial known sum**.

The pure shared module `src/lib/forestry/vriVolume.ts` carries the AVAST-aligned utilization and scenario arithmetic: pine-leading 12.5 cm versus other 17.5 cm, optional age ≥60, reported-dead inclusion and its PG shelf-life curve. The inventory baseline uses 17.5 cm/live only/all ages; **PG planning rules** are a separate preset. Shelf life uses earliest disturbance as a declared proxy for death, with an editable fallback when unavailable; this does not establish tree death dates or project inventory growth. Historical PG audit ratios (pine 0.836, spruce 0.946, balsam 1.246, other 1.159) are an optional, separately labelled sensitivity comparison, matching the AVAST tool; they are not local calibration or confidence intervals. No AVAST-derived LiDAR volume factor or automatic harvestability threshold is applied to this tile.

Selection, utilization, age, dead-volume and retention/recovery changes update the map and totals immediately. Exports preserve original inventory fields, nullable components, rule results, source/grid hashes, area method and scenario assumptions. The default 0% retained and 100% extraction recovery are neutral planning assumptions. The projected date is distinct from the inventory reference/interpretation dates and LiDAR acquisition; later disturbance is not automatically depleted.

Refresh/rebuild with `npx tsx scripts/lidar/fetch_vri_volume.ts`, then `python scripts/lidar/build_vri_volume.py` in the geospatial environment. The raw snapshot and generated products are app-owned, like the earlier local species snapshot; no scraper-owned vendor datasets are modified. Tests independently project output polygon rings back to BC Albers, account for holes, reconcile coverage and weighted volume, match raw snapshot attributes/hashes, check height-grid provenance and exercise rule changes, partial/missing data, selection and scenario export.

## Completed example: Forêt Montmorency

The [UBC IRSS 2026 workshop](https://james-f-mcglade.github.io/2026_lidRtutorial/07_aba.html) supplies field-derived merchantable volumes, plot locations and precomputed normalized-return metrics. Inputs are pinned to [commit 20ee191](https://github.com/james-f-mcglade/2026_lidRtutorial/tree/20ee19167c317e2f7209bf2f61170bf71f4a8148); the generator verifies five SHA-256 checksums before processing. The CSV and field geometry contain **169** matched records, despite introductory prose referring to 162. Field measurements are described as 2015–2016 and ALS as 2016.

We reproduced the tutorial's linear-model specification: merchantable stem m³/ha as a function of return-height p95, height skewness and the percentage of returns above 2 m. These are the source's point metrics, not the BC tile's CHM-surface predictors. We refitted the model and added five-fold spatial cross-validation, holding out consecutive geographic bands determined from sorted plot eastings. Each reference is predicted once without its band; there is no response-driven fold selection. The final display model is a refit on all 169 plots. These diagnostics are not an independent operational validation or confidence intervals.

The map preserves the source raster's **20 m cells** over the 2 × 2 km tutorial tile subset. The supplied forest mask is transformed from EPSG:32187 to the metric raster CRS EPSG:2949 and applied at pixel centres. Missing cells, non-forest cells, predictions outside the three-dimensional training predictor hull and negative predictions are excluded. Totals use complete grid-cell area; boundary cells are not corrected for partial forest area. No raw-cloud inference is claimed: the workshop computed the metrics; our processing reruns regression, diagnostics, masking and predictions.

| Completed result | Value |
| --- | --- |
| Subset area | 400 ha |
| Missing / non-forest cells | 2 / 925 |
| Out-of-domain / negative cells | 1,302 / 132 |
| Supported native cells | 7,639 |
| Supported grid area | 305.56 ha |
| Modelled merchantable stem volume | 35,272.22 m³ |
| Mean predicted volume | 115.43 m³/ha |
| Five-band CV RMSE / bias / R² | 53.84 m³/ha / −0.76 m³/ha / 0.561 |

The display provides volume/height switching, field-reference inspection with held-out predictions, cell inspection, an explicit retention/recovery scenario and GeoJSON export with provenance. The initial 20% retained and 90% recovery are demonstration assumptions, not inferred practices. The tutorial's merchantable-volume definition is retained; no gross-to-merchantable factor is introduced. This historical example is never applied to the BC tile or described as a current harvest appraisal.

Rebuild with `python scripts/lidar/build_volume_example.py --inputs /path/to/volume-inputs --download --output src/pages/dev-lidar/volume/example.generated.json`. The download option fetches missing public inputs at the pinned commit; dependencies are NumPy, SciPy, rasterio, shapely and pyproj. The generated snapshot is app-owned; raw tutorial rasters/GPKGs are not copied into the repository. Tests recompute error and volume totals, verify fold membership and native support, and exercise default results, inspection, scenario export and view switching.

## Research findings

| Approach | Inputs and output | Fit to our data |
| --- | --- | --- |
| Area-based estimation | Match measured plot volumes to LiDAR height/cover metrics; map m³/ha over comparable areas | Best initial fit: we already have grid metrics, but need measured volume references and local validation. |
| Individual-tree taper/allometry | Reliable tree instances, species, DBH, total height, taper equations and merchantability rules | Future option. Crown columns include structures, low stems are sparsely observed and the current crop excludes 0–2 m, so it cannot establish DBH. |
| Quantitative structure modelling | Dense observations of woody stems and branches, typically terrestrial scanning | Interesting for TLS/MLS uploads. Our airborne crown returns do not supply complete woody geometry. |
| Canopy-envelope or voxel occupancy | Geometric canopy space or occupied cells | Useful structure metrics, but not a measurement of solid stem wood or merchantable timber. |

NRCan's [2017 model development and application guide](https://publications.gc.ca/site/eng/9.843782/publication.html) supports modelling and mapping forest attributes with an area-based approach. The [lidR area-based tutorial](https://r-lidar.github.io/lidRbook/modelling.html) demonstrates matching ground inventory attributes and LiDAR metrics, then applying a fitted relationship at an appropriate spatial support. Its example uses point-cloud metrics and a different forest dataset; **its published coefficients are not used here**. [BC's LiDAR inventory page](https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory/forest-cover-inventories/light-detection-and-ranging) describes LiDAR-enhanced forest inventories as part of the provincial inventory program.

For tree-level timber volume, the [BC Cruise Compilation Manual](https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/timber-cruising/cruise-compilation-manual) is the relevant primary source for compilation methods. Diameter, height, taper and merchantability definitions matter; this feature does not implement or certify those procedures. [TreeQSM](https://github.com/InverseTampere/TreeQSM) reconstructs woody cylinders from single-tree laser scans, usually terrestrial; it was researched, not executed on our ALS crowns.

Our existing VRI source snapshot retains species/context fields, not plot-level reference volumes. It is not silently used as measured training truth. Ground-sample and current inventory sources could support a later calibration effort after location, footprint, dates and target definitions are matched.

## Implemented model

This first version is deliberately a transparent baseline:

`gross stem volume (m³/ha) = b0 + b1 × CHM surface p95 (m) + b2 × canopy fraction`

It uses the exact existing plot metrics from `forestry.generated.json`, not a borrowed pretrained model. CHM surface p95 is an area-based canopy-surface statistic; it is **not** Lorey's height or a return-height percentile. Only fully supported 2,500 m² plots with at least 5% canopy and p95 ≥ 2 m are eligible. This avoids treating partial tile edges or roof-excluded fragments as complete 0.25 ha reference plots.

The CSV format is `plot_id,volume_m3_ha`. References must match those footprints and use one consistent gross-volume definition, including bark/diameter conventions, and a compatible measurement period. The interface records the declared reference dataset/year/definition. A file remains local to the browser; no reference rows are uploaded to Sites. No default volume labels or regional coefficients are supplied.

The fitter accepts 10–200 distinct reference rows, centres/scales predictors, solves OLS, and refits each leave-one-out fold. Ten is a software minimum, not a recommended inventory design or sufficient validation sample. Collinear or insufficient predictor coverage is rejected. The map withholds estimates outside the two-dimensional convex hull of training height and cover; checking only separate min/max ranges would permit unsupported predictor combinations. Nonphysical negative predictions are also withheld.

RMSE and bias are in m³/ha, with leave-one-out R² where defined. These are diagnostics of the uploaded references, not independent spatial validation or confidence intervals. Spatially independent validation, representative species/age/site strata, measurement-date alignment and additional predictors/models remain necessary before operational use. A production extension could compare suitably tuned regressions, random forests and regional models with spatial validation; none is presented as validated for this tile today.

## Harvest scenario

Users select supported map plots. For these full, non-overlapping 0.25 ha footprints:

`gross stem m³ = Σ(predicted m³/ha × 0.25 ha)`

`scenario delivered m³ = gross × merchantable share × (1 − volume retained) × extraction recovery`

The percentages are explicit user assumptions; neutral defaults are 100% share, 0% retained and 100% recovery. They are not estimates of access, species-specific top diameters, log grades, defect, processing yield, restrictions or harvest eligibility. Unsupported selected plots are counted and excluded, not set to zero volume. The exported GeoJSON preserves source hash, selected plot geometries, fitted coefficients, reference data, diagnostic results and scenario assumptions.

## Validation and maintenance

The implementation lives in `src/pages/dev-lidar/volume/`: pure model functions are separate from map/UI code. Tests recover a known synthetic relationship on real source predictors, verify leave-one-out calculations, refuse missing/partial/out-of-domain inputs, reject bad reference rows and check m³/ha-to-area conversion and scenario fractions. An interaction test exercises no-calibration → CSV fit → map predictions → selection → export, then verifies that edited calibration clears old predictions. Synthetic test responses provide numerical verification only; they do not establish volume accuracy on the tile.

The component uses the same MapLibre comparison-map adapter and shared sidebar/metrics controls as the comparison workspace. The live browser connection was unavailable during implementation; numerical, data, interaction and build checks do not substitute for live WebGL visual QA.
