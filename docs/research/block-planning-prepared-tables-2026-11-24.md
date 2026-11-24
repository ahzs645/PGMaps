# Prepared tables for the block planner

Measured 24 November 2026. The block planner reads DataBC live: a sub-unit's cutblocks and fires take 20–66 s, the Board check 1–2.5 minutes, and an old forest unit 1–5 minutes (VRI, OGMAs, parks and corridors read, then prepared in the browser). The largest units are refused outright: A13 is about 545,000 ha gross, past `MAX_STANDS`. This note sizes the prepared tables that would make those near-instant, and says where they would live. None of it is built.

## What the Prince George TSA holds

**Method.**

- The TSA is the order's own polygons: 1,930 polygons, 50 Map 2 units, 16 district × sub-unit combinations, 7.95 Mha. Their bounding box is 27.3 Mha and over-counts about 2.5×, so counts were taken against a coarse outline of the polygons (`INTERSECTS`, or ArcGIS `returnCountOnly` for cutblocks).
- Bytes per feature were measured on real samples and multiplied by the counts. For fires, legal OGMAs and parks the whole sets were read, so those rows are exact.
- "p5" is coordinates rounded to 1e-5° (about 1 m); the app reads at 1e-7°.

| Dataset (inside the TSA)                                                    | Records           | Raw, p5        | Gzip, p5         | Gzip, p7 |
| --------------------------------------------------------------------------- | ----------------- | -------------- | ---------------- | -------- |
| Order units (Map 1 and Map 2 polygons, slim attributes)                     | 1,930             | 56 MB          | 13.6 MB          | 23 MB    |
| Order units simplified to 2 m                                               | 1,930             | 26 MB          | 6.5 MB           | –        |
| Consolidated cutblocks, all years                                           | 76,323            | 254 MB         | 55 MB            | 81 MB    |
| Consolidated cutblocks, 1995 on                                             | 58,595            | 195 MB         | 42 MB            | 62 MB    |
| Fire perimeters, 1950 on (exact)                                            | 1,128             | 5.5 MB         | 1.25 MB          | 1.8 MB   |
| VRI rank 1, the old-forest fields with geometry                             | 706,358           | 1.24 GB        | 201 MB           | 276 MB   |
| VRI attributes only                                                         | 706,358           | 44 MB          | about 4–10 MB    | –        |
| VRI aggregated: unit × 5-year age class × leading group × treed × land base | about 15–40k rows | about 1–1.5 MB | about 0.2–0.4 MB | –        |
| Legal OGMAs (exact)                                                         | 278               | 2.8 MB         | 0.61 MB          | 0.92 MB  |
| Non-legal OGMAs                                                             | 11,357            | 35 MB          | 7.5 MB           | 11 MB    |
| Parks and protected areas (exact)                                           | 71                | 3.9 MB         | 0.89 MB          | 1.3 MB   |

The aggregated VRI table is estimated: three sample boxes gave 629 distinct combinations, about 3.5 KB gzip, scaled to 50 units. The attributes-only gzip range is uncertain because the samples come from small, uniform boxes.

**Live read times.**

- Cutblock pages take 2.2–5.7 s each, so a whole-TSA read is about 77 requests and 4–6 minutes.
- VRI `INTERSECTS` on the whole TSA outline timed out at 60 s. Small boxes answer about 3,000 polygons in 1.5 s.
- One unit's VRI:
  - A10: 6,333 stands, read in about 80 s;
  - A5 and A6: about 2,000 stands each, 20–30 s.

**A paging fault found while measuring.** The cutblock service (`MapServer/543`) cuts pages short on its transfer limit: 105, 488 and even 0 of 1,000 records, each flagged `exceededTransferLimit`. The planner's reader stopped at the first short page and lost records: Prince George Moist Interior – Mountain kept 2,605 cutblocks where 2,739 exist. `readCutblockPages` now pages by `OBJECTID` and keeps going while the service says more remain.

## What to prepare, and where

bcdatamapper's Pages site holds 541 MB of its 1 GB. The tables below add about 60 MB, stored as `.json.gz`, which `fetchJson` already inflates.

| Table                                                                                        | Size (gzip)                   | Replaces                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Board check and no-harvest projection: 16 sub-units × (2015, 2018, eleven years) × 4 classes | under 50 KB                   | the 1–2.5 minute Board check                                   |
| Old forest per unit: the aggregated VRI table, the targets and baseline interior             | about 0.2–0.4 MB              | old forest's CFLB and old figures for every unit, A13 included |
| Order units simplified to 2 m, one file per sub-unit                                         | about 6.5 MB (0.4 MB each)    | the live unit read                                             |
| Cutblocks and fires from 1995 per sub-unit, with the 5 km margin                             | about 50 MB (about 3 MB each) | the 20–66 s baseline read                                      |

These stay off Pages:

- **VRI geometry.** About 200 MB gzip for the TSA. Interior forest near a block needs it. It goes as PMTiles on R2 (`data.map.ahmad.sh`, as the Canada admin story's are), or stays live, read only round the blocks.
- **Non-legal OGMAs.** 7.5 MB would fit, but they are only needed spatially near blocks. Keep them live, or put them in the per-unit package.

**Producer and paths.**

- A bcdatamapper scraper under `datascrapers/bc/<name>/output`, following the WARS pattern: a manifest plus deterministic `*.gz` snapshots.
- Published through `pages/site.json`, and listed under the bcdatamapper host in `src/config/data-hosts.json`.
- Read with `withBase` and `fetchJson` (AGENTS.md, **Data hosts**).
- Every manifest carries its read date, because the planner prints it.

**Refresh.**

- Consolidated cutblocks and VRI: once a year. VRI's `PROJECTED_DATE` is now 2025-12-31.
- Fires: after each season.
- The order's units: only on a legal change.

**Read time saved.** A unit's baseline goes from 20–66 s to about 1–2 s, the Board check from minutes to instant, and old forest's CFLB and old figures from minutes to instant. Interior forest still needs geometry near the blocks.
