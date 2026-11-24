# Records behind exceptions, approvals and terms that public data does not hold

Research for the block planner, 24 November 2026. The planner reads DataBC, BC Laws, RESULTS, Tantalis and the range layers to help a reviewer judge whether a block can be harvested and reforested. Many outcomes turn on an exemption, a deviation, an approval or a term. This note lists them by law and gives for each:

- what the law says;
- what public data shows;
- the decisive record that is not public;
- who holds that record and how to get it.

Statutes were read on BC Laws, current to 17 November 2026. DataBC layers were checked on the public WFS (`openmaps.gov.bc.ca/geo/pub/wfs`) and in the BC Data Catalogue on 24 November 2026.

**Short answer.**

- **Public data shows where things are and that a decision was made, rarely what the decision says.** Mapped designations, tenures, orders, openings, standards units, reserves, ALR applications and critical habitat are all public. So are the texts of the orders and the plans.
- **The decisive record is almost always a written decision to one person.** None of these is on DataBC or BC Laws:
  - ministerial exemptions (FPPR §§91, 92, 106.1);
  - stocking-standard variances and §46.2 proposals;
  - §97.1 declarations;
  - §108 relief;
  - Land Act §16/§17 terms and land use reports;
  - range use plan schedules and range exemptions;
  - deviations under the 2006 Omineca order (Part E);
  - site plans.

  They sit with the district, the land manager, the licensee or BC Timber Sales (BCTS). They are reached by asking the holder, or through a freedom of information (FOI) request.
- **Some records are restricted by law, not merely unpublished.** These are:
  - archaeological site data (Heritage Conservation Act §3(3), RAAD);
  - resource features, wildlife habitat areas and features whose location the order withholds (Government Actions Regulation §§5(4), 10(3), 11(3));
  - First Nations consultation-area geometry;
  - secured species occurrences;
  - vegetation range barriers.
- **Three public signals were not known to the planner.**
  - RESULTS opening category `SPEX` marks a harvest exempt from site plans under FPPR §33(1), with no free-growing obligation.
  - `REGEN_OBLIGATION_IND = 'N'` marks an intermediate-cut standards unit (§44(4)).
  - `VARIANCE_IND = 'Y'` marks a stocking standard "under an approved variation". The approval itself is not public.
- **One duty to publish is not being met visibly.** FRPA §20.25(3), in force 15 July 2024, requires a timber sales manager to publish its plans, site plans included, on a ministry website. No BCTS site plan was found online.

## How to read the tables

- **Public data** names the layer or page read and what it holds.
- **Not public** is the record that decides the outcome.
- **Spatial?** says whether that record has a mapped footprint somewhere, even if not public.
- **Verified** says what was read:
  - _yes_: the provision and the public or not-public status were both checked;
  - _partly_: the provision was read, but the absence of a public record rests on a search of DataBC, the Catalogue and the agency's pages, which cannot prove a negative;
  - _no_: neither was confirmed.

