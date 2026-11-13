# Company source-map imports

**Layers → Add files / Add folder** accepts the Canfor ArcGIS Pro PDF templates represented by
a supplied block's August/September 2026 field layout, ortho, general access, hillshade,
slope and canopy-height sheets, including their revised PDF. This is a client-side reader:
PDF bytes, extraction and preview rendering stay in a dedicated browser worker. It uses
Mozilla PDF.js (Apache-2.0) and pdf-lib (MIT), loaded only for a PDF import. There is no
conversion server, upload, Python, installed GDAL or RustGIS requirement.

## What importing does

1. Pair GIS sidecars as before. Read a PDF's ISO geospatial viewport, projected WKT,
   normalized local controls and latitude-first geographic controls. Fit in the declared
   metre-based projection, then transform extracted points to WGS84 using that projection.
   Refuse missing or inconsistent registration, an unknown template or multiple map frames.
2. Match the named layer vocabulary with the versioned company profile in
   `src/lib/geoPdf/profiles.ts`. The Canfor profile recognizes exact map-layer families for
   block outlines, roads, streams, reserves, field lines and contours. Label and legend layer
   names do not match those rules. Clip recovered geometry to the registered map frame and
   supported rectangular drawing clips. Preserve polygon holes. Non-rectangular clips stay
   in the sheet image and are counted in an import notice.
3. Read supported slope/canopy image layers at their original embedded pixel dimensions.
   Match printed legend text to its vector swatches. Lossless tiles are classified by colour;
   JPEG tiles by the coefficient decoder. The transparency mask is read exactly in both. Build
   a registered byte class grid. This never reads the reduced JPEG sheet preview. See
   **Class rasters** below.
4. Build a terrain surface from the field sheet's labelled contours, offered only as terrain.
   See **Terrain from contours** below.
5. Show a review dialog with a checkbox and permitted role for each recovered layer. A PDF
   drawing starts as **Reference**. A simple line layer can explicitly become proposed roads,
   and a polygon layer can explicitly become planned blocks. A sheet image and compound
   stream drawing and a class raster stay reference. A contour surface can only be
   **Terrain (replaces current)**. The profile does not infer planned/constructed road status,
   stream class, reserve restrictions or legal meaning from colour and symbols.
6. For several PDFs, initially select the field-layout sheet if present, otherwise the first
   sheet. Initially select its bounded geometry only when native GIS layers were not supplied.
   Select the first class raster of each kind even when native GIS files are supplied. The
   contour terrain starts selected only over the sample terrain; any other terrain stays
   unless the person picks the contours. Other sheets and recovered layers remain available
   to select. A PDF identical (by SHA-256) to one already read is skipped before it is read
   and named in the notes. A numbered road naming another block beside a canonical block
   shapefile is left unselected for review. Different revisions are never collapsed because
   their filenames resemble each other.
7. Save accepted source references with the project: file path, SHA-256, page, original layer,
   profile version and registration-fit residual. **Layers** exposes these and original scalar
   GIS attributes. Project and reference GeoJSON round trips keep them. The bounded JPEG sheet
   preview, PNG class display and compressed native class grid are embedded too; reloading needs no access to the original PDF. Original PDFs are
   not embedded. Reference-sheet visibility follows its layer's eye and **Fit all layers**.

A stream layer is a `MultiLineString` of recovered drawing paths. It does not imply that a
dash, a branch or a whole PDF painting operation was an original stream record, and it does
not join gaps. Original GIS record boundaries and attributes cannot be recovered from these
sheets. Copying a recovered simple road into a design samples the selected terrain through
the existing road workflow. Reference data do not change crossings, constraints, volumes or
terrain by themselves; only an accepted contour surface replaces the terrain.

## Class rasters

In **Layers**, expand **Canopy height classes** or **Slope classes**, then its feature.
Choose an imported/drawn block under **Area to summarize** and **Summarize mapped classes**.
Make the class layer visible and click the plan in **Inspect map** to read a published range.
Visibility follows the layer eye; the plan legend shows the source palette. JPEG estimates
draw faded, lossless matches draw solid, and not-drawn cells are transparent. The source-sheet
preview is a separate layer, so hide it to see the classified layer alone.

