# Skid reach, spur suggestions and landing sites

**Design → Extraction reach** answers a layout question: is every part of a harvest block within
ground-skidding distance of a road or landing? Where it is not, it suggests spurs that would bring
the rest within reach, and it screens nearby ground for flat landing and decking sites. The skid
model is in `skidReach.ts`, the spur generator in `skidSpurs.ts`, the landing screen in
`landingSites.ts`, and the panel in `SkidReachPanel.tsx`.

The panel now runs the extraction-reach model (`extractionReach.ts`), which keeps this skid reach
as the skidder's default and adds winching, skid trails, closed areas, a forwarder, distance
classes and a before/after comparison: see [Extraction reach](extraction-reach.md). With winching
set to **No winching** and no skid trails, its result is this page's model cell for cell. This page
still describes the skid reach itself, the spur suggestions and the landing screen.

## Before you rely on it

- **The default limit is a field rule of thumb, not a standard.** A field layout person's rule:
  about 350 m on level ground, falling to about 200 m when logs are skidded uphill to the road on
  a 30 slope. Every number is editable. Use your licence's or contractor's limits where they exist.
- **"30" is read as percent.** The tool reads the rule's 30 as a 30 % grade (about 17°). Read as
  degrees it would be 58 %, steeper than most ground-skidding limits and above the 40 % default
  ground limit, so the reduced reach would never apply. If the rule meant degrees, enter 58 in
  **at uphill grade (%)**. The field note does not say which; the panel's hint and InfoTip say so.
- **Distances are along the ground, not straight lines.** Each cell's distance follows the
  cheapest path over the terrain grid. On a uniform slope this is the slope length; around a steep
  pitch or a barrier it is the detour.
- **A suggested spur is a candidate.** Nothing is added to the project until **Add** is pressed on
  a spur, and an added spur is an ordinary road with no profile, no landing design and unreviewed
  crossings. Run skid reach again after adding one.
- **The terrain decides the answer.** On the 22 m regional DEM, short steep pitches, benches and
  gullies smaller than a few cells are invisible, and no landing flatness can be trusted. Use
  LiDAR for anything that depends on them.

## Using it

1. Draw or import a harvest block. The section lists the project's harvest polygons.
2. Set the limits: **Level reach**, **Uphill reach** reached **at uphill grade (%)**, the
   **Ground skid limit (%)** and how far a skid may run **outside the block** to reach a road.
3. Choose what counts as a landing: mapped roads, designed roads, or both. **Streams stop
   skidding** turns every mapped stream line into a barrier.
4. **Run extraction reach.** The section's folded row then shows the share within reach. The results
   list the block's area within reach, beyond reach, too steep (cable or other systems) and
   unknown, and the farthest cell. **Show on plan** outlines beyond-reach ground in red, too-steep
   ground in purple and unknown ground in grey.
5. **Suggest spurs** proposes spurs, each with its length, the area and share it brings into
   reach, its stream crossings, its parent road and, when the haul direction is known, the loaded
   truck's turn onto the parent. **Pick haul exit** marks where loaded trucks leave the area.
6. **Add** turns one spur into a road, named after the block, with curves fitted at the project's
   minimum radius where the ground and constraints allow and the road reads no steeper than the
   spur (`roadFromRoute`). A spur that holds its grade by zig-zagging keeps its zig-zags, and the
   notice gives the added road's length and any sharp corners left to curve or redraw.
7. **Landing sites** lists flat footprints near the roads and spur ends, flattest first. Change
   the slope limit or footprint size and the list follows without a new run.

## How skid reach is measured

The block and a band around it are sampled onto a grid (`prepareSkidGrid`): 10 m cells by default,
grown ×1.25 until the grid fits `MAX_SKID_CELLS`. The grid reads the project's ground trend
(`groundTrendTerrain` with `resolvedGroundWindow`), so 1 m LiDAR micro-relief is not read as
slope. Road cells are every cell a counted road passes through.

A Dijkstra search runs outward from the road cells over eight neighbours (`propagateReach`). Each
step from a cell nearer the road to one farther away uses up part of the reach:

```text
step length  = √(horizontal² + Δz²)                      (along the ground)
grade        = 100 · (z_near − z_far) / horizontal        (positive: the log rises toward the road)
allowed      = level reach                                when grade ≤ 0
             = level − (level − uphill) · min(grade / uphill grade, 1)   otherwise
reach used  += step length / allowed
```

