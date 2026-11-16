# Mountain forest road routing paper: what the road designer can take from it — 15 November 2026

This note reviews one paper against `/dev/forestry/road-design`. It records what the paper does,
what PGMaps already covers, four ideas worth building, and how each one behaves where there is no
LiDAR. Nothing here is built yet. The figures in this note were measured or computed on 15
November 2026 and are stated with their source.

**Paper:** Gołąb J., Pirowski T. (2019). An Attempt at the Automation of the Routing of Mountain
Forest Roads with the Use of GIS Spatial Analyses. *Geomatics and Environmental Engineering* 13(4),
17–32. <https://doi.org/10.7494/geom.2019.13.4.17>. The paper's PDF is not kept in the repository.

## What the paper does

The authors tried automatic least-cost routing on a 1 m DTM of the Łopień forest complex in the
Beskid Wyspowy (Poland; 460–951 m, mean fall over 17°, roughly 31 %), and gave up on it. They report
that cost surfaces could not express the road's purpose (reaching whole slopes, not joining two
points) and that the terrain decided the route anyway. They fell back to a semi-automatic method in
QGIS and ILWIS:

1. Map the areas no road may enter (other ownership, reserves, Natura 2000, spring buffers, landslides).
2. Sketch the network concept on a contour map, with each road's function and class.
3. Place junctions, including wherever a road must change direction sharply.
4. Draw a straight *direction line* between neighbouring junctions and take its azimuth.
5–7. Compute X and Y terrain gradients once, then a "directed inclination" raster for each line's
   azimuth (formulas 1–4 below).
8. Route each corridor by eye over the contours, the exclusions and that line's raster.
9. Draw the terrain profile along each corridor and check its grades (their examples: mean 12.1 % and
   9.9 %, maxima 49 % and 46 %) against the standard (9 %, 12 % on short sections).

Their findings, which are judgements from one site and not measured results:

- The network concept and where the junctions go decide most of the outcome.
- The steeper a direction line cuts across the contours, the further the real corridor has to stray
  from it. Section 6 had a mean of 18.5 % and a maximum of 55.4 % along its direction line, and its
  corridor ended up "completely different" from the line.
- Junctions too far apart over broken ground make the raster analysis useless. Junctions too close
  together make it slow.
- Short, local grade excesses can be fixed in detailed design. Long ones mean the corridor has to be
  routed again.

## What PGMaps already covers

| Paper step | PGMaps equivalent |
| --- | --- |
| 1 Exclusion layer | Avoid areas as Excluded, Conditional or priced ([Streams and constraints](streams-and-constraints.md)) |
| 2–3 Network concept, junctions | Sketched roads, the network tools, sketch points as corridor guides |
| 5–6 X and Y gradients | The plan's slope and aspect layers (`terrainDisplay.ts`) |
| 8 Routing at grade by hand | **Peg at grade** ([Plan tools](plan-tools.md)), **Find the best route**, the corridor optimizer |
| 8 Routing automatically | `routing.ts`: every edge is checked against the grade limit, with direction-dependent limits (`HaulGradeLimits`) and the 12 m ground trend on LiDAR |
| 9 Profile check | Profile grade colouring, **Colour by grade**, Review's grade row with the short-pitch allowance (`designStandards.ts`) |

What is missing is step 4–7's idea of reading the ground's grade *by direction*, plus anything that
says up front whether a leg is reachable at all.

## The terrains this note considers

`groundWindowFor` (`groundTrend.ts`) applies the 12 m ground trend only on cells of 3 m or finer.
Every coarser terrain is read as it comes. The terrains a BC road may sit on, as measured on the
reference block in [Terrain sources for a road with no published LiDAR](../research/bc-road-terrain-sources-2026-11-12.md):

| Terrain | Cell | Read through |
| --- | --- | --- |
| LidarBC or HRDEM LiDAR | 1–2 m | 12 m ground trend |
| Regional Terrarium tiles | about 22 m at the reference block | raw |
| BC CDED (TRIM air photos) | 0.75″ posts, about 14 m east–west × 23 m north–south at 54° N | raw |
| Company map PDF contours (`src/lib/geoPdf/`) | TIN between contours; regional fill beyond them when widened (`fillBeyondContours`) | raw |
| NRCan MRDEM | 30 m | not wired |

On the reference block (no public LiDAR), all three coarse sources agree that side slopes reach
60 % and more on long stretches: 47 stations on MRDEM and 68 on CDED. That steepness is what makes
ideas 1 and 3 matter.

## 1. A "grade along a heading" layer on the plan

### What it shows

