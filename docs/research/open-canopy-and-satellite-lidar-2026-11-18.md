# Open canopy height and satellite LiDAR for road design (18 November 2026)

Five open sources were tested for what they add to a road project: Meta's canopy height map v2,
NRCan's SCANFI v2, ICESat-2, GEDI and BC's VRI. Each was read the way PGMaps reads data: by byte range,
or from a public API with no key. Each was measured twice:

1. **Calibration** on PGMaps' own airborne LiDAR tile, BC 093G086 near Prince George (July 2024, 1 m
   CHM and DTM, CGVD2013). Here the LiDAR is the truth.
2. **Use** on "the reference block" of `bc-road-terrain-sources-2026-11-12.md`: a licensee block east of
   Prince George with seven imported roads and no public LiDAR. Here the licensee's LiDAR is printed only
   as map sheets: a canopy-height class raster and contours. The block's names, files and coordinates
   stay out of the repository.

Every figure below was measured that day with `scripts/forestry/canopy-sources/`.

## Short version

- **ICESat-2 is the useful new terrain source.** Its ground photons are an independent check on any
  terrain a road is designed on. At 093G086 they sat **0.05 m** from the LiDAR ground (robust spread
  0.31 m). At the reference block they showed the following:
  - The contour surface built from the licensee's sheet is at datum: median **−0.28 m**, spread 2.0 m.
  - The regional Terrarium DEM the project was imported on reads **+0.97 m high**, spread 2.1 m. At
    093G086 the same DEM read **+4.6 m** high against LiDAR.

  This settles the 1.5 m contour offset left open on 12–13 November. It is not a datum shift in the
  contours. Most of it is the regional DEM reading high.
- **Meta CHM v2 maps where the forest is well and how tall it is poorly.**
  - Canopy cover at 30 m matched LiDAR with r = 0.93 and no bias.
  - Top height read **7.5–7.9 m low** at 093G086. The error grows with tree height: −10.4 m on stands
    over 30 m.
  - At the reference block, on the licensee sheet's lossless tiles, it read only 0.5 m low. A correction
    fitted at 093G086 over-corrected there by +3.3 m. The bias depends on the site: do not apply one
    correction everywhere.
- **SCANFI is the one that dates disturbance.** Its 2015→2025 series shows each recent opening at the
  block falling from 29 m to 1–9 m, with stand age 3–6. CHM v2 still shows those openings as forest:
  its imagery for this tile is 2012–2018. SCANFI's height matched the LiDAR's 90th percentile
  (−1.3 m, r 0.61). Its single cells are noisy (±6 m), and its crown closure reads about 35 points
  below LiDAR cover.
- **GEDI adds nothing here.**
  - The pasted note's "51.6° N only" is out of date. A September 2024 GEDI pass (orbit 32575) crosses
    the reference block at 54.06° N.
  - All 509 of that pass's shots are unusable: no plausible elevation, no biomass estimate.
  - There is nothing over 093G086 at all.
- **ICESat-2 canopy heights are a weak check.** Over 20 m of track they read 5.4 m below the LiDAR's
  98th percentile, and half the tall bins had under 10 canopy photons.

## Sources and how they are read

| Source | What it is | Grid, date | Access | Browser |
| --- | --- | --- | --- | --- |
| Meta CHM v2 (Source Cooperative copy) | Model-predicted canopy height from imagery, CC BY 4.0 | 1.19 m Mercator (0.70 m on the ground at 54° N), uint8 m; imagery 2012–2018 at the reference block, 2016–2020 at 093G086 (`acq_dates.parquet`) | One 32768² COG per zoom-10 quadkey, range reads; `tiles.parquet`, STAC | Yes: CORS `*`. The block's 7.5 × 9.4 km window (144 M cells, one tile) read in 5 s |
| SCANFI v2 (NRCan, Jan 2026) | Imputed (k-NN / random forest) from Landsat and NFI photo plots, OGL-Canada | 30 m LCC, every 5 years 1985–2025: height, closure, biomass, land cover, age, 10 species' crown closure | Tiled GeoTIFFs of about 3 GB each on `ftp.maps.canada.ca`, range reads | **No**: no CORS headers. Scripts only, about 5 s a layer per window |
| ICESat-2 ATL03 / ATL08 (v007) | Photon-counting laser: classified ground, canopy and top-of-canopy photons; ATL08 100 m segments | Tracks; 15 passes (2018–2025) over the block box, of which 4 are snow-free with ground photons | SlideRule's public cluster (`atl03x`, `atl08x`), no Earthdata login | CORS `*`, but SlideRule streams its own record format; a browser client is work |
| GEDI L2A / L4A | Full-waveform laser footprints, about 25 m | Version 2 and 3 to 2024 | SlideRule (`gedil2a`, `gedil4a`), no login | As ICESat-2 |
| BC VRI rank 1 | Provincial inventory polygons | Projected to 2025 | DataBC WFS (`bcVegetationInventory.ts`) | Yes, already used |
| LidarBC | Airborne LiDAR | Flown 2024 over the block, unpublished | See `bc-road-terrain-sources-2026-11-12.md` | Download, then load |

