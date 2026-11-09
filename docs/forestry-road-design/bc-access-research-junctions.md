# Where a block's access road joins the network: the 32 unexplained cases, and DEM resolution

Research run 2026-11-08/09, a follow-up to section 8 of the [research note](bc-access-research-2026-11-09.md).
The scripts and outputs it names were kept in `/tmp/pgmaps-access-research/agents/junctions/` on the
research machine and are not in the repository.

## Questions

1. For the access legs that joined the network somewhere other than its nearest point, and that the four
   earlier reasons (steep straight link, shorter haul to an FSR, nearest road a smaller separate network,
   nearest road retired) do not explain: what else distinguishes the joined point from the nearest point?
   Factors tested: wetlands, lakes and rivers, stream order, private land, ALR, terrain stability, the
   nearest road's age and status. Each factor is also counted on the 40 legs that did join the nearest point,
   as a control.
2. Does a finer DEM change the grade finding?
3. Is there anything else that predicts the junction?

## Groups

`classify.py` recomputes the groups the same way as `network_choice.py` and `haul_direction.py`, but keys
every case by block `OBJECTID`:

| Group | Meaning                                                                     | Cases |
| ----- | --------------------------------------------------------------------------- | ----- |
| N     | Nearest existing road is away from the block; leg joined within 150 m of it | 40    |
| X     | Joined elsewhere, explained by one of the four earlier reasons              | 82    |
| U     | Joined elsewhere, unexplained                                               | 32    |

Two things differ from the research note. The final counts (82 explained, 32 unexplained) match it, but
the membership may differ a little:

- **`haul_direction.py` matches cases by block name**, and names such as `2`, `003` and `13` repeat across
  licences. Its "34 of 60 measurable" therefore includes pairs outside the 114. Keyed by OBJECTID, the result
  is **29 of 53** measurable same-network cases where the joined point is more than 100 m closer to the FSR.
- **"Smaller separate network" had no matching criterion in the scripts.** `network_choice.py` prints a
  rule (under 1 km and not leaving the window) that catches only 10 cases. This run used: a separate network,
  smaller than the joined one within the 3 km window, and not leaving the window. That catches 16 cases and
  reproduces 82 and 32.

`network_choice.py` and `haul_direction.py` take the "nearest road" from every road outside the block,
including roads named for blocks harvested later. `analyze_pairs.py` excludes those roads when it measures
`alt_grade_max`. This run follows the network scripts. Factor B below measures the effect of that mismatch.

## Method

- **Lines.** The _straight link_ runs from the block's nearest boundary point to the nearest road point. The
  _built leg_ is the named spur outside the block that holds the junction (`geom.py`).
- **Public layers.** `fetch_layers.py` queried 1,232 bounding boxes on BC's WFS, with no errors (raw responses
  in `wfs_cache/`):
  - `FWA_WETLANDS_POLY`, `FWA_LAKES_POLY`, `FWA_RIVERS_POLY`, `FWA_MANMADE_WATERBODIES_POLY`
  - `FWA_STREAM_NETWORKS_SP` (`STREAM_ORDER`)
  - `PMBC_PARCEL_FABRIC_POLY_SVW` (`OWNER_TYPE`; its geometry column is `SHAPE`)
  - `OATS_ALR_POLYS`
  - `STE_TER_STABILITY_POLYS_SVW` (terrain stability mapping, `SLOPE_STABILITY_CLASS_W_ROADS`)
- **Road attributes** come from the cached pairs:
  - status, award date, and whether the nearest road names a later block
  - licensee (`CLIENT_NUMBER`) and permit
  - nearby blocks and their harvest dates
- **Scripts.** `analyze_factors.py` and `extra_patterns.py` measure each factor. `tally.py` combines them and
  compares U with N using a two-sided Fisher exact test.
