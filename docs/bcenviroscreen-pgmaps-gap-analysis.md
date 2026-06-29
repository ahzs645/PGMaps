# BCEnviroScreen Method And PGMaps Gap Analysis

Reviewed on 2026-06-29.

Sources reviewed:

- Live app: https://planetaryhealth.shinyapps.io/BC_Enviro_Screen/
- Paper PDF: `/Users/ahmadjalil/Downloads/ijerph-19-11171.pdf`
- Supplemental PDF: `/Users/ahmadjalil/Downloads/ijerph-1878734-Supplemental File.pdf`
- Existing local notes: `docs/calenviroscreen-pgmaps-analysis.md` and `docs/eji-gap-analysis.md`

## What They Built

BCEnviroScreen is an adaptation of the CalEnviroScreen method for British Columbia Local Health Areas (LHAs). The paper built two treatments:

- Version 1, called CalEnviroScreen in the paper, approximated the California indicator suite using BC data.
- Version 2, called BCEnviroScreen, added BC-specific land-use and resource-development indicators.

The web app is a Shiny viewer for the BCEnviroScreen results. The app exposes:

- Meta-level scores: Overall Score, Landscape Burden Score, Population Characteristics Score.
- Component scores: Exposures, Environmental Effects, Sensitive Populations, Socioeconomic Factors.
- Indicator maps for the inputs under each component.
- A selected-LHA detail panel with component values and Plotly bar summaries.

The app stack visible from the deployed page is:

- R Shiny 1.6.0
- `shinyWidgets`
- Leaflet 1.3.1 through `leaflet`/`htmlwidgets`
- Plotly via `plotly-binding`
- Bootstrap 3
- `tippy` tooltips

The paper says the original transformations were done in Microsoft Excel and spatial mapping was done in ArcGIS 10. The deployed Shiny app appears to be a viewer around already-computed LHA scores, not the primary calculation engine.

## Scoring Method

Their method is percentile based:

1. Convert each raw indicator to a ranked percentile from 0 to 100 across all LHAs.
2. Average indicator percentiles within each of four components:
   - Environmental exposures
   - Environmental effects
   - Socioeconomic conditions
   - Sensitive populations
3. Calculate Population Characteristics as the average of Socioeconomic Conditions and Sensitive Populations.
4. Calculate Pollution/Landscape Burden from Environmental Exposures and Environmental Effects, with Environmental Effects weighted by one half.
5. Scale each LHA's component score against the largest LHA value: `individual LHA score / largest LHA score * 10`.
6. Multiply scaled Population Characteristics by scaled Pollution/Landscape Burden for the final score out of 100.

Important missing-data rules from the paper:

- True zero values, such as no forestry mills in an LHA, were not used to calculate percentiles.
- Those zero values were assigned a score of 0 and included in final group scoring.
- Missing values, mainly from low-count census suppression, were excluded from percentile calculation and from final group scoring.

PGMaps does not currently have this exact aggregation mode. `src/maps/scorebuilder/lib/scoring.ts` has `cumulativeBurden`, but it calculates `sqrt(burden * max(vulnerability, adaptiveGap))`, which is not the BCEnviroScreen/CalEnviroScreen product formula. The UI also lists `modulePercentileRankedSum` and `healthyPlanPairwisePriority`, but the scoring branch currently falls back to the generic additive path for those aggregation names.

## BCEnviroScreen Data Needed

The BCEnviroScreen treatment needs these data families.

### Boundary And Join Frame

| Need | Original source | PGMaps status |
| --- | --- | --- |
| BC Local Health Area boundaries | BC Ministry of Health LHA boundaries | Present at `public/data/boundaries/BCMoH/local_health_areas.json` |
| LHA-level aggregation table | Built by paper authors from source layers | Missing as a ready table |
| Race/ethnicity comparison by LHA | 2016 Census DA data aggregated to LHA | Missing as a ready table |

### Socioeconomic Factors

| Indicator | Definition in paper | Original source | PGMaps status |
| --- | --- | --- | --- |
| Low education | Percent age 25-64 with no certificate, diploma, or degree | Statistics Canada 2016 DA | Source family present, but not derived as BCEnviroScreen LHA metric |
| Employment / EI beneficiaries | App label says EI beneficiaries; paper table defines unemployed labour force 15+ | Statistics Canada 2016 DA | Source family present, but not derived as BCEnviroScreen LHA metric |
| Low income | LIM-AT low income, age 18-64 private households | Statistics Canada 2016 DA | Source family present, but not derived as BCEnviroScreen LHA metric |
| Linguistic isolation | No knowledge of English or French | Statistics Canada 2016 DA | Source family present, but not derived as BCEnviroScreen LHA metric |
| Housing burdened renters/households | Spending 30%+ of income on shelter | Statistics Canada 2016 DA | Source family present, but not derived as BCEnviroScreen LHA metric |

