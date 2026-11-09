# In-block road layout by slope, and the roads that reach woodlot blocks

Research for PGMaps' road generator, 2026-11-09, a follow-up to section 8 of the
[research note](bc-access-research-2026-11-09.md). The scripts and outputs it names
were kept in `/tmp/pgmaps-access-research/agents/layout/` on the research machine
and are not in the repository.

## Summary

1. **No public field records how a block was yarded.** RESULTS disturbance rows
   leave the technique and method codes empty: all 502 `DN` activity rows for the
   347 pairs have null `SILV_TECHNIQUE_CODE` and `SILV_METHOD_CODE`. The
   silviculture system is a clearcut variant (`CCRES`/`CLEAR`) in 96% of the pairs
   and 90–100% of every interior slope class. Slope has to stand in for the system.
2. **Layout changes gradually with slope. It does not step at the 35–40% cable
   threshold.** On the same four interior districts, moving from under 15% to 15%
   or steeper raises in-block road from 40 to 51–58 m/ha (Integrated Roads),
   tightens the 90%-reach from 176 m to 124–152 m, and narrows the spacing between
   roads down the fall line from 181 m to 105–144 m. Between 35–45% and ≥45%,
   density, reach and spacing hardly change.
3. **Road grade on steep ground levels off at about 10%.** The in-block road's
   mean grade is 0.37 × slope on ground under 15% and 0.20 × slope at ≥45%, which
   is 4.6% and 10.0%. On the coast at ≥45% it is 11.9%.
4. **As slope rises, more of the block lies below its road**: 14% under 15% slope,
   38% at ≥45% and 43% on steep coast ground. That fits roads set high enough to
   yard uphill. But the share above the road is as large or larger in every
   class, and roads are not moved to the top edge: 8 of 40 flat blocks and 11 of
   40 blocks at ≥45% have their road mostly in the top third.
5. **FTEN road sections miss about half of the in-block road.** Integrated Roads
   (public vector tiles) carries 1.3–2.2× FTEN's in-block length and 3× or more
   of its landing stubs. Calibrate densities and stubs from Integrated Roads.
6. **Woodlot blocks do have road permits.** Section 7's "no road" woodlots
   (`W0639`, `W1848`, `W0696`) are FTEN **placeholder triangles**: 0.6 ha
   equilateral triangles drawn for unmapped blocks. All 17 placeholders among the
   81 "no road" blocks were woodlots. Of 40 mapped woodlot blocks, 37 have a road
   within 100 m. 36 have an FTEN section within 100 m, and in 35 of those the
   section belongs to a permit held by the woodlot's own client number.

## 1. Data and method

**Samples**

| Sample                | Blocks | Where, when                                                                                                                                                       | Roads used                                                                                                                                  |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairs (section 8)     | 347    | DPG, DCC, DMK, DVA (+11 DQU, 7 DOS); harvest since 2010. 279 of them are under 15% slope                                                                          | FTEN: named spur plus context roads, without roads named for blocks harvested >90 days later. Integrated Roads for a fixed random 120 pairs |
| Interior slope sample | 160    | DSE, DOS, DKA, DRM; harvest started 2012–2021; opening ≥5 ha. 40 per RESULTS slope stratum (0–15, 15–30, 30–45, ≥45%), then regrouped into the five classes below | All current FTEN sections within 1 km; Integrated Roads within 600 m                                                                        |
| Coast check           | 50     | DCK, DSI; 20 under 20% slope, 30 at ≥45%                                                                                                                          | Same as the interior sample                                                                                                                 |
| Woodlot sample        | 40     | Random draw (seed 20261109) from 3,616 FTEN cutblocks with a `W` licence and disturbance since 2010. Placeholders were skipped                                    | FTEN, DRA (`DRA_DGTL_ROAD_ATLAS_MPAR_SP`) and Integrated Roads, within 600 m                                                                |
| Section 7 re-check    | 81     | Every block with no FTEN road within 20 m in `recent2_*.json` and `expand/recent2_*.json` (1,280 blocks)                                                          | FTEN, DRA and Integrated Roads                                                                                                              |

