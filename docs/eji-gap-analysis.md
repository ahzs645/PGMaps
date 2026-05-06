# EJI Methodology and PGMaps Gap Analysis

Research started: 2026-05-06

## Sources Reviewed

- CDC/ATSDR EJI Explorer: https://www.atsdr.cdc.gov/place-health/php/eji/eji-explorer.html
- CDC/ATSDR 2024 EJI Technical Documentation: https://www.atsdr.cdc.gov/place-health/media/pdfs/2024/10/EJI_2024_Technical_Documentation.pdf
- EJI FAQ indicator list: https://www.atsdr.cdc.gov/place-health/php/eji/eji-frequently-asked-questions-faqs.html
- EJI Social Vulnerability indicators: https://www.atsdr.cdc.gov/place-health/php/eji/eji-indicators-social-vulnerability-module.html
- EJI Environmental Burden indicators: https://www.atsdr.cdc.gov/place-health/php/eji/eji-indicators-environmental-burden-module.html
- EJI Health Vulnerability indicators: https://www.atsdr.cdc.gov/place-health/php/eji/eji-indicators-health-vulnerability-module.html
- EJI Climate Burden indicators: https://www.atsdr.cdc.gov/place-health/php/eji/eji-indicators-climate-burden-module.html

## Core EJI Equations

The 2024 EJI uses percentile ranks at the U.S. census-tract level. Individual raw indicators are percentile ranked, then module scores are built from sums of those percentile-ranked indicators, and final combined scores are percentile ranked again.

Base EJI:

```text
SVM = percentile_rank(sum(social vulnerability indicator percentile ranks))
EBM = percentile_rank(sum(environmental burden indicator percentile ranks))
HVM = 0.2 * sum(health prevalence top-tertile flags, n = 5)

SPL_EJI = RPL_EBM + RPL_SVM + RPL_HVM
RPL_EJI = percentile_rank(SPL_EJI)
```

Social-Environmental Ranking:

```text
SPL_SER = RPL_EBM + RPL_SVM
RPL_SER = percentile_rank(SPL_SER)
```

EJI + Climate Burden:

```text
CBM = percentile_rank(sum(climate burden indicator percentile ranks))
SPL_EJI_CB = RPL_EBM + RPL_SVM + RPL_HVM + RPL_CBM
RPL_EJI_CBM = percentile_rank(SPL_EJI_CB)
```

Notes:

- EBM, SVM, HVM, and CBM are equally weighted in the combined scores.
- Domains are reported for interpretation but are not used in the final EJI equation.
- Health indicators are not summed as continuous prevalence estimates. They are converted to binary flags when a tract is in the top tertile nationally, then summed and multiplied by 0.2.
- Missing values generally exclude tracts from overall ranking, with explicit exceptions for impaired surface water and climate indicators where nulls may be set to zero with flags.

## Current PGMaps Equivalent

PGMaps already has the pieces for a local EJI-style engine:

- Percentile normalization in `src/maps/scorebuilder/lib/scoring.ts`.
- A `cumulativeBurden` aggregation mode.
- Boundary-level comparison universes across census and CityPG regions.
- Existing local metric groups: air monitoring, parks, heat/shade, food safety, census population, BC Assessment property/housing, crime, transit, and Statistics Canada CIMD deprivation.

However, the current score builder is a flexible local proxy. It does not yet implement the exact EJI module hierarchy, top-tertile health flags, domain reporting, or missing-data exclusion rules.

## Indicator Gap Matrix

### Social Vulnerability Module

