# Terrain sources for a road with no published LiDAR (12 November 2026)

What was found while working an imported licensee road block through `/dev/forestry/road-design`.
The block is called "the reference block" here and its longest road "the reference road" (3.6 km,
49 vertices); the licensee's names, files and coordinates are not recorded in this repository. It
lies on BCGS sheet 093I003, east of Prince George. Every figure below was measured that day.

## Short version

- **No public LiDAR covers the roads yet.** LidarBC records the area as flown in 2024, with nothing
  published. The licensee has its own LiDAR (its design maps are drawn from it).
- **Three independent coarse terrains agree** that the hillside is steep (side slopes of 60 % and
  more on the same stretches) and that about a third of the drawn road runs steeper than 12 %.
- **The imported roads have no profile.** The shapefiles are 2D lines, so the road follows the ground
  at the centreline and half of it sits on fill wherever the side slope is steep.
- **The project's 12 % grade limit is a default, not the licensee's standard.** At the Engineering
  Manual's spur row (16 % sustained) a fitted grade line costs about $1.05 M; at 12 % it costs $1.81 M.

## Why the road's sections were incomplete

| Finding                        | Evidence                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| The roads carry no elevations  | Shapefile shape type 3 (2D polyline); the workbooks beside them are route cards, not profiles   |
| Formation follows the ground   | `vertical: []` on every road of the project file                                                |
| Fill runs parallel to the hill | Ground 62–70 % beyond the formation against a 1.5:1 (67 %) fill batter on all six stretches     |
| A longer reach cannot help     | A batter no steeper than the ground never meets it; only one single-station stretch converges   |
| Count                          | 70 of 380 stations on the reference road: 29 on the right from 0+280, 41 on the left from 0+890 |

## Terrain sources checked

| Source                               | What it is                                  | At the reference block                                                                                                                                  | Can the app load it                                                              |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Regional Terrarium tiles             | About 22 m here, mixed satellite sources    | Complete; what the project was imported on                                                                                                              | Yes, directly                                                                    |
| LidarBC DEM 1:2,500                  | 1 m LiDAR bare earth, about 7 MB a tile     | No tiles. Nearest: 7.0 km (2025, LidarBC Program)                                                                                                       | Download, then load                                                              |
| LidarBC point cloud                  | LAZ, 0.3–2.8 GB a tile                      | No tiles. Nearest: 5.7 km (2019), 7.0 km (2025), 10.6 km (2021)                                                                                         | Import & data reads a downloaded tile                                            |
| LidarBC DEM 1:20,000 sheet `093i003` | 1 m, 618 MB, 2019 NDMP Floodplains          | Listed over every road, but no-data except a strip in the sheet's south-west corner (rows sampled across the file; only the last had values, 693 cells) | Download, then load; the load refuses it here ("no elevations in this area")     |
| LidarBC acquisition status           | Planned / flown / available, by year        | "Actual Acquisition", 2024, over every road                                                                                                             | Shown in the dialog                                                              |
| NRCan HRDEM mosaic, 1 m and 2 m      | LiDAR bare earth, cloud-optimised           | No-data at every sampled road point (Prince George itself has data)                                                                                     | Yes, directly                                                                    |
| NRCan MRDEM 30 m                     | Canada-wide terrain, mostly from Copernicus | Complete. 132 of 380 stations over 12 %, max 48 %; downhill side slope median 34 %, 90th percentile 64 %, max 79 %; 47 stations at 60 % or more         | Not wired: no finer than the regional terrain                                    |
| BC CDED (from TRIM air photos)       | 0.75″ posts, about 14 m × 23 m here         | Complete. 143 of 376 stations over 12 %, max 45 %; side slope median 38 %, 90th percentile 66 %, max 100 %; 68 stations at 60 % or more                 | Download, then load (added this day)                                             |
| Licensee's own LiDAR                 | Private                                     | Exists (the block's slope, canopy and hillshade maps are drawn from it)                                                                                 | Any projected GeoTIFF loads through **Load downloaded files…** or Terrain import |

Two things the table settles:

- **A listed tile is a footprint, not coverage.** The 1:20,000 index lists sheet `093i003` under all
  seven roads and the 2019 coverage outline contains them, but the file has no elevations there.
- **CDED is the independent check.** It comes from air photos, not the satellite data behind the
  other two coarse sources, and it reads the same hillside: on the reference road the app showed
  66 incomplete sections on CDED against 70 on the regional terrain, and the ground at the road's
  start within about 3 m of the regional value.