A cell is within reach when its path has used up no more than the whole reach (1). On a uniform
grade this is exactly the rule. With the defaults, a uniform 15 % uphill skid is allowed 275 m along
the ground, which is 271.9 m level; a 15 % downhill skid keeps 350 m along the ground, 346.1 m level.
A path that is partly level and partly uphill is charged each part at its own rate.

- **Too steep.** A cell whose steepest gradient exceeds the ground skid limit is never entered. It is
  reported as too steep (cable or another system), and ground beyond it is reached only around it.
- **Missing terrain.** The search runs twice: once refusing cells with no ground and once treating
  them as level and passable (`optimistic`). A block cell within reach only in the second run is
  reported **unknown**, never covered and never beyond reach. A cell with no ground of its own is
  unknown too.
- **Outside the block.** Skid paths may run up to the entered distance outside the block
  (`DEFAULT_OFF_BLOCK_M`, 100 m). A road farther away than that cannot serve the block.
- **Barriers.** With **Streams stop skidding**, stream lines are rasterized at a quarter cell and no
  path enters them, nor cuts diagonally between two barrier cells.

The coverage target for spurs is read on the block's **known ground-skiddable area**: the block less
its too-steep and unknown cells. A block that is 10 % cable ground can still meet a 98 % target.

## Spur suggestions

`suggestSpursSteps` is adapted from the closest-first road builder of the LANDIS-II Forest Roads
Simulation extension (Clément Hardy, Apache License 2.0, doi:10.5281/zenodo.5510629). What it takes
from it: uncovered ground is served in order of its straight-line distance to the nearest road,
closest first, and each spur is a least-cost path joined to the nearest road already in the
network, including spurs suggested earlier in the run.

Each round:

1. The uncovered cell nearest a road (chamfer distance) starts a **patch**: the uncovered cells
   joined to it within two level reaches (`PATCH_REACHES`).
2. The spur **aims** at the patch cell whose farthest patch cell is nearest, an approximate
   1-centre over the patch's convex hull. A second aim at least `AIM_ALTERNATE_M` away is kept in
   reserve. Aims inside a blocked exclusion or an unreviewed stream screen are passed over.
3. The **junction** is the nearest point on the nearest road, then points `JOIN_SHIFTS_M` either
   way along it, then the nearest point on the next road. Junctions inside closed areas are passed
   over.
4. The spur is routed by the project's route search (`suggestRoutes`) with its grade limit,
   directional limits, ground trend, exclusions, riparian screens and crossing prices. The context
   is cropped to the search area first (`cropContext`). When the parent's haul direction is known,
   the first leg must leave within ±45° of `sweptBackHeading`: half-way between square to the
   parent and back against the haul, so a loaded truck turns 90° or less onto the parent. If that
   fails, the same pair is tried without a heading. Up to `MAX_PATCH_SEARCHES` searches are tried
   before the patch is given up, with the nearest junction's reason recorded.
5. The spur is cut back to the shortest length that keeps `SPUR_TRIM_KEEP` of the area it adds
   (binary search on its length, rerunning the reach model each time). Its end is its landing.
6. A spur that adds less than `MIN_SPUR_GAIN_HA` is not suggested, and neither is a patch smaller
   than that.

The run stops when the target is met, the spur budget is spent, or no patch is left that a spur
reaches. The haul direction is known on an FSR connector (it hauls out by its end), on any spur the
run made (it hauls out by its start, the junction), and on every road once **Pick haul exit** is
set: loaded trucks are taken to leave by whichever end of the road is nearer the exit, which is a
straight-line proxy for a network route.

Differences from LANDIS-II: LANDIS builds a road to every harvested cell beyond a fixed skidding
disc, stops its Dijkstra when the target is opened rather than settled, has no grade limit (only
slope cost classes), and uses an unseeded random order option. Here a spur aims at the patch's
centre, is routed under hard grade limits, is trimmed, reach is the slope-dependent model above,
and the order is deterministic.

## Landing sites

