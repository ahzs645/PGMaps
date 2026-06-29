# CalEnviroScreen 4.0 Ideas For PGMaps

Source reviewed: `/Users/ahmadjalil/Downloads/calenviroscreen40reportf2021.pdf`

CalEnviroScreen 4.0 is useful for PGMaps because it is not just a map layer. It is a transparent cumulative-impact model with indicator metadata, relative percentiles, component scores, caveats, and per-place explanation. PGMaps already has many of the UI and scoring pieces needed to build a Prince George version, especially in Index Lab.

## Core Model To Borrow

CalEnviroScreen uses 21 indicators organized into four components:

- Pollution Burden
  - Exposure indicators
  - Environmental Effects indicators
- Population Characteristics
  - Sensitive Population indicators
  - Socioeconomic Factor indicators

The important scoring rules are:

- Rank each raw indicator as a percentile within the comparison universe.
- Average indicator percentiles within each component.
- Combine Pollution Burden as `exposures + 0.5 * environmentalEffects`, normalized by `1.5`.
- Combine Population Characteristics as the average of sensitive-population and socioeconomic-factor scores.
- Scale Pollution Burden and Population Characteristics to 0-10.
- Final score is `Pollution Burden * Population Characteristics`.

PGMaps currently has a `cumulativeBurden` aggregation mode, but it is not the same formula. It groups metrics into burden, vulnerability, and adaptive-gap buckets, then returns `sqrt(burden * max(vulnerability, adaptiveGap))`. A CalEnviroScreen-style mode should be a separate aggregation option rather than a rename of the current one.

## Existing PGMaps Fit

Strong existing matches:

- Index Lab already supports metric metadata, directionality, source labels, uncertainty, missing-data policy, modules, domains, and presets.
- Existing local metrics cover air monitoring, parks, heat/shade, food safety, census population, BC Assessment housing/property, crime, transit, walkability, service access, CIMD deprivation, flood, drought, and health service points.
- Existing map pages can host raw indicator layers and feature-level inspection.
- `docs/eji-gap-analysis.md` already covers a related EJI-style framework. CalEnviroScreen gives a better match for exposure multiplied by vulnerability.

Main gap:

- PGMaps has many proxies, but fewer exposure surfaces. CalEnviroScreen relies on actual or modeled exposures such as PM2.5, ozone, diesel PM, traffic burden, drinking-water contaminants, and toxic releases. Monitor density is not the same as exposure.

## Indicator Crosswalk

| CalEnviroScreen indicator | Local PGMaps equivalent or candidate | Fit |
| --- | --- | --- |
| Ozone | ECCC/NAPS or BC Air Data Archive ozone observations, interpolated or nearest-monitor summarized | Medium |
| PM2.5 | Existing AQMap modelled PM2.5 snapshots, BC ENV observations, CANUE PM2.5 if synced | Strong |
| Diesel PM | Traffic counts, truck routes, rail proximity, CANUE NO2/road proximity | Proxy |
| Drinking water contaminants | Existing water tab plus Northern Health/BC drinking water advisories and sample data | Medium |
| Children's lead risk from housing | `pre1980HousingShare`, `buildingAge`, low-income or CIMD economic dependency | Strong proxy |
| Pesticide use | BC agricultural land, pesticide sales/use if available, crop/land-use proximity | Weak to medium |
| Toxic releases | NPRI facilities and emissions, buffered or toxicity-weighted | Strong candidate |
| Traffic impacts | CityPG traffic counts, roads, highway buffers, road length/volume density | Strong |
| Cleanup sites | BC Site Registry, Federal Contaminated Sites Inventory | Strong candidate |
| Groundwater threats | BCER wells, contaminated sites, fuel tanks if available, WARS/water datasets | Proxy |
| Hazardous waste | BC hazardous waste registrations, waste discharge authorizations, industrial permits | Medium candidate |
| Impaired water bodies | BC water quality objectives/exceedances, EnMoDS, watershed condition layers | Derived |
| Solid waste sites | Landfills, transfer stations, recycling/waste facilities | Strong candidate |
| Asthma | BC CDC/PHSA chronic disease data, likely CHSA/LHA rather than DA | Coarse |
| Cardiovascular disease | Same as above | Coarse |
| Low birth weight | BC health data if available by health geography | Coarse |
| Education | Census no certificate/diploma/degree | Strong |
| Housing burden | Census shelter-cost burden or low-income housing-cost burden | Strong |
| Linguistic isolation | Census no official-language knowledge or limited official-language proxy | Medium |
| Poverty | LIM-AT / low-income after tax or CIMD economic dependency | Strong |
| Unemployment | Census unemployment rate | Strong |

