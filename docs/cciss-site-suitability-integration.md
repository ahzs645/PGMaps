# CCISS site suitability in PGMaps

## Scope

Build a value-backed CCISS map and, separately, reproduce site-specific tree
species suitability calculations. The map's coloured tiles are a display
product. Site calculations use model-member predictions and ecological lookup
tables that are not encoded in those tiles.

## Verified numeric raster path

The public CCISS Spatial tab has a `Download Province` action. On 2026-09-27,
its default reference BGC download was an LZW-compressed, signed 16-bit GeoTIFF
of 8,981 × 4,209 cells (6,939,082 bytes). A reference lodgepole pine
suitability download for edatope C4 was 8,469 × 4,209 cells (2,888,369
bytes). Both use 0.0027777778-degree pixels and `-32768` for NoData. The suitability raster
contained the codes `10`, `20`, and `30`, which the public
`Feasibility_Legend.csv` identifies as suitability classes 1, 2, and 3.

`node scripts/inspect-cciss-raster.mjs <GeoTIFF> <latitude> <longitude>` reads
an exact pixel value from a downloaded file with the existing `geotiff`
dependency. At the public test coordinate 53.9171, -122.7497, the reference
BGC raster returned `397` (`SBSmh` in `Subzone_Legend.csv`), and the lodgepole
pine raster returned `20` (class 2, moderate). This validates numeric raster
lookups, not agreement with the coloured tiles or site-series calculations.

For a repeatable local preparation check, run
`uv run --with rasterio scripts/prepare-cciss-suitability-cog.py <input.tif> <output.cog.tif>`.
The script requires one integer band in EPSG:4326, explicit NoData, and only
the `10`, `20`, and `30` suitability codes. It creates a DEFLATE-compressed
Cloud Optimized GeoTIFF with nearest-neighbour overviews, then compares every
full-resolution cell, the grid metadata, and class counts against the input.
It does not infer values from colours or convert one CCISS raster product into
another. The dev page prefers the prepared COG and falls back to the original
download when the COG has not been generated. In either case, its numeric map
tiles and clicked values read the same image.

The `/dev/forestry/cciss-suitability` pilot displays CCISS's public WebP tiles
in MapLibre. It offers the app's main BGC/suitability, period, species,
edatope, and climate-model map choices and checks that a selected tile set
exists. The numeric values come from GeoTIFF cells, not tile colours. Exact
numeric lookup is currently bound to mapped 1961–1990 Pl/C4 suitability
and the reference BGC download; other tile choices do not display a borrowed
numeric result. The browser loads these two files automatically if a prepared
PGMaps snapshot is available, with a local-file picker as fallback. Selected
files remain in the browser and are not uploaded. The original downloads, COG
and generated vector blocks are now owned by
`vendor/bcdatamapper/datascrapers/bc/cciss/output`; the data sync copies them to
ignored `public/data/cciss`. A deployment still requires committing/pushing the
submodule snapshot before updating the parent pointer. It does not yet run the
site-series calculator.

### Default map source

The dev page opens with **Tile trace → Grid cells** (`render=trace`), using the
full-province reconstruction and its zoom-dependent overviews. **Numeric vector**
is the primary alternative: it preserves the downloaded numeric raster's cell
boundaries and codes and supports polygon picking. The GeoTIFF remains the
numeric lookup source; tracing public image colours never supplies calculations.

**Comparison options** hides the original CCISS tiles and direct GeoTIFF renderer
until expanded. Original tile metadata and images are requested only after an
explicit tile selection. Existing `render=tiles` and `render=native` links still
work. Direct GeoTIFF remains available for local uploads, which disable the
precomputed numeric vector. Neither representation adds source resolution.

Prepared trace/vector coverage is currently mapped 1961–1990 Pl/C4. Selecting
another layer shows an unavailable-overlay notice with a return action; it does
not silently enable original tiles. Those remain an explicit comparison choice.

### Reusable polygon conversion and deck.gl comparison

