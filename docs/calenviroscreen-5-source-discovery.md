# CalEnviroScreen 5.0 Source Discovery For PGMaps

This note consolidates the source-discovery pass for a Prince George / BC CalEnviroScreen-style pilot.

## Summary

We can build a credible public-data pilot at Census Tract scale, but not a fully faithful CalEnviroScreen 5.0 clone from public data alone.

Strong public or already-staged sources:

- PM2.5 / ozone / NO2: CANUE, AQMap, BC air monitoring.
- Traffic: CityPG roads/counts, MoTI Traffic Data Program, DRA, Integrated Roads.
- Older housing lead proxy: BC Assessment parcels plus Census low-income/children.
- Remediation sites: BC Environmental Remediation Sites WFS is already staged for Prince George.
- NPRI / waste-authorized facilities: NPRI bulk data plus BC Waste Discharge Authorizations.
- Solid waste proxy: regional/municipal solid waste sites plus waste authorizations; needs a dedicated scrape.
- Census socioeconomic: education, low income, linguistic isolation, unemployment, housing-burden proxy.

Still not publicly solved at neighborhood scale:

- Asthma, CVD/AMI, diabetes, and low birth weight at CT/DA scale.
- True diesel PM exposure surface.
- California-style pesticide application intensity.
- Treated drinking-water service-area contaminant index.
- Canadian RSEI-equivalent toxic-release toxicity/dispersion model.
- Clean open hazardous-waste generator/facility registry.
- Exact low-income + severe housing burden equivalent.

## Health Outcomes

Public source options:

| Source | URL | Geography | Variables | Status |
| --- | --- | --- | --- | --- |
| PHSA BC Community Health CHSA profiles | https://communityhealth.phsa.ca/getthedata/SearchByTopic | CHSA | Asthma, AMI/hospitalized CVD, diabetes, newborn indicators | Best public source. Already partly staged in `public/data/health/phsa-community-health/`. |
| PHSA legacy municipality/LHA profiles | https://communityhealth.phsa.ca/healthprofiles | Municipality/LHA | Asthma, diabetes, heart failure, low birth weight | Public but older/coarser. Useful for context and validation. |
| BCCDC Chronic Disease Dashboard | https://www.bccdc.ca/health-professionals/data-reports/chronic-disease-dashboard | Public dashboard, health geographies | Chronic disease rates and trends | Dashboard is Tableau Public; extraction is possible but not clean CSV export. Already captured in `public/data/health/bccdc-chronic-disease-tableau/`. |
| PHAC CCDSS | https://health-infobase.canada.ca/ccdss/data-tool/ | Canada/province | Asthma, AMI, diabetes | Public, too coarse for PG neighborhoods. |
| CIHI hospitalized heart attacks | https://www.cihi.ca/en/indicators/hospitalized-heart-attacks | Canada/province/region | AMI hospitalization | Public, too coarse for CT/DA. |

Access-request path for faithful CT/DA model:

| Dataset | URL | Use |
| --- | --- | --- |
| Population Data BC Chronic Disease Registry | https://www.popdata.bc.ca/data/health/cdr | Asthma, AMI/CVD, diabetes incidence/prevalence. |
| Population Data BC NACRS / DAD / MSP | https://www.popdata.bc.ca/data/health/nacrs | CES-style asthma ED visits and AMI event rates. |
| BC Perinatal Data Registry | https://www.popdata.bc.ca/data/health/perinatal | Low birth weight, singleton births, gestational-age filtering. |
| HDPBC Vital Events - Birth | https://assets-hdpbc.healthbc.org/doc/show/hdp/ece47b5c-1b7b-4dbc-aab1-ac65eeb9a875 | Alternative restricted route for low birth weight. |

Conclusion: use PHSA CHSA/LHA health outcomes as public context. For CT/DA scoring, health data requires PopData/HDPBC access, residence geography approval, and suppression/modeling rules.

## Diesel PM And Traffic Emissions

Best public/proxy stack:

| Source | URL | Use |
| --- | --- | --- |
| CANUE | https://portal.canpath.ca/study/canue | PM2.5, NO2, ozone, smoke, road proximity, noise proxies. |
| PGMaps CANUE remote catalog | https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json | Existing BC PMTiles/aggregate source. |
| BC MoTI Traffic Data Program | https://www.th.gov.bc.ca/trafficdata/ | Highway AADT/SADT/count stations and segment reports. |
| CityPG Open Data | https://data-cityofpg.opendata.arcgis.com/ | Local roads and traffic count locations. |
| BC Digital Road Atlas | https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads | Province-wide road geometry and attributes. |
| BC CEF Integrated Roads | https://catalogue.data.gov.bc.ca/dataset/bc-cumulative-effects-framework-integrated-roads-current | Road/linear-footprint proxy for broader cumulative burden. |
| BC Railway Track Line | https://catalogue.data.gov.bc.ca/dataset/railway-track-line | Rail proximity and rail-density proxy. |
| National Railway Network | https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8 | Federal rail geometry alternative. |
| NPRI bulk data | https://open.canada.ca/data/en/dataset/40e01423-7728-429c-ac9d-2954385ccdfb | Facility PM2.5, PM10, NOx, SO2, VOC emissions. |
| Air Pollutant Emissions Inventory | https://open.canada.ca/data/en/dataset/fa1c88a8-bf78-4fcb-9c1e-2a5534b92131 | Sector-level emissions context. |
| PGAIR reports | https://pgairquality.com/resources/resources-reports-old | Prince George source-apportionment and local emissions-model context. |

Conclusion: no clean public diesel PM raster exists for BC. For PGMaps, use CANUE NO2/PM2.5 plus traffic, rail, NPRI, timber facilities, and PGAIR context as a proxy. A faithful diesel PM indicator would require custom source-sector emissions modeling.

## Pesticide Use

Public/proxy options:

| Source | URL | Use |
| --- | --- | --- |
| BC pesticide recordkeeping/reporting | https://www2.gov.bc.ca/gov/content/environment/pesticides-pest-management/business-industry/recordkeeping-reporting | Confirms annual pesticide use summaries exist, but they are not published as bulk data. |
| BC sector pesticide tools/guides | https://www2.gov.bc.ca/gov/content/environment/pesticides-pest-management/business-industry/sector-specific-tools-guides | Identifies forestry, rail, utility, industrial vegetation, and other record paths. |
| CityPG mosquito/pest management plan | https://www.princegeorge.ca/media/3177 | Municipal pesticide plan; annual reports/maps may be requestable. |
| BC invasive-plant chemical treatment polygons | https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/46 | Strong public polygon proxy with treatment geometry/date/herbicide fields. |
| AAFC Annual Crop Inventory | https://app.geo.ca/en-ca/map-browser/record/5489d54a-9925-44e3-a1a8-b26c1f64e811 | Crop-area exposure proxy; no pesticide quantity. |
| StatCan farm pesticide table | https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210020901 | Province-level agricultural pesticide use context. |
| Health Canada PMRA public registry | https://www.canada.ca/en/health-canada/services/consumer-product-safety/pesticides-pest-management/public/protecting-your-health-environment/public-registry.html | Product/active-ingredient hazard lookup, not spatial use. |

Conclusion: BC does not appear to publish a California PUR-style pesticide application database. The best public PGMaps layer is a hybrid: invasive-plant chemical treatment polygons, requested forestry/municipal/utility records, and crop/land-use proxy.

### Can We Form A Pesticide-Use Layer From Permits?

Partly, but not as a California PUR equivalent from public data alone.

What we can form now:

- A real polygon layer from BCGW invasive-plant chemical treatment areas. The layer includes `TREATMENT_DATE`, `AREA_TREATED`, `HERBICIDE`, `CHEMICAL_METHOD`, invasive plant, and geometry. A Prince George bbox query returned 63 treatment polygons in the prototype pull.
- A forestry chemical brushing layer from RESULTS Activity Treatment Units, filtered to `SILV_BASE_CODE='BR'` and `SILV_TECHNIQUE_CODE IN ('CA','CG')`. This captures aerial and ground chemical brushing footprints and treatment area, but not product names.
- A municipal pesticide-use context layer from City of Prince George pest management plans and requested annual reports.
- A forestry/utility/rail/right-of-way pesticide proxy if annual use summaries, Pest Management Plan maps, or Pesticide Use Notice records are obtained.
- A crop/agriculture exposure proxy from AAFC crop/land-cover data, but this is land-use potential, not measured pesticide use.

