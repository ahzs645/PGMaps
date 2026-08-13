# Canada’s Local-Government Patchwork

## Project decision

Build this as an original PGMaps map story followed by an inspectable atlas.

The working title is **Canada Has No County Map**. The central question is the
one raised by the video: what geographic unit, if any, performs the role people
often expect a U.S. county to perform?

The project should not claim that Canada has one consistent set of
“second-level administrative divisions.” Provinces and territories delegate,
organize, and describe local government differently. In some places the useful
comparison is a regional body above municipalities; in others it is the
municipality itself; elsewhere a region is only a service area or statistical
geography. The atlas should make those differences visible instead of forcing
them into a false national hierarchy.

## What the supplied material contributes

The transcript provides a useful narrative spine:

1. A census division is not automatically a government.
2. Every province and territory needs its own explanation.
3. Unorganized territory and Indigenous lands cannot be treated as ordinary
   municipal categories.
4. The map is most interesting when the viewer can compare the purpose and
   powers of unlike boundaries, not just their names.

The supplied poster is a helpful visual reference, but it is a copyrighted
commercial product. PGMaps should use an original layout, colour system,
writing, and geometry assembled from licensed government sources. The poster
image and transcript should not ship as project assets.

## Editorial definition

Use this project-specific definition:

> A regional or local administrative geography is a legally established
> government, service body, or province/territory-administered area immediately
> below the provincial or territorial level that is useful for explaining who
> governs or delivers services in a place.

Each mapped feature must declare which of these roles it actually has:

- `regional-government`: an elected or incorporated regional government;
- `local-government`: a municipality or equivalent local government;
- `regional-service-body`: a body delivering a defined set of regional services;
- `self-government-or-treaty-land`: an Indigenous government or treaty-based
  jurisdiction represented only where an authoritative boundary and appropriate
  description are available;
- `province-administered`: an unorganized or improvement area governed mainly by
  the province or territory;
- `administrative-service-region`: a departmental region without a general local
  government;
- `statistical-only`: a statistical unit shown for comparison, not presented as
  a government.

This vocabulary avoids pretending that unlike institutions are equivalent.

## Product shape

### Part 1: map story

The first release should use the existing `story-map-v1` project renderer. A
reader scrolls through an original explanation while the map changes camera,
visible layers, highlights, and legends.

Proposed scenes:

1. **The tempting answer** — show Statistics Canada census divisions across
   Canada.
2. **The problem** — distinguish legal regional governments from statistical
   equivalents.
3. **Two building blocks** — explain local governments and province-administered
   territory without implying either is nationally uniform.
4. **British Columbia** — regional districts, Northern Rockies Regional
   Municipality, Stikine Region, and separately described modern-treaty lands.
5. **Alberta** — urban and rural municipalities, specialized municipalities,
   improvement districts, Special Areas, and Métis Settlements.
6. **Saskatchewan and Manitoba** — municipal models plus northern/unorganized
   administration and Manitoba local government districts.
7. **Ontario** — upper-tier, single-tier, lower-tier, and northern districts;
   explain why only some belong on the first map view.
8. **Quebec** — MRCs and geographic equivalents, including the special northern
   arrangements that require separate source notes.
9. **Atlantic Canada** — four focused sub-scenes for New Brunswick, Nova Scotia,
   Prince Edward Island, and Newfoundland and Labrador.
10. **The territories** — municipalities, government administrative regions,
    and the difference between a service region and a local government.
11. **Indigenous jurisdictions are not a catch-all layer** — distinguish Indian
    Act reserve lands, modern-treaty settlement lands, and self-government. Do
    not label all of them as municipalities or as one uniform administrative
    level.
12. **There is no single county equivalent** — return to the national view with
    features coloured by governance role rather than province-specific legal
    title.

### Part 2: atlas mode

After the story, provide an explorer with:

- province/territory selector;
- governance-role and legal-type filters;
- “administrative” versus “statistical comparison” toggle;
- click details for name, legal type, governing/service role, parent, source,
  source date, and update date;
- a compact hierarchy diagram for the selected jurisdiction;
- direct source and licence links;
- optional labels only after zooming to a province;
- URL state so a selected jurisdiction, feature, and layer can be shared.

The existing story renderer is sufficient for Part 1. Part 2 should be a small
new reusable workspace (proposed schema `administrative-atlas-v1`) rather than a
large one-off page. It can reuse PGMaps map, legend, search, URL-state, mobile
sheet, and feature-inspector patterns.

