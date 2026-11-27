# Working backwards from a harvested block: records, law and exceptions at its stream crossings

Research for the block planner, 27 November 2026. Everything below was checked live that day: the DataBC WFS (`GetCapabilities`, 899 layers; `DescribeFeatureType`; feature reads), the BC Data Catalogue API, the bcfishpass downloads and feature server, and the public API behind the compliance and enforcement database (NRCED).

Five openings harvested 2018–2021 were traced end to end. Their ids, and the trace script, are kept outside the repository; cases are named here by district and year only.

| Case | District | Year | Holder type |
| --- | --- | --- | --- |
| 1 | Prince George | 2021 | Forest licence, cutting permit |
| 2 | Prince George | 2018 | BCTS timber sale licence |
| 3 | Mackenzie | 2021 | BCTS timber sale licence |
| 4 | Stuart Nechako (the former Fort St. James district) | 2021 | BCTS timber sale licence |
| 5 | Prince George | 2021 | BCTS Forests for Tomorrow timber sale licence |

## Short answer

- **The tenure chain joins by key in all five cases:** opening → cut block → cutting permit or timber sale licence → standards units, reserves and activities.
- **The road chain joins three ways, each partial.** Case 1 by road sections whose name or id cites the block or the cutting permit; Cases 3 and 5 (BCTS) by a road segment carrying the sale's timber mark, the road permit awarded the same day as the sale; Cases 2 and 4 not at all: each took access straight off a forest service road and its in-block roads are not tenured.
- **The forest stewardship plan never joined.** The development unit layer lists at most five licences per unit and none for BCTS, keeps only some amendments, and never shows which plan or amendment a permit was issued under. That record is in the FSP Tracking System, which needs a government sign-in.
- **Mapped crossings join well; small streams are invisible.** Road × Freshwater Atlas crossings can be computed, and 36 of 40 matched a bcfishpass modelled crossing within 30 m (and PSCIS where it had a record). The block's own small streams are below Freshwater Atlas resolution: in Case 1 a 2023 survey assessed 12 culverts of 0.5–0.68 m on the block's own road, over channels 0.4–1.4 m wide, 85–680 m from any mapped stream, with no modelled crossing. PSCIS covers 1.5–7.7% of modelled crossings in these districts.
- **No public record gives** a stream's riparian class, a crossing's design, build date or maintainer, or a judgement that a stream is not a fish stream.
- **Exception signals seen:** a Forests for Tomorrow sale (category `FFTITSL`, FPPR §45.2) in Case 5; an approved stocking-standard variation (`VARIANCE_IND = Y`) in Case 4; Water Sustainability Act notifications (`N-CIAS`) beside a crossing in Case 4. Notifications and change approvals are public in `WLS_WATER_APPROVALS_SVW` with type, works description, file number and dates and no holder name, which settles an item the [records note](non-public-records-for-exceptions-2026-11-24.md) left unverified (1,619 notifications and 233 change approvals in the three districts). None of the five had SPEX, `SP_EXEMPT_IND = Y` or an intermediate cut. The fish-stream exceptions never show in public data: a stream ruled not a fish stream, an FPPR §56(3) temporary effect, or an FSP result under §12.3.
- **A PSCIS barrier is evidence about a structure, not a finding under FPPR §56.** Its barrier result is a sum of five hydraulic scores; §56 asks about a "material adverse effect on fish passage in a fish stream" and §56(2) covers only crossings built after 15 June 1995. Several Case 1 "barriers" sit on streams sloped 24–57% where no fish were recorded, so they are likely not fish streams at all.

## 1. Data inventory (verified)

DataBC returns some fields whatever `propertyName` asks for, so every record is cut to the reader's own fields on arrival (`keepFields`).