**Slope.** Slope classes come from RESULTS `RSLT_OPENING_SVW.SLOPE`, the opening's
recorded mean slope in percent. On the pairs it correlates 0.92 with the DEM
slope. The DEM reads about 4 points high on flat ground: a 0–5% opening reads
7.4% from the DEM, a sign of noise in the DEM. From 25% up the two agree within
about 2 points on interior ground (5 points on steep coast ground). The DEM is AWS Terrarium z13 (from about 30 m source data),
sampled on a 15 m grid, with slope taken as a central difference over 30 m.

**Road sources.**

- **FTEN road sections** cover permitted roads only. Roads authorised under a
  cutting permit or tenure, and most landing stubs, are not in it.
- **CEF Integrated Roads 2025** merges FTEN, DRA, RESULTS, TRIM, oil and gas, and
  other sources. Its full download is "Access Only", but the province publishes a
  public vector tile service:
  `tiles.arcgis.com/tiles/ubm4tcTYICKBpist/arcgis/rest/services/integrated_roads_2025/VectorTileServer`,
  read here at z14. The tiles carry geometry only, with no class, no date and no
  source.
- **The DRA** has a class and surface for every road, but no date.

**Measures** (`layout_metrics.py`). A measure counts only blocks with a road
within 30 m.

| Measure                 | How it is computed                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Road length             | Clipped to the block (m/ha), to a ±60 m band around the boundary ("edge"), and to the block shrunk by 60 m ("core")                                                                                                                                                                                                                                        |
| Reach                   | Distance from a 15 m grid inside the block to the nearest road point (roads densified to 10 m)                                                                                                                                                                                                                                                             |
| Above or below the road | Each grid point's elevation against its nearest road point, ±5 m                                                                                                                                                                                                                                                                                           |
| Position                | Road within 50 m of the block, scaled 0–1 between the block's p5 and p95 elevation. Top third ≥0.67, bottom third <0.33. A block is "top", "through" or "bottom" by its median                                                                                                                                                                             |
| Fall-line transects     | Lines along the block's mean downslope direction, every 50 m across slope, extended 60 m past the boundary. For each: road crossings (merged within 30 m), the spacing between successive crossings, and the unroaded run above the first crossing and below the last, inside the block. Only for blocks of ≥8% DEM slope                                  |
| Grade                   | In-block road pieces of ≥150 m, more than 20 m inside the boundary, measured over 60 m windows. Grade ratio = mean road grade ÷ mean block slope                                                                                                                                                                                                           |
| Stubs                   | The roads within 600 m are noded, with ends snapped within 12 m, and chains between junctions are formed. A **stub** is a dead-end chain of 30–250 m whose dead end lies inside the block or within 30 m of it. Stub spacing is the network distance to the nearest other stub junction. Dead ends longer than 250 m are reported separately as spur roads |

## 2. Results by slope class

These are the interior slope sample's four districts, plus steep coast ground for
comparison (`combined_table.md`; full tables in `summary_ir.md` and
`summary_ften.md`).

|                                        | <15%          | 15–25%        | 25–35%        | 35–45%        | ≥45%          | Coast ≥45%    |
| -------------------------------------- | ------------- | ------------- | ------------- | ------------- | ------------- | ------------- |
| Blocks sampled                         | 40            | 31            | 26            | 23            | 40            | 30            |
| RESULTS slope, median                  | 8%            | 18%           | 31%           | 40%           | 50%           | 54%           |
| DEM mean slope, median                 | 11%           | 22%           | 33%           | 41%           | 50%           | 59%           |
| Area, ha                               | 22 (13–38)    | 25 (11–42)    | 20 (12–32)    | 19 (14–29)    | 20 (12–30)    | 14 (8–20)     |
| Relief p2–p98, m                       | 50 (26–60)    | 89 (68–152)   | 140 (117–191) | 189 (160–255) | 198 (171–273) | 206 (156–260) |
| Extent down the fall line, m           | 264 (221–376) | 271 (202–421) | 291 (206–398) | 281 (238–318) | 284 (222–397) | 190 (158–278) |
| Width across slope ÷ extent down slope | 2.8           | 3.1           | 2.6           | 2.1           | 2.1           | 2.9           |