`screenLandingSites` tries a footprint of the entered width × length (default 30 × 40 m) at every
end of a counted road or spur, centred on the end along the road's last direction, and beside the
road on both sides every `LANDING_SAMPLE_SPACING_M`, inside the block's skid band. Slope is read on
a `LANDING_LATTICE_M` lattice inside the footprint from the same grid. A footprint is kept when its
mean slope is within the limit (default 8 %), none of its ground is missing, no stream line crosses
it and no point lies in a blocked exclusion. Candidates are ranked flattest first, road ends before
roadside places at equal slope, and thinned to `minSeparationM` apart.

The road tool has no template for road ends (`templates.ts` and section assemblies describe cross
sections along a road), so no turnaround or landing is added to an adopted spur. The footprint is
reported as a polygon only.

## What Sylvaccess does differently

Sylvaccess (GPL-3; re-implemented from a functional specification and its papers, no code used)
maps skidder and forwarder reach with an isotropic cost distance (no uphill/downhill difference in
driving), a separate winching model with slope-dependent winch length and a ground-shape check
along the line, a non-forest crossing budget, and distance classes rather than one limit. Its
winching, skid trails, closed areas, forwarder and comparison are now in the
[extraction-reach model](extraction-reach.md); the directional limit the field rule asks for,
which Sylvaccess does not have, stays the skidder's reach.

## Limits and budgets

| Limit                                                                                         | Enforcing code                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Default rule: 350 m level and downhill, 200 m at 30 % uphill, ground skid limit 40 %          | `DEFAULT_SKID_RULE`, `skidReach.ts`                                           |
| Reaches 20–2,000 m; uphill reach no longer than the level reach                               | `MIN_SKID_REACH_M`, `MAX_SKID_REACH_M`, `validateSkidRule`                    |
| Uphill grade and ground skid limit 1–200 %                                                    | `MIN_SKID_SLOPE_PERCENT`, `MAX_SKID_SLOPE_PERCENT`                            |
| Grid starts at 10 m cells (2–50 m) and grows ×1.25 to fit 250,000 cells                       | `DEFAULT_SKID_CELL_M`, `MIN_SKID_CELL_M`, `MAX_SKID_CELL_M`, `MAX_SKID_CELLS` |
| Skid paths run at most 100 m outside the block by default, 500 m at most                      | `DEFAULT_OFF_BLOCK_M`, `MAX_OFF_BLOCK_M`                                      |
| Distances are followed to three reaches; farther cells are reported unreached                 | `SKID_REPORT_REACHES`                                                         |
| At most 20,000 outline vertices go to the plan, smallest rings dropped first                  | `MAX_SKID_OUTLINE_VERTICES`                                                   |
| Spur target 98 % of the known skiddable area; 6 spurs by default, 12 at most                  | `DEFAULT_SPUR_OPTIONS`, `MAX_SKID_SPURS`, `skidSpurs.ts`                      |
| Route searches: 10 per patch, 12 per spur in the budget                                       | `MAX_PATCH_SEARCHES`, `ROUTE_SEARCHES_PER_SPUR`                               |
| A spur or patch under 0.25 ha is not suggested; spurs are at least 20 m                       | `MIN_SPUR_GAIN_HA`, `MIN_SPUR_LENGTH_M`                                       |
| A spur is trimmed to the shortest length keeping 99 % of its gain                             | `SPUR_TRIM_KEEP`                                                              |
| Swept-back heading 45° from square, held to ±45° by the route search                          | `SPUR_SWEEP_DEG`, `sweptBackHeading`                                          |
| Patches span two level reaches from their first cell; 2,000 aim candidates per patch          | `PATCH_REACHES`, `MAX_AIM_CANDIDATES`                                         |
| Alternative junctions 75 m and 150 m along the road; second aim at least 100 m away           | `JOIN_SHIFTS_M`, `AIM_ALTERNATE_M`                                            |
| Route context cropped to the search area plus 300 m                                           | `CONTEXT_CROP_EXTRA_M`, `cropContext`                                         |
| Landing defaults: mean slope ≤ 8 %, 30 × 40 m, 100 m apart, 8 listed                          | `DEFAULT_LANDING_OPTIONS`, `landingSites.ts`                                  |
| Landing footprint 5–200 m each way; 1–20 candidates                                           | `MAX_LANDING_FOOTPRINT_M`, `MAX_LANDING_CANDIDATES`, `validateLandingOptions` |
| Footprints tried every 20 m along roads, 3 m off the centreline, ground read on a 5 m lattice | `LANDING_SAMPLE_SPACING_M`, `LANDING_ROAD_HALF_WIDTH_M`, `LANDING_LATTICE_M`  |
| A project holds at most 20 roads, so Add stops there                                          | `MAX_ROADS`, `SkidReachPanel.tsx`                                             |

