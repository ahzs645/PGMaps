# Sentinel-2 imagery on the plan

**View → Map layers → Sentinel-2 imagery** (also a row in the plan's **Map settings**, and found by
**Find tools**) draws Copernicus Sentinel-2 imagery over the current map view, under every engineering
layer. Its card on the plan lists recent scenes and switches between seven displays:

- **True colour**: the scene's TCI image as published.
- **NDVI**: (NIR − red) ÷ (NIR + red) from bands B08 and B04, for green cover.
- **NBR**: (NIR − SWIR2) ÷ (NIR + SWIR2) from bands B08 and B12, for burned ground.
- **NDMI**: (NIR − SWIR1) ÷ (NIR + SWIR1) from bands B08 and B11, for moisture: drought and beetle
  red attack.
- **NDVI change**, **dNBR (burn)** and **NDMI change**: the later scene's index minus the earlier
  one's. A fall of the index's counted drop or more (table below) is reported as
  "Clearing / Burned or cleared / Drier on _n_ ha: first seen between _earlier date_ and _later
  date_ (Sentinel-2)". dNBR is the earlier NBR minus the later, as Key & Benson define it.

Every index is computed on reflectance, with cloud, cloud shadow, snow and no-data pixels left
clear (`indices.ts`). Below the display, **Area series** reads the chosen index through time over
one area and draws a histogram of it for the selected scene (see [Area series](#area-series)).

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
- Pixels: the item's `visual` (TCI), `red` (B04), `nir` (B08), `swir16` (B11), `swir22` (B12) and
  `scl` (scene classification) Cloud-Optimized GeoTIFFs in the AWS `sentinel-cogs` bucket, read by
  byte range through geotiff.js (`cogReader.ts`). Only the read window round the map view is fetched. An
  item without the SWIR assets still draws true colour and NDVI; NBR and NDMI then say which band
  the scene lacks.
- B11, B12 and the scene classification are 20 m. On a 10 m window they are read on their own
  20 m grid, over the 20 m pixels that hold the window, and each 10 m pixel takes the 20 m pixel
  its centre falls in: nearest neighbour, the same pixels for the same window every time
  (`resample.ts`). Handing geotiff the 10 m box instead rounds it to whole 20 m pixels and
  stretches the result, which moved a band by up to 10 m. On a window of 20 m pixels or coarser
  every band is read on the window directly. NBR uses B08 (10 m) rather than B8A (20 m): the NIR
  pixels stay 10 m, and the SWIR is a 2 × 2 block of them.
- Reflectance is DN × `scale` + `offset` from the item's `raster:bands`. Earth Search has already
  removed the −0.1 offset of processing baseline 04.00 and later from the pixels
  (`earthsearch:boa_offset_applied: true`) while still listing it, so the offset is applied only
  when that flag is absent or false (`stac.ts`), for the SWIR bands as for red and NIR. Applying it
  twice read September 2025 conifer near Prince George at zero red reflectance and NDVI 1
  everywhere.
- Clear ground is scene classification 4–7 (vegetation, not vegetated, water, unclassified).
  "Clear" in the list is that share of the window's covered pixels; "covers" appears when the tile
  holds less than the whole window.

Not used: EOX s2cloudless (2018 onward is CC BY-NC-SA), Copernicus Data Space (needs an
instance id shipped to the browser), and Sentinel-1 radar (its hosted terms were not verified).

## How a scene is chosen

1. The search asks for scenes over the read window (see [The window](#the-window)) with whole-tile cloud under
   `SENTINEL_CLOUD_MAX_PERCENT`, newest first. **Last 2 years** reaches back
   `SENTINEL_RECENT_DAYS`; a year reads its June–September scenes, when clearings read best.
2. Neighbouring tiles share dates. One scene is kept per date: the tile whose footprint holds the
   whole window, then the one in the view's own UTM zone, then the least cloudy.
3. Each listed scene is rated from a coarse read of its scene classification over the window.
4. The default is the newest scene at least `SENTINEL_MIN_CLEAR_SHARE` clear and covering
   `SENTINEL_MIN_COVERAGE` of the window; if none is, the one with the most clear ground. The
   default change pair is the oldest and newest such scenes.

Scenes found by earlier searches stay in the change view's two lists while their tile reaches the
window, so pick a year, then another year, and compare a scene from each. Both must come from tiles
in the same UTM zone.

A pan does not search again while the listed scenes still serve the new window: same date range,
same UTM zone, and every listed tile whose footprint held the searched window still holds the new
one (`catalogueServes`, `catalogue.ts`). Past a tile's edge, or into another zone, the window gets
its own search, paced and cached as before. The reviewer's scene stays picked while it is in the
list, and the change pair while both its scenes are still offered; a default is picked only where
the choice is no longer offered, and only once the new list is rated.

## The window

The layer follows the map as it moves, by the shared view-window rule
(the toolkit's `map/view-window.ts`, [shared UI: View windows](../shared-ui.md#view-windows)):

- **Overscan.** The read window is the view grown 1.5 times (`SENTINEL_VIEW_OVERSCAN`, OpenLayers'
  image ratio) and snapped outward to a 0.01° grid (`SENTINEL_VIEW_GRID_DEG`), so a small pan
  reads nothing and nearby views share one read.
- **During the move.** When the view comes within a tenth of its size of the window's edge
  (`SENTINEL_VIEW_EDGE_SHARE`) or leaves it, the next window is asked for while the map is still
  moving, at most every 250 ms (`SENTINEL_VIEW_THROTTLE_MS`), and checked once more 100 ms after it
  stops (`SENTINEL_VIEW_SETTLE_MS`). A newer window aborts the reads of the one it supersedes.
- **The picture stays.** The last picture is never removed because the camera moves: it stays at
  its own corners until the next window's image is ready, then swaps in place (MapLibre keeps the
  old texture until the new one has decoded). Image keys include their window's UTM grid, so an
  picture is never placed on another window's corners. It reaches the map as an `ImageBitmap`
  (`usePreparedImage`, `MapImageLayer`'s `image`), with no PNG encoded for each swap.
- **Resolution.** A window is reused only at the pixel size its view needs (`viewPixelM`): zooming
  in from 13 to 14 at 10 m reads nothing; zooming in from 12 to 13 reads again, finer.
- **Paused.** Below zoom 12 the layer is paused and hidden, as a map layer's least zoom is, and the
  card says so; it is a stated state, not a movement. Zooming back in where the old window still
  serves shows it again without a read.
- **Ratings** for a new window are read once the map stops; the list keeps showing the previous
  ones meanwhile. The chosen scene's pixels for a new window are read straight away.

The read window is the window's outline projected into the scene's UTM zone, widened by
`SENTINEL_WINDOW_MARGIN_M` and snapped to the pixel grid. It is drawn on the plan as a four-corner
image in its own UTM grid, the way imported backgrounds are. The pixel size is chosen from the
**view** (its own outline and margin): a view longer than `SENTINEL_MAX_WINDOW_PX` pixels at 10 m
reads 20, 40… m pixels from the COG's overviews, exactly as before the overscan, so the picture is
never coarser at the same zoom. The overscanned read is up to about 1.5 times that a side (2.25
times the pixels); past `SENTINEL_MAX_READ_PX`, or past `SENTINEL_MAX_WINDOW_KM`, it is cropped about
the view's centre, never read coarser. Only a view itself wider than the km limit is refused.

**What the figures cover.** The clear share in the scene list, the default scene's thresholds and
the change view's hectares and compared share are all measured over the read window, not the
visible map: the view and the overscan round it. The card states it under the list ("Figures cover
the area read: _w_ × _h_ km"), and the change view's note says the same.

## Area series

The **Area series** part of the card reads one index through time over one area and charts it.

- **The area.** Click a cutblock on the plan and choose **Sentinel-2 series** on its card, or
  **Draw area** on the Sentinel-2 card and click the polygon's points with the shared sketch
  (`map-sketch.tsx`; the first point or a double-click closes it, Escape cancels, Backspace takes
  a point back). While it is drawing, the plan's own clicks stand aside. The area is kept for this
  map session only and never written into the project. Areas up to `SENTINEL_AREA_MAX_KM` across.
- **The scenes.** The scenes the card offers: this list and those kept from earlier years searched
  over this view, at most `SENTINEL_SERIES_MAX_SCENES`, spread evenly over time with the oldest and
  newest kept and the scene the card shows (or both of a change pair) always included
  (`thinScenes`). Pick a year, then another, to reach back. A year's list is its 12 newest summer
  scenes, so it seldom reaches back past mid-August: a bracket across two years runs from that
  year's late summer. Each scene reads only the area's window, on the 10 m grid of its own UTM zone, `SENTINEL_READ_CONCURRENCY` reads at a
  time; a new area, a new display, a change in the scenes offered or a new scene search cancels the reads in flight. A scene read once
  for an area and index is kept for the session and not read again; a failed read is.
- **The value.** The mean of the index over the clear pixels whose centres lie inside the area
  (`areaSeries.ts`). A scene whose tile covers less than `SENTINEL_SERIES_MIN_COVERAGE` of the area,
  or with less than `SENTINEL_SERIES_MIN_CLEAR_SHARE` of the covered area clear, is a gap with its
  reason (tile edge, cloud, a missing band, a failed read), never a zero. Gaps are listed under the
  chart and break nothing: the line runs between clear scenes.
- **The fall.** Every pair of consecutive clear scenes is a candidate bracket. Its fall is the
  median of all clear scenes before it minus the median of all clear scenes after it, and it
  counts when that reaches the index's counted drop and the pair itself falls. Of those, the pair
  that itself falls furthest (the smaller of its own fall and the level fall, since every split
  near a step shows much the same level fall) is drawn red and labelled with the same "first seen between … and …"
  as the change view, with "(snow gap)" over November–April (`findDrop`). The bracket is the two
  clear scenes on either side; a gap between them makes it wider, never narrower. When only one
  clear scene follows, the card says so: the level after is that one scene.
- **Why levels, not one pair.** Haze, wildfire smoke and thin cloud often pass the scene
  classification as clear. Read live on 18 November 2026, a 10 ha unharvested stand near Prince
  George held NDVI 0.73–0.82 through August–September 2019 and 2025, except 3 and 6 September 2025
  (0.38 and 0.28, both "clear"), back to 0.82 by the 16th. A scene-to-scene rule dated a clearing
  there. Falls the level comes back from are left out and counted as "short dips" (`shortDips`).
  The other way round, NBR over the 2021 Lytton Creek fire fell 0.245 between the last 2020 scene
  and the first clear 2021 one, under the 0.27 counted drop, while the levels fell 0.295 (median
  0.129 before, −0.166 after); the level rule finds it.
- **The histogram.** For the selected scene (the later scene in a change view), the index's
  distribution inside the area over a fixed range per index, `SENTINEL_HISTOGRAM_BINS` bins,
  coloured by the display's own ramp, with the mean marked. It is the shared `ValueHistogram`
  (`src/components/ui/value-histogram.tsx`, binning in `src/lib/histogram.ts`).
- The chart is the toolkit's `LineBandChart`, not `TimeSeriesChart`: the latter's navigator takes
  a fifth of the card's height and draws every series on one shared row set, so the fall could not
  be drawn as its own segment across a gap.

Like the rest of the layer, the series is evidence only: never a constraint, never a route-search
input and not proof of a road. A fall says the ground changed between two dates; NDVI and NDMI
also move with season and leaf colour, and a short spur cannot be told apart from its block.

## Limits and budgets

| Limit                           | Value                     | Enforced in                                                             | When exceeded                                          |
| ------------------------------- | ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| Minimum map zoom                | 12                        | `limits.ts` `SENTINEL_MIN_ZOOM`                                         | Layer paused and hidden; no search or COG read         |
| Read window over the view       | 1.5 × wide and high       | `limits.ts` `SENTINEL_VIEW_OVERSCAN`                                    | Pans inside it read nothing                            |
| Next window asked for           | within 0.1 of the view's size of the edge | `limits.ts` `SENTINEL_VIEW_EDGE_SHARE`                  | Read starts before the view reaches the edge           |
| Window requests while moving    | at most every 250 ms      | `limits.ts` `SENTINEL_VIEW_THROTTLE_MS`                                 | Later views wait for the next slot; superseded reads aborted |
| Check after the map stops       | 100 ms                    | `limits.ts` `SENTINEL_VIEW_SETTLE_MS`                                   | —                                                      |
| Window grid                     | 0.01° outward             | `limits.ts` `SENTINEL_VIEW_GRID_DEG`                                    | Nearby views share their window                        |
| Catalogue request spacing       | 5 s                       | `limits.ts` `SENTINEL_SEARCH_INTERVAL_MS`                               | Wait cancellably; respect HTTP Retry-After             |
| Catalogue cache                 | 8 searches / 15 min       | `limits.ts` `SENTINEL_SEARCH_CACHE_ENTRIES`, `SENTINEL_SEARCH_CACHE_MS` | Oldest searches expire                                 |
| Concurrent band reads           | 2                         | `limits.ts` `SENTINEL_READ_CONCURRENCY`                                 | Further reads queue; cancelled ones do not start       |
| Open COG handles                | 16                        | `limits.ts` `SENTINEL_FILE_CACHE_ENTRIES`                               | Older byte-block caches released                       |
| Whole-tile cloud cover          | under 60 %                | `limits.ts` `SENTINEL_CLOUD_MAX_PERCENT`                                | Scene not requested                                    |
| Scenes listed per search        | 12                        | `limits.ts` `SENTINEL_MAX_SCENES`                                       | Older scenes left out; pick a year                     |
| Items asked for per search      | 36                        | `limits.ts` `SENTINEL_SEARCH_LIMIT`                                     | Older dates left out                                   |
| "Last 2 years"                  | 730 days                  | `limits.ts` `SENTINEL_RECENT_DAYS`                                      | —                                                      |
| First year offered              | 2017                      | `limits.ts` `SENTINEL_FIRST_YEAR`                                       | —                                                      |
| Margin round the view           | 250 m                     | `limits.ts` `SENTINEL_WINDOW_MARGIN_M`                                  | —                                                      |
| Window size                     | 60 km a side              | `limits.ts` `SENTINEL_MAX_WINDOW_KM`                                    | Overscan cropped about the view; a wider view: "The terrain spans … km; … at most 60 km", no read |
| View size at 10 m               | 2,048 px a side           | `limits.ts` `SENTINEL_MAX_WINDOW_PX`                                    | Coarser pixels (20, 40… m) from the overviews          |
| Read size                       | 3,200 px a side           | `limits.ts` `SENTINEL_MAX_READ_PX`                                      | Overscan cropped about the view, never read coarser    |
| Scene rating read               | 128 px a side             | `limits.ts` `SENTINEL_LIST_SCL_PX`                                      | —                                                      |
| Rating reads at once            | 4                         | `limits.ts` `SENTINEL_LIST_CONCURRENCY`                                 | —                                                      |
| Default scene: clear / coverage | 80 % / 95 % of the window | `limits.ts` `SENTINEL_MIN_CLEAR_SHARE`, `SENTINEL_MIN_COVERAGE`         | Falls back to the clearest scene                       |
| Clearing                        | NDVI drop of 0.2 or more  | `limits.ts` `SENTINEL_CLEARING_NDVI_DROP`                               | Smaller changes drawn faintly, not counted             |
| Burned or cleared (dNBR)        | 0.27 or more              | `limits.ts` `SENTINEL_BURN_DNBR`                                        | Key & Benson low severity (0.1–0.27) drawn faintly, not counted |
| dNBR drawn at all               | 0.1 (unburned below)      | `limits.ts` `SENTINEL_DNBR_UNBURNED`                                    | Clear                                                  |
| Drier (NDMI)                    | drop of 0.15 or more      | `limits.ts` `SENTINEL_DRYING_NDMI_DROP`                                 | Smaller changes drawn faintly, not counted             |
| Area series size                | 10 km a side              | `limits.ts` `SENTINEL_AREA_MAX_KM`                                      | "The area spans … km; a Sentinel-2 series reads at most 10 km", no read |
| Area series scenes              | 12                        | `limits.ts` `SENTINEL_SERIES_MAX_SCENES`                                | Thinned evenly over time, both ends kept               |
| Series gap: clear / cover       | under 80 % / 95 % of the area | `limits.ts` `SENTINEL_SERIES_MIN_CLEAR_SHARE`, `SENTINEL_SERIES_MIN_COVERAGE` | Gap with its reason, never a value                     |
| Histogram bins                  | 40                        | `limits.ts` `SENTINEL_HISTOGRAM_BINS`                                   | —                                                      |
| Request time                    | 30 s per search or read   | `limits.ts` `SENTINEL_REQUEST_TIMEOUT_MS`                               | "… took longer than 30 s", with Retry                  |
| Band windows kept in memory     | 8                         | `limits.ts` `SENTINEL_BAND_CACHE_ENTRIES`                               | Older windows read again                               |
| UTM zones                       | 7–11 (EPSG:32607–32611)   | `limits.ts` `SENTINEL_BC_UTM_ZONES`                                     | "The terrain is outside British Columbia's …", no read |

## Failures

Every failure says why on the card, and the ones a retry can fix offer **Retry**:

| Situation                            | Shown                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Map not ready                        | No read until the map shows a view at zoom 12 or closer. Terrain import is not required.             |
| Terrain outside BC's UTM zones       | "The terrain is outside British Columbia's UTM zones 7–11 …"                                         |
| Terrain wider than the window limit  | "The terrain spans … km; Sentinel-2 imagery is read over at most 60 km."                             |
| Search fails or times out            | "The Sentinel-2 scene search failed (HTTP …)" / "could not be reached" / "took longer than …", Retry |
| No scene under the cloud limit       | "No Sentinel-2 scene under 60% cloud covers this view in …", Retry                                   |
| A COG cannot be read                 | "A Sentinel-2 image could not be read from the AWS archive.", Retry                                  |
| Change pair from different UTM zones | "The two scenes come from tiles in different UTM zones …"                                            |
| Change pair is one scene             | "Pick two different scenes to compare."                                                              |
| Scene lists no SWIR band             | "The … scene lists no SWIR (B12) band, which NBR needs." In a series, a gap with that reason         |
| Area too wide for a series           | "The area spans … km; a Sentinel-2 series reads at most 10 km."                                      |

## Map order

The image is the layer `road-sentinel2`. It sits above the plan's hillshade and imported
backgrounds and directly under `road-contours`, the plan's lowest engineering layer
(`planOrder.ts`); a hillshade picked after the imagery is moved back under it. It is added as a
layer, never through a `styles` swap, so `setStyle` never runs.

## Checks

- Unit tests (`sentinel/*.test.ts`) run on a recorded Earth Search response
  (`stacSearch.fixture.json`) and on small GeoTIFFs written in memory; they need no network.
- `tests/e2e/forestry-road-sentinel2.spec.ts` stubs the search and the COGs and checks the layer is
  added to the map, the scene list renders, the NDVI change and dNBR views print an interval, a
  drawn area's series brackets the stubbed clearing and draws its histogram, and the picture stays
  on every rendered frame through pans that make no new search (the listed tiles hold them).
- The toolkit's `map/view-window.test.ts` pins the view-window rule (overscan, reuse while inside, the
  throttle during a move, the settle check, pausing); `sentinel/requestPolicy.test.ts` pins the
  layer's use of it, the pixel chosen from the view, and catalogue reuse over a pan journey.

Catalogue and band caches are local to this map session. There is no polling or automatic failure retry. HTTP 429 without Retry-After holds new searches for 60 s; HTTP 503 without it keeps the normal 5 s spacing. Successful decoded bands survive cancellation of their originating effect. The public Earth Search service promises no guaranteed service: these application limits are conservative client budgets, not a published provider quota.

## Optional Wayback release timeline

In all four interfaces, open a georeferenced Plan and choose **Map display settings → Historical imagery timeline**.
Ribbon also has **View → Map layers → Historical imagery timeline** and **Find tools**. In Guided map, use **View**.

The timeline runs along the bottom of the Plan map, the full width of the map, and the scale, status bar,
attribution, legend and any tool panel move up above it while it is open. On first open it shows Esri’s newest
mosaic beneath the road linework.

A release dates the mosaic, not the photograph, and most releases reuse the imagery already there: at the
reference road by UNBC, 13 of 199 releases change the picture at zoom 16, and 5 at zoom 18. With the count
switch beside the capture date on (the default, reading for example **13 of 199**; its name is *Only releases
that change this spot*), the timeline lists just those; select it to list every release (**All 199**). They are
read from Esri's tile map at the tile under the map centre, at the zoom the plan draws Wayback (at most 18): asked for a release, it names the
release that tile came from, so the walk back from the newest release makes one request per distinct image, as
Esri's own Wayback app does. It checks again each time the map stops moving; the last list stays until the next
one is read, and a place already read this session is not asked again. Each entry is the first release that
published that imagery. The choice is kept as a date: moving to another place, or switching the option off, shows
the imagery in effect at that release there. If the tile map cannot be read, the timeline lists every release and
offers **Retry check**.

Beside the release date the timeline prints what the shown release captured at the map centre, from the
release's own imagery metadata service: the capture date and ground resolution (*Captured 2023-05-15 · 7.5 cm*),
with the supplier and source name in its tooltip (*City of Prince George · Prince George 2023 Ortho*). The record
names one point; other parts of the view can come from other captures. Esri can take several seconds to answer
for an older release, and until it does the timeline reads *Captured …*, never another release's date. Where a release has no metadata service or
no dated record at the point, nothing is printed. Capture records are kept for the session.

Drag the slider, use its arrow keys, or select **Play** to advance one entry every two seconds until the newest.
Select a year under the track to open it: the timeline then lists only that year's entries, labelled by day,
starts on its first, and plays through that year; select a day to show it, and **‹ All years** to go back to every
year. A year with one entry is shown, not opened.
Closing the timeline removes the layer. Opening Sentinel-2 closes Wayback, and opening Wayback closes Sentinel-2.
Like Sentinel-2, Wayback is evidence only: never a constraint, a route-search input or proof of a road. Tiles stop
at zoom 18, as the satellite basemap's do, because Esri answers deeper rural BC requests with a grey placeholder;
MapLibre stretches z18 beyond.

On a design opened on the flat plane (no coordinate system), both imagery commands stay in place, disabled, until
**Place on map**.

The option is available by default. Set `VITE_ROAD_DESIGN_WAYBACK_TIMELINE=false` and restart Vite or rebuild the
site to hide it; `deployment.ts` reads it with the designer's other deployment settings. Removing the variable or
setting it to `true` restores the option. The standalone designer uses the same setting
([standalone build](standalone-build.md)).

| Limit             | Value                                                                                             | Where                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Catalog request   | Gives up after 20 s; **Retry Wayback catalog** asks again                                         | `src/lib/wayback.ts` `WAYBACK_CATALOG_TIMEOUT_MS`        |
| Playback          | One entry every 2 s                                                                               | `WaybackTimeline.tsx` `WAYBACK_PLAYBACK_MS`              |
| Local changes     | One tile-map request per distinct image, one place at a time, after the map stops; 64 places kept | `src/lib/wayback.ts` `WAYBACK_LOCAL_CACHE_SIZE`          |
| Capture record    | One metadata request per release and place, 150 ms after the release settles; 256 kept            | `WAYBACK_CAPTURE_DELAY_MS`, `WAYBACK_CAPTURE_CACHE_SIZE` |
| Tile map, record  | Each request gives up after 10 s                                                                  | `WaybackTimeline.tsx` `WAYBACK_SPOT_TIMEOUT_MS`          |
| Deepest tile zoom | 18                                                                                                | `PlanView.tsx` (`maxZoom` on `road-wayback`)             |
| Release hand-off  | Previous release kept until the next has its tiles, at most 4 s                                   | `map-layer-handoff.ts` `LAYER_HANDOFF_TIME_LIMIT_MS`     |

Opening Wayback requests the catalog, then the tile map at the map centre and the shown release's capture record. The plan requests tiles for the selected release and visible area.
Tile traffic varies with the viewport, zoom and playback. A new release loads behind the one shown and replaces
it in one frame once it has its tiles, so stepping and playback never blank the imagery
([swapping a tile layer](../shared-ui.md#swapping-a-tile-layer-without-a-blank)). Played faster than its tiles
arrive, the plan skips releases; after 4 s on one release it waits for the loading one rather than skip again,
and a release still loading after 4 s is shown as it stands. Until the swap, the slider names the requested
release while the plan still shows the previous one. Esri publishes no numeric request allowance for these
endpoints in the service information reviewed. Deployments need rights to use Esri imagery and must retain its
attribution. The mission workbench uses the same catalog and credits for its manual release picker.
See [workbench source limits](../mmgis-workbench.md) and [Esri’s terms summary](https://goto.arcgis.com/termsofuse/viewsummary).