Each cell: Integrated Roads / FTEN road sections; median (p25–p75).

| Measure                                                                  | <15%                                | 15–25%                              | 25–35%                                | 35–45%                                 | ≥45%                                   | Coast ≥45%                                |
| ------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------- | ------------------------------------- | -------------------------------------- | -------------------------------------- | ----------------------------------------- |
| Blocks (with a road ≤30 m: IR / FTEN)                                    | 40 / 39                             | 31 / 31                             | 26 / 26                               | 23 / 23                                | 40 / 40                                | 26 / 25                                   |
| Road in block, m/ha                                                      | 40 (14–57) / 18 (3–41)              | 52 (34–81) / 39 (21–49)             | 54 (30–68) / 42 (22–56)               | 58 (39–80) / 33 (20–48)                | 51 (34–72) / 37 (19–49)                | 68 (48–86) / 54 (20–80)                   |
| Road within ±60 m of the boundary, m/ha                                  | 56 (27–79) / 26 (15–57)             | 70 (43–93) / 43 (22–66)             | 83 (44–138) / 64 (30–100)             | 80 (60–126) / 65 (33–92)               | 65 (37–90) / 42 (24–66)                | 78 (48–104) / 61 (42–86)                  |
| Road >60 m inside the block, m/ha                                        | 11 (0–19) / 3 (0–14)                | 15 (0–27) / 8 (0–19)                | 8 (0–20) / 6 (0–16)                   | 10 (1–23) / 2 (0–8)                    | 15 (0–25) / 5 (0–17)                   | 16 (0–27) / 5 (0–23)                      |
| Share of block within 150 m of a road                                    | 84% / 64%                           | 91% / 77%                           | 89% / 84%                             | 95% / 83%                              | 91% / 84%                              | 98% / 96%                                 |
| Share within 300 m                                                       | 100% / 99%                          | 100% / 100%                         | 100% / 100%                           | 100% / 100%                            | 100% / 100%                            | 100% / 100%                               |
| Distance that 90% of the block lies within, m                            | 176 (127–228) / 239 (164–368)       | 146 (116–202) / 182 (152–266)       | 152 (94–186) / 168 (129–221)          | 124 (90–196) / 178 (131–274)           | 147 (106–175) / 176 (144–239)          | 114 (86–145) / 130 (86–223)               |
| Spacing between roads down the fall line, m                              | 181 (84–318) / 230 (99–452)         | 137 (75–218) / 188 (109–286)        | 118 (61–229) / 144 (74–252)           | 105 (60–188) / 110 (66–204)            | 144 (69–210) / 162 (87–238)            | 108 (63–163) / 106 (65–167)               |
| Fall-line transects with no road within ±60 m                            | 17% / 38%                           | 8% / 10%                            | 0% / 0%                               | 0% / 14%                               | 0% / 2%                                | 10% / 11%                                 |
| Unroaded run above the top road, m                                       | 164 (110–242) / 176 (69–239)        | 125 (24–190) / 139 (38–224)         | 140 (66–227) / 156 (108–226)          | 55 (1–134) / 137 (31–176)              | 125 (35–200) / 161 (36–218)            | 114 (72–171) / 127 (85–184)               |
| Unroaded run below the bottom road, m                                    | 100 (36–141) / 98 (40–199)          | 64 (22–130) / 70 (40–182)           | 9 (2–51) / 20 (1–72)                  | 36 (18–100) / 39 (14–146)              | 76 (14–130) / 85 (7–148)               | 83 (34–107) / 65 (29–106)                 |
| Block area below its nearest road                                        | 14% / 18%                           | 25% / 23%                           | 28% / 22%                             | 33% / 32%                              | 38% / 37%                              | 43% / 42%                                 |
| Block area above its nearest road                                        | 26% / 26%                           | 38% / 46%                           | 50% / 57%                             | 41% / 50%                              | 44% / 52%                              | 42% / 44%                                 |
| Road length (in or ≤50 m from block) in the top third of block elevation | 27% / 24%                           | 32% / 30%                           | 19% / 16%                             | 35% / 25%                              | 26% / 20%                              | 23% / 17%                                 |
| … in the bottom third                                                    | 30% / 34%                           | 44% / 46%                           | 48% / 55%                             | 39% / 38%                              | 31% / 40%                              | 41% / 42%                                 |
| In-block road grade (60 m windows, mean)                                 | 4.6% (3.3%–6.8%) / 5.2% (3.8%–6.7%) | 8.2% (6.2%–9.7%) / 7.1% (6.4%–8.7%) | 8.3% (5.6%–11.2%) / 7.9% (6.2%–11.2%) | 10.3% (8.9%–11.7%) / 9.0% (7.1%–10.9%) | 10.0% (8.1%–11.5%) / 9.4% (7.9%–10.8%) | 11.9% (10.3%–13.4%) / 11.7% (10.0%–13.6%) |
| Road grade ÷ terrain slope                                               | 0.37 (0.25–0.46) / 0.38 (0.30–0.53) | 0.33 (0.27–0.45) / 0.32 (0.24–0.40) | 0.25 (0.19–0.30) / 0.23 (0.19–0.31)   | 0.25 (0.22–0.29) / 0.23 (0.17–0.27)    | 0.20 (0.14–0.23) / 0.18 (0.14–0.23)    | 0.20 (0.18–0.26) / 0.20 (0.17–0.26)       |
| Landing stubs ≤250 m, per 10 ha (mean)                                   | 0.61 / 0.21                         | 0.66 / 0.12                         | 0.71 / 0.20                           | 0.73 / 0.05                            | 0.63 / 0.14                            | 1.31 / 0.91                               |
| Stub length, m                                                           | 95 (56–161) / 133 (88–203)          | 90 (62–129) / 102 (57–163)          | 72 (39–120) / 91 (65–160)             | 112 (46–169) / 138 (118–173)           | 106 (57–169) / 146 (75–178)            | 86 (46–162) / 82 (47–107)                 |
| Stub spacing along the network, m                                        | 338 (138–544) / 160 (119–672)       | 265 (143–422) / –                   | 353 (199–719) / 726 (355–1096)        | 264 (202–489) / 990 (990–990)          | 160 (70–456) / –                       | 328 (198–444) / 263 (233–417)             |
| Dead-end roads >250 m ending in block, length m                          | 554 (407–719) / 490 (416–714)       | 404 (306–488) / 511 (370–783)       | 374 (290–514) / 545 (318–957)         | 494 (348–712) / 682 (362–1196)         | 384 (303–680) / 878 (510–1237)         | 498 (397–732) / 524 (398–743)             |

