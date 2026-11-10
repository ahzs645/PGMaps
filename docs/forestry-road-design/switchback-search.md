# Switchbacks found by the route search

**Design → Find the best route → Search settings → Switchbacks** lets the route search turn a road
back on itself. The corridor search reads the ground grade every metre along each line, so where a
road has to climb a face steeper than its grade limit it cannot come round: every heading that turns
back crosses the fall line, where the ground is as steep as the face. With **Allow switchbacks** on,
a corridor where the corridor search finds no line is searched again by the switchback search
(`switchbackSearch.ts`), which places switchbacks where the ground can take a platform and draws each
one as a loop of curves the road engine keeps.

The search, its rules and its failure messages are in `switchbackSearch.ts`; the saved settings and
fixed figures in `switchbackOptions.ts`; the drawn turn in `hairpinLoop.ts`. All three are free of
DOM and network access. The settings fold is `SwitchbackSettings.tsx`. For switchbacks you add by
hand, see [Switchback alternatives](switchbacks.md).

## Before you rely on it

- **It is off by default.** A project saved before this existed, or with **Allow switchbacks** off,
  finds exactly the roads it found before. With it off, a goal that finds no road says whether the
  switchback search would have found one, and where its first switchback would be; it never adds
  the road.
- **A switchback is screened, not designed.** The platform test, spacing and sharpest-turn rule are
  SylvaRoaD's empirical figures. They say where a turn is plausible. The platform, its cut and fill,
  its drainage and the truck's swept path through it still need design: open the road and run
  **Swept path** on each switchback as one manoeuvre.
- **The drawn turn goes round the outside.** The search works with straight legs meeting at a
  vertex. Turning inside that vertex would shorten the road and steepen the turn past the legs' own
  grade, so each switchback is drawn round the outside of its vertex: a reverse curve off the first
  leg, two curves with a middle straight (the two-curve bend that **Add a switchback** builds), and
  a reverse curve onto the second leg. Every curve has the switchback radius. A switchback at R 25 m
  adds about 79 m of road; at R 8 m, about 25 m.
- **The radius has to suit the road.** An empty **Radius** takes the road's minimum radius, and at
  least 12 m. A smaller radius than the road's minimum is allowed, but the row then carries "curves
  tighter than the minimum radius", which keeps it from leading a goal.
- **Grades are held on straight pieces, not metre by metre.** Each piece's grade is its end-to-end
  grade on the ground trend. The ground under it may depart from that straight grade by the
  **Straight-grade cut/fill**, 3 m over a 42 m piece. A designed profile then fits the road as usual;
  check its grades and the cut and fill on the switchbacks in the profile and sections.
- **Read the row's note.** It gives each switchback's steep platform share and the largest cut or
  fill on its drawn turn, and the length on side-hill when a side-hill limit is set.

## Using it

1. Open **Design → Find the best route → Search settings** and unfold **Switchbacks**. Its row
   reads "Off", or the radius, spacing and platform rule in force: "R 25 m · ≥ 75 m apart · platform
   ≤ 25% over 55%".
2. Tick **Allow switchbacks**. The settings appear; each field's (i) explains it.
3. Choose the goals and **Compare**. A goal whose corridor has no line is searched with switchbacks
   in the same corridor before the corridor is widened. Its row's note says how many switchbacks it
   took and how each was judged.
4. Click the row to open the road. The switchbacks are ordinary horizontal points with curves:
   move them, change radii, and check them under **Curves** and **Swept path** like any other.

The settings are saved with the project under `routeSearch.switchbacks`. Changing them, or the
side-hill limit, marks the last comparison as out of date.

