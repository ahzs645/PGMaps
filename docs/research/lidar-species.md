# Species mix from this LiDAR tile

The workbench now includes **Species mix · inventory** and **Species mix · model experiment**. The first shows recorded BC VRI composition; the second shows an actual LiDAR-only random-forest experiment evaluated against those inventory labels. Neither identifies individual trees.

## What ran

The pinned Rank-1 VRI query returned 40 polygons intersecting the geographic bounding box. Thirty intersect the supported 1 m height-grid footprint. Labelled intersections cover **169.25 ha**, with **58.74 ha** of other/unlabelled inventory. Geometry is clipped in EPSG:3157 to the supported footprint; areas are horizontal square metres. Supported area is 227.9933 ha. Sub-centimetre area discrepancies in totals are rounding.

The area-weighted composition index is approximately paper birch 48.0%, trembling aspen 22.9%, hybrid spruce 10.3%, poplar 9.9%, interior Douglas-fir 6.6%, subalpine fir 1.7% and interior lodgepole pine 0.6%. It averages each recorded composition by its labelled intersection area. It is **not** a measurement of the tile's fraction of stems, basal area, crown area or biomass. Non-treed and unlabelled polygons do not enter this denominator.

The model used **443 plots across 21 stands**, after requiring at least 95% eligible LiDAR support, at least 40% canopy above 5 m, finite predictor values and at least 80% of the full plot within one labelled stand's supported intersection. A plot crossing a stand boundary is excluded unless one stand clears that threshold. It does not acquire a label by nearest neighbour.

A multi-output `RandomForestRegressor` predicted seven inventory species percentages from 20 LiDAR features: canopy cover, surface P95, surface SD, mean 5 m texture, and all/first-return entropy, low-layer fraction and six height-band fractions. The existing forestry pipeline normalized the original returns to classified-ground terrain and excluded noise, withheld/legacy overlap and roof candidates plus 2 m. Inventory geometry assigns labels only. Coordinates, stand IDs, inventory height/age and species attributes are not predictors. The height surface still carries uncertainty from incomplete ground support and unverified roof exclusions.

Settings: scikit-learn 1.8.0; 128 trees; minimum leaf size 5; all features per split; seed 42; one CPU job. No model selection or tuning against these holdouts occurred. Each stand has equal total sample weight in fitting. Each fold excludes **every plot** assigned to one stand, then averages its predicted plot compositions. The baseline is the equal-stand mean composition of the other 20 stands. Scores average equally over the 21 held-out stands, rather than weighting large stands by their number of pixels.

| Mean absolute error, percentage points      | Random forest | Training-stand mean |
| ------------------------------------------- | ------------: | ------------------: |
| Broadleaf composition (EP + AT + AC)        |         19.01 |               18.03 |
| Species composition (mean over seven codes) |         10.84 |               11.04 |

The model **does not improve on the broadleaf baseline**. The small species-wise improvement does not establish useful species identification. The model view is retained to inspect a failed baseline comparison, including held-out predictions and missing validation coverage. No operational model is fitted or exported for deployment to another tile. The application renders precomputed results; it does not train in the browser.

## What the labels mean

BC VRI is an external inventory, often photo-interpreted and projected to another year. The source's reference year, interpretation date and projected date are preserved separately for each stand and shown in the interface. These are not independent field observations from the LiDAR acquisition. The LAZ filename indicates July 2024; that filename is not a validated phenology label.

Species codes preserve their inventory resolution: **AC means poplar**, rather than silently being narrowed to black cottonwood; SX means hybrid spruce. The first six species/percentage slots are retained and must sum to 100 for a usable composition label. Missing labels stay missing. The map displays the sum of EP, AT and AC, with purple for conifer-rich composition, green for broadleaf-rich composition and grey for unavailable values.

The experiment tests agreement with weak stand labels, not field accuracy or calibration. Entire stands are held out, but adjacent stands still share environmental and acquisition conditions. Twenty-one groups from one tile cannot demonstrate transfer to a different landscape, acquisition date or sensor. Small/rare components have little independent representation; a low mean seven-species error can hide poor rare-species performance. No confidence intervals or calibrated uncertainty are claimed. Crown candidates are not field-labelled stems and cannot be used as species truth.

## Models researched and why they were not used blindly

