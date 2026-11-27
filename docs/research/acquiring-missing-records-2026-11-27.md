# Getting the records a harvested block's review lacks

Research for the block planner, 27 November 2026, following [Working backwards from a harvested block](harvested-blocks-backwards-2026-11-27.md) and [Records behind exceptions](non-public-records-for-exceptions-2026-11-24.md). Every channel below was tried live that day on the five traced cases (named by district and year only; their ids, the holders' names and every licensee URL are kept outside the repository).

## Short answer

- **The forest stewardship plan can be named from public data; its amendment as at a date cannot.** Match the opening's stocking standard id (`RSLT_STANDARDS_UNIT_SVW.STANDARDS_REGIME_ID`) against the plan's stocking standard tables: this named the plan in Cases 2–5, and the plan's own licence table named it in Case 1. The amendment in force at issue was not obtainable for any case. The FDU layer misses amendments (one plan has none before 2023, another none before 2022, two skip a number). The FSP Tracking System is login-only. BC Timber Sales (BCTS) posts only current texts, and holders post current consolidated texts or nothing. FOI is the only route to an amendment's text and approval letter as at a date.
- **The block's own small streams need a field survey, screened first by LiDAR where it is published.** In two of the five cases a published 1 m LidarBC DEM covers the block. In the other three it is flown or planned (2024) but not published. On two unmapped PSCIS culverts, a 2 m flow-accumulation network found one channel exactly at the culvert (1.7 ha catchment) and missed the other (0.5 m pipe; only a 0.15 ha line 9 m away). Field confirmation stays the source.
- **PSCIS ids cannot key a crossing, but a site rule can.** 4,232 PSCIS assessments in the three districts carry 4,232 different crossing ids. No id holds two visits, and 35% sit more than 30 m from any modelled crossing. The rule below folds them into 4,126 sites. It joins 78 of the 82 pairs of ids within 15 m, never joins two records of one survey day unless they are within 5 m (twin pipes), and never joins two mapped streams. Of 104 merged sites, 87 successive pairs agree on the structure and 8 look like a replacement. 9 differ for no stated reason and are flagged for review: at most a 9% false-merge rate, likely less.
- **A crossing can be dated to a bracket from free imagery, and a permit's award date can mislead.**
  - Case 3: the permit section was awarded in March 1995. The road through the crossing is on a 1990 government air photo and absent from a 1987 one, so it was first seen between 14 August 1987 and 25 July 1990, before §56(2)'s 15 June 1995.
  - Case 1: the permit was awarded in 1997. Sentinel-2 puts the twelve in-block culverts' roads between September 2021 and August 2022.
  - Imagery dates the road, not the pipe: whether the structure was replaced after 1995 stays a question for the road permit file.
- **Most decisive records are reached by request, and the planner can track them.** It can draft each request, record its status and enter what comes back as the reviewer's evidence, the way *On this ground* already drafts requests.

## 1. The plan a permit relied on

| Channel | What it gave on the five cases | Effort | Reliability |
| --- | --- | --- | --- |
| FDU layer `FSP_FDU_POLY_SPG` (WFS) | 4–10 plans over each block; amendments with decision and approval dates. `LICENCE1`–`5` holds five licences only, so Case 1's licence is absent from every row | Instant | Current plans good. History incomplete: one BCTS plan has no amendment before 2023, another none before 2022; two plans skip an amendment number; some rows end before they start |
| RESULTS stocking standard id × the plan's stocking standard tables | Named the plan in Cases 2–5, all BCTS: Prince George's plan for Cases 2, 3 (Mackenzie TSA) and 5; Fort St. James's for Case 4. The id sometimes names the version that added the standard, never the amendment in force on a date | Two reads and a text search | Reliable for which plan; silent on the amendment |
| The plan's own licence table | Named Case 1's multi-licensee plan; the permit holder's client number is also that plan's first holder | Search the plan text | Good where the plan lists licences |
| BCTS FSP pages (Prince George, Fort St. James, Vanderhoof) and the business area's file listings | Current texts, maps, supporting documents, the stocking standard appendix, one approval letter. Results under FPPR §12(3), §12.3, §12.4, §12.5, crossing and fish-passage strategies, and stocking standards all read as text. No amendment from 2017–2021 is live. No site plan is posted, although FRPA §20.25(3) requires one | Instant | Current only; can lag the FDU layer by an amendment |
| Web archive copies | Case 3: a copy taken the day before issue ("Amendment 15", cut off after about 49 pages). Case 5: "Amendment 19", about a month before issue. Case 4: the full 2017 replacement text. Case 2: nothing from 2017–18 | Minutes, by searching the archive | Sparse; must be checked against the FDU dates |
| Holders' websites | Case 1's plan: current consolidated text, each page's footer naming the amendment that last changed it, but no 2019 version. Two other plans posted, one a scan with no text. Four plans found nowhere | 10–30 minutes each | Current only; addresses change |
| FSP Tracking System | Login-only (government or Business BCeID; a licensee sees only its own plans); its API answers 401 | — | Not available |
| Forest Operations Map public API (`fom.nrs.gov.bc.ca/api/project/publicSummary`) | Gives `fspId` per project without a login, but FOMs start in 2022: none of the five cases | Instant | Good for blocks since 2022 |
| BCTS business area, district stewardship | Not tried (an email) | Days–weeks, unknown | Untested |
| FOI to the Ministry of Forests (covers BCTS) | The only route found to an amendment's text and approval letter as at a date | $10; 30 business days, extendable 30 | Expect FOIPPA §21 cuts of commercial detail and §22 cuts of personal details |

FRPA §20.25(2) says other holders publish "in accordance with the regulations", but no provision prescribing how an FSP holder publishes was found (FPPR §4.58 and §4.64 cover site level plans and forest operations plans).

The holder of a plan can be shown without keeping a name: read `CLIENT_NAME1` and `PLAN_NAME` live by `FSP_ID` and show them in the session only, as the ground screen does with `keepFields`. Better still, never request them, and name the plan by its id and its BCTS page where it has one.

## 2. Small streams below the Freshwater Atlas

- **How many are missed.** 1,490 of the 4,232 PSCIS assessments in the three districts sit more than 30 m from any modelled crossing (Prince George 41%, Mackenzie 24%, Stuart Nechako 19%).
- **LidarBC.** Bare-earth DEMs are indexed in `LiDAR_BC_S3_Public` (layer 5, 1:2,500 tiles of about 6 MB). Two of the five cases are covered (2020, 2024 and 2025 flights). Three are not: the status layer shows them as planned 2024 and one as flown 2024.
- **A first test.** D8 on 2 m cells, priority-flood filled, run on one tile per culvert:
  - a 1.55 m culvert from 2012: a 1.7 ha flow line crosses the spur road at the recorded point;
  - a 0.5 m culvert from 2005: nothing at 0.5 ha within 70 m; a 0.15 ha line at 9 m; a visible gully 30 m away meets the road.

  Single tiles truncate catchments. The road designer's own drainage (`hydrology.ts`: ditch burn-in, cross-drain candidates where flow meets road fill) is the better screen, and its candidates are exactly the places a crew should check.
- **Field protocols, all opened.**
  - *Field Assessment for Determining Fish Passage Status of Closed Bottom Structures*, 4th ed., 2011, and the PSCIS assessment template v2.4 (2021).
  - The habitat confirmation checklist.
  - RISC *Reconnaissance (1:20,000) Fish and Fish Habitat Inventory* v2.0 (2001) with its 2009 errata.
  - The *Riparian Management Area Guidebook* page (guidance only).
  - The *Fish-stream Identification Guidebook* (2nd ed., 1998): the gov.bc.ca links return 404; an archived copy exists.

  PSCIS submissions need a BCeID and a role granted by the ministry's fish passage program.

## 3. A stable crossing key

A crossing site gets a key minted once and kept (`crossing:<uuid>`). Every source id becomes an alias with its source and the date it was seen (PSCIS crossing id, bcfishpass modelled crossing id, ministry `CROSSING_SITE_ID`, the designer's crossing id, a field check label). A new read is matched to an existing site, never keyed by its own id.

Matching rule, nearest pair first, in BC Albers:

1. **Different mapped streams.** Two records whose nearest modelled crossing, within 30 m, is on different `BLUE_LINE_KEY`s are never one site.
2. **Same survey day.** Two records from one survey day are one site only within 5 m (twin structures). Otherwise they are apart and listed for the reviewer.
3. **Different days.** Two records from different days are one site within 15 m. They are also one site within 30 m when both lie on the same `BLUE_LINE_KEY` with route measures within 10 m.
4. **Day guard.** A join that would put two records of one day into one site is refused.

Tested on the three districts' 4,232 PSCIS assessments:

| Parameters (near / mapped) | Sites with >1 record | Joined pairs | Same-day chains | Likely splits left |
| --- | --- | --- | --- | --- |
| 10 / 20 m | 84 | 87 | 1 | 3 |
| **15 / 30 m (proposed)** | **103–104** | **104–106** | **0 with the day guard** | **3** |
| 20 / 40 m | 111 | 114 | 1 | 1 |
| 25 / 50 m | 126 | 136 | 5 without the guard | 0 |

How the proposed rule behaves:

- **Pairs within 15 m:** 78 of the 82 join. Of the four left apart, one is a pair on two mapped streams 6 m apart and three are same-day pairs 9–15 m apart.
- **Structure history inside joined sites:**
  - 87 successive records agree on type and size (diameter within 15% + 5 cm);
  - 8 show a larger pipe or an open-bottom structure three or more years later, a likely replacement;
  - 9 differ for no stated reason and are flagged, among them a pair two days apart with crew refs "34" and "33a", which is likely two pipes.
- **Splits:** of 43 different-day pairs 15–50 m apart, 3 share a road name and a structure and are likely the same site.
- **The traced cases:** Case 1's twelve culverts and ford from one survey day stay 13 sites. In Case 2, where two 2013 records sit near one 2023 record, the nearer joins and the other is left for the reviewer.

The site's structure history is what §56(2) needs: the road can be dated from imagery, but only successive structure records or the road file can say whether the pipe was renewed.

## 4. Dating a crossing

| Source | Dates | What it shows | Access |
| --- | --- | --- | --- |
| Government air photos (`AIMG_PHOTO_CENTROIDS_SP`) | 1963–2020 frames with date, roll, frame, scale, flying height, focal length | A free thumbnail of each frame (1,250 px, about 3 m a pixel at 1:15,000, about 14 m at 1:70,000) shows a road and its clearing | Thumbnails instant. Full scans $18.50 each, 10–15 business days (Base Map Online Store, GeoBC). Free reduced-resolution viewer for 1996–2012 |
| TRIM transportation lines | Each feature's source photography date (`ASRC_YEAR/MNTH/DAY`) and admit date | "Present by" that date | Instant, live |
| Consolidated cutblocks, RESULTS | Harvest start year | A block reached only across the crossing puts the road there by that year | Instant |
| Esri Wayback | Releases from 2014; what was captured at a place (`SRC_DATE`) | Sub-metre, but Case 1's place has only 2014 captures in every release to 2025 | Instant (PGMaps' feed) |
| Sentinel-2 L2A (Earth Search) | From 2015, every few days | 10 m true colour shows new roads and clearings; snow scenes are of little use | Instant (PGMaps' reader) |
| Landsat collection 2 | From 1984, 30 m | Clearings yes, narrow roads rarely; not tried | — |
| PSCIS | Assessment dates | "Present by" that date, and the structure then | Instant |
| Road permit award date | — | The permit's date, not the road's: in Case 3 the road predated its section's award by five years | Never alone |

Two results:

- **Case 3** (a culvert on a road permit section awarded March 1995):
  - 14 August 1987 (1:70,000 thumbnail): the spur not seen. Weak: about 14 m a pixel.
  - 25 July 1990 (1:15,000): the road and its loop present, the block beyond not yet cut.
  - 2 August 1994: present, block cut (1990 in the consolidated cutblocks).
  - 25 August 1996: TRIM's source photography.

  Bracket: **first seen between 1987-08-14 and 1990-07-25**. The PSCIS record (2025) is the only structure record, so whether the 0.8 m pipe is the original stays for the road permit file.
- **Case 1** (in-block road; permit awarded 1997, sections amended for the block):
  - Wayback: forest only (2014 captures).
  - Sentinel-2:
    - the upper road with about five culverts first seen between 2021-09-02 and 2022-06-14;
    - the lower spurs with about seven culverts between 2022-06-14 and 2022-08-18;
    - all present at the PSCIS survey of 2023-10-10.

## 5. Records only a request reaches

- **Riparian class, fish-stream determination, §56(3) and FSP §12.3 reliance, site plan.**
  - Who holds it: the holder, or BCTS. BCTS must publish site plans under §20.25(3); none are posted.
  - Route: the BCTS business area or district stewardship; FOI as the fallback.
  - Expected: site plans with commercial detail cut under §21, personal details under §22.
- **Crossing design, as-built, install date, maintainer.**
  - Who holds it: the road permit file at district engineering (bridge and major culvert inspections are by a district engineering officer). The `ROAD_RESPONSIBILITY_TYPE_CODE` (FSR owner) and `DESIGNATED_MAINTAINER_IND` (road use permit) fields only point to the file.
  - Route: the district office (road permits and maintenance agreements go to its inbox); FOI.
- **WSR notices and habitat officer terms.**
  - A forestry crossing under §39(2) needs no notice: §38(1) excludes §39(2).
  - For `N-CIAS` and `A-CIAS` files, quote the approval file and FrontCounter tracking numbers to FrontCounter BC or the regional water authorizations office, or FOI. Past FOI releases include a water file's documents requested by file number.
  - WSR §37(2)'s "engineer" is a statutory water official. A professional engineer's design is §39(1)(a)(ix), for culverts of 2 m or more.
- **Contravention determinations.**
  - NRCED has Natural Resource Officer inspections with points and outcomes from January 2021 (16,370; 1,739 in Omineca: 140 on changes in and about a stream, 19 on bridges and major culverts, 66 on road maintenance). Its FAQ lists administrative penalties under four other Acts only.
  - No FRPA §71 determination or penalty was found in it. FRPA §103.1 allows disclosure of a sanctioned party's contravention.
  - Route: FOI to the Ministry of Forests naming the crossing, road, permit, block and dates; the Forest Appeals Commission's decisions; the Forest Practices Board's complaint route for a current concern.
- **FOI generally.**
  - Online form; $10 application fee; up to 30 business days, extendable.
  - Released files are searchable on Open Information, and forestry releases for these districts include violation records and cruise records.
  - The Forest Practices Board is its own public body.

## 6. In the planner

**What is missing, derived and never stored.**

- `acquire/gaps.ts` (DOM-free) lists what the review cannot answer from public data, each with its subject:
  - the open facts of each release, tagged in a new catalogue `packages/legal-rules/acquire/channels.json`;
  - each crossing record's open questions;
  - the FSP identification.
- Every channel in the catalogue has an id, the holder's role, its route (page URL), what to ask, the identifiers needed, its fee, its typical days, and the FOIPPA sections likely to cut it.
- Gap kinds: `fsp-amendment`, `site-plan`, `riparian-class`, `fish-stream-determination`, `crossing-design`, `crossing-build-date`, `crossing-maintainer`, `water-notice-terms`, `contravention`, `small-streams`.
- The list's ids are stable: `<kind>:<block>:<schedule>[:<crossing key>]`.

**Requests, drafted.**

- `acquire/requests.ts` reuses `ground/requests.ts`'s `draftRequest` pattern: subject, to (role and channel), the identifiers read (opening, licence and permit, road permit and section, PSCIS aliases, approval file numbers), what to ask, and why.
- Requests are grouped one letter per channel per block, so many crossings go in one letter.
- Each has an FOI variant with the date range and a line inviting severing rather than refusal.
- Text only; nothing is sent; no holder's name is read or written.

**Status, stored.**

```ts
interface RequestStatus {          // Plan.acquisition?.requests
  gap: string                      // the derived id
  channel: string
  events: { status: 'requested' | 'received' | 'partial' | 'refused' | 'not-held' | 'withdrawn'; date: string; reference?: string; note?: string }[]
}
```

- A gap with no events reads *Not requested*.
- "Due" and "overdue" are derived from the channel's days (FOI: 30 business days, and again after an extension).
- A gap that public data later answers shows *No longer needed*; it is never deleted.

**What came back, as the reviewer's entry.**

```ts
interface ReceivedRecord {         // Plan.acquisition?.received
  id: string
  gaps: string[]
  title: string                    // the reviewer's description, no names
  from: 'holder' | 'bcts' | 'district' | 'water' | 'foi' | 'fpb' | 'field' | 'other'
  documentDate?: string
  receivedOn: string
  reference?: string               // their file number, FOI number, page
  severed?: string                 // e.g. "s. 21 and s. 22 cuts on pp. 3–5"
  values: { fact?: string; crossing?: string; field: string; value: string | number | boolean; page?: string; quote?: string }[]
}
```

- Every value is marked the reviewer's transcription.
- A value feeds nothing until the reviewer uses it as a fact, or as a claim's evidence (the existing claim `evidence` `{label, reference, date}`), or adds it to a crossing's `evidence` with origin `received`.
- The document itself is never stored in the plan or the repository. A browser-only copy (like own photos) is a later owner decision.
- Quotes are optional and short, the reviewer's own, and never names.

**Crossings.**

- `crossings/key.ts` mints the key and keeps aliases. `crossings/pscisSites.ts` applies the matching rule above, and its tests use made-up records for each case: same day, twins, two streams, replacement, chain refusal.
- A crossing's evidence gains:
  - `structure` entries per survey;
  - `sighting` entries: `{ source: 'air-photo' | 'trim' | 'harvest' | 'pscis' | 'wayback' | 'sentinel-2' | 'landsat' | 'field'; date; state: 'present' | 'absent' | 'unclear'; reference; resolutionM?; note? }`.
- `crossings/dating.ts` derives the bracket (the latest absent before the earliest present), printed "first seen between X and Y".
- The bracket is a candidate for a `built-after-1995-06-15` fact: *No* only when the earliest present is before that day, *Yes* only when the latest absent is on or after it, otherwise unknown. It always carries the question "was the structure replaced since?", answered from the structure history or the road file.
- Readers, all live and DOM-free:
  - TRIM lines near the crossing (present by `ASRC`);
  - air photo frames whose footprint (scale × 23 cm) holds the crossing, listed by date with thumbnails beside the map drawn at the frame's scale, so the reviewer marks present or absent;
  - the imagery timeline gets a *Mark present / absent here* action that writes a sighting with the frame's capture date.

**FSP panel.**

- Shows the FDU rows over the block with the amendments approved before the permit's issue date, flagged where the layer is known to skip an amendment.
- Shows the opening's stocking standard ids with "find this id in the plan's stocking standards" and the plan's BCTS page where it has one.
- Shows the FOM `fspId` for blocks since 2022.
- What the reviewer states (plan, amendment, how identified) is a received or entered record; asking for the amendment text is a drafted request.

**Field survey.**

- Move the road designer's field review core (issue, KML with `ExtendedData`, `readObservations`, `observationKey`) and its drainage to shared code (`src/lib/fieldReview/`, `src/lib/forestry/hydrology/`). The designer must not import the planner or the reverse.
- A block pack issues checks:
  - `C-` for each crossing candidate: mapped, modelled, PSCIS, and drainage cross-drain candidates where a published DEM covers the block;
  - `S-` for stream class checks.
- Each check has a return form: structure, size, length, channel width, gradient, fish sampling method, effort and result, photo refs.
- A returned point joins a check only by its label. Otherwise it becomes a candidate crossing that only *Add* makes a record, with origin `entered` and its evidence `field`.

**Kept out.**

- Holder, client, consultant and crew names; licensee documents; air photo scans.
- The project file holds statuses, dates, references, the reviewer's transcribed values and sightings.
- Nothing here enters `usePlanAnalysis` or a check's key.

## 7. Build order

1. Crossing key, aliases and PSCIS sites (hangs on `Plan.crossings`).
2. Channel catalogue, derived gaps, drafted requests and status tracking, with no reads.
3. Received records and their links to facts, claims and crossing evidence.
4. The FSP panel (FDU at issue date, stocking standard ids, BCTS pages, FOM).
5. Dating: sightings and brackets; TRIM, harvest, PSCIS and permit candidates; air photo frames; the timeline's mark action.
6. Field packs: move the field review core and drainage to shared code; block pack issue and import; LiDAR candidates.
7. NRCED inspections near a crossing as evidence; an FOI draft for determinations.

## Sources

- **DataBC WFS:**
  - `FSP_FDU_POLY_SPG`, `RSLT_STANDARDS_UNIT_SVW`;
  - `PSCIS_ASSESSMENT_SVW`, `FWA_STREAM_NETWORKS_SP`;
  - `TRIM_TRANSPORTATION_LINES`, `AIMG_PHOTO_CENTROIDS_SP` and thumbnails;
  - `VEG_CONSOLIDATED_CUT_BLOCKS_SP`;
  - `FTEN_ROAD_SECTION_LINES_SVW`, `FTEN_ROAD_SEGMENT_LINES_SVW`, `FTEN_RUP_SECTION_LINES_SP`, `RRI_BRIDGES_MAJOR_CULVERTS_SP`;
  - `WLS_WATER_APPROVALS_SVW`.
- bcfishpass `modelled_stream_crossings.gpkg` (ODbL).
- LidarBC `LiDAR_BC_S3_Public` and its status layer.
- Esri Wayback configuration and metadata.
- Earth Search `sentinel-2-l2a`.
- [BCTS forest stewardship plans](https://www2.gov.bc.ca/gov/content/industry/forestry/bc-timber-sales/fsp).
- [FSP Tracking System](https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-stewardship-plans/forest-stewardship-plan-tracking-system).
- FOM public API.
- [FOI requests](https://www2.gov.bc.ca/gov/content/governments/about-the-bc-government/open-government/open-information/freedom-of-information) and the Open Information search.
- [NRCED](https://nrced.gov.bc.ca) and its FAQ.
- Natural Resource Officer Service annual reports.
- [Forest Practices Board: file a concern](https://www.bcfpb.ca/contact/file-concern/).
- BC air photos page and the Base Map Online Store.
- `TRIM_BY_DATE.pdf`.
- The fish passage field assessment (4th ed.), the PSCIS template v2.4, the RISC reconnaissance inventory v2.0, and the *Riparian Management Area Guidebook* page.
- Stored BC Laws text:
  - FPPR §56;
  - WSR §§37–39;
  - FRPA §§20.25, 71, 103.1.

**Not verified:**

- whether Earth Search's Landsat assets can be read without a paying account;
- the full-scan resolution of air photos;
- BCTS and district response times by email;
- whether past FOI releases already hold site plans for these districts.

The build followed this design; the contract is [Block planning](../forestry-patch-scenarios.md), **Getting the records a review lacks**.