The pairs, on FTEN roads, follow the same direction (`summary_ften.md`):

- In-block road rises from 3 m/ha (median) under 15% to 42 m/ha at 25–35%.
- The 90%-reach falls from 351 m to 164 m.
- The grade ratio falls from 0.40 to 0.23.

They are thin from 25% up (19, 6 and 1 blocks).

**Spearman correlations with RESULTS slope** (interior sample only, so region is
held constant; Integrated Roads):

| Measure                             | ρ     | p     |
| ----------------------------------- | ----- | ----- |
| In-block road grade                 | 0.54  | 2e-9  |
| Grade ratio                         | −0.48 | 1e-7  |
| Share of block below its road       | 0.46  | 9e-10 |
| Share above its road                | 0.34  | 1e-5  |
| Fall-line transects with no road    | −0.30 | 2e-4  |
| Road m/ha                           | 0.20  | 0.013 |
| Roads crossed per transect          | 0.19  | 0.016 |
| 90%-reach                           | −0.15 | 0.057 |
| Stubs per 10 ha                     | 0.02  | 0.85  |
| Median road position (top ↔ bottom) | 0.01  | 0.93  |
| Block area                          | −0.08 | 0.35  |

### What changes with slope

- **Road density and reach.** The main break is at about 15%, not 35–40%. Under
  15%, 17% of fall-line transects cross no road within ±60 m; from 25% up, none
  do.
