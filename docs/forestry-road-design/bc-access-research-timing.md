# When do block spurs appear? Sentinel-2 dating of 146 BC block–road pairs

Research note for PGMaps, 2026-11-09, a follow-up to sections 7–8 of the [research note](bc-access-research-2026-11-09.md). It was run from `/tmp/pgmaps-access-research/agents/timing/` on the research machine. In the repository, the scripts are in `scripts/forestry/access-research/timing/`, the per-pair results are `examples/forestry/access-history/reference-pairs/road-first-seen.csv` (and each block's `first_seen` in the reference set), and two of the images below are kept there as `first-seen-example.jpg` (block 277) and `first-seen-series.png`. The other files named below stayed on the research machine.

## Summary

- **Pairs:** all 146 cached block–road pairs whose recorded harvest started in 2019 or later. The road is the FTEN section named for the block.
- **Dated:** 96 (66%). The rest: 20 undatable (14%), 19 too short to measure (13%), 8 already cleared before the series began (5%), 3 excluded because a wildfire crossed the corridor (2%).
- **The corridor appears with the harvest, not ahead of it.** Lead is first scene showing the corridor minus recorded harvest start. Among the 96 dated pairs:
  - median +22 days; quartiles −9 and +102 days.
  - **47%** (45) were still absent in a clear scene within two weeks of the recorded start, or later.
  - **25%** (24) have a bracket that spans the start, almost all over a winter snow gap (20 of 24 harvests started November to March).
  - **20%** (19) were visible up to 6 months before the start.
  - **8%** (8) were visible more than 6 months before the start; none more than a year before.
- **The imagery's own block clearing tells the same story.** Against the block interior's clearing in the same scenes, the corridor appeared:
  - in the same bracket in 52 pairs;
  - up to 6 months earlier in 25;
  - more than 6 months earlier in 8;
  - later in 4;
  - 7 had no clean block step.
- **Bracket width is set by snow, not by revisit.**
  - Median 28 days. 49 of 96 are 30 days or less, and 14 exceed 180 days.
  - Brackets whose first scene showing the corridor falls in spring have a median width of 110 days, against 12–28 days in other seasons.
- **No group difference beyond chance.** The share of roads visible more than 14 days before the recorded start does not differ by district, licensee, spur length, FSR junction or harvest season (all Fisher p ≥ 0.18). The one pattern is seasonal:
  - roads that do come ahead of a November–March harvest mostly appear between June and November of the year before (7 of 12);
  - the last clear scene without the corridor falls in September or October in 11 of 23 early roads.
- **The recorded start date is not the felling date for every block.** In 13 dated pairs the block interior was still uncut in a clear scene more than 60 days after the recorded start. In 8 of them the corridor was absent too: W1613 was still uncut 6 months after its record, and PHI111 for 9 months. One "well ahead" case runs the other way: PUR014 was cleared in January 2024, but its record says 2025-01-02.

## Method

### Data

`pairs_2019.txt` lists the 146 pairs from `pairs/*.json` and `expand/pairs/*.json` with `DISTURBANCE_START_DATE` ≥ 2019-01-01. Duplicates by OBJECTID are dropped.

| District          | Pairs | Dated |
| ----------------- | ----- | ----- |
| Cariboo-Chilcotin | 47    | 28    |
| Prince George     | 40    | 30    |
| Mackenzie         | 29    | 21    |
| Vanderhoof        | 23    | 13    |
| Okanagan Shuswap  | 5     | 3     |
| Quesnel           | 2     | 1     |

The cached geometry is used; no WFS calls are made for blocks or roads.

### What is measured (`fetch_series.py`)

**Measured road part.** The first rule that leaves enough road applies:

1. **outside** — the spur beyond 60 m of the block, within 1.5 km of it. Used if at least 100 m.
2. **inside** — the spur more than 20 m inside the block. Used if at least 100 m.
3. **edge** — the spur outside the bare block edge, plus 15 m. Used if at least 50 m.
4. **whole** — the whole spur.

**Exclusions from the measured part:**

- Remove anything within 60 m of other, non-spur FTEN roads.
- Remove neighbour blocks harvested before the series ends.
- Each removal applies only if it leaves at least min(100 m, half the length). Otherwise the pair is tagged `+nearother` / `+inneighbour`.

**Geometries per scene** (mean NDVI):

| Name    | Area                                                         |
| ------- | ------------------------------------------------------------ |
| `road`  | 10 m buffer of the measured part                             |
| `ring`  | 40–80 m from it (minus the block for outside parts)          |
| `blk`   | Block interior (−20 m, minus 30 m around roads)              |
| `oring` | 40–150 m outside the block, minus neighbour blocks and roads |

**Scenes.**

- Source: Sentinel-2 L2A from Element 84 Earth Search, `eo:cloud_cover` under 60%.
- Window: harvest start −2 years to +1 year, clipped to 2017-01-01 to 2026-11-01.
- One tile per date. A tile is skipped for that date if the road or ring has under 80% data in it, which fixed roads lying in a tile's no-data margin.
- A geometry is read only if at least 80% of its pixels are SCL 4–7. SCL is read first, and red and NIR are skipped when nothing is clear.
- Usable scenes per pair: median 135, minimum 49.
- About 1 minute per pair at 4 threads. The full run took about 1.5 hours over 6 concurrent pairs.

**Contrasts:**

- Corridor contrast `c = NDVI(ring) − NDVI(road)`.
- Block contrast `k = NDVI(oring) − NDVI(blk)`.

### Step rule (`detect.py`), threshold T = 0.10

**Scenes dropped:**

- more than 25% SCL snow on the road or ring;
- road-buffer median red reflectance above 3000 (snow or haze that SCL called clear).

**A step is the first usable scene _i_ where all of these hold:**

1. `c ≥ T` in scene _i_ and in the next usable scene (two consecutive).
2. The median of `c` over scenes _i_ to _i_+7 is ≥ T (persistence). For an in-block road, a scene also counts when the block itself reads cleared (`k ≥ T`), because harvesting the ring erases the corridor contrast.
3. **Summer confirmation:** the median of the first four May–October scenes from _i_ on is ≥ T. Hazy scenes are skipped here; a scene is hazy only when both `ring` and `oring` are below 0.7 × their 75th percentiles. Without this check, winter snow lying in an open young stand read as a corridor (HAT617, below).

**Bracket and classes:**

- The bracket is [last usable scene before *i*, scene *i*].
- If the first two usable scenes already pass: `cleared_before_series`.
- Baseline flags:
  - `short_baseline`: fewer than 4 scenes, or under 90 days, before the step. Classed `open_near_series_start`.
  - `noisy_baseline`: the baseline's 80th percentile ≥ T or its median > T/2, unless the step lifts the median by 0.15 or more.

**Why T = 0.10:**

- Across the 3,641 pre-step scenes of the dated pairs, contrast has a median of 0.003, a 95th percentile of 0.083 and a 99th of 0.150.
- 3.1% of baseline scenes reach 0.10, so two consecutive by chance is about 0.1%.
- The first eight scenes after a step have a median of 0.248 (10th percentile 0.115).
- The original note's two cases sat between −0.04 and +0.06 before the step and +0.2 to +0.46 after it.

Sensitivity:

| T    | Dated | Undatable | Open before series | Median lead (d) | Median bracket (d) | >6 mo ahead | ≤6 mo ahead | At harvest | Spans start |
| ---- | ----- | --------- | ------------------ | --------------- | ------------------ | ----------- | ----------- | ---------- | ----------- |
| 0.08 | 92    | 20        | 12                 | +20             | 27                 | 9           | 18          | 43         | 22          |
| 0.10 | 96    | 20        | 8                  | +22             | 28                 | 8           | 19          | 45         | 24          |
| 0.12 | 97    | 20        | 8                  | +26             | 20                 | 9           | 18          | 50         | 20          |
| 0.15 | 91    | 28        | 6                  | +27             | 17                 | 9           | 14          | 51         | 17          |

The conclusions do not move between 0.08 and 0.15.

### Final classes (`analyze.py`)

| Class                | Rule                                                                                                                                                                                                       | n   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `dated`              | A step with a clean baseline                                                                                                                                                                               | 96  |
| `too_short`          | Measured road under 100 m. These are stubs beside another road: the 10 m buffer is a few pixels and mixes with that road; 8 of 19 read "cleared before series"                                             | 19  |
| `undatable`          | `no_step` (8), `open_near_series_start` (8), `noisy_baseline` (4). Mostly dry Cariboo grassland and pine, smoke years, or a weak step                                                                      | 20  |
| `open_before_series` | Corridor already open about 2 years before harvest: an older road reused and renamed. 5 in Cariboo-Chilcotin and one each in Okanagan Shuswap, Vanderhoof and Mackenzie; 6 on unnamed permits              | 8   |
| `fire`               | A BC fire perimeter (`PROT_HISTORICAL_FIRE_POLYS_SP` or `PROT_CURRENT_FIRE_POLYS_SP`, `fires.py`) crosses the corridor buffer in the step's year or the year before: W2138 and W2232 (2021), HAT83A (2018) | 3   |

Timing classes for a dated pair, against the recorded start:

| Class                    | Rule                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `well_ahead`             | First scene showing the corridor ≤ start − 183 d           |
| `within_6_months`        | Visible by start + 14 d, and still absent at start − 183 d |
| `at_harvest`             | Still absent in a clear scene at start − 14 d or later     |
| `bracket_spans_start`    | The rest                                                   |
| `ahead_bracket_spans_6m` | 2 pairs, counted with `within_6_months` in the totals      |

### Validation

- **MAL015** reproduces the note's bracket. Here: 2025-01-17 → 2025-02-11. In the note: 2025-01-17 → 2025-02-06. The 2025-02-06 scene is not used here because the road part is measured clear of other roads and has a stricter snow rule.
- **AKI067** is not among the cached pairs, so it was not rerun.

## Results

### Lead time (first scene showing the corridor − recorded harvest start), 96 dated pairs

| First scene showing corridor − start | Pairs |
| ------------------------------------ | ----- |
| more than 365 d before               | 0     |
| 183–365 d before                     | 8     |
| 14–183 d before                      | 15    |
| within ±14 d                         | 17    |
| 15–60 d after                        | 25    |
| 61–182 d after                       | 24    |
| more than 182 d after                | 7     |

Percentiles (days):

| Quantity                                                | p10  | p25 | Median | p75  | p90  |
| ------------------------------------------------------- | ---- | --- | ------ | ---- | ---- |
| First scene showing corridor − start                    | −82  | −9  | +22    | +102 | +151 |
| Last clear scene without corridor − start               | −173 | −87 | −22    | +2   | +38  |
| Bracket width                                           | 6    | 13  | 28     | 136  | 198  |
| First scene showing corridor − block clearing (imagery) | −219 | −29 | +5     | +89  | +122 |

How the 96 split:

- **Well ahead (more than 6 months):** 8 (8%).
- **Ahead, within 6 months:** 19 (20%).
- **At harvest** (absent at start − 14 d or later): 45 (47%).
- **Bracket spans the start:** 24 (25%). In 20 of these the harvest started November to March, and the first scene showing the corridor is in March–June.

The "after" leads (first scene up to +182 d) are mostly the snow gap, not late construction:

- Corridors visible only 61–182 days after the start are winter harvests whose first clear scene is in spring.
- In the 7 over +182 days, the block interior was also uncut until then, so the record's start precedes the clearing.

### Bracket width

| Width              | Pairs |
| ------------------ | ----- |
| 14 days or less    | 29    |
| 15–30 days         | 20    |
| 31–60 days         | 11    |
| 61–120 days        | 9     |
| 121–180 days       | 13    |
| more than 180 days | 14    |

By season of the first scene showing the corridor:

| Season | Pairs | Median width |
| ------ | ----- | ------------ |
| Fall   | 14    | 12 d         |
| Winter | 10    | 25 d         |
| Summer | 31    | 27 d         |
| Spring | 41    | 110 d        |

A spring date usually means the corridor was cut under snow at some point in the winter.

### Covariates

Share of dated pairs whose corridor was visible more than 14 days before the recorded start (23 of 96 overall). Fisher exact tests compare each group with the rest.

| Group                                 | Ahead / n | p    |
| ------------------------------------- | --------- | ---- |
| Prince George                         | 10/30     | 0.20 |
| Cariboo-Chilcotin                     | 7/28      | 1.00 |
| Mackenzie                             | 4/21      | 0.77 |
| Vanderhoof                            | 1/13      | 0.18 |
| Tolko                                 | 6/20      | 0.56 |
| Canfor                                | 6/25      | 1.00 |
| Spur outside block < 300 m            | 11/44     | 1.00 |
| Spur outside block 300–1000 m         | 9/32      | —    |
| Spur outside block ≥ 1000 m           | 3/20      | 0.39 |
| Spur joins an FSR (`host_kind = fsr`) | 1/8       | 0.68 |
| Joins another block's spur, earlier   | 3/8       | —    |
| Joins another block's spur, later     | 2/11      | —    |
| Joins an unnamed permit road          | 17/69     | —    |
| Harvest starts in summer (Jun–Aug)    | 9/28      | 0.29 |
| Harvest starts in winter (Dec–Feb)    | 10/40     | 1.00 |
| Harvest starts in spring (Mar–May)    | 1/13      | 0.18 |
| Harvest starts in fall (Sep–Nov)      | 3/15      | —    |

Median lead by group:

| Group                         | Median lead |
| ----------------------------- | ----------- |
| Spur outside block ≥ 1000 m   | +63 d       |
| Spur outside block < 300 m    | +18 d       |
| Spur outside block 300–1000 m | +10 d       |
| Prince George                 | +23 d       |
| Cariboo-Chilcotin             | +22 d       |
| Mackenzie                     | +22 d       |
| Vanderhoof                    | +30 d       |

- **Spur length.** The +63 d for long spurs comes from more of them being winter harvests behind a snow gap, not from later building.
- **Licensee and district.** No licensee with at least 6 dated pairs stands out. Vanderhoof's 1 in 13 is the lowest share, but not significantly so.
- **FSR junction.** Not related to lead; only 8 pairs join an FSR.
- **Season.** Of the 12 early roads for November–March harvests, 7 first appear between June and November of the previous year. Across all 23 early roads:

  | Month                             | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
  | --------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Last clear scene without corridor | 1   | 1   | 1   | 1   | 3   | 1   | 1   | 0   | 4   | 7   | 1   | 2   |
  | First scene showing corridor      | 0   | 2   | 0   | 3   | 6   | 2   | 1   | 1   | 2   | 3   | 3   | 0   |

  So a fall build ahead of winter logging does occur. More often, though, the corridor of a winter block shows up only in the first clear scene after the snow, together with the block.

### Road vs block in the same imagery

Using the imagery's own block clearing, which removes errors in the recorded start date:

| Corridor relative to block clearing | Pairs |
| ----------------------------------- | ----- |
| More than 6 months before           | 8     |
| Up to 6 months before               | 25    |
| Same bracket                        | 52    |
| After                               | 4     |
| No block step                       | 7     |

The block step lags the recorded start by a median of 97 days over the 129 pairs with one. That lag is partly method: a whole-block mean needs 80% of the interior clear, so snow hides winter harvests. It is also partly real: in 13 dated pairs the interior was still uncut in a clear scene more than 60 days after the recorded start.

## Examples (images in `images/`)

| Image                                | What it shows                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compare_W0480_DCC_well_ahead.jpg`   | Tolko block W0480, 230 m spur outside the block. Bracket 2019-12-25 → 2020-05-05; harvest recorded 2021-01-11. The spur and the in-block road are absent on 2019-08-29 and clear on 2020-09-07, four months before harvest, when the block is still standing. A genuine early road.                                 |
| `compare_PUR014_DPG_well_ahead.jpg`  | PUR014, 871 m. Corridor bracket 2023-10-27 → 2024-02-02; block cleared 2024-01-13 → 2024-02-02; recorded start 2025-01-02. On 2024-07-08 the block and roads are cut. "Well ahead" of the record, but the road came with the harvest; the record is about 11 months late.                                           |
| `compare_277_DPG_at_harvest.jpg`     | Winton block 277, 1.29 km spur. Bracket 2022-07-02 → 2022-07-22; harvest 2022-06-20. Not there on 2022-05-21; by 2022-08-09 the road loop and block are built and cut. The common case.                                                                                                                             |
| `compare_5_DCC_record_early.jpg`     | West Fraser block 5, 1.2 km. The step is 2020-12-14 → 2021-01-15 against a 2020-11-03 start. Under snow on 2021-04-15 the roads already show as white lines; on 2021-06-29 both cutblocks and the spurs are open. Before the summer check skipped hazy scenes, smoky May 2021 scenes pushed this pair to `no_step`. |
| `compare_W2138_DCC_fire.jpg`         | W2138, 3.3 km. The "step" (2021-08-05 → 2021-08-13) is the August 2021 burn of fire C31056, which crossed the whole area; the January 2022 harvest was salvage. The reason for the fire exclusion.                                                                                                                  |
| `compare_HAT617_DVA_young_stand.jpg` | HAT617. The spur outside the block runs through a young stand. Under snow it reads like a corridor, which made a false 2018 "well ahead" step until the summer check. Now dated 2019-02-13 → 2019-02-26, 8 days before harvest.                                                                                     |
| `compare_CHU131_DPG_no_step.jpg`     | CHU131. The block is cut by 2021-07-07, but the 147 m permitted spur east of it shows no corridor. Classed `no_step`, which looks right: the permitted line was not built, or not where FTEN draws it.                                                                                                              |
| `compare_8_DCC_open_near_start.jpg`  | Block 8 (A20020). The spur crosses open grassland, and the 2017 "before" scene is under Hanceville-fire smoke. NDVI contrast cannot date this one.                                                                                                                                                                  |

Series contact sheets, one panel per pair:

- `images/series_dated_1.png` … `series_dated_4.png`
- `series_undatable_1.png`, `series_too_short_1.png`, `series_open_before_series_1.png`, `series_fire_1.png`

What the panels show:

- **Red dots:** corridor contrast. Grey dots are snowy or hazy scenes.
- **Green dots:** block contrast.
- **Blue line:** recorded harvest start; the grey bar under it is the recorded harvest interval.
- **Orange band:** the detected bracket.
- **Dotted lines:** 0 and T.

## What it means for the app

1. **Show "first seen" as an interval and say what it measures.** Use the form "Corridor first seen between {last_before} and {first_after} (Sentinel-2)." It means the strip was cleared, not that the road was built or drivable, and on a short spur it cannot be told apart from the block's own clearing. Never collapse it to one date. One bracket in seven is wider than 6 months, and most wide ones straddle winter. If the bracket crosses November–April, add "(snow gap)".
2. **Put the bracket next to the recorded harvest dates on the block timeline.** The tool can show:
   - "visible before harvest" when `first_after` falls before the recorded start;
   - "appeared with harvest" when the bracket contains the start;
   - "after recorded start" otherwise.

   Expect most blocks to read "appeared with harvest". "Before harvest" by more than 6 months is uncommon: 8 of 96 against the record, 8 of 89 against the imagery's own block clearing.

3. **Don't assume a spur exists ahead of a planned block.** A road design for a block can assume its spur will be built in the same season as the harvest. A road visible a year early is the exception (0 of 96 were visible more than a year early). Long-lived spurs show up as "already open before the series" (8 pairs) or as a named road that is really an older road (§7 of the note).
4. **Use imagery to check the record's start date.** In 13 of 96 dated pairs the block was still standing in a clear scene more than 60 days after `DISTURBANCE_START_DATE`. In one (PUR014) it was cut 11 months before. Showing the imagery's block clearing next to the recorded dates guards against both.
5. **Label the cases the method can't date, and say why.** Rather than leaving them blank, use:
   - "too short to measure" (spur under 100 m beside another road; 13% of pairs);
   - "no forest contrast" (grassland or open pine; mostly Cariboo-Chilcotin);
   - "already open in {first year}";
   - "burned {year}", from the fire perimeters.
6. **Cost per block.** Computing on demand is feasible but slow in a browser: about 130–300 STAC items, roughly 200 dates and 3 small COG reads per date for one pair. Precomputing the bracket per named spur in `vendor/bcdatamapper` and shipping it as data fits the app better.

## Limits

- **Clearing is not construction.** The signal is canopy removal along the line. On short spurs and in-block roads the block's own clearing dominates, and the in-block persistence rule counts block clearing as corridor. Road building and harvest within the same weeks cannot be separated.
- **FTEN geometry may not match the ground.** If the permitted line is not where the road was built, there is no step (CHU131), or the step belongs to a neighbouring road.
- **Snow sets the resolution in winter.** 41 of 96 first scenes showing the corridor fall in spring, with a median bracket of 110 days. Winter harvests, which are 40 of 96 dated pairs, get the widest brackets.
- **Dry interior forest and grassland.** In Cariboo-Chilcotin and Okanagan Shuswap, open pine and grassland give weak or seasonal contrast. Cariboo-Chilcotin has 9 of the 20 undatable pairs.
- **Smoke and fire.** 2017, 2018, 2021 and 2023 smoke depresses NDVI. The haze test, the summer check and the fire-perimeter exclusion handle most of it, but not all. Fire perimeters crossed 22 of 146 corridors at some point since 2016; 3 pairs were excluded.
- **The two-year window.** Roads opened more than about 2 years before harvest read as `cleared_before_series` and are not dated.
- **Sample.** Licensees who name spurs after blocks: Canfor, Tolko, Conifex, Carrier, Winton and First Nations licensees. Quesnel (2 pairs) and Okanagan Shuswap (5) are thin, so group comparisons have little power.
- **Recorded dates.** `DISTURBANCE_START_DATE` is not always the felling date (13 pairs). Lead times against the record carry that error; the imagery-relative figures do not.

## Files

All paths are relative to `/tmp/pgmaps-access-research/agents/timing/`.

**Scripts**

| Script                                      | Purpose                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `fetch_series.py <pair.json> <out.json>`    | Per-scene NDVI series for one pair. Adapted from `scripts/forestry/access-research/s2_timeseries.py`; uses the cached pair geometry. |
| `one.sh`, `run_all.sh`, `retry.sh`          | Batch drivers (3 processes × 4 threads; skip pairs already fetched).                                                                 |
| `detect.py [T]`                             | Step rule → `brackets_T{T}.json`.                                                                                                    |
| `analyze.py brackets_T0.10.json`            | Joins `pair_metrics.json` and `fires.json`, assigns final classes, writes `brackets_T0.10.csv`, prints `report_T0.10.txt`.           |
| `summary_extra.py`                          | Imagery-relative classes, season tallies, late records → `summary_extra.txt`.                                                        |
| `fires.py`                                  | BC fire perimeters since 2016 per pair → `fires.json`.                                                                               |
| `compare.py <oid> <before> <after> <label>` | Before/after true-colour crops (adapted from `s2_compare.py`; cached geometry, contrast stretch).                                    |
| `plot_series.py`                            | Contact sheets of the series.                                                                                                        |

**Output**

| File                                                 | Contents                                                                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brackets_T0.10.csv`                                 | **Main per-pair output.** One row per pair: block, licensee, district, harvest dates, measured part and length, `last_before`, `first_after`, bracket width, leads, contrasts, flags, block-clearing bracket, fire years, final class. |
| `brackets_T0.10.json`                                | The same, with the raw step details.                                                                                                                                                                                                   |
| `brackets_T0.08` / `0.12` / `0.15` (`.csv`, `.json`) | Sensitivity runs.                                                                                                                                                                                                                      |
| `series/<OBJECTID>.json`                             | Raw per-scene values for every pair: date, tile, cloud, NDVI per geometry, snow fractions, road red.                                                                                                                                   |
| `report_T*.txt`, `summary_extra.txt`                 | The printed tables behind this note.                                                                                                                                                                                                   |
| `images/`                                            | Before/after crops and series contact sheets.                                                                                                                                                                                          |
| `logs/`                                              | Fetch logs.                                                                                                                                                                                                                            |
