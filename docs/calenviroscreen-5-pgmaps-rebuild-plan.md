# CalEnviroScreen 5.0 PGMaps Rebuild Plan

Source reviewed: `/Users/ahmadjalil/Downloads/calenviroscreen50techreportd12226.pdf`

This note translates the draft CalEnviroScreen 5.0 technical report into a practical Prince George / BC implementation plan. It is not a plan to reproduce California's official scores. It is a plan to build a transparent CalEnviroScreen-style cumulative-impact model in PGMaps using BC and local substitutes.

## Core Model

CalEnviroScreen 5.0 uses 23 indicators at 2020 census tract scale.

Indicator raw values are converted to statewide percentile scores. Higher percentiles mean higher burden or vulnerability. Indicators with a true zero, such as no hazardous waste facilities, are excluded from the percentile calculation and assigned zero. Areas with genuinely missing data are excluded from that indicator and not assigned a score.

Component calculation:

```text
exposures = average(exposure indicator percentiles)
environmentalEffects = average(environmental effects indicator percentiles)
pollutionBurdenRaw = (exposures + 0.5 * environmentalEffects) / 1.5

sensitivePopulations = average(sensitive population indicator percentiles)
socioeconomicFactors = average(socioeconomic factor indicator percentiles)
populationCharacteristicsRaw = (sensitivePopulations + socioeconomicFactors) / 2

pollutionBurden = pollutionBurdenRaw / max(pollutionBurdenRaw) * 10
populationCharacteristics = populationCharacteristicsRaw / max(populationCharacteristicsRaw) * 10

score = pollutionBurden * populationCharacteristics
scorePercentile = percentile_rank(score)
```

The model architecture transfers cleanly to PGMaps. The hard part is not the formula. The hard part is indicator data quality, geography, and source equivalence.

## Recommended PGMaps Geography

Use Census Tracts as the first public scoring geography for Prince George.

Reasons:

- It is closest in spirit to CalEnviroScreen's neighborhood-scale census tract model.
- It is more interpretable than DA-level maps for public use.
- It avoids pretending that CHSA/LHA health outcomes are neighborhood-precise.
- DA can still be used internally for rollups and spatial attribution.

Use CHSA/LHA health outcomes as context overlays or coarse component inputs with clear warnings. Use CityPG community boundaries as a secondary storytelling view.

## Indicator Crosswalk

| CES 5.0 indicator | Exact California method | Prince George / BC equivalent |
| --- | --- | --- |
| Ozone | May-October daily maximum 8-hour ozone, 2021-2023, CARB monitor network, kriged to tract centers | BC hourly ozone monitor data or CANUE ozone. Need 3-year summer 8-hour metric and interpolation/rollup. |
| PM2.5 | Annual mean PM2.5, 2021-2023, wildfire-smoke days excluded, monitor/satellite/meteorology model on 1 km grid | CANUE PM2.5, AQMap, ECCC/BC monitors. Need decision: exclude wildfire days like CES or keep smoke as local burden. |
| Children's lead risk from housing | Older housing lead-paint likelihood, low-income households with children, and child blood lead tests | Strong public proxy from BC Assessment building age plus Census low income/children. Exact version needs child blood lead surveillance, likely not public. |
| Diesel PM | Gridded diesel PM emissions from on-road, stationary, area, and vessel sources | No clean BC equivalent yet. Proxy with truck routes, highways, rail, industrial activity, CANUE NO2, and traffic counts. |
| Drinking water contaminants | Drinking-water contaminant hazard index plus violations, 2014-2022 | Needs water service areas, monitoring results, advisories/violations, and private-well treatment. EMS/EnMoDS helps but is not a direct drinking-water system index. |
| Pesticide use | Pounds of selected hazardous/volatile agricultural active ingredients per square mile, 2021-2023 | Weak. BC lacks comparable public application geography. For PG, forestry/right-of-way/rail/utility pesticide use may matter more than production agriculture. |
| Toxic releases from facilities | RSEI toxicity-weighted modeled air releases from TRI/RETC, 2020-2022 | NPRI plus waste discharge authorizations can provide facility emissions. A RSEI-like toxicity/dispersion model is still needed. |
| Traffic impacts | Traffic volume adjusted by road segment length divided by road length within 150 m of tract | CityPG counts, MoTI traffic counts, DRA roads. Need volume assignment/interpolation to road segments and 150 m boundary buffers. |
| Cleanup sites | Weighted cleanup sites by type/status/proximity | BC remediation/contaminated sites, federal contaminated sites, site status, proximity weights. |
| Groundwater threats | Weighted LUST, cleanup, land disposal, produced-water, dairy/feedlot and other groundwater threat sites | BC groundwater wells, aquifers, remediation sites, fuel/spill/landfill/agricultural threat proxies. Exact public source is weaker than California GeoTracker. |
| Hazardous waste generators/facilities | Weighted hazardous waste facilities/generators/chrome plating, with buffers | BC hazardous-waste generator data is not cleanly public. Use waste authorizations, NPRI, industrial permits, and metal-finishing/facility proxies. |
| Impaired waters | Count of pollutant-waterbody impairments from 303(d) list | No direct BC 303(d) equivalent. Derive from EMS/EnMoDS exceedances, water quality objectives, advisories, fish advisories, and local impaired-use evidence. |
| Small air toxic sites | Weighted small air toxic sites and oil/gas wells | BC air authorization facilities, NPRI small emitters, oil/gas wells, fuel stations, auto body, asphalt/concrete, pulp/wood products, rail/industrial yards. |
| Solid waste sites/facilities | Weighted landfills, transfer, recycling, composting, closed/illegal sites, violations | Regional district and BC solid-waste facility data, landfill/transfer/composting/recycling/scrap sites, if geocoded. |
| Asthma | Spatially modeled age-adjusted ED visit rate for asthma per 10,000, 2022-2023 | Needs BC ED/hospital records by residence and age. Public data likely only CHSA/LHA, not CT/DA. |
| Cardiovascular disease | Spatially modeled age-adjusted ED visit rate for AMI per 10,000, 2021-2023 | Needs BC ED/hospital AMI records and age denominators. Public equivalent likely coarse. |
| Diabetes prevalence | CDC PLACES model-based adult diabetes prevalence, 2021 | Use BCCDC/PHSA chronic disease data if available, or model from CCHS/admin data under agreement. Public equivalent likely CHSA/LHA. |
| Low birth weight | Percent low-birth-weight singleton births, 2017-2023, geocoded to tract | Needs BC Vital Statistics birth records and suppression rules. Public equivalent likely coarse. |
| Educational attainment | ACS percent age 25+ with less than high school, 2019-2023 | Statistics Canada Census no certificate/diploma/degree, age 25+ if available. Strong. |
| Housing burden | HUD CHAS low-income households paying >50% income to housing, 2017-2021 | Needs Canadian custom tab or proxy. Stronger than simple 30% shelter-cost burden if we can combine low income plus severe shelter burden. |
| Linguistic isolation | ACS limited-English-speaking households, 2019-2023 | Census official-language limitation. Need policy choice: English-only vs English/French in BC context. |
| Poverty | ACS percent below 2x federal poverty level, 2019-2023 | Census LIM-AT, LICO, or MBM. LIM-AT is easiest and already aligned with BCEnviroScreen work. |
| Unemployment | ACS unemployed labour force age 16+, 2019-2023 | Statistics Canada unemployment rate age 15+. Strong. |