- **Spacing between contour roads** down the fall line falls from 181 m to
  105–144 m. Its interquartile range is wide (60–230 m), because blocks hold one,
  two or three road levels.
- **Contour discipline.** The steeper the ground, the closer the road holds to the
  contour (ratio 0.37 → 0.20). In absolute terms, grade still rises to a ceiling
  near 10% on interior ground and 12% on the coast. On this DEM the p90 of the
  block means is 12–14% at 25% and steeper.
- **Timber below the road** rises from 14% to 38–43% of the block.
- **Block shape.** The extent down the fall line holds at about 265–290 m in every
  interior class. Blocks steeper than 35% are narrower across the slope: width ÷
  depth is 2.1, against 2.6–3.1 below 35%.

### What does not change with slope

- **The top/through/bottom split.** In every class, roads are "through" in 42–52%
  of blocks, and "top" stays at 12–28%. There is no switch to top-edge roads on
  cable ground. Below 35% slope, road length leans toward the bottom third
  (44–48% at 15–35%).
- **Most road length runs along the boundary.** That is 56–83 m/ha within ±60 m of
  the boundary, against 8–16 m/ha more than 60 m inside. 29–42% of blocks in each
  class have no core road at all.
- **Landing stubs.** There are 0.61–0.73 stubs per 10 ha in every interior class,
  72–112 m long (median), spaced a median 160–353 m along the network. Steep coast
  ground has twice as many (1.31 per 10 ha, spaced 328 m).
- **Dead-end spur roads ending in the block** run a median 374–554 m.

### Reading this against harvest systems

The textbook contrast — dense skid-road and landing networks on gentle ground;
few roads, at the top or bottom edge, with long cable spans on steep ground — is
not what the data show for 2012–2021 interior blocks. Steep blocks carry the same
road density as moderate ones and more than flat ones. Their fall-line spacing
(about 105–145 m) fits short-span cable systems or steep-slope ground-based
systems (tethered or excavator forwarding) better than long-span skylines. Only
the rise in timber below the road and the 10% grade ceiling look specific to
steep ground.

No public field can confirm the system. These are inferences from layout.

5 of the 30 steep coast blocks had no FTEN road within 30 m, and 4 had no
Integrated Roads line within 30 m; 3 of those had none within 300 m. Those blocks are candidates for
helicopter or long-span yarding.

Contact sheets show it: `steep.png` (interior ≥45%), `flat.png` (interior <15%)
and `coast_steep.png`. Red is FTEN, blue is Integrated Roads, grey is 10 m
contours. They show contour-parallel roads on steep blocks, often two levels about
150 m apart (`DSE TA0128 1`). On flat blocks, Integrated Roads holds in-block
roads that FTEN lacks (`DSE A83742 1`, `DRM A88453 1`).

## 3. Roads that reach woodlot and other "no road" blocks

### FTEN placeholder blocks