## 1. FRPA and FPPR: exemptions, approvals and reservations

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| FPPR §44(3)(a)–(i): no free-growing duty where harvest is "restricted to" a listed purpose; FPPR §33(1)(b): no site plan then | RESULTS `RSLT_OPENING_SVW.OPENING_CATEGORY_CODE = 'SPEX'`. The RESULTS submission specifications (edition 8a, 2025) define it as "Areas under tenure that are exempt from site plan requirements under FPPR s33(1)" and say "No reforestation or free-growing obligations exist". In a 1.5° × 0.9° box round Prince George: 292 SPEX openings of 8,691 | Which paragraph of §44(3) was relied on, and its basis. For (d), that is the Range Act agreement and the exclusive use. No site plan exists to read | Licensee or BCTS (cutting permit or TSL file); district | Ask the holder; FOI to the Ministry of Forests | Yes (the opening) | Partly: specification and WFS read; no field for the paragraph was found |
| Code-era exemption from a silviculture prescription (Forest Practices Code §30) | `FTEN_CUT_BLOCK_POLY_SVW.SP_EXEMPT_IND = 'Y'`. The Catalogue's column comment: "cut blocks under one hectare, or the use of the land will be incompatible with the establishment of a free growing stand" | The exemption and its reason | District | FOI | Yes | Partly: Catalogue comment and WFS read |
| FPPR §44(4): (h) and (i) harvests must meet the plan's §16(4) standard for 12 months | `RSLT_STANDARDS_UNIT_SVW.REGEN_OBLIGATION_IND` is "N" for "post-harvest stocking requirement required for intermediate cut (eg. commercial thinning) or selection" (Catalogue comment); `STANDARDS_UNIT_TYPE` | The 12-month survey | Holder | Ask the holder | Yes | Yes |
| FPPR §91(1)(a)(i): the minister may exempt a person from FRPA §§10, 29, 29.1, or from a Part 11 free-growing obligation, "if the minister is satisfied that it is not practicable" | No layer or RESULTS field records it (searched WFS capabilities, 899 layers, and the RESULTS opening and standards-unit columns) | The exemption. FPPR §106.1 requires it to be in writing, specify the matter and the effective date, be delivered to the person and "be filed with the district office" | District office; the person exempted | Ask the holder; FOI to the district | The exemption names an area; no public map | Partly |
| FPPR §91(1)(a)(ii), (b), (c): exemptions from listed practice sections, for minor tenures and for licences to cut; §91(2): from §67 wildlife tree retention, given equivalent retention; §91(3): from §43.1(1), secondary structure | WTRAs appear as RESULTS reserves with objective `WTR` (3,574 of 5,412 reserves in the Prince George box) | The exemption and the equivalent retention it relied on | District; holder | As above | Partly (reserves are mapped) | Partly |
| FPPR §92: the minister responsible for the Wildlife Act may exempt a person from §69 (a general wildlife measure or general ecological community measure) or §70(2) (a wildlife habitat feature) | The measures themselves are public (section 2) | The exemption | Wildlife Act decision maker (Ministry of Water, Land and Resource Stewardship); filed with the district (§106.1) | FOI | Partly | Partly |
| FPPR §92.1: an FSP result or strategy approved for an established objective that conflicts with Part 4 or 5 brings a mandatory exemption, possibly with conditions | The FSP text (section 12) | The exemption's conditions | District; Wildlife Act minister for §§69 and 70(2) | FSP approval letter where published; FOI | No | Partly |
| FPPR §§12.1–12.5: undertakings and conditional exemptions from §§35–36, 43.1(1), 47–53, 55–57, 59–61, 64–67, earned by putting a result or strategy in the FSP and having it approved | The FSP, where the holder or BCTS publishes it; FDUs `FSP_FDU_POLY_SPG` | The district manager's reasons for accepting the result as consistent with the objective (FPPR §§25, 25.1) | District; holder | Approval letter (BCTS posts one for Prince George FSP 24); FOI | FDU only | Partly |
| FPPR §16, §26: stocking standards in the FSP, approved if consistent with timber supply assumptions; FRPA §31.1, FPPR §16.1: chief forester's order of new standards | The FSP's standards; `RSLT_STANDARDS_UNIT_SVW` carries each unit's standards and `STANDARDS_REGIME_ID` ("an approved stocking standard applied"). `VARIANCE_IND` is "Y" if "under an approved variation" (3,241 of 7,834 units in the box) | The variation's approval and reasons. The FSP Tracking System, which holds standards and approvals, is login-only (IDIR or Business BCeID; a licensee sees only its own) | District; Forests' Resource Practices Branch for chief forester orders | FOI; ask the holder | Yes (standards unit) | Partly; whether §16.1 orders are published was not checked |
| FPPR §46.2: a holder who knows the standard cannot be met must notify the minister with reasons and propose new standards; approval or rejection | RESULTS shows the resulting standards and dates, not the proposal | The notice, proposal and decision | District; holder | FOI | Yes | Partly |
| FPPR §97.1: declaration that the free-growing obligation was met "to the extent practicable"; deemed fulfilled unless the minister orders otherwise within 15 months | Free-growing declared fields are public. The RESULTS specification's "Declared to the Extent Practicable" indicator is not among the public standards-unit columns | The declaration (extent unmet, why), any §97.1(3) order | District | FOI | Yes | Yes (column list read) |
| FRPA §29.1, FPPR §94: transfer of a free-growing obligation by written agreement, approved by the minister | RESULTS `CLIENT_NAME` and opening category may show the new holder | The agreement and approval | District; both parties | FOI; ask the parties | Yes | Partly |
| FRPA §30, FPPR §95: government assumes a non-replaceable licence holder's obligation | Opening category `FTFSM` and similar | The request and acceptance | District or timber sales manager | FOI | Yes | Partly |
| FRPA §108, FPPR §96: relief or funding after "an event causing damage" (a wildfire; a landslide or flood that makes a free-growing stand impossible within 20 years) | Fire perimeters and openings are public | The application (§96(2): damaged area, reasons) and the decision | Ministry of Forests | FOI | Yes | Partly |
| FRPA §108.2: minister's order designating an area of catastrophic damage, with relief for persons or classes | Not found on DataBC | The order and any conditions | Ministry of Forests | Ask; FOI | Yes | No: whether these orders are published was not checked |
| FRPA §25: written sanitation exemption from specified provisions so a person may follow a course of action "for the purposes of limiting or mitigating ... the spread of forest pests" | None found | The exemption | Ministry of Forests | FOI | Likely | Partly |
| FPPR §45.2: no free-growing duty for a TSL restricted to an area under a government-funded reforestation-preparation contract | Opening categories `FFTITSL` and `FFTFLTC` mark Forests for Tomorrow sales | The contract | BCTS; Forest Investment Program | FOI | Yes | Partly |
| FPPR §1(2)(f): the net area to be reforested excludes "areas reserved for purposes other than timber harvesting" | `RSLT_FOREST_COVER_RESERVE_SVW`: reserve pattern (`SILV_RESERVE_CODE`) and objective (`SILV_RESERVE_OBJECTIVE_CODE`: WTR 3,574, BIO 1,400, RMA 129, OTH 91, TIM 29 in the box). Forest cover polygons excluded from standards units are submitted to RESULTS too (RESULTS specification) | The site plan's statement of what is reserved, for what purpose, and by whose decision. FPPR §34(2): the holder keeps the site plan; it is not submitted to government | Holder. BCTS for TSLs | BCTS: FRPA §20.25(3) requires publication on a ministry website. Licensees: ask; FRPA §20.25(2) says "in accordance with the regulations", and no FPPR rule for §10 site plans was found | Yes | Partly; no BCTS site plan was found online |
| FRPA §4: no FSP needed outside an FDU for listed purposes (safety, seed, landings, ≤500 m³ salvage); FPPR §32.3–32.4 adds research and other-enactment purposes | None found | The minister's opinion under §4(1)(d) | District | FOI | Yes | Partly |
| FRPA Part 1.1 and FPPR Part 1.1 (forest operations plans): §4.5 exemption from a mandatory amendment; §4.51 exemption from practice requirements where the plan is at least as effective; §4.59 no site level plan for the §44(3)-like purposes | The plan must be public (FPPR §4.64); a site level plan's notice on a website and the plan on request (§4.58) | Exemptions under §§4.5 and 4.51 | District | FOI | Partly | Partly. Whether the Prince George TSA is yet in a forest landscape area was not checked |