ICESat-2 heights are ITRF2014 ellipsoidal. `sliderule-export.py` converts them to EGM2008 with PROJ's
grid. At the reference block, EGM2008 on ITRF2014 differs from CGG2013a on NAD83(CSRS) by 3 cm. So the
photons can be compared directly with CGVD2013 LiDAR and with a contour sheet in CGVD2013. Only June to
October passes are used: winter passes measure snow.

The GEDIMetrics QGIS plugin (`gedi-metrics-qgis`) is GPL-3.0 (its `LICENSE`; the README badge says
GPL-2.0). Only its README was read. It needs an Earthdata token, and SlideRule serves the same GEDI
products without one, so it is not needed.

## Calibration: 093G086 against its own LiDAR

| Measure | Bias (median) | Spread / fit | Notes |
| --- | --- | --- | --- |
| ICESat-2 ground − LiDAR ground (148 bins of 20 m, 8 passes) | −0.05 m | robust 0.31 m, RMSE 0.92 m | Mostly 0–30 % slope |
| Regional Terrarium − LiDAR ground (whole tile) | +4.6 m | robust 3.2 m, RMSE 6.5 m | Against ICESat-2: +3.4 m |
| CHM v2 − LiDAR CHM, per cell | −4.4 m | | Open ground 0.0; 15–25 m trees −6.1; 25 m+ −9.6 |
| CHM v2 cover ≥ 5 m, 30 m blocks | +0.3 points | r 0.93 | 93 % of LiDAR-open blocks open, 93 % of closed closed |
| CHM v2 95th percentile, forested 30 m blocks | −7.9 m | r 0.86; LiDAR ≈ 9.9 + 0.90 × CHM, residual 3.0 m | Growth since the imagery explains 1–2.5 m at most |
| SCANFI 2025 height − LiDAR p90 (30 m cells) | −1.3 m | robust 6.1 m, r 0.61 | Against the mean: +3.9 m |
| SCANFI crown closure − LiDAR cover ≥ 5 m | −35 points | r 0.79 | Different definitions; use it as a rank, not a share |
| ICESat-2 RH98 − LiDAR p98 (20 m bins) | −5.4 m | r 0.67 | 33 of 71 tall bins had under 10 canopy photons |
| VRI projected height − LiDAR p90 (23 polygons) | −3.5 m | r 0.68 | |

## The reference block

### Terrain against ICESat-2 ground photons

20,834 snow-free ground photons from 4 passes, in 20 m bins per beam:

| Terrain | Bins | Median | Robust spread | 0–10 % | 10–30 % | 30–50 % | 50 %+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Regional Terrarium, everywhere | 1,687 | +0.97 m | 2.1 m | +0.81 | +1.44 | +1.02 | +0.39 |
| Regional Terrarium, where the contours reach | 229 | +0.54 m | 4.3 m | +1.80 | +1.43 | +0.33 | −1.13 |
| Contour surface from the licensee's field sheet | 229 | −0.28 m | 2.0 m | +0.05 | +0.60 | −0.32 | −1.87 |

- Per pass, the contour surface's median is between −1.22 and +0.15 m; four of the six beams are
  within ±0.3 m.
- On 50 %+ slopes both terrains read low. A few metres of geolocation error is metres of height there,
  so steep-ground bins measure the photons as much as the terrain.
- The regional DEM's error does not depend on canopy here: +0.80 m on open ground, +0.83 m under
  forest.

### Canopy: CHM v2 against the licensee's LiDAR canopy sheet

The canopy sheet is a 0.85 m class raster: under 5 m, then 5 m classes to 40 m+. Half its tiles are
lossless and half JPEG (`source-pdf-import.md`).

