# BCEnviroScreen Raw Data Inventory

Generated on 2026-06-30 while staging inputs to rebuild the BC EnviroScreen Shiny calculations from raw sources.

Large ignored raw inputs were moved out of the repo working tree to Google Drive on 2026-06-30 and symlinked back into their expected scraper paths:

- Google Drive base: `/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/University/Research/Grad/Data/PGMaps/BCEnviroScreen/`
- Environmental raw downloads: `raw-rebuild-seed-large/`
- Census raw downloads/caches: `census-bcenviroscreen-lha-raw/`
- Restricted CANUE source ZIP staging folder: `canue-source-zips/`

## Downloaded locally

### Shiny validation target

- Official Shiny displayed LHA indicator table: `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/official-shiny-table/lha-indicators.csv`
- Synced browser copy: `public/data/environmental-burden/bc-enviro-screen/official-shiny-table/lha-indicators.csv`

### All-BC WFS GIS layers

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/full-bc/` and synced to `public/data/environmental-burden/bc-enviro-screen/full-bc/`.

| Source | Features | Local size |
| --- | ---: | ---: |
| BC Environmental Remediation Sites | 27,844 | 19 MB |
| BC Wildfire Historical Fire Perimeters | 24,751 | 105 MB |
| BC Major Timber Processing Facilities | 252 | 304 KB |
| BC Permitted Mine Areas - Major Mine | 63 | 6.8 MB |
| BC Oil and Gas Fields | 576 | 1.9 MB |

### Compact rebuild seed

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/raw-rebuild-seed/compact/`.

- BC LHA boundaries.
- CANUE catalogue and LHA air-quality aggregates for 2012 and 2015. The cached R2 source files are about 7.9 MB.
- BC Data Catalogue / Open Canada metadata and small resources for EMS, NPRI, remediation sites, wildfire, timber facilities, mines, oil/gas, Human Disturbance, and Integrated Roads.
- Official Shiny benchmark table copy when present.

### Large raw files pulled

Stored in Google Drive at `PGMaps/BCEnviroScreen/raw-rebuild-seed-large/`, symlinked into `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/raw-rebuild-seed/large/`.

| Source | File | Bytes |
| --- | --- | ---: |
| BC Human Disturbance 2025 | `large/bc-human-disturbance-2025/2025-data.fgdb.zip` | 1,254,636,730 |
| BC CEF Integrated Roads 2026 | `large/bc-cef-integrated-roads-2026/2026-data.fgdb.zip` | 462,629,376 |
| Digital Road Atlas FileGDB | `large/digital-road-atlas/dgtl_road_atlas.gdb.zip` | 315,479,315 |
| Digital Road Atlas Parquet cache | `large/digital-road-atlas/parquet/` | ~417 MB |
| EMS water quality | `large/bc-environmental-monitoring-system-results/ems-sample-results-current-csv.csv` | 487,569,348 |
| EMS water quality | `large/bc-environmental-monitoring-system-results/ems-sample-results-historic-csv.csv` | 5,014,048,850 |
| EMS nitrate subset | `large/bc-environmental-monitoring-system-results/ems-sample-results-expanded-all-nitrate-1109-csv.csv` | 116,741,173 |
| BCEnviroScreen linear footprint paged GeoJSON | `large/linear-footprint/` | ~937 MB |

### EMS working Parquet

The EMS CSVs are too large and too wide for routine analysis. A project-focused normalizer now streams the raw current/historic EMS CSVs and writes compressed Parquet for broad BCEnviroScreen water-exceedance candidate parameters:

```bash
npm run environmental-burden:bc-enviro-screen:ems-parquet
```

Large Parquet outputs stay in the Google Drive-backed large folder and are not synced to `public/data`:

| Source | Rows | Collection years | Parquet file | Size |
| --- | ---: | --- | --- | ---: |
| EMS current | 222,848 | 2025-2026 | `large/bc-environmental-monitoring-system-results/parquet/bcenviroscreen-water-parameters-current.parquet` | 4.8 MB |
| EMS historic | 2,387,129 | 1965-2024 | `large/bc-environmental-monitoring-system-results/parquet/bcenviroscreen-water-parameters-historic.parquet` | 61 MB |

Small decoded metadata and row-count summaries are stored in `raw-rebuild-seed/compact/bc-environmental-monitoring-system-results/` and synced to `public/data/environmental-burden/bc-enviro-screen/raw-rebuild-seed/compact/bc-environmental-monitoring-system-results/`.

Candidate parameter groups currently preserved:

| Indicator family | EMS parameter codes |
| --- | --- |
| Lead | `PB-D`, `PB-T` |
| E. coli | `0147` |
| Nitrate/nitrite | `1109`, `1110`, `1111` |
| Mercury | `HG-D`, `HG-T` |
| Phosphorus | `0118`, `1118`, `P--D`, `P--T` |
| Total organic carbon | `0103`, `TOC63U` |

