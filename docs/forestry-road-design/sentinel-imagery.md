# Sentinel-2 imagery on the plan

**View → Map layers → Sentinel-2 imagery** (also a row in the plan's **Map settings**, and found by
**Find tools**) draws Copernicus Sentinel-2 imagery over the loaded terrain, under every engineering
layer. Its card on the plan lists recent scenes and switches between three displays:

- **True colour**: the scene's TCI image as published.
- **NDVI**: (NIR − red) ÷ (NIR + red) from bands B08 and B04, on reflectance, with cloud, cloud
  shadow, snow and no-data pixels left clear.
- **NDVI change**: the later scene's NDVI minus the earlier one's. A drop of
  `SENTINEL_CLEARING_NDVI_DROP` or more is drawn as a clearing and reported as
  "Clearing on _n_ ha: first seen between _earlier date_ and _later date_ (Sentinel-2)".

The code is in `src/pages/dev-forestry-roads/sentinel/`.

## What the imagery is, and what it is not

- **Evidence only.** The imagery is never a constraint, never feeds Find the best route or any
  other search, and is not proof of a road. Nothing it shows is written into the project.
- **10 m pixels.** A 4–6 m running surface is narrower than a pixel. What shows is a cleared
  corridor, and only where it is wide enough; a narrow spur under canopy may not show at all.