| Field                   | Saved as                             | Default         | Range    | Meaning                                                                                             |
| ----------------------- | ------------------------------------ | --------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Allow switchbacks       | `allow`                              | off             | —        | Off: a turn sharper than **Turns above** is refused                                                 |
| Radius (m)              | `radiusM`                            | empty           | 5–200    | Radius of every curve in a switchback; empty takes max(road minimum radius, 12 m)                   |
| Middle straight (m)     | `middleStraightM`                    | 2               | 1–200    | Straight between the two main curves of a drawn switchback                                          |
| Spacing (× R)           | `spacingFactor`                      | 3               | 1–10     | Least distance between two switchbacks' vertices                                                    |
| Turns above (°)         | `hairpinAngleDeg`                    | 110             | 60–170   | A sharper change of heading is a switchback                                                         |
| Platform over %         | `platformSlopePercent`               | 55              | 5–300    | Ground steeper than this is steep in the platform test                                              |
| Steep share ≤ %         | `platformSteepShare`                 | 25 % (0.25)     | 0–100 %  | Largest steep share of the platform circle                                                          |
| Turn cut/fill ≤ m       | `turnCutFillM`                       | empty           | 0.5–30   | Largest centreline cut or fill on a drawn switchback; empty does not limit it                       |
| Cost each (m)           | `penaltyM`                           | 100             | 0–5,000  | Metres of road one switchback is worth to the search                                                |
| Minimum grade %         | `minGradePercent`                    | 0               | 0–20     | Least grade of each piece, for drainage; 0 sets none                                                |
| Refuse flatter pieces   | `minGradeHard`                       | off             | —        | Off: a flatter piece is charged, a level one as twice its length                                    |
| Straight-grade cut/fill | `chordCutFillM`                      | 3               | 0.1–50   | Largest departure of the ground from a piece's grade, for a 42 m piece; shorter pro rata            |
| Side-hill over %        | `routeSearch.maxTerrainSlopePercent` | empty           | 1–300    | Ground steeper than this is side-hill. The same value is the grid search's hard screen              |
| Side-hill for ≤ m       | `sideHillBudgetM`                    | 0               | 0–10,000 | Length of road allowed on side-hill; each metre is charged; 0 refuses any                           |
| Grade change (m)        | `gradeChangePenaltyM`                | empty (by goal) | 0–5,000  | Metres a full reversal from +limit to −limit is worth; empty: Shortest 0, balanced 80, Gentlest 160 |
| Pass points within (m)  | `passPointsWithinM`                  | empty           | 1–500    | Makes the road's interior points compulsory, each passed within this distance                       |

## How the search works

The search lays a grid over the corridor: the road's guide line, its interior points simplified to
at most 8, and the corridor half-width either side. It reads the ground trend at every cell centre
once, then works on that grid.

**Pieces.** From each cell the road may run straight to any cell within the neighbourhood radius
(42 m on 5 m cells; eight cells on coarser ones). A piece is admitted when:

1. its grade, end to end, is within the grade limit (and the directional limits for loaded and
   empty trucks), and at least the minimum grade when that refuses;
2. the ground under every cell it passes over is within the straight-grade cut or fill of the line
   joining its ends;
3. none of those cells is missing terrain, outside the corridor or inside a blocked area, and the
   piece keeps the exclusion clearance from blocked lines;
4. the route's length on side-hill stays within its budget;
5. it does not cross the route already drawn (checked once the route has turned through 180°: a
   line that has turned less cannot cross itself);
6. the vertex it leaves from has room for its curve: the curve's tangent, plus the tangent of the
   curve at the other end of the straight run, plus 0.5 m, fits on the run. An ordinary curve has
   the road's minimum radius, and its grade (the two legs' rise over the shorter arc) must be
   within the limit.

**Switchbacks.** A change of heading above **Turns above** makes the vertex a switchback. With
switchbacks off it is refused. With them on, it is admitted when, in this order:

1. the turn is no sharper than the legs can be stacked through,
   `180° − (g/1.5) × 180° × (1 + 1/2π) − 4 m × 360° / (2π × 2R)`, with g half the grade limit plus
   2 %: 154.55° at 12 % and R 8 m, 159.32° at R 12 m, 164.3° at R 25 m;
2. at most the steep share of the cells within 1.25 R of the vertex are steeper than the platform
   limit (a cell with unknown slope counts as steep);
3. it is at least the spacing from every earlier switchback on the route;
4. the legs either side have room for the drawn turn;
5. the drawn turn, held at a constant grade between the two legs' grade lines, is within the grade
   limit, stays on mapped ground inside the corridor and out of blocked areas, and keeps its
   centreline cut or fill within **Turn cut/fill** when that is set.

**Cost.** Each piece costs its length, plus the goal's grade and vertical terms (as in the corridor
search), plus a turn penalty of `turn × (θ / switchback angle)²` (Shortest 50 m, balanced and
Gentlest 150 m), a grade-change penalty of `penalty × (Δg / 2g_max)²`, the side-hill length it adds,
the zone and flow penalties of its cells and 150 m per mapped stream it touches (600 m for the
drainage goal). A switchback adds **Cost each** and `100 m × (steep share / allowed share)²`.

**Order.** The search is A\*: it takes the position whose cost so far plus its least possible cost
to the end is lowest. The least possible cost is the larger of the straight distance and the climb
left at the grade limit, so a steep end is known to be far away. It keeps one best arrival per cell
and 22.5° heading band; a costlier arrival with a better curve-room or side-hill state is dropped,
so the result is good, not proven best.