## What We Already Have

- Existing CalEnviroScreen 4.0 PGMaps analysis: `docs/calenviroscreen-pgmaps-analysis.md`
- BCEnviroScreen method/gap analysis: `docs/bcenviroscreen-pgmaps-gap-analysis.md`
- BCEnviroScreen raw rebuild inventory: `docs/bcenviroscreen-raw-data-inventory.md`
- Prince George source inventory: `docs/prince-george-enviro-screen-data-sources.md`
- App-ready PG data: census boundaries, CityPG roads/traffic/community layers, water samples/notices, AQMap PM2.5/fire products, heat/shade, walkability, parks, service access.
- BCEnviroScreen rebuild work: Shiny table extraction, validation outputs, LHA/CHSA boundaries, CANUE LHA work, EMS LHA work, PHSA health LHA work, IFL/disturbance work, traffic proxies, and CD-attributed benchmark values.

## Major Gaps

These gaps matter most for a CalEnviroScreen-style PG model:

- Diesel PM equivalent: no public BC diesel PM raster/source-sector model has been found.
- Health at neighborhood scale: asthma, AMI/CVD, diabetes, and low birth weight need restricted health/vital-statistics data for CT/DA-scale modeling.
- Drinking-water contaminant index: public EMS/EnMoDS can support water-quality proxies, but not the same as a service-area drinking-water compliance/hazard index.
- Pesticide application intensity: BC lacks a California PUR-like public small-area use table.
- Toxic release modeling: NPRI gives facility releases, but we still need toxicity weights and dispersion/proximity modeling.
- Hazardous-waste generator/facility registry: public BC bulk data is weaker than California DTSC/HWTS.
- Housing burden exactness: a Canadian CHAS-like low-income and severe-burden table is not directly staged.

## Practical Build Sequence

1. Implement the scoring method as a separate PGMaps aggregation mode, not as a rename of the current cumulative burden score.
2. Build a Census Tract PG pilot with indicators that are already strong: PM2.5/ozone proxy, traffic, lead-housing proxy, contaminated/remediation sites, NPRI/waste-authorized facilities, solid waste, education, low income, linguistic isolation, unemployment, and housing burden proxy.
3. Add source-readiness labels: official, strong proxy, weak proxy, restricted-data-needed, unavailable.
4. Add a worked example panel like the report: raw value, percentile, component, component average, scaled scores, final score.
5. Keep health outcomes as CHSA/LHA context first. Only include them in tract scores if we obtain modeled or access-approved small-area outputs.
6. Decide the smoke policy for PM2.5. CES 5.0 excludes wildfire-smoke days; a PG environmental health screen may want both versions because wildfire smoke is a major local exposure.

## Naming

Do not call a PGMaps output "CalEnviroScreen" unless it uses OEHHA data and exact method. Better project labels:

- PG Environmental Health Screen
- Prince George Cumulative Impact Screen
- PG Cumulative Burden Screen
- BC Cumulative Impact Prototype

## Bottom Line

The CalEnviroScreen 5.0 report gives us a strong model template and a clean scoring formula. PGMaps can implement the model now, but a faithful local version will be a proxy screen until we solve restricted health data, diesel PM, pesticide use, drinking-water service-area contaminants, and hazardous-waste facility/generator data.