These Parquet files are a working subset, not the final water-exceedance indicator. The next EMS step is to apply the paper's four-year window, QA/sample-medium filters, source-water guideline thresholds, and station-to-LHA spatial join.

### EMS LHA water-exceedance candidates

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-ems-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-ems-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:ems-lha
```

The script assigns EMS monitoring stations to current BC LHA polygons, applies BC source drinking water guideline thresholds, and compares multiple four-year/filter/formula candidates to the Shiny `water_quality_exceedances` column.

The article's Table 1 definition is now encoded directly: "percent of EMS sample locations in each LHA with an exceedance" of the listed thresholds. This corrected denominator is a much better fit than the earlier provisional "share of indicator families" formula.

Current staged outputs:

| Output | Description | Size |
| --- | --- | ---: |
| `ems-station-lha-crosswalk.csv` | 14,011 EMS station-coordinate assignments to LHAs | 602 KB |
| `lha-water-quality-exceedance-candidates.csv` | Candidate LHA values across tested windows/filter rules | 647 KB |
| `shiny-comparison-summary.csv` | Candidate fit against Shiny water indicator | 9.9 KB |
| `shiny-comparison-long.csv` | Per-LHA candidate differences | 1.0 MB |

Guideline thresholds currently encoded:

| Indicator family | EMS parameter code(s) used | Threshold |
| --- | --- | --- |
| Lead | `PB-T` | `> 0.005 mg/L` |
| E. coli | `0147` | paper-specific candidates use result `> 10 / 100 mL`; strict guideline candidates also test station 90th percentile |
| Nitrate | `1110` | paper-specific candidates use NO3 dissolved `> 45 mg/L` |
| Mercury | `HG-D`, `HG-T` | paper-specific candidates use mercury all measures `> 0.001 mg/L` |
| Phosphorus | `P--T` | paper-specific candidates use total phosphorus `> 0.01 mg/L`; strict lake-only applicability remains unresolved |
| Total organic carbon | `0103` | `> 4 mg/L` |

Best current validation candidate:

| Candidate | Rows | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `2016_2019_freshwater_qa_no_f_paper_sample_location_any_exceedance_share` | 78 | 0.080 | 0.888 | 0.660, rounds to 0.7 | 0.7 | Strong candidate; uses the paper denominator, freshwater samples, and the official EMS warning to exclude QA `F`. Exact archived source extract still needs confirmation. |

The paper cites `BC Environmental Monitoring System Results - 4 Year Current Results` accessed on 2020-09-23. The best validation window is 2016-2019, consistent with a four-year current extract available near the paper's data-access date. Exact reproduction still needs the archived 2020 EMS current extract or confirmation of the precise sample-location filters.

Archive search result: no public 2020 binary was found for `ems_sample_results_4yr_current_expanded.csv`. BC CKAN identifies the resource as `538bf452-525d-4ed3-bc7c-bdb4b6f0cc90` at `https://pub.data.gov.bc.ca/datasets/949f2233-9612-4b06-92a9-903e817da659/ems_sample_results_4yr_current_expanded.csv`, but its historical activity feed does not expose file hashes/sizes. Wayback has no 2020 capture for the CSV; the closest available raw capture found is 2023-08-22 with original content length about 1.96 GB. A 2023 Wayback download could be used for sensitivity testing, but it is not the paper-era 2020 extract.

### Census socioeconomic inputs

Stored in `vendor/bcdatamapper/datascrapers/census/output/bcenviroscreen-census-lha/` and synced, without raw ZIP/shapefile payloads, to `public/data/census/bcenviroscreen-census-lha/`.

The raw Census ZIPs, extracted DA shapefiles, and selected-record caches are stored in Google Drive at `PGMaps/BCEnviroScreen/census-bcenviroscreen-lha-raw/`, symlinked into `vendor/bcdatamapper/datascrapers/census/output/bcenviroscreen-census-lha/raw/`.

| Census year | DA records | DA-to-LHA assigned | Missing DA points | Output |
| --- | ---: | ---: | ---: | --- |
| 2016 | 7,617 | 7,616 | 1 | `2016/lha-socioeconomic.csv` |
| 2021 | 7,848 | 7,846 | 2 | `2021/lha-socioeconomic.csv` |

The 2016 table is the paper-era socioeconomic source family. The 2021 table is the newest completed Canadian Census currently available in this project. DA-to-LHA assignment uses each DA boundary representative point against the current BC Ministry of Health LHA boundaries.