## Data Types To Add

Add explicit CalEnviroScreen-oriented types rather than forcing everything into the current generic metric shape.

Suggested TypeScript/data fields:

```ts
type CesComponent =
  | 'exposure'
  | 'environmentalEffects'
  | 'sensitivePopulation'
  | 'socioeconomicFactors'

type CesIndicatorKind =
  | 'observedSurface'
  | 'modelledSurface'
  | 'pointFacilityBurden'
  | 'bufferedProximity'
  | 'censusJoin'
  | 'healthBoundaryJoin'
  | 'derivedProxy'

interface CesIndicatorDefinition {
  key: string
  label: string
  component: CesComponent
  kind: CesIndicatorKind
  unit: string
  higherIsWorse: boolean
  sourceLabel: string
  sourceUrl?: string
  sourceYear: string
  geography: 'da' | 'ct' | 'db' | 'cityCommunity' | 'schoolCatchment' | 'chsa' | 'lha'
  spatialMethod:
    | 'directBoundaryJoin'
    | 'areaWeightedSurface'
    | 'populationWeightedSurface'
    | 'pointInPolygon'
    | 'bufferAreaShare'
    | 'weightedFacilitySum'
  proxyLevel: 'official' | 'proxy' | 'experimental'
  missingDataPolicy: 'excludeRegion' | 'zeroMeansTrueZero' | 'zeroWithFlag' | 'neutral'
  limitations: string
}
```

This can either extend `ScoreMetricDefinition` or live as a catalog that compiles into regular Index Lab metrics.

## Features To Add

1. CalEnviroScreen-style aggregation mode

Add a new aggregation option such as `calEnviroScreenProduct`. It should preserve the current `cumulativeBurden` mode and implement the exact component sequence:

```text
exposureMean = average(exposure indicator percentiles)
environmentalEffectsMean = average(environmental effects indicator percentiles)
pollutionBurden = (exposureMean + 0.5 * environmentalEffectsMean) / 1.5

sensitivePopulationMean = average(sensitive population indicator percentiles)
socioeconomicMean = average(socioeconomic factor indicator percentiles)
populationCharacteristics = (sensitivePopulationMean + socioeconomicMean) / 2

scaledPollutionBurden = pollutionBurden / max(pollutionBurden) * 10
scaledPopulationCharacteristics = populationCharacteristics / max(populationCharacteristics) * 10
score = scaledPollutionBurden * scaledPopulationCharacteristics
finalPercentile = percentile_rank(score)
```

2. PG Environmental Health Screen preset

Create a new preset separate from the existing EJI presets:

- Exposures: PM2.5, traffic burden, water advisories/contaminants, pre-1980 housing lead proxy.
- Environmental Effects: contaminated sites, BCER/wells or groundwater proxy, waste facilities, flood/water impairment proxy.
- Sensitive Population: older adults, young children, asthma/cardiovascular health if available, population density as a fallback.
- Socioeconomic Factors: low income, unemployment, education, housing burden, linguistic isolation, CIMD dimensions.

3. Indicator evidence drawer

For each selected region, show:

- raw indicator value,
- percentile,
- component,
- source and year,
- spatial method,
- proxy/official badge,
- missing-data status,
- limitation/caveat.