PGMaps has broad 2021 Census extracts under `public/data/census`, including education, income, language, household, work, age, visible minority, Indigenous identity, and immigration variables. The gap is not source availability; it is deriving the exact rates and aggregating them to the chosen comparison geography.

### Sensitive Populations

| Indicator | Definition in paper | Original source | PGMaps status |
| --- | --- | --- | --- |
| COPD | Age-standardized incidence per 1000, 2015/16 | PHSA BC Community Health Atlas | Missing |
| Hypertension | Age-standardized incidence per 1000, 2015/16 | PHSA BC Community Health Atlas | Missing |
| Low birth weight | Rate per 1000 live births, 2011-2015 | PHSA BC Community Health Atlas | Missing |
| All causes of cancer | 2008-2012 average incident cases divided by 2011 population | PHSA BC Community Health Atlas | Missing |
| Diabetes mellitus | Age-standardized incidence per 1000, 2015/16 | PHSA BC Community Health Atlas | Missing |

PGMaps has health facility and service-access datasets, but those are not disease or birth-outcome rates. This is one of the largest gaps if the goal is a faithful BCEnviroScreen replica.

### Environmental Effects

| Indicator | Original source | PGMaps status |
| --- | --- | --- |
| Environmental remediation sites | BC Environmental Remediation Sites | Missing |
| Linear footprint | Forest tenure roads, DRA roads, railway lines, transmission lines, pipelines, geophysical lines, Trans Mountain pipeline | Partly present locally for CityPG roads; province-wide input stack missing |
| Disturbed land | Intact Forest Landscapes / Potapov et al. 2008, 2016 land-base comparison | Missing |
| Forestry mills | Natural Resources Canada mill facilities | Missing |
| Smelters and refineries | Natural Resources Canada Principal Mineral Areas / producing mines / oil and gas fields source family | Missing |
| Producing mines | Natural Resources Canada mine data | Missing; PGMaps has mineral tenures, not producing mine points |
| Oil and gas sites | Natural Resources Canada oil and gas fields plus BCER/BCOGC sources | Partly source-ready via BCER catalog entry, not summarized to LHA |
| Hazardous waste facilities | BC hazardous waste facilities | Missing |
| Wildfire burn area, 10-year | BC Wildfire historical fire perimeters | Missing as LHA burn-area summary; PGMaps has drought, fire zones, and AQ/fire-danger products |

### Environmental Exposures

| Indicator | Original source | PGMaps status |
| --- | --- | --- |
| PM2.5 annual mean | CANUE PM2.5, 2012, postal-code based, averaged to LHA | Remote CANUE aggregate service is available for BC health LHA and Census boundaries; not checked into `public/data/canue`; PGMaps also has air stations and AQMap PM2.5 snapshot tiles |
| Ozone annual mean | CANUE O3, 2015, postal-code based, averaged to LHA | Remote CANUE aggregate service is available for BC health LHA and Census boundaries; remaining work is BCEnviroScreen-specific metric selection/wiring |
| Traffic density | BC Ministry of Transportation traffic counts at Census Division level | CityPG traffic counts present, province-wide method missing |
| EMS water quality exceedances | BC EMS 4-year results against BC source water guidelines for lead, E. coli, nitrate, mercury, phosphorus, total organic carbon | PGMaps has drinking-water samples/notices, but not this EMS exceedance metric |
| Future temperature | PCIC Plan2Adapt 2010-2039 change relative to 1961-1990, Census Division level | Missing |
| Future precipitation | PCIC Plan2Adapt 2010-2039 change relative to 1961-1990, Census Division level | Missing |

The existing `src/lib/dataCatalog.ts` describes CANUE as a dataset family, `vendor/bcdatamapper/datascrapers/canue` has ingestion scripts, and the app fetches remote boundary aggregates from `https://data.map.ahmad.sh/canue/aggregates-v2/{source}/{level}/{family}_{year}_aggregate.json`. This checkout does not contain `public/data/canue`, but CANUE PM2.5, ozone, NO2, smoke, heat, greenness, active-living, and access aggregates should be treated as remote-ready rather than missing local scrape targets.

