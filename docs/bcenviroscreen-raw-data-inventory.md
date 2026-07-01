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
| Housing burdened | 2016 `renter_housing_burden_ge50_percent` | 39.012 | 38.1 | Best current candidate. It uses published DA tenant-burden percentages, weighted by tenant households, excluding DAs with fewer than 50 tenant households. |
| Employment insurance / unemployment | StatCan EI `2014_regular_benefits_without_declared_earnings_per_100_age_15plus` | 1.794 | 2.2 | Stronger than Census unemployment, but not exact. Source is a CD-level EI table attributed to LHA by primary 2016 Census Division. |

### Employment insurance candidates

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-ei-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-ei-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:ei-lha
```

The builder streams the Statistics Canada table `14-10-0323-01`, "Employment insurance beneficiaries by census division, monthly, unadjusted for seasonality", from `https://www150.statcan.gc.ca/n1/tbl/csv/14100323-eng.zip`. The staged ZIP is about `85 MB`; the compact rebuilt LHA candidate output is about `512 KB`.

It also stages Statistics Canada 2016 Census data table `98-400-X2016119`, "Income Sources and Taxes (34) and Income Statistics (4) for the Population Aged 15 Years and Over in Private Households of Canada, Provinces and Territories, Census Divisions and Census Subdivisions, 2016 Census - 100% Data", from `https://www12.statcan.gc.ca/census-recensement/2016/dp-pd/dt-td/CompDataDownload.cfm?LANG=E&PID=110261&OFT=CSV`. This table includes `Employment Insurance (EI) benefits`, `EI - Regular benefits`, and `EI - Other benefits`; the staged ZIP is about `2.1 MB`.

The PHSA Community Health Atlas metadata does not expose an LHA-level EI/unemployment indicator. A CHSA-level `Social & economic factors` download was added as a negative-test source because it contains related fields such as `Employment Rate (15+)` and BCIMD economic-dependency quintiles. These files are staged under `vendor/bcdatamapper/datascrapers/health/phsa-community-health/output/downloads/` and aggregated to LHA using the CHSA-to-LHA crosswalk.

The candidate method:

1. Filter BC Census Divisions, both sexes, age 15 years and over.
2. Test annual-average monthly values for 2014-2018.
3. Test all income benefits, regular benefits, and regular benefits without declared earnings.
4. Divide CD counts by 2016 CD population, labour force, and age-15-plus denominators.
5. Attribute each CD value to LHAs by primary 2016 DA-to-LHA/CD membership.
6. Test 2016 Census CSD income-source percentages, weighted to LHA by 2016 DA age-15-plus denominators.
7. Test 2016 Census CSD EI recipient counts divided by LHA population, labour force, and age-15-plus denominators.
8. Test PHSA CHSA social/economic fields weighted to LHA.

Best current EI validation:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `statcan_ei_2014_regular_benefits_without_declared_earnings_per_100_age_15plus` | 0.309 | 0.7229 | 1.794 | 2.2 | Best all-BC raw candidate found so far; useful replacement for Census unemployment, but still not exact. |
| `statcan_ei_2015_regular_benefits_without_declared_earnings_per_100_age_15plus` | 0.448 | 0.6944 | 2.208 | 2.2 | Very close for Prince George, weaker all-BC. |
| `statcan_census_2016_ei_other_benefits_estimated_with_amount_per_100_age_15plus_csd_weighted` | 0.794 | 0.3400 | 0.560 | 2.2 | Best Census count/denominator transform, but weak correlation and only 60 matched LHAs. |
| `phsa_chsa_social_physical_environment_percentage_of_people_15_commuting_to_work_by_other_means_2016` | 0.905 | 0.0671 | 1.253 | 2.2 | Best PHSA CHSA social/economic raw-value candidate, but no useful rank match. |
| `statcan_census_2016_ei_other_benefits_percent_with_amount_csd_weighted` | 1.435 | 0.3955 | 3.308 | 2.2 | Best 2016 Census income-source candidate, but weak all-BC fit. |
| `statcan_census_2016_ei_regular_benefits_percent_with_amount_csd_weighted` | 4.910 | 0.5221 | 8.451 | 2.2 | Confirms Census annual EI recipient prevalence is not the Shiny field. |