The raw StatCan Census Profile files are long row-wise ZIP downloads. To avoid rescanning them on every rebuild, the scraper now materializes compact DA caches in `raw/CA16_bc_da_selected_records.json` and `raw/CA21_bc_da_selected_records.json`. A cached Census rebuild dropped from about 2 minutes 38 seconds to about 10 seconds.

A separate 2011 population-only attempt was added for the PHSA cancer denominator:

```bash
npm run census:bcenviroscreen-2011-population
```

That script uses CensusMapper 2011 DA population (`v_CA11F_1`) and joins DAUIDs to the existing 2016 DA-to-LHA crosswalk. The current public API route is not sufficient for a full BC rebuild under the available API limits: the latest run matched only `307` DA rows and skipped `4,241,604` people worth of CD/CSD regions, including Prince George. The partial 2011 candidate is therefore retained as diagnostic output, but the validation harness now ignores low-coverage candidates when selecting `best-current` mappings.

Current Census validation against Shiny:

| Shiny indicator | Best current field | Prince George rebuilt | Prince George Shiny | All-BC note |
| --- | --- | ---: | ---: | --- |
| Low education | 2016 `low_education_15plus_percent` | 20.776 | 20.8 | Strong match; age 15+ definition fits better than the paper-text 25-64 definition. |
| Linguistic isolation | 2016 `linguistic_isolation_percent` | 0.345 | 0.4 | Strong match. |
| Low income | 2016 `lico_all_percent` | 7.307 | 7.7 | Stronger all-BC fit than LIM-AT candidates; likely the Shiny field used LICO-AT or a closely related 2016 low-income table despite the paper text naming LIM-AT age 18-64. |
| Housing burdened | 2016 `renter_housing_burden_percent` | 32.551 | 38.1 | Best current candidate, but still not exact. The paper definition is owner+tenant households, yet the DA-summed owner+tenant field is much too low for Shiny. |
| Employment insurance / unemployment | 2016 `unemployment_percent` | 9.129 | 2.2 | Not a match. The Shiny column appears to use a separate employment-insurance-beneficiary source or denominator, not the standard Census unemployment rate. |

### PHSA health outcome candidates

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-health-lha/` and synced through the combined validation/score outputs.

```bash
npm run environmental-burden:bc-enviro-screen:health-lha
```

The builder normalizes PHSA Community Health Atlas LHA CSV downloads for cancer, chronic disease, and mother/newborn health. It creates one wide LHA candidate table and lets the validation harness choose the closest candidate for each Shiny sensitive-population indicator.

Current health validation against Shiny:

| Shiny indicator | Best current PHSA candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| All causes of cancer | `phsa_cancer_all_cause_cancer_incident_cases_all_ages_2008_2012_total_per_1000_pop2016` | 1.418 | 0.9768 | 22.762 | 23.5 | Strong proxy. The paper uses 2008-2012 cases divided by 2011 population; the current 2011 CensusMapper pull is too incomplete for all-BC use, so the selected candidate still uses 2016 population. |
| COPD | `phsa_general_health_chronic_obstructive_pulmonary_disease_copd_age_standardized_incidence_rate_per_1000_population_45plus_yrs_2015_per_1000_population` | 0.011 | 1.0000 | 9.7 | 9.7 | Essentially matched for available LHAs. |
| Diabetes mellitus | `phsa_general_health_diabetes_mellitus_age_standardized_incidence_rate_per_1000_population_1plus_yrs_fy_2015_2016_per_1000_population` | 0.412 | 0.9890 | 6.8 | 6.4 | Strong all-BC fit, small PG residual. |
| Hypertension | `phsa_general_health_hypertension_age_standardized_incidence_rate_per_1000_population_20plus_yrs_fy_2015_2016_male_per_1000_population` | 2.037 | 0.8283 | 20.2 | 23.2 | Best current candidate but still weak; likely exact Shiny input used another PHSA chronic-disease vintage/sex/definition or BCCDC table not yet captured at LHA level. |
| Low birth weight | `phsa_mother_and_newborn_health_low_birth_weight_rate_per_1_000_live_births_2011_2015_per_1_000_live_births` | 0.001 | 1.0000 | 58.7 | 58.7 | Matched for available LHAs. |

The local BCCDC Tableau probe currently captures only BC and Health Authority rows, not LHA/CHSA rows, so it is not yet useful for replacing the PHSA LHA chronic-disease candidates.

### First rebuilt spatial indicators

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-spatial-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-spatial-lha/`.

- `lha-spatial-indicators.csv`: rebuilt LHA spatial indicators from all-BC GIS layers.
- `shiny-comparison-long.csv`: one row per LHA/indicator comparison.
- `shiny-comparison-summary.csv`: all-BC fit summary against the Shiny table.

Initial validation results:

| Shiny indicator | Best current rebuilt field | Mean absolute difference | Pearson r | Notes |
| --- | --- | ---: | ---: | --- |
| Wildfire burn area | `wildfire_2010_2019_area_percent` | 0.049 | 0.9998 | Strong match; confirms 2010-2019 burn-area percent. Prince George rebuild is 1.515 vs Shiny 1.5. |
| Remediation sites | `remediation_sites_site_id_lte_23504_count` | 0.820 | 0.99999 | Empirical paper-era source-vintage proxy using `SITE_ID <= 23504`. Prince George rebuild is 575 vs Shiny 575. Current-source count remains 656 for Prince George. |
| Industrial sites | `industrial_sites_timber_operating_mines_oil_unique_count` | 1.978 | 0.8371 | Stronger PG/all-BC count candidate: timber facilities + operating major mine representative points + unique oil field names. Prince George rebuild is 19 vs Shiny 19. |

The first industrial-site proxy counted all oil/gas field polygon intersections, which severely over-counted northeast LHAs. The current best candidate instead assigns oil/gas field representative points to LHAs and counts unique oil-field names, combined with timber facility points and operating major mine representative points. Remediation and oil/gas layers do not expose usable source-date fields in the current WFS payload, and timber only exposes a 2026 update date plus current status.

The paper's `linear_footprint` indicator is a separate line-density calculation. The downloader stores BCER/BCGW line sources as paged GeoJSON in EPSG:3005 under `large/linear-footprint/` so lengths can be measured directly in metres:

```bash
npm run environmental-burden:bc-enviro-screen:linear-footprint-sources
```

Downloaded default line-source cache:

| Paper/source family | Local layer id | Feature count downloaded | Size | Notes |
| --- | --- | ---: | ---: | --- |
| Geophysical Lines (Permitted) | `bcer_geophysical_lines_2020_no_handcut_aero` | 146,113 | 127 MB | Active through 2020 using approval/cancel dates; excludes handcut/aeromagnetic by `CUT_TYPE_DESC`. |
| Geophysical Plans (1996-2004) | `bcer_geophysical_final_plans_1996_2004_no_handcut_aero` | 192,458 | 77 MB | Static final-plan line layer; excludes handcut/aeromagnetic by `CUT_TYPE`/`METHOD`. |
| Pipeline Segments (Permitted) | `bcer_pipeline_segments_2020` | 4,359 | 12 MB | Active through 2020 using approval/cancel dates. |
| Forest tenure road sections | `bcgw_forest_tenure_road_sections` | 284,375 | 703 MB | BC Geographic Warehouse layer 196. |
| Railway track | `bcgw_railway_track` | 10,055 | 7.1 MB | BC Geographic Warehouse layer 257. |
| BC transmission lines | `bcgw_transmission_lines` | 3,696 | 5.8 MB | BC Geographic Warehouse layer 130. |

Digital Road Atlas was staged from the local BC Data Catalogue FileGDB ZIP at `/Users/ahmadjalil/Downloads/dgtl_road_atlas.gdb.zip`, copied into `large/digital-road-atlas/dgtl_road_atlas.gdb.zip`. It contains:

| DRA layer | Feature count | Use |
| --- | ---: | --- |
| `DGTL_ROAD_ATLAS_MPAR_SP` | 1,920,718 | Main DRA candidate and forest-road de-duplication source. |
| `DGTL_ROAD_ATLAS_DPAR_SP` | 499,114 | Diagnostic candidate; much too sparse for Shiny `linear_footprint`. |

The FileGDB ZIP was also converted into a project-specific Parquet cache:

```bash
npm run environmental-burden:bc-enviro-screen:dra-parquet
```

| Cache | Rows | Size | Notes |
| --- | ---: | ---: | --- |
| `parquet/dgtl_road_atlas_mpar.parquet` | 1,920,718 | 366 MB | Stores `id`, `length_2d_m`, and EPSG:3005 WKB geometry. |
| `parquet/dgtl_road_atlas_dpar.parquet` | 499,114 | 50 MB | Same schema for DPAR. |

The spatial rebuild now prefers the Parquet cache and falls back to the FileGDB ZIP if Parquet is missing. This makes DRA reads simpler and lowers memory during the read/assignment phase, but the 1 km forest-road de-duplication geometry query is still the expensive step. A future speed-up should cache the de-duplicated forest-road length by LHA.

The REST downloader can still pull DRA MPAR explicitly, but the FileGDB ZIP is faster and is now the preferred local source:

```bash
npm run environmental-burden:bc-enviro-screen:linear-footprint-sources -- --layers bcgw_digital_road_atlas_mpar
```