| EJI indicator | EJI source concept | PGMaps status | Best local path |
| --- | --- | --- | --- |
| Racial/ethnic minority status | ACS, all persons except non-Hispanic white | Partial | Use Canadian census visible minority/Indigenous/immigration variables carefully, with Canadian framing and caveats. |
| Poverty below 200% FPL | ACS income poverty | Missing exact | Use after-tax low-income status, LIM/LICO, or CIMD economic dependency. |
| No high school diploma | ACS education | Likely available in census raw vectors, not scored | Add derived census metric. |
| Unemployment | ACS labour force | Likely available in census raw vectors, not scored | Add derived census metric. |
| Renters | ACS renter-occupied housing | Likely available in census raw vectors, not scored | Add derived census metric. |
| Housing cost burden | Low-income households spending >30% on housing | Likely available or approximable | Add census shelter-cost burden metric if vectors exist. |
| Lack of health insurance | ACS insurance | Not applicable in Canada | Omit or replace with primary-care access / attachment if available. |
| Lack of internet access | ACS internet subscription | Likely available in census raw vectors | Add derived census metric. |
| Age 65+ | ACS age | Available in census raw vectors, not scored | Add derived census metric. |
| Age 17 and younger | ACS age | Available with Canadian age bands | Add 0-14 plus 15-19 approximation or use youth 0-14 explicitly. |
| Disability | ACS disability | Likely limited at small geography | Search census/profile or Canadian Survey on Disability; may be unavailable at DA. |
| English language proficiency | ACS speaks English less than well | Partial | Use no official-language knowledge / non-official home language variables. |
| Group quarters | ACS group quarters | Likely available in census | Add derived census metric. |
| Mobile homes | ACS mobile homes | Likely available in census dwelling type | Add derived census metric. |

### Environmental Burden Module

| EJI indicator | EJI source concept | PGMaps status | Best local path |
| --- | --- | --- | --- |
| Ozone exceedance days | EPA AQS, 3-year mean NAAQS exceedance days | Missing | Need modeled ozone surface or BC/Canada station observations interpolated to local boundaries. |
| PM2.5 exceedance days | EPA AQS, 3-year mean NAAQS exceedance days | Partial | We have monitor inventory, not exposure/exceedance surfaces. Need observations/model output. |
| Diesel particulate matter | EPA AirToxScreen | Missing | Candidate: CANUE traffic/NO2, road freight proxies, emission inventory. |
| Air toxics cancer risk | EPA AirToxScreen | Missing | Need NPRI/toxic emissions + dispersion/risk model; hard gap. |
| NPL sites | EPA FRS 1-mile buffer share | Not applicable exact | Replace with contaminated sites / federal contaminated sites / BC remediation sites if available. |
| TRI sites | EPA FRS 1-mile buffer share | Missing Canadian equivalent | Use NPRI facilities, buffered share by region. |
| TSD sites | EPA FRS 1-mile buffer share | Missing | Need waste-management / hazardous waste facilities data. |
| RMP sites | EPA FRS 1-mile buffer share | Missing | Need hazardous industrial/chemical facility registry equivalent. |
| Coal mines | MSHA 1-mile buffer share | Likely not relevant in PG city | Check BC mine inventory; likely zero/low relevance. |
| Lead mines | MSHA 1-mile buffer share | Missing/likely not relevant | Check BC mine inventory. |
| Lack of recreational parks | PAD-US inverse 1-mile park buffer share | Strong partial | We have parks/trails/amenities and park walk-access metrics. Need EJI-style inverse buffer-area calculation. |
| Housing built pre-1980 | ACS occupied housing pre-1980 | Partial | We have BC Assessment building age; could derive pre-1980 share by parcel/region. |
| Lack of walkability | EPA National Walkability Index inverse | Partial | We have transit/service access, but no walkability index. Need street-network/intersection/land-use mix metric. |
| High-volume roads | NHS 1-mile buffer share | Missing | Need road class/traffic volume/AADT from CityPG/BC; can buffer highways/arterials as proxy. |
| Railways | NTAD 1-mile buffer share | Missing but easy | Add rail line geometries from OSM/CityPG/BC and calculate buffered share. |
| Airports | OSM/NTAD 1-mile buffer share | Missing but easy | Add airport/aerodrome polygons or points and calculate buffered share. |
| Impaired surface water | EPA WSIO impaired watershed area share | Missing | Need BC/Canada water quality impairment layers; likely non-trivial. |

#### What EJI actually does for lack of walkability

EJI does not calculate walkability from sidewalks, routing, or park/service access. It uses EPA's 2021 National Walkability Index (NWI), then converts it into a burden indicator:

```text
block-group NWI = rank(intersection density) / 3
                + rank(proximity to transit stops) / 3
                + rank(employment mix) / 6
                + rank(employment + household mix) / 6

tract NWI = average(block-group NWI scores in the tract)
lack_of_walkability = 1 - percentile_rank(tract NWI)
```