## What a browser can and cannot read

| Host                                                | CORS       | Consequence                                                              |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| LidarBC tile index and status layer (ArcGIS Online) | Open       | Queried live                                                             |
| LidarBC files (`nrs.objectstore.gov.bc.ca`)         | No headers | Linked; the reader downloads, the app reads the file back through `Blob` |
| BC CDED files (`pub.data.gov.bc.ca`)                | No headers | Same: linked, downloaded, read back                                      |
| NRCan HRDEM and MRDEM (`canelevation-dem` on S3)    | Open       | Windows read directly by byte range                                      |

The status layer's service is named `LidarBC_Progress_Dummy_Data` by its owner. Its answer is a lead
to confirm with LidarBC (lidar@gov.bc.ca), not a release promise.

## What the road costs on coarse terrain

**Compare best and worst case** on the reference road, 22 m regional terrain, project rates as
imported (end haul and waste unpriced, so the starred estimates leave out moving the surplus):

| Case                            | Complete | Cut m³  | Fill m³ | Usable cut − fill | Estimate     | Max grade |
| ------------------------------- | -------- | ------- | ------- | ----------------- | ------------ | --------- |
| As imported (partial)           | 81 %     | 11,868  | 11,441  | −759              | $462,858     | 42 %      |
| Best: 1:1 fill on six stretches | 100 %    | 18,671  | 16,392  | +412              | $639,604\*   | 42 %      |
| Worst: full bench on six        | 100 %    | 44,986  | 6,247   | +34,240           | $868,861\*   | 46 %      |
| Grade line held to 12 %         | 100 %    | 101,841 | 36,793  | +54,864           | $1,813,529\* | 12 %      |
| Grade line held to 16 % (spur)  | 100 %    | 50,641  | 18,773  | +26,804           | $1,046,623\* | 16 %      |

- Full bench lowered the formation by up to 3.1 m over 1,257 m.
- Holding 12 % needed the grade line up to 10 m from the ground (47 PVIs); holding 16 % stayed
  within 5 m (67 PVIs). The 16 % comes from the Engineering Manual's Table 3-5 spur row as carried in
  `searchPresets.ts`; the manual lists design speeds, not road classes, so the choice needs confirming.
- The 40 %-plus grades over single 10 m stations are terrain noise. The long runs at 15–25 % appear
  in all three terrains and are probably real.

## What to do for a block like this

1. Ask the licensee for a bare-earth DEM GeoTIFF of the block.
2. Ask LidarBC when the 2024 acquisition over the sheet will be published; published tiles then list
   in the Load 1 m DEM dialog.
3. Enter the roads' real grade standard before judging grades.
4. Until then, quote the best-to-worst range and call the design preliminary.
5. MRDEM, CDED and commercial 5 m products cannot change the answer: none resolves a road bench.

## What was built from this

| Piece                                        | File                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| Incomplete-section stretches and fixes       | `sectionFixes.ts`, `SidebarParts.tsx`, `CheckCard.tsx` |
| Full bench                                   | `fullBench.ts`                                         |
| Best, worst and grade-limit cases            | `terrainCases.ts`                                      |
| LidarBC tiles, status and download-then-load | `lidarBcDem.ts`, `localDemWindow.ts`                   |
| BC CDED download-then-load                   | `cdedDem.ts`                                           |
| Whole-road section scale, header warning     | `sectionFrame.ts`, `Charts.tsx`                        |

Guides: `docs/forestry-road-design/detail-dem.md`, `sections-quantities-and-costs.md`,
`stepping-and-section-ranges.md`, `profile-labels-and-bands.md`. Earlier portal research:
`docs/research/bc-lidar-portal.md`.

## Sources

- LidarBC download and discovery: <https://lidar.gov.bc.ca/pages/download-discovery>
- LidarBC availability dashboard: <https://bcgov03.maps.arcgis.com/apps/dashboards/5dd565b56e6140128f32b4d51ddd6dd7>
- NRCan CanElevation STAC mosaics: <https://nrcan.github.io/CanElevation/stac-dem-mosaics/>
- BC elevation data (TRIM, CDED): <https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/elevation>
- Sidehill fill limits: FAO Watershed Management Field Manual <https://www.fao.org/3/t0099e/T0099E03.htm>;
  NZ Forest Road Engineering Manual <https://docs.nzfoa.org.nz/live/nz-forest-road-engineering-manual-operators-guide/earthworks/cut-and-side-cast-construction/>