What we cannot form cleanly from open data:

- A complete BC-wide application database with active ingredient, amount, date, and application geometry across agriculture, forestry, rail, utility, municipal, and right-of-way uses.

Prototype outputs generated under `tmp/calenviroscreen/`:

- `iapp-chemical-treatment-pg-bbox.geojson`

Repeatable downloader added:

```bash
npm run environmental-burden:pesticide-proxy
npm run environmental-burden:pesticide-proxy -- --bc-wide
```

Current pull results:

| Output | Features | Notes |
| --- | ---: | --- |
| `tmp/calenviroscreen/pesticide-proxy/iapp-chemical-treatment-pg-bbox.geojson` | 63 | PG municipal bbox; 2004-2008; top herbicides Milestone, Tordon 22K, Transline. |
| `tmp/calenviroscreen/pesticide-proxy/iapp-chemical-treatment-bc.geojson` | 25,065 | BC-wide invasive-plant chemical treatment polygons; about 52 MB GeoJSON. |
| `tmp/calenviroscreen/pesticide-proxy/results-chemical-brushing-pg-bbox.geojson` | 5 | PG municipal bbox; forestry chemical brushing; 4 aerial, 1 ground. |
| `tmp/calenviroscreen/pesticide-proxy/results-chemical-brushing-bc.geojson` | 18,429 | BC-wide forestry chemical brushing treatment units; 8,275 aerial and 10,154 ground. |
| `tmp/calenviroscreen/pesticide-proxy/manifest.json` | - | Source metadata, field metadata, counts, and summaries. |

Access-request targets for a closer California-style table:

- Annual Use Reports for confirmation holders.
- Annual Use Reports for pesticide user licence holders, especially private forest uses.
- Pesticide Use Notices and confirmation files.
- Pest Management Plans and Notices of Intent to Treat.
- Permit applications and permit files.
- Daily use records held by licence/permit/confirmation holders.
- InvasivesBC / IAPP treatment exports if richer attributes are available.
- Vendor annual sales summaries for QA/backstop totals.

Request the original database exports, spreadsheets, GIS attachments, KML/KMZ, shapefiles, submitted PDFs, and maps. The normalized target table should include `use_year`, `use_date`, `authorization_type`, `authorization_number`, `holder_name`, `sector`, `site_type`, `geometry`, `pest_or_purpose`, `product_name`, `pcp_registration_number`, `active_ingredient`, `product_quantity_kg`, `area_treated_ha`, `application_method`, `aerial_flag`, and `source_record_type`.

## Drinking-Water Contaminant Index

Public/proxy options:

| Source | URL | Use |
| --- | --- | --- |
| CityPG 2024 water system report | https://www.princegeorge.ca/media/4655 | City-wide water-system compliance, wells, source areas, treatment context. |
| CityPG 2023 water system report | https://www.princegeorge.ca/media/3962 | Prior-year water-system context. |
| CityPG water structures | https://data-cityofpg.opendata.arcgis.com/datasets/CityofPG::water-structure/about | Utility infrastructure/service attribution. |
| CityPG pressure zones | https://data-cityofpg.opendata.arcgis.com/datasets/water-pressure-zones/about | Better CT/DA assignment than city-wide water values. |
| BC drinking-water notice index | https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drinking-water/drinking-water-quality/notices-boil-water-advisories | Links to health-authority and FNHA notices. |
| BC EnMoDS / EMS | https://www2.gov.bc.ca/gov/content/environment/research-monitoring-reporting/monitoring/environmental-monitoring-data-system | Environmental/source-water monitoring results, not treated-water compliance. |
| EMS archive | https://open.canada.ca/data/en/dataset/949f2233-9612-4b06-92a9-903e817da659 | Historic monitoring CSVs. |
| BC GWELLS | https://app.geo.ca/en-ca/map-browser/record/e4731a85-ffca-4112-8caf-cb0a96905778 | Private/source groundwater proxy. |
| Health Canada drinking-water guidelines | https://www.canada.ca/en/health-canada/services/environmental-workplace-health/reports-publications/water-quality/guidelines-canadian-drinking-water-quality-summary-table.html | Guideline/MAC table for exceedance scoring. |