## Normalized data contract

Store source-specific legal names while also assigning a small set of PGMaps
roles. A feature should look roughly like this after the scraper build:

```json
{
  "id": "ca:59:regional-district:fraser-fort-george",
  "name": "Regional District of Fraser-Fort George",
  "provinceCode": "59",
  "provinceName": "British Columbia",
  "legalTypeCode": "RD",
  "legalTypeName": "Regional district",
  "governanceRole": "regional-government",
  "governmentStatus": "incorporated",
  "isStatisticalEquivalent": false,
  "isProvinceAdministered": false,
  "sourceLevel": "provincial",
  "sourceName": "Province of British Columbia",
  "sourceUrl": "https://catalogue.data.gov.bc.ca/",
  "sourceDate": "YYYY-MM-DD",
  "licence": "Open Government Licence - British Columbia"
}
```

The build should also emit:

- a simplified national GeoJSON for the story;
- province/territory GeoJSON or PMTiles for detailed inspection;
- a JSON jurisdiction/type glossary;
- a manifest containing source URLs, retrieval timestamps, feature counts,
  hashes, geometry-validation results, and known exceptions.

Do not infer the governance role from a short code alone. The same-looking unit
can have a different legal or service role in another province.

## Data strategy

### National foundation

1. Use Statistics Canada’s Census Subdivision boundary file as the nationwide
   municipal-or-equivalent geometry foundation. The current annual product says
   explicitly that a CSD is a municipality **or an area treated as equivalent for
   statistical purposes**. PGMaps already has a 2021 CSD scraper and a 14 MB
   simplified national output with `CSDTYPE`, `CDUID`, and `PRUID`.
2. Add a Census Division boundary snapshot for the national regional comparison.
   Statistics Canada describes a CD as an area of regional government or an area
   treated as equivalent for statistical purposes. That distinction must remain
   in the project data.
3. Prefer current provincial/territorial open data wherever the Statistics Canada
   geography is outdated, statistical-only, or does not encode the required legal
   role.
4. Use the Canada Lands Survey System administrative-boundaries service for
   authoritative Indigenous land geometries. Its classes include Indian reserves
   and several kinds of settlement lands; they must be separated semantically in
   the normalized output.

### Confirmed authoritative candidates

| Jurisdiction | Boundary/source candidate | Initial treatment |
| --- | --- | --- |
| Canada | Statistics Canada CSD annual boundary file and 2021 CD boundary file | National geometry and statistical comparison |
| Canada | NRCan Canada Lands Survey System administrative boundaries | Indigenous land overlay, split by legal class |
| British Columbia | Existing PGMaps regional-district and municipality snapshots, then B.C. Data Catalogue refresh | Regional and local government vertical slice |
| Alberta | Alberta Municipal Affairs legal types plus provincial boundary data | Municipality, improvement area, Special Areas, and Métis Settlement classification |
| Saskatchewan | Saskatchewan GIS administrative service, including rural municipalities and NSAD boundary | Municipal and province-administered comparison |
| Manitoba | Manitoba Land Initiative municipal/local-government-district boundaries | Municipal and LGD geometry |
| New Brunswick | GeoNB regional service commission boundaries effective January 1, 2023 | Regional service body; preserve post-reform date |
| Nova Scotia | Nova Scotia open-data Municipality Boundaries dataset | Regional, county, district, and town types |
| Ontario | Ontario Municipal Boundary: Upper Tier and District plus lower/single-tier dataset | Upper-tier, single-tier, and district roles |
| Quebec | Québec administrative-divisions/SDA data | MRC and geographic-equivalent roles |
| Newfoundland and Labrador | Provincial GeoAtlas municipal, Labrador Inuit Lands, and Labrador Inuit Settlement Area layers | Municipal, unorganized, and treaty-area treatment |
| Yukon | GeoYukon municipal boundaries and, where useful, local advisory areas | Municipal and unincorporated comparison |
| Northwest Territories | GNWT source for the five named administrative regions, plus community boundaries | Administrative service regions, not general local governments |
| Nunavut | Government of Nunavut three-region documentation and an authoritative region geometry | Administrative regions, with municipal communities separately described |
| Prince Edward Island | Provincial municipal registry/boundary source still to be pinned down | Do not reuse the transcript’s unorganized-area claim until verified |

The first vertical slice should be **British Columbia + Alberta**. Together they
exercise nearly every important distinction in the data model: regional bodies,
municipalities, province-administered areas, Indigenous treaty/self-government
geographies, and different nesting rules. The repository already contains B.C.
regional-district and municipality snapshots, while the national CSD layer
contains Alberta’s legal type codes.