`rasterProfiles.ts` records this template's image-layer families, expected alpha, printed
ranges and the unpainted class below them. `rasterRead.ts` reads image placements through
nested PDF graphics transforms, requires a common native pixel basis and integer tile offsets,
and checks the rectangular map frame. Labels, roads, stream linework and contours are different
drawing objects and never enter the class pass. It refuses missing/ambiguous legends or
unsupported tile layouts with an explicit notice while retaining the other supported
reference layers.

The supplied sheets each contain four native tiles forming **3,637 × 3,004** pixels, about
0.847 m per embedded PDF pixel. This is the map export's sampling, not a claim about LiDAR
resolution. Canopy has two JPEG and two lossless tiles; slope has three JPEG and one lossless
base tile, plus four lossless black-mask tiles. The JPEG tiles are very low quality (luma DC
step 57, most chroma steps 168–255, 4:2:0 subsampling), so which class a single JPEG pixel was
is not in the file any more.

### What is exact, everywhere

Every tile's soft mask is Flate-compressed and two-valued (canopy 0/255, slope 0/216), JPEG
tiles included. Inside the raster, a transparent pixel is the sheet's unpainted class below the
lowest printed range: the canopy layer is named "9 Category" but prints 8, and its transparent
cells are crown gaps and openings. So the summary's first split is exact over the whole block:

- **Under 5 m / Under 20 % (not drawn)**: transparent. The sheet also leaves cells without data
  undrawn, so the label says "below the lowest printed class, or no data".
- **Drawn**: at or above 5 m / 20 %, for certain. Its class is exact in lossless tiles and an
  estimate in JPEG tiles; **Drawn, class not exact** is that second part's total.
- **Not known**: outside the raster or frame, an unexpected alpha, a conflicting overlap, or a
  95+ mask over an undrawn base.

`classAreaBreakdown` (`classGrid.ts`) computes the split; the grid records the unpainted class
in `undrawn`. Grids saved before it was recorded keep transparency as unknown until re-imported.

On the supplied 201.11966 ha block polygon: canopy is 63.1% under 5 m, 10.2% exact class and
26.7% estimated; slope is 13.1% under 20%, 8.3% exact class (most of it the lossless 95+ mask)
and 78.6% estimated. Nothing is left not known. Before, 89.3% of the canopy and 84.3% of
the slope had no class at all.

### JPEG tiles: the coefficient decoder

`jpegCoefficients.ts` reads a baseline JPEG's stored quantized DCT coefficients and tables
(progressive and arithmetic-coded files are refused). `paletteJpeg.ts` starts each drawn pixel
at the nearest raster colour, then changes a pixel's class when that moves the labelled image's
own JPEG encoding closer to the stored coefficients, measured in quantization steps. The
transparent pixels are fixed at the black ArcGIS writes under them. This is the
quantization-constraint idea of projection-onto-convex-sets JPEG restoration, with the palette
as the only allowed colours. It is not smoothing: a class change is accepted only for the
coefficient evidence, never for its neighbours.

Calibration (`check-pdf-jpeg-calibration.ts`): a lossless tile re-encoded with a JPEG tile's own
tables and subsampling, scored against the lossless tile's classes. Misallocated share is the
share of drawn area put in the wrong range, averaged over square windows.

| Method                    | Slope: pixel right | Slope: misallocated 27 / 54 / 108 m | Canopy: pixel right | Canopy: misallocated 27 / 54 / 108 m |
| ------------------------- | ------------------ | ----------------------------------- | ------------------- | ------------------------------------ |
| Colour radius 24 (old)    | 84% of 13% matched | 43 / 43 / 43%                       | 85% of 2% matched   | 49 / 49 / 49%                        |
| Nearest colour, no radius | 52%                | 28 / 27 / 27%                       | 50%                 | 17 / 16 / 16%                        |
| Coefficient decoder       | 54%                | 9.8 / 8.9 / 8.3%                    | 45%                 | 12.5 / 11.6 / 11.7%                  |

So a decoded pixel is still about a coin toss, and every decoded pixel stays a **JPEG
estimate**: its own column, never in the exact column, faded on the map, and the point query
says it is uncertain at one pixel. The useful reading is the share of each range over an area.
This is one clean tile per map, not a guaranteed error bound for every export.

Measured and not adopted: a neighbour prior learned from the lossless tiles, and the contour
slope as a prior, both through the same greedy search. Both broke the coefficient constraints
(fewer than half the squares stayed consistent) and made area shares worse. Consistency with the
stored coefficients is also no per-pixel certificate: 96–99% of 16 × 16 squares pass it under
labels that are half wrong.

