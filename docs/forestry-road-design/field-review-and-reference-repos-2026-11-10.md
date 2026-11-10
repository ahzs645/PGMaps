# Field review and reference repositories — 10 November 2026

This record covers one change set. It started from three user-supplied inputs:

- a recorded conversation with a forestry layout person;
- a set of eight ArcGIS Pro block-map PDFs;
- one licensee's planned blocks and hand-drawn roads in TFL 30, east of Prince George.

It also covers a review of 14 open-source forestry-road projects. It says what each input showed,
what was built, what was deliberately not built, and what is still open.

None of the supplied files is redistributed in this repository. The blocks, roads and map sheets
are a licensee's unreleased planning material, and PGMaps is public. Figures below about them are
aggregates, with no block names or coordinates.

## What the layout person does, and where PGMaps now stands

These are the rules the layout person described for drawing block roads, checked against their own
TFL 30 roads (22 roads, 15.0 km, serving 19 blocks of 541 ha). The measurement used the same regional
DEM PGMaps uses (about 22 m cells), the Freshwater Atlas, FTEN road sections and the Digital Road
Atlas (DRA) over DataBC WFS.

| Rule (in the person's words, paraphrased)                                                                           | What their roads show                                                                                                                                                                               | Before this change                                                                       | Now                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Point the junction so a loaded truck turns out toward the mill with a mild turn; spurs bend back toward the haul    | No right-angle tees: median 45° to the host road. For 15 of 21 junctions the loaded truck turns under 90° toward the fastest network route to Prince George. Branches leave their parent at 25–39°. | Joined at the perpendicular foot point; `routing.ts` `endHeading` existed but was unused | [Haul destinations and junction turns](haul-destinations-and-junctions.md): pick a destination, junctions are searched along the host road and scored on the loaded turn, and the Review list gets a three-state row |
| Know which mill the wood goes to; distance converts to cycle time, which drives appraisal                           | 54–101 km by road to Prince George, 1.3–1.6× straight line                                                                                                                                          | None                                                                                     | Same guide: haul route over loaded roads, legs by class, loaded/empty/cycle minutes with editable speeds                                                                                                             |
| Skid at most 300–350 m on flat ground, about 200 m on steep ground uphill; add spurs or move the road when exceeded | With all roads, the farthest point of every block is 153–346 m away (median 249 m). Remove each block's own roads and 12 of the 17 blocks with roads fail.                                          | Reach rules lived only in Python research                                                | [Skid reach, spurs and landing sites](skid-reach-and-spurs.md): along-ground reach with an uphill-shortened limit, beyond-reach map, closest-first spur candidates                                                   |
| Landings and decks need flat, wide ground; a road ends in a large turnaround                                        | No drawn turnaround; the landing is implied. On 22 m terrain the ends are not measurably flatter than the blocks.                                                                                   | Landing widths in templates only                                                         | Same guide: a ranked flat-footprint screen near road ends. A turnaround template is still open.                                                                                                                      |
| Fewest stream crossings; split a block's access north and south rather than cross a big stream                      | 7 crossings, all stream order 1–2; none of order 3+. One block is a clear split-access case.                                                                                                        | Already strong: per-feature and per-class crossing prices, riparian screens              | Unchanged; spurs and skid reach respect closed stream screens, and "Streams stop skidding" is an option                                                                                                              |
| Follow the contours; switchback where needed                                                                        | On ground steeper than 10 %, median 18° off the contour, against 33° for the straight chord                                                                                                         | Already: grade limits, contour objective, switchback tools                               | Unchanged                                                                                                                                                                                                            |
| Trace unmapped existing roads from imagery ("click, click, click") and build off them                               | Two "old existing" roads are in no mapped dataset; one more road starts 273 m from any mapped road                                                                                                  | Sketching only; mapped roads used as recorded                                            | [Finding and tracing existing roads](road-relocation-and-tracing.md): trace by clicking with snapping to the road bench on LiDAR, and move a mapped road onto its bench                                              |
| Truck size decides what a switchback or junction can take                                                           | —                                                                                                                                                                                                   | Swept path on the road's own centreline, no steering lock                                | [Vehicle turning](vehicle-turning.md): steering lock, BC MoTI LG3/LG5/WB-15 dimension sets, two-unit log loads, junction turn swept paths                                                                            |
| Cable ground on steep slopes                                                                                        | —                                                                                                                                                                                                   | D-lines with an assumed sag; fixed-radius spokes                                         | [Cable mechanics and landing reach](cable-mechanics-and-reach.md): rope-and-load span, load path, tension; farthest feasible tailhold per bearing                                                                    |
| Exclude non-treed ground (alpine, avalanche chutes, severe burns) from the cut, though a road may cross it          | Not measured: the blocks carry no non-treed attribute                                                                                                                                               | Visual quality reads VRI treed area; the road tool does not                              | Open                                                                                                                                                                                                                 |

How much of the TFL 30 layout PGMaps could reproduce:

- **Before the change:** only the short access leg of about six roads. Block access stopped at the
  block edge, so it gave a median 26 m leg and none of the 12.5 km of in-block road. It also targeted
  FSRs only, while 18 of 19 junctions here are on road permits or DRA-only roads.
- **Spur candidates:** with the new spur suggestion and the default reach rule, 7 of the 12 blocks
  that fail without their own roads reach 98 % coverage, with 4.0 km of candidates against 6.2 km
  drawn. The other five stop at 47–95 %, behind unreviewed stream screens or where no route meets the
  12 % grade limit.
- **Oriented junctions:** placed a median 67 m from the drawn junction, against 87 m for the nearest
  point. The median loaded turn dropped from 88° to 47°.
- **The person designs to about 250 m, not the 350 m ceiling.** Set the reach to 250 m to imitate
  them.

## The map sheets

The eight PDFs come from one ArcGIS Pro 3.1 layout series for a single block. They contain:

- a 1:10,000 field layout;
- a 1:50,000 general access map;
- a portrait imagery sheet;
- LiDAR design slope, canopy height and hillshade sheets.

Two of them are not plain layout output. One is a byte-identical copy. Another is the slope sheet
with PDF review markup: a pencil-drawn proposed road and a commented polygon.

[Block map sheets](../forestry-block-map-sheets.md) reproduces the six layouts as presets in the
road tool (**Files → Project & exports → Block map sheet**). It keeps the reference symbology
exactly where it was read from vectors:

- seven slope classes from 20 % up, with 95 %+ as a black overlay;
- eight 5 m canopy height classes;
- the 315°/45° hillshade;
- 10 m contours with a 20 m index;
- the `#ffd37f` title and section bars.

It changes these on purpose:

- **Title text:** black, not white. White on `#ffd37f` is about 1.4:1 contrast.
- **Branding:** no company logos or names. There is one optional logo slot of the user's own, and
  "Prepared by" replaces an employee ID.
- **Projection:** maps are north-up Web Mercator with the scale stated at the frame's latitude, not
  BC Albers.
- **Road classes:** paved, gravel main, operational and spur cannot be drawn. FTEN records status,
  not surface class, so only FSR and other existing road are told apart.
- **Review markup:** drawn from the road tool's existing map notes, not from a new markup system.

## The 14 reference projects

Licences decide what could be used. PGMaps is MIT. Every GPL, LGPL or unlicensed project was used
only as a description of a method. Each method was re-implemented in TypeScript from published
papers or from the reviewers' own written descriptions. No code was translated, and no WASM build
of their code was made. Only the Apache-2.0 LANDIS-II extension was adapted, with attribution in
[`NOTICE-LANDIS.md`](../../src/pages/dev-forestry-roads/NOTICE-LANDIS.md).

| Project                           | What it is                                                                    | Licence                    | Outcome                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| forestroaddesigner                | QGIS grade-band route finder after PEGGER                                     | GPL-3                      | Ideas only. PGMaps' router already checks every metre; FRD checks long moves at their ends, so its routes can jump gullies. Its grade-change penalty and "lowest grade that connects" diagnostic are open.                              |
| ForestRoadNetworkPluginForQGIS    | Network builder that adds roads where harvest cells are beyond skidding reach | GPL-3                      | Same author's Apache LANDIS-II extension used instead                                                                                                                                                                                   |
| SylvaRoad (QGIS port)             | Route search with hairpins, platform test, chord cut/fill limit               | GPL-3                      | The port is broken (three settings read one input). Hairpins found by the search and the chord limit are open.                                                                                                                          |
| roads (LandSciTech)               | R road-network projection                                                     | Apache-2.0                 | Already ported and validated in `roads/`; same version                                                                                                                                                                                  |
| LANDIS-II Forest Roads Simulation | Landscape road-building simulation: skid reach, wood flux, road classes       | Apache-2.0                 | **Adapted:** closest-first spur building in `skidSpurs.ts`. Wood flux and road-class suggestion are open; note its flux search runs on zero road costs and needs length weights.                                                        |
| smartlog_aco                      | Ant-colony ordering of forwarder pile pickups to a given landing              | LGPL-3                     | Not used: it does not choose landings or roads                                                                                                                                                                                          |
| Sylvaccess                        | Skidder, forwarder and cable accessibility maps                               | GPL-3                      | **Method re-implemented:** along-ground reach, unknown terrain kept unknown, in `skidReach.ts`. Winching rays, forwarder side-slope rule and cable coverage are open.                                                                   |
| SEILAPLAN                         | Swiss skyline planner: span mechanics and support optimization                | GPL-2+                     | **Method re-implemented:** elastic catenary span with load path and tensions in `cableMechanics.ts`, checked against numbers from running SEILAPLAN unmodified. The intermediate-support optimizer is open.                             |
| Lima VVA                          | Norwegian road and earthwork program                                          | GPL-3                      | **Method re-implemented:** Pappus curvature correction in `curvedVolume.ts`, reported beside the average-end-area volumes                                                                                                               |
| ALSroads                          | R package that relocates and measures mapped forest roads from airborne LiDAR | GPL-3                      | **Method re-implemented** from Roussel et al. (2022), DTM-only: `roadLikeness.ts`, `roadRelocation.ts`, `roadTrace.ts`, `roadSlices.ts`. On the package's sample road the line moved from 7.3 m median / 10.9 m P90 off to 1.0 / 2.6 m. |
| QuickTurn                         | AutoCAD vehicle swept paths                                                   | GPL-2                      | **Method re-implemented:** steering lock and junction turns (`vehicleKinematics.ts`, `junctionTurn.ts`). Truck dimensions taken from the BC MoTI Supplement to TAC, not QuickTurn's data file.                                          |
| 3D-CHA                            | 3D hybrid A\* road alignment with grade state                                 | None (all rights reserved) | Ideas only, from its papers: minimum tangent and curve lengths in the corridor search, and a grade-aware cost-to-go, are open                                                                                                           |
| RFLTools                          | AutoCAD/Civil 3D alignment toolkit                                            | GPL-3                      | Mostly already in PGMaps. 3D available sight distance, least-squares curve fits of mapped roads and survey scale factors are open.                                                                                                      |
| Topografia (GeoRoad)              | Brazilian QGIS geometric road design                                          | GPL-2                      | Already covered, apart from DXF export, which is open                                                                                                                                                                                   |

## Validation summary

| Check                                                       | Result                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests on the merged branch (forestry, lib, components) | 2,773 passed, 2 skipped. One suite outside this change fails for want of generated `public/data`, as it does on `main`.        |
| `tsc -b`                                                    | Clean                                                                                                                          |
| Skid reach on TFL 30 (local only)                           | Same 12 of 17 blocks fail without their own roads as the independent measurement; ≤ 0.5 % beyond reach with all roads          |
| Haul routing on TFL 30 with DRA and FTEN loaded             | Loaded-turn direction agrees with the measurement at 20 of 21 junctions; distance 0.99–1.05× the measured route                |
| Road finding, ALSroads sample (local only)                  | Median 0.9–1.0 m, P90 2.6 m from the reference line for records off by up to 38 m; a record 150 m off finds nothing            |
| Road finding, synthetic bench                               | P90 0.3–0.5 m from 8–30 m offsets; a bench-free control reports no road                                                        |
| Skyline span against SEILAPLAN figures                      | Mid-span sag within 0.3 %; fixed-length loaded tension 0.2–0.3 % higher; load path within 0.04 m                               |
| Junction offtracking, 10 m unit on a 12 m turn              | 3.475 m; independent fine-step integration 3.4753 m                                                                            |
| BCGS 1:20,000 mapsheet                                      | 093I003 and 093G087 test cases                                                                                                 |
| Block map sheets                                            | Six presets rendered from a synthetic block and two downloaded from the app in Chromium, compared visually with the references |

## Still open

Ranked by value to the layout person, with the reviewers' effort estimates:

1. **A non-treed exclusion in the road tool** (VRI `BCLCS_LEVEL_2`, as visual quality reads it), so alpine,
   avalanche and burned ground leaves the skid-reach denominator while staying crossable. About 1–2 days.
2. **A regional DRA snapshot in `vendor/bcdatamapper`.** Most junctions in TFL 30 are on DRA-only or
   road-permit roads, and haul routing reaches the highway only when they are loaded. About 2 days plus a
   scraper.
3. **Road-end turnaround template and landing width on adopted spurs.** About 1–2 days.
4. **Switchbacks found by the corridor search** (SylvaRoad's platform, spacing and cut/fill rules), so a
   60 % face no longer reports "no line". About 6–10 days.
5. **Ruling-grade reach map** and "the gentlest connection here needs X %" in route-search failures. About 2–4
   days.
6. **Wood flux and road-class suggestion** on network-planner results, with the loaded direction fed to the
   haul-grade checks. About 2–3 days.
7. **3D available sight distance** on the burned design surface, as a Review row. About 3–5 days.
8. **Intermediate cable supports, winching rays, forwarder model and cable coverage of a block.** About 1–2
   weeks together.
9. **Block sheets:**
   - adopt them in the LiDAR tools, once the shared-layout branch lands;
   - road surface classes;
   - TSA, district and region lookups;
   - the management-area hatches;
   - a regional basemap for the 1:50,000 frame.

   The 1:50,000 sheet currently shows only the project's own context.

10. **Visual-quality items from the same conversation**, owned by the visual-quality tool, not the road tool:
    - batch input of many blocks;
    - a generated Visuals paragraph with alternative recommendations (proceed, retention in a corner,
      drop the block);
    - a one-block-at-a-time review screen that shows the pictures, the area and the draft text, then
      moves on.

Data sources the conversation pointed to, not yet used:

- **RESULTS road delineation:** in-block roads are reported to RESULTS separately for standard units
  submitted from 2026, so newer blocks will carry them.
- **FOM (since 2022):** carries planned road lines.
- **Sentinel-2:** already used for dating roads; could be a basemap for tracing.
- **The licensee's internal geodatabase catalogue:** its layer list, not its data, would show which
  internal layers exist.