**Compulsory points.** With **Pass points within** set, the road's interior points become
waypoints in order. An arrival within the distance of the next waypoint starts the next leg where it
is, keeping its heading, so the road passes near the point without a forced kink.

**Final check.** Every piece and drawn turn of the route found is read again on fresh terrain
samples every 1 m: coverage, the straight-grade cut or fill, the corridor and blocked areas, and the
turn's cut or fill. A piece that fails is taken out and the search runs again, up to four times; an
unchecked route is never returned. The road engine must then fit every curve as drawn.

## Where it runs in Find the best route

`horizontal` in `routeComparison.ts` tries, for each goal and stopping at the first line found:

1. the corridor around your road, then the same corridor leaning toward the end;
2. **with switchbacks allowed**, the switchback search in the same corridor;
3. twice the corridor;
4. a fit along the terrain-cost grid route, and that route itself.

A switchback search that found no line is not run again for the other goals: whether a line exists
does not depend on the goal. Lowest cost still prices every line it gets, switchback lines included,
and keeps the cheapest; rows are still named by what they measured (`assignGoals`).

## Limits and budgets

| Limit                                         | Value                                                     | Enforced by                                                                 |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Settings ranges                               | As in the table above                                     | `switchbackOptions.ts` `SWITCHBACK_ROUTE_LIMITS`; `parseRouteSearchOptions` |
| Default switchback radius                     | Road minimum radius, at least 12 m                        | `switchbackOptions.ts` `DEFAULT_SWITCHBACK_RADIUS_M`                        |
| Platform circle; platform cost                | 1.25 R; 100 m at the allowed share                        | `PLATFORM_RADIUS_FACTOR`, `PLATFORM_COST_M`                                 |
| Sharpest-turn figures                         | 1.5:1 batter, 4 m platform                                | `STACKED_LEG_BATTER`, `PLATFORM_WIDTH_M`                                    |
| Straight-grade reference piece                | 42 m                                                      | `CHORD_REFERENCE_M`                                                         |
| Grid cell                                     | the larger of 5 m and the corridor's longer side ÷ 240    | `switchbackSearch.ts` `MIN_CELL_M`, `MAX_CELLS_PER_SIDE`                    |
| Cells                                         | 60,000                                                    | `SWITCHBACK_SEARCH_BUDGET.maxCells`                                         |
| Neighbourhood radius                          | the larger of 42 m and 8 cells, at most 250 m             | `NEIGHBOURHOOD_CELLS`, `MAX_NEIGHBOURHOOD_M`                                |
| Heading bands                                 | 16 (22.5°)                                                | `BINS`                                                                      |
| Positions taken from the queue                | 300,000                                                   | `SWITCHBACK_SEARCH_BUDGET.maxExpansions`                                    |
| Arrivals kept                                 | 3,000,000                                                 | `SWITCHBACK_SEARCH_BUDGET.maxLabels`                                        |
| Straight kept between curves                  | 0.5 m                                                     | `CURVE_GAP_M`                                                               |
| Straight between a reverse curve and the bend | 2 m                                                       | `hairpinLoop.ts` `LOOP_REVERSE_TANGENT_M`                                   |
| Final-check sampling; retries                 | 1 m; 4 searches                                           | `FINE_STEP_M`, `FINE_ATTEMPTS`                                              |
| Earlier switchbacks checked for spacing       | 200                                                       | `MAX_SPACING_CHECKS`                                                        |
| Grade limit; minimum radius                   | 1–30 %; 0–1,000 m, curves drawn at no less than 5 m       | `switchbackSearch.ts`; `MIN_SEARCH_RADIUS_M`                                |
| Ends; guide points; corridor half-width       | 10 m–5 km apart; 2–100; 25–1,000 m (600 m in comparisons) | `switchbackSearch.ts`; `routeComparison.ts` `MAX_CORRIDOR_HALF_WIDTH_M`     |
| Stream, exclusion and zone vertices           | 20,000                                                    | `switchbackSearch.ts`                                                       |

The search runs in slices of about 12 ms (`cooperative.ts`): the progress line shows "searching for
a line with switchbacks" and the share of its budget used, and **Cancel** stops it at its next slice.
On a desktop, the reference cases below take 0.1–3 s each; a comparison that falls through to the
switchback search on a 30 % face takes a few seconds with one goal.

## Built-in assumptions

- **Ground trend.** Grades, the straight-grade check, slopes and the platform test read the ground
  trend (`groundTrend.ts`, 12 m on LiDAR-scale terrain, `resolvedGroundWindow`), as every route
  search does. The straight-grade check therefore reads through micro-relief narrower than the
  window; a real bench narrower than it is smoothed too.