EPA first puts every U.S. block group into 20 ranked quantiles for each input variable, so each component rank runs from 1 to 20. The final NWI score is also on a 1-20 scale, categorized as least walkable through most walkable. ATSDR then aggregates block-group NWI to census tract, ranks tracts nationally, and subtracts the percentile rank from 1. A tract more walkable than 95% of tracts gets a lack-of-walkability value of 0.05.

For PGMaps, the closest direct Canadian path is not our current park/transit access proxy. It is either:

- load CANUE Active Living Environment (Can-ALE) and rank/invert it similarly, or
- build a local NWI-style index from street intersection density, transit-stop proximity, employment/land-use mix, and household/employment mix.

Current `parkWalk10Access`, `parkWalk20Access`, and `serviceAccessComposite` should stay labelled as service-access proxies, not walkability.

Employment + household mix needs special care. PGMaps has the household side from Census, and it has resident labour/work variables including labour-force status, occupation, industry, class of worker, and commuting. Those Census variables describe residents, not necessarily jobs located in each DA/DB. EPA's employment + household mix is an entropy/mix measure of employment types located in the block group plus occupied households, so the local Census data is not a clean equivalent by itself. A closer local proxy would need located employment data, such as CityPG business licences joined to parcels by PID and then assigned to census areas.

### Health Vulnerability Module

| EJI indicator | EJI source concept | PGMaps status | Best local path |
| --- | --- | --- | --- |
| Asthma prevalence flag | CDC PLACES top-tertile flag | Missing | Need Canadian small-area health estimates; maybe BC Community Health Atlas/CHSA, not DA. |
| Cancer prevalence flag | CDC PLACES top-tertile flag | Missing | Same as above; likely only coarser geography. |
| Coronary heart disease prevalence flag | CDC PLACES top-tertile flag | Missing | Same as above. |
| Diabetes prevalence flag | CDC PLACES top-tertile flag | Missing | Same as above. |
| Poor mental health prevalence flag | CDC PLACES top-tertile flag | Missing | Same as above. |

Health is the largest methodological gap because EJI intentionally avoids summing health prevalence estimates and uses top-tertile flags. We need small-area chronic disease data before we can reproduce that module credibly.

### Climate Burden Module

| EJI indicator | EJI source concept | PGMaps status | Best local path |
| --- | --- | --- | --- |
| Extreme heat days | Annual mean extreme heat days | Partial | We have heat/shade proxies and Landsat scene metadata, but not annual extreme heat-day frequency by boundary. |
| Wildfire smoke | Average smoky days | Missing | Use BlueSky/FireWork/NOAA HMS equivalent, AQ monitor PM2.5 smoke-day classification, or satellite smoke plumes. |
| Wildfire proximity | Annualized burned area | Missing | Use BC Wildfire perimeters and buffer/intersection by boundary. |
| Coastal flooding | FEMA NRI | Not relevant | Omit for Prince George. |
| Drought | FEMA NRI drought frequency | Missing | Use Canadian Drought Monitor / SPEI grid. |
| Riverine flooding | FEMA NRI flood frequency | Missing | Need floodplain/hazard frequency data from BC/CityPG/NRCan. |
| Hurricane | FEMA NRI | Not relevant | Omit. |
| Strong winds | FEMA NRI | Missing/low priority | Need Canadian severe wind climatology if retained. |
| Tornado | CDC Tracking tornado frequency | Low relevance | Likely omit or use Environment Canada event history if needed. |

## Priority Data Work

1. Census-derived SVM metrics
   - Highest value and easiest.
   - We already have broad Census 2021 vectors. Build a derived social-vulnerability dataset for DA/CT using Canadian equivalents.

2. EJI-style built-environment burdens
   - Park access inverse buffer share, pre-1980 housing share, rail/airport/high-volume-road proximity.
   - Mostly geometry operations and available public data.

3. Air exposure surfaces
   - Move beyond monitor density to actual PM2.5/ozone/NO2 exposure or exceedance metrics.
   - Candidate sources: BC air monitoring observations, CANUE, satellite/model products.

