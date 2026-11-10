# Extraction reach: skidder and forwarder

**Design → Extraction reach** answers how a ground-based machine brings each part of a harvest
block to a truck road, and how far the logs travel. It extends the along-ground skid reach of
[Skid reach, spur suggestions and landing sites](skid-reach-and-spurs.md) with winching, skid
trails, closed areas, a forwarder model, distance classes and a before/after comparison for
designed roads. The model is in `extractionReach.ts`, with winching in `winchReach.ts` and the
forwarder's runs and crane in `forwarderReach.ts`; the panel is `SkidReachPanel.tsx`, with its
fields in `ExtractionReachFields.tsx` and statistics in `ExtractionReachResults.tsx`.

## Before you rely on it

- **The skidder keeps the field rule.** Its default reach is the 350 m level / 200 m at 30 % uphill
  rule of thumb, with a 40 % ground skid limit, exactly as in the skid-reach guide. With winching
  off and no trails the result is cell for cell the skid-reach model's (a unit test pins it).
- **Winching and forwarder limits are Sylvaccess's, not BC standards.** The winch defaults (50 m
  uphill reached at 75 %, 100 m downhill reached at 20 %) and the forwarder defaults (15 % side
  slope, 30 % loaded uphill, 40 % loaded downhill, 300 m steep-ground budget, 8 m crane) are
  Sylvaccess 3.6's. The 500 m forwarding reach is a PGMaps choice; Sylvaccess has no reach limit
  and grades distance by classes only. Use your contractor's numbers where you have them.
- **Winch from: edge of driven ground is the default.** The skidder drives to the timber and
  winches only where it cannot drive (Sylvaccess option 2). This leaves the field rule's results
  unchanged on drivable ground and adds winching onto steep or closed ground. **Roads and trails
  first** is Sylvaccess's default (option 1, "limit soil damage"): timber within winch reach of a
  road or trail is winched to it even where the machine could drive.
- **Distances follow the ground; winch lines and runs are straight.** Driving distance is the
  cheapest path over the grid. Winch lines and forwarder runs are straight lines from a cell centre
  at 360 bearings.
- **Cell size matters.** The panel starts at 10 m cells; Sylvaccess resamples everything to 5 m.
  On 10 m cells a winch line or run is tested every 10 m, and an 8 m crane reaches no neighbouring
  cell centre at all. Enter a 5 m grid cell when the crane or short winch lines matter.
- **Every result is a candidate.** Nothing here changes the project. Spurs are added only with
  **Add**, as before.

## Using it

1. Pick the block, then the machine: **Skidder** or **Forwarder**.
2. Skidder: the skid reach fields as before; fold open **Winching** to choose where it winches from
   and the two line lengths and their full-length slopes. Forwarder: side slope limit, loaded
   downhill and uphill limits, steep run budget, crane reach and forwarding reach.
3. Both: **Hand-falling limit** (ground steeper than this, with its eight neighbours, is reported too
   steep to fell), **Travel outside block**, **Grid cell** and the **Distance classes**.
4. **Skid trails**: tick the roads near the block that carry machines, not trucks. Logs are dragged
   or forwarded along a trail to a truck road; a trail that joins no truck road is left out and
   named. Every other counted road is a truck road.
5. **Closed areas**: say how each exclusion area is used. **No machines**: no driving, but winch
   lines may cross it and logs inside it may be winched out. **No extraction**: neither. Areas are
   never classified from their geometry; an area left at **Not used** changes nothing.
6. **Compare with mapped roads only** runs the block twice, without and with the designed roads.
7. **Run extraction reach.** The folded row shows the machine and the share within reach. The
   results list area by how the logs leave (on a road or trail, skidded, winched from a road or
   trail, winched from driven ground; forwarded by free travel, straight runs or crane), the
   area beyond reach, too steep for the machine, too steep to fell, closed and unknown, the
   distance classes with cumulative shares, the mean and farthest distances, and the comparison.
   **Show on plan** fills ground within reach by distance class (or newly within reach and
   shortened, with the comparison on) and outlines winched, beyond-reach, too-steep, unfellable,
   closed and unknown ground.
8. **Suggest spurs** and **Landing sites** work as before, judged by this run's reach: a spur that
   brings steep ground within winch reach counts.

## How the skidder is modelled

- **Driving.** Two ground searches run over the cells the skidder may drive (not closed, not a
  stream barrier when streams stop extraction, not steeper than the ground skid limit): one from
  the truck roads, with trail cells left out, and one from the trails, each trail cell starting with
  its along-trail reach used. A cell within reach both ways leaves by the truck road when its
  in-stand distance is no more than the trail route's in-stand distance plus a tenth of its trail
  distance (`TRACK_CHOICE_WEIGHT`). Among trails, the search counts in-stand reach twice
  (`OFF_TRAIL_CHOICE_WEIGHT`), so the machine leaves the stand by the nearest trail. The reach rule
  applies to the whole drag, in the stand and along the trail.