- **Slope** is the trend's gradient between neighbouring cells. Missing neighbours on one side use
  the other side; none on an axis make it unknown.
- **Unknown is never passable.** A cell without terrain blocks a piece; an unknown slope counts as
  steep for the platform and the side-hill length.
- **Legs meet at a vertex.** A switchback is a vertex where two straight legs on the ground meet.
  The drawn turn is a construction round that vertex, not part of the search's graph: its grade,
  ground and cut or fill are checked, but its own platform is not designed.
- **Two-piece switchbacks are not searched.** SylvaRoaD also treats two sharp vertices around a
  short piece as one hairpin, a consequence of keeping one arrival per cell. With arrivals kept per
  heading band, single-vertex switchbacks reach the same turns.
- **Straight pieces between cell centres.** The start is a cell centre; the end is reached exactly
  by its own last piece. Interior vertices are cell centres, so headings come in the steps the grid
  allows, between about 1° and 7° apart on a 42 m neighbourhood of 5 m cells.

## Failure modes

A goal with no road says why (`describeSwitchbackFailure`), in the designer's terms, with the place
named from the nearer end:

| Message                                                                                                                                                                      | Cause                                                                     | What to do                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "No line within 12% reaches the end without a switchback … It needs a switchback, and none are allowed: it would have turned back 50 m east-north-east of the road's start." | Switchbacks are off and every way on turns back                           | Turn on **Allow switchbacks**                                             |
| "… With switchbacks allowed, the switchback search finds a 877 m line with 3 switchbacks, the first …"                                                                       | Shown after a corridor failure when switchbacks are off; no road is added | Turn on **Allow switchbacks**                                             |
| "… Switchbacks would not help as set: every switchback it tried was refused, … because the platform is too steep …: 100% of the ground within 31.3 m is steeper than 55%"    | Switchbacks are off, and with them on every platform would be too steep   | Raise **Platform over %** or **Steep share**, or move an end onto a bench |
| "Every switchback it tried was refused, … because a switchback … would turn 157.4°, sharper than the 154.5° a 12% road can stack at R 8 m"                                   | The legs on this face meet too sharply for the radius                     | A larger **Radius**                                                       |
| "… because switchbacks would be closer than 36 m apart …"                                                                                                                    | Spacing                                                                   | Lower **Spacing** or widen the corridor                                   |
| "… because the legs … are too short to draw a switchback of R 25 m"                                                                                                          | The drawn turn needs more straight leg than there is                      | A smaller **Radius**                                                      |
| "… because the drawn turn … needs 6.7 m of cut or fill, over the 4 m allowed"                                                                                                | **Turn cut/fill**                                                         | Raise it, or a smaller radius                                             |
| "… X% of the pieces it tried from there were stopped by ground more than 3 m off a straight grade over 42 m …"                                                               | Rough ground the straight pieces cannot hold a grade over                 | Raise **Straight-grade cut/fill**                                         |
| "… stopped by the 2% minimum grade"                                                                                                                                          | Flat ground and a refused minimum grade                                   | Lower it, or untick **Refuse flatter pieces**                             |
| "… stopped by the 40 m allowed on ground steeper than 70% …"                                                                                                                 | Side-hill budget                                                          | Raise the length or the slope                                             |
| "… stopped by gaps in the terrain" / "blocked areas" / "the edge of the ±180 m corridor"                                                                                     | As in the corridor search                                                 | As in the corridor search                                                 |
| "… then ran out of its search budget"                                                                                                                                        | 300,000 positions                                                         | Narrow the corridor or split the road                                     |

When switchbacks were allowed and none passed, the rule named is the last of them a try reached, in
the order above: those tries passed every earlier rule. Otherwise the message names the rule that
stopped most pieces tried from the positions nearest the end. A message that opens "The ends are
250 m apart and 150 m apart in height (60%): at 12% the road is at least 1,250 m long." is the plain
arithmetic of the climb.

## Validation against the reference runs

SylvaRoaD 2.2 was run unmodified on synthetic 5 m planes rising north, `z = 500 + s × y`, on a
600 m × 600 m DTM, with its default options (reference run of SylvaRoaD 2.2, 10 November 2026).
`switchbackSearch.test.ts` reruns the cases with the same options: R 8 m, 2–12 % with the minimum
refused, 3 m over 42 m, 150 m turn and 80 m grade-change penalties, 5 m cells, a 42 m neighbourhood.

