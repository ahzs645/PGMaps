# Finding and tracing existing roads on the terrain

Two tools read existing roads off bare-earth terrain:

- **Find on terrain**, in the **Mapped road** panel, looks for the road bench near a loaded mapped,
  imported or traced road and offers a corrected copy. Government road lines are often digitized
  permit lines and can sit several metres, sometimes tens of metres, off the built road.
- **Trace road**, under **Design → Road**, takes clicks along a road seen on imagery. On fine
  terrain the line between clicks follows the road bench; elsewhere the clicks are joined straight.

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
- **The width is the bench, not the drivable width.** It is measured between the breaks of slope
  where the cut and fill batters start. Brush on the bed, ruts and rock are not seen; telling a
  clear running surface from an overgrown one needs the vegetation returns of an unthinned point
  cloud, which this tool does not use.
- **Nothing here says what condition a road is in.** A deactivated or overgrown road keeps its
  bench. The adopted or traced road starts with unknown condition and reuse off, like any import.

## Using it

### Find on terrain

1. Load the road: **Load as road** on its map card, or **Load mapped roads in view**.
2. In the **Mapped road** panel, choose **Find on terrain**. Progress and **Cancel** replace the
   button while it runs.
3. Read the result: whether a bench was found and along what share of the road, the shift from the
   record (median and P90, over the found stretches only), the bench width (median and P10–P90),
   how often both batters were seen, and the mean road-likeness along the path. Stretches with no
   bench, or no terrain, are listed by station; each links to that station.
4. The candidate is drawn as a purple dashed line over the record. **Adopt** adds it as a new
   existing road named "_record_ · on terrain"; **Discard** drops it. Adopt is offered only when a
   bench was found along at least 20 % of the road.

Where no bench was found, the candidate keeps the record's own line for that stretch, so an adopted
road never invents geometry the terrain did not support.

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
bench width (relocation) or the segment counts (trace). The road card shows it as **Line**. The
record is optional and bounded by `parseRoadLineOrigin` (`existingRoadEvidence.ts`); older project
files without it load unchanged.

## How it works

The method follows the ground-only part of Roussel et al. (2022), which corrects forest road maps
from airborne LiDAR with a least-cost path over a "conductivity" raster and then measures the road
in cross-sections. PGMaps uses only the terms that bare-earth terrain can supply. The paper's
point-cloud terms (canopy height over the bed, low vegetation, ground-return density and intensity)
are not used, so there is no drivable width and no vegetation score. This implementation was written
from the paper's description and our own reference scripts, not from the authors' code.

### Road-likeness (`roadLikeness.ts`)

The terrain is sampled at 1 m (`ROAD_FIND_SAMPLE_CELL_M`) in the terrain's own projected grid, and
each cell gets a score from 0.1 to 1, the product of three terms:

- **Slope**: 1 at 5° or less, falling linearly to 0 at 20° (Horn's 3×3 slope). A road bed is gentle.
- **Roughness**: each cell's departure from its own 5×5 mean, then the spread (max − min) of that
  departure over 3×3. 1 at 0.05 m or less, 0 at 0.10 m. A graded bed is smooth; stumps,
  windthrow and rock are not.
- **Slope edges**: 0 where the 3×3 Sobel gradient of the slope raster reaches 40 (degrees per cell),
  otherwise 1. These are the breaks at road edges, ditches and batters, so the search cannot run
  along a batter.

The product is floored at 0.1 so a short culvert fill or a rough patch stays passable. A cell whose
windows touch missing terrain is missing too: the score is never floored over a gap, and a gap
grows by three cells in the score.

### Following the road (`roadRelocation.ts`)

1. Only cells within the corridor (40 m either side of the line) can be used.
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
   pieces are joined end to end.

### Cross-sections and the verdict (`roadSlices.ts`)

Every 10 m along the path, a profile 15 m either side is sampled
every 0.5 m and smoothed over three samples. Its centre moves up to
2 m to the flattest point. Walking outward on each side, a **batter** starts where
the cross slope reaches 10° and ends where it drops back; it counts if it runs
at least 1 m across at that slope overall. The bench edge is where the batter
starts. A side with no batter takes the first point 0.15 m above or below the centre.

A section is a **bench** when its centre is flatter than the shoulder slope, at least one side has
a batter, and the width is between 2.5 m and 20 m. A section is
**found** when it is a bench and the mean road-likeness along the path within half a spacing is at
least 0.5. A section with any missing sample is **no terrain** and is left out of
every figure.

Runs of found and not-found sections shorter than 30 m take their neighbours' kind:
a culvert or a noisy section does not split the road, and one bench-like section does not make a
road. The candidate is then built stretch by stretch: the path where found, the record's own line
where not. The verdict is **found** when at least 80 % of the record's length was
found, **found in part** from 20 %, and **no road found** below that, when the
record is returned unchanged.

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

| Limit                                                                                       | Enforcing code                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Terrain coarser than 2 m per cell is refused by both tools                                  | `ROAD_FIND_MAX_CELL_M`, `roadFindingTerrainProblem`, `roadLikeness.ts`                                                |
| Terrain is sampled at 1 m for the search                                                    | `ROAD_FIND_SAMPLE_CELL_M`, `roadLikeness.ts`                                                                          |
| Slope 5–20°, roughness 0.05–0.10 m, slope-edge limit 40, floor 0.1                          | `DEFAULT_ROAD_LIKENESS`, `roadLikeness.ts`                                                                            |
| Search corridor 40 m either side, 10–80 m allowed                                           | `ROAD_FIND_CORRIDOR_M`, `MIN_ROAD_FIND_CORRIDOR_M`, `MAX_ROAD_FIND_CORRIDOR_M`                                        |
| Pull towards the line falls to 0.9 at the corridor edge                                     | `ROAD_FIND_CONFIDENCE`, `roadRelocation.ts`                                                                           |
| Lines 30 m to 20 km; searched in pieces of at most 1,000 m and 2,000,000 cells              | `ROAD_FIND_MIN_LENGTH_M`, `ROAD_FIND_MAX_LENGTH_M`, `ROAD_FIND_CHUNK_M`, `ROAD_FIND_MAX_CELLS`                        |
| A found section needs a bench and mean road-likeness 0.5                                    | `ROAD_FIND_MIN_LIKENESS`, `roadRelocation.ts`                                                                         |
| Stretches shorter than 30 m take their neighbours' verdict                                  | `ROAD_FIND_MIN_RUN_M`, `roadRelocation.ts`                                                                            |
| "Found" from 80 % of the length, "found in part" from 20 %, nothing offered below           | `ROAD_FIND_FOUND_SHARE`, `ROAD_FIND_PARTIAL_SHARE`, `roadRelocation.ts`                                               |
| Path smoothed over 7 vertices, candidate thinned at 0.5 m, shift sampled every 5 m          | `ROAD_FIND_SMOOTH_VERTICES`, `ROAD_FIND_SIMPLIFY_M`, `ROAD_FIND_SHIFT_STEP_M`                                         |
| Sections every 10 m, 15 m either side, sampled every 0.5 m, re-centred within 2 m           | `ROAD_SLICE_SPACING_M`, `ROAD_SLICE_HALF_WIDTH_M`, `ROAD_SLICE_STEP_M`, `ROAD_SLICE_RECENTRE_M`, `roadSlices.ts`      |
| A batter starts at 10° and must run 1 m; a level edge departs 0.15 m                        | `ROAD_SHOULDER_SLOPE_DEG`, `ROAD_MIN_EMBANKMENT_M`, `ROAD_FLAT_TOLERANCE_M`                                           |
| A bench is 2.5–20 m wide                                                                    | `ROAD_BENCH_MIN_WIDTH_M`, `ROAD_BENCH_MAX_WIDTH_M`, `roadSlices.ts`                                                   |
| Clicks snap within 5 m onto ground scoring at least 0.3                                     | `ROAD_TRACE_SNAP_M`, `ROAD_TRACE_SNAP_MIN_LIKENESS`, `roadTrace.ts`                                                   |
| Trace capsule 0.3 × chord, 20–60 m either side; clicks over 800 m apart are joined straight | `ROAD_TRACE_HALF_WIDTH_SHARE`, `ROAD_TRACE_MIN_HALF_WIDTH_M`, `ROAD_TRACE_MAX_HALF_WIDTH_M`, `ROAD_TRACE_MAX_CHORD_M` |
| A traced segment needs mean road-likeness 0.5 and a bench in half its sections              | `ROAD_TRACE_MIN_LIKENESS`, `ROAD_TRACE_MIN_BENCH_SHARE`, `roadTrace.ts`                                               |
| Off-road lead-ins up to 15 m at a click are dropped                                         | `ROAD_TRACE_MAX_LEAD_M`, `roadTrace.ts`                                                                               |
| The saved line origin's figures are bounded; out-of-range values refuse the file            | `parseRoadLineOrigin`, `existingRoadEvidence.ts`                                                                      |

Searches run in slices (`cooperative.ts`), so **Cancel** and the progress line work. A 560 m road
with a 40 m corridor takes well under a second; a 1 km trace segment explores fewer than 200,000
cells.

## Built-in assumptions

- The road was built with a bench: a flat or gently crowned bed between cut and fill batters, or
  between ditches. A road graded flush with the ground has no bench to find.
- The road runs within the corridor of the record (40 m by default) for its whole length.
- The record's ends are near the road's ends. The end caps let the path join the road anywhere
  across each end, but not further along it.
- The road has no gaps longer than the terrain's own gaps: missing ground is never crossed.
- The score's thresholds are tuned for 1 m cells with little noise (standard deviation about
  0.01 m); the edge limit is per cell, not per metre.

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
- **Water and bridges.** No water mask is applied. A lake or river left as missing terrain blocks
  the search and is reported as missing terrain; a crossing modelled as a water surface may simply
  be a short not-found stretch.