Current line-density validation after adding DRA MPAR/DPAR and implementing the paper de-duplication rule:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `paper_dedup_linear_footprint_km_per_sq_km` | 0.180 | 0.9990 | 0.899 | 0.95 | Best current match: BCER lines + forest roads not within 1 km of DRA MPAR + railway + transmission + DRA MPAR. |
| `bcgw_digital_road_atlas_mpar_km_per_sq_km` | 0.560 | 0.9884 | 0.848 | 0.95 | DRA MPAR alone explains most of the PG value. |
| `paper_available_plus_dra_linear_footprint_km_per_sq_km` | 0.610 | 0.9966 | 1.278 | 0.95 | Over-counts because forest roads duplicate DRA roads. |
| `bcgw_digital_road_atlas_dpar_km_per_sq_km` | 1.841 | 0.9732 | 0.137 | 0.95 | DPAR is too sparse for the Shiny indicator. |
| `paper_available_linear_footprint_km_per_sq_km` | 2.924 | 0.7479 | 0.430 | 0.95 | Missing DRA/general road network. |
| `bcer_linear_footprint_km_per_sq_km` | 3.869 | 0.3586 | 0.0056 | 0.95 | Confirms BCER oil/gas lines alone are not enough for Prince George. |

Implementation detail: DRA MPAR/DPAR line lengths are assigned to LHAs by each DRA segment's representative point and source `LENGTH_2D`; the other line sources are clipped against LHA polygons. The forest-road de-duplication candidate excludes forest-tenure road sections within 1 km of any DRA MPAR segment.

### CANUE R2 LHA air-quality candidates

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-canue-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-canue-lha/`.

- R2 aggregate catalogue: `https://data.map.ahmad.sh/canue/aggregates-v2/canue-bc-aggregates-v2-catalog.json`
- R2 aggregate URL shape: `https://data.map.ahmad.sh/canue/aggregates-v2/{source}/{level}/{family}_{year}_aggregate.json`
- Pulled candidates: `bcHealth/lha/air-quality_2012_aggregate.json` and `bcHealth/lha/air-quality_2015_aggregate.json`.
- Output size: about 2.3 MB for the rebuilt CANUE comparison tables.

R2 validation against Shiny:

| Shiny indicator | Best current R2 field | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| PM2.5 | `canue_2012_pm25dal_a__pm25dal12_01` | 0.558 | 0.8444 | 3.303 | 5.6 | Useful proxy, not exact. |
| Ozone | `canue_2015_aqozn_mn_annual_mean` | 0.347 | 0.9918 | 21.961 | 20.5 | Strong all-BC pattern, but PG remains high by 1.46. |

These files are public R2 aggregate derivatives. They do not replace the restricted CANUE postal-code source extracts if exact paper-era reproduction is required.

The repo now has a postal-code CANUE LHA wrapper that uses the existing restricted-source aggregator:

```bash
npm run environmental-burden:bc-enviro-screen:canue-postal-lha
```

That command expects restricted CANUE source ZIPs in Google Drive under `PGMaps/BCEnviroScreen/canue-source-zips/`. Current local search did not find those ZIPs. To continue exact PM2.5/ozone reproduction, add at least one PM2.5 ZIP matching one of:

- `pm25dal_a_*.zip`
- `pm25dalb_a_*.zip`
- `pm25dalc_a_*.zip`

and at least one ozone ZIP matching one of:

- `o3chg_a_*.zip`
- `aqozn_mn_*.zip`
- `aqozn_8h_*.zip`

Then rerun the command above. It will build postal-code-point LHA aggregates for air quality in 2012 and 2015 using `bcHealth/lha` boundaries.

On 2026-06-30, the CANUE portal at `https://www.canuedata.ca/download.php` was checked under Ahmad Jalil's logged-in CANUE account. The needed BCEnviroScreen air-quality source files were found and downloaded into the Google Drive staging folder:

| Indicator | Portal menu | Selection | Generated ZIP |
| --- | --- | --- | --- |
| PM2.5 | Annual Data -> Air Quality -> Fine Particulate Matter (PM2.5 v1) | Annual average PM2.5 Concentration, 2012, British Columbia | `canue-source-zips/pm25dal_a_2026-06-30_09-24-44_annual.zip` |
| Ozone | Annual Data -> Air Quality -> Ozone (O3) | O3 Annual average, 2015, British Columbia | `canue-source-zips/o3chg_a_2026-06-30_09-25-33_annual.zip` |

The postal-code wrapper now successfully builds LHA aggregates from those ZIPs:

| Indicator | Postal source field | Postal rows matched to LHA | Prince George rebuilt | Prince George Shiny | All-BC validation |
| --- | --- | ---: | ---: | ---: | --- |
| PM2.5 | `canue_postal_2012_pm25dal_a__pm25dal12_01` | 108,741 / 111,080 | 5.665 | 5.6 | MAD 0.101, r 0.9872 |
| Ozone | `canue_postal_2015_o3chg_a__o3chg15_01` | 114,408 / 117,343 | 20.532 | 20.5 | MAD 0.102, r 0.9982 |

