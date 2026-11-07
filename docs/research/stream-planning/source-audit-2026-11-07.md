# Stream-planning source audit — 7 November 2026

This audit records the primary documents checked directly on 7 November 2026.
It does not establish site-specific design approval or current tender prices.
The verified examples below are reference evidence, not automatic structure
selections or application price defaults.

## Verification status

| Subject                                 | Status on this audit date                                                                      | Implementation consequence                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| FPPR stream classes and riparian widths | Current BC Laws consolidation read directly; current to 3 November 2026                        | Existing versioned s. 47 class/width table is supported.                                                                                        |
| Road activity within riparian areas     | Current ss. 50–51 read directly                                                                | Keep explicit review conditions and crossing exceptions; a buffer is not an automatic permission or universal prohibition.                      |
| DFO crossing table                      | Revised 2026 PDF retrieved directly; Table 1 checked in text and visually                      | Thresholds are verified references. Keep structure selection manual until accompanying scope and assessment requirements are modelled.          |
| Culvert price values                    | July 2026 Interior Appraisal Manual retrieved directly; Table 4-3 checked in text and visually | The spot checks below are verified appraisal allowances. Keep project rates explicit, with source/date/scope, and leave missing rates unpriced. |
| Provincial context                      | Official service metadata inspected                                                            | Load scoped source evidence with provenance; do not derive assessed fish absence, surveyed channel width, or a reviewed class from it.          |

## 1. FPPR: directly verified