- **Trails.** Along-trail reach and distance are a ground search over trail cells only, from the
  truck roads, with no slope limit (a trail is built ground). Trail cells it never reaches are left
  out.
- **Winching.** Lines leave a source at 360 bearings, 1° apart, and pass through the cells a
  straight segment from the source's centre touches, nearest first. For a target at horizontal
  distance `d` and height difference `Δz` above the source, the line is `L = √(d² + Δz²)` with slope
  `p = Δz/d`. The longest line is linear in the line's drop, through the two calibration points:

  ```text
  Δz_up   =  L_up · P_up / √(1 + P_up²)
  Δz_down = −L_down · P_down / √(1 + P_down²)
  c  = (L_up − L_down) / (Δz_up − Δz_down),  L0 = L_up − c · Δz_up
  L_max(p) = L0 / (1 − c · p / √(1 + p²))     for −P_down < p ≤ P_up
           = L_down below −P_down,  L_up above P_up
  ```

  With the defaults `c = −1.0078`, `L0 = 80.23 m`: 100 m on lines at or below −20 %, 80.2 m on level
  lines, 58.4 m at +40 %, 50 m at or above +75 %. Any line no longer than the shorter length is
  allowed. A line stops at the first cell it may not cross (a road, a stream barrier, a
  no-extraction area, unfellable ground, outside the travel band), the first cell past `L_max`, or
  the first cell where the chord from the source's ground to the target's ground passes more than
  `WINCH_HUMP_M` (10 m) below a cell between them or more than `WINCH_HOLLOW_M` (20 m) above one. A
  cell already served by a better line is passed over without those checks and the line goes on;
  the cells beyond it are still checked against the whole chord. Each target keeps the line with
  the least `base + L`, where the base is the source's own distance to the truck road (a tenth of it
  for a road-winch from a trail).

- **Sources.** Roads and trails first: every truck road cell and every trail cell within reach.
  Then, in both modes, every cell the skidder drives to within reach that has a neighbour it cannot
  enter (and, driving to the timber, road and trail cells beside such ground). Edge winching fills
  only cells not yet served.
- **Total distance** = in-stand + along-trail + winch line.

## How the forwarder is modelled

- **Free travel.** Ground no steeper than the least of the three slope limits is driven in any
  direction: the same ground searches as the skidder, at a constant reach (the forwarding reach),
  on cells the forwarder may drive.
- **Straight runs** from every truck road cell and trail cell within reach, at 360 bearings, on the
  same ray geometry. Each cell on a run must be drivable, no steeper than the steepest of the three
  limits; no steeper than the loaded-downhill limit when it lies above the departure, the
  loaded-uphill limit otherwise; and its slope across the run, `slope · |sin Δ|` with Δ the angle
  between the run and the fall line, within the side slope limit. On a uniform 20 % slope that
  allows runs within 48.6° of the fall line, on 25 % within 36.9° (`widestRunAngleDeg`). The
  distance along the run over ground steeper than the side limit may not exceed the steep run
  budget. A run's distance is its straight 3D chord; it replaces free travel when shorter (with
  the trail tenth).
- **Second pass.** Runs start again from the edge of everything reached, carrying the distance
  and steep budget already used, **but only from cells within the side slope limit**: a run is
  straight because the machine cannot turn across a steep slope, so a new run starts only where it
  can turn.
- **Crane.** Cells whose centre is within the crane reach of a reached edge cell are loaded from it.
- **Total distance** = in-stand (free travel, runs and crane) + along-trail. Within reach when it
  is no more than the forwarding reach.

## Cell states

Each block cell is, in order: **unknown** when it has no ground; **within reach** when it lies on a
counted road or trail; **too steep to fell** when its 3 × 3 steepest slope is above the hand-falling
limit; **no extraction** when it lies in such an area and nothing reached it; **within reach** when
the strict run reached it; **unknown** when only the optimistic run did; **too steep for the
machine** above the skid limit (skidder) or the steepest of the three limits (forwarder); otherwise
**beyond reach**. Spur suggestions read too steep, too steep to fell and no extraction as ground a
spur cannot help, and the coverage target is read on the rest (the "extractable" area).

## Before and after a road project