This confirms the earlier mismatch was caused by using public R2 PMTiles grid-cell aggregates instead of the paper's postal-code centroid aggregation method.

### Combined validation harness

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-validation/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-validation/`.

- `candidate-comparison-summary.csv`: every candidate rebuild field scored against the Shiny table.
- `candidate-comparison-long.csv`: per-LHA differences for every candidate.
- `best-current-mapping.csv`: lowest-mean-absolute-difference candidate per Shiny indicator.
- `best-current-indicators.csv`: one LHA table with Shiny value, rebuilt value, difference, and selected source field.

Current best selected fields:

| Shiny indicator | Best current source field | Prince George rebuilt | Prince George Shiny | Status |
| --- | --- | ---: | ---: | --- |
| Wildfire burn area | `spatial.wildfire_2010_2019_area_percent` | 1.515 | 1.5 | Matched. |
| Low education | `census_2016.low_education_15plus_percent` | 20.776 | 20.8 | Matched. |
| Linguistic isolation | `census_2016.linguistic_isolation_percent` | 0.345 | 0.4 | Matched within rounding. |
| Industrial sites | `spatial.industrial_sites_timber_operating_mines_oil_unique_count` | 19 | 19 | PG matched; all-BC MAD improved from about 7.2 to 2.0. |
| Ozone | `canue_postal.canue_postal_2015_o3chg_a__o3chg15_01` | 20.532 | 20.5 | Matched within rounding/portal-vintage noise. |
| PM2.5 | `canue_postal.canue_postal_2012_pm25dal_a__pm25dal12_01` | 5.665 | 5.6 | Matched within rounding/portal-vintage noise. |
| Water quality exceedances | `ems.2016_2019_freshwater_qa_no_f_paper_sample_location_any_exceedance_share` | 0.660 | 0.7 | PG matches after rounding; all-BC fit improved but exact archived EMS extract still unresolved. |
| Linear footprint | `spatial.paper_dedup_linear_footprint_km_per_sq_km` | 0.899 | 0.95 | Strong all-BC match after adding DRA MPAR and removing forest roads within 1 km of DRA. |
| Low income | `census_2016.lico_all_percent` | 7.307 | 7.7 | Strong all-BC fit; better than the paper-text LIM-AT age 18-64 candidate. |
| Housing burdened renters | `census_2016.renter_housing_burden_percent` | 32.551 | 38.1 | Proxy, not exact. |
| Remediation sites | `spatial.remediation_sites_site_id_lte_23504_count` | 575 | 575 | Strong paper-era/source-vintage proxy; current source over-counts Shiny. |
| All causes of cancer | `health.phsa_cancer_all_cause_cancer_incident_cases_all_ages_2008_2012_total_per_1000_pop2016` | 22.762 | 23.5 | Strong proxy; exact paper denominator needs 2011 LHA population. |
| COPD | `health.phsa_general_health_chronic_obstructive_pulmonary_disease_copd_age_standardized_incidence_rate_per_1000_population_45plus_yrs_2015_per_1000_population` | 9.7 | 9.7 | Matched. |
| Diabetes mellitus | `health.phsa_general_health_diabetes_mellitus_age_standardized_incidence_rate_per_1000_population_1plus_yrs_fy_2015_2016_per_1000_population` | 6.8 | 6.4 | Strong proxy. |
| Hypertension | `health.phsa_general_health_hypertension_age_standardized_incidence_rate_per_1000_population_20plus_yrs_fy_2015_2016_male_per_1000_population` | 20.2 | 23.2 | Proxy; exact input still unresolved. |
| Low birth weight | `health.phsa_mother_and_newborn_health_low_birth_weight_rate_per_1_000_live_births_2011_2015_per_1_000_live_births` | 58.7 | 58.7 | Matched. |
| Disturbed landscape | `ifl.ifl_2016_disturbed_area_percent` | 54.329 | 54.3 | Matched from Intact Forest Landscapes 2016; disturbed percent = 100 - IFL area percent. |
| Traffic density | `spatial.bcgw_digital_road_atlas_dpar_km_per_sq_km` | 0.137 | 26727 | Rank-only diagnostic proxy; units do not match Shiny traffic density. This field was selected by highest Pearson correlation, not raw-value error. |

### Disturbed landscape and traffic-density follow-up

Intact Forest Landscapes output is stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-ifl-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-ifl-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:ifl-lha
```

The 2000 and 2016 IFL GeoPackages are staged in Google Drive-backed large storage from:

- `https://intactforests.org/shp/IFL_2000.gpkg`
- `https://intactforests.org/shp/IFL_2016.gpkg`