FTEN stores an unmapped block as a 0.6 ha equilateral triangle: area 5,500–6,500
m², isoperimetric ratio 0.605, often only 3 corners. Of the first 61 woodlot blocks
drawn, 21 (34%) were placeholders. In the section 7 re-check, 17 of the 81 "no FTEN
road within 20 m" blocks were placeholders, all of them woodlots. That includes
all three woodlots the note names (`W0639`, `W1848`, `W0696`). **A placeholder has
no location to route to; the tool must detect it and say so.**

### 40 mapped woodlot blocks (harvest started 2010–2023)

The blocks are a median 4.5 ha (p25 2.3, p75 17.7) and come from 16 districts.

| Road within…                 | FTEN | DRA | Integrated Roads | Any |
| ---------------------------- | ---- | --- | ---------------- | --- |
| Touching or inside the block | 27   | 26  | 32               | 32  |
| 30 m                         | 34   | 30  | 36               | 36  |
| 100 m                        | 36   | 30  | 37               | 37  |

- **FTEN types within 100 m:** Road Permit in 36 blocks, Forest Service Road in 5.
  In **35 of the 36**, a section within 100 m is on a permit held by the woodlot's
  own client number. Woodlot licensees hold ordinary road permits (for example,
  the only section beside `W1454` is on `R09826`, held by the woodlot's client).
- **DRA classes within 100 m**, counted by block: resource 23, unclassified 16,
  trail 6, local 2, and skid, service, collector and driveway 1 each. Surfaces are
  rough 24, loose 16, unknown 7, overgrown 5, seasonal 2, paved 1. 7 blocks have
  only unclassified or trail roads within 100 m.
- **In-block road, 19 blocks of 5 ha or more:**
  - Blocks with any road inside: FTEN 12, DRA 14, Integrated Roads 17.
  - Median density: 15.9, 18.2 and 33.2 m/ha.
  - Across all 40 blocks, Integrated Roads holds 23.7 km inside blocks, against
    14.0 km for DRA and 9.1 km for FTEN. 6.9 km of the Integrated Roads length (17
    blocks) lies more than 15 m from any DRA line.
- **Only one block is reached by DRA or Integrated Roads and not FTEN:** `W0274`,
  where FTEN is 398 m away and a DRA resource road touches the block.
- **Three blocks have no road within 100 m in any source:**
  - `W1408` (DQU, 2.3 ha): 259 m.
  - `W0635` (DVA, 4.8 ha): 144 m.
  - `W1554` (DPG, 0.7 ha): about 180 m.

### Section 7's 64 mapped "no road" blocks

Of these, 42 have a DRA road within 100 m and 52 have an Integrated Roads line
within 100 m. 19 have an FTEN road at 20–100 m. 12 have nothing within 100 m in
any source. They are small (0.2–15 ha) blocks on A-licences (`A20019`, `A92282`,
`A93922`, `A94828`, `A95090`, `A96622`, `A96641`), plus `N2K`, `L49404`, `W0548`
and `W1554`.

## 4. Layout rules for a generator

Densities and stubs are calibrated on Integrated Roads, which is closer to what is
on the ground than FTEN. Slope is the block's mean slope; use RESULTS `SLOPE` when
the block has an opening. On a 30 m DEM, subtract about 4 points under 15%.

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Use two ground classes, broken at 15%, not at 35–40%.** Add a coast-steep variant if the block is coastal.                                                                                                                                                                                                                                                           | Density, reach, spacing and grade ratio move between <15% and 15–25%, then stay level to ≥45%. In-block m/ha by class: 40 / 52 / 54 / 58 / 51.                                                                                                          |
| R2  | **In-block road density targets:** flat (<15%) 40 m/ha, acceptable 15–55. Sloped (≥15%) 55 m/ha, acceptable 35–80. Coast ≥45%: 70 m/ha, acceptable 50–85.                                                                                                                                                                                                              | Interior medians (IQR) 40 (14–57) and 51–58 (30–81); coast 68 (48–86). At an assumed 8–10 m disturbed width, 55 m/ha is 4.4–5.5% of the block, under the 7% `MAX_ALLOW_PERMNT_ACCESS_PCT` that 275 of 347 pairs and 109 of 210 sample openings carry.   |
| R3  | **Reach target:** 90% of the block within 175 m on flat ground and 150 m on sloped ground (115 m on the coast). Nothing beyond 300 m.                                                                                                                                                                                                                                  | The 90%-reach medians are 176, 124–152 and 114 m. The share within 300 m is 100% in every class (FTEN 99% flat).                                                                                                                                        |
| R4  | **Hold contours.** Target in-block mean grade = min(k × slope, cap), where k = 0.37 under 15%, 0.33 at 15–25%, 0.25 at 25–45% and 0.20 at ≥45%. The cap is 10% interior and 12% coast, judged on a 30 m DEM over 60 m windows. Accept a ratio in the class's IQR (for example 0.19–0.30 at 25–35%).                                                                    | The grade-ratio and grade rows of the table. ρ = −0.48 and +0.54 against slope. The earlier pooled figure (0.39) is the flat-ground value.                                                                                                              |
| R5  | **Space contour roads down the fall line:** about 180 m apart on flat ground and 120–145 m on sloped ground (105–110 m on 35–45% and on the coast). Add a second level whenever the block runs deeper than about 300 m down the fall line.                                                                                                                             | Fall-line spacing medians 181 / 137 / 118 / 105 / 144 m, coast 108 m. The block extent down the fall line is 265–290 m. Blocks with one road level leave 125–165 m above it.                                                                            |
| R6  | **Place the top road no more than 125–165 m below the upper boundary, and the bottom road within 10–100 m of the lower boundary.** Prefer a road along or just outside the lower or side boundary, plus a contour road through the block, over a single road on the top edge. "Top" layouts are a minority (12–28%) in every class.                                    | Unroaded run above the top road 125–164 m (35–45%: 55 m); below the bottom road 9–100 m. Road position: through 42–52%, bottom 22–46%, top 12–28%. Road length leans to the bottom third (30–48%) over the top third (19–35%).                          |
| R7  | **On ground of 35% or more, put roads so 30–45% of the block lies below its nearest road** (uphill yarding to the road), against about 15% on flat ground.                                                                                                                                                                                                             | The share below the road is 14 / 25 / 28 / 33 / 38%, coast 43%; ρ = 0.46.                                                                                                                                                                               |
| R8  | **Run most road along the boundary.** About 80–90% of road length near a block should lie within ±60 m of its boundary. A core road (more than 60 m inside) appears in only 58–71% of blocks; add one when R3 or R5 needs it.                                                                                                                                          | Edge 56–83 m/ha against core 8–16 m/ha. Blocks with no core road: 13/40, 9/31, 11/26, 8/23, 15/40.                                                                                                                                                      |
| R9  | **Landing stubs:** 0.65 per 10 ha (round up to at least 1 per block over 10 ha), 1.3 per 10 ha on the coast. Each is 70–110 m long (cap 170 m), leaving a road at a junction and ending inside the block. Space them about 250–350 m apart along the host road, and never closer than 140 m.                                                                           | Interior 0.61–0.73 per 10 ha in every class; length medians 72–112 m (IQR 39–169); spacing medians 160–353 m (p25 70–202). FTEN carries only 0.05–0.21 per 10 ha, so do not calibrate stubs from FTEN.                                                  |
| R10 | **A dead-end spur into the block runs 375–555 m.** Stop it where R3 is met, not at the far boundary.                                                                                                                                                                                                                                                                   | Integrated Roads dead ends over 250 m: medians 374–554 m. Section 8: a dead-end road reaches a median 40% of the way to the block's deepest point.                                                                                                      |
| R11 | **Detect placeholder blocks** (0.55–0.65 ha, isoperimetric ratio 0.60–0.61, a triangle) and refuse to generate a road for them.                                                                                                                                                                                                                                        | 34% of drawn woodlot blocks; 17 of 81 section 7 "no road" blocks.                                                                                                                                                                                       |
| R12 | **For woodlot and small-licence blocks, look for access in this order:** (a) an FTEN section on a permit held by the block's own client number; (b) a DRA `resource` or `unclassified` road; (c) an Integrated Roads line. Treat DRA `trail` or `skid` roads as candidate roads, not proven ones. Without a road within 100 m, draw a new leg using section 8's rules. | 35 of 36 woodlot blocks with FTEN nearby have the woodlot's own permit. DRA or Integrated Roads adds only 1 of 40 that FTEN misses. 3 of 40 have nothing within 100 m. Of section 7's 64 mapped no-road blocks, DRA reaches 42 and Integrated Roads 52. |

## 5. Limits

- **Harvest system is inferred, not observed.** No public field holds it (see the
  summary). Classes mix ground-based, tethered and cable blocks in unknown
  proportions.
- **Road dates are missing.** In the slope sample, "all FTEN roads" and every
  Integrated Roads line include roads built after the block, and Integrated Roads
  may include in-block trails or skid roads drawn from imagery. This inflates
  density and reach somewhat. Only the pairs' FTEN set drops roads built later.
- **Integrated Roads tiles have no attributes,** so its stubs cannot be checked
  against road class. Duplicate lines more than 12–30 m apart can create false
  stubs or close fall-line crossings. The p25 spacing of about 60 m is partly this
  and partly switchbacks.
- **The DEM is about 30 m, smoothed.** Grades are means over 60 m windows, so
  design pitches are steeper. Compare between classes, not with design limits.
  Slope under 15% reads about 4 points high.
- **Fall-line transects use one mean downslope direction per block,** which is
  crude on convex, concave or multi-aspect blocks.
- **The slope sample comes from four interior districts and two coastal ones.**
  The plateau districts (pairs) have almost no ground over 35%: 7 blocks.
- **The woodlot sample is skewed to 2010–2012** (22 of 40 blocks), following the
  random draw.

## 6. Scripts and outputs

All in `/tmp/pgmaps-access-research/agents/layout/`. Run scripts with `python3 -I`
unless marked `venv/bin/python -I`; the venv, in this folder, adds
mapbox-vector-tile.

| File                                            | What                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `wfs.py`, `dem.py`                              | Copied from the repo scripts. `dem.py` reads the shared Terrarium cache and writes new tiles to `terrarium/` here        |
| `fetch_results.py`                              | RESULTS opening and activity rows for the pairs → `results_openings.json`, `results_dn.json` (the harvest-method search) |
| `build_strata.py`                               | Slope-stratified sample → `strata/<OPENING_ID>.json`, `strata_index.json`                                                |
| `ir.py`, `fetch_ir.py` (venv)                   | Integrated Roads vector tiles → `irtiles/`, `ir_lines/{strata,pairs}_<id>.json`                                          |
| `layout_metrics.py`, `run_layout.py`            | Measures → `layout_pairs.json`, `layout_strata.json` (FTEN), `layout_pairs_ir.json`, `layout_strata_ir.json`             |
| `summarize_layout.py`, `combined_table.py`      | Tables → `summary_ften.md`, `summary_ir.md` (run with the `_ir` argument), `combined_table.md`                           |
| `plot_layout.py`                                | Contact sheets `steep.png`, `flat.png`, `coast_steep.png`                                                                |
| `woodlot_roads.py` (venv)                       | Woodlot sample → `woodlot/<OBJECTID>.json`, `woodlot_roads.json`                                                         |
| `check_noroad_blocks.py`, `noroad_ir.py` (venv) | Section 7 re-check → `noroad_recheck.json`, `noroad_ir.json`                                                             |

The sample seed is 20261109. Live services change, so reruns can differ slightly.