## Corrections required before publication

The supplied transcript is not publication-ready. At minimum:

- Correct transcription and spelling throughout: Newfoundland and Labrador,
  Nunavut, Métis, reeve, Nunatsiavut, Kativik, Nisg̱a’a, Tla’amin, Tsawwassen,
  and Maa-nulth.
- Do not say census divisions are never administrative. Statistics Canada’s own
  definition says a census division can be an area of regional government **or**
  a statistical equivalent. The truth depends on the feature and province.
- Do not say reserve lands are outside provinces or simply “owned by the federal
  government.” The Indian Act says reserves are held by the Crown for the use and
  benefit of the respective bands. Jurisdiction is layered and cannot be reduced
  to a separate national ADM2 category.
- Do not call modern-treaty lands a type of Indian reserve. Treaty and
  self-government arrangements have distinct legal foundations and powers.
- Recheck every count and population threshold against a dated official source.
  Counts and municipal statuses change; they should be generated from the
  manifest rather than embedded permanently in narrative prose.
- Treat New Brunswick as a post-2023 system. Its 12 regional service commissions
  coordinate/deliver regional services for local governments and rural districts;
  the reform date belongs in the map metadata.
- Verify Prince Edward Island’s complete current municipal coverage before
  drawing an “unorganized area.” The transcript’s assertion is not yet supported
  by an authoritative source in this research pass.
- Keep NWT and Nunavut regions labelled as government administrative/service
  regions unless a legal source supports a stronger local-government claim.
- Give each boundary an `asOf` date. A national map assembled from several legal
  systems is otherwise guaranteed to mix vintages invisibly.

## Repository and scraper ownership

All new fetchers, source archives, manifests, and deterministic compressed
snapshots belong in `vendor/bcdatamapper`, following the repository’s scraper
ownership policy. The PGMaps app should receive only generated copies through
`scripts/sync-bcdatamapper-data.mjs`.

Proposed submodule layout:

```text
vendor/bcdatamapper/datascrapers/canada/admin-geographies/
  README.md
  sources.json
  sync-national-foundation.mjs
  sync-province.mjs
  build-normalized-atlas.mjs
  validate-atlas.mjs
  source/
  output/
    manifest.json
    glossary.json
    national-overview.geojson.gz
    provinces/
```

The parent repository then syncs to:

```text
public/data/canada-admin/
  manifest.json
  glossary.json
  national-overview.geojson
  provinces/
```

## Validation rules

The data build should fail when:

- a feature has no source URL, source date, legal type, or governance role;
- IDs collide or change without a recorded redirect/crosswalk;
- geometry is invalid or outside its declared province/territory beyond a small
  documented tolerance;
- required national/provincial coverage has unexplained gaps or overlaps;
- a statistical-only feature is labelled as a government;
- an Indigenous land class is collapsed into `Indian reserve` without matching
  source classification;
- a scene references a missing feature/type;
- feature counts change beyond an explicit reviewed threshold.

Browser tests should cover desktop/mobile story progression, province selection,
legend filtering, feature inspection, URL restoration, source links, and a
reduced-motion path.

## Acquisition status — August 2026

The reproducible national foundation is now downloaded and validated in
`vendor/bcdatamapper/datascrapers/canada/admin-geographies` and synced as
generated app data to `public/data/canada-admin`.

Completed:

- 5,054 Statistics Canada 2025 census subdivisions, sharded across all 13
  provinces and territories;
- 293 Statistics Canada 2021 census divisions, retained as a historical and
  statistical comparison and sharded below GitHub's single-file limit;
- 290 current 2025 census-division parent geographies derived from the 2025 CSD
  hierarchy, including New Brunswick's 12 Regional Service Commissions;
- 3,372 federal CLSS Indigenous-land polygons in 11 preserved legal classes;
- the official 2025 Statistics Canada glossary covering 56 CSD types and 12 CD
  types;
- 252 provincial Newfoundland and Labrador municipal boundaries, two Labrador
  Inuit Lands polygons, and two Labrador Inuit Settlement Area polygons;
- topology-preserving browser overviews retaining every source feature;
- manifests with source URLs, dates where supplied, feature counts, compressed
  sizes, bounding boxes, and SHA-256 hashes.