The Shiny EI values vary within most Census Divisions, so the exact source is probably not a pure CD-level assignment. The Census income-source table is also not a raw-value match: its annual EI recipient prevalence is several times higher than the Shiny values, and count/denominator transforms do not improve all-BC fit. The current PHSA Community Health Atlas CHSA social/economic topic also does not contain the Shiny field. The remaining likely source is an archived paper-era PHSA/BC Community Health Atlas LHA extract, a custom StatCan tabulation, or another EI denominator/window that has not been found publicly.

External source discovery supports the archived-profile hypothesis but does not recover the raw table. Island Health's 2019 Local Health Area Profiles interpretation guide uses "people are receiving employment insurance" as an LHA profile interpretation example, but the guide defines profile context rather than publishing the LHA data extract. Public searches for a Northern Health/Prince George LHA profile with the raw EI row did not surface a usable table.

### Housing-burden suppression handling

The initial DA-summed tenant burden candidate undercounted many small/rural LHAs because DAs with tiny tenant-household denominators introduce unstable or suppressed percent rows. The best current candidate now filters those DAs before re-aggregating:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `renter_housing_burden_ge50_percent` | 2.226 | 0.9308 | 39.012 | 38.1 | Best current match. Weighted average of published DA tenant-burden percentages for DAs with at least 50 tenant households. |
| `renter_housing_burden_ge30_percent` | 3.434 | 0.9390 | 35.058 | 38.1 | Slightly stronger rank correlation, weaker raw-value fit. |
| `renter_housing_burden_percent` | 5.910 | 0.8870 | 32.551 | 38.1 | Previous best candidate; includes small-denominator DAs. |

PHSA Community Health Atlas CHSA `Demographics` was also downloaded and tested as a source-family check. Its related field, `Housing - Percentage of households with 30% or more of income spent on shelter`, is an all-household shelter-burden indicator, not a renter-burden indicator. Aggregated to LHA with the CHSA-to-LHA crosswalk it gives Prince George `17.367` vs Shiny `38.1` (MAD `18.270`, r `0.6604`), so it is useful context but not the Shiny housing-burdened-renters source.

### PHSA health outcome candidates

Stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-health-lha/` and synced through the combined validation/score outputs.

```bash
npm run environmental-burden:bc-enviro-screen:health-lha
```

The builder normalizes PHSA Community Health Atlas LHA CSV downloads for cancer, chronic disease, and mother/newborn health. It also population-weights staged PHSA CHSA CSV downloads to LHA using the CHSA-to-LHA crosswalk. It creates one wide LHA candidate table and lets the validation harness choose the closest candidate for each Shiny sensitive-population indicator.

Current health validation against Shiny:

| Shiny indicator | Best current PHSA candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| All causes of cancer | `phsa_cancer_all_cause_cancer_incident_cases_all_ages_2008_2012_total_per_1000_pop2011` | 0.298 | 0.9963 | 23.463 | 23.5 | Strong match after assigning 2011 DA representative points to current LHA polygons. |
| COPD | `phsa_general_health_chronic_obstructive_pulmonary_disease_copd_age_standardized_incidence_rate_per_1000_population_45plus_yrs_2015_per_1000_population` | 0.011 | 1.0000 | 9.7 | 9.7 | Essentially matched for available LHAs. |
| Diabetes mellitus | `phsa_chsa_to_lha_general_health_diabetes_mellitus_age_standardized_incidence_rate_per_1000_population_1plus_yrs_fy_2015_2016_per_1000_population` | 0.399 | 0.9862 | 7.021 | 6.4 | Best current all-BC candidate after CHSA-to-LHA aggregation, with a PG residual. |
| Hypertension | `phsa_general_health_hypertension_age_standardized_incidence_rate_per_1000_population_20plus_yrs_fy_2015_2016_male_per_1000_population` | 2.037 | 0.8283 | 20.2 | 23.2 | Best current candidate but still weak. CHSA-to-LHA aggregation was tested; the best CHSA hypertension candidate had MAD `2.821`, so direct LHA remains better. |
| Low birth weight | `phsa_mother_and_newborn_health_low_birth_weight_rate_per_1_000_live_births_2011_2015_per_1_000_live_births` | 0.001 | 1.0000 | 58.7 | 58.7 | Matched for available LHAs. |

The health builder also emits diagnostic rolling-window hypertension candidates. The best diagnostic rolling candidate is the 2014-2017 male 3-year mean (`MAD 1.983`, `r 0.8087`, PG `19.9` vs Shiny `23.2`), but it is excluded from the best-current source mapping because it is a derived diagnostic rather than a confirmed BCEnviroScreen input.

The PHSA `GetIndicatorList` endpoint currently exposes hypertension only with source ID `CDR2022` for both LHA and CHSA. Direct download probes using older guessed source IDs (`CDR2021`, `CDR2020`, `CDR2019`, `CDR2018`, `CDR2017`, and `CDR`) return syntactically valid but empty CSV downloads. That means the paper-era chronic-disease source cannot be recovered from the current public PHSA endpoint by changing the source suffix alone.

The local BCCDC Tableau probe currently captures BC and Health Authority/HSDA rows, not LHA rows, so it is not directly useful for replacing the PHSA LHA chronic-disease candidates. Its controls confirm that the modern BCCDC dashboard can switch condition to `Hypertension (Age 20+)`, rate type to `Age-Standardized Incidence`, sex, age group, and year, but the Data Table geography control exposes only `Health Authority` and `Health Service Delivery Area (HSDA)`.

The current PHSA Community Health Atlas download for hypertension says the 2011 Canadian Census population was used for age standardization and defines the same case criteria cited by BCCDC: one hospitalization or two physician visits in two years with ICD-9 `401-405` or ICD-10 `I10-I13/I15`, age 20+. Since the paper names this exact PHSA indicator but the Shiny LHA values do not match the current PHSA LHA extract, the most likely remaining hypertension gap is source vintage/revision: an archived PHSA/BCCDC LHA extract from around the app/paper build, not a missing formula in our current pipeline.

The 2011 cancer denominator is now rebuilt from the official Statistics Canada 2011 Census Profile comprehensive DA archive. The working endpoint is the comprehensive download form with `CTLG=98-316-XWE2011001` and `FMT=CSV1501`; the staged file is `vendor/bcdatamapper/datascrapers/census/output/bcenviroscreen-census-lha/raw/statcan-2011-da-profile.zip`. The parser streams the BC member (`98-316-XWE2011001-1501-BC.csv`) through `unzip -p` and extracts `Population in 2011`.

The LHA attribution now uses the official Statistics Canada 2011 Dissemination Area cartographic boundary ZIP (`gda_000b11a_e.zip`), staged locally as `vendor/bcdatamapper/datascrapers/census/output/bcenviroscreen-census-lha/raw/statcan-2011-da-cbf-shp.zip`. Each 2011 DA representative point is assigned to the current BC MoH LHA polygon. Coverage is `7,582` BC 2011 DAs in the output, `7,579` matched to an LHA polygon, and `3` unmatched. Prince George's rebuilt 2011 population denominator is `92,231`.

The 2011 denominator candidate is selected in the health output as `phsa_cancer_all_cause_cancer_incident_cases_all_ages_2008_2012_total_per_1000_pop2011`. It is close for Prince George (`23.463` vs Shiny `23.5`) and strong across BC (`MAD 0.298`, `r 0.9963`). The remaining maximum residual is Kootenay Lake (`4.706`), likely from boundary/vintage or case-suppression differences.

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
| Employment insurance beneficiaries | `ei.statcan_ei_2014_regular_benefits_without_declared_earnings_per_100_age_15plus` | 1.794 | 2.2 | Raw CD-level StatCan EI candidate; better than Census unemployment but not exact. |
| Housing burdened renters | `census_2016.renter_housing_burden_ge50_percent` | 39.012 | 38.1 | Strong raw-value match after excluding DAs with fewer than 50 tenant households. |
| Remediation sites | `spatial.remediation_sites_site_id_lte_23504_count` | 575 | 575 | Strong paper-era/source-vintage proxy; current source over-counts Shiny. |
| All causes of cancer | `health.phsa_cancer_all_cause_cancer_incident_cases_all_ages_2008_2012_total_per_1000_pop2011` | 23.463 | 23.5 | Strong match after 2011 DA representative-point attribution to LHA. |
| COPD | `health.phsa_general_health_chronic_obstructive_pulmonary_disease_copd_age_standardized_incidence_rate_per_1000_population_45plus_yrs_2015_per_1000_population` | 9.7 | 9.7 | Matched. |
| Diabetes mellitus | `health.phsa_general_health_diabetes_mellitus_age_standardized_incidence_rate_per_1000_population_1plus_yrs_fy_2015_2016_per_1000_population` | 6.8 | 6.4 | Strong proxy. |
| Hypertension | `health.phsa_general_health_hypertension_age_standardized_incidence_rate_per_1000_population_20plus_yrs_fy_2015_2016_male_per_1000_population` | 20.2 | 23.2 | Proxy; exact input still unresolved. |
| Low birth weight | `health.phsa_mother_and_newborn_health_low_birth_weight_rate_per_1_000_live_births_2011_2015_per_1_000_live_births` | 58.7 | 58.7 | Matched. |
| Disturbed landscape | `ifl.ifl_2016_disturbed_area_percent` | 54.329 | 54.3 | Matched from Intact Forest Landscapes 2016; disturbed percent = 100 - IFL area percent. |
| Traffic density | `traffic.traffic_data_program_utv_report_2018_cd_representative_point_aadt_sum` | 35,436 | 26,727 | Best transparent raw-value proxy so far. It uses generated TDP UTV segment-report PDFs, parses 2018 AADT, assigns each segment by representative point to the containing LHA, then sums by that LHA's primary Census Division. Stronger raw match than TMS site reports, but still not the exact Shiny aggregation. |

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
| Traffic Data Program app | `raw-rebuild-seed/compact/traffic-data-program/tig-utv-segment-ext.geojson`, `tig-tmp-geom-ext-v.geojson`, `tig-tms-geometry-ext-v.geojson`, `tsg-arcims-survey-v-sqlview.geojson`, `tdp-utv-segment-report-aadt.csv`, `tdp-tms-site-report-annual-aadt.csv`, `tdp-tradas-report-links.csv` | Current web app exposes WFS layers from `https://maps.th.gov.bc.ca/geoV05/ows`. Generated UTV segment-report PDFs expose 2018 AADT values and are the strongest transparent raw traffic proxy found so far. The legacy TRADAS interface exposes station-level PDF/XLS report links and is useful for source discovery/backfill, but it does not expose the missing 2018 Census-Division table. |

