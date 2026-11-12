# Visual quality: what 26 real assessments ask of the page (November 2026)

A survey of 26 visual-quality documents (37 files, about 1,000 pages) collected
for `/dev/forestry/visual-quality`. The aim: learn how practitioners set up an
assessment, measure it and report it, so the page can support every workflow and
report type in the set, and find what it already gets right.

The source files are public records: VIAs, public referrals, a records
release, Forest Practices Board reports, research and two Scottish land
management plans. They were read in place and **are not committed**. This page
refers to them by the collection's numbering. It names no licensee, consultant
or person, and leaves out any coordinates beyond what is needed for a test case.

The contract stays [`forestry-visual-quality.md`](forestry-visual-quality.md);
the [planner review](forestry-visual-quality-planner-review-2026-11-10.md) is
the companion list from a BCTS walkthrough. The
[criteria reference](forestry-visual-quality-criteria-reference.md) collects the
wording, tables, factors and decision rules from the same set, against the 2022
handbook. The
[simulation formats](forestry-visual-quality-simulation-formats.md) page sorts
every figure in the set by format and style and says how to remake each.

## What was read

| #         | Document                                                | Kind                                                      | Year       | Simulation                                                                                         | How % alteration was measured                                       |
| --------- | ------------------------------------------------------- | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 01        | Face-Paska Lake CP20                                    | Consultant VIA form, RPF-sealed                           | 2021       | Photo-realistic 3D panoramas paired with photos; overhead and oblique "model confirmation" renders | None measured; partial-cut matrix read (10% removed, ~27 m → R)     |
| 02        | Mead Lake TSL A72878                                    | Design rationale + Kamloops Region summary table          | 2005       | 3D render and oblique; photo not the same frame                                                    | Stated 2.5%, method not given                                       |
| 03        | Gun Lake CP007 (form + 3 viewpoint sheets)              | 2001-guidebook summary form, ArcMap sheets                | 2025       | 3D renders only, no photos                                                                         | **Pixel counts** on the render: blocks ÷ landform                   |
| 04        | David Lake DL7SM (records release, 161 pp)              | VIA amendment, district summary table, FPB report, emails | 2014–16    | 3D renders at 45° FOV, terrain-only render with VSUs, lines-of-force overlay, photo panoramas      | **Image-plane polygon areas** on the render                         |
| 05        | Salisbury Face CP405                                    | 2001-guidebook VIA, RPF-sealed                            | 2020       | Photo-montage; one oblique render                                                                  | **cm² on the print**: proposed ÷ (VLU − rock − private)             |
| 06        | Marblehead CP421                                        | 2022 handbook Appendix 1 form, one per viewpoint          | 2024       | Photo-montage; render as proof of non-visibility                                                   | cm² on the print, then Table 3–5 adjustment                         |
| 07        | Argenta Woodlot 491                                     | Same template, unsigned draft                             | 2024       | Photo-montage; one simulation-only viewpoint on the lake                                           | cm², adjusted                                                       |
| 08        | East Canoe Creek (beetle salvage)                       | Licensee slide deck for a city council                    | 2025       | Real-time 3D render with town buildings and water; flat pink blocks                                | None                                                                |
| 09        | Nashton Block 1                                         | VIA attachment (5 page images)                            | —          | Painted photo-montage                                                                              | cm² polygons on the photo; existing non-veg added; rock netted      |
| 10        | True Blue CP56                                          | Two viewpoint sheets                                      | ~2025      | Painted montage: landform line, existing (red), proposed (blue/tan)                                | None shown                                                          |
| 11, 13–15 | North Selous, Merry Creek A091, Rialto A090, Hills A092 | Wildfire risk reduction public referrals                  | 2020–25    | LiDAR-based render composited onto panoramic photos; tan ground with retained-tree stipple         | None; "VQO well met"                                                |
| 12        | McFarlane Creek CP K080                                 | Public referral                                           | 2021       | LiDAR canopy-height render overlaid on a photo                                                     | None, though PR's 7% is quoted                                      |
| 16        | CP24 Visual Resource Management                         | FLNRO public-meeting slides (44)                          | 2013       | Google Earth with block outlines only; post-harvest photo                                          | Teaching: Table 2 ranges, Table 10 partial cuts                     |
| 17        | Glade (advocacy report + one simulation)                | Community report, annotated montage                       | 2017       | Painted montage; community redrew the outlines larger                                              | None                                                                |
| 18        | Bear Lake                                               | Integrated visual design plan                             | 2001       | WCS renders of five harvest entries over a rotation, 3 × 45° panorama                              | Judged by eye against 0–2%                                          |
| 19        | Computer-based visualization primer                     | Research/extension                                        | 2004       | Compares wireframe, montage, surface model                                                         | —                                                                   |
| 20        | MPB visual impact                                       | Public perception study                                   | 2010       | Photoshop cutblocks on photos, P–MM series                                                         | Planimeter on prints, perspective                                   |
| 21        | Salisbury Creek                                         | FPB complaint investigation of 05                         | 2023       | Pre-harvest / simulation / post-harvest triptychs                                                  | Ocular only; found M where the VIA predicted PR                     |
| 22        | North Lake–Egmont TA0334                                | Consultant VIA report, 71 pp, peer-reviewed               | 2020       | Visual Nature Studio on 10 m LiDAR DTM; photo / render / analysis-render per viewpoint             | **Pixel counts** per landform and sub-landform; private land netted |
| 23        | Angus Creek                                             | Same template                                             | 2023       | VNS on 25 m DEM, analysis renders only                                                             | Pixel counts                                                        |
| 24, 25    | Achray, Achnashellach                                   | Forestry and Land Scotland plans + visualisations         | 2022, 2026 | 3D terrain + generated trees, coupes coloured by felling phase and species, time steps, seasons    | None; qualitative landscape statement                               |
| 26        | Mount Mulligan                                          | EA certificate addendum, visual memo                      | 2015       | Before/after photo simulations with a location inset and FOV wedge                                 | None; visible / not visible per viewpoint                           |

