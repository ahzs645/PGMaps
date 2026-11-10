# Finding and tracing existing roads on the terrain

Two tools read existing roads off bare-earth terrain:

- **Find on terrain**, in the **Mapped road** panel, looks for the road bench near a loaded mapped,
  imported or traced road and offers a corrected copy. Government road lines are often digitized
  permit lines and can sit several metres, sometimes tens of metres, off the built road.
- **Trace road**, under **Design → Road**, takes clicks along a road seen on imagery. On fine
  terrain the line between clicks follows the road bench; elsewhere the clicks are joined straight.
- **Find roads on terrain**, under **Terrain → Existing roads & reuse**, runs Find on terrain over
  every mapped road in an area at once, then joins the found roads again where their records met.

When the terrain came from a point cloud imported in this browser session, **Find on terrain** also
reads the cloud's vegetation: it searches with canopy, brush, ground-return density and intensity as
well as the ground, measures the **drivable width** and the **vegetation over the bed**, and grades
the road's **state** from 1 (open, wide bed) to 4 (looks abandoned or overgrown). The state can be
recorded as a dated LiDAR observation in the record's condition evidence; it never sets a condition.

Both produce a **new existing road** in the project's context: user linework, condition unknown,
evidence unreviewed, reuse off. As an active existing road it can be picked as the road to connect
to (**Access from FSR → Start from → A road I pick**, and block access to mapped roads). The record
a search started from is never changed.

## Before you rely on it

- **The terrain must be bare earth of 2 m cells or finer.** A road bench is 4–8 m wide, which is two
  to four 2 m cells; the regional DEM (about 22 m at 54° N) cannot show one, and both tools refuse
  it by name. 1 m is better than 2 m: coarser cells blur a narrow bench. Imported GeoTIFFs and point
  clouds count only if they are a ground model, not a surface model.
- **A found line is a candidate, not a survey.** Check it against imagery or a field visit before
  using it for anything measured. On the one validation road with a reference line (below), half
  of the corrected line was within 1 m of the reference and nine-tenths within 2.6 m.
- **Read whether a road was found, not just where.** The verdict comes from cross-sections, not
  from the search. "No road found" means no flat bed between batters was seen along the best
  path; it does not prove there is no road (see the failure modes).
- **Read which mode ran.** The line under the result says **Used: terrain only** or **Used: terrain +
  vegetation**, and why. Terrain only is what runs without a point cloud from this session, or when
  the cloud covers less than 80 % of the search corridor; its results are exactly those of the
  terrain-only tool before the point-cloud terms were added.
- **On terrain alone the width is the bench, not the drivable width.** It is measured between the
  breaks of slope where the cut and fill batters start. Brush on the bed is not seen. With the point
  cloud the result also gives the drivable width (where returns 0.5–5 m up stay below 15 % of those
  below 5 m) and the vegetation over the bed.
- **The state is not the road's condition.** It describes the bed as the LiDAR saw it on its
  acquisition date: open or brushed in, wide or narrow, with or without shoulders. A class 1 road can
  have washed-out culverts; a class 4 road may have been brushed since. Recording it adds a dated,
  normally unreviewed observation that counts only once reviewed and within a LiDAR age window you
  set ([Dated evidence for existing-road condition](road-condition-evidence.md)).
- **Nothing here sets a condition.** The adopted or traced road starts with unknown condition and
  reuse off, like any import.
- **Found together means found one by one, then joined.** Each road in a multi-road run gets exactly
  the result Find on terrain gives it alone, with the default settings. Only the joins are new, and
  only junctions the record has are rebuilt: two found roads that end a metre apart stay apart if
  their records did not meet. A junction that would move an end further than the tolerance is left
  as found and listed.

## Using it

### Find on terrain

1. Load the road: **Load as road** on its map card, or **Load mapped roads in view**.
2. In the **Mapped road** panel, choose **Find on terrain**. Progress and **Cancel** replace the
   button while it runs.
3. Read the result: whether a bench was found and along what share of the road, the shift from the
   record (median and P90, over the found stretches only), the largest gap between the record's ends
   and the found road's (**End shift**: a value near the corridor width means an end-cap problem),
   the bench width (median and P10–P90), the shoulders found (share of the two possible per section,
   and how often both), the mean road-likeness and the path's harmonic-mean score, and the
   sinuosity. With the point cloud: the drivable width (median and P10–P90) and the vegetation over
   the bed. Stretches with no bench, no terrain, or a presumed structure at a water crossing are
   listed by station; each links to that station.
4. With the point cloud, the **State (LiDAR)** box gives the class and score, its four sub-scores and,
   where the class changes along the road, the stretches by class. **Record as LiDAR evidence** takes
   the LiDAR acquisition date (not today) and, optionally, a reviewer, and adds the observation to the
   record's condition evidence. It is offered only for a road loaded from existing-road records.
5. The candidate is drawn as a purple dashed line over the record. **Adopt** adds it as a new
   existing road named "_record_ · on terrain"; **Discard** drops it. Adopt is offered only when a
   bench was found along at least 20 % of the road.

Where no bench was found, the candidate keeps the record's own line for that stretch, so an adopted
road never invents geometry the terrain did not support.

**Search settings** (a fold above the button; its summary shows corridor, pull and level edge) holds
the parameter set, each with an info tip: corridor 10–80 m (40), pull to the record 0–0.9 (0.1),
level-edge tolerance 0.05–0.30 m (0.15), and with a point cloud the ground-spread tolerance
0.02–0.30 m (0.10) and the drivable brush share 5–50 % (15 %), plus the state thresholds (vegetation
10–40 %, drivable width 1–5 m, shoulders 50–75 %; the conductivity thresholds 0.25–0.5 are fixed).
**Treat as water** lists the project's polygons; only those ticked are water. A value typed
outside its range is brought to the nearest limit and the field shows a notice, as in every
number field; settings that still fail validation disable the search and name the field. The settings are kept for the
session, and every value a search ran with is saved with an adopted road and in a recorded
observation's notes.