Slope's printed red **85+** swatch is RGB 232/21/21, but its raster uses 255/0/0; that explicit
alias is in the profile and the decoder uses the raster colour. The separately printed black
**95+** class comes from the lossless **Slope Breaks** mask. Where the base is lossless it must
agree with 85+; a JPEG base does not invalidate the independent lossless mask. Transparent,
unexpected-alpha or conflicting bases remain unknown. The labels **85+** and **95+** overlap as
printed; the reader does not silently rename 85+ to 85–95. No exact value within any range is
inferred.

`classGrid.ts` provides DOM/network-free point queries and polygon summaries. Areas use the
declared metre-based projection and the pixel affine transform's determinant, with exact
fractional boundary-cell intersection, holes and multipart geometry. Every percentage uses the
full polygon. Large summaries yield cooperatively and can be cancelled.

Project JSON and reference GeoJSON preserve the palette, unpainted class, source CRS, native
dimensions, pixel-to-projected transform, zlib/base64 byte grid, checksum, code counts, image
references, compression flags and interpretation notes. Loading validates limits, checksum,
legal codes and count reconciliation. Map drawing GeoJSON omits those payloads and suppresses
filled raster footprints. These features cannot become planned blocks, buffer sources, vehicle
sources or terrain inputs. The PNG is only a bounded display; queries and summaries read the
native grid. The saved grid and checksum preserve the imported result.

### Slope from terrain

When the project terrain is a raster, a slope summary adds **From terrain**: the terrain's
percent slope (central differences on its own cells) read with the sheet's ranges, counted at
cell centres inside the area (`terrainSlopeClasses.ts`). Overlapping open ranges (85+, 95+) take
the one with the higher minimum. Missing terrain is **Not known**. It is a different measurement
from the sheet: compare ranges over an area, not cells. A contour terrain prints the accuracy
measured below.

## Terrain from contours