The builder detects available `IFL_*.gpkg` files, clips each year to LHA boundaries in EPSG:3005, and emits year-specific fields such as:

- `ifl_2000_intact_area_percent`
- `ifl_2000_disturbed_area_percent = 100 - intact percent`
- `ifl_2016_intact_area_percent`
- `ifl_2016_disturbed_area_percent = 100 - intact percent`

This is the best current match for Shiny `disturbed_landscape`:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `ifl_2016_disturbed_area_percent` | 0.062 | 0.9999 | 54.329 | 54.3 | Matched; this is the Shiny source/vintage in practice. |
| `ifl_2000_disturbed_area_percent` | 1.154 | 0.9952 | 52.017 | 54.3 | Strong source-family match, but clearly weaker than 2016. |

Modern BC Human Disturbance 2025 proxy output is also stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-disturbed-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-disturbed-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:disturbed-lha
```

This builder extracts `BC_Human_Disturbance_2025.gpkg` from the staged `2025-data.fgdb.zip`, streams the `BC_Human_Disturb_noBTM_2025_merge` layer, assigns each disturbance polygon to an LHA by representative point, and sums `AREA_HA`.

Modern BC Human Disturbance 2025 validation result:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `human_disturbance_2025_rep_point_area_percent` | 84.272 | 0.1372 | 22.188 | 54.3 | Poor match. It undercounts urban/agricultural LHAs badly, e.g. Abbotsford rebuild `3.25` vs Shiny `100`. |

Conclusion: IFL 2016 is the disturbed-landscape source that matches Shiny. The staged BC Human Disturbance 2025 layer is useful as a modern landscape-pressure layer, but it is not the BCEnviroScreen disturbed-landscape source.

Traffic-density source discovery found BC Data Catalogue traffic-volume archives and the Ministry Traffic Data Program:

| Source | Local staging | Notes |
| --- | --- | --- |
| BC Annual Traffic Volumes 2004-2010 | `raw-rebuild-seed/compact/traffic-volume-sources/annual-traffic-volumes-2004-2010.xlsx` | Small XLSX with route, description, direction, site id, and yearly AADT-like values. No coordinates or geometry in the spreadsheet. |
| BC Monthly Traffic Volumes Jan-Jun 2011 | `raw-rebuild-seed/compact/traffic-volume-sources/monthly-traffic-volumes-jan-jun-2011.xlsx` | Permanent-counter MADT/MAWDT/MAWET sheets. No coordinates or geometry in the spreadsheet. |
| Traffic Data Program app | `raw-rebuild-seed/compact/traffic-data-program/tig-utv-segment-ext.geojson` | Current web app exposes WFS layers from `https://maps.th.gov.bc.ca/geoV05/ows`. The UTV segment layer is useful source discovery but does not reproduce Shiny traffic density. |

Traffic Data Program UTV output is stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-traffic-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-traffic-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:traffic-lha
```

The builder clips `tig:TIG_UTV_SEGMENT_EXT` segments to LHA boundaries in EPSG:3005 and aggregates `MAP_RENDERING_AADT` weighted by clipped segment length.

Current validation:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `traffic_data_program_utv_aadt_m_per_sq_km` | 687,835.543 | 0.5420 | 8,517.494 | 26,727 | Poor match; source covers Ministry UTV highway segments, not the coarser Shiny traffic table. |
| `traffic_data_program_utv_aadt_km_per_sq_km` | 268,593.854 | 0.5420 | 8.517 | 26,727 | Same source scaled to km; units do not match Shiny. |

Existing road-density fields were added as diagnostic traffic proxies. Their raw units do not match Shiny `traffic_density`, but road-density ranks correlate with Shiny traffic density:

| Proxy | Pearson r vs Shiny traffic density | Prince George proxy | Prince George Shiny |
| --- | ---: | ---: | ---: |
| `bcgw_digital_road_atlas_dpar_km_per_sq_km` | 0.8090 | 0.137 | 26727 |
| `paper_dedup_linear_footprint_km_per_sq_km` | 0.7667 | 0.899 | 26727 |
| `bcgw_digital_road_atlas_mpar_km_per_sq_km` | 0.7629 | 0.848 | 26727 |

The validation harness selects the diagnostic traffic proxy by highest Pearson correlation because the source units are intentionally not comparable.

The paper defines traffic as "Annual average daily traffic counts attributed to LHA's from a Census Division level" and cites BC Ministry of Transportation, 2018. The Shiny traffic table confirms that coarser attribution pattern: most LHAs sharing a Census Division have identical traffic values. Exact reproduction needs the paper-era 2018 Census-Division AADT table, not only current Traffic Data Program geometries.

### Score rebuild harness

The score math is now separated from the source rebuilds:

```bash
npm run environmental-burden:bc-enviro-screen:scores
```

Outputs are stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-scores/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-scores/`.