Primary source: [Forest Planning and Practices Regulation, B.C. Reg. 14/2004](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004).
The page identified its consolidation as current to 3 November 2026, last
amended 1 January 2026. Relevant clauses are [s. 47](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004#section47),
[s. 50](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004#section50)
and [s. 51](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004#section51).

For fish streams or streams in community watersheds, s. 47 distinguishes S1-A
using the average stream **or active floodplain** width over 1 km: either at
least 100 m. Remaining thresholds are S1-B >20 m, S2 5–20 m, S3 1.5–<5 m and
S4 <1.5 m. Non-fish streams outside community watersheds are S5 >3 m or S6 ≤3 m.

| Class | Reserve width (m) | Management width (m) | Total management area width (m) |
| ----- | ----------------: | -------------------: | ------------------------------: |
| S1-A  |                 0 |                  100 |                             100 |
| S1-B  |                50 |                   20 |                              70 |
| S2    |                30 |                   20 |                              50 |
| S3    |                20 |                   20 |                              40 |
| S4    |                 0 |                   30 |                              30 |
| S5    |                 0 |                   30 |                              30 |
| S6    |                 0 |                   20 |                              20 |

Section 47 also extends management zones to wider active floodplains and
allows a minister-specified S1-A reserve. Widths start at banks/reserve edges,
not a mapped centreline. Section 50 permits roads in a riparian management area
only under specified exceptions, including necessary crossings. Section 51
also contains a crossing exception to reserve tree restrictions.

Application interpretation: centreline buffers are planning envelopes. The
assessment's `oneKmAverageWidthM` represents the greater relevant 1 km average;
its existing type comment and UI help text already include active floodplain
width. Individual crossings still need their conditions and evidence recorded.

## 2. DFO: revised primary PDF verified

Primary page: [Watercourse crossings: Installation or replacement](https://www.dfo-mpo.gc.ca/pnw-ppe/plan-planifier/crossing-traversee-eng.html).
Opening the HTML URL redirected to the DFO home page. The full document was
subsequently retrieved from the official publications archive:
[DFO technical standards PDF](https://publications.gc.ca/collections/collection_2026/mpo-dfo/fs23/Fs23-823-2026-eng.pdf).

Independent official bibliographic record:
[DFO technical standards, Fs23-823/2026E-PDF](https://publications.gc.ca/site/eng/9.963377/publication.html).
The catalogue record lists ISBN 9780662369400, 24 pages and a PDF named
`Fs23-823-2026-eng.pdf`. It states that the PDF was **replaced with a revised
version on 16 October 2026**. This audit uses that current archive PDF.

Table 1 on printed/PDF page 9 (zero-based page index 8) uses **reference-reach slope** and **crossing length**
(culvert length or bridge deck width). It is not based on road grade or channel
width.

| Reference-reach slope | Proposed crossing length | Minimum applicable type |
| --------------------- | ------------------------ | ----------------------- |
| ≤1.5%                 | ≤10 m                    | Backwatered             |
| ≤3%                   | ≤30 m                    | Stream simulated        |
| ≤6%                   | ≤40 m                    | Open bottom             |
| Any                   | Any                      | Bridge                  |

The table does not establish applicability or permission by itself. The document
requires qualified environmental and engineering assessment and excludes
settings including tidal, dynamic/braided and wetland-connected locations.

Required before implementing an automatic screening rule: model the accompanying
site/scope requirements and retain the source revision. The user's exact earlier
DFO table was not present in repository main at audit time, so a row-by-row
comparison with that earlier proposal remains outstanding.

## 3. Culvert costs: 2026 appraisal spot checks verified

Official starting points:

- [Interior Appraisal Manual landing page](https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/interior-timber-pricing/interior-appraisal-manual).
- [2026 Interior Appraisal Manual, effective 1 July 2026](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf).
- [2025 Interior Logging Cost Report instructions](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/ilcr/2025_ilcr__instructions_c.pdf).
- [Coast appraisal data submissions](https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/coast-timber-pricing/coast-appraisal-data-submissions), including the tabular culvert worksheet.

Initial search extracts showed the older 2025 edition. Direct retrieval
subsequently succeeded for the current landing page and July 2026 PDF. Use that
PDF, not the stale indexed edition. Its cover identifies a 2024 cost base.

Section 4.3.3.1, printed 4-17 (PDF page 82), distinguishes Part A (supply,
transport and installation to final subgrade) from Part B (supply and delivery).
No interpolation is permitted. Engineering cost estimates apply above 1.8 m
diameter or 20 m length. Pipes below 0.95 m diameter are already included in
tabular subgrade allowances. Avoid duplicate costs.

Table 4-3, printed 4-18 (PDF page 83), was checked in text and visually. Selected
**12 m length** examples in CAD:

| Equivalent round diameter | Part A installed allowance per culvert | Part B supply/delivery per metre |
| ------------------------- | -------------------------------------: | -------------------------------: |
| 0.60 m                    |                                 $2,027 |                           $114/m |
| 0.95 m                    |                                 $4,405 |                           $232/m |
| 1.20 m                    |                                 $6,728 |                           $347/m |
| 1.80 m                    |                                $14,525 |                           $734/m |

These are appraisal allowances, not current supplier quotations or complete
site estimates. The user's earlier proposed price rows were not present in
repository main, so no exact comparison is possible. Before adopting a rate,
record region, edition/effective date, currency, units, structure dimensions,
supply/delivery/installation inclusions, tax treatment and any shared items.
The application therefore retains entered rates and discloses incomplete estimates.

## 4. Provincial evidence and browser services

| Dataset                                      | Primary metadata                                                                                                                                                                                              | Inspected service                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Freshwater Atlas stream network              | [BC catalogue](https://catalogue.data.gov.bc.ca/dataset/freshwater-atlas-stream-network); [Government of Canada metadata mirror](https://open.canada.ca/data/en/dataset/92344413-8035-4c08-b996-65a9b3f62fca) | [MapServer/56](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/56)                 |
| Known BC fish observations and distributions | `WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP`; official service metadata                                                                                                                                               | [Fish MapServer/20](https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_fish/MapServer/20) |
| Community watersheds — current               | [BC catalogue](https://catalogue.data.gov.bc.ca/dataset/bc57faf7-23e4-43fe-918a-e999936dbafa); `WHSE_WATER_MANAGEMENT.WLS_COMMUNITY_WS_PUB_SVW`                                                               | [Original MapServer/335](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/335)      |

The network service publishes polylines in BC Albers (EPSG:3005), supports
GeoJSON queries with an output spatial reference, and advertises a 1,000-record
response limit. Use bounded pages and check completeness; retain service IDs
and the query extent. Source IDs are scoped to their service and should not be
treated as a permanent surveyed-reach identifier.

Freshwater Atlas includes observed, inferred and constructed flow arcs, with
lake/river skeletons and connectors among its edge types. These are not all
ordinary channel centreline surveys. Preserve `EDGE_TYPE`, blue-line key and
other provenance. Stream order is not an FPPR class or channel-width measurement.

Fish records provide positive observation evidence at their recorded locations
and dates. An empty query does not establish fish absence. Watershed polygons
provide geographic designation context, not a substitute for checking the
applicable stream assessment. A successful query means all service records in
that bounded query were retrieved; it does not establish ecological completeness
or coverage of a later, relocated road. Retrieval time is not a field-survey date.

## Completion gates

1. Keep reviewed classifications separate from suggestions and imported context.
2. Record conditions, unresolved evidence and the source/revision in exports.
3. Model the revised DFO document's scope requirements before enabling table-driven selection.
4. Review the exact proposed price rows and their estimate basis before enabling default culvert rates.
5. Treat browser/CORS acceptance separately from metadata or Node fetch checks.