The field layout sheet draws its LiDAR contours as vector lines in **Contours - Enhanced - 6k -
26k** and prints elevations on them (271 rotated labels on the supplied sheet, 780–1560 m, legend "Contours -
10m"). Vector lines are lossless. `contours.ts` turns them into terrain:

1. **Lines**: only stroked paths of the contour layer. Its "- Index" and "- Default" sublayers
   are the white filled halos behind the labels, not contours.
2. **Labels**: a printed number inside the frame belongs to a line when that line passes within
   1 page point of the number's centre and no other line is within 0.5 point more. Labels sit
   on their line: on the supplied sheet, 183 of the 416 printed numbers in the frame lie on exactly one
   contour; the rest are road, stream and inventory numbers. A line with two different values is
   a conflict and stays unlabelled.
3. **Interval**: the legend's "Contours - N m" when printed, else the largest step at least 80% of
   labels sit on.
4. **Checks**: values off the interval are dropped. Then each half of the labelled lines is
   checked against the surface of the other half, and a label that disagrees by an interval or
   more is dropped (a spot height or reach number touching a contour).
5. **Inference**: an unlabelled line takes the interval step its labelled neighbours' surface
   puts it on, only when that surface is within 30% of an interval of a step. Repeated while
   lines are added. Never extrapolated beyond the outermost labelled lines.
6. **Surface**: a TIN of the assigned lines, rasterized to 2 m cells in the sheet's own CRS
   (BC Albers or a UTM zone; anything else is refused) and clipped to the map frame. A triangle
   with an edge over 200 m, or rising more than one interval, is left empty. A contour TIN's real
   triangles join a contour to itself or the next one; longer ones bridged ground the labelled
   contours never reached. On the supplied sheet they fanned across the north-east, where only an unnamed
   contour set is drawn, so that ground is now missing, not invented.

Choose **Terrain (replaces current)** in the import dialog. The sheet prints no vertical datum,
so the existing terrain question asks for it; the open terrain's datum is never reused. The
surface becomes an ordinary terrain raster (`contourTerrain.ts`), id ending `-contours`.

Between contours the ground is a plane, so crests and valley floors read flat and nothing finer
than 10 m of relief is known. Where a triangle's three corners lie on one contour the surface is a
flat terrace, so the hillshade shows bands with a step at each contour (see **Interpolation
between contours**). Use it
where no LiDAR terrain covers the block (LidarBC has none under the supplied block); a LiDAR DEM
is better wherever it exists.

Rendered as a hillshade, the supplied sheet's surface shows the LiDAR detail the regional DEM
lacks (gullies, benches, the river terraces), the terrace banding, and blank ground in the
north-east and along one river channel, where no labelled contour reaches. That render is a
licensee's terrain and is not kept in the repository.

**Measured accuracy** (`check-pdf-contour-slope.ts`), scored on the slope sheet's exact pixels:

- **Same range:** 43% of pixels, and within one range for 69%.
- **Thresholds:** 87% at 35%, 89% at 40% and 91% at 60%.
- **Drawn split:** the 20% split matches the sheet's exact drawn/not-drawn mask on 85% of 8.9 M
  pixels.
- **Bias:** it reads the 60%+ share low, 38% against the sheet's 42%.

Exact pixels are the lossless tile, the not-drawn mask and the lossless 95+ mask, so steep
ground is over-represented in that score. This is one sheet pair. Assignment on the supplied sheet: 118 lines
labelled, 386 inferred and 351 left out, mostly fragments under a point long or beyond the
labelled area.

## What each sheet gives the road tools

| Sheet        | Becomes               | Used by                                                                                                                                                                                   |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field layout | Terrain (when chosen) | Every analysis view: profiles, sections, cut/fill and quantities, route searches and grade limits, skid reach, cable lines, sight distance. Slope anywhere is computed from this surface. |
| Slope        | Reference class layer | Point readings, block summaries with exact, estimated and **From terrain** columns. No road tool reads it: route search and skid reach take slope from the terrain.                       |
| Canopy       | Reference class layer | Point readings and block summaries. Nothing else reads it yet: not extraction reach, cable volume or the canopy background.                                                               |

So the LiDAR-derived terrain is a design input; the slope and canopy maps are for reading and
comparing. Wiring either into a design check (a slope-class screen beside the terrain's, canopy
height in extraction or cable volume) would be a new, separately validated feature.

## Against a regional DEM along mapped roads

`compare-road-terrains.ts` runs each road of a project through the engine twice: on the project's
own terrain and on the field sheet's contour surface. It compares the ground along the centreline
and scores each station's terrain slope against the range the slope sheet prints there (within one
printed range, the reading the sheet's own colours support). The supplied project's roads were
imported from the licensee's shapefiles onto the regional Terrarium DEM (zoom 12, about 22 m, mixed
sources, datum unverified). They carry no vertical design, so their "design" follows the ground,
and cut, fill and cost differences mostly follow coverage, not a better design.

| Road (length) | Covered: DEM / contours | Ground offset, contours − DEM | Grade change per station: DEM / contours | 90th-percentile ground grade | Within one slope range: DEM / contours  |
| ------------- | ----------------------- | ----------------------------- | ---------------------------------------- | ---------------------------- | --------------------------------------- |
| A (3,578 m)   | 81% / 16%               | +1.2 ± 5.0 m                  | 3.4 / 11.1 points                        | 18% / 43%                    | 48% / 38% (94 stations)                 |
| B (2,936 m)   | 99% / 97%               | −0.8 ± 3.2 m                  | 2.7 / 5.7                                | 17% / 23%                    | 62% / 70% (324)                         |
| C (255 m)     | 100% / 92%              | −1.1 ± 7.2 m                  | 3.1 / 12.3                               | 27% / 44%                    | 50% / 50% (32)                          |
| D (698 m)     | 79% / 97%               | −7.4 ± 5.8 m                  | 3.4 / 8.5                                | 20% / 33%                    | 46% / 56% (80)                          |
| E (494 m)     | 100% / 100%             | −2.6 ± 3.7 m                  | 3.2 / 6.6                                | 19% / 30%                    | 53% / 66% (62)                          |
| F (451 m)     | 100% / 100%             | −3.0 ± 2.7 m                  | 3.6 / 4.9                                | 27% / 31%                    | 64% / 64% (53)                          |
| G (1,409 m)   | 93% / 0%                | —                             | —                                        | —                            | — (a neighbouring block, off the sheet) |

What it shows:

- **Slope where it matters agrees better.** Over the 645 stations both terrains cover, the contour
  surface's slope was within one printed range of the LiDAR slope sheet at 62% of stations against
  the DEM's 57%, and better or equal on five of six roads. Road A is the exception, and most of it
  runs into the blank north-east, so few of its stations are on contours at all.