4. Hazardous/toxic facility proxies
   - Add NPRI facilities, contaminated/remediation sites, waste facilities, active/legacy mines.
   - Compute EJI-style 1-mile/1.6-km buffer area share.

5. Climate burden
   - Add wildfire perimeter exposure, smoke-day proxy, drought proxy, floodplain proxy, and actual extreme-heat-day frequency.

6. Health vulnerability
   - Find BC/Canada small-area chronic disease prevalence. If unavailable below CHSA/LHA, keep this as a coarse contextual layer, not a DA-level EJI module.

## Canadian Dataset Crosswalk

This is the practical Canada/BC equivalent list for building a Prince George EJI-inspired index. The labels below distinguish direct equivalents from proxies because several U.S. EJI inputs are tied to U.S.-specific programs such as ACS, EPA AirToxScreen, EPA FRS, FEMA NRI, and CDC PLACES.

### Already present or close in the repo

| EJI area | Local dataset path | Use |
| --- | --- | --- |
| PM2.5 exposure | `public/data/canue/bc/annual/pm25dale_a_2021_bc.csv` | Annual modeled PM2.5 exposure surface; better for small-area ranking than monitor proximity. |
| Wildfire smoke exposure | `public/data/canue/bc/annual/aqsmk_avb_2022_bc.csv` | Retrospective smoke PM2.5 / smoky-day style burden proxy. |
| Active living / walkability | `public/data/canue/bc/annual/ale_a_2016_bc.csv` | Canadian active living environment proxy. |
| Road proximity | `public/data/canue/bc/annual/dtr_a_2018_bc.csv` | Traffic/road exposure proxy; can support high-volume road proximity if paired with traffic counts. |
| Transit, accessibility, density, connectivity | `public/data/canue/bc/annual/nhtsp_ava_2019_bc.csv`, `nhacs_ava_2021_bc.csv`, `nhscn_ava_2019_bc.csv`, `nhbld_ava_2019_bc.csv` | Built-environment and access domains. |
| Census social variables | `public/data/census/**` | Age, education, income, tenure, language, immigration, Indigenous identity, visible minority, household, dwelling, mobility, commute, and labour variables. |
| Health boundaries | `public/data/boundaries/BCMoH/*.json` | CHSA/LHA/HSDA/HA geographies for joining coarser BC health data. |
| Air monitoring stations | `public/data/bc/bc_air_monitoring_stations.csv` | Station context for PM2.5, ozone, NO2, and other pollutants; not yet an exposure surface. |

### Strong Canadian equivalents to add