- **Cell by cell, 68 % agree** on drawn (≥ 5 m) against not drawn, and 57 % on the exact class.
  Most of the disagreement is texture: the licensee's LiDAR resolves the gaps between crowns, and
  CHM v2 fills them.
- **At 20 m** (18,750 blocks), cover correlates at r = 0.82. CHM v2 averages 49.6 % cover against the
  sheet's 35.6 %. It agreed on 93 % of the sheet's closed blocks but only 71 % of its open ones: the
  sheet postdates the recent cuts.
- **Top height on the lossless tiles** reads CHM v2 0.5 m low (robust 4.5 m), against the sheet's class
  midpoints. Over all tiles it reads −4.5 m. The JPEG half's estimated classes over-fill the top
  classes, so the lossless figure is the one to trust.
- **The 093G086 correction** (9.9 + 0.90 × CHM) read +3.3 m too high here.
- **Against ICESat-2 RH98** (476 bins), CHM v2 reads −4.5 m. At 093G086 the same comparison is about
  −3.3 m. The two sites are consistent with each other; the laser itself reads low.

### Openings and time

| Opening (areas from the licensee's VQO shapes) | CHM v2 cover ≥ 5 m | SCANFI height 2015 → 2025 | SCANFI age 2025 | VRI height |
| --- | --- | --- | --- | --- |
| Opening A (10 ha) | 47 % | 29 → 12 m | 199 | 0.3 m |
| Opening B, part 2 (10 ha) | 57 % | 29 → 2 m | 3 | 0.3 m |
| Opening C (20 ha) | 48 % | 29 → 1 m | 5 | 0.4 m |
| Opening D (45 ha) | 57 % | 29 → 9 m | 6 | 0.4 m |
| Opening E (29 ha) | 61 % | 29 → 1 m | 3 | 0.3 m |
| The planned block (199 ha) | 53 % | 23 → 23 m | 225 | 24.6 m |

- VRI and SCANFI both know about the cuts.
- CHM v2 does not: its imagery predates them.
- SCANFI is the only source that dates them, to a 5-year step, with its age layer agreeing (3–6 years).
- Sentinel-2 (`sentinel-imagery.md`) narrows that to a pair of scene dates.

### Along the roads

These are clearing screens from the bench, never an estimate of the design. Clearing is from each
station's slope stakes, on the regional terrain.

| Road | Length | Clearing | Timber ≥ 5 m in clearing: CHM v2 / sheet | Stations where CHM v2 and sheet agree | SCANFI biomass in clearing | VRI height / closure |
| --- | --- | --- | --- | --- | --- | --- |
| The reference road | 3,578 m | 7.2 ha | 64 % / 45 % | 70 of 96 | 1,307 t | 34.5 m / 44 % |
| Road 2 | 2,936 m | 5.9 ha | 47 % / 30 % | 217 of 324 | 660 t | 23.9 m / 32 % |
| Road 3 | 255 m | 0.5 ha | 72 % / 29 % | 6 of 32 | 54 t | 22.8 m / 30 % |
| Road 4 (three parts) | 1,643 m | 3.3 ha | 61–78 % / 37–58 % | 133 of 195 | 458 t | 27–32 m / 40–50 % |
| Road 5 (off the sheet) | 1,409 m | 2.8 ha | 45 % / — | — | 524 t | 27.1 m / 40 % |

- CHM v2 reads 15–40 points more timber in the clearing than the licensee's LiDAR, for the
  crown-gap reason above. Its trees tall enough to reach the running surface (up to 37 m) are a screen
  that every old-growth station passes.
- Only one linear gap of 30 m or more showed: road 2, 0+397 to 0+430. No existing trail runs under the
  roads.

## What this gives road design

| Use | Source | Strength here | Limit |
| --- | --- | --- | --- |
| Check a terrain's datum and bias before trusting quantities | ICESat-2 ground | 0.3 m on gentle ground; 4 usable passes even at an unmapped block | Tracks, not coverage; steep ground mixes geolocation into height; snow-free passes only |
| Choose between candidate terrains (regional, contours, CDED) | ICESat-2 ground | Picked the contour surface over the regional DEM by a factor of two in spread | Needs bins where both terrains exist |
| Clearing extent and timber on the right-of-way | CHM v2 cover (where the imagery postdates any cut), SCANFI biomass, VRI | Cover r 0.93 at 30 m | CHM v2 overstates cover by filling crown gaps; SCANFI is regional (NRCan: not for plot-level use) |
| Danger-tree and reach screening beside the road | CHM v2 heights | Finds every tall stand | Heights 0.5–8 m low, site-dependent; a screen, not a survey |
| When ground was cleared (existing openings, old roads) | SCANFI 5-year series, then Sentinel-2 | Dated all five openings | 30 m; a 5-year step |
| Biomass and timber volume | SCANFI biomass, VRI volume | Regional only | Neither is a cruise; VRI is the planning figure |
| Vertical canopy structure | GEDI | None usable at the block | No valid shots north of about 52° N in this test |

None of these resolves a road bench or replaces the licensee's or LidarBC's 1 m bare earth.

## What was built

| Piece | File |
| --- | --- |
| CHM v2 tile index, window reader, sampling (DOM and network free; the caller opens the COG) | `src/lib/forestry/canopy/metaChm.ts` |
| SCANFI v2 file names, window reader on the national grid, land cover codes | `src/lib/forestry/canopy/scanfi.ts` |
| Canopy across a road corridor: timber in the clearing, reaching trees, linear gaps | `src/lib/forestry/canopy/corridor.ts` |
| Terrain against independent ground points, binned per pass, by slope | `src/lib/forestry/canopy/groundCheck.ts` |
| SlideRule fetch and export (ICESat-2, GEDI), geoid conversion | `scripts/forestry/canopy-sources/sliderule-fetch.py`, `sliderule-export.py`, `gedi-summary.py` |
| The two benches | `scripts/forestry/canopy-sources/lidar-tile-bench.ts`, `road-canopy-bench.ts` |

To run them again:

```sh
python -m venv /tmp/sr && /tmp/sr/bin/pip install -r scripts/forestry/canopy-sources/requirements.txt
/tmp/sr/bin/python -I scripts/forestry/canopy-sources/sliderule-fetch.py g086 -122.835 53.880 -122.790 53.907 /tmp/cs
/tmp/sr/bin/python -I scripts/forestry/canopy-sources/sliderule-export.py g086 /tmp/cs
npm run lidar:fetch-analysis
node --import tsx scripts/forestry/canopy-sources/lidar-tile-bench.ts /tmp/cs/g086-bench.json --icesat2 /tmp/cs/g086-icesat2.json
# A road project, with a company's sheets when there are any (keep them and the output outside the repository):
SCANFI_CACHE=/tmp/cs node --import tsx scripts/forestry/canopy-sources/road-canopy-bench.ts project.road.json /tmp/cs/road.json \
  --field Field_Layout.pdf --canopy Canopy_Height.pdf --icesat2 /tmp/cs/<tag>-icesat2.json --gedi /tmp/cs/<tag>-gedi.json
```

The SlideRule fetch takes 2–6 minutes a box. The `atl03x` request returns every classified photon:
about 100 MB for a 6 × 7 km box.

## In the app (built the same day)

Built and tried on 18 November 2026; the contract is
[Canopy height and the ICESat-2 ground check](../forestry-road-design/canopy-and-satellite-ground.md).

1. **ICESat-2 ground check in Review** — built. A browser SlideRule client (`sliderule.ts`, its
   record stream decoded from the server's own `/source/definition` replies), EGM2008 from PROJ's
   CDN (`geoid.ts`), and a Review row once it has run. On the app's 093G086 LiDAR sample it reads
   −0.06 m (spread 0.28 m, 148 bins), the bench's figure. SlideRule's time is the weak point: one
   minute to past its 600 s limit for the same 1 km² box within an hour.
2. **Canopy plan layer and corridor panel** — built, with per-tile imagery dates (3,160 BC tiles,
   161 KB, loaded only when the layer is on). The view read in 3.5 s and the 1.4 km training road's corridor in under 2 s.
3. **SCANFI through bcdatamapper** — not built. The 2025 height layer's tiles inside BC's bounding
   box hold 910 MB (the box is larger than BC), against the 459 MB bcdatamapper's Pages site has left, for one layer and one year; and
   BC's harvest layers and Sentinel-2 already date cuts in the app.

## Corrections to the note this started from

- GEDI does reach 54° N in its 2024 data, but no shot there was usable.
- The repository holds no Parquet reader for the browser. A CHM v2 loader does not need one: the
  quadkey is computed (`metaChmTiles`), not looked up.
- CHM v2's error against LiDAR is not a number to quote for BC. It is −7.9 m at one site and −0.5 m at
  the other, against LiDAR in both.