4. Component map mode

Let users switch map coloring between:

- final score,
- Pollution Burden,
- Population Characteristics,
- Exposures,
- Environmental Effects,
- Sensitive Populations,
- Socioeconomic Factors.

5. Report export

Add a per-region report similar to CalEnviroScreen's worked example:

- map snapshot,
- component table,
- indicator table,
- score equation,
- top drivers,
- missing indicators,
- comparison universe,
- source list.

6. Source-readiness badges

Use a visible status per metric:

- `ready`: data is in `public/data` and is being summarized.
- `sync-needed`: scraper or data source exists but the deployable asset is missing.
- `research-needed`: source is identified but ingestion rules are not built.
- `not-local-fit`: California/U.S.-specific concept needs a Canadian substitute or should be omitted.

7. Data quality controls

Add filters and warnings for:

- small denominators,
- coarse health geography joined to fine DA/CT maps,
- stale source years,
- proxy-only indicators,
- missing data excluded from ranking,
- comparison universe changes.

## Priority Implementation Plan

Phase 1 - Model and UI without new external data:

- Add `calEnviroScreenProduct` aggregation.
- Add component assignments for existing metrics.
- Add a PG Environmental Health Screen preset using existing proxies.
- Add component score display in the region insight dialog.
- Add documentation that this is a local proxy, not official CalEnviroScreen.

Phase 2 - Better local indicators:

- Add census-derived socioeconomic metrics: low income, unemployment, no diploma, shelter-cost burden, official-language limitation, age groups.
- Use CityPG traffic counts and road buffers for a traffic burden metric.
- Add contaminated-site, waste-site, NPRI, rail, and airport proximity layers.
- Convert existing PM2.5/fire/smoke products into boundary-level exposure summaries.

Phase 3 - Health and water:

- Join BC CDC/PHSA chronic disease indicators at CHSA/LHA with clear coarse-geography warnings.
- Expand drinking-water metrics from advisories, sampling, water system boundaries, and contaminant records where available.
- Derive impaired-water or watershed-condition proxies from BC monitoring/objective data.

Phase 4 - Polished public workflow:

- Add report export.
- Add source-readiness badges.
- Add methodology panel showing the formula and active indicators.
- Add a score comparison mode between current Index Lab presets, EJI-style module ranks, and CalEnviroScreen-style product scores.

## Recommended Naming

Avoid naming a PGMaps output "CalEnviroScreen" unless it exactly uses OEHHA data and method. Better names:

- PG Environmental Health Screen
- PG Cumulative Burden Screen
- Prince George Environmental Justice Proxy
- Local Cumulative Impact Index

## Key Design Principle

The biggest lesson from the report is transparency. The app should make every score inspectable: what indicator went in, how it was ranked, what component it affected, how missing data was treated, and why the metric is official, proxy, or experimental.

## Remote Catalog Coverage Audit

Checked on 2026-06-29:

- Local PGMaps dataset registry: `src/lib/dataCatalog.ts`
- Local app-ready outputs under `public/data/`
- bcdatamapper scraper catalog: `vendor/bcdatamapper/README.md` and `vendor/bcdatamapper/package.json`
- Remote CANUE BC PMTiles catalog: `https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json`
- Remote CANUE metadata lookup: `https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-metadata.json`
- BC Data Catalogue API searches for contaminated sites, waste, water, groundwater, traffic, pesticide, and floodplain sources.
- Open Canada API searches for NPRI, federal contaminated sites, rail, airports, NAPS, water quality, pesticide, and chronic disease sources.

### Remote CANUE Catalog Summary

The remote CANUE catalog is live even though `public/data/canue/` is not present in this checkout. It has 7 BC-wide 1 km grid families:

| Family | Coverage | Dataset count | Useful for |
| --- | --- | ---: | --- |
| `air-quality` | 1984-2024 | 18 | PM2.5, ozone, NO2, smoke PM2.5, SO2 |
| `weather-thermal` | 1983-2021 | 12 | heat, land surface temperature, thermal/weather exposure |
| `weather-biometeorology` | 1985-2015 | 23 | biometeorology / human thermal stress |
| `greenness` | 1984-2023 | 9 | NDVI, greenness, tree canopy cover |
| `built-environment` | 1986-2021 | 5 | active living, local climate zones, material deprivation-style built context |
| `neighborhood` | 1991-2024 | 16 | accessibility, building density, dwellings, intersections, transit stops, amenities |
| `other` | 1992-2013 | 1 | night light |

High-value CANUE datasets for this work:

| Dataset id | Years | Meaning |
| --- | --- | --- |
| `pm25dale_a` | 1998-2021 | Annual PM2.5 v5 surface |
| `aqfpm_avf` | 1998-2023 | Fine particulate matter surface |
| `aqozn_8h`, `aqozn_mn` | 2002-2024 | Monthly ozone 8-hour and mean concentrations |
| `aqsmk_avb`, `aqsmk_avc` | 2010-2022 / 2010-2023 | Smoke PM2.5 exposure |
| `aqno2_ra`, `no2lur_a` | 1985-2016 / 1984-2016 | Monthly and annual NO2 land-use regression |
| `wtlst_ava` | 2015-2021 | Warm-season land surface temperature |
| `grtcc_ava`, `grlan_*` | 2010-2015 / 1984-2019 | Tree canopy / greenness |
| `ale_a` | 2006, 2016 | Active Living Environment |
| `nhacs_ava` | 2021 | Spatial accessibility measures |
| `nhscn_ava`, `nhtsp_ava`, `nhbld_ava` | 2019 | Intersections, transit stops, building density |

Important caveat: CANUE metadata says many source files are under CANUE data-sharing restrictions and contain proprietary postal-code data. For PGMaps, use the existing remote PMTiles service and catalog carefully; do not assume raw CANUE archives are redistributable.

### CalEnviroScreen Indicator Availability