## 2. Government Actions Regulation orders and Land Act §93.4 objectives

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| GAR §2(2): an order does not apply to a cutting permit, road permit or TSL "entered into before the order takes effect" | Order dates on each layer (`APPROVAL_DATE`, `NOTICE_DATE`); cutting permit and cutblock dates in `FTEN_CUT_BLOCK_POLY_SVW` | The permit's issue date and area as granted | District; holder | Ask; FOI | Yes | Partly |
| GAR §12 and §9: ungulate winter ranges and their general wildlife measures (GWMs) | `WCP_UNGULATE_WINTER_RANGE_SP` (201,220 polygons; `TIMBER_HARVEST_CODE`). Orders on the Ecosystems Branch's approved UWR page. The U-7-003 caribou order (9 December 2009) carries its own exceptions in the GWMs, such as GWM 2(b)–(d) and GWM 4 for mineral exploration | FPPR §92 exemptions from a GWM | Wildlife Act decision maker; district | FOI | Yes | Yes (the order read) |
| GAR §10: wildlife habitat areas. §10(3): a sensitive WHA's location is not disclosed in the order; written notice goes only to affected Forest Act and Range Act agreement holders, who may be barred from disclosing it | `WCP_WILDLIFE_HABITAT_AREA_POLY` (6,987). The Catalogue's _Wildlife Habitat Areas – Approved (Secure)_ (`WCP_WHA_INT_SP`) is Protected C, named users | Secure WHAs and their notices | Ministry of Water, Land and Resource Stewardship; notified agreement holders | Ask the licensee holding the notice (it may be barred from sharing); the ministry | Yes, withheld | Yes |
| GAR §11: wildlife habitat features (nests, licks, fisheries sensitive features); §11(3) same withholding | No public layer found | The features and notices | As above | As above | Yes, withheld | Partly |
| GAR §5: resource features (karst, range developments, research land, cultural heritage resources not under the HCA, trails). §5(4): location withheld; notice to agreement holders only | `RKPM_KARST_POTENTIAL_AREA_SP` is karst potential, not features. No resource feature layer found | The orders' feature lists and notices | Ministry of Forests; notified holders | Ask; FOI | Yes, withheld | Partly |
| GAR §8: community watersheds | `WLS_COMMUNITY_WS_PUB_SVW` (466). _Community Watersheds (Restricted Access)_ (`WLS_COMMUNITY_WS_GOV_SVW`) is Protected B, government only | The restricted view's extra content | Water, Land and Resource Stewardship | Ask | Yes | Yes |
| GAR §14, §15: fisheries sensitive watersheds; temperature sensitive streams | `WCP_FISH_SENSITIVE_WS_POLY` (327). No temperature sensitive stream layer was found on the WFS or in the Catalogue | The orders for temperature sensitive streams | Water, Land and Resource Stewardship | Ask | Yes | Partly |
| Land Act §93.4: objectives by ministerial order (the 2006 Omineca ADA/SRA order and the Prince George biodiversity order) | `RMP_PLAN_LEGAL_POLY_SVW` with `ENABLING_DOCUMENT_URL`; the order PDFs | The order's maps are "not to be used for legal purposes" | The order's legal description | District; land manager | Yes | Yes (read earlier this session) |
| Omineca order Part E: deviations "as determined by" the agriculture ministry, administered by the forests ministry | None | Any deviation, its terms and area | Ministry of Agriculture and Food (Prince George); district | Ask both; FOI to each | Yes | Partly (order read earlier this session; no register found) |
| Omineca order Part C.6: every Part B proposal referred to the agriculture ministry | None | The referral and the response | Both ministries | As above | Yes | Partly |
| Omineca order Part II: permits, licences and range schedules in effect when the order took effect are left alone | Tantalis and FTEN issue dates | The instrument's terms | Holder; land manager or district | Ask | Yes | Partly |