Conclusion: a public proxy is feasible from pressure zones, water reports, notices, EMS/EnMoDS, GWELLS, and Health Canada guidelines. A true CalEnviroScreen-style service-area contaminant index likely needs CityPG/Northern Health WaterTrax chemistry, historical advisory/violation records, and service-area sample crosswalks.

### Can We Form A Treated-Water Index From Downloaded Water Data?

Yes, as a public proxy. Not yet as a complete CalEnviroScreen-style service-area contaminant index.

What the local HealthSpace-derived files contain:

- `public/data/water/bacteriological_samples.json`: 1,125 water systems, including 101 Prince George-ish facilities and 11,543 PG bacteriological sample rows.
- `public/data/water/chemical_samples.json`: 734 chemical-sample systems, including 84 Prince George-ish facilities. Only 16 PG-ish facilities currently have chemical result packages, so chemistry coverage is sparse.
- `public/data/water/combined_water_notices.json`: 711 combined notices, including 23 Prince George-ish notices.
- `public/data/water/water_reference.json`: bacteriological code definitions and 71 chemical guideline/reference rows, including many Health Canada MAC/aesthetic objectives.

What was confirmed live through CityPG Open Data:

- Water Pressure Zones is a downloadable FeatureServer layer with 22 polygons.
- Water Structure is a downloadable FeatureServer layer with 61 features, including wells, reservoirs, pump stations, and pressure-zone attributes.

What we can build now:

- Facility-level burden score from bacteriological positives, chemical exceedances, and active notices.
- Pressure-zone or Census Tract proxy after spatially joining facility points, water structures, and pressure-zone polygons.
- Separate flags for health-based exceedances, aesthetic exceedances, and advisory/notices.

What remains missing for a faithful service-area contaminant index:

- Full WaterTrax or equivalent treated-water chemistry by sample point/system.
- Historical advisory/violation records, not only current/visible notices.
- Formal system/service-area boundaries or pressure-zone-to-served-population crosswalk.
- Rules for sample representativeness, repeat samples, running annual averages, non-detect handling, and whether small private/industrial systems are scored with the municipal CWS.

Prototype outputs generated under `tmp/calenviroscreen/`:

- `citypg-water-pressure-zones.geojson`
- `citypg-water-structures.geojson`
- `healthspace-pg-water-facility-index.csv`
- `water-pesticide-proxy-summary.json`

## Toxic Releases And Hazardous Waste

Public/proxy options:

