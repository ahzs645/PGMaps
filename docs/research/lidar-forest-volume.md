# Forest stem volume and harvest scenarios

The practical next step for this airborne tile is an **area-based, field-calibrated volume model**. Counting candidate crowns and multiplying by height would also count some structures and would not provide stem diameter or wood volume.

The implemented workspace is `/dev/lidar/volume/`. It exposes the existing 50 × 50 m LiDAR-derived plot metrics, a ground-reference CSV template and matching GeoJSON footprints, a browser-local experimental regression, cross-validation diagnostics, mapped estimates and a selected-area harvest scenario. **No observed reference volumes were available for this tile, so the initial page does not report timber volumes.** It shows height context until the user supplies matching measurements. Test-suite responses are explicitly synthetic and are never loaded into the website as field data.

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