## 3. Land Act: reserves, designations, dispositions and grants

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| §15: Lieutenant Governor in Council reserve, "subject to any terms and conditions" (§15(4)) | Tantalis `SEC 15 OIC RESERVE` in `TA_CROWN_TENURES_SVW` and `TA_CROWN_RSRV_NOTATIONS_SVW` (11,668 records) | The order's terms | Land manager; Cabinet Office | Orders in council may be searchable; not checked | Yes | Partly |
| §16: withdrawal from disposition; the minister "may impose any terms and conditions" (§16(3)) | Tantalis `SEC 16 MAP RESERVE` | The terms; the notice | Land manager | Ask; FOI | Yes | Partly |
| §17: designation for a use; terms on the use (§17(1.1)); land withdrawn from incompatible dispositions "under this Act" (§17(2)) | Tantalis `SEC 17 DESIGNATED USE AREA`: purpose, subpurpose, `TENURE_DOCUMENT`, expiry | The notice of establishment, its terms, and the land use report saying which uses are compatible (2021 policy §5.4) | Land manager (for Omineca, `OM - LAND MGMNT - NORTHERN SERVICE REGION`) | Ask the land officer with the file and document numbers; FOI | Yes | Yes |
| §§11, 32: dispositions (sale, lease, licence, right of way). §32(2): an accepted application must be published on a public website | Tantalis tenures. Applications and reasons for decision since 15 October 2018 on the _Applications, Comments and Reasons for Decision_ site (`comment.nrs.gov.bc.ca`); older ones on the former ARFD site | The tenure document's terms; public comments (FOI, per the site's own notice) | Land manager; tenure holder | Ask; FOI (third-party interests may be withheld) | Yes | Partly: §32(2) read; site described from search results, not opened |
| Grazing lease consent (LWBC grazing policy 2004 §11: lessee consent for older leases) | Lease polygons | The lease's own consent clause | Lessee; land manager | Ask | Yes | Yes (read earlier this session) |
| §50: every disposition "excepts and reserves" listed rights (1/20 for public works, minerals, and others) | The Act | A particular grant's extra reservations | Crown Land Registry; Land Title Office | Title search | Yes | Partly; grant reservations not checked |
| A §15–17 reserve is not a lease (the Range Act excludes only leased land from Crown range) | The Act | – | – | – | – | Yes (earlier this session) |

## 4. Range Act and FRPA Part 4

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Range agreements (grazing and hay licences and permits) | `FTEN_RANGE_POLY_SVW`: file, type, status, `AUTHORIZED_USE` (AUMs or tonnes). `CLIENT_NAME` is there but the planner never reads it | The agreement's terms | District range staff; holder | Ask; FOI | Yes | Yes |
| FRPA §§32–33: range use plan with a map and a schedule of livestock class, number and period for each pasture | Pastures, range developments and topological barriers (four `WHSE_FOREST_VEGETATION` layers) | The plan and its schedule. Review and comment happens only "in prescribed circumstances" (FRPA §41) or when the minister requires a notice (RPPR §17) | District; holder | Ask the holder; FOI | Yes | Yes |
| FRPA §§43–44: a range stewardship plan holder's grazing schedule; "must make it available to a person on request" | None | The schedule | Holder | **Ask the holder: the Act requires it to be provided** | Yes | Yes |
| RPPR §3: exemption from the plan requirement, for a set period | None | The exemption | District | FOI | Yes | Partly |
| RPPR §12(2): Wildlife Act minister's exemption from a water quality, WHA or UWR objective, given an alternative | None | The exemption | Water, Land and Resource Stewardship | FOI | Yes | Partly |
| RPPR §44: a holder must remove livestock that will significantly interfere with a free-growing stand; §44(2) exemption once measures prevent recurrence | None | Any removal, measure or exemption | District; holder | Ask; FOI | Yes | Yes |
| Range Act §49 directed non-use; §50 exemption orders from minimum use | None | The orders | District | FOI | Yes | Partly |
| FRPA §51: written authorization to build, modify or remove a range development | `RANGE_IMP_FEATURE_LINE_SVW`, `_PNT_SVW` | The authorization and its conditions | District | FOI | Yes | Partly |
| FRPA §48: mitigation of a natural range barrier, as "specified in an operational plan" or "authorized by the minister"; FPPR §18 | The FSP's measure; topological barriers (public). _Natural Range Barriers – Vegetation_ is Protected B, government only, "Download is not authorized". No water barrier dataset was found in the Catalogue | Vegetation and water barriers; the minister's authorization | District range staff | Ask; FOI | Yes, withheld | Partly |

## 5. Agricultural Land Commission Act

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| The Act binds the government (§2(2)); a minister must not exercise a power under another enactment except in accordance with the Act (§3); for Crown land the "owner" is the government | `OATS_ALR_POLYS` | – | – | – | Yes | Yes |
| ALR Use Regulation §10(c): "producing and harvesting timber, including engaging in silviculture" is a farm use that may not be prohibited. §16: parks, wildlife management areas and Land Act §15 recreation reserves are permitted | – | – | – | – | – | Yes |
| §§20, 25, 29: non-farm use, subdivision and exclusion applications. ALR General Regulation §12: the commission "must publish" each application's dates, intent, applicant, and "the commission's determination and the reasons for it" | `OATS_ALR_APPLICATIONS_SVW` (44,537; id, received date, class, component; no decision field), `OATS_ALR_NOI_SV` (notices of intent, 2,938), `OATS_ALR_SRW_SV`. The ALC's Application and Decision Search posts summaries, maps and reasons for applications from 15 July 2015, an archive for 2006–2016, and the public portal | Full application material ("For reasons of privacy, the ALC does not publish all application material", Policy P-05). Decisions on applications older than the archive | ALC | ALC portal; the ALC's records request for older files | Yes | Partly: layers, regulation and the ALC page read; the portal was not searched |

## 6. Heritage Conservation Act

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| §12.1: protected sites (pre-1846 sites, burial places, rock art); §§12.2, 12.4: inspection, investigation and alteration permits | Borden grid `RAAD_BORDENGRID` (public); culture areas | Site locations and records (_Archaeology Known Sites_, Protected C); overview assessments (Protected B); permits and permit reports | Archaeology Branch | RAAD for eligible users (consultants, First Nations, researchers, planning agencies; "not available to the general public"). Others: the free _Archaeological Information Request_, open to "private property owners, industry ... and Indigenous, local or provincial governments" | Yes, withheld | Yes (branch pages read) |
| §3(2)–(3): the register is open to inspection, but "Despite the Freedom of Information and Protection of Privacy Act" the minister may refuse disclosure that could damage a site, breach a §4 agreement, or reveal confidential cultural information | – | As above | Archaeology Branch | – | – | Yes |