- **A change is an interval, never a date.** "First seen between X and Y" means the ground was
  cleared some time between the two scenes, as
  [When block roads are built](bc-access-research-timing.md#what-it-means-for-the-app) requires.
  It is not when a road was built or became drivable, and on a short spur it cannot be told apart
  from the block's own clearing. A bracket with any day from November to April adds
  "(snow gap)". The two dates are the scenes picked, not a detected step: pick the closest clear
  pair to narrow the bracket.
- **NDVI change catches more than clearings.** Crops, deciduous leaf colour, haze and fire all move
  NDVI. Compare scenes from the same part of the summer.
- **Credit.** Every view carries "Contains modified Copernicus Sentinel data _years_" in the
  map's attribution and on the card.

## Where it comes from

- Scenes: Element 84 Earth Search, `POST https://earth-search.aws.element84.com/v1/search`,
  collection `sentinel-2-l2a` (`SENTINEL_STAC_SEARCH_URL`, `SENTINEL_COLLECTION`). No key; the
  API sends `Access-Control-Allow-Origin: *`.
- Pixels: the item's `visual` (TCI), `red` (B04), `nir` (B08) and `scl` (scene classification)
  Cloud-Optimized GeoTIFFs in the AWS `sentinel-cogs` bucket, read by byte range through
  geotiff.js (`cogReader.ts`). Only the window over the terrain is fetched.
- Reflectance is DN × `scale` + `offset` from the item's `raster:bands`. Earth Search has already
  removed the −0.1 offset of processing baseline 04.00 and later from the pixels
  (`earthsearch:boa_offset_applied: true`) while still listing it, so the offset is applied only
  when that flag is absent or false (`stac.ts`). Applying it twice read September 2025 conifer
  near Prince George at zero red reflectance and NDVI 1 everywhere.
- Clear ground is scene classification 4–7 (vegetation, not vegetated, water, unclassified).
  "Clear" in the list is that share of the window's covered pixels; "covers" appears when the tile
  holds less than the whole window.

Not used: EOX s2cloudless (2018 onward is CC BY-NC-SA), Copernicus Data Space (needs an
instance id shipped to the browser), and Sentinel-1 radar (its hosted terms were not verified).

## How a scene is chosen

1. The search asks for scenes over the terrain bounds with whole-tile cloud under
   `SENTINEL_CLOUD_MAX_PERCENT`, newest first. **Last 2 years** reaches back
   `SENTINEL_RECENT_DAYS`; a year reads its June–September scenes, when clearings read best.
2. Neighbouring tiles share dates. One scene is kept per date: the tile whose footprint holds the
   whole window, then the one in the terrain's own UTM zone, then the least cloudy.
3. Each listed scene is rated from a coarse read of its scene classification over the window.
4. The default is the newest scene at least `SENTINEL_MIN_CLEAR_SHARE` clear and covering
   `SENTINEL_MIN_COVERAGE` of the window; if none is, the one with the most clear ground. The
   default change pair is the oldest and newest such scenes.

Scenes found by earlier searches stay in the change view's two lists, so pick a year, then another
year, and compare a scene from each. Both must come from tiles in the same UTM zone.

## The window

The read window is the terrain's bounds projected into the scene's UTM zone, widened by
`SENTINEL_WINDOW_MARGIN_M` and snapped to the pixel grid. It is drawn on the plan as a four-corner
image in its own UTM grid, the way imported backgrounds are. A window longer than
`SENTINEL_MAX_WINDOW_PX` pixels at 10 m reads 20, 40… m pixels from the COG's overviews.

## Limits and budgets

| Limit                           | Value                     | Enforced in                                                     | When exceeded                                          |
| ------------------------------- | ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Whole-tile cloud cover          | under 60 %                | `limits.ts` `SENTINEL_CLOUD_MAX_PERCENT`                        | Scene not requested                                    |
| Scenes listed per search        | 12                        | `limits.ts` `SENTINEL_MAX_SCENES`                               | Older scenes left out; pick a year                     |
| Items asked for per search      | 36                        | `limits.ts` `SENTINEL_SEARCH_LIMIT`                             | Older dates left out                                   |
| "Last 2 years"                  | 730 days                  | `limits.ts` `SENTINEL_RECENT_DAYS`                              | —                                                      |
| First year offered              | 2017                      | `limits.ts` `SENTINEL_FIRST_YEAR`                               | —                                                      |
| Margin round the terrain        | 250 m                     | `limits.ts` `SENTINEL_WINDOW_MARGIN_M`                          | —                                                      |
| Window size                     | 60 km a side              | `limits.ts` `SENTINEL_MAX_WINDOW_KM`                            | "The terrain spans … km; … at most 60 km", no read     |
| Read size                       | 2,048 px a side           | `limits.ts` `SENTINEL_MAX_WINDOW_PX`                            | Coarser pixels (20, 40… m) from the overviews          |
| Scene rating read               | 128 px a side             | `limits.ts` `SENTINEL_LIST_SCL_PX`                              | —                                                      |
| Rating reads at once            | 4                         | `limits.ts` `SENTINEL_LIST_CONCURRENCY`                         | —                                                      |
| Default scene: clear / coverage | 80 % / 95 % of the window | `limits.ts` `SENTINEL_MIN_CLEAR_SHARE`, `SENTINEL_MIN_COVERAGE` | Falls back to the clearest scene                       |
| Clearing                        | NDVI drop of 0.2 or more  | `limits.ts` `SENTINEL_CLEARING_NDVI_DROP`                       | Smaller changes drawn faintly, not counted             |
| Request time                    | 30 s per search or read   | `limits.ts` `SENTINEL_REQUEST_TIMEOUT_MS`                       | "… took longer than 30 s", with Retry                  |
| Band windows kept in memory     | 8                         | `limits.ts` `SENTINEL_BAND_CACHE_ENTRIES`                       | Older windows read again                               |
| UTM zones                       | 7–11 (EPSG:32607–32611)   | `limits.ts` `SENTINEL_BC_UTM_ZONES`                             | "The terrain is outside British Columbia's …", no read |

## Failures

Every failure says why on the card, and the ones a retry can fix offer **Retry**:

| Situation                            | Shown                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| No terrain loaded                    | "Load terrain first: the imagery is read over its bounds."                                           |
| Terrain outside BC's UTM zones       | "The terrain is outside British Columbia's UTM zones 7–11 …"                                         |
| Terrain wider than the window limit  | "The terrain spans … km; Sentinel-2 imagery is read over at most 60 km."                             |
| Search fails or times out            | "The Sentinel-2 scene search failed (HTTP …)" / "could not be reached" / "took longer than …", Retry |
| No scene under the cloud limit       | "No Sentinel-2 scene under 60% cloud covers this terrain in …", Retry                                |
| A COG cannot be read                 | "A Sentinel-2 image could not be read from the AWS archive.", Retry                                  |
| Change pair from different UTM zones | "The two scenes come from tiles in different UTM zones …"                                            |
| Change pair is one scene             | "Pick two different scenes to compare."                                                              |

## Map order

The image is the layer `road-sentinel2`. It sits above the plan's hillshade and imported
backgrounds and directly under `road-contours`, the plan's lowest engineering layer
(`planOrder.ts`); a hillshade picked after the imagery is moved back under it. It is added as a
layer, never through a `styles` swap, so `setStyle` never runs.

## Checks

- Unit tests (`sentinel/*.test.ts`) run on a recorded Earth Search response
  (`stacSearch.fixture.json`) and on small GeoTIFFs written in memory; they need no network.
- `tests/e2e/forestry-road-sentinel2.spec.ts` stubs the search and the COGs and checks the layer is
  added to the map, the scene list renders, and the change view prints an interval.