Traffic Data Program output is stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/rebuilt-traffic-lha/` and synced to `public/data/environmental-burden/bc-enviro-screen/rebuilt-traffic-lha/`.

```bash
npm run environmental-burden:bc-enviro-screen:traffic-lha
npm run environmental-burden:bc-enviro-screen:utv-reports
npm run environmental-burden:bc-enviro-screen:tradas-links -- --loc 42-035NS --full-combinations
```

The builder clips `tig:TIG_UTV_SEGMENT_EXT` segments to LHA boundaries in EPSG:3005 and aggregates `MAP_RENDERING_AADT` weighted by clipped segment length. It also assigns `tig:TIG_TMP_GEOM_EXT_V` Traffic Measurement Point features to containing LHAs and summarizes `AADT` as sum, max, point count, and area-normalized variants. For the strongest 2018 candidate, the UTV identify endpoint `https://prdoas6.pub-apps.th.gov.bc.ca/tig-public/UTVSIdentify.do?SEGMENT_NUMBER=...` seeds a session and `https://prdoas6.pub-apps.th.gov.bc.ca/tig-public/UTVSReport.do` returns a generated PDF with a 10-year AADT/SADT summary. Those generated UTV segment-report PDFs are parsed into the compact staged CSV `tdp-utv-segment-report-aadt.csv`; the PDF cache is intentionally not synced to `public/data`. Generated TMS site-report PDFs remain staged in `tdp-tms-site-report-annual-aadt.csv` as a secondary diagnostic.

