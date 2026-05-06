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