- **Record ends far along the road.** An end 20 m short of or beyond the real road's end leaves an
  end error of about that size, because the caps sit across the ends, not along them.
- **Piece joins.** A road searched in pieces is joined with a short straight piece where two pieces
  meet; both sides are on the road, so the join is along it, but it is not smoothed.
- **Missing terrain inside the corridor.** A gap that crosses the whole corridor stops the search
  with "terrain incomplete" and names where along the line; a gap beside the road is skipped
  around, and sections that touch it are **no terrain**, kept as the record.

## Validation

Synthetic tests (`roadRelocation.test.ts`, `roadTrace.test.ts`, `roadSlices.test.ts`,
`roadLikeness.test.ts`) build a 1 m, 30 % sidehill with a 6 m bench at 3 %, 1.5H:1V batters, a 25 m
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
- terrain of 22 m is refused, naming the regional DEM.

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

## References

- Roussel, J.-R., Bourdon, J.-F., Morley, I. D., Coops, N. C., & Achim, A. (2022). Correction, update,
  and enhancement of vectorial forestry road maps using ALS data, a pathfinder, and seven metrics.
  _International Journal of Applied Earth Observation and Geoinformation_, 114, 103020.
  [doi:10.1016/j.jag.2022.103020](https://doi.org/10.1016/j.jag.2022.103020)
- [Terrain and point clouds: limits and checks](terrain-and-point-clouds.md), for what makes a
  ground model trustworthy.
- [Mapped roads as roads, and sketched roads](mapped-roads-and-sketching.md) and
  [Existing roads, condition and reuse](existing-roads.md), for the records these tools start from
  and the roads they add.