Current validation:

| Candidate | Mean absolute difference | Pearson r | Prince George rebuilt | Prince George Shiny | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `traffic_data_program_utv_aadt_m_per_sq_km` | 687,835.543 | 0.5420 | 8,517.494 | 26,727 | Poor match; source covers Ministry UTV highway segments, not the coarser Shiny traffic table. |
| `traffic_data_program_utv_aadt_km_per_sq_km` | 268,593.854 | 0.5420 | 8.517 | 26,727 | Same source scaled to km; units do not match Shiny. |
| `traffic_data_program_tmp_aadt_sum` | 202,689.307 | 0.6283 | 292,454 | 26,727 | Poor match; summing current/legacy point AADT overcounts large LHAs such as Prince George. |
| `traffic_data_program_tmp_aadt_max` | 256,860.025 | 0.8036 | 12,679 | 26,727 | Rank pattern is fairly strong, but raw values and missing-point LHAs do not match the Shiny Census-Division table. |
| `traffic_data_program_utv_report_2018_cd_representative_point_aadt_sum` | 54,036.714 | 0.9618 | 35,436 | 26,727 | Best transparent raw-value proxy found so far; 2018 UTV segment-report AADT assigned by segment representative point and summed by LHA primary Census Division. Still not exact raw values. |
| `traffic_data_program_utv_report_2018_cd_from_lha_intersection_aadt_sum` | 121,434.381 | 0.9545 | 35,436 | 26,727 | Uses clipped LHA intersections before summing to primary Census Division. Strong, but weaker than representative-point assignment. |
| `traffic_data_program_tms_report_2018_no_interchange_ramp_turn_cd_aadt_sum` | 186,503.729 | 0.9525 | 33,017 | 26,727 | Best TMS site-report proxy; 2018 TMS site-report AADT summed by LHA primary Census Division after excluding interchange/ramp/directional-turn descriptions. Weaker raw match than UTV segment reports. |
| `traffic_data_program_tms_report_2018_no_ramp_turn_cd_aadt_sum` | 237,631.953 | 0.9509 | 39,563 | 26,727 | Excludes ramp/directional-turn descriptions only. Better than all-site sum, but weaker than also excluding interchange descriptions. |
| `traffic_data_program_tms_report_2018_cd_aadt_sum` | 259,550.671 | 0.9507 | 40,837 | 26,727 | All parsed 2018 TMS site-report AADT summed by LHA primary Census Division. Strong rank match, but overcounts Prince George and several urban CDs. |
| `traffic_data_program_tms_report_2018_segment_max_segment_only_cd_aadt_sum` | 157,790.571 | 0.9350 | 35,436 | 26,727 | Lower raw MAD but weaker rank match and one fewer comparable LHA; useful diagnostic, not selected as best-current. |
| `traffic_data_program_tms_report_2018_cd_aadt_max` | 237,813.200 | 0.9297 | 24,861 | 26,727 | Close for Prince George and strong rank pattern, but not exact all-BC. |
| `traffic_data_program_tms_report_2018_lha_aadt_max` | 244,838.542 | 0.8373 | 24,861 | 26,727 | LHA-level max is close for Prince George but weaker across BC. |

Existing road-density fields remain diagnostic traffic proxies. Their raw units do not match Shiny `traffic_density`, and they are now weaker than the 2018 TMS report candidate:

| Proxy | Pearson r vs Shiny traffic density | Prince George proxy | Prince George Shiny |
| --- | ---: | ---: | ---: |
| `bcgw_digital_road_atlas_dpar_km_per_sq_km` | 0.8090 | 0.137 | 26727 |
| `paper_dedup_linear_footprint_km_per_sq_km` | 0.7667 | 0.899 | 26727 |
| `bcgw_digital_road_atlas_mpar_km_per_sq_km` | 0.7629 | 0.848 | 26727 |

