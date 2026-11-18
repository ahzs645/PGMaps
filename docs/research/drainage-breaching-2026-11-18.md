# Least-cost breaching for the road drainage check (18 November 2026)

**Question.** Should the road designer's drainage check (`hydrology.ts`, guide
[drainage.md](../forestry-road-design/drainage.md)) gain a `breach` depression policy? The case
for it: full Priority-Flood filling turns a draw dammed by a road prism in the LiDAR (whose
culvert the LiDAR cannot see) into a pond, which reports false ponding and low points and can
send the draw's flow somewhere else. Least-cost breaching (Lindsay 2016, _Efficient hybrid
breaching-filling sink removal methods for flow path enforcement in digital elevation models_,
Hydrological Processes 30(6)) cuts through the dam instead.

**Answer: no, not now.** The evidence is mixed. Breaching removes the small false ponds behind
roads on gentle ground, but with Whitebox's default search it leaves the two largest road ponds
in place, with a 1,000-cell search it cuts up to 10.8 m through ground to remove them, it changes
the stream network well away from roads, and in the road check itself it found fewer mapped
stream crossings than full fill (10 of 17 against 12 of 17). Applied to the design surface it
would hide every pond behind the new prism, which is how the check finds cross-drain sites. A
targeted alternative, cutting only where a mapped stream crosses a mapped road (Whitebox
`burn_streams_at_roads`), did better than both (15 of 17) and is the one worth pursuing.

Bench: [`scripts/forestry/drainage-bench/`](../../scripts/forestry/drainage-bench/README.md).
Nothing in `src` was changed.

## Terrain

Five 1 m bare-earth LiDAR tiles near Prince George, each about 1.65 × 1.43 km (2.3–2.4 million
cells), with the public FTEN road sections, Digital Road Atlas roads and FWA streams over them.
They were chosen where FWA streams cross FTEN roads; four are LidarBC 1:2,500 DEM tiles and one is
the deployed LiDAR analysis DTM.

| Tile                   | Source            | Relief | Road lines | Mapped road–stream crossings |
| ---------------------- | ----------------- | -----: | ---------: | ---------------------------: |
| 093g086 (analysis DTM) | 2024 point cloud  |  206 m |        146 |                           24 |
| 093g089_3_4_3          | LidarBC DEM, 2025 |  127 m |         33 |                           11 |
| 093g099_1_3_3          | LidarBC DEM, 2024 |   35 m |         54 |                           10 |
| 093j004_2_3_2          | LidarBC DEM, 2024 |   58 m |         40 |                            3 |
| 093j015_2_3_4          | LidarBC DEM, 2024 |   28 m |         35 |                            7 |

This is the interior plateau: gentle, with wetlands and flat basins. No steep mountain tile with
LidarBC coverage and mapped crossings was tried, so how breaching behaves on steep cut-and-fill
roads across gullies is untested here.

## Method

