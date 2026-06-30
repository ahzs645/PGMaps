# Prince George EnviroScreen Data Source Plan

Reviewed on 2026-06-29.

This is a Prince George-focused source inventory for building a BCEnviroScreen-inspired cumulative impact screen in PGMaps. It separates data that PGMaps already has from data we still need to ingest or roll up.

## Recommended Geography

Use these levels for different products:

- Public local screen: Prince George census DA/CT or CityPG communities.
- BCEnviroScreen comparison mode: BC Local Health Areas, especially Prince George LHA.
- Health context: CHSA/LHA only unless a source explicitly supports finer geography.
- Environmental burden overlays: CityPG boundary plus a regional buffer where a source is relevant outside municipal limits.

## Already Available In PGMaps

| Need | Local source/path | Use |
| --- | --- | --- |
| Prince George census boundaries and variables | `public/data/census/**` | Derive local socioeconomic indicators: low income, education, language, age, housing, labour, identity variables. |
| BC health boundaries | `public/data/boundaries/BCMoH/*.json` | Join LHA/CHSA health indicators and BCEnviroScreen-style LHA rollups. |
| CityPG roads and traffic counts | `public/data/citypg/roads.geojson`, `public/data/citypg/traffic_counts.geojson` | Local traffic/road burden proxy. |
| CityPG parks, trees, facilities, ecology, flood hazard, business licences | `public/data/citypg/**`, `public/data/heat-shade/**`, `public/data/healthyplan-pg/**` | Local access, shade, built environment, and adaptive capacity proxies. |
| Drinking water samples/notices | `public/data/water/**` | Local drinking-water context, but not the EMS exceedance metric from the paper. |
| BC air monitoring stations | `public/data/bc/bc_air_monitoring_stations.csv` | Monitoring context and validation for modeled air layers. |
| AQMap PM2.5 snapshots | `public/data/aqmap/**` | Local PM2.5 map context; not the same as annual CANUE exposure. |
| CANUE BC air-quality PMTiles on R2 | `https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json` | Remote source for PM2.5 and ozone surfaces; still needs boundary rollup. |

## Highest Priority Missing Sources

| Indicator family | Recommended source | Source URL | PG implementation step |
| --- | --- | --- | --- |
| Chronic disease and birth outcomes | BC Community Health Data / PHSA health database and profiles | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Download indicators for Prince George LHA/CHSA: COPD, hypertension, diabetes, low birth weight, cancer if available. |
| Chronic disease dashboard context | BCCDC Chronic Disease Dashboard | https://www.bccdc.ca/health-professionals/data-reports/chronic-disease-dashboard | Use for validation/context; confirm export options and geography before using in scoring. |
| EMS water quality exceedances | BC Environmental Monitoring System Results | https://catalogue.data.gov.bc.ca/dataset/949f2233-9612-4b06-92a9-903e817da659 | Filter to PG/LHA-relevant monitoring sites, calculate exceedance shares for lead, E. coli, nitrate, mercury, phosphorus, TOC. Note EMS stops receiving new data after 2026-02-26; use EnMoDS for newer data. |
| Environmental remediation sites | BC Environmental Remediation Sites | https://catalogue.data.gov.bc.ca/dataset/environmental-remediation-sites | Count sites in Prince George geographies or within buffer; summarize to LHA/DA/CT. |
| Industrial releases | National Pollutant Release Inventory bulk data | https://open.canada.ca/data/en/dataset/40e01423-7728-429c-ac9d-2954385ccdfb | Filter facilities near Prince George, calculate release totals/counts and pollutant-class summaries. |
| Human disturbance | BC Human Disturbance 2025 | https://catalogue.data.gov.bc.ca/dataset/7d61ff12-b85f-4aeb-ac8b-7b10e84b046c | Preferred disturbed-land source; summarize disturbed area share for PG boundaries/LHA. |
| Integrated roads / linear footprint | BC CEF Integrated Roads 2026 | https://catalogue.data.gov.bc.ca/dataset/bc-cumulative-effects-framework-integrated-roads-current | Preferred road/linear-footprint source if using modern BC cumulative-effects data. |
| Wildfire burned area | BC Wildfire Historical Fire Perimeters | https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-historical | Calculate percent of boundary burned in selected period, e.g. 2010-2019 for paper compatibility. |
| Future temperature/precipitation | PCIC Plan2Adapt | https://services.pacificclimate.org/plan2adapt/app/ | Extract regional future temperature/precipitation change for Prince George or relevant BC region. |
| Climate gridded data | PCIC Data Portal / ClimateData.ca | https://data.pacificclimate.org/portal/docs/ and https://climatedata.ca/ | Use if we need grid-based summaries instead of Plan2Adapt region values. |

## Environmental Burden Sources