### Find roads on terrain (several at once)

1. Load the mapped roads (**Load BC roads**, **Import existing roads**) and the terrain, then open
   **Terrain → Existing roads & reuse → Find roads on terrain**.
2. Pick the **Area**: **Loaded terrain**, or any polygon in the project (a drawn avoid area or
   block, or an imported one). A road is taken when at least half of its length, sampled every
   10 m, is in the area and on the terrain. Roads already found on terrain are not searched again.
   The line under the picker says how many roads that is, and how many were left out over the cap
   (25 roads and 25 km per run).
3. **Find _n_ roads on terrain** searches them one after another. The progress line names the road
   ("Road 3 of 12 · R01234 · following the road") and **Cancel** stops the run.
4. The table lists every road: the result (found, in part, not found, terrain gap, failed), the
   share found, the median shift from the record, the LiDAR state class when the point cloud was
   used (evidence, not condition; record it from the road's own **Find on terrain**), and how many
   of its ends were moved to rebuild a junction. A road whose search failed says why in its row.
5. **Junctions** counts those rebuilt and lists the ones to check. The found roads are drawn in
   purple on the plan, and a junction that was not rebuilt, or rebuilt only in part, is marked.
   Ends that came near a road their record does not join are listed separately; they are never
   joined.
6. Untick a road to leave it out: it keeps its record line, the junctions are worked out again at
   once, and the other roads join its record where it is the through road. **Adopt _n_** adds the
   ticked roads as new existing roads named "_record_ · on terrain", in one step; **Discard** drops
   the run. The records are never changed.

**Reconnect within** (1–50 m, default 30 m) is the furthest a found road's end may move to meet the
roads its record meets. The run uses the default search settings and no water mask; for other
settings, or to tick water, run **Find on terrain** on that road.

### Trace road

1. **Design → Road → Trace road**, then click along the road on the plan. Click at junctions and
   on tight bends, and keep clicks under 800 m apart.
2. The drawing bar counts segments **on the road bench** (teal) and **straight** (amber, dashed).
   Each segment is traced in the background as soon as its second click lands.
3. **Finish trace** adds the line as an existing road named "Traced road _n_". **Undo point** and
   **Cancel drawing** work as for pegging.

On terrain coarser than 2 m the bar says so and every segment is straight: the trace is then a
plain click line, recorded as "not checked against terrain".

### What is saved

The new road's `roadEvidence.lineOrigin` records how its line was made: `terrain-relocation`,
`terrain-trace` or `clicks`, the date, the terrain cell size, the share found, the shift and
bench width (relocation) or the segment counts (trace). A relocation also records what scored the
ground (`scoredWith`), the corridor, pull and level-edge tolerance it ran with, and with a point
cloud the drivable width, vegetation over the bed, state score and class. A road adopted from a
multi-road run also records how many of its ends were moved to rebuild a junction
(`reconnectedEnds`, 0–2). The road card shows it as **Line**. The
record is optional and bounded by `parseRoadLineOrigin` (`existingRoadEvidence.ts`); older project
files without it load unchanged.

## How it works

The method follows Roussel et al. (2022), which corrects forest road maps from airborne LiDAR with a
least-cost path over a "conductivity" raster and then measures the road in cross-sections. Without a
point cloud PGMaps uses only the terms that bare-earth terrain can supply; with one it uses all
seven. See **Provenance** for what it was written from.

### Vegetation evidence (`vegetationEvidence.ts`, in `pointCloud.worker.ts`)

The point-cloud import thins a large cloud to its lowest point per cell for the ground model, which
removes exactly the returns the vegetation terms need. So before thinning, the worker adds every
non-noise return into 1 m cells on a whole-metre lattice: returns, ground returns (class 2) and the
standard deviation of their elevations, the highest return above the ground, returns strictly
between 0.5 and 3 m up (low vegetation), between 0.5 and 5 m (brush) and below 5 m, and the range of
the intensity. Heights are above the file's own ground returns (cell means, gaps up to 3 cells
filled). Intensity is read through the bundled LAZ reader (whitebox-wasm, still loaded only when a
LAZ is read) or straight from LAS records. When a LAS states more than one flight line (point source
ID), each line's intensity is divided by its median over the median of the line with the most
points; then everything above twice the 98th percentile is clipped. A LAZ has no flight-line reader,
so its intensity is clipped but not normalised, and the summary says so. Only the grids return to
the page.

### Road-likeness (`roadLikeness.ts`)

The terrain is sampled at 1 m (`ROAD_FIND_SAMPLE_CELL_M`) in the terrain's own projected grid, and
each cell gets a score from 0.1 to 1. **Terrain only**, it is the product of three terms:

- **Slope**: 1 at 5° or less, falling linearly to 0 at 20° (Horn's 3×3 slope). A road bed is gentle.
- **Roughness**: each cell's departure from its own 5×5 mean, then the spread (max − min) of that
  departure over 3×3. 1 at 0.05 m or less, 0 at 0.10 m. A graded bed is smooth; stumps,
  windthrow and rock are not.
- **Slope edges**: 0 where the 3×3 Sobel gradient of the slope raster reaches 40 (degrees per cell),
  otherwise 1. These are the breaks at road edges, ditches and batters, so the search cannot run
  along a batter.

**Terrain + vegetation** follows the paper's equation 1: three gates times a weighted vote,

σ = slope × low vegetation × edges × (2 · density + canopy + roughness + intensity) / 5,

with the intensity term and its weight left out when the cloud has none (denominator 4). The gates
are the slope and edge terms above and **low vegetation**: 0 at two or more returns 0.5–3 m up in
the cell. The vote: **ground density**, the ground returns per m² smoothed by a 3×3 mean with the
centre counted twice, rising from 0 at the corridor's 25th percentile of non-zero densities to 1 at
its 95th; **canopy**, 1 where the highest return is 0.1 m or less above the ground, 0 from 0.2 m;
**roughness** as above, now a vote rather than a gate; and **intensity**, 1 at or below the
corridor's 10th percentile of cell intensity ranges, 0 from its 50th. Every activation is rounded to
three decimals. The two density and intensity thresholds are relative to the corridor searched, so
the score adapts to the acquisition's density. A cell with no returns at all beside cells with
returns takes the largest canopy, low-vegetation and intensity range of its 3×3 neighbours; with no
neighbour either, it votes nothing for road.

Either form is floored at 0.1 so a short culvert fill or a rough patch stays passable. A cell whose
windows touch missing terrain is missing too: the score is never floored over a gap, and a gap
grows by three cells in the score.

### Following the road (`roadRelocation.ts`)

0. The mode is chosen first: terrain + vegetation when point-cloud evidence covers at least 80 % of
   the corridor (sampled every 2 m along and across it), terrain only otherwise, and the result says
   which and why.
1. Only cells within the corridor (40 m either side of the line) can be used. Ticked water polygons
   cannot be crossed, except within 5 m of each place the record crosses them, which is free to
   cross (a presumed bridge or culvert) even where the terrain is missing over the water.
2. Each cell's score is multiplied by a weak pull towards the line: 1 on it,
   falling to 0.9 at the corridor edge. This breaks ties between parallel road-like strips in favour of the one
   nearer the record without overriding the terrain.
3. A half-disc behind each end of the line, of the corridor's radius, is made free to cross (score 1).
   The path can then join the road wherever it passes the end, rather than at the record's end
   point, which is itself often off the road.
4. The cheapest 8-connected path from the start cap to the end cap is found; a step costs its length
   divided by the mean score of its two cells. Missing cells cannot be crossed.
5. The cap cells are trimmed off, and the path is smoothed over 7 vertices.
6. A line longer than 1,000 m is searched in equal pieces, each with its own caps, and the
   pieces are joined end to end. A loop (its ends within 2 m) is always searched as at least two
   pieces: with one, both caps would sit on the same spot and the search would end where it began.
7. With the point cloud, the gates close a brushed-in bed as firmly as the forest floor beside it,
   so the search can lose an overgrown road. Where the full score's path finds a bench along less
   than 80 % of a piece, that piece is searched again on the terrain score, and the path with more
   bench is kept. The result says so ("the road was followed on the terrain alone and then graded"),
   and the grading still reads the full score.

### Cross-sections and the verdict (`roadSlices.ts`)

Every 10 m along the path, a profile 15 m either side is sampled
every 0.5 m and smoothed over three samples. Its centre moves up to
2 m to the flattest point. Walking outward on each side, a **batter** starts where
the cross slope reaches 10° and ends where it drops back; it counts if it runs
at least 1 m across at that slope overall. The bench edge is where the batter
starts. A side with no batter takes the first point 0.15 m above or below the centre.

With the point cloud, each section also reads a profile across the road from the vegetation
evidence, summed over the section's 10 m length for each 0.5 m bin (so a bin holds ten 1 m cells, not
one). A side with no batter then also ends where the ground returns' spread (3-bin smoothed) exceeds
0.10 m or where a covered bin has no ground return. The **drivable edges** are the first bins,
walking out from the centre, whose share of returns 0.5–5 m up among those below 5 m (3-bin smoothed)
exceeds 15 %; with none, the road edge. The **vegetation over the bed** is that share, as a
percentage, over the bins strictly between the road edges. A section the cloud covers in fewer than
80 % of its bins is measured on terrain alone.

A section is a **bench** when its centre is flatter than the shoulder slope, at least one side has
a batter, and the width is between 2.5 m and 20 m. A section is
**found** when it is a bench and the mean **terrain** road-likeness along the path within half a
spacing is at least 0.5, in both modes: whether a road is there is a terrain question, so a
brushed-in road is found and then graded rather than lost. A section with any missing sample is
**no terrain** and is left out of every figure. A section whose stretch of path touches water or a
presumed structure is a **presumed structure**, kept as the record and never counted as found.

Runs of found and not-found sections shorter than 30 m take their neighbours' kind:
a culvert or a noisy section does not split the road, and one bench-like section does not make a
road. The candidate is then built stretch by stretch: the path where found, the record's own line
where not. The verdict is **found** when at least 80 % of the record's length was
found, **found in part** from 20 %, and **no road found** below that, when the
record is returned unchanged.

### State score and class (`roadState.ts`)

With the point cloud, the found stretches are graded on four sub-scores, each 0–1 and rounded to
three decimals:

| Sub-score         | Input, over the found sections                           | 0            | 1            |
| ----------------- | -------------------------------------------------------- | ------------ | ------------ |
| Vegetation        | mean vegetation over the bed, %                          | 40 % or more | 10 % or less |
| Drivable width    | mean drivable width, m                                   | 1 m or less  | 5 m or more  |
| Path conductivity | harmonic mean of the full score along the found sections | 0.25 or less | 0.5 or more  |
| Shoulders         | batters found, % of the two possible per section         | 50 % or less | 75 % or more |

The **score** is 100 × their mean, to 0.1; the **class** is 1 from 75, 2 from 50, 3 from 25 and 4
below. Each section is also scored on its own figures, and runs of one class become the stretches
listed by class.