- **The contour surface sits lower, mostly by a constant.** See **Why the surfaces differ in
  height** below: about 1.5 m of it is the same everywhere, which is how a datum difference looks.
- **Valleys and ridges differ most.** The 22 m DEM fills valleys and shaves ridges: road D's valley
  is 15–20 m deeper on the contour surface, which is the −7.4 m mean.
- **Contour ground grades are rougher than the DEM's.** Station-to-station grade change is 1.4–4
  times the DEM's and the 90th-percentile grade is higher; medians are close. Part of it is the
  terraces, part is real ground the 22 m DEM smooths away: the slope sheet, the LiDAR reference,
  agrees better with the contour surface than with the DEM, so the roughness is not simply error.
  Route searches read grade through `groundTrend.ts`'s 12 m mean; profiles and Review rows read
  each station, so check a single steep station against the profile around it.
- **Coverage decides.** The surface covers only where the field sheet's labelled contours reach:
  one road loses most of its length and one is off the sheet. The DEM covers everything, coarsely.

Use the contour surface for alignment and grade work inside its coverage and keep the regional DEM
for context beyond it. One project and one sheet pair, November 2026; the 22 m DEM is a screening
source, not a reference.

### Why the surfaces differ in height

The contour surface was compared with the regional DEM at 6,780 points on a 25 m grid where both
exist, with the canopy sheet's class at each point and the point's height against a 100 m ring
around it (topographic position). Median offset (contours − DEM): −1.7 m.

| Canopy at the point   | Points | Median offset |
| --------------------- | ------ | ------------- |
| Under 5 m (not drawn) | 4,027  | −1.4 m        |
| 5–10 m                | 903    | −2.0 m        |
| 10–20 m               | 1,306  | −2.4 m        |
| 20–30 m               | 301    | −2.1 m        |
| 30 m and over         | 243    | −2.5 m        |

A least-squares fit gives offset = −1.50 m − 0.038 × canopy height + 0.16 × topographic position
(95% intervals −1.69 to −1.31 m, −0.056 to −0.021, 0.15 to 0.18; it explains 6% of the scatter).

- **Mostly a constant.** Open ground already sits −1.4 m (−1.8 m on open mid-slopes), so the
  regional DEM reading the canopy as ground is not the main cause. A near-constant 1.5 m is what a
  vertical datum or geoid-model difference looks like. Neither source states its datum, so this is
  an assumption to confirm, not a correction to apply.
- **Canopy adds little and not robustly.** Under 30 m+ canopy the offset grows by about 1 m, but
  the canopy term changes sign when only exact canopy pixels are used.
- **Position is the DEM's smoothing.** Points above their surroundings sit higher on the contours,
  points below sit lower: 22 m cells shave ridges and fill hollows.

Working assumption: treat the two surfaces as about 1.5 m apart vertically, contours lower, before
comparing elevations, and never mix them in one design without stating both datums. Grades and
slopes are unaffected by a constant.

### Interpolation between contours

`contourSurface` takes `method`. The default `tin` is the Delaunay surface of the contour vertices.
`nearest-contours` (opt-in, `CONTOUR_METHOD=nearest-contours` in the check scripts) gives each cell
the height between its nearest even-step and odd-step contours, weighted by distance, found with
two exact distance transforms (`nearestSeeds`). It removes the terraces but leaves kinks where the
nearest line point jumps, and it measured worse on every score:

| Score                                  | TIN (default) | Nearest-contours |
| -------------------------------------- | ------------- | ---------------- |
| Slope sheet exact pixels, same range   | 43.4%         | 42.7%            |
| Within one range                       | 69.1%         | 67.4%            |
| 35% / 40% / 60% splits                 | 87 / 89 / 91% | 85 / 86 / 88%    |
| Road stations within one range (645)   | 62%           | 52%              |
| Grade change per station, longest road | 5.7 points    | 12.2 points      |

So the TIN stays. A better surface would need an interpolator validated the same way against the
slope sheet before it replaces the TIN.

## Image and measurement limits

Canopy height, slope classes, ortho and hillshade in these PDFs are rendered colour images.
The class pass recovers their published ranges where the source retains them. These are not
the original CHM, DTM or point cloud, and do not supply precise heights or slopes. Use the original
numeric rasters or LAS/LAZ for calculations. A preview is placed by its four registered
corners, rather than being resampled as an analytical raster into Web Mercator.