| Indicator | Current status | What we have | What still needs polling/building |
| --- | --- | --- | --- |
| Ozone | Remote aggregate ready | CANUE `aqozn_8h` and `aqozn_mn` in remote catalog, 2002-2024; remote boundary aggregate JSON is available | Wire aggregate rows into Index Lab metric definitions; choose source year/statistic |
| PM2.5 | Local + remote aggregate ready | Local ECCC AQMap PM2.5 snapshot; remote CANUE `pm25dale_a`, `aqfpm_avf`; remote boundary aggregate JSON is available | Decide source of truth; wire aggregate rows into Index Lab metric definitions |
| Diesel PM | Proxy only | CANUE NO2/road proxies, CityPG roads, local traffic-count points | No public Canadian diesel PM raster found; build traffic-emissions proxy |
| Drinking water contaminants | Partial local | `public/data/water/*` has facilities, notices, bacteriological and chemical sample files; current manifest notes a HealthSpace bacteriological list endpoint returned 405 | Build contaminant index; fix/poll robust source endpoint; add service-area boundaries if available |
| Children's lead risk from housing | Strong proxy | BC Assessment parcels include year built; census low-income variables exist | Combine `pre1980HousingShare` with LIM-AT / CIMD economic dependency |
| Pesticide use | Weak / likely unavailable at required resolution | BC/Open Canada searches did not find a useful BC-wide pesticide-use intensity dataset; only limited or unrelated records surfaced | Treat as unavailable for now; possible proxy from agricultural land/crop land and pesticide permit fragments |
| Toxic releases | New poll target | Open Canada has NPRI bulk data and facility datasets | Build NPRI scraper, filter BC/Prince George, optionally toxicity-weight releases |
| Traffic impacts | Local proxy ready | CityPG roads and 169 traffic-count points; CANUE road/NO2 context | Need road-volume line assignment or buffer-weighted traffic metric |
| Cleanup sites | New poll target | BC Data Catalogue has Environmental Remediation Sites and Crown Contaminated Sites, but many are Access Only; Open Canada has Federal Contaminated Sites Inventory | Poll available public layers; expect access/licence constraints for BC provincial remediation records |
| Groundwater threats | New poll target + proxy | BC Data Catalogue has Groundwater Wells and observation-well data; local BCER wells exist | Build groundwater/well proximity and contamination-threat proxy; not the same as CalEnviroScreen UST/cleanup method |
| Hazardous waste generators/facilities | Weak / partial | BC waste discharge authorizations are public; no clean hazardous-waste registration dataset surfaced in quick catalog search | Use authorizations/industrial permits as proxy; hazardous-waste generator list may not be public/bulk |
| Impaired water bodies | Derived only | BC Environmental Monitoring System Results and Water Quality Objectives exist; local watershed boundaries exist | Build exceedance/objective-derived impairment layer; no direct 303(d)-style impaired-waters list found |
| Solid waste sites/facilities | New poll target | No obvious local layer; likely available through municipal/regional/BC waste facility sources | Search/poll landfill and solid-waste facility sources separately |
| Asthma | Coarse health data only | Health boundaries are local; Open Canada has chronic disease surveillance; BC health source work exists in `vendor/bcdatamapper/data-sources/healthdata` | Need public BC/PHSA/BCCDC data at CHSA/LHA if available; DA-level asthma likely not public |
| Cardiovascular disease | Coarse health data only | Same as asthma | Use CHSA/LHA contextual layer if available; not DA-level |
| Low birth weight | Unknown/coarse | Health boundaries exist; no local low-birth-weight file found | Needs PHSA/BC CDC/StatsCan health table research; likely coarse or suppressed |
| Education | Local ready | Census catalog has no high-school diploma variables, e.g. `v_CA21_5802` | Derive metric and add to score-builder rows |
| Housing burden | Not found in current census extract | Quick search found no shelter-cost / affordability variables in current catalog | Need additional Census profile vectors or another housing-affordability source |
| Linguistic isolation | Local proxy ready | Census catalog has official-language knowledge variables | Derive no-official-language or limited official-language proxy |
| Poverty | Local ready | Census catalog has LIM-AT low-income prevalence, e.g. `v_CA21_1040` | Derive metric and add to score-builder rows |
| Unemployment | Local ready | Census catalog has unemployment rate, e.g. `v_CA21_6513` | Derive metric and add to score-builder rows |

### Highest-Value Poll Queue

1. CANUE boundary aggregates are already remote-backed; do not treat these as missing scraper work unless a specific boundary/family/year 404s:
   - PM2.5: `pm25dale_a` or `aqfpm_avf`
   - ozone: `aqozn_8h`
   - NO2/traffic proxy: `aqno2_ra` or `no2lur_a`
   - smoke: `aqsmk_avc` or `aqsmk_avb`
   - heat: `wtlst_ava`
   - greenness/canopy: `grtcc_ava`, `grlan_*`
   - walkability/access: `ale_a`, `nhacs_ava`, `nhscn_ava`, `nhtsp_ava`
   - Aggregate URL shape: `https://data.map.ahmad.sh/canue/aggregates-v2/{source}/{level}/{family}_{year}_aggregate.json`
   - Confirmed families/levels include Census DA/CT and BC health LHA aggregate files.
2. Census-derived metrics already in local catalog:
   - low income, unemployment, no high-school diploma, official-language limitation, age 65+, young children, visible minority/Indigenous/immigration if in scope.
3. New public facility/regulatory scrapers:
   - NPRI releases/facilities.
   - Federal Contaminated Sites Inventory.
   - BC Environmental Remediation Sites / Crown Contaminated Sites, subject to access constraints.
   - BC Waste Discharge Authorizations.
   - BC groundwater wells and observation wells.
   - BC Environmental Monitoring System Results and Water Quality Objectives.
   - Historical floodplain polygons.