Ground of slope *s* (the gradient's magnitude, as a ratio) gives a road heading at angle θ off the
contour a ground grade of *s*·sin θ. A road held at grade limit *g* can therefore turn at most

  θmax = asin(*g* / *s*)

off the contour, either way along it. Where *s* ≤ *g*, any heading works. The layer shades each
cell by θmax instead of by *s*:

| *s* at *g* = 12 % | θmax |
| --- | --- |
| 12 % or less | any heading |
| 20 % | 36.9° |
| 30 % | 23.6° |
| 40 % | 17.5° |
| 60 % | 11.5° |

A narrow band reads "run along the contour or switchback here", which slope alone does not say. It
ties two existing findings together:

- The layout person's TFL 30 roads ran a median 18° off the contour on ground steeper than 10 %
  ([Field review, 10 November 2026](field-review-and-reference-repos-2026-11-10.md)).
- Rule R4 of [In-block road layout by slope](bc-access-research-layout.md) sets the in-block grade at
  *k* × slope, with *k* from 0.37 to 0.20. That is sin θ, so the roads run asin(*k*) off the contour:
  21.7° on gentle ground, 11.5° on the steepest.

With directional haul limits set, the uphill and downhill cones differ: θup = asin(*g*up/*s*) and
θdown = asin(*g*down/*s*). The layer can show the narrower of the two, or the one for a chosen haul
direction.

A second mode follows the paper: give a heading (typed, or taken from a drawn direction line or the
active road's leg) and shade the signed ground grade along it.

### The formula: use the exact one, not the paper's

The grade along azimuth *A* (clockwise from north), with *zx* = ∂z/∂x to the east and *zy* = ∂z/∂y
to the north, is

  *iA* = *zx*·sin *A* + *zy*·cos *A*

`buildTerrainDisplay` already computes *zx* and *zy* for every display pixel (`terrainDisplay.ts`,
the central or one-sided differences behind hillshade, slope and aspect), so the layer is one more
output of that loop.

The paper's formulas (1)–(4) instead blend the two components by angle. For the first quadrant:
*iK* = (|*iY*|·(90 − *A*) + |*iX*|·*A*) / 90, with the other quadrants alike. This assumes that
"mod" means absolute value and that X is east, which matches the ILWIS output in their Fig. 3. Two
worked cases show what goes wrong, both at *A* = 45°:

- **Ground falling 20 % east and rising 20 % north.** The contour runs north-east, so a line at 45°
  follows it and its true grade is 0 %. The paper's formula reads 20 %.
- **Ground rising 20 % east and 20 % north.** The true grade is 28.3 %. The paper's formula reads
  20 %, about 29 % low.

So the paper's raster can read a line along the contour as steep, and it loses the difference
between uphill and downhill. Do not reproduce it, even as a "paper" option.

### Without LiDAR

The layer works on any terrain, and it is likely *more* useful off LiDAR. There, design depends on
reconnaissance at the scale of hundreds of metres, which is the scale the paper used it at.

| Terrain | What to expect | What the layer must do |
| --- | --- | --- |
| LiDAR | Micro-relief is already averaged out at plan scale (see the baseline note below) | Nothing extra |
| Regional, about 22 m | Short steep pitches (gully walls, benches) are smoothed, so *s* reads low and θmax reads wide. That is optimistic, but at hillside scale it agreed with CDED and MRDEM on the reference block | Name the terrain and its cell in the legend |
| CDED | Posts are 14 m apart east–west and 23 m north–south, so neighbour differences use different baselines in x and y. A north–south heading is read over a longer distance than an east–west one | Take *zx* and *zy* over one square window in metres, ±30 m (tested below), not from neighbouring posts |
| PDF contour TIN | A triangle with all three corners on one contour is a flat terrace and would read "any heading". Between contours, crests and valley floors read as planes | Read the gradient over ±30 m (tested below: 94 % same band as LiDAR, against 77 % at a point), and show terrace triangles as unknown where a reading falls inside one. Leave the regional fill beyond the contours marked as the fill's cell size |

**Baseline note.** The plan's display grid is about 192 pixels across (`PLAN_TERRAIN_DISPLAY_SIDE`),
and a central difference spans two pixels. The gradient's baseline therefore grows with the
terrain's extent: about 21 m on a 2 km terrain and 100 m on a 10 km one. The slope layer has the
same property today. The heading layer should state its baseline, because θmax depends on it.

### Tested on real roads

Bench: every built road of the reference set at least 200 m long, sampled every 20 m (25,698
samples). The gradient is a central difference over ±30 m and the measured grade comes from 40 m
chords along the road, both on Terrarium zoom 13.

**Formula.** Predicting the ground grade along each road from its heading:

| Formula | Mean error | Bias | Correlation with measured |
| --- | --- | --- | --- |
| Exact, *zx*·sin *A* + *zy*·cos *A* | 0.94 points | −0.19 | 0.965 |
| The paper's (1)–(4) | 3.26 points | +1.72 | 0.584 |

The exact formula also gets uphill and downhill right on 99.8 % of samples steeper than 3 %.

**How real roads sit in the proposed bands** (room at 12 %):

| Band | Share of road samples | Side slope | Real road off the contour, median / 90th pct | Road grade within 12 % |
| --- | --- | --- | --- | --- |
| Any heading | 57 % | 0–12 % | 37° / 79° | 99.4 % |
| ±30° or more | 29 % | 12–24 % | 21° / 58° | 84 % |
| ±15–30° | 13 % | 24–46 % | 13.5° / 35° | 72 % |
| ±8–15° | 0.8 % | 46–71 % | 11° / 35° | 57 % |
| Under ±8° | 0 | over 86 % | – | – |

The bands order real behaviour well: the tighter the band, the closer the roads hold to the
contour. Two corrections follow.

- **Merge the last two bands as "Under ±15°".** On regional terrain at 12 %, *under ±8°* needs side
  slopes over 86 % and never occurred in 25,698 samples. Keep the finer split only for LiDAR, where
  short steep faces survive.
- **Read the tight bands as "roads here run steeper than the limit in places".** In the ±8–15° band,
  43 % of real road samples read steeper than 12 % on this terrain: short pitches, DEM smoothing and
  mapped-line position error together. The legend should say so rather than call the ground
  impassable.

**Context.** By side slope, the real roads ran a median of 24° off the contour on 10–20 % ground,
15° on 20–30 %, 13° on 30–40 %, 11° on 40–60 % and 9° on steeper ground (22 samples). This agrees with
the layout study's R4 (21.7° down to 11.5°).

### Tested on steep ground, against LiDAR

The steep bench of idea 3 (below): 162 legs fully covered by NRCan HRDEM 1 m LiDAR, 7,617 road
samples, median side slope 44 % (90th percentile 64 %). LiDAR is read at its 2 m overview, with the
gradient over ±30 m. The same ±30 m reading on each coarse terrain is compared with it.

**Bands against LiDAR** (room at 12 %):

| Terrain | Same band as LiDAR | Within one band | Reads more room than LiDAR | Median slope bias |
| --- | --- | --- | --- | --- |
| Terrarium | 70.5 % | 99.2 % | 13.9 % | +0.5 points |
| CDED, ±30 m | 70.0 % | 99.3 % | 14.2 % | +0.5 |
| CDED, neighbouring posts | 67.8 % | 98.9 % | 15.3 % | +0.5 |
| CDED, square window at the coarser post spacing | 68.8 % | 99.1 % | 14.8 % | +0.5 |
| MRDEM 30 m | 84.6 % | 99.7 % | 7.9 % | −0.2 |
| 10 m contour TIN, ±30 m | 93.6 % | 100 % | – | −0.1 |
| 10 m contour TIN, at a point (±3 m) | 77.1 % | 98.8 % | – | – |

- **On coarse terrain, trust the band to within one.** It matches LiDAR's band seven times in ten and
  is within one band 99 % of the time. When wrong, it errs toward more room, as expected from
  smoothing.
- **CDED: read over a square window, ±30 m best.** Neighbouring posts are the worst CDED reading.
  For east–west roads they add 0.5 points of grade error over Terrarium (8.37 against 7.86 points
  mean error), where a square window at the coarser post spacing adds 0.1. North–south roads show no such difference.
  The effect is real but small.
- **Contour terrain: read over a window, and terraces barely matter on steep ground.** The contour
  terrain was built by the app's own `contourSurface` from 10 m contours traced on the LiDAR
  (smoothed over 10 m first, every line labelled), on 125 legs. Read over ±30 m it matches LiDAR's
  band on 93.6 % of road samples. Read at a point it matches 77 %. Only 1.0 % of road samples
  fell on a flat terrace, because contours are close together on steep ground. These are ideal
  contours: a company sheet's, with unlabelled lines and gaps, read 60 %+ slopes low
  ([Source PDF import](source-pdf-import.md)).
- **On LiDAR the bottom band does occur.** *Under ±8°* held 1.2 % of road samples (side slopes over
  86 %), so keep it on LiDAR and contour terrain and merge it on regional terrain, as above.
- **A narrow baseline reads the road bench.** At ±12 m the LiDAR slope along existing roads is 3.5
  points lower than at ±30 m, because the window straddles the road's own cut and fill. Keep the
  layer's baseline at plan scale (about ±30 m) on LiDAR too.

**How real steep roads sit in the bands (LiDAR, room at 12 %):**

| Band | Share | Off the contour, median / 90th pct | Grade within 12 % / 16 % / 20 % |
| --- | --- | --- | --- |
| Any heading | 0.7 % | 32.5° / 77° | 93 / 96 / 98 % |
| ±30° or more | 5.6 % | 26.1° / 65° | 74 / 89 / 93 % |
| ±15–30° | 50.8 % | 14.9° / 36° | 62 / 79 / 90 % |
| ±8–15° | 41.6 % | 10.0° / 23° | 59 / 75 / 86 % |
| Under ±8° | 1.2 % | 7.1° / 19° | 55 / 67 / 78 % |

The order holds on steep ground too: the tighter the band, the closer real roads stay to the
contour, and the more of their length runs over 12 %. These steep roads were built to steeper
standards than 12 %: by the measured grade, 78–98 % of their length (by band) is within 20 %.

### Limits

It is a screen of the ground. It does not know the road's cut and fill, so it says nothing about
full bench or where a batter will catch, and it is not a search input. Keep the computation in a
DOM-free module (for example `headingGrade.ts`) with tests on planes of known slope and aspect,
including the contour-following case above.

## 2. A leg check before the search

### What it computes

For a leg between two controls (the ends of **Find the best route**, or consecutive points of a
sketched corridor):

- Δh: the elevation difference between the ends, and *d*: the plan distance.
- Straight-line grade Δh / *d*, compared with the limit for the leg's direction (`directionalGradeLimit`).
- Shortest road that could make the climb: *L*min = |Δh| / *g*.
- Development ratio *L*min / *d*. Above 1, the road must be at least *L*min − *d* longer than the
  straight line. That means wandering across the slope or a switchback.

The endpoints alone miss a ridge or gully between them. A second figure reads the ground profile
along the straight line and adds up every rise and every fall: (Σ rises / *g*up) + (Σ falls /
*g*down). **This is not a lower bound** (tested below): a road can go round a ridge instead of over
it. Label it "straight over the top: at least … m", never "needs at least".

Example wording: "Leg 2 climbs 145 m in 820 m (17.7 %). At 12 % a road needs at least 1,208 m:
388 m more than the straight line, or a switchback." This is instant arithmetic. It can run as
the user places points, sit beside **Try steeper grades** (`steeperGrades.ts`, which re-runs the
search), and go into **Find the best route**'s failure text through the same failure record as its
plan mark (`routeSearchStop.ts`).

The paper's finding on junction spacing suggests one more hint: a leg whose straight-line profile
runs over the limit for long stretches is one where a control point between them would help.
Offer the hint only on a leg that is already flagged; never add the point. Shown on every leg
whose straight line has a steep chord, it would fire on 44 % of the real legs tested below.

### Tested on real roads

Bench: the 218 access legs of the [block–road reference set](../../examples/forestry/access-history/reference-pairs/README.md)
that run at least 200 m outside their block with ends at least 100 m apart (median length 693 m,
straight 591 m). Each leg is the built FTEN road outside the block. Terrain: the regional Terrarium
tiles at zoom 13 (`scripts/forestry/access-research/dem.py`), profiles on 40 m chords.

- **The endpoint bound holds.** At 12 %, only 2 of 218 real roads (0.9 %) are shorter than *L*min.
  Those 2 must run steeper than 12 % somewhere on this terrain. At 16 %, none are.
- **It is quiet.** Most access legs are gentle: the median straight-line grade is 2.6 %, the 90th
  percentile 9.1 %. At 12 %, 12 legs (5.5 %) are flagged; at 16 %, 3.
- **It is informative only when it flags.** Below a ratio of 1 it says nothing about how much a road
  wanders: the real roads' median sinuosity is 1.08 at ratios of 0–0.5 and 1.08 at 0.5–1. Above 1, it
  rises to 1.21 (ratio 1–1.5, 9 legs) and 2.27 (above 1.5, 3 legs).
- **The rises-and-falls figure overstates.** On 27 legs (12 %), the straight line's total rise and
  fall exceeds the real road's by more than 25 %: the road went round, not over.

**Two independent terrains agree.** At the same leg ends, the NRCan MRDEM 30 m DTM (read by HTTP
range from `canelevation-dem`, mostly Copernicus) and Terrarium differ in Δh by a median of 3.5 m
(90th percentile 8.9 m, maximum 19.2 m). That is a straight-line grade difference of 0.55
percentage points at the median, 2.2 at the 90th percentile and 6.9 at most. At 12 % the flag
agrees on 97.2 % of legs, and at 16 % on 99.5 %. Every disagreement was a borderline leg needing
0–90 m extra on one terrain and a similar small figure on the other. The large flags agreed: 288 m
against 302 m, 144 m against 156 m.

**On steep ground, against LiDAR.** On the 162 LiDAR-covered legs of the steep bench (idea 3;
median straight 716 m, LiDAR straight-line grade median 9.5 %, 90th percentile 24 %), each coarse
terrain's Δh was compared with LiDAR's:

| Terrain | Δh error, median / 90th pct / max | Grade error, median / 90th pct | Flag agrees with LiDAR at 12 / 16 / 20 % |
| --- | --- | --- | --- |
| Terrarium | 3.3 / 13.3 / 27.5 m | 0.53 / 1.90 points | 96.9 / 96.9 / 98.8 % |
| CDED | 3.2 / 13.1 / 28.0 m | 0.54 / 1.91 points | 96.3 / 96.9 / 99.4 % |
| MRDEM 30 m | 2.4 / 7.2 / 15.5 m | 0.37 / 1.15 points | 96.3 / 98.8 / 98.1 % |
| 10 m contour TIN (125 legs) | 0.8 / 2.4 m | – / 0.41 points | – |

LiDAR flagged 60 of the 162 legs at 12 %, 39 at 16 % and 29 at 20 %. Every coarse terrain flagged
within 3 of those numbers.

So the extra length should be printed with its terrain uncertainty, about (90th-percentile Δh
error) / *g*. At 12 % that is about ±110 m on Terrarium or CDED in steep country (±75 m on gentle
ground), ±60 m on MRDEM and ±20 m on a well-labelled contour terrain: "about 390 m more (±110 m on
regional terrain)". Below that margin, say *borderline* rather than flagging. On LiDAR the margin is
the ground trend's, a few metres.

### Without LiDAR

This is the most robust of the four ideas off LiDAR, because it rests on an elevation difference
over a long distance.

- **Elevation error barely moves it.** On the reference road, CDED and the regional terrain agreed
  within about 3 m at the road's start. Over a 500 m leg, 3 m is 0.6 percentage points of grade.
- **A constant datum offset cancels** when both ends are on the same surface. A PDF contour terrain
  with regional fill is the exception. The contour surface sits about 1.5 m below the regional DEM,
  mostly as a constant ([Source PDF import](source-pdf-import.md)), so a leg with one end on
  contours and the other on fill (`terrain.fill`) carries that offset. Say so beside the figure.
- **Read the rises-and-falls figure on the ground trend on LiDAR.** Raw 1 m samples add every stump
  hole to the total climb. It is a "straight over the top" figure on any terrain, not a bound.
- **Missing ground at an end makes the leg unknown, never 0 %.** In the profile version, a gap
  makes the total "at least" the known part.

Keep it DOM-free with the other route-search screens.

## 3. Finer search headings: 16 ("knight's move") and 32 directions

### Why it matters more than the zig-zag

`routing.ts` searches eight neighbours (`moves`). It refuses any edge with a sub-step steeper than
the limit (`segmentCost` returns `Infinity`). The grid's directions are 45° apart, and a road on a
steep sidehill may only head within θmax of the contour. Pulling the path taut afterwards
(`MAX_TAUT_LEG_M`, 600 m) can only straighten a path the grid found.

To reach an end point that is not exactly on one grid line, the search needs **two** grid lines that
hold grade, so it can zig-zag between them. One line and its reverse only let it move back and forth
along that line. (An earlier draft of this note counted one edge as enough, which understated the
problem; the measured searches below settle it.)

Share of contour orientations on a uniform plane (0–180° in 0.05° steps) where at least two grid
lines hold grade, against the share where the real search found a route. Measured: `suggestRoutes`
on a computed plane, from a fixed start to an end 1.5 km away that climbs at 0.7 *g* (so a straight
road is feasible), at 36 contour orientations 5° apart, with the ground trend off.

| Side slope at *g* = 12 % | 8 directions: computed / measured | 16 directions: computed / measured | 32 directions: computed |
| --- | --- | --- | --- |
| 20 % | 64 % / – | 100 % / – | 100 % |
| 25 % | 27 % / – | 100 % / – | 100 % |
| 30 % | 4.8 % / 2 of 36 | 93 % / 34 of 36 | 100 % |
| 40 % | 0 % / 0 of 36 | 55 % / 20 of 36 | 98 % |
| 50 % | 0 % / 2 of 36 | 23 % / 10 of 36 | 90 % |
| 60 % | 0 % / 0 of 36 | 10 % / 4 of 36 | 77 % |
| 70 % | 0 % / 0 of 36 | 2.9 % / 0 of 36 | 63 % |

The side slope up to which each grid reaches every contour orientation is *g* / sin(half the widest
pair of neighbouring gaps between its lines):

| Directions | Room needed | At 12 % | At 16 % | At 20 % |
| --- | --- | --- | --- | --- |
| 8 | ±45° | 17.0 % | 22.6 % | 28.3 % |
| 16 (adding (2, 1)) | ±26.6° | 26.8 % | 35.8 % | 44.7 % |
| 32 (adding (3, 1) and (3, 2)) | ±18.4° | 37.9 % | 50.6 % | 63.2 % |

Above those slopes, whether a grid reaches a face depends on how its contours lie.

So the current search cannot cross a uniform sidehill much steeper than 25 % at a 12 % limit unless
the contour happens to line up with the grid. It answers "No terrain-cost path … meets the 12 %
sampled ground-grade limit", which reads as a fact about the ground. Where some edge holds grade but
not along the wanted direction, the path alternates between the nearest feasible directions. That is the existing known issue "Route is a zigzag of 45° legs"
([Alignment and optimization](alignment-and-optimization.md)). The skid spur that zig-zagged across
a slope and was fitted straight up it (the `roadFromRoute` rule) is consistent with this, but has not
been shown to come from it.

This is the idea Yu, Lee & Munro-Stasiuk (*International Journal of Geographical Information
Science* 17(4), 361–376) describe as an extension to least-cost paths for roadway planning. The paper
under review cites it as reference 14.

### Cost and safety

- The node count is unchanged: the grid is still at most 96 × 96 (`MAX_GRID_SIDE`), and
  `MAX_VISITED` still applies.
- Terrain samples per expanded node rise about 2.9× (edge lengths 4 × 1 + 4 × √2 + 8 × √5 grid steps,
  against 4 × 1 + 4 × √2). `MAX_TERRAIN_SAMPLES` (450,000) will be reached sooner on long searches.
- Exclusion outlines and streams are tested along each edge's whole length (`segments`,
  `segmentDistance`/`intersects`), so a longer edge cannot jump one. Priced and avoidance zones are
  sampled at every sub-step, as now.

### Tested on real roads

The same 218 access legs as the leg check, searched from one end to the other on Terrarium zoom 13
with the ground trend off. The experiment patched a throwaway copy of `routing.ts` to add the moves;
the app's code is unchanged.

| Grade limit | 8 directions | 16 directions | 32 directions | 16 vs 8: gained / lost |
| --- | --- | --- | --- | --- |
| 10 % | 151 found, 19 ms | 178 found, 46 ms | 139 found, 100 ms | +32 / −5 |
| 12 % | 167 found, 19 ms | 199 found, 45 ms | 147 found, 95 ms | +35 / −3 |
| 16 % | 197 found, 19 ms | 208 found, 42 ms | 154 found, 90 ms | +14 / −3 |

- **Sixteen directions solve 11–32 more of the 218 legs** (5–15 % of them) for about 2.3× the time. That is still tens of
  milliseconds a search.
- **They find them as close to the built road.** On legs whose real road holds the limit on this
  terrain (89 legs at 12 %), the found route's mean distance from the built road has a median of
  20 m (22 m with eight directions), and its length is 1.01× the built road's (1.00×).
- **Every loss is a budget or retry, not a missing route.** At 12 %, the 3 legs eight directions
  solves and sixteen do not end in "Candidate paths failed the finer terrain check" (2) or the
  sampling budget (1). Longer edges pass the coarse check more often and then fail the 1 m one, and
  the search gives up after four tries. A fallback rerun with eight directions on those two errors
  keeps all of them.
- **Thirty-two directions lose to the budget.** 59 of their 71 failures at 12 % are
  `MAX_TERRAIN_SAMPLES`. With the budget raised 4×, they find 199 legs, the same as sixteen, at
  2.5× sixteen's time.
- **Zig-zag is only partly fixed.** On legs both settings solve at 12 %, sixteen directions cut the
  worst routes' turning (90th percentile 2,368° per km to 1,829°). The typical route turns about as
  much (median 580° against 618°, before `roadFromRoute` fits it).
- **The bench is gentle ground.** The median side slope along these legs is 10 % (90th percentile
  23 %), and only 15 legs reach 25 %. The steep bench below settles the steep case.
- **Thirty-two directions with the budget raised lose nothing here.** They gain the same 35 legs as
  sixteen at 12 % and lose the same 3, all to the finer-check retries.

### Tested on steep ground, against LiDAR

**The steep bench.** FTEN road sections (any file type except pending) in nine areas where the
NRCan HRDEM 1 m LiDAR mosaic has data: Sunshine Coast, Squamish, Harrison, Chilliwack, Hope,
Nelson, Kaslo, Port Alberni and Revelstoke. Coverage was checked by reading the mosaic's 64 m
overview, 20–92 % per area. Sections were cut into 800 m legs, and 30 legs a box were kept where the
median side slope on Terrarium was 35 % or more: 270 legs, median side slope 44 %. Of these, 162
are covered by LiDAR along their whole length. The FTEN lines are mapped, not surveyed: even on
LiDAR, the grade measured along them differs from the predicted ground grade by 4.9 points on
average, so a road's own grade here is approximate.

Each leg was searched end to end on four terrains: LiDAR (the HRDEM mosaic's 2 m overview, read
through the 12 m ground trend as the app does), Terrarium zoom 13, BC CDED (through the app's
`cdedFromDownload`) and MRDEM 30 m. Thirty-two directions ran with `MAX_TERRAIN_SAMPLES` raised 4×.

Routes found on the 162 LiDAR-covered legs. "Road holds" counts the legs whose built road keeps its
90th-percentile 40 m chord grade within the limit on that terrain, so a route surely exists there.

| Terrain, limit | 8 directions | 16 directions | 32 directions | Road holds: 8 / 16 / 32 |
| --- | --- | --- | --- | --- |
| LiDAR, 16 % | 4 | 47 | 99 | 4 / 28 / 53 of 81 |
| LiDAR, 20 % | 13 | 106 | 127 | 13 / 81 / 95 of 120 |
| Terrarium, 16 % | 3 | 69 | 112 | 3 / 31 / 44 of 61 |
| Terrarium, 20 % | 26 | 124 | 139 | 21 / 81 / 88 of 100 |
| CDED, 16 % | 4 | 71 | 111 | 3 / 30 / 43 of 62 |
| CDED, 20 % | 33 | 121 | 137 | 27 / 77 / 88 of 101 |
| MRDEM, 20 % | 14 | 47 | 56 | 10 / 34 / 40 of 121 |

At 12 %, eight directions found nothing on any terrain, sixteen 4–17 and thirty-two 25–62.

- **The current search effectively fails on steep ground.** Where the built road holds a 20 %
  limit on LiDAR, eight directions find a route for 13 of 120 legs. Sixteen find 81 and thirty-two
  95.
- **Finer directions also follow the built road more closely.** On those legs at 20 % on LiDAR, the
  found route's mean distance from the built road has a median of 35 m with eight directions, 11 m
  with sixteen and 9 m with thirty-two. On Terrarium it is 30, 22 and 19 m.
- **The cost is small.** Mean search time with thirty-two directions was 67 ms on Terrarium and
  167 ms on LiDAR at 20 %.
- **MRDEM lags on every grid.** It finds few routes even where the road holds grade, which suggests
  short steps in that product that a strict 1 m check refuses. Not investigated; MRDEM is not wired
  into the app.
- **Remaining failures** are mostly "No terrain-cost path". Some are real (the road's own grade
  exceeds the limit in places), and some are the corridor margin. A few are the finer-check retry.

### Plan

1. Search on **thirty-two directions** by default, with `MAX_TERRAIN_SAMPLES` raised to match (4× was
   enough on both benches). Store it as `routeSearch.neighbourhood` (8 | 16 | 32), with absent meaning
   32 for new projects and 8 for saved ones, so a saved project's results do not move.
2. On "failed the finer terrain check" or a sampling-budget error, rerun on eight directions before
   reporting. That keeps every leg eight directions solved on both benches.
3. Raise the finer-check retries for longer edges, or check long edges at 1 m in the first pass.
4. Check that the switchback search, route comparison, `roadFromRoute` and their tests still pass.
   Rerun both benches with the experiment patch (kept with the scratch scripts, not in the
   repository) after any change.
5. An any-angle (Theta*-style) search would remove the quantisation entirely. Revisit only if
   thirty-two directions fall short on a road the forester can see is possible.

### Without LiDAR

The grid does not depend on the terrain: its spacing is max(2 m, box / 95), so a 3 km search runs on
about a 32 m grid on any terrain. What changes is how steep the ground reads, and steepness is
where the eight-direction grid fails. The steep bench confirms it on Terrarium and CDED as much as
on LiDAR (table above). Both coarse terrains found more routes than LiDAR, because they read short
pitches gentler. The reference block, with no public LiDAR, has dozens of stations at side slopes of
60 % and more, the same ground as the steep bench. Each sub-step is
min(5 m, max(0.5 m, spacing / 5)), so on a coarse grid a 70 m knight edge is still read every 5 m.

## 4. Terrain stability mapping as a constraint

### The layer, verified

DataBC publishes BC's terrain stability mapping over WFS as
`WHSE_TERRESTRIAL_ECOLOGY.STE_TER_STABILITY_POLYS_SVW`. Checked on 15 November 2026:

- **413,289 polygons** province-wide.
- **Fields include** `SLOPE_STABILITY_CLASS_W_ROADS`, `SLOPE_STABILITY_CLASS_TXT`,
  `POLYGON_STABILITY_CLASS_TYPE`, `LNDSLDE_IND_STRM_SDMNTN_CLASS`, `SURFACE_EROSION_POT_CLASS`,
  `DRAINAGE_LBL`, `SLOPE_RANGE_LBL`, `PROJECT_MAP_SCALE` and `FIELD_CHECK_OF_POLYGON`.
- **In the first 400 rows**, `SLOPE_STABILITY_CLASS_W_ROADS` read IV ("Potentially unstable") 215
  times, V ("Unstable") 136 times and `0` ("Invalid stability code") 47 times. `PROJECT_MAP_SCALE`
  was empty on all 400.
- **Related layers:** `STE_TER_INVENTORY_POLYS_SVW` (terrain inventory) and
  `STE_TER_PROJECT_BOUNDARIES_SVW` (the mapping projects' outlines).

Coverage is by mapping project and patchy:

| Box (CQL `BBOX`, longitude first) | Polygons |
| --- | --- |
| 53.5–54.5° N, 121.5–123.5° W (around Prince George) | 0 |
| 53–55.5° N, 120–124° W | 20,767 |
| 48.5–49.5° N, 124–125.5° W (south Vancouver Island) | 8,362 |

So no polygon does not mean stable ground. Read the project boundaries as well, so the screen can
say "not mapped" apart from "mapped, no unstable polygon here".

**The class field holds three schemes.** Seen in two boxes on 15 November 2026:

| Scheme (`POLYGON_STABILITY_CLASS_TYPE`) | Codes in `SLOPE_STABILITY_CLASS_W_ROADS` | Unstable codes |
| --- | --- | --- |
| Detailed (`D`) | I, II, III, IV, V | IV potentially unstable, V unstable |
| Reconnaissance (`R`) | S, P, U | P potentially unstable, U unstable |
| Not stated (empty type) | 1, 2, 3, 4, 4R, 5 | 4 and 4R, 5 |
| Not stated | empty | unknown |

On south Vancouver Island, 5,323 of 8,362 polygons had no class at all. A screen that reads only
IV and V misses the reconnaissance and numeric schemes. Map all three to *potentially unstable* and
*unstable*, and keep the scheme beside each figure.

### Tested on the reference set

All 347 blocks and their built roads (537 km in all), queried with the block and roads' box plus
200 m, project boundaries included:

- **42 blocks** (12 %) lie mostly inside a mapping project that states a stability classification
  (types: terrain 72, reconnaissance 58, detailed 37 project records; every stated scale 1:20,000).
  Another 293 lie inside a terrain or ecosystem project that has none.
- **26 of those 42** have no stability polygon within 200 m. Absence inside a mapped project is
  therefore not evidence either way. Say "no polygon here", never "stable".
- **Codes near the blocks:** 2 (160), S (104), II (74), 1 (72), 3 (61), III (60), P (51), I (44), 4 (35),
  IV (27), no class (17), V (4), 5 (4), U (4).
- **Built roads crossing unstable ground:** potentially unstable (IV, P, 4) on 3 blocks, 1.6 km in
  all. Unstable (V, U, 5) on none. 11 blocks contain some potentially unstable or unstable ground.

These six interior districts are gentle, so the layer will rarely matter there: no road in the set
crossed ground mapped unstable.

### Tested on steep ground

The 270 legs of the steep bench (209 km of road, idea 3), queried the same way:

- **23 % of the road length** (48 km) lies inside a project that states a stability classification.
  By area: Kaslo 90 %, Nelson 54 %, Revelstoke 40 %, Port Alberni 20 %, and the four Lower Mainland
  areas and the Sunshine Coast 0 %.
- **Project boundaries do not mark coverage reliably.** Hope has 1.4 km of road on unstable and
  potentially unstable polygons, yet no project there states a classification. Treat a polygon as
  evidence of mapping even where no boundary says so, and say "not mapped" only where neither
  exists.
- **Roads are built across unstable ground.** 2.2 km of road on 8 legs runs on unstable ground
  (V, U, 5), and 10.9 km on 34 legs on potentially unstable ground.
- **There is a lot of unclassified ground.** 56.6 km of road runs on polygons with no class at all.
- **Roads only mildly avoid it.** On classified ground, the road's share against the 200 m
  corridor's share of area was 4.2 % against 5.5 % for unstable, 20.7 % against 27.1 % for potentially
  unstable, and 75.1 % against 67.4 % for stable. Roads use unstable ground at about three-quarters of
  its share of the corridor.

So unstable ground is crossed in practice, presumably after an assessment, and a default that
blocks it outright would refuse roads that get built. *Conditional* fits: in this app it blocks the
search until the forester records a review of that area, which is where a terrain assessment
belongs.

### How it would fit

- Load it like the other live DataBC reads: bounding box in `CQL_FILTER` (longitude first), a narrow
  `propertyName` that names the geometry field, `fetch` passed in, and a failed read shown as
  *Not read*, never *None*.
- Offer potentially unstable and unstable polygons, in all three schemes, as candidates. The user
  picks each class's treatment (Excluded, Conditional or priced), as for any imported area. A polygon
  is never made an exclusion because of what it is.
- A Review row: cut deeper than a stated depth inside an area the user marked unstable. Label it as
  a stated screen, not a BC rule, and keep it not-assessed where the layer was not read or the area
  is not mapped. The paper's reason for it is drainage as well as stability: a deep cut in wet,
  weak ground intercepts the slope's water and starts slides.
- Keep `invalid` codes and empty classes as unknown, not stable.

### Without LiDAR

The mapping is drawn from air photos and field checks, not the DEM, so it does not depend on the
terrain the road is on. It complements the DEM slope screen ([Forester constraints](planning-constraints.md)),
which off LiDAR reads a smoothed slope and cannot see materials or drainage at all. Its own scale is
whatever the mapping project used, often unstated in the rows read. Show it as context and never
present it as finer than that.

## Not worth taking

- **Ant colony optimisation and pushbroom distance** (the paper's background): neither improves on a
  grade-checked graph search for this problem.
- **The paper's reasons for abandoning automatic routing.** Its cost surfaces ignored direction and
  grade per edge, which `routing.ts` already enforces. Its point that a forest road must reach whole
  slopes is covered by skid reach, extraction reach and the network tools, not by changing the search.
- **Its formulas (1)–(4)**, for the reasons above.

## Options for the forester

Each idea goes where the forester already works, so nothing needs a new panel. The figures in the
mock wording below are illustrations, not measurements.

### How they fit together

1. **Load terrain** as now: LiDAR, regional, CDED or a map PDF's contours.
2. **Plan → terrain layer → Grade room.** See which faces a road can cross at the grade limit, and
   where it will have to run along the contour or switchback.
3. **Load BC terrain stability** and choose what each class does to the search.
4. **Place the ends and any sketch points.** Each leg says straight away whether it can make its
   climb and how much extra road it needs.
5. **Find the best route**, on fine (32-direction) headings.
6. **Review** flags deep cuts in ground the forester marked unstable.

### Grade room: a fifth terrain layer

- **Where:** `TerrainLayerSelect` beside Hillshade, Slope, Aspect and Elevation, with its legend in
  `PlanLegend`.
- **What it draws:** the room either side of the contour a road at the grade limit has.

  | Band | Reads as |
  | --- | --- |
  | Any heading | The ground is no steeper than the grade limit |
  | ±30° or more | Room to angle across the face |
  | ±15–30° | Hold near the contour |
  | Under ±15° | Contour road; expect switchbacks to gain height and pitches over the limit |

  On LiDAR the last band splits at ±8° ("barely passable at this grade"). On regional terrain that
  split never occurred along 25,698 samples of real road (see **Tested on real roads** under idea 1).

- **Driven by** Find the best route's *Grade limit %*. The legend says "at 12 %", so changing the limit
  redraws the layer and the forester can compare 12 % with 16 % directly. With haul grade limits set,
  a *Loaded uphill / Loaded downhill* switch in the legend picks which limit is drawn.
- **Point query** adds a line: "Headings at grade: 34–58° and 214–238° (24° either side of the
  contour)."
- **Optional:** *Along a heading* in the legend, with an aim in degrees or *Use the selected leg*. It
  shades the signed grade along that bearing, which is the paper's raster done correctly.
- **The legend names the terrain** and how the layer reads it, for example: "Regional terrain, 22 m:
  short steep pitches read gentler than they are." On contour terrain, terraces show as
  *Unknown* hatching.
- **Later:** a block-sheet base map, so the bands can go to the field on paper.

### Leg check: a line on each leg

- **Find the best route**, above *Compare*, shows one line per leg between the ends (and the sketch
  points, when there are any):

  > Leg 2 · climbs 145 m in 820 m (17.7 %) · at 12 % needs at least 1,208 m: **about 390 m more** than
  > straight (±75 m on regional terrain)
  > Straight over the top: 1,460 m

  A leg that holds grade in a straight line says so in one word and takes no space. A leg within the
  terrain margin says *borderline*.
- **While drawing** (*Peg road*, *Sketch a road*, *Extend road*), the drawing's card shows the same
  figure for the leg being drawn, so the forester sees it before clicking.
- **Buttons, never automatic changes:**
  - *Turn on switchbacks*, when the extra road is long and switchbacks are off.
  - *Try steeper grades*, which already exists.
  - *Add a point at the worst stretch*, on a flagged leg only. It marks where the straight-line
    profile runs over the limit longest, and adds a sketch point only on a click.
- **In the failure text:** when **Find the best route** finds nothing, it leads with the leg check,
  for example: "No route at 12 %: the climb needs at least 1,208 m and the corridor ±150 m leaves no
  room for it."
- **Nothing to set.** It is a reading, not an option. *Unknown* where an end has no ground.

### Search headings: one setting in Search settings

- **Where:** *Search settings* in Find the best route, beside *Corridor ±m* and *Ground trend (m)*:
  *Search headings* with *Fine (32)*, *Medium (16)* and *Coarse (8)*, stored as
  `routeSearch.neighbourhood`.
- **Fine by default for new projects.** Saved projects keep *Coarse* until changed, so their results
  do not move. On the steep bench, *Fine* found routes on 95 of the 120 legs whose built road holds
  20 % on LiDAR, against 13 with *Coarse*. On the gentle bench it loses nothing. It takes under
  0.2 s a search.
- **Its InfoTip** gives the figure that matters for the chosen limit: "At 12 %, fine headings can
  cross a face in any direction up to 38 % side slope (medium 27 %, coarse 17 %). On steeper faces,
  it depends on how the contours lie."
- **A failure on steep ground says why.** When a search finds nothing on ground steeper than the
  headings can cross at this limit, the message names the side slope and the room left ("on 45 % side
  slope a 12 % road must stay within ±15° of the contour") instead of only "No terrain-cost path".
  On *Coarse* or *Medium* it offers *Search again with fine headings*.

### Terrain stability: a provincial layer with treatments

- **Where:** beside the provincial stream layers, as *Load BC terrain stability*. It reads the stability
  polygons and the mapping project boundaries for the plan's area.
- **On the plan:** unstable (V, U, 5) and potentially unstable (IV, P, 4, 4R) in two colours, the
  other mapped classes plain, polygons with no class marked *Unclassified*, ground inside a project
  with no polygon marked *No polygon here*, and ground with neither a polygon nor a stability-mapping
  project hatched *Not mapped*. Clicking a polygon shows its stability class with roads,
  landslide-to-stream class, erosion class, drainage, slope range and whether it was field checked.
- **Treatment per class**, set by the forester and stored with the project. The choices are *Context
  only* (the default), *Conditional*, *Excluded* and *Priced ($/m)*. A class does nothing to the search
  until it is given a treatment.
- **Review:** a standard *Flag cuts deeper than __ m in unstable terrain*. Left blank, the row is off.
  Filled in, Review lists the stations and depths. The row is *Not assessed* where the layer was not
  read or the road crosses *Not mapped* ground. It says it is a stated screen, not a BC rule.
- **Reports** print the stability classes the road crosses and the treatment the forester chose.

## Suggested order (after the tests)

1. **Thirty-two search headings, with the eight-direction fallback and a larger sampling budget.**
   The largest effect found, and the smallest change. On steep ground the current search finds a
   route for about one leg in ten whose built road holds 20 % on LiDAR, and blames the ground.
2. **Leg check.** Small, DOM-free, quiet on gentle legs, and within 1–4 % of LiDAR's flags on steep
   ground on every coarse terrain.
3. **Grade room layer.** One more output in the display loop. Read over ±30 m on every terrain
   (CDED and contour terrain included), with four bands on regional terrain and five on LiDAR and
   contours.
4. **Terrain stability.** A new live layer covering three class schemes and unclassified polygons,
   and a Review row. It matters in the Kootenays, Revelstoke and Port Alberni areas tested, and
   barely in the gentle interior districts.

## What the tests settle, and what is still open

**Settled by the steep bench (15 November 2026):**

- **Steep ground:** 270 legs at a median side slope of 44 %, 162 of them checked against 1 m LiDAR.
  The search result holds and is larger than on gentle ground: thirty-two directions, not sixteen.
- **CDED and contour terrains were run, not just reasoned about.** CDED behaves like the regional
  terrain: leg-check flags 96–99 % in agreement with LiDAR, and bands 70 % the same and 99 % within
  one. Read it over a square ±30 m window, not neighbouring posts. A 10 m contour TIN matches
  LiDAR's band on 94 % of road samples when read over ±30 m. Terraces caught only 1 % of steep road
  samples.
- **Band breaks:** on steep LiDAR the bands still order real roads (median 26°, 15°, 10° and 7° off
  the contour from the ±30° band down). The bottom band exists on LiDAR (1.2 %) but not on regional
  terrain.
- **Stability defaults:** roads are built across unstable ground (2.2 km of 209 km), at about
  three-quarters of its share of the corridor. *Conditional* for unstable and *Context only* for
  potentially unstable fits that practice; *Excluded* would not.
- **Leg check while drawing:** instant and quiet on gentle ground (1 leg in 20 flagged at 12 %).
  Run it live, with the terrain's margin, and *borderline* within it.

**Still open:**

- **The forester's confirmation** of the band breaks and the stability defaults. The evidence above
  supports them, but they set what a layout forester is told, so they should be confirmed by one.
- **A licensee block was not needed** for the steep bench and was not used.
- **Not tested:** a real company contour sheet against LiDAR (no LiDAR under the sheet supplied);
  why MRDEM fails the search more often than its accuracy suggests; and whether the heading layer
  defaults to the absolute or the haul-direction limit.

The test scripts, cached terrain and the experiment patch are kept outside the repository.