## 7. Wildlife Act and Species at Risk Act

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Species occurrences (BC Conservation Data Centre) | `BIOT_OCCR_NON_SENS_AREA_SVW` (public); masked secured occurrences `BIOT_OCCR_MASKED_SENS_AREA_SP` (112 polygons, an advisory only) | Secured occurrences (Protected C, named users, export disabled) | BC CDC | CDC data request; the request route was not checked | Yes, withheld | Partly |
| Wildlife Act §4(4): no use of a wildlife management area's land or resources "without the written permission of the regional manager" | `TA_WILDLIFE_MGMT_AREAS_SVW` | The permission | Regional manager | FOI | Yes | Yes |
| SARA §58: critical habitat protection applies on federal land, and for aquatic species and migratory birds. §61: on other land, only for portions specified by Governor in Council order | `WCP_CRITICAL_HABITAT_SP` (posted; 142,354 polygons). The secure layer is Protected C | Secure critical habitat. No §61 order for southern mountain caribou in BC was found; the 2020 Canada–BC conservation agreement is public | ECCC | ECCC; Species at Risk Public Registry | Yes | Partly (Act read; absence of an order rests on a search) |
| SARA §73: agreements and permits | – | The permit | ECCC | Registry; ECCC | Yes | No (publication not checked) |
| SARA §124: the minister may restrict release of a species' location on COSEWIC's advice | – | Restricted locations | ECCC | – | Yes | Yes |

## 8. Water Sustainability Act

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Licences and points of diversion: FPPR §§59–60 protect licensed waterworks; FPPR §12.3 can exempt from them through FSP results | `WLS_WATER_RIGHTS_LICENCES_SV` (purpose, status, quantity, POD), `WLS_BC_POD_DRINKNG_SOURCES_SP`, community watersheds | Little: a licence's own conditions | Water Stewardship | Water licence query; FOI | Yes | Yes |
| §11: changes in and about a stream only by approval, regulation, authorization or order | `WLS_WATER_APPROVALS_SVW` (47,838; type, status, works) | Notifications under the regulation | Water Stewardship | Ask | Yes | Partly; notifications not checked |
| §43: water objectives by regulation | BC Laws | – | – | – | Yes | Yes |

## 9. Park Act

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| §9: no natural resource in a Class A or C park or designated wildland area may be removed "except as authorized by a valid and subsisting park use permit" | `TA_PARK_ECORES_PA_SVW`; access restrictions `PA_PRTCTD_LND_RSTRCTNS_SV` | Park use permits. The only PUP layers found (Kootenay–Okanagan) are Protected B, government only | BC Parks regional office | Ask; FOI | Yes | Yes |

## 10. First Nations

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Consultation on cutting permits, TSLs, FSPs, Land Act decisions | Consultation-area contacts through the public _Contacts for First Nation Consultation Areas_ service. "Consultation area geometries are not viewable in public map services" (RAAD page) | Consultation records, referral responses, accommodation; FOP engagement reports (FPPR §4.29) | District, BCTS, land manager, licensee; the Nation | Ask the Nation and the decision maker; FOI (parts may be withheld) | Partly | Yes |
| Forest Consultation and Revenue Sharing Agreements | Signed agreements posted as PDFs on gov.bc.ca | Implementation records | Ministry of Indigenous Relations and Reconciliation; Forests | Ask | No | Partly (list page from search results) |
| Treaty land and reserves | `FNT_TREATY_LAND_SP`, `FNT_TREATY_AREA_SP`, `CLAB_INDIAN_RESERVES` | – | – | – | Yes | Yes |
| Tantalis notations of interest (for example, `FIRST NATIONS / SPECIFIC CLAIMS`) | Tantalis | What the notation protects | Land manager; Ministry of Indigenous Relations and Reconciliation | Ask | Yes | Partly |

## 11. Forest Act and BC Timber Sales

