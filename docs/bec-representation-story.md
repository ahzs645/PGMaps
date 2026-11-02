# BEC representation in protected areas: story data and interpretation

The PGMaps project adapts Will MacKenzie's
[BEC_representation_PAS](https://github.com/whmacken/BEC_representation_PAS)
analysis into a map story. Its numerical evidence is the published **28 November
2023 snapshot**, pinned to
[`0066648b02db082fded8ce9cf242c56d9a8ec22f`](https://github.com/whmacken/BEC_representation_PAS/commit/0066648b02db082fded8ce9cf242c56d9a8ec22f).
It does not claim to measure present-day protection or rerun the original GIS
workflow.

## Project experience

The registered route is `/projects/bec-protected-areas`, titled **Ecosystems in
B.C.’s Protected Areas**. It uses the existing `story-map-v1` docked sidecar
renderer, with a cover, nine named chapters, mobile map expansion, class-share
navigation, polygon selection, and the shared Sources and downloads dialog.
No new renderer, backend, R runtime, or application dependency is required.

The overview, five numerical classes, northern-interior example, missing-value
chapter, and methods chapter all reuse the same geographic source. The overview
bars count units among the 208 finite percentages; they are not area-weighted.
The class chapters explicitly distinguish their complete historical table count
from the subset with polygons in the context snapshot.

The source tables, normalized data, map attributes, and compressed polygons are
served by PGMaps itself. The story does not depend on a runtime GitHub or DataBC
request. Its ordinary external basemap is a separate dependency.

## What is measured

The original
[import notebook](https://github.com/whmacken/BEC_representation_PAS/blob/0066648b02db082fded8ce9cf242c56d9a8ec22f/Import_Catalogue_Layers.Rmd)
downloads BEC polygons, provincial protected lands, and national parks in BC
Albers (`EPSG:3005`). It dissolves BEC polygons by `MAP_LABEL`, intersects them
with the combined parks layer using `terra::intersect`, and calculates areas
with `terra::expanse`. The output code field is `BGC`.

The
[representation notebook](https://github.com/whmacken/BEC_representation_PAS/blob/0066648b02db082fded8ce9cf242c56d9a8ec22f/ConservationAreas.Rmd)
rounds **each park/BGC intersection to 0.001 km² before summing it**. For each
unit it then divides that sum by the unit's published mapped area:

```text
protectedPercent = 100 × protectedAreaKm2 / totalAreaKm2
```

This is a share of the **mapped BGC unit used by the source analysis**. The
province boundary is downloaded but is not used to clip the denominators in the
published code. The
[official BEC metadata](https://open.canada.ca/data/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3)
explains that BEC polygons extend across water, ice, and other cover types so
users can apply an appropriate land-cover mask. Do not describe the sum of these
table areas as BC's terrestrial area or use the table to calculate an official
province-wide protection percentage.

The calculation also does not establish ecological condition, management
effectiveness, connectivity, conservation priority, or complete coverage of all
conservation designations. The published importer uses the provincial parks
and national parks datasets listed below; it does not document a separate
conservancies or other effective area-based conservation measures layer.

The importer dissolves provincial polygons by source park name and national
polygons by `CLAB_ID`, then combines these groups with `rbind`. It does not union
the combined protection footprint before intersecting it with BGC. If distinct
park groups or the two source layers overlap, their intersections could be
counted more than once. The absent original geometries prevent an independent
overlap audit. Describe the numerator as **summed park/BGC intersections**, not
a verified unique protected footprint.

## Source inventory

| Pinned upstream file | Purpose |
| --- | --- |
| `outputs/BGC_area.csv` | Denominator areas for 213 BGC codes |
| `outputs/BGC_area_by_park.csv` | 2,145 park/BGC intersection rows |
| `outputs/PAS_representation_by_BGC.csv` | Published protected areas and ratios |
| `Import_Catalogue_Layers.Rmd` | Downloads, aggregation, intersection, and area methods |
| `ConservationAreas.Rmd` | Ratio calculation and original display thresholds |
| `LICENSE` | Original Apache License 2.0 |

These files are retained byte for byte under
`public/data/bec-representation/source/`. The generator verifies every Git blob
SHA before producing normalized data. `manifest.json` also records SHA-256
hashes, sizes, upstream paths, and immutable source URLs. The originals can be
downloaded from the same origin as the application, without runtime GitHub
requests.

### Government datasets used upstream

| Dataset | Catalogue record |
| --- | --- |
| BEC Map | [f358a53b-ffde-4830-a325-a5a03ff672c3](https://catalogue.data.gov.bc.ca/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3) |
| BC Parks, Ecological Reserves, and Protected Areas | [1130248f-f1a3-4956-8b2e-38d29d3e4af7](https://catalogue.data.gov.bc.ca/dataset/1130248f-f1a3-4956-8b2e-38d29d3e4af7) |
| National Parks of Canada within British Columbia | [88e61a14-19a0-46ab-bdae-f68401d3d0fb](https://catalogue.data.gov.bc.ca/dataset/88e61a14-19a0-46ab-bdae-f68401d3d0fb) |

The notebook refers to BEC v12. It does not commit the downloaded GeoPackages,
and its plot reads a separate file on the author's `D:` drive. The exact original
display geometry is therefore not in the source repository. The catalogue now
describes BEC v13.1, dated 8 July 2026. Any independently obtained map geometry
has its own version, source, simplification, and join coverage; it must not be
presented as the original analysis geometry merely because a code matches.
The geometry asset manifest documents that distinction separately.

### Display geography and exact-code crosswalk

`geometry-provenance.json` records the independently acquired **BEC v13.1,
8 July 2026** context snapshot from the Province's openly licensed BEC Map
service. The displayed map includes **222 current-snapshot codes**:

| Relationship | Codes | Display behavior |
| --- | ---: | --- |
| Exact match to the 2023 study | 198 | Published study attributes joined by code |
| Historical study code without a context polygon | 15 | Retained in all study downloads; no substitute polygon |
| Context-map code absent from the study | 24 | Grey, with an explicit explanation that no historical result is assigned |

An exact code match does not establish unchanged ecological definitions or
boundaries. The archived v12 source geometry is not supplied in the upstream
repository; its official past-version download was access-blocked during this
work. No code aliases, splits, successor aggregation, or nearest-boundary
assignments are inferred.

The app-owned compressed map is a cartographic adaptation, not a replacement
corporate data snapshot. Its offline preparation script is
`scripts/prepare-bec-story-geometry.py`, using Shapely 2.1.2 and pyproj 3.7.2.
It requires the exact SHA-256-pinned acquired input documented in the manifest;
that raw input is not vendored into PGMaps. Ordinary project regeneration uses
the committed context asset and does not require rerunning geometry preparation.

Acquisition uses the full, openly licensed BEC Map service (layer 21) in BC
Albers with 100 m service generalization. The separately published 1:250,000
generalized service has an Access Only licence and is not redistributed here.
The adaptation dissolves exact unit codes, simplifies at up to 750 m with
topology preservation, reduces tolerance for units whose displayed area would
change by more than 5%, validates the final geometries, and writes deterministic
gzip. The provenance records the actual tolerance and cartographic diagnostics
for each unit. These diagnostics do not modify or validate the study's protected
area results. The story limits zoom to 9 and labels the polygons as context.

`map-attributes.json` provides a small runtime join with percentages, explicit
quality explanations, and the three largest recorded park-name contributions.
`representation.json` retains the complete contributors for every unit. The
display geography defaults to `not-in-study`; only an exact joined study record
can replace that status. Human-readable class labels drive the legend while
stable class identifiers drive chapter highlights.

## Data quality decisions

No published numerical values are silently repaired. The normalized snapshot
retains each source summary row as strings in `units[].raw` alongside explicit
numeric values and quality flags.

| Source case | Normalized behavior |
| --- | --- |
| `CDFmm`: denominator `0`, protected area `187.006` km², ratio `Inf` | Keep the area and raw `Inf`; normalized ratio and percentage are `null`; classify as `invalid-denominator` with `zero-denominator` and `non-finite-source-ratio` flags. |
| `CWHms2`, `ICHmc1a`, `SBPSmk`, `SBSmc1`: blank protected area and ratio | Keep normalized values `null` and an empty contributor list; classify as `no-recorded-intersection` and flag `missing-intersection`. This is not a present-day claim of zero protection. |
| `BWBSvk`, `ESSFmm2`, `SWBvks`: slightly greater than 100% | Retain the published finite ratio and percentage; flag `rounding-over-100`. Only `displayPercent`, intended for bounded visual marks, is capped at 100. |
| Provincial park names | Keep the original name in `sourceParkName` and trim whitespace only in `parkName`. Do not undo upstream grouping by guessing names. |

The upstream importer extracts provincial park names before the first hyphen
and aggregates by that text. Consequently, **882 is the number of source park
name groups**, not an independently verified count of distinct legal protected
areas. Park composition percentages use the source's summed BGC intersection
area, not an official gazetted park area. The source includes one zero-area
intersection row; it remains in the normalized data.

The three >100% values exceed 100 by less than 0.001 percentage point. The
generator verifies all protected totals against the source's rounded-per-row
aggregation. For all three excesses it also verifies that the unrounded sum is
at most the unit's mapped area and that the excess fits the maximum rounding
error of 0.0005 km² per contributor. These checks support the rounding flag;
a generic small tolerance alone would not. No raw ratios are overwritten.
Per-unit `shareOfUnitIntersections` is calculated from the unrounded intersection
areas so contributor shares sum to one. It may differ slightly from a share
computed using the published rounded protected total.

## Classes and defensible snapshot findings

The original script's numeric breakpoints are **1%, 5%, 15%, and 30%**. Its
highest class begins at exactly 30%, despite the original printed label
`>30%`. The story uses inclusive, accurate labels. Ten percent is inside the
5%–15% class, not a separate breakpoint.

| Class id | Meaning | Units |
| --- | --- | ---: |
| `no-recorded-intersection` | No matching park intersection in the published outputs | 4 |
| `below-1` | Finite share below 1% | 14 |
| `1-to-5` | At least 1%, below 5% | 56 |
| `5-to-15` | At least 5%, below 15% | 65 |
| `15-to-30` | At least 15%, below 30% | 41 |
| `30-plus` | At least 30%, including the three rounding excesses | 32 |
| `invalid-denominator` | Percentage unavailable | 1 |

There are 213 units across 16 zone-code prefixes, with 208 finite ratios.
The count of units retains phase-level codes such as `ICHmc1a` and `SBSwk3a`;
it should not be labelled a count of subzones or variants alone. The 16 prefixes
are groups in this source snapshot, not a claim about the current classification.
Among the finite ratios, **70 units have a mapped share below 5%** and **32 have
at least 30%** in this snapshot. These are counts of units, not area-weighted
shares of British Columbia, and the class boundaries are display bins rather
than legally or scientifically established per-unit targets.

For a Prince George-area narrative, `SBSmk1` has a published share of about
3.58%, `SBSmw` about 0.43%, and `ICHvk2` about 17.20%. The entire recorded
`SBSmw` intersection in this snapshot is attributed to Bobtail Mountain Park.
These numbers describe each unit across its mapped extent, not the portion
inside a Prince George administrative boundary. Bowron Lake and Ancient
Forest/Chun T'oh Whudujut appear in the contributor table and provide useful
park-composition examples without inventing a local study boundary.

## Generated contract

`representation.json` has:

- `source`: author, publication date, repository, pinned commit, licence, and
  boundary version referenced by the notebooks.
- `measurement`: definitions of the numerator, denominator, missing values,
  bounded display percentage, and name grouping.
- `summary`: counts that can be displayed in project cards and narrative scenes.
- `classes`: labels, colors, inclusive lower bounds, exclusive upper bounds,
  and counts. Bounds are in percentage points; null bounds do not imply a
  numeric interval for missing/invalid classes.
- `units`: the 213 records sorted by exact source code. Each retains the source
  row, normalized values, quality flags, and all park contributors sorted by
  intersection area descending, then source name.

Use `code` as the identity. If a map's `MAP_LABEL` contains presentation spaces,
remove whitespace to make a join key and report unmatched codes explicitly.
Do not substitute a related variant, strip phase suffixes, or silently assign
missing map features a zero protected share.

## Rebuild and checks

```sh
npm run projects:bec-representation
npm run projects:bec-representation:check
npm run projects:index:check
node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs public/data/projects/bec-protected-areas.json
npm test -- src/maps/project-story/becRepresentation.test.ts src/lib/projectPackages.test.ts src/maps/project-story/storyScene.test.ts src/maps/project-story/storySources.test.ts
npm run e2e -- tests/e2e/bec-representation-story.spec.ts
```

The generator is offline and deterministic. It reads only the pinned source
files; there are no implicit downloads or changes to geometry. The tests cover
all unit/contributor totals, `CDFmm`, every missing-intersection code, all three
rounding excesses, exact threshold behavior, park composition, malformed joins,
and committed-output/hash reproducibility. Regenerating the original spatial
intersections requires the upstream R workflow and matching source geometries;
this JSON generator does not do that.

The focused browser tests exercise all chapters in both directions, class-bar
and methods navigation, real joined polygons and selections, desktop/phone
canvas sizing, readable legends, downloads, and source-failure recovery. They
isolate external basemap availability with a valid empty background style while
rendering the actual committed study geometry and attributes. A passing local
browser test does not certify third-party basemap uptime.

### Verification evidence

The implementation was checked against the final compressed geometry hash
`c1594f8523e3576de76977582feb962243886444a0c7114f69ab461a489d7cf0`:

- Eight pinned-source normalization/integrity tests passed.
- Sixty-three focused project-parser, scene, source-loader, and BEC story tests passed.
- Three browser tests passed, covering 1440 × 900 desktop, 390 × 844 phone, and
  deliberate source failure with recovery.
- The repository-ready package audit and generated catalogue checks passed.
- TypeScript (`tsc -b`), focused ESLint, and the Vite production bundle passed.
- All 222 emitted geometries are valid, nonempty MultiPolygons. The context
  crosswalk is 198 matching study codes, 15 unmatched historical codes, and
  24 current-snapshot codes without study results.

The screenshots below show the actual final geometry and joined attributes.
The browser checks isolate the external basemap with a plain background.

[Desktop verification screenshot](assets/bec-protected-areas/desktop.png)
· [Phone verification screenshot](assets/bec-protected-areas/phone.png)

The study snapshot, narrative package, and map assets are app-owned. They are
not general DataBC scraper snapshots. `bec-representation` is included in the
app-owned preservation list used by `data:sync-from-bcdatamapper --clean`.

The original Apache licence is retained with the sources; `NOTICE.md` identifies
the PGMaps transformations. Province of British Columbia data attribution and
the [Open Government Licence — British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc)
are separate from the upstream repository's software licence.