**Harmonic, not arithmetic.** The path conductivity is the path's length over the sum of length ÷
score: a road half on score 1 and half on 0.25 reads 0.40 (sub-score 0.6), where the arithmetic mean
would read 0.625 (sub-score 1). The 0.25/0.5 thresholds were set on the harmonic form, so the state
always uses it. The found/not-found verdict keeps the arithmetic mean of the terrain road-likeness in
both modes (threshold 0.5), so terrain-only results are unchanged; the result also shows the path's
harmonic mean beside it for comparison. The score along the path is read without the pull towards
the record, which is a search device, not evidence about the road.

### Searching many roads and reconnecting them (`roadBatchFind.ts`, `roadReconnect.ts`)

Each road is searched with `findRoadOnTerrainSteps` and the same input a single search gets, one
road after another inside one cooperative run, so a road's result never depends on the others in
the run. The roads share one projection: the terrain's own, or the UTM zone of the first mapped
road.

Every road is searched between its own end caps, and the caps let a path join the road anywhere
across each end. So roads that met in the record end a few metres apart once found: a through road
found in two halves stops where each cap starts, and a spur stops at its cap's edge, short of the
road it leaves (on the synthetic T junction, 5 to 9 m). Reconnecting puts them back together:

1. **The record's junctions.** Record ends within 1 m of each other are one junction (a node); a
   record end within 1 m of another record's line, away from its ends, is a **mid-road junction**.
   Nothing else is joined.
2. **The through pair.** At a node, the two roads whose record headings (read over 20 m) are closest
   to straight. Pairs within 7.5° of the straightest are equal, and then rank by the lower sum of
   their state classes (a road with no class counts as 5), then the higher sum of state scores, then
   the higher found share.
3. **Two roads** meet at the midpoint of their found ends.
4. **Three or more.** The through pair is joined at that midpoint into one line. Each other road is
   extended along its end heading (or cut where it already runs past) until it crosses that line,
   and the junction goes at the mean of their crossings along it. The through line is split there
   into its two roads again, and each other road ends on the junction.
5. **A loop and the road into it.** The loop is closed at the midpoint of its two ends, then opened
   again where the other road crosses it, so the junction is where the two meet on the ground. A loop
   alone is closed at its ends' midpoint. A loop that meets two or more other ends is left as found.
6. **Mid-road.** The spur is extended along its heading, or cut, to cross the other road's found
   line (or the nearest point of it); the other road is not split.
7. **Limits.** No end moves further than the tolerance (30 m by default): half the gap between the
   through pair, every other road's crossing along the through line and its own move are each held
   to it. Past it the junction is left as found, with a message naming the road and the distance.
8. **Roads left out.** A road not found, or unticked, keeps its record line and never moves. Where
   it is half of the through pair, the found roads end at its record end, where the record joins
   them. Otherwise the found roads meet among themselves and the result says how far the kept road
   now ends from them.
9. **Near misses.** A found end that is not at any record junction but comes within 8 m of another
   road is listed as a possible junction missing from the record. It is not joined.

### Tracing between clicks (`roadTrace.ts`)

Each segment samples and scores a capsule around its chord, of half-width
0.3 × the chord between 20 m and
60 m. Each click moves to the most road-like cell within 5 m
(the nearest on a tie), if that cell scores at least 0.3. An A\* search
then finds the cheapest path between the two clicks, with the same step cost as above; straight-line
distance is a safe lower bound because no step costs less than its length. Off-road lead-ins of up
to 15 m at either click are dropped, so a click beside the road still gives a line
on it. The segment is **on the road bench** when the path averages at least 0.5
and at least half of its cross-sections show a bench; otherwise it is the
straight chord between the raw clicks.

## Limits and budgets

