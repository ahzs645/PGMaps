# Access-history research scripts

Reproduce the samples in
[`docs/forestry-road-design/bc-access-research-2026-11-09.md`](../../../docs/forestry-road-design/bc-access-research-2026-11-09.md).
They query BC's public WFS live; nothing here is shipped with the app.

Needs Python 3 with `shapely`. Results go to `$ACCESS_RESEARCH_CACHE`
(default `/tmp/pgmaps-access-research`).

```sh
python3 -I fetch_sections.py                    # all road-permit section attributes (~269k rows)
python3 -I validate_cp_names.py DPG 60          # names citing a CP, Prince George district
python3 -I validate_cp_names.py DCS 40 section_id   # CP-block-shaped section IDs only
python3 -I validate_block_ids.py DMK 50 2010    # block IDs in names, permits awarded since 2010
```

- `wfs.py`: minimal WFS client (`hits`, `features`, `all_features` with paging).
- `parse_names.py`: pulls licence, CP and block references from a section name or ID.

The sample seed is 20261109. Live services change, so a rerun can differ slightly
from the note's figures.

## Recent blocks and imagery

```sh
python3 -I recent_blocks.py DPG 80              # classify roads touching 80 blocks harvested since 2010
python3 -I recent_blocks2.py DPG                # match names against nearby blocks; FOM lookup for 2022+
```

The Sentinel-2 scripts need `rasterio` (a virtualenv works: `python3 -m venv venv && venv/bin/pip install rasterio shapely pyproj pillow`).
They read Sentinel-2 L2A from the Element 84 Earth Search STAC on AWS; no key is needed.

```sh
venv/bin/python s2_compare.py 1631649 AKI067 2023-06-15/2023-09-15 2025-06-15/2025-09-15   # before/after crops
venv/bin/python s2_timeseries.py 1631649 2023-05-01 2025-10-31                              # NDVI step along the access road
```

The first argument is the FTEN cutblock `OBJECTID`.

## How roads are drawn to a block

Builds on the `recent2_<DIST>.json` outputs above (blocks whose touching road names them).

```sh
python3 -I build_pairs.py DPG DMK DVA DQU DCC DOS   # block + named spur + roads/blocks within 3 km, per pair
python3 -I analyze_pairs.py                          # junction, nearest-road choice, reach, grades, stream crossings
python3 -I summarize_pairs.py                        # the section 8 tables
python3 -I network_choice.py                         # nearest vs joined road: same network? retired? fragment?
python3 -I haul_direction.py                         # same-network cases: is the joined point nearer the FSR?
python3 -I contour_following.py                      # in-block road grade vs block terrain slope
python3 -I through_roads.py                          # roads crossing a block: dead-end or through, and what lies beyond
python3 -I plot_pairs.py elsewhere sheet.png         # contact sheet (also: nearest, at_block, oids:1,2,3)
```

`dem.py` samples the public AWS Terrarium tiles (z13 by default, `TERRARIUM_ZOOM`), cached in the cache folder.
`analyze_pairs.py` accepts several pair folders, e.g. `pairs` and `expand/pairs` from a second sample.

## Generating roads and the reference set

```sh
python3 -I generate_road.py <pair.json>          # one block: generate with default settings and score against the built road
python3 -I calibrate_generator.py                # grid over A, GMAX, W_HAUL; licence-split train/test
python3 -I calibrate_core.py                     # variant: route to the block core
python3 -I generate_all.py 5 0.14 0              # every pair with the chosen settings -> generated.geojson, generated_scores.json
python3 -I shared_legs.py                        # do built legs also pass blocks cut in the same period or later?
python3 -I generate_group.py                     # group rule: plan with blocks cut within +/-2 years
python3 -I corridor_agreement.py                 # share of built road within 150/300 m of generated road
python3 -I export_reference_set.py <out_dir>     # GeoJSON + index + viewer.html (copied from this folder)
python3 -I plot_generated.py <reference-pairs.geojson.gz> sheet.png <pair,pair,...>
```

The saved set lives in `examples/forestry/access-history/reference-pairs/`; its README documents the fields and the rules.

Version 2 rules (water impassable, order-3+ stream crossings penalised) live in `generate_road.py` (`WATER`, `P_STREAM`, plus the tested-and-rejected `L_OTHER` and `DROP_LATER_PERMITS`).

```sh
python3 -I explain_elsewhere.py                  # reasons for joining elsewhere, keyed by block OBJECTID
python3 -I calibrate_v2.py                       # water / stream / licensee / later-permit rules on the licence split
python3 -I generate_all.py 5 0.14 0 200 1        # version 2 on every pair
```

## Whole setups (licence + cutting permit)

```sh
python3 -I build_setups.py       # every FTEN block of each sampled setup + roads named for it -> setups/*.json
python3 -I setup_metrics.py      # blocks, spread, harvest timing, connections, mainline vs spur per setup
python3 -I setup_hosts.py        # which existing road permits a setup's roads join
python3 -I setup_generate.py     # each block to its own best road vs one common host road
python3 -I export_setups.py <out_dir>   # reference-setups.geojson.gz
python3 -I plot_setups.py "A15384 C62,A20017 356" setups.png
```

`generate_all.py ... v3` switches the in-block layout to the slope-class targets from the layout study
(`docs/forestry-road-design/bc-access-research-layout.md`) and skips placeholder blocks.

## Road timing (Sentinel-2)

`timing/` holds the scripts behind `docs/forestry-road-design/bc-access-research-timing.md`; run them with the rasterio virtualenv.

```sh
venv/bin/python timing/fetch_series.py <pair.json> <series.json>   # NDVI per scene on road, ring, block, outer ring
python3 -I timing/detect.py 0.10 <series_dir>                     # step detection -> brackets_T0.10.json
python3 -I timing/analyze.py brackets_T0.10.json                  # tables + brackets_T0.10.csv
venv/bin/python timing/compare.py <OBJECTID>                      # before/after image for one block
```

Copy the CSV to `$ACCESS_RESEARCH_CACHE/road_first_seen.csv` and `export_reference_set.py` adds it to each block as `first_seen`.
