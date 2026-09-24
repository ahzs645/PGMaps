# MHCCA CVI: variable reconciliation and reproducibility audit

Checked 22 September 2026. The integrated explorer is `/dev/climate-vulnerability`.
It displays author-prepared inputs, not a recreated or validated vulnerability index.

## Evidence and reproducible files

- User-provided report: *Developing and Validating a Climate Vulnerability Index for British Columbia*, Alexi T. Hu and Kiffer G. Card. Tables 1–3, Equation 1 and methods on printed pp. 5–15 (PDF pp. 9–19). [Public report](https://mhcca.ca/s/CVI-Report.pdf).
- [MHCCA dashboard](https://alexihu.shinyapps.io/ClimateVulnerability/): its “Download BC Climate Index” export retrieved 22 September 2026 is actually 193 FSA rows with location names and 76 numeric inputs, without final PCA/index scores. Source SHA-256: `1166afd11a5aaa116c0cf882890ccfd55a546560edd5f5a60871801e56dd9ca1`.
- The per-variable deliverable is [variable-audit.csv](../vendor/bcdatamapper/datascrapers/bc/mhcca-cvi/output/variable-audit.csv): all 80 catalogue entries, CSV field, report and catalogue components, selection classification, source period/geography, local/R2 status, candidate products, numeric range and required next check.
- [holdings-evidence.json](../vendor/bcdatamapper/datascrapers/bc/mhcca-cvi/output/holdings-evidence.json) records the report checksum and fresh successful R2 metadata/catalogue GETs with bytes and checksums. It is evidence about those specific objects, not a bucket-wide inventory.
- [reproducibility.json](../vendor/bcdatamapper/datascrapers/bc/mhcca-cvi/output/reproducibility.json) contains the numerical PCA checks. Run `python3 vendor/bcdatamapper/datascrapers/bc/mhcca-cvi/build.py` with NumPy to rebuild every derived table from the preserved sources. No new Shiny download occurs during this build.

## Selection reconciliation

| Classification against report Table 2 | Catalogue entries | Present in download |
|---|---:|---:|
| Clearly identifiable selected concepts | 61 | 59 |
| Selected labels with ambiguous field mapping | 11 | 11 |
| Explicitly not selected for PCA | 8 | 6 |
| Total | 80 | 76 |

Thus 72 catalogue entries are candidate mappings to the selected list, of which 70 are available. **This is not a verified 72-column model specification.** Eleven mappings remain ambiguous. Four projected entries (temperature changes for the 2020s and 2050s, median-age change and population change) distinguish the report's observed-plus-projected variant; exact scenario-specific model matrices remain unavailable.

### Missing from the prepared download

| Concept | Table 2 selection | Consequence |
|---|---|---|
| Median employment income | Selected | Required input missing; personal/household income is not an equivalent replacement |
| Private dwellings percentage | Selected | Required input missing; denominator also needs clarification |
| Median household after-tax income | Not selected | Catalogue/export discrepancy, but not a direct Table 2 PCA blocker |
| Ten-year annual maximum temperature | Not selected | Catalogue/export discrepancy, but not a direct Table 2 PCA blocker |

### Ambiguities and contradictions

1. **Population change:** Tables 1 and 2 place it in adaptive capacity; the website catalogue places it in sensitivity. Both assignments are retained, and the UI groups by the report assignment.
2. **Education:** Table 1 and the CSV describe postsecondary education; Table 2 says university degree holders. These populations are not interchangeable. The `num_postsecond` mapping is provisional.
3. **Disease incidence:** Table 2 repeats asthma, COPD, diabetes, heart failure and hypertension incidence labels. Table 1 and the CSV distinguish five age-standardized incidence rates from five incident counts. All ten fields remain visible; neither deduplication nor inclusion of both in PCA is assumed.
4. **Facility index:** The catalogue calls the field facility richness; Table 1 describes a facility density/index within 1000 m. Resolve the exact CANUE field and buffer.
5. **“Ten-year” 2009–2019:** Greenness and noise use endpoints spanning 11 calendar years inclusive. The averaging window, omitted years and denominator are not specified sufficiently to rebuild it.
6. **Population:** Excluded from Table 2 PCA, but still needed to form the population-multiplied variant. It must not be removed from the input catalogue.

## Primitive-source holdings

No exact primitive-input match was established in this audit. The prepared MHCCA CSV is an exact preserved export, but it is downstream of imputation and aggregation.

| Family | Local evidence | R2 evidence and remaining mismatch |
|---|---|---|
| CANUE | 388 Drive ZIP entries previously inventoried; attempted source reads encountered unhydrated placeholders. No processed CANUE output in this checkout. | Metadata and catalogues freshly retrieved. PM2.5 `pm25dald_a` (1998–2020) and `pm25dale_a` (1998–2021) are alternatives requiring version confirmation. Published aggregates use `pmtiles-centroid`, not the study's verified postal-to-FSA calculation. No FSA level in the inspected aggregate catalogue. |
| Greenness/noise | Same CANUE archive evidence; original study extraction unverified. | `grlan_amn` candidate has incomplete inspected year coverage (2012 omitted); `nhnse_ava` ends in 2017 with gaps; `nhnse_avb` is 2021. Neither noise release directly supplies the stated 2009–2019 window. |
| Weather/thermal | Related climate holdings, not established as the study inputs. | `wthnrc_a` covers 1983–2015, short of 2020; `wtlst_ava` is a different rolling warm-season metric. Do not silently substitute. |
| Built environment | CANUE archive entries; exact buffers/fields not matched. | `nhbld_ava`, `nhfac_ava`, `nhpmd_ann` contain 2019 fields; `nhbic_ava` contains 2021 fields. Product families match, field definitions still need verification. |
| Census | 2021 variable files in checkout; prior value inspection covered 135 Prince George DAs. BC boundary coverage does not establish BC-wide attribute coverage. | Exact CVI census/FSA release not verified. Need the correct BC-wide variables, denominators and spatial allocation, especially for medians and rates. |
| Community health | 1,048 PHSA archive CSV entries previously inventoried in Drive; current PHSA output directory absent. | Exact historic LHA tables not verified. The parallel EDI work is related; current EDI releases are not replacements for the study's 2013–2016 inputs. |
| ECCC heat events | Exact station/event table not found in focused earlier inventory. | Related climate release is available; station selection, heat-event definition and FSA allocation unresolved. |
| PCIC projections | Related climate products identified in earlier inventory. | Freshly retrieved BC climate manifest identifies CMIP6 CanDCS-U6/ANUSPLIN products. This is not proof of equivalence to the report's 2018 station-based projections. |
| BC Stats / gaming grants | Exact 2022 releases not found in focused inventory. | Exact tables not verified; obtain releases and allocation rules before rebuilding. |

R2 “not verified” does not mean absent. No authenticated bucket-wide search was performed. A catalogue listing does not prove every backing object is present; this run rechecked the catalogue/metadata objects, while the earlier audit checked representative tile and aggregate objects. Drive entry counts do not establish hydrated, readable source contents.

## Geometry and input integrity

- Join `MHCCA.FSA = shared postal boundary CFSAUID`, using dataset `statcan-cfsa-2021-bc` and level `fsa`.
- All 191 shared BC polygons match input records. V7X and V7Y have no polygons in this release, but remain in the table, CSV and all 193-row statistical diagnostics.
- 193 × 76 = 14,668 finite numeric values; no constant input columns. The browser join is checked across every variable and every mapped FSA (14,516 comparisons). Zero and negative values are retained, never treated as missing.
- The theme payload has no copied geometry. Boundaries are loaded through the same shared loader as the Boundaries page.
- The official 2021 census FSA release is a candidate representation. The report names BC Data Catalogue but not the exact original geometry release; identity with its map remains unverified.

## Reproducibility result

**Exact published CVI reproduction is not established.** We can reproduce the export-to-map join and run explicitly labelled diagnostic PCA; we cannot reconstruct the original primitive-data preparation, final scores or validation regressions from the supplied materials alone.

| Check | Our diagnostic | Report |
|---|---:|---:|
| Observed exposure, PC1 | 62.6354% | 86.4% in Figure 2 |
| Observed exposure, PC2 | 26.4763% | 13.6% in Figure 2 |
| Observed exposure, first two PCs | 89.1118% | 100% in Table 3 |
| Observed + projected exposure, first two PCs | 77.9380% | 96% in Table 3 |

Diagnostic specification: all 193 rows; observed exposure fields are precipitation, PM2.5 and heat-event count; projected exposure adds the two temperature-change fields; each column is centred and divided by sample standard deviation; PCA uses singular-value decomposition. No imputation, log transformation, variable omission or boundary-based row filtering is applied. The third observed component still accounts for 10.8882%, so this matrix is not effectively two-dimensional as Figure 2 suggests. Reversing signs of input columns cannot change the explained-variance spectrum. This establishes a mismatch with this straightforward reading of the method, **not** which material is wrong; a different analysis table, transformation or model specification could explain it.

The audit intentionally does not invent final scores by dropping missing variables, guessing direction reversals or fitting to match the published rankings. No approximate score is presented as MHCCA's CVI.

### Stage-by-stage requirements

| Stage | What the report supplies | What is still needed |
|---|---|---|
| Source acquisition | Seven source families, variables, periods, original geography | Exact archives, versions, station lists, projection scenario/baseline and source field IDs |
| Imputation | k-nearest neighbours before temporal/geographic harmonization | k, distance/scaling, predictors, missingness masks, software/settings and treatment of suppressed health values |
| Temporal summary | Multi-year values reduced to summary estimates | Exact inclusive years, missing-year rules, counts versus averages |
| Geographic harmonization | 193 FSAs; BC Data Catalogue boundaries | Original geometry, crosswalks, spatial assignment and population/area/postal-code weighting for each variable |
| First PCA | Standardization and component groups; 2 exposure, 2 sensitivity, 3 adaptive dimensions | Exact matrices, selected fields, transformations, reversals, fitted loadings, scaling and score signs |
| Second PCA | Reduction of component dimensions; first 3 PCs; Equation 1 sums scores | Whether/how first-stage scores were rescaled, retained loadings, sign conventions and exact final combination |
| Population variant | CVI multiplied by FSA population | Verified base CVI, population definition and any score shift/normalization; not a population-weighted mean |
| Validation | FSA-characteristic and linked survey regressions | Survey microdata, eligible rows, missingness exclusions, linkage and regression code |

The most useful author-supplied artifacts would be the actual analysis-ready model matrices for each scenario, their processing/PCA scripts (including package versions), fitted loadings and the final 193-row score export. A focused public search did not establish a released code repository; that is not proof that no repository exists.

## Delivery and ownership

The preserved export, catalogue, evidence, builder and geometry-free output live in `vendor/bcdatamapper/datascrapers/bc/mhcca-cvi`. PGMaps syncs output into generated `public/data/climate-vulnerability`; do not commit those duplicate public files. No raw CANUE, PCCF or survey records have been published, and no new R2 upload was made.

The native PGMaps page reuses the map, sidebar, fill-layer and study-area loader components. The existing project-package explorer is a research-record/point renderer; this domain-specific choropleth uses a normal dev route without changing its package contract.

## Verification

- Rebuilding twice produced identical output manifests and checksums.
- Eight focused tests cover all 14,516 mapped values, missing values, unmatched FSAs, URL defaults, selection metadata and shared FSA boundaries.
- Targeted ESLint and the final whole-project TypeScript build passed.
- Browser checks covered map selection, variable changes, missing polygons, audit filtering, reproducibility results and URL restoration. The 390 × 844 mobile layout had no horizontal overflow; the sidebar remained accessible. No new console errors followed the final fixes.
- Served input JSON and three downloadable tables matched maintained output bytes exactly.
- Scraper release `4c3464e` was committed and pushed before the complete PGMaps data sync, which passed. Generated public copies remain ignored.