| Indicator | Recommended source | Source URL | Notes |
| --- | --- | --- | --- |
| Remediation sites | BC Environmental Remediation Sites | https://catalogue.data.gov.bc.ca/dataset/environmental-remediation-sites | Direct match to paper. |
| Hazardous waste facilities | BC Hazardous Waste Facilities | https://catalogue.data.gov.bc.ca/dataset/hazardous-waste-facilities | Dataset is marked deprecated; use cautiously or replace with waste-discharge/authorization sources. |
| Timber/forestry mills | BC Major Timber Processing Facilities | https://catalogue.data.gov.bc.ca/dataset/british-columbia-major-timber-processing-facilities | Better current BC source than the paper's NRCan mill facility source. |
| Producing/major mines | BC Permitted Mine Areas - Major Mine | https://catalogue.data.gov.bc.ca/dataset/permitted-mine-areas-major-mine | For PG, summarize distance/count/area; may need "producing" filter from attributes or supplement with NRCan. |
| Oil and gas fields | BC Oil and Gas Fields | https://catalogue.data.gov.bc.ca/dataset/ogc-oil-and-gas-fields | Mostly northeast BC; probably low direct PG relevance but useful for LHA comparison. |
| Oil and gas wells | BC Energy Regulator public well data / PGMaps BCER source | https://www.bc-er.ca | PGMaps already has a BCER catalog entry, but not a local EnviroScreen metric. |
| Railways | BC Railway Track Line | https://catalogue.data.gov.bc.ca/dataset/railway-track-line | Use for linear footprint and rail-proximity burden. |
| Transmission lines | BC Transmission Lines | https://catalogue.data.gov.bc.ca/dataset/bc-transmission-lines | Use for linear footprint. |
| Roads | Digital Road Atlas and CityPG roads | https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads | CityPG roads are already local; DRA supports regional/provincial comparison. |
| Forest roads | Forest Tenure Road Section Lines | https://catalogue.data.gov.bc.ca/dataset/forest-tenure-road-section-lines | Use if reconstructing the paper's linear footprint manually. |
| Human disturbance composite | BC Human Disturbance 2025 | https://catalogue.data.gov.bc.ca/dataset/7d61ff12-b85f-4aeb-ac8b-7b10e84b046c | Best modern one-layer substitute for disturbed landscape. |
| Integrated roads composite | BC CEF Integrated Roads 2026 | https://catalogue.data.gov.bc.ca/dataset/bc-cumulative-effects-framework-integrated-roads-current | Best modern one-layer substitute for road footprint. |

## Exposure Sources

| Indicator | Recommended source | Source URL | Notes |
| --- | --- | --- | --- |
| Annual PM2.5 | CANUE BC R2 PMTiles | https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json | 2012 air-quality layer exists. Need choose exact variable/version and summarize to boundary. |
| Ozone | CANUE BC R2 PMTiles | https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json | 2015 air-quality layer exists with ozone monthly/seasonal variables. Need choose exact metric. |
| PM2.5 validation/context | ECCC/NAPS and BC air stations | https://www.canada.ca/en/environment-climate-change/services/air-pollution/monitoring-networks-data/national-air-pollution-program.html | Use for monitor context; modeled surface is better for area scoring. |
| Traffic density | CityPG traffic counts plus DRA/MoTI traffic data | `public/data/citypg/traffic_counts.geojson` and https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads | PG local metric can be stronger than the paper's Census Division traffic density. |
| Water quality exceedances | BC EMS Results / EnMoDS successor | https://catalogue.data.gov.bc.ca/dataset/949f2233-9612-4b06-92a9-903e817da659 | Need parameter thresholds and site-to-boundary joins. |
| Drinking-water notices/samples | PGMaps water data | `public/data/water/**` | Good local context, but not identical to EMS surface-water exceedance indicator. |

## Socioeconomic Sources

| Indicator | Recommended source | Source URL | Notes |
| --- | --- | --- | --- |
| Low income | Statistics Canada 2021 Census Profile | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E | Already partially local in PGMaps; derive exact rate. |
| Low education | Statistics Canada 2021 Census Profile | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E | Already partially local in PGMaps; derive exact rate. |
| Unemployment | Statistics Canada 2021 Census Profile | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E | Already partially local in PGMaps; derive exact rate. |
| Linguistic isolation | Statistics Canada 2021 Census Profile | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E | Use no knowledge of English/French or official-language proxy. |
| Housing burden | Statistics Canada 2021 Census Profile | https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E | Use shelter-cost-to-income 30%+ variables. |
| Race/ethnicity comparison | Statistics Canada visible minority, Indigenous identity, ethnic origin variables | `public/data/census/variables/**` and StatsCan profile | Use carefully with Canadian framing; do not treat as biological risk. |
| Census boundaries | Statistics Canada 2021 boundary files | https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21 | PGMaps already has PG census boundaries. |

## Health Sources

| Indicator | Recommended source | Source URL | Notes |
| --- | --- | --- | --- |
| COPD | BC Community Health Data / BCCDC dashboard | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Need confirm export availability and geography. |
| Hypertension | BC Community Health Data / BCCDC dashboard | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Need confirm exact indicator name and age standardization. |
| Diabetes | BC Community Health Data / BCCDC dashboard | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Likely available; use LHA/CHSA only. |
| Low birth weight | BC Community Health Data | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Need confirm available period and suppression rules. |
| Cancer incidence | BC Community Health Data and/or BC Cancer statistics | https://communityhealth.phsa.ca/getthedata/SearchByLocation | Need confirm geography and indicator definition. |
| Chronic disease registry access | Population Data BC CDR | https://www.popdata.bc.ca/data/health/cdr | Research-access path if public dashboards are insufficient. |

## What Is Still Truly Missing After Source Discovery

- A processed Prince George/BC boundary rollup table.
- Exact CANUE variable selection to match the paper's PM2.5 and ozone vintages.
- Health indicator exports for Prince George LHA/CHSA.
- EMS water-quality parameter filtering and guideline-threshold logic.
- A replacement decision for deprecated hazardous-waste facility data.
- A PGMaps scoring mode that implements BCEnviroScreen-style component scoring, zero handling, scaling, and final product score.
- Validation against known BCEnviroScreen high/low LHA scores from the paper supplement.

## Recommended First Build

1. Implement a local PG proxy using existing PGMaps census, water, traffic, heat/shade, parks, AQMap, and CANUE R2 air-quality layers.
2. In parallel, ingest the BC Human Disturbance 2025, Integrated Roads 2026, Remediation Sites, NPRI, and Fire Perimeters sources.
3. Add health only at LHA/CHSA level after confirming PHSA/BCCDC export fields.
4. Keep the public label as "PG EnviroScreen Proxy" until the exact paper formula and source equivalence are implemented.