- **DEMs:**
  - **Terrarium z13**: as in the note.
  - **NRCan MRDEM-30** COG: all 154 cases.
  - **NRCan HRDEM LiDAR** COGs (datacube STAC, no key): the STAC footprints matched 131 cases, but only 18
    had data under the lines.
  - **LidarBC 1 m bare-earth DEM tiles**: public object store, found through the public ArcGIS index
    `LiDAR_BC_S3_Public` layers 5 and 6. Tiles covered 108 cases; 67 straight links and 69 legs were
    measurable. The tiles are untiled ~600 MB strip GeoTIFFs, so each profile point is a 3×3 m mean read
    directly from the tile (`lidarbc_compare.py`).
  - **Overlap check.** On case 1053623, LidarBC and HRDEM agree at 11.4% and 11.3%.
  - **Grade measure.** The same maximum 100 m window grade as `analyze_pairs.py`, with points every 20 m. It
    was repeated with 40 m windows and points every 10 m.

## Results: question 1, what else separates the joined point

### Single factors (counts of cases; "link" = straight link to the nearest point)

| Factor                                                            | U (32) | X (82) | N (40) |
| ----------------------------------------------------------------- | ------ | ------ | ------ |
| Link crosses an FWA wetland                                       | 3      | 8      | 0      |
| Built leg crosses an FWA wetland                                  | 0      | 0      | 0      |
| Link crosses a lake, river or reservoir polygon                   | 1      | 2      | 0      |
| Link crosses any FWA stream                                       | 12     | 33     | 6      |
| Built leg crosses any FWA stream                                  | 13     | 33     | 5      |
| Link crosses a stream of order 3 or more                          | 5      | 7      | 2      |
| Built leg crosses a stream of order 3 or more                     | 2      | 7      | 2      |
| Link or leg crosses private land; nearest point within 50 m of it | 0      | 0      | 0      |
| Link crosses ALR                                                  | 4      | 5      | 2      |
| Link inside terrain-stability mapping at all                      | 2      | 3      | 1      |
| Nearest road names a block harvested after this one               | 6      | 13     | 3      |
| Nearest road's permit awarded after this block's harvest start    | 3      | 4      | 1      |
| Nearest road retired                                              | 0      | 13     | 6      |
| Nearest road is the block licensee's                              | 18     | 55     | 25     |
| Joined road is the block licensee's                               | 25     | 46     | 25     |
| Nearest point is the end of a road (stub)                         | 8      | 30     | 16     |

Each factor was also compared within the case, link against leg ("the link has it, the built leg avoids it"):

- **Wetlands:** U 3 avoid, 0 the reverse; X 8 avoid, 0 the reverse.
- **Order-3+ streams:** U 5 avoid, 2 the reverse.
- **Any stream:** U 5 and 6, X 15 and 15. Small streams are not avoided.
- **ALR:** 0 avoid, 0 the reverse.

### Candidate explanations, with the same rule applied to the controls

| Candidate                                                                                           | U (32) | X (82) | N (40) | p (U vs N) |
| --------------------------------------------------------------------------------------------------- | ------ | ------ | ------ | ---------- |
| A. Development road: named road runs ≥150 m past the block, or on to a block cut that year or later | 16     | 32     | 8      | 0.011      |
| B. Nearest road names a block cut later (probably not yet built)                                    | 6      | 13     | 3      | 0.17       |
| C. Link crosses a wetland, lake or river polygon, or an order-3+ stream that the leg avoids         | 6      | 10     | 0      | 0.006      |
| D. Nearest road is another licensee's permit road; joined road is the licensee's own or an FSR      | 7      | 4      | 1      | 0.019      |
| E. Link over 12% on LidarBC 1 m (100 m window)                                                      | 3      | 17     | 2      | 0.65       |
| F. Named road joins the network at 2 or more points                                                 | 8      | 5      | 1      | 0.008      |

- **Coverage of A–E:** at least one fits **24 of 32** U cases, but also 11 of 40 N cases.
- **Without A:** B–E fit 19 of 32 U cases and 5 of 40 N cases.
- **With F:** A–F fit 25 of 32.
- **Still unexplained (7):** `011`, `HAT041`, `CA467B`, `OOT069`, `LUC214`, `HFS043`, `C4224`. Their
  OBJECTIDs are in `tally.txt`.
- **Multiple comparisons:** about 25 factors were tested on small groups, so treat p ≈ 0.01–0.02 as
  suggestive, not proof.

What the contact sheet (`sheet_U.png`) shows:

- **The named road is often a development road, not an access leg.** In about half the U cases the road named
  for the block runs on through it, or past it, to blocks cut the same year or later (A), sometimes joining
  the network at both ends (F). Its junction was set by the whole development, so this block's nearest road
  says little about it. Only 1 of the 8 two-connection U cases had its other connection within 150 m of the
  nearest point, so F is mostly real rather than a junction-picking artefact.
- **Wetlands and larger streams are avoided.** No built leg in any group crosses an FWA wetland, while the
  straight link would have in 11 joined-elsewhere cases. The legs cross small streams as freely as the links
  (0.76 against 0.50 crossings on average in the note), but they avoid order-3+ streams more often than not
  (5 against 2 in U).
- **Licensees join their own roads.** In 7 U cases the nearest road was another licensee's permit road, and
  the leg joined the block licensee's own road or an FSR instead. The control shows this only once in 40.
- **Some "nearest roads" were not there yet** (B): 6 U cases. This is an artefact of the network scripts
  counting later roads (see Groups). It is not a design choice.

## Results: question 2, does DEM resolution change the grade finding?

| Measure, 100 m window (cases with LidarBC on the line) | Terrarium z13 | LidarBC 1 m | LidarBC − Terrarium p25/p50/p75 | Correlation |
| ------------------------------------------------------ | ------------- | ----------- | ------------------------------- | ----------- |
| Straight link max grade, median (n = 67)               | 7.1%          | 7.3%        | −1.3 / +0.3 / +2.3              | 0.91        |
| Built leg max grade, median (n = 69)                   | 7.6%          | 5.7%        | −2.0 / −0.7 / +0.7              | 0.82        |

| Link over threshold (n = 52 joined elsewhere / 16 U / 15 N) | Terrarium elsewhere / U / N | LidarBC elsewhere / U / N |
| ----------------------------------------------------------- | --------------------------- | ------------------------- |
| > 10%                                                       | 40% / 12% / 13%             | 42% / 25% / 33%           |
| > 12%                                                       | 37% / 6% / 7%               | 38% / 19% / 13%           |
| > 15%                                                       | 23% / 6% / 0%               | 27% / 6% / 7%             |

- **At 100 m windows, the finer DEM barely changes the result.** Straight-link grades move by a median of
  +0.3 points. Built legs read about 0.7 points flatter, because LiDAR sees the graded road surface.
- **The 12% split holds but does not sharpen.** The best single threshold separating joined-elsewhere from
  nearest-point cases is 11% on Terrarium (balanced accuracy 0.66) and 14% on LidarBC (0.63).
- **LiDAR adds little among the unexplained.** It lifts 3 of 16 measurable U cases over 12% (`WAR038`,
  `MUS035`, `2`/602033). It also lifts the control: 2 of 15 N cases are over 12% on LiDAR.
- **40 m windows** (`lidarbc_w40_summary.txt`):
  - LiDAR shows the short pitches Terrarium smooths away. The median straight-link maximum is 13.5% on
    LiDAR against 11.0% on Terrarium (p90 31% against 28%).
  - Built legs read flatter on LiDAR: a median of 9.2% against 10.6%.
  - Over 12%, both groups rise together: joined-elsewhere 30 of 52, against 26, and nearest-point 7 of 15,
    against 3. So shorter windows add noise to the separation rather than signal.
- **On LiDAR the built legs are moderate:** a median maximum 100 m grade of 6.6%, p90 12.0%. Only 3 of 58
  legs exceed 15%.
- **The other DEMs add nothing.** MRDEM-30 behaves like Terrarium: over 12%, 37 of 99 joined-elsewhere cases
  and 7 of 31 nearest-point cases, against 44 of 99 and 8 of 31 on Terrarium. HRDEM data reached only 18
  cases, too few to use alone; where present it agrees with LidarBC.

## What this means for a road-generation rule

1. **Never route a new leg through an FWA wetland.** Treat wetlands as a near-hard constraint: 0 of 154 built
   legs crossed one, against 11 straight links. Also treat lake and river polygons as hard constraints.
2. **Penalise crossings of order-3+ streams, not small streams.** Small-stream crossings showed no avoidance,
   so a flat per-crossing penalty would mislead the search.
3. **Prefer junctions on the block licensee's own permit roads or FSRs** over another licensee's permit road,
   unless the alternative is much longer. This needs `CLIENT_NUMBER` on road sections, which the FTEN sections
   already carry.