## The report types in the set

1. **2001 VIA Guidebook summary form** (03, 05). Three tests: the basic definition, design and the numbers. Ocular terms run _not visible / not visually evident / subordinate / dominant / out of scale_. Viewpoints are _major / minor / potential_, with H/M/L viewing duration. The form also asks about "all known alterations in the next 5 years".
2. **2022 Handbook Appendix 1 summary form, one per viewpoint** (06, 07). Sections 3.1.1–3.5.2, with ocular phrases highlighted, X, Y, the adjusted figure and the five-level _well met / met / inconclusive / not met / clearly not met_ rating. This is the page's own procedure.
3. **Regional and district summary tables** (02 Kamloops Region, 04 district table). Yes/no rows, an inventory label table and a block × viewpoint visibility matrix (VIS / NVS / "potentially visible").
4. **Consultant VIA report** (22, 23). VSU and landform tables (Tables 1–2), a viewpoint table with significance 1–5 (Table 3), an initial viewpoint × landform matrix with size terms tied to % bands (Table 4), and a seven-element Good/Moderate/Poor design table with distance bands under 2, 2–5 and over 5 km (Table 5). Then the analysis-render sheets in a fixed title block, and a viewpoint map at 1:30,000–1:50,000.
5. **Viewpoint analysis sheets** (03, 22, 23, 04). One render per viewpoint with the landform and blocks outlined, a percent-calculation box, an inventory label key and a legend.
6. **Public referral package** (08, 11–15, 12, 10's blog image). A plain-language VQO paragraph that quotes the limit, a photo/simulation pair or panorama, a block map and a feedback form. No numbers.
7. **Pre / simulation / post triptych** (21, and 16's post-harvest photo). This is how the Forest Practices Board checks a VIA after harvest.
8. **Landscape-level design plan and time series** (18, 19, 24, 25). The same viewpoint rendered for each harvest entry (2001 → 2070, or year 0 / +10 / +20), coloured by phase or species, sometimes by season.
9. **Non-VQO statements** (24, 25 in Scotland; 26 for an EA). A qualitative effect against designations or a land use plan zone, with no Table 2 or Table 7.

## How practitioners set up an assessment

**Objective.** The objective is read from the VLI label: VSU polygon, VSC, VAC, EVC and EVQO, plus the inventory date. Most reports also ask whether the existing condition (EVC) already exceeds the objective (01, 02, 03, 04, 05, 22). Several adjust the inventory:

- **Re-rating EVC** for a landform from imagery: "PR (VSU) / R (LF)" in 22.
- **The dominant VSU's objective** for a landform that spans several (22).
- **Grouping VSUs** into one landform held to the stricter objective (04).
- Recording a **current field EVC** on a continuous P–MM scale beside the inventory's (01).

**Landform.** Every report that measures a figure draws the landform **on the image from each viewpoint**: skyline, shoreline and draws. It is not taken from a map polygon. 22 and 23 split landforms into sub-landforms (1a/1b, 7a/7b) and report each one and their combination. 23 marks an upslope background sub-landform N/A. 08's and 12's licensees never show the landform at all.

**Viewpoints.** Viewpoints from water and fixed points far outnumber road ones: lakeshores, campgrounds, boat launches, cabins, a resort, an island, ferry landings, a golf course, a dock, an airport, a town park, a hiking summit and a gondola platform. Roads appear as single pullouts, not as a drive. Recorded attributes, when any are given:

- UTM or latitude/longitude
- elevation (usually lake level)
- distance and distance zone
- direction of view, often a **range** (315°–070°)
- importance (major/minor, or 1–5)
- viewing duration
- focal length
- a one-line rationale

Many reports record none of these (08, 10–15, 17, 22, 23, 26). Viewpoints a reviewer later named were sometimes missing. In 04 a park viewpoint (Whitehorse Bluffs) was never assessed.

**Treatments, in the units practitioners use:**

- clearcut with reserves or WTRAs, the most common
- dispersed retention given as **stems/ha** (10–15, 100) or "% of live trees"
- partial cuts as **% of trees retained** (35%, 50%) or "**one third removed**"
- shaded fuel breaks with no number
- **treatment units inside one block** (60% partial, 22% patch, 18% reserve)
- cable corridors and trail strips
- group retention
- beetle salvage and burned stands

Only 01 and 16 use a partial-cut table.

**Cumulative.** Reports include existing non-greened-up openings, another sale's or licensee's proposed and CP-ready blocks (22), and "all known alterations in the next 5 years" (01, 03, 04, 05). Private land is either netted out of the landform (05, 06, 07, 22) or de-vegetated "trees down" as a worst case (22). Permanent features such as a transmission line count as existing disturbance, not alteration (22, 26).

## How percent alteration is actually measured

**Everyone who reports a number measures it on the picture.** The methods are pixels in a render (03, 22, 23), polygon areas in the image plane (04), cm² on a print (05, 06, 07, 09) or a planimeter on prints (20). The formula is always (proposed + existing non-veg) ÷ landform, and the denominator varies:

| Denominator                    | Used by                                 |
| ------------------------------ | --------------------------------------- |
| Gross landform                 | 03, 09 (net computed but not used), 23  |
| Landform − rock − private land | 05, 06, 07                              |
| Landform − private land        | 22 (one sheet only reproduces this way) |
| Group of VSUs as one landform  | 04                                      |

The page measures the same quantity: the blocks' apparent area over the landform's visible apparent area, by sightline from the assessment station. It has no **picture of the measurement**: the eye-level frame with the landform, blocks, existing openings, rock and private land outlined, and a calculation box. Every assessor and every reviewer in this set expects to check the number against that picture.

## Camera, lens and framing

- The lens is almost always recorded as "**50 mm**". In 05, 06 and 07 it is a 50 mm lens on an APS-C body, which is **about 80 mm full-frame equivalent**: roughly 17° vertical by 25° horizontal. 06 states the crop factor and 80 mm; 05 does not.
- 04 renders at a **45° field of view**, "scaled to viewing distance for comparison". 18 uses three 45° frames for a ~135° panorama, with azimuth ticks.
- Most figures are **stitched panoramas** of 100–140°, which contradicts the stated lens.
- The page's road view is MapLibre's 36.9° vertical, about a 35 mm lens. A block drawn there is not the same size as in any of these figures.
- Season and lighting drift between photo and render in 02, 08, 12, 17, 21, 22 and 25. A grey render of fresh slash understated the contrast the Board found in 21.

## Where the page already holds

- **Table 2 ranges** match every source that prints them (05, 16, 22's footnotes, the MPB glossary).
- **The partial-cut table is right.** `vqo.ts`'s `PARTIAL_CUT_EQUIVALENT`, read through Table 2, reproduces the class in every row checked of slide 18's _Table 10 – Predicting VQOs for Partial Cuts_ (16). It also gives R for 01's case (10% removed, ~27 m). 01's own chart labels the 20%-removed row's 25–30 m cells PR but colours them R; the page's 1.2 and 1.4 say R.
- **Rock, private land and permanent features** as masks: 05, 06, 07, 09, 22 and 26 net or treat them the same way.
- **Cumulative existing + proposed** and the not-greened-up term (line c). 06 VP5 records 2.9 cm² not greened up and then enters 0 for line c; the page would have counted it, giving 11.4% (M) instead of 2.5%.
- **Viewpoint types 1–5** (handbook 3.2.1) match 01's and 22's 1–5 significance scales.
- **The five-level rating** of Table 7 is the scale 06, 07, 22 and 23 tick.
- **Arithmetic and rule checks.** The documents contain errors that the page's computed figures and Table 2/7 rules would have caught:

| Doc | Error                                                     |
| --- | --------------------------------------------------------- |
| 03  | 7.78% and 12.37% ticked as PR                             |
| 07  | EVQO R rated "well met" at 1.9–2.8%                       |
| 06  | Roads "none" scored +1 at one viewpoint and −1 at another |
| 22  | 0.30% on the sheet, 0.11% in the table                    |
| 23  | Two percentages that do not recompute                     |
| 09  | The net denominator is calculated, then not used          |
| 04  | Recommended patches nobody could later confirm were built |

**The Board's finding in 21 was about operations, not the simulation method.** Group retention shown in the montage became infeasible when the harvest system changed from cable to winch-assisted ground-based. The built opening was a continuous rectilinear band against a pyramid-shaped landform, and the VIA had already answered "lines of force: No". The page has no link from harvest system to retention, and no flag that a design element was answered "No".

## Gaps, ranked by how many documents need them

| Rank | Gap                                                                                                                                                                                                                           | Documents                                                                                    | Now                                                                                    | What it would take                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | **Photo-montage on the aligned field photo**: proposed openings (and retention) drawn onto the real photo, hidden where the terrain or timber hides them                                                                      | 01, 02, 05–07, 09–15, 17, 20, 21, 26 (~17)                                                   | Gap. Step 2 aligns a photo and projects ground points, but draws no clearing           | Render the block mask from the same camera the photo is aligned to, and composite it with occlusion. Offer fills: tan/slash texture, flat colour, outline only (16's style). Match the photo's season        |
| 2    | **Analysis sheet per viewpoint**: the eye-level frame with landform, proposed, existing, rock and private land outlined, plus a calculation box, inventory label key and legend                                               | 03, 04, 05–07, 09, 20, 22, 23 (9)                                                            | Partial. The numbers exist; the picture and box do not                                 | Draw the outlines from the saved view's camera. Print the box as the page's own figures (apparent-area shares), naming the denominator used. Give each sheet its viewpoint, date and lens                    |
| 3    | **Lens, field of view and panorama**: 50 mm, 80 mm (APS-C 50 mm), 45°, panorama with azimuth ticks; caption the lens on every image                                                                                           | Nearly all; 04, 05, 06, 18 explicit                                                          | Gap (planner review item 3)                                                            | Lens presets with a crop factor; a stitched multi-frame panorama capture; a camera block on captions and sheets                                                                                              |
| 4    | **Viewpoint record**: typed UTM or lat/long, elevation, direction range, distance, importance (1–5 or major/minor), duration, rationale, photo date and season, "not visible" with render proof, "simulation only" (no photo) | 01, 03–07, 22, 23 (+ every doc that lacks them)                                              | Partial. Field records hold some; viewpoint type is one value                          | Extend the field record. Make "not visible from here" a saved view with its sightline evidence, which answers 06's and 26's render-as-proof                                                                  |
| 5    | **Form-faithful exports**                                                                                                                                                                                                     | 06, 07 (Appendix 1); 03, 05 (2001 form); 02, 04 (summary tables); 22, 23 (consultant tables) | Partial. FS1252 and the evidence PDF exist                                             | **Appendix 1, one per viewpoint**, comes first: it is the 2022 procedure and every field is already computed. A 2001-guidebook vocabulary map (subordinate/dominant…, major/minor) for reading older VIAs    |
| 6    | **Landform per viewpoint**: sub-landforms, combined figures, a background part marked N/A, a VSU group under the stricter objective, a landform EVC override                                                                  | 04, 22, 23                                                                                   | Partial. One landform polygon per run; the matrix pairs viewpoints and landforms       | Allow sub-landform polygons under one landform with per-part and combined figures. Record a reviewer EVC beside the inventory's                                                                              |
| 7    | **Treatment in practitioners' units**: % trees retained, stems/ha, fraction removed; treatment units inside a block; strips and corridors; group vs single-tree retention; harvest system → feasible retention                | 01, 02, 11–15, 17, 18, 21                                                                    | Partial. Table 5 takes retention %; the partial cut takes % volume and residual height | Accept these units with a stated conversion the reviewer confirms (never silent). Per-polygon harvest system inside a block. Warn when a cable-to-ground change removes simulated group retention (21)       |
| 8    | **Time steps and harvest passes**: the same view at each entry or year, coloured by phase or species, with newly altered vs greened up                                                                                        | 18, 19, 24, 25 (+ 17's "first pass only" critique)                                           | Partial. Recovery years and 12 alternatives exist; no passes, no image series          | Tie saved views to an alternative and year (planner review item 8); export a sheet of paired panels                                                                                                          |
| 9    | **Stand condition in the drawn forest**: MPB red/grey, burned snags, fresh slash colour by opening age                                                                                                                        | 01, 03, 08, 20, 21                                                                           | Gap. The stand is live VRI                                                             | Colour crowns from VRI dead-stem or overview-survey data; colour openings by age. Never treat dead stands as a natural non-green mask (20: grey forest is disliked at every class, but it is not alteration) |
| 10   | **Cumulative categories**: other licensees' and CP-ready proposed blocks in the 5-year window, as their own category                                                                                                          | 01, 03, 04, 05, 22                                                                           | Partial. Existing (RESULTS) and proposed only                                          | An "other planned" import that counts in X and is labelled apart                                                                                                                                             |
| 11   | **Distance zones** as set by the report: 1 / 5 / 12 km (05); design-distance bands under 2, 2–5, over 5 km (22)                                                                                                               | 05, 22                                                                                       | Gap. Fixed at 1 and 8 km (BC VLI)                                                      | Keep the VLI split for the figures and print the report's bands beside them                                                                                                                                  |
| 12   | **Simulation provenance**: purpose, data, DEM resolution, lens, what is drawn, a disclaimer                                                                                                                                   | 02, 19, 17, 22, 23                                                                           | Partial. The evidence PDF lists sources                                                | One provenance block on every exported image                                                                                                                                                                 |
| 13   | **Recommendation → as built**: the reviewer's recommended changes tracked to the design that went ahead; block IDs renamed across permits                                                                                     | 04, 17                                                                                       | Gap                                                                                    | A recommendation list on the VIA record, checked off against the applied alternative; block aliases                                                                                                          |
| 14   | **Non-VQO report**: designation or plan-zone text, a qualitative effect, no Table 2/7                                                                                                                                         | 24, 25, 26                                                                                   | Gap                                                                                    | A report variant that drops the rating sections. Low priority for BC planning                                                                                                                                |

Out of scope for this page: GAR establishment tables (16), lakeshore-management-zone ECA rules (02, 18), WUI fire threat (08), referral feedback forms, and built structures such as a compressor station (26).

## A "check an existing VIA" mode

Six of the eleven documents that report a number (03, 06, 07, 09, 22, 23) carry an arithmetic error, a rating that contradicts Table 2, or an inconsistent adjustment (see _Where the page already holds_). The cheapest new feature with the widest reach is a **checker**. A reviewer types a VIA's own figures: the landform and block areas in whatever unit (pixels, cm²), the denominator deductions, the ocular phrases, the Table 3–5 choices and the ticked rating. The page recomputes X, Y, the adjusted figure and Table 7 through `via.ts`, then lists every disagreement. It needs no terrain, no inventory and no run, and it serves district reviewers and the Board as well as the author.

## Test cases from the set

Each can become a `via.test.ts` or `vqo.test.ts` fixture. Inputs are as printed; "recomputes" marks where the document's own arithmetic differs.

| Source                     | Inputs                                                                                                      | Expected                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03 VP1 / VP2 / VP3         | block ÷ landform px: 18,740 / 371,073; 45,920 / 590,161; 203,195 / 1,642,069                                | 5.05% PR; 7.78% **M**; 12.37% **M** (form ticked PR)                                                                                                                                                |
| 05 VP1–4                   | proposed ÷ (VLU − rock/private), cm²: 1.9 / 144; 10.7 / 276; 4.4 / 128; 0.5 / 68.3                          | 1.3% R; 3.9% PR; 3.4% PR; 0.7% R                                                                                                                                                                    |
| 06 VP2                     | X 7.8%; design +2; roads "none"; retention moderate                                                         | Page's encoding: Y = +1, 8.9%, M. The form's Y = +3 gives 11.0%, M                                                                                                                                  |
| 06 VP3                     | X 12.4%; Y +2                                                                                               | 15.9%, M                                                                                                                                                                                            |
| 06 VP5                     | proposed 0.8, not greened up 2.9, landform 32.4 cm²                                                         | X = 11.4% when line c is counted (the form used 2.5%)                                                                                                                                               |
| 07 VP1–5                   | EVQO R; X 1.9, 2.8, 2.8, 9.0, 1.9%                                                                          | R not met at every viewpoint (form ticked "well met" for four)                                                                                                                                      |
| 09 VP1 / VP2 / VP3         | alteration ÷ VLU (cm²): 30.3 / 241.32 (net 214.06); 317.8 / 875.32 (net 842.16); 76.8 / 707.54 (net 638.04) | Gross 12.5 / 36.3 / 10.9%; net 14.2 / 37.7 / 12.0%. The page should state which denominator it uses                                                                                                 |
| 22 Captain Is. LF1         | proposed 255, landform 120,991, private 42,763 px                                                           | 0.33% with private land netted (the sheet printed 0.32)                                                                                                                                             |
| 22 Ruby 5 LF7a             | 135 / 45,446 px                                                                                             | 0.30% (the table printed 0.11)                                                                                                                                                                      |
| 23 Golf Club LF1 / 1a / 1b | (non-veg + proposed) ÷ LF: 1,736 / 141,912; 718 / 25,807; 1,018 / 109,838                                   | 1.22%, 2.78%, 0.93%                                                                                                                                                                                 |
| 23 Piper Pt / Carlson Pt   | 1,554 / 86,255; 1,605 / 101,708                                                                             | Recompute 1.80% and 1.58% (printed 1.94 and 2.07)                                                                                                                                                   |
| 04 VP21 / VP24             | image-plane areas: 2,576.30 / 286,806.64; 11,923.20 / 106,513.92                                            | 0.90%; 11.19% (VP24 stamped "for demonstration, not for application")                                                                                                                               |
| 02                         | 0% existing + 2.5% proposed                                                                                 | 2.5%, PR met                                                                                                                                                                                        |
| 01                         | partial cut 10% removed at ~27.5 m                                                                          | R                                                                                                                                                                                                   |
| 16 slide 18                | Table 10, every cell                                                                                        | Same class as `partialCutClass`                                                                                                                                                                     |
| 16 slide 19                | Two openings vs one merged opening, both 7%                                                                 | PR vs M: the ocular class decides (scale, shape)                                                                                                                                                    |
| 20                         | Six P–MM series of % alteration, with assigned class and public acceptance rating                           | Egan and Fraser "MM" at 13.8–13.9% sit in Table 2's M; the specialists' labels were not from % alone. Acceptance crosses zero near 6% (8% without grey scenes): perception research, not regulation |

## Suggested order

1. **Lens presets and a camera block on every caption** (gap 3), and the **extended viewpoint record** (gap 4). Small, and every later export needs them.
2. **The checker** (above). Pure `via.ts`, no map.
3. **The analysis sheet per viewpoint** (gap 2), then the **Appendix 1 per-viewpoint export** (gap 5) built from it.
4. **Photo-montage on the aligned photo** (gap 1), and the **pre / simulation / post triptych** that the FS1252 effectiveness evaluation and the Board both use.
5. **Treatment units and practitioner units** (gap 7), and **sub-landforms** (gap 6).
6. **Time steps** (gap 8) and **stand condition** (gap 9).