| Layer | Joins by | Coverage here | Names carried | Licence |
| --- | --- | --- | --- | --- |
| `WHSE_FOREST_VEGETATION.RSLT_OPENING_SVW` | `OPENING_ID`; licence + CP + block; timber mark | 21,671 PG / 9,732 MK / 18,668 Stuart Nechako; 10,622 harvested since 2015 | `CLIENT_NAME`, user ids | OGL-BC |
| `WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW` | `OPENING_ID` | 11,500 / 6,229 / 13,097 | `CLIENT_NAME` | OGL-BC |
| `WHSE_FOREST_TENURE.FTEN_HARVEST_AUTH_POLY_SVW` (issue and expiry, `CATASTROPHIC_IND`, `SALVAGE_TYPE_CODE`, BCTS unit) | licence + CP | Province-wide | `CLIENT_NAME` | OGL-BC |
| RESULTS standards units, reserves, activity treatments | `OPENING_ID` | All openings | IDIR user fields | OGL-BC |
| `WHSE_FOREST_TENURE.FSP_FDU_POLY_SPG` | Spatial only; `LICENCE1`–`5` a weak check | Each case under 7–17 rows from 4–9 plans | `CLIENT_NAME1`–`5`; `PLAN_NAME` may name a holder | OGL-BC |
| `WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW` | `FOREST_FILE_ID` + `ROAD_SECTION_ID`; name text | Province-wide | `CLIENT_NAME` | Access Only |
| `WHSE_FOREST_TENURE.FTEN_ROAD_SEGMENT_LINES_SVW` | Section id; `TIMBER_MARK` | Province-wide | `CLIENT_NAME` | OGL-BC |
| `WHSE_FOREST_TENURE.FTEN_RUP_SECTION_LINES_SP` (`DESIGNATED_MAINTAINER_IND`) | FSR project and stations | Province-wide | `CLIENT_NAME` | Access Only |
| FOM cutblocks and roads; BCTS blocks, planned roads, sales schedule | `FOM_ID`; licence + block | Not current on the five cases | `FSP_HOLDER_NAME` | Access Only |
| `WHSE_FOREST_TENURE.RRI_BRIDGES_MAJOR_CULVERTS_SP` | File + section; `CROSSING_SITE_ID` | Mostly on FSRs | `CLIENT_NUMBER` | Access Only |
| `WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP` | `BLUE_LINE_KEY` + measure; `LINEAR_FEATURE_ID` | Province-wide | No | OGL-BC |
| `WHSE_FISH.PSCIS_ASSESSMENT_SVW`, with habitat confirmation, design and remediation | `STREAM_CROSSING_ID`; `ROAD_TENURE` free text | 3,109 PG / 894 SN / 229 MK; 680 since 2015 | `RESPONSIBLE_PARTY_NAME`, `CONSULTANT_NAME`, `CREW_MEMBERS`; `ROAD_TENURE` often a company | Access Only |
| `WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP`, `FISS_OBSTACLES_PNT_SP`, `FWA_OBSTRUCTIONS_SP`, `FISS_STREAM_SAMPLE_SITES_SP` | Waterbody id or 50k watershed code; spatial; `BLUE_LINE_KEY` | Province-wide | Agency only | OGL-BC |
| `WHSE_WATER_MANAGEMENT.WLS_WATER_APPROVALS_SVW` (`A-CIAS` change approval, `N-CIAS` notification, `STU`) | `APPROVAL_FILE_NUMBER`; spatial | N-CIAS 968 / 525 / 126; A-CIAS 121 / 95 / 17 | No name field | Access Only |
| `WHSE_WILDLIFE_MANAGEMENT.WCP_FISH_SENSITIVE_WS_POLY` | Spatial | Cases 1 and 2 | No | OGL-BC |
| `ADM_NR_DISTRICTS_SPG` | `ORG_UNIT` | No Fort St. James district: it is part of Stuart Nechako (`DVA`); `DJA` returns nothing | No | — |
| bcfishpass `modelled_stream_crossings.gpkg.zip` | `modelled_crossing_id`; FWA keys; `ften_road_section_lines_id` (today the road section's `OBJECTID`) | 40,364 PG / 23,592 SN / 15,480 MK | No | ODbL (code Apache-2.0) |
| bcfishpass `bcfishobs/observations.parquet` | `blue_line_key` + measure | 375,959 observations | Agency only | ODbL |
| bcfishpass feature server `streams_vw` (gradient, modelled width, species access) | `linear_feature_id` | Answered on all five cases | No | ODbL |
| bcfishpass `bcfishpass_crossings` / `bcfishpass_streams` downloads | — | 404 on 27 November (its docs link to them) | `ften_client_name` | ODbL |
| Catalogue: *Freshwater Fish Habitat Accessibility MODEL – Pacific Salmon and Steelhead* | FWA keys | Province-wide | No | OGL-BC |
| NRCED public API | Text search, centroid | Forests: 4,580 sanctions, all under the Wildlife Act; 181 orders; 41 officer inspections province-wide; no FPPR §§55–57 records, none near the cases | `issuedTo` names people and companies | Read only, never keep |
| Not public | Riparian class (only the Cariboo publishes one); crossing design, as-built, install date; FRPA determinations per crossing; site plans; FSP Tracking System | — | — | — |

For the planner: read Access Only layers live as evidence, as the ground screen does; bcfishpass data is ODbL (share-alike), so read it live or keep only per-crossing extracts; prefer the province's OGL access model where it covers the species.

## 2. What the traces found

| Join | Case 1 | Case 2 | Case 3 | Case 4 | Case 5 |
| --- | --- | --- | --- | --- | --- |
| Opening → cut block → permit or sale → standards, reserves, activities | yes | yes | yes | yes | yes |
| → plan and amendment in force at issue | no | no | no | no | no |
| → own road by name or id | yes (1997 permit, amended for this block) | none | no | none | no |
| → own road by segment timber mark | no | no | yes (same day as sale) | no | yes (same day as sale) |
| Computed road × stream crossings | 14 | 11 (FSR beside block) | 2 | 1 (FSR) | 12 |
| …matched to a modelled crossing within 30 m | 14 | 10 | 2 | 1 | 9 (none on a retired permit) |
| PSCIS within 50 m of a crossing / within 1 km | 1 / 18 | 6 assessments at 3 sites / 19 | 2 / 2 | 1 / 4 | 5 / 5 |
| PSCIS `ROAD_TENURE` → road file | blank | blank | yes | blank | blank |
| Fish observations on crossed streams | 3 species | none | none | 5 species | none |
| Ministry bridge or major culvert | 1 | 0 | 0 | 1 (same site as PSCIS) | 4 bridges |
| Water Act notification or approval within 1 km | 0 | 0 | 0 | 2 N-CIAS | 0 |
| Fisheries sensitive watershed order | yes (FRPA 2018) | yes (two) | no | no | no |

Where the joins break:

1. **The plan:** the layer cannot say which plan or amendment a permit was issued under.
2. **In-block roads** are mostly not road permit sections.
3. **Small streams** below the Freshwater Atlas are the block's own crossings, and only a field survey finds them.
4. **PSCIS identity is not stable.** The same site was given different crossing ids in 2013 and 2023, 4–12 m apart; across the three districts 97 pairs of different ids sit within 15 m of each other. Never key a crossing by its PSCIS id.
5. **`ROAD_TENURE` is mostly unusable** (4,232 records): 2,221 blank or "unknown", 1,043 other text (often a company name), 463 FSR-like numbers, 363 road permit ids, 142 Ministry of Transportation. Read only file-id tokens.
6. **No public layer dates a crossing.** A road section's `AWARD_DATE` is the permit's (Case 1's roads are 2019–21 amendments to a 1997 permit; Case 3's culvert is on a section of a permit awarded in 1995, before §56(2)'s cut-off, which still does not date the culvert). Dated PSCIS surveys or imagery can only bracket when a crossing appeared.

## 3. Law each case touched, and the exception signals

"Candidate" means public data offers a value the reviewer may adopt; "reviewer's" means only the reviewer or a non-public record can answer.

- **Case 1.** Permits pack: `cutting-permit` candidate; `fdu` candidate (the block lies under units of three or more plans, and which one holds the licence is the reviewer's); `fdu-feature` candidate yes, a 2018 FRPA fisheries sensitive watershed order (GAR §14); `site-plan` reviewer's. FPPR: cutblock size §64 at 180 ha gross, exceptions the reviewer's; wildlife tree retention §66 a candidate group reserve of 13.6 ha (about 7.6%); riparian §47, one crossed stream with bull trout and rainbow trout recorded (limb (a) of the fish-stream definition), modelled width 3.3 m, S3 the candidate class. Water crossings: `route-forest` candidate; the 0.5 m culverts would fail WSR §39(1)(a)'s 600 mm minimum, but that test is only on the §39(1) route, and a forest holder on §39(2) is tested against FRPA. FPPR §56: PSCIS rated all 12 culverts barriers (2023) with no fish observed; eight are on slopes of 20% or more, so the gradient alone does not make them fish streams under limb (b); four are under 20%, where the gradient presumes a fish stream unless shown otherwise, and one visit with no fish seen is not the evidence limb (b)(i) asks for. No exception signals.
- **Case 2.** The BCTS plan covers the block (candidate); BCTS must publish the site plan under FRPA §20.25(3), and none was found online. Two 2018 fisheries sensitive watershed orders. No road of its own: the 11 crossings are on the FSR beside it, PSCIS barriers in 2013 and again in 2023, evidence about the haul route, not the block; the maintainer duty is the FSR's and any road use permit's designated maintainer's. Signal: `CATASTROPHIC_IND = Y`, which only points toward §64's salvage exception.
- **Case 3.** Sale → road permit by timber mark; that road is now retired and crosses no mapped stream. Two adjacent culverts assessed in 2025 (one on a road permit section, one on an FSR): bull trout access modelled, channel 2.5 m, slope 2.5%, habitat high, outlet drop 0.25 m, barrier, an open-bottom structure recommended. Fish-stream candidate strong (gradient under 20%, modelled access, width 1.6–2.5 m, S3 candidate); §56(2) applies only if built after 15 June 1995, which public data cannot date; who maintained it is in the road permit file. Signals: `CATASTROPHIC_IND = Y`; a BIO reserve, its purpose in the site plan.
- **Case 4.** A 3.6 m corrugated steel FSR culvert in the ministry inventory (inspected 2023), PSCIS barrier in 2025 with fish observed. The species recorded (sculpin, suckers, chub, shiner) are not on FPPR's limb (a) list, so "fish observed" alone does not make a fish stream; it is still a candidate through limb (b) (gradient under 20%) and the salmon access model (a model, not an observation). Two road-culvert notifications within 1 km (2018, expired; 2025, current to 2030): a notification is the §39(1) route's step (WSR §38), while the Crown and Forest Act holders may rely on §39(2); a per-crossing candidate for `route-listed`, `notice-given` and perhaps `officer-terms`, the reviewer matching the file to the crossing. Signal: `VARIANCE_IND = Y`; the approval itself is not public.
- **Case 5.** Sale → road permit by timber mark (now retired); a later sale's road permit is pending through the block. Four FSR bridges of 6–22 m rated passable; one 0.45 m culvert inside the opening on the pending permit's line, 1 m channel, 4% slope, barrier, bull trout access modelled as none: the gradient presumes a fish stream, and the model's "no access" is a candidate for limbs (b)(ii)–(iii), not a finding. Signals: `FFTITSL` (FPPR §45.2; the standards units still show a regeneration obligation, so the signal is about who bears it, and the reforestation contract is not public); `CATASTROPHIC_IND = Y`.

| Signal | Seen in |
| --- | --- |
| SPEX | none |
| `SP_EXEMPT_IND = Y` | none |
| `REGEN_OBLIGATION_IND = N` | none |
| `VARIANCE_IND = Y` | Case 4 |
| `FFTITSL` | Case 5 |
| `CATASTROPHIC_IND = Y` | Cases 2, 3, 5 |
| `N-CIAS` notification | Case 4 |
| `A-CIAS` change approval | none |
| Stream not a fish stream, riparian class, §56(3), §12.3 | never public |

## 4. Evidence, not findings

- A PSCIS barrier prints as "assessed a barrier (PSCIS, date)", never as "fails §56".
- "Fish observed: N" in one visit is not fish absence.
- Species not on the limb (a) list do not make a fish stream; limb (b), gradient under 20%, may.
- bcfishpass access models are models, with their own gradient cut-offs (15% salmon, 20% steelhead, 25% bull trout).
- A road section's award date is the permit's, not the crossing's.
- WSR §39(1)(a)'s figures (600 mm, 300 mm cover, 2 m fill) apply only on the §39(1) route.
- A notification shows the §39(1) route was used near there; it does not say whose works or which crossing.

## 5. One answer set per crossing: proposal

`bc.water-crossings` 1.0.0 answers once per block, for the block's worst crossing. Every case has crossings on different routes and in different states, which one block-level set cannot hold, and FPPR §§55–57 have no rules yet.

**Data model.** An optional `Plan.crossings: CrossingRecord[]`, kept per block and schedule like the grazing reviews:

```ts
interface CrossingRecord {
  key: string // its own stable key, never a PSCIS or modelled id
  block: string
  schedule: string
  footprint: string // out of date when the footprint changes
  at: { point: [number, number]; road?: RoadRef; stream?: StreamRef }
  origin: 'designer' | 'mapped' | 'pscis' | 'entered'
  role: 'own' | 'access' | 'unknown'
  structure?: { kind: 'culvert' | 'bridge' | 'ford' | 'ice-bridge' | 'snowfill' | 'other'; spanOrDiameterM?: number; lengthM?: number; openBottom?: boolean }
  evidence: CrossingEvidence[] // PSCIS stages, modelled crossing and access model, fish observations, ministry structure, WSA approval or notification, designer sizing; each with its read date and source, names cut
  review: ReviewCase // the crossing releases
}
```

**How crossings arrive**, none adopted without the reviewer's click:

1. From the road designer: `buildCrossingRegister` rows (chainage, mapped or modelled source, culvert sizing, reviewed class, approach and skew notes), as candidates.
2. Mapped, on the reviewer's click: road sections in a stated corridor (by name, timber mark or distance) × Freshwater Atlas streams, matched to modelled crossings within 30 m and PSCIS within 50 m.
3. PSCIS records with no mapped stream (Case 1): records within 15 m on the same road offered as one crossing, which the reviewer can split.
4. Entered by the reviewer.

**Evaluation.** A profile list `crossingReleases` beside `blockReleases`. `bc.water-crossings` 2.0.0 becomes a crossing release with the same facts and the worst-crossing wording dropped. A new pack, `bc.fppr-crossings`, from the stored FPPR text: §55, §56(1)–(2) with the 1995 date as a fact, §57, §72, §73; the fish-stream definition's limbs (a), (b), (b)(i)–(iii) as separate facts; §56(3) as a by-law exception and §12.3 as a decision exception. The evaluator runs once per crossing record. The block's roll-up is derived, never stored: the worst standing across crossings, each listed. A block with no records still asks the one question "will the block change a stream?", with unreviewed mapped candidates counted beside the answer.

**Display.** A crossings table per block in the review step (origin, role, structure, evidence, open questions and findings); a row opens that crossing's questions, evidence and claims. The plan map shows crossings by standing, with read-but-unadded candidates dimmed.

**Release and migration.** `crossings` is optional, so older plans open as before. `migrate.ts` turns an existing block-level water-crossings set into one record (`origin: 'entered'`, "All crossings, answered for the block before crossings were listed"), and `bc-water-crossings-v1.0.0.json` is kept beside 2.0.0. Nothing here enters `usePlanAnalysis` or any check's key.

**What public data can prefill, as candidates:**

| Fact | Source | Strength |
| --- | --- | --- |
| `stream-changes` | Designer register; computed crossing on the block's own road | Good for designed roads; misses unmapped streams |
| `route-forest` | Road permit or FSR, tied to the licence by name or timber mark | Candidate; never names the holder |
| `route-listed`, `notice-given` | `N-CIAS` near the crossing | Weak to fair; the reviewer matches the file |
| `route-approval` | `A-CIAS` near the crossing | Weak to fair |
| Structure kind and size | PSCIS; ministry inventory; designer culvert | Good where assessed or designed |
| Fish-stream limbs | Fish observations (listed species or not, upstream or downstream); gradient; access model; PSCIS fish observed and slope | Candidates for each limb, never the answer |
| Fish passage | PSCIS score, drop, embedment; remediation records | Evidence on the structure |
| Channel width | PSCIS or stream-sample measurements; bcfishpass modelled width; the designer's terrain reading | Measured or modelled |
| Built after 1995 | Bracketing only | Weak |
| Riparian class | None public; a `streamClass.ts` suggestion from the facts above | — |

## 6. Build order

Feasible now, from public data:

1. The crossing record, its migration, and `bc.water-crossings` 2.0.0 as a crossing release, entered crossings first, with no reads.
2. `bc.fppr-crossings` (§§55–57, 72–73); then WSR §§41, 43 and 45 in the water pack.
3. Import from the road designer's `buildCrossingRegister`.
4. Mapped crossings on click: road sections and segments, streams, modelled crossings, all four PSCIS stages, ministry structures, Water Act approvals and notifications, names cut on arrival and only file-id tokens kept from `ROAD_TENURE`.
5. Fish evidence per crossing: observations by `blue_line_key` and measure, gradient, access model (the province's OGL model first; bcfishpass live for bull trout and westslope cutthroat).
6. Per-block exception signals beside the existing precedent: `VARIANCE_IND`, `FFTITSL`/`FFTFLTC`, `CATASTROPHIC_IND`/`SALVAGE_TYPE_CODE`.

Needs records that are not public:

| Record | Where it is |
| --- | --- |
| The plan and amendment a permit relied on, and its riparian, fish and crossing results | FSP Tracking System; the holder; BCTS's published plans |
| Riparian classes and reserves | Site plan (FPPR §34(2)); BCTS must publish under FRPA §20.25(3) |
| Crossing design, as-built, install date, maintainer | Road permit file; the ministry for FSRs |
| Fish inventories behind "not a fish stream" | The holder; the ministry |
| WSR §38 notices, habitat officer terms, an engineer's §37(2) requirement | Water stewardship staff, by notification file number; FOI |
| FRPA contravention determinations per crossing | Not in NRCED; FOI to the ministry. Forest Practices Board audits name licensees, so they stay out of the repository |

## Sources

- DataBC WFS `https://openmaps.gov.bc.ca/geo/pub/wfs` and the Catalogue API (`package_search`, `package_show`: licences and the column comments for `CATASTROPHIC_IND`, `APPROVAL_TYPE`, `ROAD_TENURE`, `FINAL_SCORE`, `BARRIER_RESULT_CODE`), read 27 November 2026.
- bcfishpass: [repository and licence](https://github.com/smnorris/bcfishpass), [documentation](https://smnorris.github.io/bcfishpass/), the `modelled_stream_crossings.gpkg.zip` and `bcfishobs/observations.parquet` downloads (dated 26 November) and its feature server.
- NRCED's public API.
- The stored BC Laws text in `packages/legal-rules/catalogue/generated/`: FPPR §1 definitions, §§55–57, 72–73; Water Sustainability Regulation §§37–39, 41, 43, 45.
- [Records behind exceptions](non-public-records-for-exceptions-2026-11-24.md), [On this ground](../forestry-ground-instruments.md), [BC access research](../forestry-road-design/bc-access-research-2026-11-09.md), [Streams and constraints](../forestry-road-design/streams-and-constraints.md).
- Forest Practices Board, [FPB/SIR/25, Fish Passage at Stream Crossings (2009)](https://www.bcfpb.ca/wp-content/uploads/2016/04/SIR25-Fish-Passage-at-Stream-Crossings.pdf) and [FPB/SIR/52 Part 2 (2020)](https://www.bcfpb.ca/wp-content/uploads/2020/05/SIR52-Fish-Habitat-Conservation-Part2.pdf) (from search results only).

Not verified: whether the notices behind `N-CIAS` points can be had by file number without FOI; whether the province's OGL access model matches bcfishpass's current one; whether bcfishpass's road id stays equal to the road section's `OBJECTID` across DataBC refreshes (join on `FOREST_FILE_ID` + `ROAD_SECTION_ID` instead).