The **Vector** option (`render=vector`) uses the same approach as AQMap's native
PM2.5 polygons: merge adjacent cells of the same class, retain cell boundaries,
and draw pickable deck.gl polygons. The converter and browser layer are generic:
`vendor/bcdatamapper/datascrapers/lib/categorical_raster.py` and
`src/components/ui/map-categorical-raster.tsx`. The converter accepts integer
class rasters with a CRS, preserves NoData and arbitrary class codes, and verifies
native and published polygon round trips. It does not infer values from colours.
See the converter's adjacent `categorical-raster.md` for its contract and limits.

This CCISS snapshot has 79,887 polygons in 308 native 256×256-cell blocks, totalling
6,900,717 compressed tile bytes. Every original class cell and each class's area
is checked during conversion. The browser loads visible blocks progressively, centre first, then prefetches
a 25% viewport margin. Six requests run concurrently; visible data stays pinned
in memory alongside 32 recently used offscreen blocks. Camera movement updates
the queue every 120 ms without restarting still-needed requests. Completed blocks
draw each animation frame, with explicit progress or incomplete-coverage status. Colour and picking use `properties.value`;
the panel independently reads the corresponding TIFF cell for comparison.
All view options retain the camera. The vector snapshot is disabled after
loading a different local TIFF so it cannot silently represent the wrong file.

Both Numeric GeoTIFF and Vector derive from the historical download. The public
CCISS tiles remain a different reference source. Polygonization sharpens drawn
edges without adding ecological detail or resolving the upstream source mismatch.

Validation on 2026-09-27 covered all 35,646,021 raster cells (11,028,673 valid),
deterministic tile output, and converter fixtures for holes, block seams, rotated
projected grids, and rejected inputs. Browser checks covered zooms 5.5 through
15, all three class picks against independent TIFF reads, source switching, and
a missing tile followed by recovery. TypeScript, targeted ESLint, converter unit
tests, and the full data-sync command passed. These are local desktop checks;
the vector snapshot has not been deployed or benchmarked on mobile devices.

The progressive loader has four additional tests covering visible-first request
ordering, slow-block completion, cache pinning beyond 32 visible blocks, prefetch
reuse, cancellation, late responses, partial failure/retry and disposal. Browser
checks covered throttled loading, panning, and a cached zoom from 7.5 to 8.5 with
zero new polygon requests. Temporary network throttling was restored afterward.

### Can the public WebP tiles be polygonized?

The live TileJSON identifies `NewFeas_1961_1990_ref_C4_Pl.tif` as the source of
that public WebP pyramid (zoom 5–12). Our numeric download is a different file,
`FeasibilityRaw_1961_1990_C4_Pl.tif`. Obtaining the matching `NewFeas` class raster
would let the existing converter preserve its values directly.

A separate visual reconstruction could classify WebP pixels by the legend and
polygonize them, but the result would contain **inferred display classes**. It
would need one fixed source zoom, transparent-pixel handling, uncertain boundary
masks, and cross-tile seam checks. Lossy image colours and lower-zoom resampling
cannot recover the original numeric grid or model values. Such a preview must
remain separate from authoritative numeric picking and the suitability calculator.
The **Tile trace** option (`render=trace`) now offers a bounded nine-tile pilot
near Fraser Lake. It uses the zoom-12 mosaic, explicit sRGB distance/margin and
alpha thresholds, and purple uncertain polygons. It has 102 polygons / 94,908
gzip bytes, with 2,463 of 589,824 pixels (0.4176%) labelled uncertain. The inferred
raster and published geometry round-trip exactly; repeat outputs are byte-identical.
This does not quantify agreement with the unknown source raster. The UI separates
inferred picks from downloaded numeric TIFF samples and does not feed them into
calculations. Outside the pilot footprint there is no trace coverage. Browser checks confirmed
source switching without a camera shift at zoom 12, boundary alignment within the
pilot footprint, an inferred Moderate pick, and continued vector drawing at zoom
13. TypeScript, targeted lint, classifier/converter tests and full data sync passed.

The direct matching TIFF URL returned 404. The tile-server index and both relevant
catalogue resources yielded no public download for it. See the scraper README's
matching-source search notes and exact data request. The file has not been
obtained; if provided, inspect whether it is numeric or RGB before conversion.

### Raster rendering and source mismatch