| Source | URL | Use |
| --- | --- | --- |
| NPRI full database | https://catalogue.ec.gc.ca/geonetwork/srv/api/records/4f2f1fdd-13f9-4946-8c00-04df9e65b112 | Facility releases/disposals/transfers, substances, locations. |
| NPRI bulk CSVs | https://open.canada.ca/data/en/dataset/40e01423-7728-429c-ac9d-2954385ccdfb | Downloadable release/disposal/transfer/facility files. |
| NPRI facility map | https://open.canada.ca/data/en/dataset/3b7dd693-52dc-4e55-828f-37c8172f009b | Current facility locations. |
| ECCC substances search | https://pollution-waste.canada.ca/substances-search/substance | CAS/substance hazard flags and regulatory status. |
| Health Canada chemical risk assessment | https://www.canada.ca/en/health-canada/services/chemical-substances/canada-approach-chemicals/risk-assessment.html | Hazard context for substances. |
| EPA RSEI toxicity weights | https://www.epa.gov/rsei/rsei-toxicity-weights | Best available toxicity-weight template, U.S.-based. |
| EPA RSEI geographic microdata | https://www.epa.gov/rsei/rsei-geographic-microdata-rsei-gm | Model template; no Canadian coverage. |
| BC Waste Discharge Authorizations | https://www2.gov.bc.ca/gov/content/environment/waste-management/waste-discharge-authorization/find-authorization | Public AMS spreadsheets for authorizations/discharges. |
| BC Waste Discharge Authorization GIS | https://geoweb-ags.bc-er.ca/arcgis/rest/services/PROJECT/BC_WASTE_DISCHARGE_AUTH_PT/MapServer | Spatial facility spine. |
| BCER Air Permits | https://data-bc-er.opendata.arcgis.com/datasets/9820197bc19e4e7991705ab9e6c29b90_0 | Energy-sector air permits. |
| BC hazardous-waste resources | https://www2.gov.bc.ca/gov/content/environment/waste-management/hazardous-waste/resources | Generator registration data is orderable by email for a fee. |
| BC hazardous-waste manifests | https://www2.gov.bc.ca/gov/content/environment/waste-management/hazardous-waste/transporting-hazardous-waste/manifests | Historical 1999-2014 manifests are orderable by year for a fee. |
| BC Environmental Remediation Sites | https://catalogue.data.gov.bc.ca/dataset/environmental-remediation-sites | Public point layer, detailed registry reports require fees. |
| BC Site Registry information | https://www2.gov.bc.ca/gov/content/environment/air-land-water/site-remediation/site-information | Detailed site reports, paid except some First Nation/Modern Treaty government access. |
| Federal Contaminated Sites Inventory | https://open.canada.ca/data/en/dataset/1d42f7b9-1549-40aa-8ac6-0e0302ff2902 | Federal contaminated-site subset. |

Conclusion: use NPRI plus BC Waste Discharge Authorizations as the public facility spine. Add paid/requested hazardous-waste generator registrations if needed. For toxicity weighting, build an RSEI-like screening model by joining NPRI CAS numbers to EPA RSEI toxicity weights and applying a transparent buffer or dispersion proxy.

## Housing Burden

Public options:

| Source | URL | Use |
| --- | --- | --- |
| StatsCan shelter-cost/core-housing table | https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=9810062401 | Public housing-burden/core-need context down to larger geographies. |
| 2021 Census Profile | https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021012 | Shelter-cost-to-income variables in Census Profile products. |
| CMHC core housing need methodology | https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/CoreHousingNeedMethodology | Core housing need definition and portal path. |
| Community Data Program target group profile | https://communitydata.ca/data/target-group-profile-population-households-spending-30-and-50-income-shelter-costs-census-2021 | Likely best route for 30%/50% shelter burden at DA/CT, but membership/access required. |

Conclusion: simple 30% or 50% shelter burden is publicly feasible through Census-derived products, though the exact CalEnviroScreen-style low-income + severe burden table likely needs a custom StatCan table, CMHC/HART/CDP access, or microdata-derived reconstruction.

## Build Priority

1. Public CT pilot:
   - CANUE PM2.5/ozone/NO2.
   - CityPG + MoTI + DRA traffic/road burden.
   - BC Assessment older-housing + Census low-income/children lead proxy.
   - BC remediation sites and federal contaminated sites.
   - NPRI + BC Waste Discharge Authorizations facility burden.
   - Invasive-plant chemical treatment polygons as pesticide proxy.
   - CityPG pressure zones + notices + EMS/EnMoDS source-water proxy.
   - Census education, low income, linguistic isolation, unemployment, housing burden.

2. Coarse health context:
   - PHSA CHSA/LHA asthma, AMI/CVD, diabetes, low birth weight.
   - Do not pretend these are CT/DA outcomes.

3. Faithful/research-grade enhancement:
   - PopData/HDPBC health access.
   - CityPG/Northern Health water chemistry and historical advisories.
   - BC hazardous-waste generator registrations.
   - MoTI heavy vehicle/classification records if not obtainable from public reports.
   - Pesticide annual-use summaries and forestry/utility/rail records through request/FOI.