`bench.ts` conditions each whole tile eight ways and routes every result with PGMaps' own D8,
accumulation and stream extraction, so only the conditioning differs: PGMaps fill-all, preserve
and depth-limited (0.5 m); Whitebox `fill_depressions`; `breach_depressions_least_cost` with
`--max_dist` 20, 100 (Whitebox's default) and 1,000 cells, each with `--fill_deps` so whatever
cannot be breached is filled; and `burn_streams_at_roads` (25 m) followed by PGMaps' fill-all.
Streams are 1 ha (the check's default). "Pond" is potential depth over 5 cm (the check's
`pondDepthM`), measured without fill-all's ε. Road cells are those within 8 m of a mapped
centreline.

`road-runs.ts` runs the check itself: 15 roads (three per tile, 348–1,903 m) pegged along mapped
roads, grade 0.4 m over the ground, 150 m buffer, 1 m cells, no culverts. Each is run with the
three policies, with the existing ground breached before the road is burned in
(`breach-existing`, `--max_dist=100 --fill_deps`, then fill-all), with both surfaces breached
(`breach-both`), and with the existing ground burned at mapped stream crossings (`burn-existing`).

## Results on whole tiles

Pond area (m²), all of it and the part touching a road, under each conditioning:

| Tile          | Fill-all | of it at roads | Breach 100 | at roads | Breach 1,000 | at roads | Burn + fill | at roads |
| ------------- | -------: | -------------: | ---------: | -------: | -----------: | -------: | ----------: | -------: |
| 093g086       |   68,236 |         22,514 |      9,858 |      285 |        9,858 |      285 |      68,235 |   22,514 |
| 093g089_3_4_3 |   67,004 |          8,496 |      6,652 |      270 |        6,652 |      270 |      66,766 |    8,245 |
| 093g099_1_3_3 |  103,675 |         11,845 |      8,329 |      577 |        8,329 |      577 |     103,560 |   11,728 |
| 093j004_2_3_2 |  355,019 |        267,831 |    253,750 |  185,621 |        3,124 |      253 |     355,012 |  267,824 |
| 093j015_2_3_4 |  228,227 |         95,024 |     93,735 |   81,925 |        7,127 |      345 |     205,819 |   70,766 |

Fill-all ponds 3–15 % of each tile; 11–75 % of that touches a road. The two plateau tiles hold
the large cases: on 093j004 a road across a narrow valley neck and the basin behind it make one
26 ha fill pond (941,000 m³ of fill, a mean 2.6 m deep) that floods over the road, and on 093j015
a highway-class road dams two draws, 1.9 m deep at the mapped crossing. Part of each is real: FWA
maps a 6.6 ha wetland and a 3.7 ha lake on 093j004.

What breaching cuts to get there (breach 100; breach 1,000 differs only on the last two tiles):

| Tile          | Cells cut | Cut m³ | Deepest cut | Channels cut through a road centreline | Deepest cut, 1,000 |
| ------------- | --------: | -----: | ----------: | -------------------------------------: | -----------------: |
| 093g086       |    25,943 |  2,425 |      4.98 m |                                     51 |             4.98 m |
| 093g089_3_4_3 |    39,057 |  3,201 |     10.50 m |                                     49 |            10.50 m |
| 093g099_1_3_3 |   107,561 |  5,250 |      1.07 m |                                    212 |             1.07 m |
| 093j004_2_3_2 |    21,886 |  1,130 |      5.63 m |                                     63 |            10.79 m |
| 093j015_2_3_4 |    89,341 |  5,316 |      1.37 m |                                     71 |             1.90 m |

Breaching works pit by pit: each depression's lowest cell searches for the cheapest path to lower
ground within `max_dist` cells. On flat plateau ground there are tens of thousands of LiDAR pits,
so it cuts 1–4.5 % of the tile, and up to 212 small channels through road centrelines where a
pit beside the road found lower ground across it. The large road ponds are not reached at the
default distance because their lowest cell lies far from the road and the ground below the dam
stays above it for more than 100 cells; at 1,000 cells they are breached, with cuts reaching
10.8 m elsewhere on the tile. Burning cuts only 33–333 cells a tile.

Stream agreement with fill-all (1 ha streams; "within 2" is the share of fill-all's stream cells
with the other's within two cells):

| Tile          | Whitebox fill: exact / within 2 |  Breach 100 | Breach 1,000 | Burn + fill |
| ------------- | ------------------------------: | ----------: | -----------: | ----------: |
| 093g086       |                     0.86 / 0.98 | 0.49 / 0.76 |  0.49 / 0.76 | 0.89 / 0.96 |
| 093g089_3_4_3 |                     0.91 / 0.98 | 0.50 / 0.84 |  0.50 / 0.84 | 0.95 / 0.98 |
| 093g099_1_3_3 |                     0.74 / 0.91 | 0.31 / 0.65 |  0.31 / 0.65 | 0.85 / 0.93 |
| 093j004_2_3_2 |                     0.51 / 0.71 | 0.36 / 0.68 |  0.29 / 0.61 | 0.99 / 1.00 |
| 093j015_2_3_4 |                     0.75 / 0.92 | 0.21 / 0.60 |  0.15 / 0.51 | 0.74 / 0.89 |

Where breach-100's network leaves fill-all's (fill-all stream cells with no breach stream within
two cells), split by place:

| Tile          | Within 22 m of a road | In a fill-all pond | Elsewhere |
| ------------- | --------------------: | -----------------: | --------: |
| 093g086       |                 2,189 |                327 |       987 |
| 093g089_3_4_3 |                   702 |                266 |     1,909 |
| 093g099_1_3_3 |                 1,841 |                834 |     3,694 |
| 093j004_2_3_2 |                   945 |              2,617 |       644 |
| 093j015_2_3_4 |                 1,182 |              2,042 |     3,601 |

Most of the change is not at roads: breaching re-routes flow across the whole tile through the
micro-relief it cuts, so the network moves well beyond the dams it was meant to open.

**At mapped crossings.** At the 29 FWA–road crossings where some method routes at least 1 ha
within 30 m, flow passes the road (downstream at least 0.8 × upstream, upstream at least 0.5 ha)
at 22 under fill-all, 22 under every breach distance, 21 under Whitebox fill and 24 after
burning. At the 17 crossings where fill-all ponds more than 0.3 m, fill-all and breaching mostly
agree, because the fill pond usually spills over the road at the draw itself, where the prism is
lowest. They disagree at three:

- On 093j015, a 28 ha stream: fill-all sends it to the neighbouring mapped crossing 200 m along
  the road; breaching and burning both cross at its own mapped crossing (1.3 ha against 29.8 ha).
  Here fill-all misroutes, as the hypothesis says.
- On 093j015, the 135 ha creek: breach 1,000 splits its catchment and passes 66 ha (breach 100:
  110 ha, burn: 107 ha, fill-all: 135 ha).
- On 093g089_3_4_3, an 18 ha crossing passes 12–13 ha after breaching.

## Results in the road check

Totals over the 15 roads (crossings and cross-drain sites matched to fill-all's within 40 m of
chainage; mapped crossings are FWA crossings within 15 m of the road's line with a modelled
crossing within 50 m):

| Conditioning    | Crossings | Lost / new vs fill-all | Cross-drain sites | Lost / new | Pond sites | New ponding m² | Mapped crossings found |
| --------------- | --------: | ---------------------: | ----------------: | ---------: | ---------: | -------------: | ---------------------: |
| fill-all        |        47 |                      — |                94 |          — |         35 |         33,360 |                12 / 17 |
| preserve        |         1 |                 46 / 0 |                67 |    45 / 18 |         39 |         33,360 |                 0 / 17 |
| depth-0.5       |        31 |                 14 / 1 |                99 |     5 / 10 |         49 |         33,360 |                 7 / 17 |
| breach-existing |        45 |                  8 / 7 |                97 |     6 / 10 |         40 |        54,428¹ |                10 / 17 |
| breach-both     |        45 |                  8 / 7 |               106 |     8 / 23 |          0 |              0 |                10 / 17 |
| burn-existing   |        49 |                  2 / 3 |                98 |      1 / 5 |         41 |        53,249¹ |                15 / 17 |

¹ The bench conditions the existing ground before the check sees it, so the check measures
existing ponding on ground already breached or burned, finds none, and counts ponds the LiDAR
already had under the footprint as new. A real policy would keep measuring potential ponding on
the ground as surveyed ([drainage.md](../forestry-road-design/drainage.md#routing): potential
ponding is reported under every policy); the figure is inflated, not a finding.

- Breaching the existing ground changed 15 of 47 crossings (8 lost, 7 new) and found two fewer
  mapped crossings than fill-all. On the first 093j015 road it dropped the mapped creek crossing
  (39.4 and 8.5 ha at chainages 761 and 780 m under fill-all) because the breached wetland
  upstream drained elsewhere (north, out of the corridor, in the plot), and added a 4 ha pond
  crossing.
- Breaching the design surface is ruled out. The check finds cross-drain sites partly from the
  ponds the new prism makes against the slope; breaching cuts through the new prism, so all 35
  pond sites and all new ponding vanish and 23 sites appear where a breach channel leaves the
  footprint, each a culvert that is not there.
- Burning only at mapped stream crossings changed 5 crossings and 6 sites and found 15 of 17
  mapped crossings.

## Whitebox against PGMaps (sanity check)

**D8 on the same surface.** Whitebox's `d8_pointer` and PGMaps' `flowDirections` on the same
filled surface agree on 99.54–99.91 % of cells, and every differing cell is an exact tie between
two equally steep neighbours (Whitebox scans from north-east, PGMaps from east, both keeping the
first maximum). Accumulation is identical on 92.7–97.5 % of cells and 1 ha stream cells agree with a
Jaccard index of 0.92–0.99; ties near the top of a flow path propagate downstream.

**Fill against fill.** PGMaps fill-all and Whitebox `fill_depressions` give the same D8 on
97.4–99.5 % of cells on four tiles and 87.6 % on 093j004 (99.5–99.9 % where neither surface was
changed). Three causes, none an error in either:

1. Flats inside filled depressions. PGMaps adds ε = 0.00001 m a cell inwards from the spill
   (Barnes et al. 2014), so a filled flat drains in straight lines to its spill; Whitebox resolves
   flats by Garbrecht and Martz. Both are arbitrary over a filled pond. 093j004 is 20 % changed
   cells, most of it the 26 ha pond.
2. Missing data. PGMaps drains every cell next to a missing cell (drainage.md, "the grid edge
   and data holes are outlets"); Whitebox's fill treats no-data as a wall. Against PGMaps' fill
   without ε, Whitebox leaves 7,681 cells on 093j015 more than 1 cm higher (none lower), 1,111 of them within 3
   cells of no-data, and fills 42,000 m³ against 16,300 m³ on 093g099, whose holes are larger.
   Whitebox's breach, unlike its fill, does treat a no-data neighbour as an outlet.
3. The ε lift itself is at most 6.4 mm, but it carries 20,823 cells on 093j015 past the 5 cm
   pond threshold; the check measures ponding without ε (`conditionDrainageSurface`'s `depth`),
   so this only matters to anyone comparing routed surfaces.

**Speed.** On 2.3–2.4 million cells PGMaps' conditioning takes 0.4–0.8 s; Whitebox through
`whitebox-wasm`'s WASI runner takes 0.6–1.0 s for fill or breach, including GeoTIFF encoding.

**Context.** `fd8_flow_accum`, `wetness_index` and `elevation_above_stream` ran on the breached
surfaces (about 4–7 s a tile). The median wetness index inside fill-all ponds is 5.0–6.8 on the
three tiles that breach resolves and 25–27 on the two that keep their large ponds (4.0–4.8
elsewhere). The median height above the 1 ha streams inside those ponds is 0.1–1.1 m on the first
three tiles and 0 m on the last two, as it is in a filled flat.

## Why not breach

- **It does not reliably do the job.** At Whitebox's default distance the two largest road ponds
  stay (69 % and 86 % of the road-touching pond area remains); a distance that removes them cuts
  10.8 m elsewhere. There is no distance that opens road dams and leaves other ground alone,
  because the search starts from each depression's lowest cell, not from the dam.
- **It changes much more than the dams.** 22,000–108,000 cells cut a tile, up to 212 channels
  through road centrelines, and a stream network whose overlap with fill-all's is a Jaccard index of only
  0.21–0.50, most of the change away from roads.
- **It did not find more mapped crossings** in the road check (10 against 12 of 17) and passed
  flow at the same 22 of 29 mapped crossings on whole tiles.
- **On the design surface it is wrong by construction**, and the check runs one policy on both
  surfaces (`surfaceDrainage` in `analyzeDrainage`). A breach policy would need its own path for
  the existing ground only, which is a larger change than adding a mode.
- On this plateau, depressions are mostly real: wetlands, beaver ponds, flat basins. Filling
  connects them, which the guide already says; breaching invents outlets for them.

The one clear case for cutting (the 28 ha stream on 093j015) was fixed equally by burning at the
mapped crossing.

## Recommendation

1. Keep fill-all as the default and add no breach policy.
2. If road dams in the LiDAR are to be handled, prototype the targeted cut: lower the existing
   ground where a mapped stream (FWA, or the project's own stream lines) crosses an existing road
   on the terrain, across the road's width, on the existing surface only, never the design
   surface. It found 15 of 17 mapped crossings, left 89–100 % of fill-all's stream cells within two
   cells, and cut 33–333 cells a tile. Before building it, check: FWA lines are 1:20,000 and can lie
   tens of metres off the LiDAR channel, so the cut should snap to the lowest point of the road
   prism near the mapped crossing; Whitebox's burn cut 6.9 m on 093g086, so it needs a depth
   limit; and it must work on the tiled corridor grid in dense order. Whitebox's
   `burn_streams_at_roads` is MIT OR Apache-2.0, so its method may be adapted with a notice.
3. A cheaper step with no routing change: flag fill ponds that touch an existing road in the
   ponding layer ("possibly an unmodelled culvert"), so a reviewer reads them as the dam they
   probably are.

## Limits of this study

- Five tiles, all interior plateau; no steep gully crossings.
- The ground truth is FWA mapped streams, digitised at 1:20,000, and the road lines are FTEN and
  DRA records, neither registered to the LiDAR. A mapped crossing counts as found within 50 m.
- The road check was run on dense corridor boxes (as before tiling), without culverts, on roads
  pegged along existing roads with a ground-following grade. That is a reconstruction, not a new
  road across undisturbed ground.
- Breaching was Whitebox's implementation only (`whitebox-wasm` 0.6.1), not a PGMaps port; its
  arguments are those listed in the bench README (`--dist` and `--fill`, the classic names, are
  silently ignored by this build).