The public suitability WebP tile set has `maxzoom: 12`; zooming farther enlarges
those compressed images. PGMaps now uses nearest-neighbour resampling for CCISS
tiles, which keeps class edges square but cannot remove WebP colour artifacts or
add spatial detail. For the mapped historical Pl/C4 choice, the pilot also
offers an **experimental downloaded numeric GeoTIFF** view. A MapLibre custom
raster protocol draws classified tiles directly from that one GeoTIFF at every
zoom, with nearest-neighbour resampling and no tile fade. High zoom enlarges
these numeric tiles without switching back to the WebP source. At overview
zooms, tile generation bounds its decode work by sampling down to screen scale;
at close zoom it retains the exact source cells. Conversion shows the native
0.0027777778-degree grid clearly but cannot improve its spatial resolution.
The earlier pilot switched from WebP to GeoTIFF polygons at zoom 12.5 and
temporarily showed WebP while panning; that caused the visible layer jump.

The initial comparison paired the Shiny download with the **modelled**
historical tile set, `NewFeas_1961_1990_C4_Pl`. That was the main mismatch.
The Shiny map selects `NewFeas_1961_1990_ref_C4_Pl` when Historic → Mapped is
chosen, but its download handler ignores the Historic mapped/modelled choice
and always selects `FeasibilityRaw_1961_1990_C4_Pl.tif`. The download is much
closer to the mapped tile set. At 53.9171, -122.7497, the downloaded cell is
`20` (Moderate): the mapped tile is blue (Moderate), while the modelled tile is
green (High). In a 96-point grid around Prince George, 24 pairs differed with
the modelled tiles, versus 3 with the mapped tiles, classifying WebP colours to
the nearest legend colour. The three residual differences are Moderate in the
download and High in the mapped tiles. This is a local diagnostic sample, not
a province-wide accuracy estimate or proof of exact equivalence. The pilot
uses the mapped historical selection for comparison and keeps the modelled
selection available through the original tiles. The default renderer is now
the grid trace described above.

The zoomed comparison around 53.9100, -122.7460 reveals another residual:
the downloaded raster's cell (column 5339, row 2192) is `10` (High), covering
longitude -122.747361 to -122.744583 and latitude 53.908472 to 53.911250.
The mapped WebP tile at the same coordinate is blue (Moderate). The green
rectangle in PGMaps is located at the GeoTIFF's georeferenced cell bounds; it
does not appear in the mapped tile. This is a source-value difference, not a
map projection shift.
At zoom 15 near Prince George, the roughly 182 × 309 m source cell occupies
about 125 × 210 map pixels, so this isolated disagreement is prominent. The
coarse 96-point diagnostic grid did not sample inside that cell.

At a wider scale, the disagreement is visible as a regional feature as well.
At zoom 8–10 around Prince George, the downloaded GeoTIFF has a blue
(Moderate) branch extending west from the city's main blue corridor. The
public mapped tiles show that branch as green (High). At 53.96654, -122.85202,
the downloaded raster cell is `20` (Moderate; column 5301, row 2172), while
the mapped tile is green (High). The main north–south corridor has roughly the
same location in both views, so the branch is a source-class difference rather
than a coordinate offset or a high-zoom resampling artefact. This comparison
does not establish which source is authoritative for that location.
Sampling the published zoom-12 WebP tiles directly at that point returns green
`(0, 100, 0)` from both `NewFeas_1961_1990_ref_C4_Pl` (mapped) and
`NewFeas_1961_1990_C4_Pl` (modelled). The branch mismatch therefore is not
explained by choosing the wrong historic map option. TileJSON identifies the
mapped tiles as rendered from `NewFeas_1961_1990_ref_C4_Pl.tif`; the Shiny
download handler selects `FeasibilityRaw_1961_1990_C4_Pl.tif` for either
historic map option. The public code does not show how those two source
rasters were generated, so it cannot establish why their classes differ.

The Shiny download handler uses `edatope_feas` to query C4 but mistakenly uses
`edatopic_feas` in the output filename, which explains the blank edatope suffix
of the downloaded file. The remaining mapped tile/download differences may
reflect source or tile-generation differences; their cause is not yet proven.
Do not present a report that assumes exact pixel agreement until a
version-matched source raster is obtained.

