# Canopy height and the ICESat-2 ground check

Two pieces of open evidence sit beside a road design. Neither changes the terrain, a quantity, a
route search or a constraint. Both came out of the bench in
[Open canopy and satellite LiDAR sources](../research/open-canopy-and-satellite-lidar-2026-11-18.md),
which measured each source against airborne LiDAR before anything was built.

## Canopy height on the plan (Meta CHM v2)

**View → Map layers → Canopy height (CHM v2)** (also in the plan's **Map settings** and **Find tools**)
draws Meta and WRI's 2026 global canopy height map on the plan from zoom 12 in. It is drawn in the
block sheet's canopy classes (`CANOPY_HEIGHT_CLASSES`, `src/lib/forestry/blockSheet/styles.ts`), so it
reads like a company canopy sheet laid beside it, at `CANOPY_LAYER_OPACITY` over the imagery and under
every engineering layer. Its card lists the classes, the cell size drawn and the imagery years under
the view at rest; its header icon turns while tiles are being read, and tiles in view that could not
be read are named with the reason.

The layer is a MapLibre raster tile source (`road-canopy-height`, `CanopyHeightLayer.tsx`) fed by a
`pgmaps-chm://{z}/{x}/{y}` protocol (`canopy/chmTileProtocol.ts`), so it loads as the map moves and
never leaves the map during a pan or zoom: MapLibre requests tiles every frame, keeps coarser and
finer tiles drawn while the ideal ones load, aborts a tile that leaves the view (the abort reaches
the block read) and caches the rest. A 512 px map tile at zoom 10–16 is exactly one 512 px internal
block of one image of one file (`chmTiles.ts`): one byte range a tile, no resampling, no
reprojection. Zoom 16 is the files' full resolution; deeper zooms enlarge it, drawn nearest. A tile
with no canopy, or under a file the bucket does not have (outside coverage, a 404), is clear; the
missing file is asked for once a session. A tile takes about 2 ms to inflate and under 1 ms to colour
on the page's thread, so the tiles need no worker. The Map PDF and the field pack frame the plan
through `planCapture.ts`, which waits for the map's `idle`, and so for the canopy tiles of the framed
view.

Before November 2026 the layer was one picture of the settled view, read 800 ms after the map
stopped. It vanished at the start of every pan and came back 1.3–1.7 s after it stopped; measured in
Chrome on a 2 s drag, 178 of 179 frames had no canopy, against none now, with tile reads starting
about 0.5 s into the drag.

**Read the corridor** reads the active road's corridor at full resolution (about 0.7 m) and reports,
from `corridorSummary` (`src/lib/forestry/canopy/chmView.ts`):

- **Timber in clearing**: the length-weighted share of the clearing at 5 m or more. The clearing is
  each station's own `leftClearingM`/`rightClearingM` (slope stakes plus clearing), else 10 m a side.
- **Reaching trees**: stations where a cell outside the clearing is as tall as its distance to the
  running surface's edge, with the tallest.
- **Gaps**: centreline runs of 25 m or more that are open between timber on both sides: an old trail,
  a seismic line, or a mapping artefact.

What the bench found, and so what the card says:

- **Cover is good, heights are not.** Canopy cover matched 093G086 LiDAR at r 0.93 (30 m cells), but
  heights read 7.9 m low there and 0.5 m low on a licensee's LiDAR sheet. One correction does not fit
  both sites, so no height is corrected.
- **The imagery is old.** Each tile's imagery dates come from the source's `acq_dates.parquet`
  (`metaChmDates.bc.generated.json`, built by `scripts/forestry/canopy-sources/chm-dates.py`). On the
  reference block it was 2012–2018, so openings cut since still show as forest. Sentinel-2 or the
  harvest layers say what has been cut since.
- **Timber share runs high.** The model fills the gaps between crowns: on the reference block its
  timber in the clearing ran 15–40 points above the company canopy sheet's.

The files are uint8 COGs on Source Cooperative (CORS, byte ranges), one per zoom-10 quadkey. Each
carries a transparency mask after its full-resolution image and after its overviews, so an overview
is found by its width, never by its IFD number (`readMetaChm`, `chmBlock`). Checked on
`0212102011.tif` (19 November 2026): EPSG:3857, deflate with no predictor, 512 px blocks, a 32,768 px
image with overviews down to 512 px, masks at IFD 1 and 8–13. The masks are not read: the blocks
sampled were valid throughout, and a 0 is drawn clear either way.

## ICESat-2 ground check (Review)

**Review → ICESat-2 ground check → Check against ICESat-2** asks SlideRule Earth's public service for
ICESat-2 ATL03 photons that ATL08 classes as ground, within `ICESAT2_CHECK.marginM` of the active road.
Passes from November to May are left out (snow reads as ground). Heights come back on the ITRF2014
ellipsoid and are put on EGM2008 with PROJ's 2.5′ grid (`us_nga_egm08_25.tif`, read a window at a
time from cdn.proj.org). Each `ICESAT2_CHECK.binM` of a beam is one bin, and each bin's median is
compared with the terrain at its centre (`groundCheck.ts`).

The result lasts for the session (`icesat2Store.ts`), keyed by terrain and road, and adds Review's
**Terrain at the height ICESat-2 measures** row: met within `ICESAT2_CHECK.offsetFlagM` of the
median, a to-do past it, not assessed under `ICESAT2_CHECK.minBins` bins. The row is a screen of the
terrain's datum and source, not of any station. Passes are often hundreds of metres apart.

Measured:

| Terrain                                    | Median terrain − ICESat-2 | Spread | Bins |
| ------------------------------------------ | ------------------------- | ------ | ---- |
| 093G086 LiDAR DTM (the app's LiDAR sample) | −0.06 m                   | 0.28 m | 148  |
| Regional Terrarium DEM, 093G086            | +4.6 m against LiDAR      |        |      |
| Regional DEM, licensee reference block     | +0.97 m                   |        | 1687 |
| Contour surface, licensee reference block  | −0.28 m                   | 2.0 m  | 229  |

The first row is this check run in the browser, with SlideRule's reply replayed from photons fetched
earlier; the others are the research bench's.

### SlideRule, as found on 18 November 2026

- **CORS is open** on `/source/*`, and the body goes as plain text, which needs no preflight. Sent
  with `content-type: application/json`, the server reported progress for ten minutes and processed
  no granule.
- **Only snow-free granules are asked for.** NASA's CMR lists the granules crossing the box (CORS
  open, no login), and SlideRule gets only the June–October ones as `resources`: 13 of 36 for a 1 km²
  box near Prince George, 19 of 49 for the 093G086 tile. Without the list SlideRule opens every
  granule, including the winter one that kept failing. With no snow-free pass, SlideRule is not called.
- **Time varies a lot.** Before the pre-filter, a 1 km² box took 68 s with SlideRule's own Python
  client; an hour later the same request hit the server's 600 s limit after 20 of 36 granules, as did
  the browser client's run after it. With the pre-filter, the same box took 15 s and the 093G086 tile
  62–98 s; on a busy cluster the 13 granules alone took 557 s. The section says the check takes
  minutes and can be cancelled. When it fails, run it again later.
- **Some passes do not read.** On 18 November 2026 SlideRule failed to read the three newest
  granules over 093G086 (2025-10-05, 2025-10-28, 2026-09-05; H5Coro read failures), losing 30% of the
  photons while the request still succeeded. Those passes are listed as unread in the section and the
  Review row (`failedGranules`), never counted as passes with no ground.
  On a licensee's reference block the same day, SlideRule read 15 of a road's 18 snow-free passes
  and failed on the three newest (2025-09 to 2026-07). None of the 15 put ground photons inside the
  road's box, so the check had nothing to judge. The section and the row say so and name the
  unread passes, rather than reporting the terrain as checked.
- **Alerts are not failures.** Negative codes in `exceptrec` records are per-granule failures and
  "running N seconds" (−2). A reply with no photon file is always an error, never "no photons": that is how the 600 s limit ends a request.

## Limits

| Limit                          | Value             | Enforced in                                       | When exceeded                          |
| ------------------------------ | ----------------- | ------------------------------------------------- | -------------------------------------- |
| Canopy layer minimum zoom      | 12                | `chmView.ts` `CHM_MIN_ZOOM`                       | Layer paused, no tile read             |
| Canopy tile zooms              | 10–16, 512 px     | `chmTiles.ts` `CHM_TILE_MIN_ZOOM`, `CHM_TILE_MAX_ZOOM`, `CHM_TILE_SIZE` | Past 16 the zoom-16 tiles are enlarged |
| Canopy block reads at once     | 8                 | `canopy/chmFiles.ts` `CHM_TILE_MAX_REQUESTS`      | Later tiles wait their turn            |
| Canopy files kept open         | 12                | `canopy/chmFiles.ts` `CHM_OPEN_FILES`             | The oldest header is read again later  |
| Canopy tile fade               | 150 ms            | `CanopyHeightLayer.tsx` `CANOPY_FADE_MS`          | —                                      |
| Canopy card loading hold       | 250 ms            | `useCanopyHeight.ts` `CANOPY_LOADING_HOLD_MS`     | Shorter reads show no loading icon     |
| Corridor read                  | 60 M cells        | `chmView.ts` `CHM_CORRIDOR_MAX_PIXELS`            | Refused with a message                 |
| Corridor margin                | 60 m              | `chmView.ts` `CHM_CORRIDOR_MARGIN_M`              | —                                      |
| Shortest gap listed            | 25 m              | `chmView.ts` `CHM_GAP_MIN_LENGTH_M`               | Shorter gaps not listed                |
| ICESat-2 request box           | 0.02 deg²         | `sliderule.ts` `ICESAT2_MAX_BOX_DEG2`             | The check is not offered for the road  |
| Granules listed                | 2,000             | `sliderule.ts` `CMR_PAGE`                         | Refused with a message                 |
| ICESat-2 bin                   | 20 m, 3 photons   | `icesat2Check.ts` `ICESAT2_CHECK`                 | Thinner bins left out                  |
| Datum flag                     | ±1 m median       | `icesat2Check.ts` `ICESAT2_CHECK.offsetFlagM`     | Review row is a to-do                  |
| Bins to judge                  | 10                | `icesat2Check.ts` `ICESAT2_CHECK.minBins`         | Review row is not assessed             |

## Not built: SCANFI in the browser

SCANFI v2 dates openings well (all five on the reference block dropped from 29 m to 1–9 m between
2015 and 2025), but NRCan's server sends no CORS headers, so the browser cannot read it. The proposal
was a BC clip published through bcdatamapper. The national 2025 height file is 3.0 GB, and its tiles
inside BC's bounding box alone hold 910 MB, against the 459 MB left on bcdatamapper's Pages site, for
one layer and one year. BC's own harvest layers and Sentinel-2 already date recent cuts in the app,
so SCANFI stays a script source (`scripts/forestry/canopy-sources/road-canopy-bench.ts`).