- [PureForest](https://huggingface.co/datasets/IGNF/PureForest) and its [primary paper](https://openaccess.thecvf.com/content/WACV2025/papers/Gaydon_PureForest_A_Large-Scale_Aerial_Lidar_and_Aerial_Imagery_Dataset_for_WACV_2025_paper.pdf) study airborne LiDAR and imagery over labelled French forests. Its 13 classes describe largely monospecific stands; the Canadian birch/aspen/poplar/lodgepole mix does not match that closed class set. An airborne classifier's dominant-class probability also does not equal a mixed stand's species proportions. The dataset is a useful design reference for forest-level geographic splits, not evidence that its classifier transfers here.
- [FOR-species20K](https://github.com/stefp/FOR-species20K) and its [paper](https://doi.org/10.1111/2041-210X.14503) benchmark species classification of individually segmented TLS, MLS and ULS trees. The tile is airborne LiDAR with no individual-tree species labels. A classifier for those segmented tree domains cannot be advertised as validated on these aerial crown candidates.
- [TreeLearn](https://github.com/ecker-lab/TreeLearn) segments tree instances in ground-based point clouds; that task alone does not assign species. Instance segmentation and species classification need separate validation.

No pretrained weights from those projects were executed. The random-forest experiment above **was** executed on this tile. It is a transparent local test of whether the available structural features explain the local inventory mixtures.

## A useful next processing workflow

1. Verify ground classification/terrain support, normalize heights and document acquisition season and return attributes. Retain NoData and roof exclusions.
2. Collect independent species-labelled field plots or reviewed crowns across several stands and landscapes. Preserve dates and label definitions. Plot mixtures require composition regression; individual trees require reliable instance segmentation and species labels.
3. Co-register leaf-on orthophotos, multispectral or hyperspectral imagery if available. Consumer satellite basemap imagery is display context with no spectral analysis provenance; it is not silently fed into this experiment. Check spatial resolution and dates before extracting spectral features.
4. Combine structural and spectral predictors, compare against composition and dominant-class baselines, and hold out stands and geographic regions. Report per-species errors, broadleaf/conifer error, rare-class support and transfer uncertainty. Keep field validation separate from training and model selection.
5. Only map unseen areas after the model passes those checks. Persist model version, training geography, sensor assumptions, input hashes and validation metrics with each result.

This workflow supports species-aware inventory review and field sampling. It does not justify assigning species to every crown, estimating biomass without appropriate calibration or diagnosing forest health from height alone.

## Reproduce and maintain

```sh
uv pip install --python /path/to/venv/bin/python -r scripts/lidar/requirements-species.txt
/path/to/venv/bin/python scripts/lidar/species.py \
  --analysis public/data/lidar-analysis/bc-093g086
python3 scripts/lidar/validate_species.py \
  --analysis public/data/lidar-analysis/bc-093g086
```

The script reads the tracked forestry snapshot and `scripts/lidar/sources/species-vri.geojson`. It writes `src/pages/dev-lidar/species.generated.json`: clipped inventory geometry, compositions, coverage, feature names, settings, per-fold training groups, plot assignments, held-out predictions, baseline predictions, metrics and input hashes. The pinned source snapshot retains original WFS geometry and only needed attributes. Re-running does not silently refresh labels. Update that source explicitly and rerun the model when adopting a new inventory version.

To refresh, use WFS 2.0 `GetFeature`, `outputFormat=application/json`, `srsName=EPSG:4326`, the stored type name and **CQL_FILTER** from the snapshot metadata. Request `GEOMETRY`, `FEATURE_ID`, `BCLCS_LEVEL_2`, `REFERENCE_YEAR`, `INTERPRETATION_DATE`, `PROJECTED_DATE` and the six `SPECIES_CD_n` / `SPECIES_PCT_n` pairs through `propertyName`. Require `numberMatched` to equal the fetched count; never accept a truncated response. CQL BBOX is longitude-first. Do not substitute WFS's latitude-first `bbox` parameter. Record retrieval time and preserve the Province's source/licence information.

The browser verifies the LiDAR source/input hashes and the exact forestry snapshot bytes before showing model products. The deployment validator also checks the pinned inventory hash, holdout membership, unique plot assignments, composition sums, coverage and recomputed errors. Downloads preserve inventory context and the full experiment separately from the usual forestry products. No raw point cloud is duplicated in the snapshot.

Sources: [BC VRI catalogue and licence](https://catalogue.data.gov.bc.ca/dataset/2ebb35d8-c82f-4a17-9c96-612ac3532d55), [provincial tree-code listing, Appendix G](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/forest-health/aerial-overview-survey/aos_standards_2019.pdf), [VRI data management](https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory/data-management-and-access), [VRI data dictionary](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/data-management/standards/vegcomp_poly_rank1_data_dictionaryv5_2019.pdf).