With **Compare with mapped roads only** on and designed roads counted, the block is run on one grid
twice: with every counted road except the designed ones, then with all. `compareExtraction` reports
the area newly within reach, the area within reach both times whose distance fell by at least
`MIN_SHORTENED_M`, the mean shortening, and the shortened area by how much shorter, on the distance
class bounds. The plan then fills newly accessible ground green and shortened ground teal. This is
Sylvaccess's road-project comparison, with PGMaps' designed roads in the place of its "projected"
sections.

## Cable hook

Cable yarding is not part of this model. A cable-coverage model plugs in by producing
`ExtractionCells` for its lines with method `cable` (`M_CABLE`, reserved in `EXTRACTION_METHODS`):
total distance as the carriage distance plus the landing's road distance, `exit` as the landing
cell. Classification, statistics, distance classes, the plan layer, the comparison and the spur
model then read it like any other machine; the machine picker gains a third option.

## Limits and budgets

| Limit                                                                                                  | Enforcing code                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Skidder default: 350 m level, 200 m at 30 % uphill, 40 % ground skid limit; winch from the edge        | `DEFAULT_EXTRACTION_SETTINGS`, `extractionReach.ts`                                                            |
| Winch defaults 50 m up (full from 75 %), 100 m down (full from 20 %)                                   | `DEFAULT_WINCH_RULE`, `winchReach.ts`                                                                          |
| Winch lines 0–300 m each way, at least one above 0; full-length slopes 1–500 %                         | `MAX_WINCH_M`, `MIN_WINCH_SLOPE_PERCENT`, `MAX_WINCH_SLOPE_PERCENT`                                            |
| A winch line passes at most 10 m below a rise and 20 m above a hollow; fixed                           | `WINCH_HUMP_M`, `WINCH_HOLLOW_M`                                                                               |
| Winch lines and runs at 360 bearings, 1° apart                                                         | `RAY_BEARINGS`, `rayTable`                                                                                     |
| Forwarder defaults: 15 % side, 30 % loaded uphill, 40 % loaded downhill, 300 m steep, 8 m crane, 500 m | `DEFAULT_FORWARDER_RULE`, `forwarderReach.ts`                                                                  |
| Forwarder slopes 1–100 %; steep budget 0–2,000 m; crane 2–20 m; forwarding reach 20–2,000 m            | `MIN/MAX_FORWARDER_SLOPE_PERCENT`, `MAX_STEEP_BUDGET_M`, `MIN/MAX_CRANE_M`, `MIN/MAX_FORWARDER_REACH_M`        |
| Hand-falling limit 100 % by default, 10–300 %                                                          | `DEFAULT_FELLABLE_SLOPE_PERCENT`, `MIN/MAX_FELLABLE_SLOPE_PERCENT`                                             |
| Distance classes 0;100;200;300 m by default; at most 8, starting at 0, below 5,000 m                   | `DEFAULT_CLASS_BOUNDS_M`, `MAX_DISTANCE_CLASSES`, `MAX_CLASS_BOUND_M`                                          |
| Trail distance counts a tenth against in-stand distance; in-stand reach counts twice choosing a trail  | `TRACK_CHOICE_WEIGHT`, `OFF_TRAIL_CHOICE_WEIGHT`                                                               |
| A distance counts as shortened from 1 m                                                                | `MIN_SHORTENED_M`                                                                                              |
| Grid, travel band, reach multiple and plan vertices as for skid reach                                  | `DEFAULT_SKID_CELL_M`, `MAX_SKID_CELLS`, `MAX_OFF_BLOCK_M`, `SKID_REPORT_REACHES`, `MAX_SKID_OUTLINE_VERTICES` |
| Skid trails listed: counted roads within 1 km of the block, nearest 30                                 | `ROAD_USE_RADIUS_M`, `MAX_ROAD_USE_ROWS`, `SkidReachPanel.tsx`                                                 |

## Built-in assumptions

- The reach rule applies to the skidder's whole drag, in the stand and along a trail; a winch line
  has its own limit and adds to the total distance but not to the reach used.
- Edge winching starts only where the driven ground meets ground the machine cannot enter (too
  steep, closed, a barrier); a skidder at the end of its reach on gentle ground does not winch
  further.
- A suggested spur is a truck road. Trails keep the truck roads they joined in the base run; run
  again after adding a spur that a trail should join.
- No public-road class: Sylvaccess's class 3 (public road, an obstacle to machines) has no PGMaps
  equivalent. Every counted road that is not a trail is a truck road and a destination.
- The forwarder's side-slope rule uses the exact tangent form; Sylvaccess applies the same rule to
  slope angles, which allows slightly wider runs (48.96° rather than 48.59° on 20 %).
- The forwarder's second pass starts only on ground within the side slope limit (see above), and the
  steep-ground budget is enforced on every cell a run reaches.