| Case                                    | Reference run                                                                          | PGMaps                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30 % fall line, (300, 100) → (300, 350) | 18 pieces, 641 m, one hairpin of 133.6° at (7.5, 222.5); redrawn 663 m, loop at 6.78 % | One switchback of 133.6° at (5, 225); 640.8 m of pieces; drawn 666.3 m, turn at 6.28 %. Needs the terrain and a ±400 m corridor reaching 100 m west of the DTM                                                                                                        |
| The same on the 600 m DTM, ±300 m       | as above                                                                               | Two switchbacks, 640.8 m of pieces: the drawn loop and its platform circle must be on mapped ground inside the corridor, and 7.5 m from the edge they are not                                                                                                         |
| 60 % fall line                          | No route: every cell steeper than 55 %, hairpins impossible                            | Off: "needs a switchback, none allowed". On at R 8 m: every turn sharper than 154.5°. R 12 m: platform too steep (100 % over 55 %). R 12 m and a 65 % platform: a road of three switchbacks, 1,275 m of pieces, 1,404 m drawn, each turn needing 6.4 m of cut or fill |
| 30 % contour, (150, 300) → (450, 366.7) | 10 pieces, 308 m, no hairpin, 7.28 % then 5.88 %                                       | No switchback, 307.4 m, the same 7.28 % and 5.88 % pieces (and a last piece to the exact end)                                                                                                                                                                         |
| The QGIS port's swapped values          | No admissible piece: min grade 90 %, max 55 %                                          | Not reproduced. The parser refuses a minimum grade over 20 % or at or above the grade limit                                                                                                                                                                           |

With PGMaps' own defaults (R 25 m, ±180 m) the 30 % fall line takes three switchbacks: 640.8 m of
pieces, 877 m drawn, each turn needing about 5.5 m of cut or fill.

Differences, and why:

- **The loop is longer.** PGMaps draws true curves of R with a 1–2 m straight between them; the
  reference drew a 45° polygon inside the same circle and cut the legs at 2 R. At R 8 m that is
  25.5 m added against the reference's 22 m, and a 6.28 % turn against 6.78 %.
- **Where the hairpin sits.** The reference put its hairpin 7.5 m from the DTM's edge, with its
  platform test reading only the cells that exist. PGMaps counts unmapped cells in the platform
  circle as steep and keeps the drawn turn on mapped ground, so on the same DTM it needs room it
  does not have and takes a second switchback. Given the room, it takes the reference's one.
- **Headings.** Both searches join cell centres within 42 m, so they share their headings: the
  legs run at 293.2° and 66.8° in both, at 11.82 % and 11.14 %.
- **Arrivals per heading band.** The reference keeps one arrival per cell; PGMaps keeps one per cell
  and 22.5° band, and so does not lose a cheaper continuation behind an arrival from the wrong side.

## Provenance

- **Functional specification** of SylvaRoaD 2.2 (S. Dupire, SylvaLab, funded by ONF RDI Chambéry,
  2021, GPL-3.0) and its QGIS port SylvaRoad_qgis_plugin 0.2 (Cosylval, 2024, GPL), written for this
  work by a reviewer who read their code, with the reference runs above. Written from that
  specification; no code from SylvaRoaD or its port was used. See
  [Converting the reference projects](reference-repo-licensing-and-conversion.md), route A.
- **No SylvaRoaD publication was found.** A search in French and English found no paper, report or
  notice; the method is documented only by its README, which credits its turn and grade-change
  penalties and its neighbourhood to the Forest Road Designer QGIS plugin. Its hairpin rules
  (platform share 0.25 within 1.25 R, spacing 3 R, the sharpest-turn formula) are its own empirical
  figures, not from a cited source.
- **A\***: Hart, Nilsson and Raphael (1968), A formal basis for the heuristic determination of
  minimum cost paths, _IEEE Transactions on Systems Science and Cybernetics_ 4(2): 100–107,
  DOI 10.1109/TSSC.1968.300136.
- **Long-chord neighbourhoods on a raster for forest roads**: Anderson and Nelson (2004), Projecting
  vector-based road networks with a shortest path algorithm, _Canadian Journal of Forest Research_
  34(7): 1444–1457, DOI 10.1139/x04-030.
- **Not reproduced from the port** (specification §8): settings read from the wrong boxes (minimum
  grade 90 %, maximum 55 %, every later setting shifted), the inverted distance-to-end field, the
  property layer picked as a folder, the section loop that stops after the first section, and the
  pure-Python neighbour table.
- **PGMaps' own additions**: ground-trend grades, labels per heading band, a grade-aware estimate,
  curve room at the road's minimum radius, the drawn turn's grade, ground and cut-or-fill checks,
  the 1 m final check, and the failure messages.