The download URL belongs to a temporary Shiny session. A PGMaps deployment
needs versioned source GeoTIFFs or a durable numeric service. Keep bulk source
data and any deterministic processed snapshots in `vendor/bcdatamapper`; the
PGMaps `public/data` copy is generated by the data sync step.

## Site-specific calculation path

The app's current `app/server/generate.R` uses this sequence:

1. Resolve a point to BGC, site number, elevation, forest region, and site
   series using `ccissr::dbPointInfo` and its geographic lookup tables.
2. Read observed and future BGC predictions from PostgreSQL with
   `dbGetCCISS_novelty` or `dbGetCCISS_v13`. The query applies the selected GCM
   and SSP weights to individual model members and produces BGC probabilities.
3. Crosswalk each current site series to predicted site series with
   `ccissr::edatopicOverlap`, using `E1` and `E1_Phase`.
4. Calculate suitability votes and establishment/maturity summaries with
   `ccissr::ccissOutput`, using `S1`, `R1`, `F1`, and the period weights.
5. Join stocking standards and silvics tables for the report.

The deployed app names the key prediction tables
`cciss_future14_array`, `cciss_novelty14_array`, `cciss_current14`,
`bgc_attribution14`, and `bgc14`, plus the `gcm`, `scenario`, `futureperiod`,
and `run` dimensions. Point attribution queries also use `bc_elevation`,
`bec_info`, `hex_grid`, `bcb_hres`, and `bc_forest_regions`. The public `ccissr`
development branch contains the calculation code and small reference tables;
the Shiny repository does not contain an export of these prediction arrays.

The public map offers five individual GCM tile series and an ensemble image.
The site calculation has adjustable weights across a broader GCM/SSP ensemble.
Colour tiles and even the downloadable aggregate suitability rasters cannot
recover those member votes or reproduce arbitrary weighting. A version-matched
export of the prediction arrays is the missing input for equivalent results.

The published `ccissr` calculation source was inspected at development commit
`a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce`. It contains the overlap and
suitability functions, including C++ helpers; this commit is a code reference,
not evidence of the precise build deployed by the live Shiny server.

## Other CCISS pages and reports

