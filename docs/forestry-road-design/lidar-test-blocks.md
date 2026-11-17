# LiDAR test blocks

**Projects → Find BC cutblocks** has two ways to find real blocks with LidarBC LiDAR to test the
designer on:

- **Check LiDAR** on a search result lists every LidarBC flight over that block. Each flight is
  placed before, during or after the block's reported harvest.
- **LiDAR test blocks**, at the foot of the panel, lists 22 blocks screened on 17 November 2026.
  They fall into three categories. Each opens through the same action as a search result:
  **Open study** for a block with an opening, **Design from block** for a planned one.

Opening a test block reads its records live. The LiDAR ground is then loaded the usual way:
**Terrain → Load 1 m DEM → LidarBC**, download the listed tiles, then **Load downloaded files…**
([Detail DEM](detail-dem.md#lidarbc-download-then-load-back)). A browser cannot read the LidarBC
object store directly.

## The three categories

| Category | Blocks | What it tests |
| --- | --- | --- |
| Planned, LiDAR flown before harvest | 8 | Designing access on LiDAR ground that predates the road. Each has 2024 or 2025 DEM and point-cloud tiles and a planned harvest in 2026–27. |
| Harvested between two LiDAR flights | 8 | What construction moved. Each has a DEM from a forestry acquisition flown before harvest (2011–2020) and one after (2022–2024). The difference shows the road and the harvest, and whether the road was already there at the first flight. |
| Built road, LiDAR flown after | 6 | A design or generated road against the road that was built. They come from the [reference set](../../examples/forestry/access-history/reference-pairs/README.md), and each needs one 2024–25 DEM tile. |

All 22 are Interior blocks: Prince George, Quesnel, Cariboo-Chilcotin, Vanderhoof, Mackenzie,
Selkirk, Okanagan Shuswap, Peace, 100 Mile House, Rocky Mountain and Thompson Rivers (Kamloops).

## What the screen found

The screen ran on 17 November 2026; the scripts and the way to repeat it are in
`scripts/forestry/lidar-candidates/`.

| Question | Count |
| --- | ---: |
| Planned FTEN blocks (no opening, no harvest reported, planned from 2025) | 8,665 |
| … with a LidarBC flight over the centre | 5,715 |
| … with a 2023-or-later flight | 3,171 |
| Blocks with harvest started 2017–2024 | 46,419 |
| … with a flight before the harvest and another after it, over the centre | 3,997 |
| Reference blocks (of 347) whose block and built road are covered by a flight after construction | 144 |
| Reference blocks covered by a flight before construction | 4 |

Flights before a road was built are rare in the historical record, because most LidarBC tiles
were flown from 2019 onwards. So design tests on pre-construction ground come from planned
blocks. The most common pair of flights over a block harvested between them is 2019 and 2024
(1,385 blocks).

On 17 November 2026, all 22 test blocks opened with the designer's own loaders, and **Check LiDAR**
placed their flights as listed. Two fixes made that possible:

- **Identifiers.** Three blocks were refused over how BC spells their identifiers (below).
- **The nearby-road check.** Three studies (LMR0039, WER0024 and 49K002) stopped at its comparison
  budget, because long road lines were compared in full, kilometres beyond the search distance. The
  check now skips road segments that cannot come within that distance. This is exact and keeps the
  budget for real work.

Four first picks for the before/after list were replaced. Three had only the 2019 NDMP floodplain
survey as their "before" flight. One (`DCR`, Campbell River) is a coastal district, not an Interior
one.

## What to watch for

- **A listed tile is a footprint.** The terrain load reports how much of the area has
  elevations. Check LiDAR does not.
- **Flood-mapping surveys can be mostly empty.** NDMP and floodplain acquisitions are flown along
  rivers, but their tiles are indexed whole. A separate screen of 2017 Okanagan tiles found data on
  only 29–38% of each tile, all of it valley bottom. Check LiDAR names each flight's project and warns
  on these surveys. It groups flights by project and year, because two projects can fly the same
  ground in one year: VRI 100 Mile House and the NDMP floodplain survey both flew in 2019.
- **Downloads are estimates.** Check LiDAR prices each flight from the product medians in
  `bcLidarIndex.ts`, because the index lists no sizes. A 1:20,000 DEM sheet is downloaded whole
  (about 600 MB), even though the terrain load reads only the block's window from it.
- **Planned is not proof that no road existed.** A planned block whose harvest date has passed
  may already have its road. Before calling a design pre-construction, check imagery from before
  the flight date.
- **Harvest and permit dates stand in for road construction**, which no public record dates. In a
  separate test near 100 Mile House, a road whose permit was dated 2022 already showed in the 2019
  hillshade. Only the difference between two surfaces dates a road.
- **Older 1:20,000 sheets carry only a year.** A flight in the harvest year is "during".
- **Planned harvest dates include placeholders.** On the screening date, 318 planned blocks carried
  2100, and a few carried dates in later centuries. The test list keeps to blocks planned for
  2026–27.

## Identifiers as BC records spell them

Opening the test blocks found three identifier forms that the parsers refused:

- tree farm licence timber marks with a slash (`52/14F`);
- road section IDs with a space (`FIVA 9210`);
- RESULTS cutting permits reported as a single space.

One pattern, `sourceIdentifier.ts`, now covers source records: slashes and single inner spaces are
allowed, and quotes and wildcards are not. A space-only value counts as absent. A typed search
field still refuses spaces, so a search term stays one code.