The validation harness now selects `traffic_data_program_utv_report_2018_cd_representative_point_aadt_sum` for best-current rebuilds because it has the strongest raw-value fit among transparent raw/proxy traffic candidates. It is still not an exact reproduction: Prince George is `35,436` vs Shiny `26,727`, and 4 of 641 UTV segment reports currently return non-PDF responses (`105`, `301`, `583`, `595`).

Two diagnostic files are emitted to make the remaining gap auditable:

- `utv-report-2018-cd-segments.csv` lists each parsed 2018 UTV segment, representative-point LHA/CD assignment, AADT/SADT, traffic pattern, and description.
- `utv-report-2018-cd-summary.csv` sums those segments by primary Census Division and compares against the Shiny traffic-density value where the CD has a single Shiny traffic value.

Prince George's UTV 2018 sum is built from five segments:

| Segment | Pattern | 2018 AADT | Description |
| --- | --- | ---: | --- |
| 544 | C | 24,861 | Route 97 from Junction Route 16 (Prince George) to Traffic Counting Station 42-016 |
| 540 | S | 4,029 | Route 97 from Hixon BCR U/P to Plett Road |
| 341 | H | 2,966 | Route 16 from Fraser River Bridge - Tete Jaune Cache to Alberta Border |
| 226 | H | 2,532 | Route 5 from CNR O/P 2 to Junction Route 16 (Tete Jaune Cache) |
| 340 | H | 1,048 | Route 16 from Mountain View Road to Fraser River Bridge - Tete Jaune Cache |

Dropping the Tete Jaune / eastern highway segments moves Prince George closer (`28,890` vs Shiny `26,727`) but is not a defensible province-wide rule: it barely changes all-BC raw fit and would be a location-specific overfit. Testing UTV report years confirmed `aadt_2018` is the best raw-value year among available annual AADT/SADT fields (`MAD=54,036.714`, `r=0.9618`). Later/earlier years and latest-available backfills perform worse.

Additional TDP endpoint tests:

- `UTVSReport.do` always returns the current `10 Year Summary Data for 2025` report. Query parameters such as `YEAR=2018`, `REPORT_YEAR=2018`, `summaryYear=2018`, `END_YEAR=2018`, and `FROM_YEAR=2009&TO_YEAR=2018` are ignored.
- The legacy `https://www.th.gov.bc.ca/trafficData/legacy.html` page exposes pre-2016 annual/historic products and documentation, but no 2018 Census-Division summary table.
- The old `https://www.th.gov.bc.ca/trafficData/TRADAS/` directory returns `401 Unauthorized`; individual public documents such as `Growth_Policy_Documentation.pdf` are still accessible.
- Individual legacy TRADAS station pages are public. For example, `https://tradas.th.gov.bc.ca/tradas.asp?loc=42-035NS` maps to TMS site `522` / UTV segment `541` and exposes PDF/XLS report links for `2005`, `2011`, `2012`, `2013`, and `2014`. A targeted full-combination scrape found 14 links for that station, including `DV03` and `DV03S` reports, but no `2018` report. This likely matches the webinar-described manual site-by-site export workflow, but it remains station-level short-count history rather than the BCEnviroScreen Census-Division traffic table.
- UTV `MAP_RENDERING_AADT` representative-point CD sum is weaker than explicit 2018 report AADT (`MAD=96,224.855`, `r=0.9511`, PG `33,625.52`).
- Hybrid `aadt_2018` with `MAP_RENDERING_AADT` backfill is also weaker (`MAD=118,763.316`, `r=0.9619`, PG `39,941.476`).
- The four UTV report errors are segments `105`, `301`, `583`, and `595`; only segment `583` has a non-null `MAP_RENDERING_AADT`, and backfilling it worsens the all-BC raw match.