| EJI indicator group | Canadian/BC source | Resolution | Fit |
| --- | --- | --- | --- |
| Census social vulnerability | Statistics Canada 2021 Census Profile and profile downloads | DA/CT/CSD and above | Strong. Use Canadian constructs such as LIM-AT low income, no diploma, unemployment, renter share, shelter cost burden, age, official-language knowledge, collective dwelling, and movable dwelling. |
| Composite deprivation | Statistics Canada 2021 Canadian Index of Multiple Deprivation (CIMD) | DA | Strong Canadian analogue, but not one-for-one EJI. Useful as a reference or preset. |
| PM2.5 / ozone observations | ECCC/NAPS and BC Air Data Archive | Stations | Strong official observations, but needs interpolation, nearest-monitor assignment, or modeled surfaces for DA ranking. |
| Traffic pollution | CANUE NO2 / road proximity, BC Ministry of Transportation traffic counts, Digital Road Atlas | Modeled surface, count points, road segments | Good proxy for diesel/traffic burden. No public diesel PM raster equivalent was identified. |
| TRI equivalent | National Pollutant Release Inventory (NPRI) | Facility records | Strong conceptual equivalent to EPA TRI. Use buffers, release totals, and pollutant class filters. |
| Contaminated sites / NPL equivalent | BC Site Registry and Federal Contaminated Sites Inventory | Site records | Best Canadian analogue to Superfund/NPL, but no single national priority list matches NPL. |
| Hazardous waste / TSD equivalent | BC hazardous waste registration and BC waste discharge authorizations | Facility/authorization records | Good regulatory proxy, but likely requires geocoding and filtering. |
| RMP equivalent | ECCC Environmental Emergency Regulations / E2 Reporting System | Regulated facilities | Closest conceptual equivalent, but bulk public facility data is not clearly available. NPRI/permits may be needed as proxy. |
| Mines | BC Major Mine permitted areas, mine notices, BC Mine Information | Points/polygons | Strong for current/permitted mining exposure near Prince George. |
| Parks | City of Prince George open data, CPCAD, BC Parks | Municipal and protected-area polygons | Strong if municipal parks are included; CPCAD/BC Parks alone miss local urban parks. |
| Pre-1980 housing | Census dwelling period of construction or BC Assessment building age | DA or parcel-derived | Strong. Census is official; BC Assessment can provide parcel-level precision where usable. |
| Railways | NRCan National Railway Network / StatsCan infrastructure databases | Line features | Strong for rail proximity. Rail traffic volume is still missing. |
| Airports | Transport Canada, BC certified airports, StatsCan infrastructure databases | Points/polygons | Strong for airport proximity; emissions/noise contours are the gap. |
| Water impairment | BC EnMoDS/EMS results, BC Water Quality Objectives, ECCC freshwater quality monitoring | Monitoring stations/waterbodies | Usable, but must be derived. Canada/BC do not provide a clean CWA 303(d)-style impaired-waters layer. |
| Extreme heat days | ECCC climate observations, ClimateData.ca, PCIC/gridded products | Station or gridded | Strong source family. Needs a local rule such as annual days over 30 C / humidex threshold by DA/CT. |
| Wildfire perimeters | BC Wildfire historical/current fire perimeters and Canadian National Fire Database | Fire polygons/points | Strong. Compute distance, burned area in buffer, or recent-fire exposure. |
| Drought | Canadian Drought Monitor and BC drought portal | Monthly raster/basin classes | Good. Convert to months/year in D0-D4 or max annual class. |
| Riverine flooding | BC floodplain maps, Fraser/Nechako floodplain maps, Water Survey of Canada hydrometric data, FHIMP projects | Floodplain polygons and gauges | Strong local relevance for Prince George, but maps may be historical and not climate-adjusted. |

### True gaps or proxy-only items

| EJI item | Missing Canadian equivalent | Recommended treatment |
| --- | --- | --- |
| Lack of health insurance | Universal provincial insurance makes the U.S. construct non-applicable. | Omit from Canadian SVM, or replace with primary-care attachment / regular provider as a separate access-to-care proxy. |
| Disability at DA scale | Canadian Survey on Disability is not a clean DA-level public layer. | Keep as missing unless a public small-area table is found; do not impute from coarse survey estimates. |
| Household internet subscription at DA scale | Broadband availability exists, but household subscription/affordability is not a clean Census Profile equivalent. | Use ISED/CRTC broadband availability as infrastructure access, labelled separately from household internet access. |
| Air toxics cancer risk | No Canadian AirToxScreen/NATA-style public cancer-risk surface. | Use NPRI toxic releases as a facility-emissions proxy, or build a separate toxicity-weighted dispersion model if the project needs this. |
| Diesel particulate matter raster | No public Canadian diesel PM exposure surface equivalent identified. | Use CANUE NO2, road proximity, truck routes, and traffic counts as traffic-emissions proxies. |
| RMP public bulk locations | E2 is the conceptual equivalent, but public bulk facility access is unclear. | Use NPRI, waste discharge authorizations, hazardous-waste registrations, and industrial permits as the practical facility-risk proxy. |
| Impaired waters list | No direct CWA 303(d)-style impaired waters layer. | Derive exceedance/impairment from BC water monitoring and objectives; label as derived. |
| CDC PLACES health prevalence at DA/tract scale | BC health data is available mainly at CHSA/LHA/HSDA/HA, not DA. | Join BC CDC/PHSA chronic disease rates at health boundaries, or keep health as contextual/coarse module with warnings. |
| Poor mental health days | EJI's survey construct is not the same as diagnosed depression/anxiety administrative data. | Use BC CDC depression/mood-anxiety indicators as diagnosed-condition proxies, clearly renamed. |
| Coastal flooding and hurricanes | Not geographically relevant to Prince George. | Omit or mark N/A for Prince George; handle riverine flooding, heat, wildfire, drought, and wind instead. |