| Limit                                                                                                                     | Enforcing code                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Terrain coarser than 2 m per cell is refused by both tools                                                                | `ROAD_FIND_MAX_CELL_M`, `roadFindingTerrainProblem`, `roadLikeness.ts`                                                |
| Terrain is sampled at 1 m for the search                                                                                  | `ROAD_FIND_SAMPLE_CELL_M`, `roadLikeness.ts`                                                                          |
| Slope 5–20°, roughness 0.05–0.10 m, slope-edge limit 40, floor 0.1                                                        | `DEFAULT_ROAD_LIKENESS`, `roadLikeness.ts`                                                                            |
| Search corridor 40 m either side, 10–80 m allowed                                                                         | `ROAD_FIND_CORRIDOR_M`, `MIN_ROAD_FIND_CORRIDOR_M`, `MAX_ROAD_FIND_CORRIDOR_M`                                        |
| Pull towards the line falls to 0.9 at the corridor edge                                                                   | `ROAD_FIND_CONFIDENCE`, `roadRelocation.ts`                                                                           |
| Lines 30 m to 20 km; searched in pieces of at most 1,000 m and 2,000,000 cells                                            | `ROAD_FIND_MIN_LENGTH_M`, `ROAD_FIND_MAX_LENGTH_M`, `ROAD_FIND_CHUNK_M`, `ROAD_FIND_MAX_CELLS`                        |
| A found section needs a bench and mean road-likeness 0.5                                                                  | `ROAD_FIND_MIN_LIKENESS`, `roadRelocation.ts`                                                                         |
| Stretches shorter than 30 m take their neighbours' verdict                                                                | `ROAD_FIND_MIN_RUN_M`, `roadRelocation.ts`                                                                            |
| "Found" from 80 % of the length, "found in part" from 20 %, nothing offered below                                         | `ROAD_FIND_FOUND_SHARE`, `ROAD_FIND_PARTIAL_SHARE`, `roadRelocation.ts`                                               |
| Path smoothed over 7 vertices, candidate thinned at 0.5 m, shift sampled every 5 m                                        | `ROAD_FIND_SMOOTH_VERTICES`, `ROAD_FIND_SIMPLIFY_M`, `ROAD_FIND_SHIFT_STEP_M`                                         |
| Sections every 10 m, 15 m either side, sampled every 0.5 m, re-centred within 2 m                                         | `ROAD_SLICE_SPACING_M`, `ROAD_SLICE_HALF_WIDTH_M`, `ROAD_SLICE_STEP_M`, `ROAD_SLICE_RECENTRE_M`, `roadSlices.ts`      |
| A batter starts at 10° and must run 1 m; a level edge departs 0.15 m                                                      | `ROAD_SHOULDER_SLOPE_DEG`, `ROAD_MIN_EMBANKMENT_M`, `ROAD_FLAT_TOLERANCE_M`                                           |
| A bench is 2.5–20 m wide                                                                                                  | `ROAD_BENCH_MIN_WIDTH_M`, `ROAD_BENCH_MAX_WIDTH_M`, `roadSlices.ts`                                                   |
| Clicks snap within 5 m onto ground scoring at least 0.3                                                                   | `ROAD_TRACE_SNAP_M`, `ROAD_TRACE_SNAP_MIN_LIKENESS`, `roadTrace.ts`                                                   |
| Trace capsule 0.3 × chord, 20–60 m either side; clicks over 800 m apart are joined straight                               | `ROAD_TRACE_HALF_WIDTH_SHARE`, `ROAD_TRACE_MIN_HALF_WIDTH_M`, `ROAD_TRACE_MAX_HALF_WIDTH_M`, `ROAD_TRACE_MAX_CHORD_M` |
| A traced segment needs mean road-likeness 0.5 and a bench in half its sections                                            | `ROAD_TRACE_MIN_LIKENESS`, `ROAD_TRACE_MIN_BENCH_SHARE`, `roadTrace.ts`                                               |
| Off-road lead-ins up to 15 m at a click are dropped                                                                       | `ROAD_TRACE_MAX_LEAD_M`, `roadTrace.ts`                                                                               |
| The saved line origin's figures are bounded; out-of-range values refuse the file                                          | `parseRoadLineOrigin`, `existingRoadEvidence.ts`                                                                      |
| Point-cloud terms: canopy 0.1–0.2 m, low vegetation 2 returns, density P25–P95, intensity P10–P50, weights 2/1/1/1        | `DEFAULT_ROAD_CONDUCTIVITY`, `roadLikeness.ts`                                                                        |
| Vegetation evidence at 1 m, at most 4,194,304 cells; bands 0.5–3 m and 0.5–5 m                                            | `VEGETATION_CELL_M`, `MAX_VEGETATION_CELLS`, `VEG_LOW_BAND_M`, `VEG_BRUSH_BAND_M`, `vegetationEvidence.ts`            |
| Evidence refused below 1 % above-ground returns; "unreliable" below 5 returns per m²                                      | `VEG_MIN_ABOVE_GROUND_SHARE`, `VEG_ADVISED_DENSITY`, `vegetationEvidence.ts`                                          |
| Point-cloud mode needs 80 % corridor cover; a section needs 80 % of its bins covered                                      | `ROAD_FIND_EVIDENCE_MIN_COVER`, `roadRelocation.ts`; `SLICE_MIN_PROFILE_COVER`, `roadSlices.ts`                       |
| Ground-spread edge 0.10 m; drivable bed ends above 15 % brush share                                                       | `ROAD_MAX_GROUND_SD_M`, `ROAD_MAX_BRUSH_SHARE`, `roadSlices.ts`                                                       |
| Presumed structure within 5 m of a record's water crossing                                                                | `ROAD_FIND_BRIDGE_M`, `roadRelocation.ts`                                                                             |
| State thresholds: vegetation 10–40 %, drivable 1–5 m, conductivity 0.25–0.5, shoulders 50–75 %; classes from 75 / 50 / 25 | `DEFAULT_ROAD_STATE_THRESHOLDS`, `ROAD_STATE_CLASS_FLOORS`, `roadState.ts`                                            |
| Settings ranges: corridor 10–80 m, pull 0–0.9, level edge 0.05–0.30 m, ground spread 0.02–0.30 m, brush share 5–50 %      | `ROAD_FIND_SETTING_LIMITS`, `parseRoadFindSettings`, `roadState.ts`                                                   |
| Evidence is kept for this session only, for at most 3 terrains                                                            | `MAX_KEPT_VEGETATION_EVIDENCE`, `vegetationEvidenceStore.ts`                                                          |
| A line whose ends are within 2 m is a loop and is searched as at least two pieces                                         | `ROAD_FIND_LOOP_M`, `roadRelocation.ts`                                                                               |
| A multi-road run takes at most 25 roads and 25 km; a road counts when half of it (sampled every 10 m) is in the area      | `ROAD_BATCH_MAX_ROADS`, `ROAD_BATCH_MAX_TOTAL_M`, `ROAD_BATCH_MIN_INSIDE`, `ROAD_BATCH_SAMPLE_M`, `roadBatchFind.ts`  |
| Reconnecting moves no end more than 30 m by default, 1–50 m allowed                                                       | `ROAD_RECONNECT_TOLERANCE_M`, `ROAD_RECONNECT_TOLERANCE_LIMITS`, `roadReconnect.ts`                                   |
| Record ends within 1 m are one junction; headings read over 20 m; pairs within 7.5° of straightest tie                    | `ROAD_RECORD_NODE_M`, `ROAD_END_HEADING_M`, `ROAD_THROUGH_TIE_DEG`, `roadReconnect.ts`                                |
| Found ends within 8 m of a road the record does not join them to are listed, never joined                                 | `ROAD_NEAR_MISS_M`, `roadReconnect.ts`                                                                                |

Searches run in slices (`cooperative.ts`), so **Cancel** and the progress line work. A 560 m road
with a 40 m corridor takes well under a second; a 1 km trace segment explores fewer than 200,000
cells. A multi-road run is the sum of its roads; reconnecting is plain geometry and is worked out
again on every tick.