The app-facing boundary set is also published as five validated PMTiles
archives in the `maps` Cloudflare R2 bucket. Together they occupy 26.62 MB and
cover the 2025 CSDs, derived 2025 CD parents, 2021 CD comparison, CLSS legal
lands, and Newfoundland and Labrador supplemental overlays. The versioned
archives are immutable; the short-cache publication catalog is available at
`https://data.map.ahmad.sh/canada/admin-geographies/catalog.json` and is copied
into PGMaps as `public/data/canada-admin/r2/pmtiles-catalog.json`.

The national CSD/CD hierarchy now supplies the principal geometry for every
province and territory. Remaining acquisition work is limited to provincial
overlays that add legal precision or a geography absent from Statistics Canada,
not another complete national municipal download. The highest-priority reviews
are B.C. modern-treaty/self-government coverage beyond the current B.C. and CLSS
layers, feature-level role classification for mixed Quebec equivalent
territories, and authoritative reference/update dates where a live provincial
service omits them.

## Delivery sequence

### Phase 0 — editorial and source ledger

- Pin the definition and terminology above.
- Create a 13-jurisdiction source ledger with licence, update cadence, legal
  authority, and geometry endpoint.
- Ask for review of Indigenous-jurisdiction language before publication.

### Phase 1 — national foundation and vertical slice

- Add the national CD snapshot alongside the existing CSD snapshot.
- Normalize B.C. and Alberta into the proposed contract.
- Generate the national overview, glossary, and validation manifest.
- Prove that the build is deterministic and syncs through the submodule policy.

### Phase 2 — first map story

- Author original scene text and a project package.
- Render CSD/CD comparison plus the B.C./Alberta detailed scenes.
- Label this release as a documented prototype with an explicit reference date.

### Phase 3 — complete the country

- Add the remaining provincial and territorial sources in reviewed batches.
- Add the `administrative-atlas-v1` explorer and hierarchy view.
- Replace hard-coded counts in prose with manifest-derived values.

### Phase 4 — publication QA

- Legal/source-link audit, accessibility review, mobile performance pass, and
  editorial review.
- Confirm attribution and licences in both the interface and downloadable data.

## MVP completion criteria

The first public version is complete when a reader can:

1. explain why “census division” is an incomplete answer;
2. switch between a statistical comparison and actual governing/service roles;
3. inspect every visible feature’s role, source, and reference date;
4. see B.C. and Alberta at detailed legal-type resolution;
5. understand that Indigenous jurisdictions are distinct and internally varied;
6. share a stable URL to a selected scene or atlas state;
7. use the experience on mobile without downloading the full-resolution national
   source archive.

## Primary references consulted

- Statistics Canada, [Census Subdivision Boundary File](https://www150.statcan.gc.ca/n1/en/catalogue/92-162-X)
- Statistics Canada, [census subdivision definition](https://www12.statcan.gc.ca/census-recensement/2021/ref/dict/az/Definition-eng.cfm?ID=geo012)
- Statistics Canada, [census division definition](https://www12.statcan.gc.ca/census-recensement/2021/ref/dict/az/definition-eng.cfm?ID=geo008)
- Statistics Canada, [2021 census division types](https://www12.statcan.gc.ca/census-recensement/2021/ref/dict/tab/index-eng.cfm?ID=T1_4)
- Natural Resources Canada, [CLSS administrative-boundaries service](https://proxyinternet.nrcan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer)
- Department of Justice Canada, [Indian Act, section 18](https://laws-lois.justice.gc.ca/eng/acts/I-5/section-18.html)
- GeoNB, [regional service commissions](https://www.gnb.ca/en/topic/family-home-community/communty-local-gov/regional-service-commissions.html)
- Nova Scotia, [Municipality Boundaries](https://data.novascotia.ca/Municipalities/Municipality-Boundaries/7bqh-hssn)
- Ontario, [Municipal Boundary — Upper Tier and District](https://data.ontario.ca/dataset/municipal-boundaries/resource/b34767bc-7d6c-4c97-b9ce-7f573b0937c9)
- Québec, [Administrative divisions](https://open.canada.ca/data/en/dataset/eec20550-7916-4ff9-b9bf-9e07288b4a17)
- Manitoba Land Initiative, [municipalities/local government districts](https://mli.gov.mb.ca/adminbnd/index.html)
- Government of Yukon, [Municipal Boundaries](https://open.yukon.ca/data/municipal-boundaries)
- Newfoundland and Labrador, [GeoAtlas land-use layers](https://dnrmaps.gov.nl.ca/arcgis/rest/services/GeoAtlas/Land_Use/MapServer)