### Source Links For The Canadian Crosswalk

- Statistics Canada Census Profile and downloads: https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E
- Statistics Canada 2021 CIMD: https://www150.statcan.gc.ca/n1/en/catalogue/452000012023001
- BC CDC Chronic Disease Dashboard: https://www.bccdc.ca/Our-Services-Site/Pages/Chronic-Disease-Dashboard-.aspx
- PHSA Community Health Data: https://communityhealth.phsa.ca/
- ECCC/NAPS air quality data: https://www.canada.ca/en/environment-climate-change/services/air-pollution/monitoring-networks-data/national-air-pollution-program/results.html
- BC Air Data Archive: https://www2.gov.bc.ca/gov/content/environment/air-land-water/air/air-quality/current-air-quality-data/bc-air-data-archive
- CANUE data availability: https://www.popdata.bc.ca/sites/default/files/documents/data/Checklists/CANUE_Data_Available_Sep_2024.pdf
- NPRI data access: https://www.canada.ca/en/environment-climate-change/services/national-pollutant-release-inventory/tools-resources-data/access.html
- BC Site Registry: https://www2.gov.bc.ca/gov/content/environment/air-land-water/site-remediation/site-information
- Federal Contaminated Sites Inventory: https://www.tbs-sct.canada.ca/fcsi-rscf/home-accueil-eng.aspx
- BC hazardous waste registration: https://www2.gov.bc.ca/gov/content/environment/waste-management/hazardous-waste/registration-of-hazardous-waste-generators-and-facilities
- ECCC Environmental Emergency Regulations: https://www.canada.ca/en/environment-climate-change/services/environmental-emergencies-program/regulations.html
- BC mining GIS data: https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/mineral-titles/data-gis/dataset-descriptions-download
- CPCAD protected areas: https://www.canada.ca/en/environment-climate-change/services/national-wildlife-areas/protected-conserved-areas-database.html
- Prince George Open Data: https://www.princegeorge.ca/city-hall/maps-information-requests/open-data
- NRCan National Railway Network: https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8
- ECCC GeoMet climate daily API: https://api.weather.gc.ca/collections/climate-daily?f=html
- ClimateData.ca data: https://climatedata.ca/about/our-data/
- BC wildfire historical perimeters: https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-historical
- Canadian National Fire Database: https://cwfis.cfs.nrcan.gc.ca/ha/nfdb?type=pnt
- Canadian Drought Monitor service: https://agriculture.canada.ca/imagery-images/rest/services/canadian_drought_monitor/ImageServer
- BC floodplain mapping: https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drought-flooding-dikes-dams/integrated-flood-hazard-management/governance/flood-hazard-land-use-management/floodplain-mapping
- Water Survey of Canada hydrometric API: https://api.weather.gc.ca/collections/hydrometric-stations?f=html
- BC EnMoDS water monitoring: https://www2.gov.bc.ca/gov/content/environment/research-monitoring-reporting/monitoring/environmental-monitoring-data-system

## Implementation Implications

- Add an explicit `module` layer above current metric categories: `socialVulnerability`, `environmentalBurden`, `healthVulnerability`, `climateBurden`.
- Implement an `ejiStyle` aggregation method:
  - percentile rank each raw indicator within the selected comparison universe,
  - sum indicator percentiles by module,
  - percentile rank module sums,
  - convert health indicators to top-tertile flags when health data exists,
  - sum module ranks,
  - percentile rank final combined score.
- Preserve the current flexible score-builder recipes separately; label EJI-style outputs as local EJI-inspired indices unless all required data and calculation rules are present.
- Add domain scores for interpretation only, not final scoring.
- Add missing-data policy controls because EJI exclusion behavior differs from our current neutral/zero handling.

## Index Lab Changes Needed

The current Index Lab / Score Builder can approximate EJI-like ideas, but it cannot yet reproduce EJI-style equations cleanly. The main changes are architectural rather than visual.

### 1. Add module-aware scoring

Today, metrics are grouped by local categories such as `airQuality`, `parksRec`, `heatShade`, `property`, and `deprivation`. EJI needs a separate conceptual grouping:

- Social Vulnerability Module
- Environmental Burden Module
- Health Vulnerability Module
- Climate Burden Module

A metric should be able to belong to an EJI module and optionally a display domain. Example:

```text
metric: pre1980HousingShare
module: environmentalBurden
domain: builtEnvironment
```

This matters because EJI sums indicator percentile ranks inside modules first, then percentile-ranks the module sums.

### 2. Add a true EJI-style aggregation mode

The existing weighted-additive and cumulative-burden paths are useful, but EJI uses this sequence:

```text
raw indicator -> percentile rank
indicator percentile ranks -> module sum
module sum -> module percentile rank
module percentile ranks -> combined score
combined score -> final percentile rank
```

Index Lab should add an aggregation mode like `modulePercentileRankedSum`, separate from the current weighted score. This mode should use equal module weighting by default and support SER, base EJI, and EJI + Climate Burden variants.

### 3. Treat health as flags, not normal metrics

EJI health vulnerability is intentionally not a weighted sum of health prevalence values. It flags top-tertile prevalence indicators:

```text
HVM = 0.2 * count(top-tertile health flags)
```

Index Lab needs metric types beyond continuous numeric metrics:

- continuous percentile-ranked indicators
- inverse percentile-ranked indicators
- binary top-tertile flags
- null-to-zero flagged indicators

Until health data exists, the lab should allow the health module to be disabled and label the resulting score as SER-style rather than full EJI-style.

### 4. Separate domains from equations

EJI domains are interpretive summaries. They help explain what is driving a score, but they are not additional weights in the final equation.

Index Lab should show domain sub-scores in reports and side panels, but avoid treating domain scores as another aggregation layer unless a recipe explicitly asks for that.

### 5. Add explicit missing-data policy

The current score builder supports `zero` and `neutral` missing-data handling. EJI is stricter:

- most missing raw indicators exclude a tract from final ranking,
- some climate and impaired-water nulls are converted to zero,
- those null-to-zero conversions are flagged.

Index Lab needs per-metric missing-data behavior:

```text
excludeRegion
neutral
zeroWithFlag
zeroMeansTrueZero
```

This should surface in UI/reporting because score comparability changes materially.

### 6. Add comparison universe controls

EJI percentile ranks are only meaningful relative to the universe being ranked. For PGMaps, the selected universe might be:

- Prince George DAs
- Prince George CTs
- CityPG school catchments
- CHSAs/LHAs
- a broader regional or provincial comparison set

Index Lab should make the comparison universe explicit in the equation bar and exports. Same raw data can rank differently under different universes.

### 7. Add source/fitness metadata to each metric

EJI documentation is unusually careful about what a metric represents, source year, calculation method, and limitations. To support an EJI-style lab, each metric needs metadata:

- source dataset and year,
- raw calculation method,
- module/domain assignment,
- whether higher values mean more burden or more capacity,
- spatial method such as point buffer share, area intersection, direct census join, or model raster aggregation,
- whether it is official, proxy, or experimental.

This would let Index Lab prevent accidental “official-looking” scores built from weak proxies.

### 8. Add EJI-style report output

The CDC explorer emphasizes per-place reports: overall rank, module ranks, domains, top drivers, and caveats. Index Lab should support a report view/export with:

- final index rank,
- module ranks,
- domain summaries,
- indicator percentile ranks,
- missing-data flags,
- comparison universe,
- proxy disclaimer.

This is more important than adding more presets, because the method is only defensible if people can see exactly how the score was assembled.

## Open Questions

- Should PGMaps prioritize a Canadian-equivalent EJI framework over exact EJI replication? Exact replication is impossible without U.S.-specific data like ACS, EPA AirToxScreen, EPA FRS, FEMA NRI, and CDC PLACES.
- What boundary should be the primary comparison universe: DA, CT, CHSA, or CityPG neighbourhood/school catchment?
- Are race/ethnicity/Indigenous identity variables in scope? If yes, the UI and documentation need careful Canadian framing and governance language.
- Should health vulnerability be omitted until we have credible small-area data, or represented at coarser health boundaries with a warning?