The paper defines traffic as "Annual average daily traffic counts attributed to LHA's from a Census Division level" and cites BC Ministry of Transportation, 2018. The Shiny traffic table confirms that coarser attribution pattern: most LHAs sharing a Census Division have identical traffic values. Generated TDP UTV reports prove public 2018 AADT values are recoverable from the current TDP app, and the UTV representative-point-to-CD rule is much closer than TMS site-report variants. However, UTV representative-point sum, UTV clipped-intersection sum, TMS permanent-only, TMS active-only, TMS max-per-segment, TMS segment-only, and simple TMS CD sum/max rules still do not reproduce the Shiny table. Exact reproduction still needs the paper's Census-Division summary rule/table or the original pre-aggregated MoTI extract.

### Census-Division/source-region benchmark extraction

Because the Shiny app exposes the final raw LHA indicator table, the unresolved Census-Division/source-region inputs can be extracted as benchmark values without treating them as independently rebuilt source data.

```bash
npm run environmental-burden:bc-enviro-screen:cd-targets
```

Outputs are stored in `vendor/bcdatamapper/datascrapers/environmental-burden/output/bc-enviro-screen/cd-attributed-targets/` and synced to `public/data/environmental-burden/bc-enviro-screen/cd-attributed-targets/`.

| Output | Purpose |
| --- | --- |
| `lha-cd-attributed-targets.csv` | LHA-level traffic, future temperature, and future precipitation values from the Shiny table, joined to the LHA's primary 2016 Census Division from the DA-to-LHA crosswalk. |
| `cd-attributed-targets.csv` | Census-Division summary showing whether all LHAs in a CD share one value. |
| `source-value-groups.csv` | Distinct source-value groups across traffic and climate fields. Useful for detecting where the Shiny app split a CD across different source regions. |

Key findings:

| Case | Finding |
| --- | --- |
| Prince George | Single LHA/CD group: `traffic_density=26727`, `future_temperature=1.7`, `future_precipitation=-1.1`. |
| Most CDs | One unique traffic/climate value per Census Division, matching the article's "attributed from a Census Division level" wording. |
| CD 5915 | Split values: most Metro Vancouver LHAs use `traffic_density=1016806`, `future_temperature=1.6`, `future_precipitation=-2.0`; Maple Ridge/Pitt Meadows follows the Fraser Valley group with `traffic_density=223391`, `future_temperature=1.7`, `future_precipitation=-3.6`. |
| CD 5957 | Stikine has no Shiny traffic value, but climate values are present: `future_temperature=1.7`, `future_precipitation=8.1`. |

Source search status:

- The current PCIC Plan2Adapt app is downloadable, but it is a successor source. Its config points to `https://services.pacificclimate.org/pcex/api/`, `p2a_cmip6_mbcn`, `PCIC_BLEND_v1`, and current stats files under `https://services.pacificclimate.org/plan2adapt/files/stats`. Current metadata exposes a 1981-2010 baseline and future periods 2021-2050, 2041-2070, and 2071-2100 under SSP5-8.5, not the paper's 2010-2039 relative to 1961-1990 input.
- Current Plan2Adapt regional stats files are accessible, for example `https://services.pacificclimate.org/plan2adapt/files/stats/fraser_fort_george.csv`, but these are modern proxy inputs rather than exact BCEnviroScreen inputs.
- The BC Data Catalogue API and the current BC Traffic Data Program did not expose a public 2018 Census-Division AADT lookup table. The current Traffic Data Program WFS remains useful for road-segment proxies, but it does not reproduce the Shiny source table.
- The article supplement is linked from PMC/MDPI, but command-line download attempts returned an interstitial page from PMC and a 403 from MDPI in this environment. Treat the local/user-provided supplemental PDF as documentation only unless a real ZIP/table is manually recovered.

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

The `hybrid-best-current-with-shiny-gaps` mode substitutes currently rebuilt indicators and carries Shiny values only for still-missing raw inputs: climate, plus Shiny fallback values where public PHSA health rows are suppressed or missing. It now includes IFL 2016 disturbed landscape, suppression-aware housing burden, a raw StatCan EI candidate, a strong 2011 cancer denominator, and the 2018 TDP UTV segment-report traffic proxy. Prince George overall is `57.122` vs Shiny `57.6` (All-BC MAD `3.978`, r `0.9247`). This is useful as a rank-oriented rebuild test, but not an exact reproduction because traffic, EI, and hypertension remain raw proxies rather than exact source matches. The UTV proxy is a better raw traffic match than the filtered TMS proxy, though it does not improve the overall-score MAD because percentile ranks shift differently.