## Built-in assumptions

- The road was built with a bench: a flat or gently crowned bed between cut and fill batters, or
  between ditches. A road graded flush with the ground has no bench to find.
- The road runs within the corridor of the record (40 m by default) for its whole length.
- The record's ends are near the road's ends. The end caps let the path join the road anywhere
  across each end, but not further along it.
- The road has no gaps longer than the terrain's own gaps: missing ground is never crossed.
- The score's thresholds are tuned for 1 m cells with little noise (standard deviation about
  0.01 m); the edge limit is per cell, not per metre.
- The point cloud keeps its ground classes and absolute elevations, at 5–10 returns per m². Heights
  above the ground come from the file's own class 2 returns, not from the imported terrain.
- The ground-spread test reads each 1 m cell's spread, which includes the bed's own grade across the
  cell: at 10 % that adds about 0.03 m. The reference method reads the spread about a road surface
  with the grade removed, in 0.5 m bins.
- One flight line's intensity is comparable along the road. A LAZ's flight lines cannot be read, so
  its intensity is not normalised between them.
- Water is only what you tick as water; a record's crossing of it is a structure, not a road.
- In a multi-road run, the record's topology is right: roads that meet in it meet on the ground,
  within 1 m, and roads that do not meet in it do not. A junction the record lacks is listed only.
- The two roads closest to straight at a junction are one road through it. At a Y where the
  branches are equally straight against the stem, the better state class and score decide, then
  the share found.
- One projection serves the whole run. Roads in another UTM zone than the first road (on terrain
  with no projection of its own) are distorted slightly.

## Failure modes

- **Flat or gentle ground gives a weak signal.** Every smooth cell under 5° scores 1, so the path
  is decided by the pull towards the record, and only the cross-sections can tell a bench. On flat
  ground with no ditches there is no bench to see, so a real road there reads as **no road found**.
  On the validation sample, a line 150 m off any road still scored 0.44 on average against 0.78 on
  the road: the score alone is not evidence that a road exists.
- **Landings, old rail grades, wide skid trails and gentle natural benches look like road.** They
  are flat, smooth and bounded by breaks of slope. Check the candidate on imagery.
- **Cutlines, pipelines, seismic lines and power-line rights-of-way can be mistaken for roads.** A
  graded right-of-way across a slope has a bench; one on flat ground has ditches or berms that read
  as batters. If one runs within the corridor and is more road-like than the road, the path takes it.
- **Ditches.** A ditch beside the road is read as a batter, so the bench edge is the ditch's inner
  edge and the width excludes it. On flat ground a lone ditch gives a one-sided bench whose other
  edge is a level departure, which can widen the reported bench.
- **Junctions and parallel roads.** Where two road-like branches leave the corridor's end, or a
  spur runs alongside, the path can switch branches. In a trace, click at the junction.
- **Switchbacks and tight bends.** The 7 m smoothing rounds a hairpin; on a trace, click at the
  apex.
- **A noisy ground model.** Noise of 0.03 m or more mutes the roughness term: the position usually
  holds, but road-likeness drops and stretches can read as not found.
- **Vegetation kept as ground, or snow.** Both make the bed rough and the batters soft.
- **Water and bridges.** Without ticked water polygons, a lake or river left as missing terrain blocks
  the search and is reported as missing terrain, and a crossing modelled as a water surface may
  simply be a short not-found stretch. With them, water is impassable except within 5 m of where the
  record crosses it: a road whose bridge sits further than that from the record's crossing is cut
  there, and a corridor crossed by water away from the record reports that no path could be followed.
  Unclassified bridge-deck returns read as canopy over the bed.
- **Roads under deciduous canopy, or in summer leaf-on.** Canopy over the bed closes the canopy vote
  but the density, roughness and terrain terms still carry the road; the state reads it lower than a
  leaf-off acquisition would.
- **A brushed-in road.** The low-vegetation gate closes the bed, so the full score cannot follow it;
  the terrain search takes over (stated in the result) and the state grades it, typically class 3–4.
  A road brushed out since the acquisition keeps its old class until a newer cloud is read.
- **Relative thresholds.** The density and intensity thresholds are percentiles of the corridor, so
  a corridor that is mostly road, or mostly clearcut, shifts them.