| Exception or pathway | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Cutting permits (Part 3.1, in force): issuance on application (§52.03, which must consider cultural heritage and other matters); mandatory refusal (§52.05: a prescribed objective compromised, no FSP or FOP, or inconsistency with the forest operations map); term up to 4 years (§52.08) | `FTEN_CUT_BLOCK_POLY_SVW` (blocks, permit, status, dates); forest operations maps (`FOM_CUTBLOCK_SP`, `FOM_ROAD_SECTION_SP`) | The permit document and its terms and conditions | District; holder | Ask; FOI | Yes | Yes |
| Timber sale licences | `BCTS_SALES_SCHEDULE_SV` (840; block volume, silviculture and yarding systems), `BCTS_BLOCKS_CPRP_SP`, `BCTS_OPERATING_AREAS_SP`; tenders on BC Bid | Site plans, cruise and appraisal detail, unless in the tender package | BCTS business area (Prince George: 2000 South Ospika Blvd) | Ask the business area; BC Bid notice attachments | Yes | Partly: tender package contents not checked |
| Designated areas (Part 13) and special purpose areas (Part 15) | `FADM_SPECIAL_PURPOSE_AREAS_SP` | The order's conditions | Ministry of Forests | Ask | Yes | Partly |
| The 2004 Prince George biodiversity order's monitoring analyses: the LLOWG's young-forest patch analysis of 2015, its 2018 interim analysis on the chief forester's September 2017 Omineca guidance, the analysis planned for 2020, and its annual old and old interior forest analysis (the 2019 one is the Board's Appendix 1) | Only their results, as the Board printed them: FPB/IRC/235 (December 2020), Appendix 1 (old forest, 2019) and Appendix 4 (patch shares, 2015 and 2018), held in `packages/legal-rules/observations/fpb-irc-235.json`. The public inputs the planner reads instead are DataBC's consolidated cutblocks and fire perimeters, today's VRI and FAIB's historical VRI vintages | The analyses' inputs and settings: the harvest, road and retention polygons the LLOWG compiled from licensees, with their dates and sources; whether fires, beetle salvage and roads were counted as young forest; the VRI vintage and the date its ages were projected to; the CFLB and its netdowns; the NDU and mBEC boundaries used; the patch method's join and buffer distances, young window and reference date, as run (2005 policy for 2015, the 2017 guidance for 2018); the software and its settings; and the output patches with their size classes. The 2017 guidance itself was not found online | The LLOWG, the licensee subset of the landscape objectives working group, which "annually collects harvest, road and retention data from all PG TSA licensees" and reports to licensees and the Ministry (FPB/IRC/235, p. 5). The Ministry of Forests, which receives the report and "uses the report to monitor compliance" (Omineca Region; Prince George and Stuart Nechako natural resource districts). BC Timber Sales Prince George, a licensee in the group (footnote 8, p. 4). The Forest Practices Board, as the records of complaint investigation 18042 | Ask the Ministry's district stewardship staff and the Board first, naming the analyses and years. FOI to the Ministry of Forests (it covers BCTS) and to the Board, a public body under FOIPPA Schedule 2 whose head is its Chair. The LLOWG is not a public body: reach it through its members. Licensees' harvest records may be weighed under FOIPPA §21 (third-party business interests) | Yes (patches, harvest polygons, CFLB) | Partly: the Board report was read for who ran and holds the analyses; whether the Ministry or the Board still holds the inputs, not only the reports, was not confirmed |

## 12. The forest stewardship plan itself

| Item | Public data | Not public | Who holds it | How to get it | Spatial? | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| The FSP: results, strategies, stocking standards, measures | Plans published by holders. FRPA §20.25 requires public availability (BCTS: on a ministry website). BCTS Prince George posts FSP 24, maps, supporting documents and the district manager's approval letter. FDUs and identified areas on DataBC. The FDU layer shows FSP 24 Amendment 27 as `APPROVED`; the grazing guide cites Amendment 26 | Licensee approval letters and the reviewer's notes | District; holder | Ask the holder; FOI | FDU | Yes |
| FSP Tracking System | Login-only (IDIR or Business BCeID); "a licensee user can only see their FSP information" | Everything in it: submissions, standards library, decisions | Ministry of Forests | FOI | Yes | Yes |
| FPPR §§20–22: review and comment | Newspaper notice; 60-day review | Comments received and the holder's response (§22 goes to the minister) | Holder; district | FOI | No | Partly |

## Requests to make for a block like this

The case is a block in the Land Act §17 designated use area, Crown lands file 7409068: agriculture and grazing, document R147074, 1,376 ha, effective 12 May 2014.

**What the area holds.** A read on 24 November 2026 tested each layer with `INTERSECTS` against the file's four parts, with each ring thinned to about 150 vertices. A feature that only touches the edge counts.

| Layer | What intersects the file |
| --- | --- |
| ALR | The ALR. Seven ALR applications (six non-farm use, one subdivision; received 1975–2002) and one notice of intent (100298) |
| RESULTS openings | 15: 7 `FTSBF` (BCTS), 3 `SPEX` (2004), 3 `FTML`, 2 `FTLEVY` |
| FTEN cutblocks | 22; two with `SP_EXEMPT_IND = 'Y'` |
| FDUs | BCTS FSP 24, the PGTSA multi-licensee FSP, and others |
| BCTS | Summit Lake operating area; forest operations map cutblocks under FOM 1041 and FOM 1376 |
| Land Act orders | The 2006 ADA/SRA order (_Agricultural Development Areas – Prince George W_) and the Prince George biodiversity order |
| Range | Active range tenure RAN074718 (E01) and two retired tenures |
| Tantalis | Another §17 agriculture area (7405429, 603.6 ha); a §17 roadway; a §16 map reserve (7404612, community); a First Nations specific-claims notation of interest (7410144); pipeline and power line rights of way; licences of occupation; a windpower investigative licence application |
| Water | 11 water licence records (mostly livestock); one expired water approval |
| Critical habitat (federal) | Southern mountain caribou, Hart Ranges, status _Final_ |
| CDC | Two non-sensitive occurrences: White Sturgeon (Upper Fraser), red-listed; Long-billed Curlew, yellow. No masked occurrence |
| Parks | Giscome Portage Trail Protected Area |
| Not found | No UWR, WHA, community watershed, legal OGMA, treaty land or reserve. Borden block GbRp |

**Requests, in order of how much they can change the answer:**

1. **Land manager, Omineca (Northern Service Region, Lands).**
   - The notice of establishment for R147074, its §17(1.1) terms, and the land use report or compatibility determination for forestry and TSLs.
   - Any review or continuation since 2014. The expiry reads 9999.
   - The same for 7405429 if the block reaches it, and the purpose of §16 map reserve 7404612.
   - The interest protected by notation 7410144.
