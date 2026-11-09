# BC block–road reference set

347 real BC cutblocks harvested since 2010 whose own road is known: a road section
touching the block is named after it (`AKI067.1000`, `153-10 ACCESS 1`). For each
block the set holds what was built, the network it could have joined, and roads
generated from rules learned on the set, so the two can be compared. A second
file holds the 294 setups (licence + cutting permit) those blocks belong to: all
1,434+ blocks of each setup and every road named for it.

Source: FTEN cutblock polygons and FTEN road section lines (BC Ministry of Forests),
retrieved 2026-11-09; storing the road section layer is cleared for PG Maps. Six
districts: Prince George, Mackenzie, Vanderhoof, Quesnel, Cariboo-Chilcotin,
Okanagan Shuswap. How the pairs were found and what they show is in the
[research note](../../../../docs/forestry-road-design/bc-access-research-2026-11-09.md),
sections 7–9; the slope and woodlot rules come from the
[layout study](../../../../docs/forestry-road-design/bc-access-research-layout.md).

## Files

| File                                              | Contents                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference-pairs.geojson.gz`                      | Every pair's features in one GeoJSON (WGS84), 1.6 MB gzipped                                                                                         |
| `reference-pairs.index.json`                      | One row per block: scenario, tags, IDs, harvest date, centroid                                                                                       |
| `reference-setups.geojson.gz`                     | Every setup's blocks and named roads (WGS84), 2.6 MB gzipped                                                                                         |
| `viewer.html`                                     | Browse the set on a map                                                                                                                              |
| `generated-vs-built.png`                          | Eight examples of generated roads against the built ones                                                                                             |
| `road-first-seen.csv`                             | Sentinel-2 first-seen interval for 146 blocks' roads (96 dated) ([timing study](../../../../docs/forestry-road-design/bc-access-research-timing.md)) |
| `first-seen-example.jpg`, `first-seen-series.png` | A road appearing at harvest; twelve NDVI series with their brackets                                                                                  |
| `setups.png`                                      | Four whole setups: a spur per block off existing roads, and one with shared new road                                                                 |

## Open the viewer

The viewer loads the GeoJSON next to it, so serve the folder over HTTP rather
than opening the file directly. With the PG Maps dev server running:
`http://localhost:5173/examples/forestry/access-history/reference-pairs/viewer.html`.
Or, from this folder, `python3 -m http.server 8000` and open
`http://localhost:8000/viewer.html`. Add `?pair=<OBJECTID>` to open one block.

Filter by scenario or reason, or search a block, licence, CP, opening or road
name. The map draws the block, the road built for it, other existing roads, the
real junction, the network's nearest point, and the generated roads. With
**Whole setup** on, it also draws the selected block's whole setup (its other
blocks and every road named for it, in orange) and lists the setup's spread,
harvest timing and the existing roads it joins. Imagery tiles come from Esri and
street tiles from OpenStreetMap.

## Feature roles

Every feature carries `pair` (the FTEN cutblock `OBJECTID`) and `role`:

| `role`                   | Geometry   | Meaning                                                                                                                                                                |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block`                  | Polygon    | The cutblock, with IDs, harvest dates, `scenario`, `tags`, `metrics`, `generated` scores and, for 146 blocks, `first_seen` (when its road first appears in Sentinel-2) |
| `built_road`             | LineString | FTEN road sections named for the block: what was built                                                                                                                 |
| `existing_road`          | LineString | Other FTEN road sections within 1 km (clipped to 1.5 km)                                                                                                               |
| `junction`               | Point      | Where the built road joins the network                                                                                                                                 |
| `nearest_point`          | Point      | The network's nearest point to the block                                                                                                                               |
| `generated_access`       | LineString | Access leg generated for this block alone                                                                                                                              |
| `generated_junction`     | Point      | Where that generated leg joins                                                                                                                                         |
| `generated_group_access` | LineString | Roads generated for this block together with blocks cut within ±2 years                                                                                                |
| `generated_in_block`     | LineString | Generated in-block roads                                                                                                                                               |

In `reference-setups.geojson.gz`, every feature carries `setup` (`"<licence>|<CP>"`,
matching a block's `licence` and `cutting_permit`) and `role`: `setup_block` (every
FTEN block of the setup; the first carries a `summary` of the setup's
measurements), `setup_road` (a road section named for the setup, with
`matched_by`: `block_id`, `cp_block` or `cp`), and `setup_generated` (roads
generated to one common host road, for 115 setups).

## Scenarios and tags

| `scenario`         | Blocks | Meaning                                                          |
| ------------------ | ------ | ---------------------------------------------------------------- |
| `road_at_block`    | 193    | An existing road already reached the block (≤ 20 m)              |
| `joined_nearest`   | 40     | The built leg joined within 150 m of the network's nearest point |
| `joined_elsewhere` | 114    | The built leg joined somewhere else                              |

| Tag                                 | Blocks | Meaning                                                                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `steep_straight_alternative`        | 47     | A straight connection to the nearest road would exceed 12%                                  |
| `nearest_is_small_separate_network` | 16     | The nearest road belongs to a smaller, separate network that does not leave the 3 km window |
| `shorter_haul_to_fsr`               | 29     | Same network; the joined point is more than 100 m closer to an FSR along it                 |
| `nearest_road_retired`              | 13     | The nearest road's permit section is retired                                                |
| `laid_out_around_existing_road`     | 22     | A road not named for the block crosses it and continues to blocks cut earlier               |
| `development_road_continues`        | 17     | The block's own road crosses it and continues to blocks cut alongside or later              |

`metrics` holds the measurements behind these (distances in metres, grades in
percent from a regional DEM, see the research note for definitions).

## The road rules and how well they reproduce what was built

The generator (`scripts/forestry/access-research/generate_road.py`, group rule
in `generate_group.py`) applies, with the block's real road removed:

1. If an existing road reaches the block, build no access leg.
2. Otherwise consider joining points every 40 m along existing roads within
   1 km, skipping retired roads and isolated fragments under 1 km.
3. Cost new road by length × (1 + 5 × grade above 6%); block grades above 14%
   (on the regional DEM, which smooths short pitches). Wetlands, lakes, rivers
   and reservoirs are impassable; each order-3+ stream crossing adds 200 m.
4. Join where that cost is lowest. A haul-distance term was tested and did not
   improve predictions.
5. Plan the roads for the block together with neighbouring blocks cut within
   ±2 years, connecting the cheapest-to-reach block first.
6. Inside the block, add contour-holding branches until 90% of it is within
   175 m of a road (mean slope under 15%) or 150 m (15% and steeper).
7. Draw nothing for a placeholder block (a 0.55–0.65 ha triangle).

Settings were chosen on half the licensees and tested on the other half.

| Check                                                               | Rules            | Nearest point       |
| ------------------------------------------------------------------- | ---------------- | ------------------- |
| Joining point within 150 m of the real one (test half)              | 36%              | 29%                 |
| Joining point within 300 m (test half)                              | 47%              | 38%                 |
| Joining point within 150 m, legs not shared with other blocks       | 42%              | —                   |
| Built road outside the block within 300 m of generated              | 43% (group rule) | —                   |
| In-block road, generated (flat / sloped blocks)                     | 35 / 42 m/ha     | target 40 / 55 m/ha |
| Setup level: block joined to an existing road the setup really used | 70%              | —                   |

The rules capture the structure: when no access leg is needed, how to keep
gentle grades, contour-following in-block roads, and the shared roads planned for
several blocks. They do not yet pick the exact junction or route most of the
time. A third of the built legs are shared with blocks cut in the same period or
later, and those are the hardest; the rest also depend on landings, soils, the
destination mill and roads whose age the data cannot show. A 1 m LiDAR DEM did
not change the junction findings.

## Regenerate

From `scripts/forestry/access-research/` (see its README):

```sh
python3 -I explain_elsewhere.py          # reasons for joining elsewhere (needs network_choice.py first)
python3 -I generate_all.py 5 0.14 0 200 1 v3   # single-block rules on every pair (water, streams, slope-class in-block layout)
python3 -I shared_legs.py                # which built legs also serve other blocks
python3 -I generate_group.py             # group rule
python3 -I build_setups.py && python3 -I setup_metrics.py && python3 -I setup_hosts.py && python3 -I setup_generate.py
python3 -I export_reference_set.py ../../../examples/forestry/access-history/reference-pairs
python3 -I export_setups.py ../../../examples/forestry/access-history/reference-pairs
```