- **Flat ground without ditches, with a point cloud.** The ground-spread and level-edge tests decide
  the width; defaults can double it on a smooth flat clearing. Lower the level-edge tolerance and
  ground spread (the reference user guide's flat-road case went from 13.6 m to 7.6 m that way).
- **Session-only evidence.** The vegetation grids are not saved with the project; after a reload the
  tool says it runs on terrain alone until the cloud is imported again.
- **Record ends far along the road.** An end 20 m short of or beyond the real road's end leaves an
  end error of about that size, because the caps sit across the ends, not along them.
- **Piece joins.** A road searched in pieces is joined with a short straight piece where two pieces
  meet; both sides are on the road, so the join is along it, but it is not smoothed.
- **Missing terrain inside the corridor.** A gap that crosses the whole corridor stops the search
  with "terrain incomplete" and names where along the line; a gap beside the road is skipped
  around, and sections that touch it are **no terrain**, kept as the record.
- **Records not split at junctions.** A spur whose record ends on another record's line is joined
  to that road's found line, but that road is not split there, so the network has a T without a
  vertex shared by both roads. A record end that sits a few metres short of the road it should meet
  is not a junction of the record; it is listed as a near miss and left free.
- **A spur found on the through road.** Where a spur's end cap admits the through road's bed, the
  spur's path can start along it; the spur's cut at the crossing removes most of that, but check
  the junction on imagery.
- **Junctions near the ends of a short road.** The through road's two halves are split at the
  junction; a junction within 0.5 m of an end of the joined line is left as found.
- **Busy nodes.** A loop that meets two or more other ends, or two loops at one node, is left as
  found and listed. A crossing where two spurs end on a third road's line is handled as a node of
  the two spurs only.
- **Settings.** A multi-road run uses the default settings and no water mask. A road on flat
  ground that needs a lower level edge, or that crosses ticked water, should be run alone.
- **Adopting part of a run.** An unticked road keeps its record, which may now end metres from the
  found roads; the junction list says how far. Adopt it too, or edit it to join.

## Validation

**Against the reference run.** `roadState.test.ts`, `roadLikeness.test.ts` and `roadSlices.test.ts`
pin the figures of a reference run of the ALSroads 0.2.0 package's own scoring, activation, line and
difference code (10 November 2026), as synthetic inputs; the package's data is not used:

- state score and class: P 20 %, drivable 4 m, shoulders 60 %, Σ 0.40 → 60.4, class 2; P 30 %, 2 m,
  50 %, 0.30 → 19.6, class 4; P 12 %, 3.4 m, 62.5 %, 0.45 → 70.8, class 2; the 100.0 and 0.0 rows;
  class at scores 0, 24.9, 25, 49.9, 50, 74.9, 75 and 100 → 4, 4, 3, 3, 2, 2, 1, 1 — all equal;
- activations (slope 5–20°, roughness, edge 40, low vegetation, canopy, density P25/P95) and the five
  equation-1 cases (1.0, 0.5, 0.1, 0.6, 0.875) — all equal; roughness as a vote gives 0.768 where the
  terrain-only product gives 0.64;
- sinuosity 1.666667 and 1.570776 — equal;
- the line difference: a parallel 5 m shift reads 5 / 5 / 5 / 5 as in the reference. Two cases differ
  on purpose, because PGMaps pairs each record point with the nearest point of the corrected line
  rather than the point at the same fraction along it: a corrected line that is the same line 20 m
  longer reads 0 / 0 / 0 with a 20 m end gap (the reference: 10 / 18.8 / 20), and a bowed line reads
  its true nearest offset (9.81 m) rather than 9.0 m;
- hand-derived cases: the harmonic Σ of half 1, half 0.25 is 0.40; a 6 m bed between 1.5H:1V batters
  measures 6 m with both shoulders and a 5 m drivable width when brush starts 2 m right of centre;
  shoulders found in 6 + 3 + 0 of 10 sections read 75 %; flight lines with medians 200 and 100 scale
  the second by 2.

Synthetic tests (`roadRelocation.test.ts`, `roadTrace.test.ts`, `roadSlices.test.ts`,
`roadLikeness.test.ts`, `vegetationEvidence.test.ts`) build a 1 m, 30 % sidehill with a 6 m bench at 3 %, 1.5H:1V batters, a 25 m
S-curve and 0.01 m noise, generated in the test:

- a record 8, 15 or 30 m east of the road, with a 3 m wobble, is moved onto it with P90 ≤ 1 m in
  both directions (measured: P50 about 0.1 m, P90 0.3–0.5 m), the bench is measured at 6 m with
  both batters in every section, and the median shift is reported as the offset;
- the same hillside with no bench, and flat ground with no bench, report **no road found** and
  return the record unchanged;
- a 20 m strip of missing terrain across the corridor reports missing terrain at its place;
- a road whose bench stops halfway is **found in part**, with the rest kept as the record;
- clicks every 100 m placed 8 m beside the bench trace a line with P90 ≤ 1 m; the same clicks on
  the plain hillside or flat ground stay straight;
- terrain of 22 m is refused, naming the regional DEM;
- with synthetic vegetation evidence over the same hillside (open bed under 20 m forest), the record
  is moved onto the road in terrain + vegetation mode and graded class 1 (score 100; drivable 5.8 m,
  vegetation 0.3 %, path conductivity 0.93, shoulders 100 %); with brush across the bed, the road is
  still found, by the terrain search, and graded class 3 (score 25: only the shoulders score);
- evidence covering a quarter of the corridor runs terrain only, with exactly the terrain-only
  result, and says why; a river across the corridor is crossed at the record and listed as a
  presumed structure;
- from a real decoded LAS and LAZ, every return reaches the evidence before thinning, with intensity,
  and the canopy the thinned cloud lost is still there.

Synthetic tests (`roadBatchFind.test.ts`, `roadReconnect.test.ts`, `RoadBatchFinder.test.tsx`)
build 1 m flat ground with 0.06 m pseudo-noise (so it scores near the floor) crossed by 8 m beds on
0.6 m fills, generated in the test (`roadNetworkFixture.ts`), with every record moved 6–9 m and
wobbled:

- a T junction of three records: each road's result is identical to searching it alone; found one
  by one their ends sit 5–9 m from the junction, and reconnecting puts all three ends on one point
  within 1.5 m of the true junction, with the through road as the through pair and every road
  within 1 m (P90) of its centreline; leaving the spur out rejoins the through road and reports the
  spur as not joined;
- a through road recorded as one line with a spur ending on it: the spur joins the found road
  within 1.5 m of the true junction and the through road is unchanged;
- a loop and the road into it: the loop is found in two halves (P90 within 1 m) and closed where
  the access road meets it, within 2 m of the true closure;
- a road whose terrain sampler fails is reported in its own row by name, and the others carry on;
  Cancel stops a run during the second road;
- geometry cases: the tie-break by class and score, half the through gap past the tolerance, a
  kept through road holding the junction, a spur that would move 35 m to meet the through road
  (left as found, where the reference description would have moved it), a loop alone, a loop with
  two other roads, two records ending 5 m apart whose found ends come within 1 m (never joined,
  listed as near misses).

No reference-run vectors exist for the network tools (the reference package's path search could
not be run, and its reconnection depends on it), so these cases are checked against the behaviour
described in the specification and against the synthetic truth.

**Real road (local only).** On the sample road shipped with the ALSroads R package (Québec, 1 m
ground model, 961 m), compared with that package's own corrected line, which is an estimate rather
than a survey:

| Case                 | Record → reference P50 / P90 / max (m) | Candidate → reference P50 / P90 / max (m) | Found |
| -------------------- | -------------------------------------- | ----------------------------------------- | ----- |
| As mapped            | 7.32 / 10.87 / 13.45                   | 0.98 / 2.61 / 7.75                        | 97 %  |
| Record moved 15 m E  | 7.95 / 19.63 / 28.43                   | 0.91 / 2.55 / 7.92                        | 96 %  |
| Record moved 25 m E  | 17.67 / 29.56 / 38.41                  | 0.93 / 2.55 / 12.64                       | 97 %  |
| Record moved 150 m W | no road there                          | no road found, record kept                | 0 %   |

The bench width along the found line was a median 8.0 m with both batters in 64–67 % of sections;
on the reference line it was 7.5 m (P10–P90 6.0–13.6 m), against 8.2 m from the package's point-cloud
measurement. The largest errors are at the ends. The sample is GPL-licensed package data and is not
in this repository. `roadRelocation.sample.test.ts` reruns this on any local folder named by
`ROAD_FIND_SAMPLE_DIR` (format in the test's header) and is skipped otherwise.

## Provenance

- **Specification.** Written from a clean-room functional specification of ALSroads 0.2.0 (R package,
  GPL-3, Université Laval) and the papers below. No code from ALSroads was used; the modules carry a
  header saying so. Option names in the spec are the package's user-facing names; PGMaps' own are
  different.
- **Papers.** Roussel et al. (2022), the conductivity, path search, cross-sections and state score;
  Roussel et al. (2023), the network extraction from the same conductivity and its aim of a
  topologically valid network, which the reconnection follows (the junction-to-junction extraction
  itself is not implemented here); Morley (2022), the ALSroads user guide, for the default
  thresholds, the parameter advice quoted in the settings' info tips, and the advice to reconnect
  corrected roads with the original network's topology.
- **Multi-road search and reconnection.** `roadBatchFind.ts` and `roadReconnect.ts` were written
  from the same functional specification's description of the package's batch measurement and its
  "snap road endings" tool with the original network: the through pair, the 7.5° tie and its
  class/score ranking, the half-gap tolerance (default 30 m), the loop rule and the extension of
  other roads to the through line. The spec's own test vectors do not cover these tools.
- **Reference run.** The test figures under **Validation** come from running the package's own,
  unmodified scoring, activation, line and difference code on synthetic inputs on 10 November 2026.
  Its conductivity raster, path search and slices could not be run there (their dependencies were
  missing), so the full pipeline is compared only on the sample road above, with the package's
  corrected line as the reference.
- **Deliberate differences from the reference.** A 1 m path grid, not 2 m (2 m blurred a 6 m bench);
  the found/not-found verdict per stretch, not a whole-road class; the found verdict on terrain
  road-likeness and a terrain search fallback, so a brushed-in road is graded rather than lost; the
  state over the found stretches, with the path score read without the pull and without the end
  caps; drivable width averaged from each section's own drivable width across pieces (the reference
  re-joins long roads with the road width as the drivable width); sinuosity of the found line, not
  the record; line shifts paired by nearest point, not by fraction along the line; vegetation
  profiles summed over 1 m evidence cells along each section rather than per return; the
  coarse ±7 m point-cloud re-centring of each section and the version-2 conductivity are not
  implemented. In the multi-road run: a road that fails is reported in its row by name (the
  reference drops it and names the wrong road); a loop record is searched in two halves in every
  run, single or many; ends are never clustered by distance alone (the reference's snapping without
  the original network joins any ends within the tolerance, which makes junctions the record does
  not have), so only that mode's near-miss list is kept; every road brought to the through line is
  held to the tolerance, not only its crossing's distance along it; a road without a candidate
  never moves; a loop with one other road is closed where that road crosses it rather than at the
  midpoint of the loop's ends; and a record end on another record's line is reconnected.

## References

- Roussel, J.-R., Bourdon, J.-F., Morley, I. D., Coops, N. C., & Achim, A. (2022). Correction, update,
  and enhancement of vectorial forestry road maps using ALS data, a pathfinder, and seven metrics.
  _International Journal of Applied Earth Observation and Geoinformation_, 114, 103020.
  [doi:10.1016/j.jag.2022.103020](https://doi.org/10.1016/j.jag.2022.103020)
- Roussel, J.-R., Bourdon, J.-F., Morley, I. D., Coops, N. C., & Achim, A. (2023). Vectorial and
  topologically valid segmentation of forestry road networks from ALS data. _International Journal
  of Applied Earth Observation and Geoinformation_, 118, 103267.
  [doi:10.1016/j.jag.2023.103267](https://doi.org/10.1016/j.jag.2023.103267)
- Morley, I. D. (2022). _User Guide: The ALSroads Package._
  [ilythiamorley.github.io/ALSroads_Guide](https://ilythiamorley.github.io/ALSroads_Guide)
- [Terrain and point clouds: limits and checks](terrain-and-point-clouds.md), for what makes a
  ground model trustworthy and how the vegetation evidence is kept.
- [Dated evidence for existing-road condition](road-condition-evidence.md), for how a recorded LiDAR
  state is reviewed and used.
- [Mapped roads as roads, and sketched roads](mapped-roads-and-sketching.md) and
  [Existing roads, condition and reuse](existing-roads.md), for the records these tools start from
  and the roads they add.