2. **Ministry of Forests, Prince George district, range.**
   - For RAN074718: the agreement, the current range use plan or range stewardship plan with its map and schedule, and the grazing schedule (a stewardship plan holder must provide it on request).
   - Any RPPR §3 or §44(2) exemptions or Range Act §50 orders.
   - Any FRPA §51 authorizations.
   - Vegetation and water barrier records for the area.
3. **Ministry of Forests, Prince George district, silviculture and authorizations.**
   - For the three `SPEX` openings and the two `SP_EXEMPT_IND = 'Y'` blocks: the exemption relied on (Code §30 or FPPR §44(3), and which paragraph).
   - Any FPPR §91 exemptions, §46.2 proposals, §97.1 declarations or §108 relief on openings in the area.
   - The variations behind any `VARIANCE_IND = 'Y'` standards units.
4. **BCTS Prince George.**
   - Site plans for the `FTSBF` openings and the FOM 1041 and 1376 blocks: net area to be reforested, reserves and their purposes, standards units and stocking standards. FRPA §20.25(3) requires BCTS to publish them.
   - Any Part C.6 referrals to agriculture, and their responses.
5. **Ministry of Agriculture and Food (Prince George).** Any Part E deviation or Part C.6 referral response for the area. Confirm which office now administers the order.
6. **ALC.** Decisions and reasons for the seven applications and notice of intent 100298: portal search first, then the ALC's records request for the pre-2015 files.
7. **Archaeology Branch.** A free Archaeological Information Request for the block, or a RAAD search through a consulting archaeologist.
8. **ECCC and the province, on caribou.** What protection measures apply to the Hart Ranges critical habitat on this ground. No §61 order was found; provincial measures and the 2020 agreement are the route.
9. **BC Parks.** Confirm the block stays out of the Giscome Portage Trail Protected Area, or that a park use permit applies.
10. **First Nations.** Contacts for the area from the public consultation-area service; the district's and BCTS's consultation records for the blocks.
11. **FOI, as the fallback for 1–5.**
    - $10 application fee for a general request.
    - 30 working days to respond.
    - Name the file numbers (R147074, 7409068, RAN074718, opening ids, TSL numbers) and the date range.