4. Local data product work:
   - Traffic burden from CityPG roads + traffic-count points.
   - Drinking-water contaminant/advisory index from existing water files.
   - Lead-risk proxy from pre-1980 housing + low-income/CIMD.

### Swarm Audit: Requested Scraper Coverage

Checked on 2026-06-29 against local `public/data`, bcdatamapper scrapers, BC Data Catalogue, and Open Canada.

| Dataset | Local PGMaps status | Official source status | Add/poll next? |
| --- | --- | --- | --- |
| NPRI releases/facilities | Missing locally; no scraper found | Open Canada has unrestricted OGL-Canada bulk CSVs with release, disposal, transfer, and facility-location files | Yes - strong direct CSV scraper |
| Federal Contaminated Sites Inventory | Missing locally; no scraper found | Open Canada has unrestricted OGL-Canada ZIP/XML inventory | Yes - parse XML, filter BC/PG |
| BC Environmental Remediation Sites | Missing locally; no scraper found | BC Data Catalogue record exists, but marked Access Only; WFS/BCGW appears technically reachable | Maybe - useful, but licence/redistribution needs caution |
| Crown Contaminated Sites | Missing locally; no scraper found | BC Data Catalogue record exists, Access Only; direct SHP ZIP observed | Maybe - direct file scraper if access terms are acceptable |
| Waste Discharge Authorizations | Missing locally; no scraper found | BC Data Catalogue has OGL-BC XLSX files for all authorizations and all discharges | Yes - strong direct XLSX scraper |
| Groundwater Wells | Missing locally; no scraper found | BC Data Catalogue has OGL-BC groundwater wells via BCGW/WFS/ArcGIS REST | Yes - strong spatial scraper |
| Groundwater Observation Wells | Missing locally; no scraper found | OGL-BC CSV level time series plus well locations | Yes - join locations and time-series summaries |
| BC EMS / EnMoDS water quality results | Local drinking-water files exist, but not EMS/EnMoDS ambient water results | EMS historical CSVs are OGL-BC; EMS stopped receiving new data after 2026-02-26, so current ingestion should use EnMoDS results and spatial sampling locations | Yes - more complex derived exceedance pipeline |
| Water Quality Objectives | Missing locally; no scraper found | BC Data Catalogue OGL-BC WQO report index includes spatial/report links | Yes - pair with EMS/EnMoDS results for exceedance logic |
| Historical mapped floodplains | Partial local CityPG OCP flood hazard polygon only | BC Data Catalogue has OGL-BC historical mapped floodplain polygons | Yes - strong spatial scraper |
| Solid waste / landfill facilities | Partial CityPG facility features only; no dedicated province/regional layer | BC municipal waste facility layer is Access Only and export-disabled; federal sources are indicators/proxies, not facility points | Not reliable from official bulk data yet |
| Hazardous waste facilities/generators | Missing locally; no scraper found | BC hazardous-waste facility layer is Access Only/deprecated; registrations are not exposed as bulk data/API; no federal national facility layer found | Treat as unavailable; use waste authorizations/NPRI/GHGRP proxies |

### Probably Not Available Cleanly

- Diesel PM raster equivalent for Canada/BC. Use NO2, road proximity, truck/rail, and traffic counts as proxies.
- CalEnviroScreen-style pesticide pounds by active ingredient at local geography. No useful BC-wide public equivalent surfaced in the catalog checks.
- DA-level asthma, cardiovascular disease, or low-birth-weight outcomes. Expect CHSA/LHA/health-region level at best, with suppression and comparability warnings.
- Direct impaired-water-bodies layer equivalent to the U.S. 303(d) list. We can derive a proxy from BC monitoring results and objectives.
- Clean public hazardous-waste generator/facility registry. Waste discharge authorizations are available, but that is broader than hazardous waste.
- Housing-cost burden in the current local census variable extract. The Census source should support it at some geographies, but this checkout's catalog does not currently include obvious shelter-cost variables.
