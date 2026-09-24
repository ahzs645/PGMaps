# UBC EDI dashboard: local and R2 inventory

Checked 2026-09-22 against the live [EDI dashboard](https://dashboard.earlylearning.ubc.ca/), the actual local workbook and geometry files, and authenticated Cloudflare R2 listings. Scope: PGMaps, its `vendor/bcdatamapper` checkout, and the `maps` and `pgmaps-private-data` buckets. This is not an inventory of other machines or external drives.

## Implementation status

A local versioned EDI review is now implemented at `/dev/early-learning`. The historical workbook is normalized, all 67 wave-specific dashboard boundary snapshots are captured, and 14 reference snapshots preserve older and current administrative geometry. The province-wide dashboard capture is complete: 755 of 755 selections, with no failed areas. Historical and current results are available in the local viewer, with explicit source gaps. Scraper code and ignored source/products live in `vendor/bcdatamapper/datascrapers/bc/early-learning/`. No EDI data has been uploaded to R2.

The sections below preserve the **pre-implementation inventory and feasibility findings**. Their missing-data statements describe that baseline, not the new local capture.

## Baseline result

We have a substantial historical starting point: the published Wave 2–8 aggregate workbook and geometry covering most dashboard areas. We do not yet have an app-ready EDI dataset. Wave 9, detailed subscale results, and meaningful-change statistics are missing from the local workbook. No dedicated EDI dataset was found in the inspected R2 inventories.

The user's URL selects all school districts, Wave 2, overall vulnerability, and social subscales. The live dashboard supports Waves 2–9; its default landing selection now resolves to Wave 9. The [technical guide](https://earlylearning.ubc.ca/edi-dashboard-technical-guide/) dates Wave 9 to 2022–2026. The [Data Library](https://earlylearning.ubc.ca/resources/mediatype/data-library/) still lists a Wave 2–8 bulk workbook, with no Wave 9 bulk workbook listed.

## EDI measures

Local source: `vendor/bcdatamapper/datascrapers/bc/early-learning-boundaries/cache/EDI_data_library_wave_2_to_8.xlsx`.

The file is 1,593,126 bytes; its SHA-256 matches the existing source audit: `8a85e36a4a8447ab4b494a4494916caa842ed52f5f847e1faca76c53a4399258`.

| Dashboard content | Local coverage | R2 / application status |
| --- | --- | --- |
| Overall vulnerability | Waves 2–8, counts and percentages vulnerable on one or more scales | Workbook only; no dedicated EDI R2 dataset found |
| Five developmental scales | Waves 2–8: physical, social, emotional, language, communication; vulnerable, at risk, and on track counts and percentages | Not normalized into app data |
| Overall outcomes | Vulnerable, in flux, and on track counts and percentages | Not normalized into app data |
| Multiple vulnerabilities | Counts and percentages vulnerable on exactly 1, 2, 3, 4, or 5 scales | Not normalized into app data |
| Demographics and participation | Total and valid EDI case counts; girl, boy, English-language learner, and special-needs counts and percentages | Historical inputs available; this is not proof of complete parity with the current participation module |
| Wave 9 | Not in the cached workbook | No EDI-specific R2 copy found |
| Detailed subscales | Absent from workbook fields, including the social subscale results selected in the user's URL | Missing |
| Meaningful change | No published critical-difference results or thresholds in the workbook | Missing; ordinary differences between percentages are not equivalent |
| Historical trend charts / area comparisons | Can be built from the available aggregate measures, subject to suppression and geography reconciliation | No existing EDI implementation found in `src` |

The nine geography sheets each have 56 measures across seven waves, plus code and name columns. Province is arranged by wave. The workbook also has a Notes sheet. Suppressed values and unavailable periods must remain distinct from zero. CHSA reporting begins at Wave 7 according to the dashboard guide, even though the workbook has columns for all seven waves.

## Geographies

Counts below are measured from the workbook, local GeoJSON, and the live dashboard's region-search index. Search-index counts do not necessarily equal rendered polygon counts or unsuppressed results for any particular wave.

| Boundary | Workbook areas | Live search areas | Local geometry | Local application files |
| --- | ---: | ---: | --- | --- |
| Province | 1 | All-area selections | Existing BC context; no new EDI-specific province geometry required for a summary | Workbook summary available |
| School district | 59 | 59 | 59 official polygons | `public/data/boundaries/BCSchoolDistricts/` |
| HELP neighbourhood | 299 | 297 | 300 published polygons | Cache only; no `BCHELP` public copy at audit time |
| Health authority | 5 | 5 | 5 polygons | `public/data/boundaries/BCMoH/` |
| Health service delivery area | 16 | 16 | 16 polygons | Same BCMoH directory |
| Local health area | 89 | 86 | 89 polygons | Same BCMoH directory; workbook codes all match local geometry |
| Community health service area | 213 | 203 | 231 polygons | Same BCMoH directory; historical code `2210` is missing |
| MCFD Region | 4 | 4 | 4 DataBC polygons and 4 dissolved dashboard polygons | Cache only |
| MCFD service delivery area | 13 | 13 | 13 DataBC polygons and 13 dissolved dashboard polygons | Cache only |
| MCFD local service area | 47 | 46 | 45 DataBC polygons and a cached 47-polygon dashboard capture | Cache only |

Important differences:

- **New Westminster CHSA `2210`:** appears in both the workbook and live dashboard. The local geometry has newer `2211`–`2214` subdivisions instead. There are 19 local CHSA codes absent from the historical workbook. Do not silently join old outcomes onto new polygons or treat the additional polygons as missing EDI downloads.
- **HELP neighbourhoods:** the existing boundary audit identifies `N3901`, `N4410`, and `N5202` in the 300-feature shapefile but absent from the 297-area dashboard search index. Workbook membership is another vintage.
- **MCFD:** the cached dashboard capture includes `2528` Bella Coola Valley and `2529` Central Coast, which are missing from the 45-feature DataBC layer. The existing capture audit records 47 rendered polygons versus 46 searchable areas, with `2529` unsearchable. The local capture was inspected; the full live geometry was not recaptured during this audit.

## R2 verification

Authenticated live listings succeeded after Wrangler refreshed its existing OAuth login. No uploads or bucket changes were performed.

- `maps` root: `bc/`, `canada/`, `canue/`, `census/`, `climate/`, `environmental-burden/`, plus `test.json`.
- Complete `maps/bc/` listing: only an outdoors catalog and regulatory PMTiles archive. No early-learning, school-district, HELP, or MCFD dataset under this prefix.
- Complete `maps/canada/` listing: the administrative-geography catalog and five general administrative PMTiles archives. These are not EDI outcome datasets.
- `pgmaps-private-data/raw/`: climate and ecumene prefixes. `products/`: climate. `manifests/`: the bucket inventory prefix. No dedicated EDI source or product prefix.
- **Related data already in R2:** `maps/canue/aggregates-v2/bcHealth/` has `healthAuthority/`, `hsda/`, `lha/`, and `chsa/` products. These are CANUE environmental aggregates over health boundaries, not EDI results. General census products are also present.

The R2 finding is based on prefix inventories and complete listings of relevant BC/Canada prefixes, not downloading and searching every unrelated climate/CANUE object payload. It establishes that no dedicated EDI publication was found, not that no arbitrary object could contain a mention of EDI.

## Storage policy and next work

The existing source manifest marks the official school-district snapshot as deployable, and keeps the UBC workbook, HELP neighbourhoods, and MCFD geometry in ignored local cache. Normal PGMaps sync copies school districts and audit metadata and removes restricted local public copies. This audit reports that existing project policy; it does not change it.

Recommended implementation order:

1. Normalize the cached workbook into local geography/wave/measure records, preserving source suppression and units. Keep scraper-owned work in `vendor/bcdatamapper`.
2. Reconcile geography vintages, especially CHSA `2210`, and validate joins before mapping outcomes.
3. Obtain or capture the publicly displayed Wave 9, subscale, and meaningful-change data with source provenance. The current bulk workbook cannot supply these.
4. Resolve the recorded publication policy before publishing the restricted sources or derived EDI products. Then choose the appropriate R2 publication and application integration path.

Existing detailed source evidence: `vendor/bcdatamapper/datascrapers/bc/early-learning-boundaries/README.md`, `source-manifest.json`, `output/index.json`, and `output/audit-report.json`.

## Follow-up: supporting historical and current versions

Investigated 2026-09-22 after the user confirmed they want both boundary editions and EDI results over time. Supporting both is feasible, but an EDI wave and a boundary edition must be separate dimensions. In particular, Wave 9 does not mean that the dashboard uses the newest administrative boundaries.

### Live proof of feasibility

Inspected the dashboard with `boundarySelector=CHSA`, `regionSelector=CHSA_2210`, and `caseSelector=CHSA_2210_9`, then opened Overall & Scale Outcomes and Subscales. Read the delivered Leaflet vectors and Plotly chart series after the outputs resolved to that area.

- Historical New Westminster CHSA `2210` is delivered as a vector polygon, so recovering its dashboard geometry does not require guessing it from the newer subdivisions. This is display geometry, not a verified full-resolution administrative archive.
- New Westminster overall vulnerability is delivered for Waves 7, 8, and 9: 27.1%, 24.1%, and 30.6%. The Wave 9 map tooltip also includes the count, 179.
- Social vulnerability is delivered for Waves 7, 8, and 9: 12.0%, 12.4%, and 16.4%.
- The detailed social subscale chart contains numeric, standardized-score series for Overall Social Competence, Responsibility & Respect, Approaches to Learning, and Readiness to Explore New Things. For example, Overall Social Competence is 0.09, 0.13, and -0.20 across Waves 7–9. These scores must not be treated as vulnerability percentages.
- The dashboard also delivers its meaningful-change descriptions. These can be captured as published classifications without inventing critical-difference calculations from the workbook.
- That map contained 210 CHSA vectors, while its search index contains 203 areas and the workbook contains 213. A production importer must reconcile all three inventories and report missing geometry explicitly. This inspection is a representative extraction proof, not a completed province-wide dataset.
- Reactive outputs initially showed stale all-school-district values while the controls already displayed New Westminster. A collector must validate the rendered area's identity and wave before accepting results; waiting for the controls alone is insufficient.

### What can be added

| Version | Feasibility | Work remaining |
| --- | --- | --- |
| Historical EDI Waves 2–8 | Available locally | Normalize the workbook, preserve suppression, validate joins |
| Latest EDI Wave 9 | Representative numeric extraction verified | Collect and validate geography/scale coverage, counts, outcomes, subscales, and source classifications |
| EDI-compatible historical boundaries | Existing HELP/MCFD cache plus dashboard vectors, including New Westminster `2210` | Capture missing boundary families and reconcile their inventories; retain display-resolution provenance |
| Newer health boundaries | Existing 231-CHSA local layer and official 2022 catalogue resources | Pin the actual source edition and retrieval date; preserve it alongside the historical layer |
| Latest official school districts | Existing official snapshot and refreshable source | Archive dated editions; no evidence here establishes a separate geometry for every historical EDI wave |
| Current MCFD organization | Officially documented as 7 SDAs / 44 LSAs from 2024/25 | Still no verified matching vector source; do not relabel the cached 13-SDA geography as current |
| EDI results on newly subdivided boundaries | Not established by the available aggregates | Obtain matching published results or a supported reaggregation source; never copy the old area's percentage onto each new subdivision |

The [official CHSA catalogue](https://catalogue.data.gov.bc.ca/dataset/community-health-service-areas-boundaries) exposes `chsa_2022_wgs.json` and the 2022 health-region master table. Its catalogue metadata modification date is not the boundary's effective date. The [MCFD organization page](https://mcfd.gov.bc.ca/reporting/about-us/how-we-are-organized) documents the 7-SDA/44-LSA structure; the inspected catalogue still exposes the older SDA/LSA services. A separate [Consolidated Local Health Areas catalogue](https://catalogue.data.gov.bc.ca/dataset/consolidated-local-health-areas-boundaries) provides a newer 41-area health classification, but this is not an EDI reporting level in the current dashboard and should not replace its 89-LHA geography automatically.

### Version model and implementation order

Use immutable boundary snapshots and immutable data releases, with a manifest identifying the latest release. Each result should carry its source release, boundary-set identifier, region code, EDI wave, measure, unit, and suppression status. Each boundary set should retain its publisher, source URL, source edition if known, retrieval time, geometry resolution, and publication status. Do not fabricate effective dates from download dates.

In the application, provide an EDI wave selector and a boundary-edition selector with explicit compatibility. Default each EDI result to the geography it was published against. A newer boundary edition may be shown for reference, but unsupported EDI joins should display unavailable rather than an estimated value. Historical workbook releases and newer dashboard releases should remain distinguishable even when they both contain the same wave, because published values may be revised.

The existing `src/lib/studyArea/regions.ts` loads a single BCMoH index and fixed per-level paths. Supporting multiple editions requires a version-aware loader or a dedicated EDI adapter; overwriting the existing files would discard the distinction and affect other maps.

Recommended first implementation: normalize Waves 2–8 locally, add a validated dashboard collector for Wave 9 and missing measures, retain both historical and newer boundary sets, then build the version controls. Keep current MCFD geometry explicitly pending until a matching source is verified. Public R2 publication remains subject to the source restrictions already recorded in the inventory. That feasibility follow-up changed documentation only. The subsequent implementation is described above; publication remains pending.


## Implemented local version model

The scraper package now provides resumable source capture, workbook normalization, current official WFS snapshots, deterministic compressed blobs, immutable release manifests, and validation. Run `npm run early-learning:sync:local -- --capture YYYY-MM-DD --workers 4` from PGMaps. The scraper README documents dependencies and the required historical workbook cache.

The viewer provides independent source, wave, geography, boundary edition, and measure controls. It retains count/percentage/standardized-score units, numeric zeros, negative standardized scores, publisher change descriptions, and explicit missing-data reasons. The earlier workbook release and the newer dashboard release remain separate, including overlapping waves that may have revised values.

### Completed results capture

The current local release is `169e971e35a32ce6f7f8c1bad0780cedd5b25503aa1dd70004ba881669812d3a` (schema 2: shared polygon library, boundary crosswalk and inferred workbook join; see the last section). It replaces `e6d4424ad49e0ed99f255398c28de307f8bb7e8466fa6d5b3b9e9d027cd71d7e` (aggregate calculation checks and shared geometry). The earlier capture-only release remains available by its immutable ID. Its manifest is in `vendor/bcdatamapper/datascrapers/bc/early-learning/cache/products/latest.json`; immutable blobs and release manifests remain in that ignored cache.

| Source | Areas / selections | Measure cells | Numeric values | Missing / outside scope |
| --- | ---: | ---: | ---: | ---: |
| Published workbook, Waves 2–8 | 746, including Province | 292,432 | 221,424 | 71,008 |
| Dashboard capture, Waves 2–9 | 755 selections across nine families | 368,440 | 192,605 | 175,835 |

These are aggregate measure cells, not counts of children; geography levels overlap. The dashboard capture includes 61 measures (counts, percentages, and 15 standardized subscales). Its 175,835 non-numeric cells comprise 97,200 outcome cells outside the requested detail-wave scope, 65,575 cells before CHSA reporting begins, 8,390 publisher-disabled cells, and 4,670 cells not reported in the chart.

Detail charts were captured for Wave 9 in 686 selections. For 64 selections, the publisher explicitly disables Wave 9 and the importer uses its latest selectable wave. Five map-only areas required an older verified map wave because current detail charts could not be verified: Central Coast LHA `337` and LSA `2529` (Wave 5), Telegraph Creek LHA `519` (Wave 6), Burns Lake Town Centre CHSA `5221` and Coast Mountains – UNSURVEYED neighbourhood `N4410` (Wave 8). The captured wave and selection basis are stored with each area and shown in the viewer. A captured selection does not imply an unsuppressed current value: 664 selections report Wave 9 overall vulnerability.

All 88,370 overlapping numeric workbook/dashboard cells agree after allowing for percentage display rounding. The source releases remain separate. One publisher artifact is handled explicitly: the all-CHSA multiple-vulnerability chart returns 50 zeros for Waves 2–6, before CHSA reporting begins. Those zeros remain in raw capture and `sourceValue`, while the review displays `outside_reporting_period`. Other reported zeros remain numeric zero.

### Captured boundary coverage

These are the publisher's **display polygons for each selected wave**, not proof of the administrative boundaries' original effective dates. The importer checks the requested area and wave and the wave in the polygon tooltips. Some wave snapshots share identical geometry; other snapshots differ in which areas the publisher displays.

| Family | Wave 2 | Wave 3 | Wave 4 | Wave 5 | Wave 6 | Wave 7 | Wave 8 | Wave 9 | Current official reference |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| School districts | 58 | 59 | 59 | 59 | 59 | 58 | 58 | 58 | 59, effective edition unknown |
| HELP neighbourhoods | 292 | 298 | 294 | 298 | 298 | 296 | 297 | 296 | No newer verified edition |
| Health authorities | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5, 2022 configuration |
| Health service delivery areas | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16, 2022 configuration |
| Local health areas | 88 | 87 | 89 | 89 | 88 | 85 | 84 | 86 | 89, 2022 configuration |
| Community health service areas | — | — | — | — | — | 210 | 212 | 210 | 231, 2022 configuration |
| MCFD regions (legacy) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | Not verified |
| MCFD service delivery areas (legacy) | 13 | 13 | 13 | 13 | 13 | 13 | 13 | 13 | Current 7-area vectors not verified |
| MCFD local service areas (legacy) | 47 | 46 | 47 | 47 | 46 | 46 | 46 | 46 | Current 44-area vectors not verified |

The combined search and verified wave-map inventory contains 755 selections: 746 geographic units and nine all-area summaries. The wave maps recovered 17 valid IDs omitted from search. All 745 regional IDs in the historical workbook are represented; the dashboard inventory additionally contains `CHSA_1470`. Province is a separate summary sheet in the workbook. Inventory membership does not imply an unsuppressed result in every wave.

There are 67 verified wave maps and 14 reference snapshots (four older health layers, an older school-district layer, HELP/legacy MCFD archives, and five freshly retrieved official layers). Current official health editions are supported by archived catalogue metadata matched to the exact WFS feature class. All source coordinates are retained without simplification.

### Remaining gaps and publication

- Current MCFD organization has 7 SDAs and 44 LSAs; corresponding current vector geography remains unverified. Fresh ArcGIS queries on 2026-09-22 returned 13 SDA records and 45 LSAs, confirming that the available services still expose legacy geography. Query responses are archived in the ignored local source cache.
- Historical workbook values have no boundary edition of their own. Since 23 September they are drawn on the dashboard's polygons by area code, an inference labelled as such (see the last section). Current official polygons show values only where the crosswalk finds the same area.
- Earlier dashboard outcome bars were not collected for every wave. The dashboard capture retains trends across Waves 2–9 and detailed outcomes for each area's recorded detail wave, usually 9; the five map-only fallbacks are listed above. The separate workbook supplies historical outcome measures for Waves 2–8.
- Missing source values are not reconstructed. Workbook blanks conflate suppression and non-reporting; disabled dashboard waves and absent chart values are kept separately.
- No dedicated EDI R2 publication was found or created. The existing source manifest requires written redistribution permission for UBC data/derived geometry and marks MCFD sources Access Only. Local review products stay in ignored cache and are excluded from production assets.

### Verification

Focused checks exercise stale area/wave responses, delayed wave-specific geometry, disabled-wave declarations, source units, suppression, same-name parent/child traces, and incompatible geography joins. The product validator checks every referenced checksum, unique area/wave/measure identities, numeric ranges, closed polygon rings, coordinate order/BC extent, and geometry/result coverage.

Browser checks cover desktop and mobile, workbook/dashboard switching, historical and current boundary choices, standardized scores, no-result map selections, and Stikine's publisher-disabled Waves 3–9. All 23 focused tests pass (14 Python, five Node, four Vitest), as do TypeScript and the production build. The full 81-snapshot product validation passes; repeated normalization produces the same release hash. The Vite endpoint serves only fixed manifest/hash-named product paths; traversal attempts return 404 and compressed products use the gzip content-encoding header.

### Aggregate calculation reproduction and boundary reuse

The first implementation imported publisher calculations and compared overlapping releases. The current implementation also independently recomputes aggregate percentages from published counts, preserving the original values alongside each check. It does not reproduce the child-level scoring pipeline.

| Arithmetic check | Historical workbook | Dashboard capture |
| --- | ---: | ---: |
| Percentages recalculated, matching within 0.05 percentage points | 90,935 | 16,744 |
| Reported percentages lacking complete counts for recalculation | 0 | 44,541 |
| Exactly 1–5 vulnerable-scale counts sum to overall vulnerable count | 3,954 | 4,669 |
| Arithmetic mismatches | 0 | 0 |

Percentage checks cover overall and individual-scale outcomes and exactly 1–5 vulnerable scales. Demographic percentages and the Province's mislabeled 0-scale measure are outside this audit. The denominator is the sum of the three mutually exclusive outcome counts for the relevant scale, all from the same area, wave, and source release. Multiple-vulnerability percentages use the overall outcome denominator. The workbook's total-valid-EDI field differs from that category sum in 7,767 of 23,724 complete scale/wave groups, so it must not be substituted globally. No missing numerator or denominator is inferred from a rounded percentage, another release, or another region. Dashboard historical outcome bars remain an explicit collection gap.

For example, Prince George Wave 9 overall vulnerability is 349 / (349 + 193 + 291) × 100 = 41.8967587%, agreeing with the published 41.9%. The viewer shows the calculation and its check result. Standardized subscales and meaningful-change classifications remain publisher calculations; child-level answers/reference distributions and geocoded records are not present in these aggregate sources. The outcome definitions are documented in [UBC's dashboard technical guide](https://earlylearning.ubc.ca/edi-dashboard-technical-guide/).

Boundary normalization now separates names and wave/source metadata from coordinates and region membership. Exact matching geometry is stored once per normalized content hash: **81 snapshot references share 36 geometry assets**. All four current WFS health snapshots exactly match the existing local BCMoH coordinates and identifiers and reuse their normalized assets. Identical dashboard wave maps also reuse assets. Different region membership or coordinates remain separate; same names/codes alone do not establish equivalence. Join authorization stays attached to each snapshot, so sharing an asset cannot make a reference-only edition eligible for EDI values.

The current release references 63,787,300 compressed geometry bytes versus 122,481,172 before deduplication (47.9% less). Raw captures and earlier immutable release assets are retained for reproducibility; this is a reduction in the current release's geometry footprint, not a claim that old disk files were deleted. No R2 assets were changed.

## Boundary crosswalk and workbook mapping (23 September 2026)

Earlier summaries counted area codes: 209 of 210 Wave 9 CHSA codes also appear in the current layer. **A matching code does not mean a matching area.** The new crosswalk compares the polygons themselves. It clips both editions to their shared land footprint, then measures intersection over union in an equal-area projection.

| Family | Same area (IoU ≥ 0.95) | Same code, different area | Code gone | Current only |
| --- | ---: | ---: | ---: | ---: |
| CHSA | 192 | 21 | 1 (`2210`) | 18 |
| School districts | 30 | 29 | 0 | 0 |
| Health authorities | 5 | 0 | 0 | 0 |
| Health service delivery areas | 16 | 0 | 0 | 0 |
| Local health areas | 89 | 0 | 0 | 0 |

Examples: Burnaby `CHSA_2222` exists in both editions with no overlap, because the old area is now `2223` (45%) and `2224` (55%). Old New Westminster `2210` now spans `2211`–`2214`. The dashboard's school-district polygons differ from the official layer well beyond coastline drawing. The earlier statement that they matched apart from coastlines was wrong.

What the release now does:

- **Current boundaries.** EDI values appear on a current official polygon only when its code is `same_area`. Changed and newer areas are drawn in a separate colour and never receive a value. Overlapping codes are listed for context only.
- **Workbook, Waves 2–8.** Workbook values are drawn on the dashboard polygon with the same code and wave. The evidence: all 88,370 values that both releases publish agree, and every numeric workbook value has a polygon drawn for its wave. The pairing is not published by UBC, so it is recorded as `inferred_by_region_id` and labelled in the viewer. A family with any disagreement would stay table-only.
- **Storage.** No captured ID is drawn differently from one wave to another; the 67 wave maps differ only in which IDs they show. Each family now has one polygon library plus per-wave `regionIds`. Compressed EDI polygon storage fell from 23.7 MiB to 7.1 MiB, and distinct geometry files from 36 to 19.

| Current release component | Compressed |
| --- | ---: |
| Results, both releases | 6.3 MiB |
| EDI polygons, all nine families | 7.1 MiB |
| Crosswalk | 4 KiB |
| Manifest | 0.3 MiB |
| **Browser-ready without official reference polygons** | **13.7 MiB** |
| Official reference polygons (already served by PGMaps' shared boundaries) | 37.1 MiB |

The official reference polygons are kept locally for review, but a web release does not need to duplicate them. Nothing was published: the release is still marked non-redistributable, and no R2 objects were changed. The new crosswalk file and release blobs are local only. The 22 September private backup does not contain them, but they can be rebuilt from the backed-up sources.