4. **Use only roads that existed at harvest as junctions.** Drop roads named for later blocks, and roads
   whose permit was awarded after the harvest start.
5. **Ask whether the road continues.** When blocks lie beyond, or the plan includes neighbours cut that year
   or later, draw one development road through them and pick the junction for the whole set. Do not draw a
   per-block leg to the nearest point. This is the largest single pattern in the unexplained cases.
6. **Keep the grade test on a regional DEM with 100 m windows and an 11–14% threshold.** A 1 m DEM does not
   improve the junction choice. It does matter for checking a drawn road's short pitches, where 40 m windows
   on LiDAR read about 2.5 points steeper than Terrarium on straight ground.
7. **Private land, ALR and terrain-stability mapping had no measurable effect here**, but that is because
   the samples barely touch them (see Limits). Do not conclude they never matter.

## Limits

- **Small, multiply tested sample.** U has 32 cases and N has 40, and about 25 factors were tested. Single
  counts of 3–7 are anecdotes. The p-values are uncorrected.
- **Private land:** no case touched a private parcel. The parcel fabric near these Crown-forest blocks is
  almost all "Untitled Provincial", so the effect of private land could not be tested.
- **ALR** appears in 11 cases, but links and legs cross it together, so no effect is visible.
- **Terrain stability:** TSM polygons cover only 6 of 154 links. Landslide hazard could not be tested. No
  public province-wide landslide-susceptibility layer was found on the WFS.
- **Road age** is a proxy (the blocks the road's name cites, and the award date). An unnamed road's
  construction date remains unknown, and section-level retirement dates were not used.
- **Development roads:** "named road continues past the block" depends on the licensee naming the whole road
  after this block. Where it names a neighbour, the case counts as a plain leg.
- **DEMs.** All LiDAR used here was flown in 2019–2025, after most of these roads were built, so built legs
  read the road surface and straight links read bare ground. NRCan HRDEM's STAC footprints overstate its
  coverage: 131 STAC hits gave only 18 usable cases. BC's TRIM 25 m DEM was not tried, because MRDEM-30 and
  LidarBC already bracket it.
- **Line geometry:** FTEN geometry is the permitted line. Offsets of a few metres move the absolute grade
  little at 100 m windows, but they do affect 40 m windows on LiDAR.

## Files (all in `/tmp/pgmaps-access-research/agents/junctions/`)

| File                                                                                                            | What                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `classify.py` → `cases.json`                                                                                    | Groups N/X/U and the four earlier reasons, keyed by OBJECTID                         |
| `geom.py`                                                                                                       | Straight link and built leg per case                                                 |
| `fetch_layers.py` → `wfs_cache/`, `geoms.json`                                                                  | BC WFS layers per case                                                               |
| `analyze_factors.py` → `factors.json`, `factors.txt`                                                            | Question 1 factor tables and paired counts                                           |
| `extra_patterns.py` → `extra_patterns.json`, `extra_patterns.txt`                                               | Development road, connections, distance bands, districts                             |
| `tally.py` → `tally.txt`                                                                                        | Candidate explanations A–F with controls and Fisher p                                |
| `unexplained_32.csv`                                                                                            | One row per U case with every factor                                                 |
| `plot_unexplained.py` → `sheet_U.png`                                                                           | Contact sheet of the 32 (wetlands cyan, streams blue, other licensee's roads orange) |
| `hrdem_coverage.py`, `dem_compare.py` → `dem_compare_4m.json`, `dem_summary.py` → `dem_summary.txt`             | Terrarium against MRDEM-30 against NRCan HRDEM                                       |
| `lidarbc_coverage.py`, `lidarbc_compare.py` → `lidarbc_compare.json` (100 m), `lidarbc_compare_w40.json` (40 m) | LidarBC 1 m sampling                                                                 |
| `lidarbc_summary.py` → `lidarbc_summary.txt`, `lidarbc_w40_summary.txt`                                         | Question 2 tables                                                                    |

Run the Python with `python3 -I`, except the scripts that read rasters (`dem_compare.py` and
`lidarbc_compare.py`), which need `/tmp/pgmaps-research/venv/bin/python -I`.