For the block planner's own validation, separate from any one block: **the LLOWG's 2015 and 2018 patch analyses and its 2019 old forest analysis, with their inputs** (section 11's last row). Ask the Ministry's Prince George district stewardship staff and the Forest Practices Board (investigation 18042) for the analyses and the layers they ran on, and the Ministry for the September 2017 Omineca guidance the 2018 analysis followed. FOI to the Ministry and to the Board is the fallback. What the planner would do with them is in [Block planner: next steps](../forestry-block-planning-next-steps.md), **What the Board check still does not explain**.

## What the planner could hold if it had these

Each is a reviewer-entered record, kept with its source and date, beside the mapped candidate it qualifies. None would feed a calculation without the reviewer's click, as the grazing review's mapped evidence already works.

| Record | Fields |
| --- | --- |
| Land Act §15/16/17 term | Crown lands file; document number; section; effective date; review or expiry; each term as text with its scope (uses allowed, uses excluded, conditions on forestry, conditions on reforestation); compatible uses from the land use report; who gave it; date received |
| Ministerial exemption (FPPR §§91, 92, 25; RPPR §§3, 12, 44) | Provision; person exempted; matter; area (an uploaded shape or the opening ids); effective date; conditions; decision maker; whether filed with the district (§106.1) |
| GWM or objective exemption | Order and GWM number; exemption provision; area; conditions |
| Site plan reservation (FPPR §1(2)(f)) | Opening or cutblock; reserved polygons; purpose; who reserved it; net area to be reforested before and after; standards unit ids |
| Stocking standard and variation | Standards regime id; species, densities, regeneration delay, free-growing height and dates; `VARIANCE_IND` and the approval's reason |
| §44(3) basis for a past opening | Opening id; paragraph relied on; supporting instrument (for (d), the Range Act agreement and evidence of exclusive use) |
| §46.2 proposal, §97.1 declaration, §108 relief | Opening; what was proposed or declared; extent unmet; decision and date |
| Omineca order Part E deviation, Part C.6 referral | Area; parts departed from (for example C.5 planting); conditions; agriculture ministry contact; date |
| Range use plan schedule | Range tenure; pasture; livestock class; number; period of use; range developments affected; barrier measures agreed |
| ALC decision | Application id; type; decision; conditions; reasons link; date |
| Archaeology result | Request date; result (sites, potential, none recorded); conditions on sharing; consultant |
| Park use permit, WMA permission | Permit number; area; activity allowed; expiry |

## Sources

All read on 24 November 2026 unless marked.

**Statutes and regulations (BC Laws).** All current to 17 November 2026; the Forest Act text was current to the same date.

| Instrument | Sections read |
| --- | --- |
| [Forest and Range Practices Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02069_01) | §§2.47–2.48, 4, 10, 20.25, 25, 29.1, 31.1, 32, 33, 41, 43–44, 48, 51, 52.1, 108, 108.2, 109; Table of Legislative Changes, 4th edition (§20.25 in force 15 July 2024, B.C. Reg. 219/2024) |
| [Forest Planning and Practices Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004) | §§4.01, 4.49–4.51, 4.58–4.59, 4.64, 12.1–12.5, 16, 16.1, 20, 26, 32.3–32.4, 33–34, 69–70, 87–88, 90–92.1, 94–97.1, 106.1–106.3, 108 |
| [Government Actions Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/582_2004) | Every section |
| [Land Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96245_01) | §§11, 15–17, 32, 50, 93.4 |
| [Range Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/04071_01) | §§49–50 |
| [Range Planning and Practices Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/19_2004) | §§3, 12, 16–18, 43–44 |
| [Agricultural Land Commission Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02036_01) | §§1–3, 18, 20.3, 25 |
| [ALR Use Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/30_2019) | §§10, 15–19 |
| [ALR General Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/57_2020) | §§12, 16 |
| [Heritage Conservation Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96187_01) | §§3, 12.1, 12.2, 12.4 |
| [Wildlife Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96488_01) | §4 |
| [Water Sustainability Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14015) | §§11, 43, 116 |
| [Park Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96344_01) | §9 |
| [Forest Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96157_00) | Contents; Part 3.1 §§52.03, 52.05, 52.08 |
| [Species at Risk Act](https://laws-lois.justice.gc.ca/eng/acts/S-15.3/FullText.html), current to 29 October 2026 | §§11, 32, 34, 58, 61, 73, 80, 124 |

**Read earlier this session.** The 2006 Omineca ADA/SRA order, the LWBC grazing policy 2004 and the 2021 reserves policy are listed in [Crown grazing, agriculture reserve areas and reforestation](../forestry-crown-grazing.md), _Sources, as read_. Omineca Ministerial Order M60 (2025) was not read again for this note.

**Data.**

- DataBC WFS `GetCapabilities` (899 layers), `DescribeFeatureType`, and counts or feature reads for the layers named above.
- BC Data Catalogue (`catalogue.data.gov.bc.ca` API) records for:
  - RAAD, archaeology known sites, overview assessments;
  - natural range barriers (topological, vegetation);
  - CDC occurrences (public, masked, secured);
  - critical habitat (posted, secure);
  - WHAs (approved, secure), UWRs;
  - community watersheds (current, restricted);
  - ALR applications and notices of intent;
  - FSP layers, Tantalis layers and surface ownership;
  - park use permits;
  - RESULTS openings, standards units and reserves, and FTEN cutblocks (column comments).

**Government pages and documents.**

- [RESULTS information submission specifications, government funded activities, edition 8a (2025)](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/silviculture/silviculture-results/results_information_submission_specifications_government_funded_activities_edition_8a_2025.pdf): opening category codes.
- [RESULTS information submission specifications, licensee version (30 June 2023)](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/silviculture/silviculture-results/2023-06-30_riss_licensee_version_final1_-_copy.pdf): the §97.1 indicator and net area polygons.
- [UWR U-7-003 order, 9 December 2009](https://www.env.gov.bc.ca/wld/documents/uwr/u-7-003_order_09Dec09.pdf), pp. 1–4, and the [approved UWR list](https://www.env.gov.bc.ca/wld/frpa/uwr/approved_uwr.html).
- [BCTS forest stewardship plans](https://www2.gov.bc.ca/gov/content/industry/forestry/bc-timber-sales/fsp), [BCTS Prince George FSP page](https://www2.gov.bc.ca/gov/content/industry/forestry/bc-timber-sales/fsp/prince-george) and [Timber Sale Licences](https://www2.gov.bc.ca/gov/content/industry/forestry/bc-timber-sales/tsl).
- [FSP Tracking System](https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-stewardship-plans/forest-stewardship-plan-tracking-system), updated 16 September 2026.
- [RAAD](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/archaeology/systems/raad), updated 13 April 2026, and [Request archaeological information](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/archaeology/systems/request-arch-info), updated 8 May 2026.
- [ALC Application and Decision Search](https://www.alc.gov.bc.ca/application-decision-search/).

**For the LLOWG request.**

- [Forest Practices Board, _Management of Biodiversity in the Prince George Timber Supply Area_, FPB/IRC/235, December 2020](https://www.bcfpb.ca/wp-content/uploads/2021/05/IRC235-PG-TSA-Biodiversity.pdf): pp. iii, 4–5, 7, 11, Appendices 1 and 4.
- [Freedom of Information and Protection of Privacy Act, Schedule 2](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96165_08): the Forest Practices Board is listed, head the Chair.

**From search results only; pages not opened.**

- [Applications, Comments and Reasons for Decision](https://www2.gov.bc.ca/gov/content/industry/crown-land-water/crown-land/arfd).
- [Forest Consultation and Revenue Sharing Agreements](https://www2.gov.bc.ca/gov/content/environment/natural-resource-stewardship/consulting-with-first-nations/first-nations-negotiations/forest-consultation-and-revenue-sharing-agreements).
- [FOI fees](https://www2.gov.bc.ca/gov/content/governments/about-the-bc-government/open-government/open-information/freedom-of-information/11936).
- [ECCC on southern mountain caribou](https://www.canada.ca/en/environment-climate-change/services/species-risk-public-registry/related-information/approach-addressing-imminent-threats-recovery-southern-mountain-caribou.html).

**Not verified.** Each of these could change a row:

- whether §108.2 catastrophic damage orders and §16.1 stocking standard orders are published;
- whether §15 reserve orders in council can be searched;
- what a BCTS tender package on BC Bid contains;
- the CDC's request route for secured occurrences;
- SARA §73 permit publication;
- Water Sustainability Regulation notifications;
- a water barrier dataset;
- Crown grant reservations;
- whether the Prince George TSA is in a forest landscape area;
- the ALC portal's coverage of the pre-2015 applications in file 7409068.