## What PGMaps Already Has

Strong foundations:

- Health boundaries: LHA, CHSA, HSDA, and HA boundaries under `public/data/boundaries/BCMoH`.
- Census data: Prince George DA/DB/CT/CSD/CD extracts and BC DA simplified chunks under `public/data/census`.
- Air monitoring context: BC ENV stations and other monitor metadata under `public/data/bc` and `public/data/airdatamap`.
- Local PM2.5 visualization assets: AQMap modelled PM2.5 raster/vector products under `public/data/aqmap`.
- Drinking-water public data: facilities, samples, and notices under `public/data/water`.
- Local road and traffic data: CityPG roads and traffic counts under `public/data/citypg`.
- Built-environment proxies: parks, transit, walkability, heat/shade, BC Assessment parcels, and service access layers.
- Index Lab infrastructure: metric metadata, caveats, directions, missing-data options, presets, export/report paths, and percentile normalization.

Weak or missing foundations:

- No ready BCEnviroScreen LHA indicator table.
- No PHSA disease/birth-rate indicators.
- No checked-in `public/data/canue` archive; CANUE PM2.5 and ozone are remote-ready through the aggregate service.
- No EMS water-quality exceedance layer or LHA rollup.
- No remediation sites, hazardous waste facilities, forestry mills, smelters/refineries, producing mines, or disturbed-land input layers.
- No province-wide linear-footprint stack matching the paper's exclusions and de-duplication rules.
- No BCEnviroScreen product aggregation mode.
- No exact zero-vs-missing handling for BCEnviroScreen indicator percentiles.

## Practical Build Plan

Phase 1 - Recreate the method without pretending it is complete:

- Add a `bcEnviroScreenProduct` aggregation mode that follows the paper's component formula.
- Add BCEnviroScreen component metadata for indicators: exposures, environmental effects, sensitive populations, socioeconomic factors.
- Add explicit zero and missing-data handling matching the paper.
- Build a "PG Local EnviroScreen Proxy" preset using only current PGMaps data.
- Label every substituted metric as proxy, not official BCEnviroScreen.

Phase 2 - Fill easiest source gaps:

- Derive 2021 Census equivalents for low education, unemployment, low income, no official-language knowledge, housing burden, age groups, visible minority, Indigenous identity, and immigration.
- Aggregate those to DA/CT and optionally to LHA for comparison.
- Wire remote CANUE annual BC aggregates for PM2.5, ozone, NO2, smoke, heat, greenness, active living, and access into BCEnviroScreen-compatible metric rows.
- Choose the BCEnviroScreen source year/statistic for PM2.5 and ozone and document how it maps to the remote CANUE aggregate families.

Phase 3 - Add environmental burden layers:

- Ingest BC remediation sites.
- Ingest hazardous waste facilities.
- Ingest NRCan mill facilities, producing mines, smelters/refineries, and oil/gas fields.
- Add BC Wildfire historical fire perimeters and summarize 10-year burn area by boundary.
- Build the linear-footprint layer from DRA roads, forest tenure roads, railways, transmission lines, pipelines, geophysical lines, and the Trans Mountain pipeline, with the same exclusion rules described in the paper.

Phase 4 - Add health and water:

- Locate and license/download PHSA BC Community Health Atlas indicators for COPD, hypertension, low birth weight, cancer, and diabetes at the smallest public geography available.
- Join health rates to LHA/CHSA only, with clear warnings if displayed beside DA/CT maps.
- Ingest BC EMS water-quality results and calculate exceedance shares against the same guideline thresholds.
- Add PCIC Plan2Adapt or successor climate normals/projection metrics for future temperature and precipitation.

## Recommended Product Framing

Avoid calling a PGMaps output "BCEnviroScreen" unless it uses the same geography, indicator definitions, source data, percentile rules, scaling, and formula. Better labels:

- PG Local EnviroScreen Proxy
- Prince George Cumulative Impact Screen
- PG Environmental Health Burden Proxy

The highest-value near-term version is a transparent local proxy. It should show the user:

- The raw value.
- The percentile.
- The component.
- Source year and source URL.
- Spatial join method.
- Whether the metric is official, proxy, or experimental.
- Missing-data status.
- Why each substitute is not the original BCEnviroScreen indicator.