## Built-in assumptions

- Skid distance is measured along the ground over an eight-neighbour grid, from cell centre to cell
  centre. It is not a skid trail: it does not see stumps, windthrow, wet ground or anything finer
  than a cell.
- Uphill or downhill is judged step by step along the path, from the elevation difference between
  neighbouring cells. The reach on a mixed path blends the rule by length; the rule itself says
  nothing about mixed paths.
- Ground steeper than the ground skid limit is a hard stop for skidding. Winching from the edge of
  skiddable ground is the extraction-reach model's (`winchReach.ts`).
- Any cell a counted road passes through is a landing. Roads are not checked for condition, access
  rights or whether trucks can reach them. Closed and retired mapped roads are never counted.
- Mapped streams are crossed freely unless **Streams stop skidding** is on, and then every mapped
  stream is a barrier whatever its size.
- Spur crossings are counted as the number of stream segments the trimmed spur crosses, on the
  mapped stream lines.
- Landing slope is the mean of cell slopes in the footprint. It says nothing about the earthwork to
  level it, drainage, or deck capacity.

## Failure modes

- **Coarse terrain hides the limit.** On a 22 m DEM a 25 m gully or bluff can vanish, so the model
  covers ground a skidder cannot reach. Landing flatness on such terrain is not meaningful.
- **Unreviewed streams block spurs.** Streams default to a closed riparian screening area until
  their review is recorded (`riparian.ts`). A patch behind one gets no spur, and the list says why.
  Record the review or change the stream's treatment; the tool never relaxes it.
- **Priced riparian screens can exhaust the route search's geometry budget** on long spurs in a
  project with many streams, even after cropping. The patch is skipped with the router's message.
- **The haul exit is a straight-line proxy.** Which end of a road is nearer the exit is not the
  network route a loaded truck takes. On a looped or winding network the swept-back heading can
  point the wrong way; check the loaded turn on each spur.
- **Greedy, not optimal.** Closest-first can put a short spur into a sliver and then a long one
  past it, or extend a spur along the block edge where a second spur from the main road would be
  shorter. Compare with your own layout before adding spurs.
- **A run goes stale.** Changing the block, the limits, the terrain or the mapped data marks the run
  stale. Adding or changing roads keeps the list but says the coverage needs a new run.

## Checked against a field layout

The tool was run locally on a field layout person's hand-drawn spurs for 19 planned blocks
(541 ha, 22 roads, 15 km) on the 22 m regional DEM, with the mapped FTEN and DRA roads around them
(DRA trails excluded) and the default rule. The data is a licensee's unreleased plan and is not in
the repository; only aggregate figures are given here.

- **With every road counted**, at most 0.5 % of any block is beyond reach (median 0 %). The farthest
  cell of each block is 173–372 m along the ground; a straight-line study of the same blocks found
  153–346 m.
- **Without each block's own drawn roads**, 12 of the 17 blocks that have drawn roads fall more than
  0.5 % beyond reach (5–100 % of their area). The straight-line study found the same 12 of 17. The
  same 12 fail when "30" is read as degrees, because these blocks are gentle.
- **Spur suggestions** on those 12 blocks, with streams left unreviewed as the app does: 7 reach the
  98 % target with suggested spurs totalling 4.0 km, against 6.2 km drawn on the same blocks. The
  field person designs to about 250 m rather than the 350 m ceiling, which accounts for most of the
  difference. In the other 5 the run stops at 47–95 % of the skiddable area: the remaining ground
  lies behind unreviewed stream screens, or no route to it meets the 12 % grade limit and the
  screens. Several of the drawn roads there cross small streams.
- **Landing screen**: 12 of the 22 drawn road ends have a candidate within 100 m. On this DEM the
  drawn ends are not measurably flatter than the blocks, so the screen cannot be tested further
  without LiDAR.