The `hybrid-current-with-cd-benchmark-gaps` mode uses the same rebuilt indicators, but replaces traffic and climate with the inferred CD/source-region benchmark table instead of the TDP proxy. Prince George uses `traffic_density=26727`, `future_temperature=1.7`, and `future_precipitation=-1.1`, producing an overall score of `57.296` vs Shiny `57.6`. All-BC exposure MAD is `0.029`, landscape burden MAD is `0.293`, and overall-score MAD is `4.286`, so remaining score error is now dominated by EI residual, hypertension, housing residuals, and environmental-effect inputs rather than traffic/climate or cancer.

## Still queued or missing

- NPRI bulk releases, disposals, transfers, geolocations, and comments. The ECCC API did not expose reliable `Content-Length` headers, and the local disk had only about 5.3 GiB free after the core downloads.
- Expanded EMS current and historic CSVs. The expanded historic file alone is about 8.0 GB, so it was intentionally skipped on this disk.
- Exact BCEnviroScreen paper-era CANUE postal-code PM2.5 and ozone extract is now mostly resolved through the CANUE portal's current annual BC postal-code ZIPs. The postal-code method closely reproduces Shiny, with small residual differences likely due to app rounding, current portal vintage, or boundary version.
- Exact socioeconomic match to the Shiny app for every indicator. Low education, linguistic isolation, low income, and housing burden now have strong 2016 matches. Employment insurance now has a real CD-level StatCan EI proxy, but it is not exact.
- Climate projection inputs for future temperature and precipitation. The Shiny-derived CD/source-region benchmark table is staged, including Prince George `future_temperature=1.7` and `future_precipitation=-1.1`, but the raw PCIC/Plan2Adapt 2020 table used to regenerate those values is not staged. The current Plan2Adapt app has moved to CMIP6/SSP5-8.5 regional summaries with 1981-2010 baseline and later projection periods, so it is a proxy source rather than the paper's exact 2010-2039 vs 1961-1990 input.
- Exact health inputs for all LHAs. COPD, low birth weight, and cancer are now strong matches from PHSA public LHA downloads plus the 2011 DA centroid denominator. Diabetes is close. Hypertension still needs the exact chronic-disease metric/vintage used by the Shiny app.
- Province-wide traffic-density raw source. BC traffic-volume archives, current Traffic Data Program WFS geometry, TSG survey downloads, generated TMS site-report annual AADT values, and generated UTV segment-report annual AADT values are now staged. The best transparent 2018 UTV report proxy assigns segment AADT by representative point and sums by primary Census Division (`r=0.9618`; Prince George `35436` vs Shiny `26727`). This is likely the correct MoTI source family but still does not reproduce Shiny raw values. The Shiny-derived CD/source-region benchmark table is staged, including Prince George `traffic_density=26727`; the paper's exact Census-Division summary rule/table or original MoTI extract has not been found.
- Disturbed landscape is resolved with IFL 2016. Remaining residual is negligible and likely due to rounding or boundary clipping differences.
- Source behind the Shiny `Industrial sites` indicator. We have component layers for remediation sites, timber facilities, mines, oil/gas, and NPRI metadata, but not a confirmed one-to-one source or calculation that reproduces the Shiny count.
- Trans Mountain pipeline for exact `linear_footprint`. DRA MPAR now makes the linear-footprint rebuild a strong match; remaining residual may be source vintage, representative-point road assignment instead of exact clipping, missing Trans Mountain, or boundary differences.

## Disk note

After the core large downloads, the local volume had about 5.3 GiB free. Do not pull the expanded EMS historic file or full NPRI bulk files into this workspace unless space is freed or the large output directory is moved to an external volume.