- Slopes are central differences on the ground trend (`groundTrendTerrain`), not Horn's 3 × 3
  operator; on a plane they agree.
- Stream barriers stop winch lines as well as driving.
- Missing ground stays unknown: every pass runs twice, refusing missing cells and then treating
  them as level and passable. Sylvaccess treats missing ground as an obstacle.

## Failure modes

- **Coarse terrain hides humps and hollows.** On the 22 m regional DEM, a bluff or gully smaller
  than a few cells does not stop a winch line it would stop in the field. Use LiDAR.
- **A 10 m grid under-reports the crane** and coarsens winch envelopes. Use 5 m cells for forwarder
  work.
- **A trail that only touches a truck road diagonally across a gap** in the rasterized lines is
  still joined (eight-neighbour); a trail that stops short of the road by a cell is left out and
  named. Check the named trails.
- **Closed areas are opt-in.** An exclusion area left at **Not used** is crossed freely by machines
  and winch lines.
- **Distances are not costs.** The classes grade distance only; uphill and downhill skidding are
  distinguished only by the reach rule, not by the distance reported.

## Provenance

- **Specification.** Written from the clean-room functional specification of Sylvaccess 3.6
  (`sylvaccess.md`, 10 November 2026), which describes the program's options and behaviour without
  code. Written from a functional specification; no code from Sylvaccess (GPL-3.0-or-later) was
  used. The specification's defects (the ONF class labelling of unreached cells, the forwarder's
  first-reach budget quirk) are not reproduced.
- **Papers.** Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess : un modèle pour
  cartographier automatiquement l'accessibilité des forêts, _Revue forestière française_ 67(2):
  111–126, doi:10.4267/2042/57902; the Sylvaccess 3.6 detailed user notice (INRAE UR LESSEM,
  September 2024; software deposit doi:10.15454/JUBESS); Clouet N., Berger F., Monnet J.-M.,
  Descroix L. (2010), CARTUVI – un modèle sous SIG pour la cartographie des surfaces débardables en
  zone de montagne, _Revue forestière française_ 62(2): 155–171 (winch rule); Suvinen A. (2006), A
  GIS-based simulation model for terrain tractability, _Journal of Terramechanics_ 43(4): 427–449
  (side-slope rule).
- **Reference runs.** Sylvaccess 3.6 was run unmodified on synthetic 5 m planes (60 × 60 cells, the
  whole grid forest) on 10 November 2026. `extractionReach.test.ts` and `winchReach.test.ts` carry
  the numbers as small fixtures on the same planes at 5 m cells. Accessible cells, PGMaps against
  the reference:

  | Case                                                            | PGMaps | Sylvaccess | Note                                                         |
  | --------------------------------------------------------------- | -----: | ---------: | ------------------------------------------------------------ |
  | 20 % plane, road below, roads first: winched to 65 m, then skid |  3,600 |      3,600 | Winch and skid transects within 1 m                          |
  | 20 % plane, drive to the timber                                 |  3,600 |      3,600 | Skidded everywhere, 25 m reads 25, 50 m reads 51 (±1 m)      |
  | 40 % plane, road below: winched to 50 m (54 m line)             |    780 |        779 | One corner cell                                              |
  | 40 % plane, road above: winched to 90 m (97 m line)             |  1,260 |      1,259 | One corner cell                                              |
  | 40 % plane, one road cell: winch envelope                       |    797 |        797 | 54 m at 50 m up, 80 m across, 97 m at 90 m down              |
  | 20 % plane, 100–130 m strip closed to machines                  |  1,980 |      1,979 | Skid to 97.5 m (86 m), winched across to 162.5 m (86 + 66)   |
  | 20 % plane, strip closed to extraction                          |  1,200 |      1,199 | Nothing at or beyond 102.5 m                                 |
  | Forwarder, 10 / 20 / 30 % planes, road below                    |  3,600 |      3,600 | 286 / 291 / 298 m at the far edge (±1 m)                     |
  | Forwarder, 20 % plane, one road cell                            |  2,303 |      2,181 | +5.6 %: crane and ray-touch detail; reference not symmetric  |
  | Forwarder, 25 % plane, one road cell                            |  1,616 |      1,650 | −2.1 %: tangent form of the side rule                        |
  | Forwarder, 20 % plane, one road cell, 100 m steep budget        |    891 |      1,040 | Budget enforced on first reach: fan ends at 100 m, not 110 m |

  Sylvaccess reports skid distances as centimetre steps truncated to the metre and winch lengths
  rounded to the metre; PGMaps keeps metres unrounded, so transects agree to within 1 m.