The implemented score method is:

1. Rank each raw indicator among non-zero LHA values and convert to percentile.
2. Assign true zero values a percentile score of zero.
3. Average indicator percentiles into `exposures`, `environmental_effects`, `sensitive_populations`, and `socioeconomic_factors`, excluding missing values.
4. Calculate population characteristics from sensitive populations and socioeconomic factors.
5. Calculate landscape burden from exposures plus half-weighted environmental effects.
6. Scale landscape burden and population characteristics to 10 against their maximum LHA values.
7. Multiply the two scaled scores for the overall score.

Validation from the official Shiny raw indicator columns shows the formula is essentially reproduced:

| Score field | All-BC MAD | Pearson r | Prince George rebuilt | Prince George Shiny |
| --- | ---: | ---: | ---: | ---: |
| `landscape_burden_score` | 0.078 | 0.9980 | 8.099 | 8.1 |
| `population_characteristics_score` | 0.031 | 0.9995 | 7.160 | 7.1 |
| `overall_score` | 0.465 | 0.9991 | 57.990 | 57.6 |

The `hybrid-best-current-with-shiny-gaps` mode substitutes currently rebuilt indicators and carries Shiny values only for still-missing raw inputs: climate and employment insurance, plus Shiny fallback values where public PHSA health rows are suppressed or missing. It now includes IFL 2016 disturbed landscape and a rank-only traffic proxy. Prince George overall is `55.546` vs Shiny `57.6` (All-BC MAD `4.012`, r `0.9271`). This is useful as a rank-oriented rebuild test, but not an exact reproduction because traffic still uses road-density proxy units.

## Still queued or missing

- NPRI bulk releases, disposals, transfers, geolocations, and comments. The ECCC API did not expose reliable `Content-Length` headers, and the local disk had only about 5.3 GiB free after the core downloads.
- Expanded EMS current and historic CSVs. The expanded historic file alone is about 8.0 GB, so it was intentionally skipped on this disk.
- Exact BCEnviroScreen paper-era CANUE postal-code PM2.5 and ozone extract is now mostly resolved through the CANUE portal's current annual BC postal-code ZIPs. The postal-code method closely reproduces Shiny, with small residual differences likely due to app rounding, current portal vintage, or boundary version.
- Exact socioeconomic match to the Shiny app for every indicator. Low education, linguistic isolation, and low income now have strong 2016 matches. Housing burden remains unresolved: the paper definition is owner+tenant households spending 30% or more on shelter, but DA-summed owner+tenant values are much lower than Shiny, renter-only values are closer but still low, and added owner/owner+renter split candidates are worse all-BC. Employment insurance/unemployment is also unresolved; Census unemployment is not close to the Shiny `employment_insurance_beneficiaries` column, and the exact source may be a tax-filer/EI-beneficiary table rather than the Census labour-force row.
- Climate projection inputs for future temperature and precipitation. The Shiny benchmark table is staged, including Prince George `future_temperature=1.7` and `future_precipitation=-1.1`, but the raw PCIC/Plan2Adapt 2020 Census-Division table used to regenerate those values is not staged. The current Plan2Adapt app has moved to CMIP6/SSP5-8.5 regional summaries with 1981-2010 baseline and later projection periods, so it is a proxy source rather than the paper's exact 2010-2039 vs 1961-1990 input.
- Exact health inputs for all LHAs. COPD and low birth weight are essentially reproduced from PHSA public LHA downloads. Diabetes is close, cancer needs 2011 LHA population as the denominator, and hypertension still needs the exact chronic-disease metric/vintage used by the Shiny app.
- Province-wide traffic-density raw source. BC traffic-volume archives and current Traffic Data Program UTV geometry are now staged, but neither reproduces Shiny. The paper and Shiny value pattern point to a 2018 Census-Division-level AADT table attributed to LHAs. CityPG traffic counts are local only and cannot rebuild all BC LHAs.
- Disturbed landscape is resolved with IFL 2016. Remaining residual is negligible and likely due to rounding or boundary clipping differences.
- Source behind the Shiny `Industrial sites` indicator. We have component layers for remediation sites, timber facilities, mines, oil/gas, and NPRI metadata, but not a confirmed one-to-one source or calculation that reproduces the Shiny count.
- Trans Mountain pipeline for exact `linear_footprint`. DRA MPAR now makes the linear-footprint rebuild a strong match; remaining residual may be source vintage, representative-point road assignment instead of exact clipping, missing Trans Mountain, or boundary differences.

## Disk note

After the core large downloads, the local volume had about 5.3 GiB free. Do not pull the expanded EMS historic file or full NPRI bulk files into this workspace unless space is freed or the large output directory is moved to an external volume.