The Shiny app's tabs use one generated result in several ways; they are not
independent public datasets. The public [instructions](https://bcgov-ffec.ca/cciss-docs/Instructions.html)
describe the outputs, and the local Shiny source shows these dependencies:

| CCISS page | Output and present PGMaps path | Additional input for equivalent results |
| --- | --- | --- |
| Select Sites | Point/BGC/district and CSV selection; PGMaps can build the interface. | Point-to-site attribution (`dbPointInfo`) and geographic tables for the same BEC edition. |
| Suitability Report | Detailed period-by-period species vote bars, summary comparison with CFRG, and edatopic grid. | Model-member arrays, site-series overlaps, suitability and CFRG/stocking tables, selected model and period weights. |
| BEC Futures Chart / Map | Predicted BGC probability chart and site-series overlap; the map recolours WNA BGC polygons for one site and period. | Per-site BGC probabilities and edatopic overlap calculated from the model arrays. The public BGC vector geometry alone does not contain those probabilities. |
| Silvics | About, tolerance, resistance, regeneration, and maturing tables. | Static `ccissr` silvics tables can be shown independently; the suitable-species filter depends on the generated report. |
| Export | HTML/PDF report plus CSV/RDS result bundle. | Generated `uData$cciss_results` and its report inputs; `app/server/reportpdf.Rmd` is a rendering template, not a result dataset. |
| CCISS Spatial | Public BGC/suitability/novelty image tiles; some numeric GeoTIFF downloads. The map choices are now in the pilot. | Durable, versioned numeric rasters for every value-backed choice. District/FLP area summaries and plots also query remote database tables. |
| Species Outlooks | Province-wide narrative pages. | The app lists western redcedar as available and Douglas-fir as coming soon; the linked western redcedar path returned HTTP 404 in the 2026-09-27 check, so it should not be copied as a working link yet. |
| Documentation | Public instructions, methods, model information, and app information. | Public pages and the app's `CCISS_Version_Info.csv`; no site calculation is needed to link the documentation. |

The best next report implementation is the site-specific **detailed suitability
report**, followed by its summary and export formats using the same verified
calculation output. Reproducing report markup without the prediction data
would make a plausible-looking but unvalidated result.

## Data request for equivalent site results

Request a versioned, documented export of the deployed v13.1 PostgreSQL tables
named above, including the complete model-member prediction arrays, observed
predictions, site/BGC attribution, dimension tables, and the geographic lookup
tables needed to resolve a latitude/longitude to a site number. Ask for the
exact deployed `ccissr` commit or package build and the `E1`, `E1_Phase`, `S1`,
`R1`, `F1`, stocking-standards, and silvics tables from that build. Ask for a
small set of known input points, site series, model-weight settings, and their
CSV report outputs to compare calculations. A schema-only dump or the published
colour tiles is insufficient; the array contents are the essential input.

## Build sequence

1. Acquire a version-matched export of the named prediction and geographic
   lookup tables, their schemas, and the deployed `ccissr` revision. Confirm
   that published table and raster versions match the running CCISS v13.1 app.
2. Capture a few known site-series reports from the original app as reference
   cases, including default and changed model weights. The public app
   disconnected during an initial test run, so this validation remains open.
3. Run the published `ccissr` functions against the exported data in an
   isolated calculation service. PGMaps is deployed as a static GitHub Pages
   app; adjustable per-site calculations need a service or a large, versioned
   precomputed dataset.
4. Add a PGMaps project map with the published WebP tiles and a separate
   numeric lookup source. Compare numeric map results and site reports with
   the reference cases before presenting them as equivalent to CCISS.

Public source references:

- [CCISS Shiny app](https://github.com/bcgov/CCISS_ShinyApp)
- [ccissr development branch](https://github.com/bcgov/ccissr/tree/development)
- [CCISS methods](https://bcgov-ffec.ca/cciss-docs/Methods.html)
- [CCISS data resources and licence](https://bcgov-ffec.ca/cciss-docs/Resources.html)

### Grid reconstruction of the public tile pilot

Tile trace now defaults to **Grid cells**, with **Image pixels** retained for
comparison. The assumed 10-arc-second EPSG:4326 grid uses the archived TileJSON
west/north bounds as origin. Interior pixel votes remove compressed edge colours;
conflicts and insufficient evidence remain uncertain rather than being forced to
a class. See the scraper README for the thresholds and rejection gate.

This sample resolves 5,170 full cells with unanimous interior votes. Rasterizing
the grid back to the WebP mosaic agrees with all 575,925 eligible confidently
classified pixels, including pixels outside the voting interiors. That validates
the display reconstruction, not the original model data. Equal neighbours merge
into 3 polygons (997 gzip bytes), with no purple uncertain cells in this sample.
Partial cells at the mosaic edge are omitted. The output belongs to the scraper's
`output/public-grid-trace`; the existing numeric source remains separate.

### Full published layer coverage

The default **Tile trace → Grid cells** option now uses
`output/province-grid-trace`, covering the entire published historical mapped
Pl/C4 layer. It was reconstructed from every one of the 65,550 zoom-12 source
tiles in the layer extent. The original pixel method is explicitly labelled
**Image pixels (sample)**. A **View whole layer** link opens the province view;
reconstruction method is also preserved in the URL as `traceMethod`.

The full raster contains 37,801,029 cells, with 17,172,893 classified and no
uncertain cells under the recorded rule. Its 27,306 polygons occupy 6,356,713
compressed bytes in 321 blocks. The generic converter verified every grid cell
and its published geometry. Four additional regional image/grid checks and
cross-tile voting tests passed. This is full geographic coverage of this one
layer, not reconstruction of every species/period/edatope combination. The data
remain inferred display classes, separate from the numeric/model calculations.

See `vendor/bcdatamapper/datascrapers/bc/cciss/province-trace.md` for rebuild commands,
archive format, thresholds, validation, exact counts and source ownership.

Browser verification covered the previous out-of-sample camera (54.102926,
-124.462517 at zoom 8.31), the province view (all 321 blocks loaded at zoom 4.5),
and source switching. No browser warnings/errors were reported. The sidebar's
whole-layer link now uses a zoom that fits the published extent in the desktop
map pane. TypeScript, targeted ESLint, grid tests and full data assembly passed.

## Zoom-dependent trace loading

The full-layer grid trace now uses `province-grid-trace/overviews/manifest.json`.
Below zoom 6 it loads a 1:8 display grid; zooms 6–7 use 1:4, zooms 7–8 use 1:2,
and zoom 8+ uses the unchanged full grid. A 0.2 zoom deadband avoids rapid
switching at thresholds. The entire distant level is 747,455 compressed geometry
bytes in 9 blocks, compared with 6,356,713 bytes in 321 full-detail blocks.
The overview and detail come from the same inferred TIFF. Small patches and
boundaries are generalized in the overview; the sidebar and picked values say
so. This does not recover original model values.

The renderer fetches only intersecting blocks and a nearby margin, retains the
old level until visible replacement blocks are ready, caches blocks per level,
and cancels obsolete requests. The source converter and pyramid contract are
documented in `vendor/bcdatamapper/datascrapers/lib/categorical-raster.md`.

Validation: overview-mask/extent and deterministic-pipeline tests passed,
including rejection of a mismatched full-detail source checksum; all generated
overview polygons passed raster and published-geometry round trips. Seven
TypeScript loader/level-selection tests passed. Browser zooms 4.5, 6.5, 7.5 and
8.5 selected 1:8, 1:4, 1:2 and full detail respectively; zooming back selected
the cached overview. A whole-extent cold page requested nine overview blocks
and no full-detail blocks. TypeScript compilation and targeted ESLint passed.

### Keep polygon preparation off the UI thread

The zoom pyramid reduced downloads, but the first implementation still handed
all newly visible GeoJSON to deck.gl at once. A CPU profile of the user's camera
(-122.986113, 52.951555), zooming from 5.77 to 6.77, recorded a 425 ms main-thread
task dominated by polygon triangulation (`isEarHashed`, `findHoleBridge`,
`getSurfaceIndices`).

`categoricalPolygonWorkerPool.ts` now runs at most two background jobs. Workers
fetch, inflate gzip, parse JSON, and triangulate into deck.gl binary geometry.
Typed arrays are transferred rather than cloned, coordinates stay Float64, and
class values remain indexed for binary picking. The LRU caches prepared geometry;
cancelling a block terminates its active worker, and unmount disposes the pool.
GPU layer updates wait for `moveend` while preparation continues during motion.
There is no synchronous triangulation fallback that could freeze a gesture.

The same local zoom test after the change recorded no tasks over 50 ms, and no
main-thread triangulation samples. This is a single desktop comparison, not a
frame-rate guarantee across devices. Browser picking of a blue overview polygon
returned Moderate with the generalized label. Tests cover hole triangulation,
class zero, transfer ownership, cancellation, worker errors and disposal.
The production build emits a separate ~15.6 KB worker bundle.

### Cache rendered geometry across zoom levels

Decoded-data caching alone did not retain deck.gl's GPU state: removing the
previous level from `layers` finalized its buffers. `ResidentRasterBlocks` now
retains up to 48 inactive blocks in addition to current blocks, with stable
layer IDs and identical binary data. Inactive layers are hidden and non-pickable.
Oldest inactive blocks are evicted first; a source change or overlay teardown
clears residency. The loader can reuse resident geometry even if its separate
decoded-data LRU evicted that block.

During movement, a fully cached viewport may switch visibility immediately.
New geometry uploads and new block requests wait for the final viewport, avoiding
requests for temporary extents that would be cancelled at the next threshold.
Existing still-relevant requests may complete in the background. The first visit
to a new area/detail level still loads; this is bounded in-session caching.

Browser verification at (-123.367858, 53.147972), warming zooms 7.5 and 8.5 and
then repeating the round trip, recorded zero polygon worker jobs in both
directions (so no polygon fetch/decode/triangulation). Returning to the overview
also created zero WebGL buffers. Fifteen loader, residency, level-selection and
worker/geometry tests passed, along with TypeScript and targeted ESLint.


## Legacy client-side analysis (2026-09-27)

The dev page now includes **Open legacy analysis**. See
[the implementation and data checklist](cciss-client-analysis.md) for the converted
12.9 MB package, the discovered raster-codebook mismatch and its reconciliation,
validation coverage, and inputs still required by the current calculator.