Registration fit is the residual of the PDF's own control points, **not positional accuracy**.
Drawing coordinates and curves carry the precision of the published sheet. Curves flatten
within 0.1 PDF point (bounded recursion); paths are not smoothed or snapped to terrain.
Adjacent blocks and roads remain part of their source layers. A feature's map colour does
not prove which block or road status it belongs to.

| Limit                               | Enforcing constant                                               | Behaviour                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| PDF file                            | `PDF_LIMITS.bytes`: 64 MB                                        | Refused before reading                                                                                 |
| Pages                               | `PDF_LIMITS.pages`: 8                                            | Refused                                                                                                |
| Map frames                          | One registered rectangular frame per page                        | Multiple frames refused; unregistered pages named in notes                                             |
| Registration residual               | `PDF_LIMITS.registrationErrorM`: 3 m                             | Refused; not a source-accuracy threshold                                                               |
| Drawing operations per page         | `PDF_LIMITS.operators`: 750,000                                  | Refused                                                                                                |
| Extracted vertices per page         | `PDF_LIMITS.vertices`: 250,000                                   | Refused                                                                                                |
| One extracted layer / saved project | `MAX_REFERENCE_FEATURES`: 500; `MAX_REFERENCE_VERTICES`: 50,000  | Oversized PDF layers left in the preview with a notice; a saved project's aggregate limits still apply |
| Sheet preview                       | `PDF_LIMITS.previewSide`: 1,400 pixels on the longer side        | Display JPEG, separate from source measurement resolution                                              |
| Native class raster                 | `PDF_LIMITS.rasterCells`: 16,777,216 cells                       | Refuse oversized grid; never silently downsample analysis                                              |
| Source class images including masks | `PDF_LIMITS.rasterImages`: 32                                    | Refuse oversized extraction                                                                            |
| Saved compressed raster             | `PDF_LIMITS.rasterCompressedBytes`: 8 MB                         | Reject oversized payload                                                                               |
| Lossless RGB radius                 | `PDF_LIMITS.losslessColorDistance`: 2                            | Reject distant colours                                                                                 |
| JPEG colour fallback                | `PDF_LIMITS.lossyColorDistance`: 24; `colorSeparation`: 12       | Only when a JPEG tile cannot be decoded; named in the grid notes                                       |
| Decoder passes                      | `DECODE_SWEEPS`: 4                                               | About 3–8 s a tile in the worker; 3 → 12 passes moved the calibration by 0.2–0.4 points                |
| Decoder coefficients                | `MAX_USEFUL_STEP`: quantization steps up to 254                  | Coefficients at the largest step are skipped                                                           |
| Contour vertices                    | `PDF_LIMITS.contourVertices`: 3,000,000                          | No surface, with a notice; contours stay in the sheet preview                                          |
| Contour label on its line           | `LABEL_ON_LINE_PT`: 1 point; `LABEL_MARGIN_PT`: 0.5              | Label ignored                                                                                          |
| Contour TIN triangle                | `CONTOUR_TIN_MAX_EDGE_M`: 200 m; rise at most one interval       | Left empty (missing terrain)                                                                           |
| Contour surface                     | 2 m cells, grown until 4,194,304 cells (`MAX_ROAD_RASTER_CELLS`) | Cell size stated in the import notice                                                                  |

Contours never become a reference layer: they exceed the reference budget, and they stay
visible in the sheet preview. The import dialog can also refuse an aggregate selection that
would exceed the existing project's feature or vertex budget; deselect a layer or use a
separate project. Workbooks, report narratives and photographed/scanned PDFs are not
interpreted by this adapter. An unregistered scan can use the separate georeferencing tool.

## Supported templates

| Profile (`profiles.ts`)               | Sheets read                                                                      | Measured                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Canfor · ArcGIS map sheets (2026, v1) | Field layout, ortho, general access, hillshade, slope, canopy height (revisions) | This guide's figures: class splits, JPEG calibration, contour slope, road comparison (Nov 2026) |

## Supporting another company/template

Everything the reader assumes about a company's sheets is its profile: layer rules, class rasters
and their legend geometry, contour conventions and the colour under transparent pixels.
[map-pdf-profiles.md](map-pdf-profiles.md) is the step-by-step: inspect the sheets with
`scripts/forestry/inspect-map-pdf.ts`, write the profile, try it as a draft with `--profile`, check
it against the company's own data, then ship it with fixtures and tests. Moving Canfor's rules into
its profile left every supplied sheet's output byte-identical.

Tests: `src/lib/geoPdf/geoPdf.test.ts` uses a generated map with known projected coordinates,
clipped legend content, a reserve hole and compound streams. `jpegDecode.test.ts` reads a
synthetic Pillow JPEG (with and without restart markers) against jpeglib's coefficients and
checks the decoder beats the nearest colour on area shares. `contours.test.ts` builds a plane's
contours with a wrong label and a spot height. `contourTerrain.test.ts` covers the datum
question, the terrain role and slope ranges. The optional `PGMAPS_CANFOR_MAPS=/local/Maps`
reads the supplied real sheets without copying them.
`tests/e2e/forestry-road-geopdf.spec.ts` (with `PGMAPS_CANFOR_MAPS` and `PGMAPS_CANFOR_BLOCK`, the block shapefile's stem, for the real sheets) exercises the actual browser worker, absence of upload,
dialog, image map source and browser persistence. `PGMAPS_CANFOR_PDF=/local/sheet.pdf` also
renders a real local sheet into the test's ignored output directory for visual inspection.
No automatic browser workflow is added.

### Reproduce the source and compression checks

These commands read the local originals and write only to `/tmp`. The app needs no Python;
the optional compression experiment uses PyMuPDF and Pillow locally.

```sh
PGMAPS_CANFOR_MAPS=/local/Maps npx vitest run src/lib/geoPdf
npx tsx scripts/forestry/check-pdf-rasters.ts /local/Maps /local/Shapefiles/block.shp /tmp/pdf-class-report.json
python3 scripts/forestry/pdf-jpeg-calibration.py /local/Maps /tmp/pdf-calibration
npx tsx scripts/forestry/check-pdf-jpeg-calibration.ts /tmp/pdf-class-report.json /tmp/pdf-calibration
npx tsx scripts/forestry/check-pdf-contour-slope.ts /local/Maps/Field_Layout.pdf /local/Maps/Slope_Map.pdf /tmp/contour-slope.json
```

```sh
node --use-env-proxy --import tsx scripts/forestry/compare-road-terrains.ts /local/project.road.json /local/Maps/Field_Layout.pdf /local/Maps/Slope_Map.pdf /tmp/road-terrains.json
```

The road comparison fetches the project's regional DEM tiles like the app does. `SWEEPS=n` before
the calibration command changes the decoder's passes. The figures above come
from these commands on the supplied sheets, November 2026.

### Method references

- [WebPlotDigitizer extraction workflow](https://automeris.io/docs/digitize/): mask the relevant
  region, calibrate its coordinates and reject colours outside a tolerance. We use its documented
  workflow as a reference; no implementation code was copied.
- [GDAL raster PDF driver](https://gdal.org/en/stable/drivers/raster/pdf.html): independently
  selectable PDF layers and raster-only rendering support separating imagery from page furniture.
- [Esri PDF export](https://doc.esri.com/en/arcgis-pro/latest/help/sharing/overview/pdf-export.html):
  JPEG compression loses information; Deflate preserves it. A company can make future imports
  much more useful by exporting these class rasters losslessly, or providing their native grids.
- JPEG restoration by projection onto convex sets (Zakhor 1992; Yang, Galatsanos and
  Katsaggelos 1993) constrains a decoded image to the stored coefficients' quantization bins.
  The decoder uses that constraint with a known palette in place of a smoothness prior.
- [Deep Colormap Extraction from Visualizations](https://arxiv.org/abs/2103.00741): colour-map
  recovery is an established inverse-graphics problem. Our known-template adapter uses the
  actual printed palette and image objects rather than inferring an unknown palette or
  introducing a learned model.

RustGIS's current [format guide](https://github.com/opengeos/RustGIS/blob/main/docs/user-guide/data-formats.md)
does not provide this native web PDF reader; formats requiring external GDAL are desktop/CLI
only. GDAL itself supports [geospatial PDF vectors](https://gdal.org/en/stable/drivers/vector/pdf.html),
but a GDAL/WASM distribution needs a compiled PDF backend to offer that driver. Merely adding
a GDAL wrapper or RustGIS does not establish browser PDF support.
