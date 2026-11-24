# Company source-map imports

**Layers → Add files / Add folder**, or a drop anywhere on the designer, accepts the Canfor ArcGIS Pro PDF templates represented by
a supplied block's August/September 2026 field layout, ortho, general access, hillshade,
slope and canopy-height sheets, including their revised PDF. Any other georeferenced map PDF is
read with fewer steps (see **Sheets no profile recognizes**). This is a client-side reader:
PDF bytes, extraction and preview rendering stay in a dedicated browser worker. It uses
Mozilla PDF.js (Apache-2.0) and pdf-lib (MIT), loaded only for a PDF import. There is no
conversion server, upload, Python, installed GDAL or RustGIS requirement.

## What importing does

1. Pair GIS sidecars as before. Read a PDF's ISO geospatial viewport, projected WKT,
   normalized local controls and latitude-first geographic controls. Fit in the declared
   metre-based projection, then transform extracted points to WGS84 using that projection.
   Refuse missing or inconsistent registration or multiple map frames.
2. Match the named layer vocabulary with the versioned company profile in
   `src/lib/geoPdf/profiles.ts`; a sheet no profile matches is read by the generic profile
   instead (see **Sheets no profile recognizes**). The Canfor profile recognizes exact map-layer families for
   block outlines, roads, streams, reserves, field lines and contours. Label and legend layer
   names do not match those rules. Clip recovered geometry to the registered map frame and
   supported rectangular drawing clips. Preserve polygon holes. Non-rectangular clips stay
   in the sheet image and are counted in an import notice.
3. Read supported slope/canopy image layers at their original embedded pixel dimensions.
   Match printed legend text to its vector swatches. Lossless tiles are classified by colour;
   JPEG tiles by the coefficient decoder. The transparency mask is read exactly in both. Build
   a registered byte class grid. This never reads the reduced JPEG sheet preview. See
   **Class rasters** below.
4. Read the sheet's hillshade and ortho imagery as image layers at their own pixels, the tiles
   kept exactly as the PDF stores them. See **Image layers** below.
5. Build a terrain surface from the field sheet's labelled contours, offered only as terrain.
   See **Terrain from contours** below. Whenever an import recognizes contours, the review opens
   with an **Elevation found** box at the top holding every terrain choice: use the contours as
   the terrain (the same tick as that layer's row), fill past them, and, when the same import
   holds a hillshade, read the ground between the contours from it (off by default). See
   **Relief between contours from the hillshade** below.
6. Show a review dialog with a checkbox and permitted role for each recovered layer. A PDF
   drawing starts as **Reference**. A line layer can explicitly become proposed roads, and a
   polygon layer can explicitly become planned blocks. A GIS record of several separate lines
   (a road shapefile holding a road and its spurs under one name) loads one road per line,
   named "(part _n_)", and the row says how many; a PDF drawing of several pieces is one
   painting operation, not a record, and stays reference. A sheet image and compound
   stream drawing, a class raster and an image layer stay reference. A contour surface can only be
   **Terrain (replaces current)**. The profile does not infer planned/constructed road status,
   stream class, reserve restrictions or legal meaning from colour and symbols.
7. For several PDFs, initially select the field-layout sheet if present, otherwise the first
   sheet. Initially select its bounded geometry only when native GIS layers were not supplied.
   Select the first class raster of each kind, and the first hillshade, even when native GIS
   files are supplied; ortho imagery is offered unticked, because the plan's Satellite basemap
   shows the same source. Where two sheets offer the same raster, the one whose registration
   points fit tighter is the one ticked (see **Re-saved copies** below). The
   contour terrain starts selected over the sample, training and regional terrains, and over
   any terrain that does not cover the roads and blocks coming in; an imported terrain that
   covers them stays unless the person picks the contours. While a terrain is selected,
   **Prepare 1 m DEM download boxes** starts off. Other sheets and recovered layers remain
   available to select. A PDF identical (by SHA-256) to one already read is skipped before it
   is read and named in the notes; an original is read before a copy ("x - Copy.pdf",
   "x (1).pdf", "Copy of x.pdf"), so the copy is the one left out. A note several files share
   (the PDF drawings' attribute caveat) prints once, naming the files. A numbered road naming another block beside a canonical block
   shapefile is left unselected for review. Different revisions are never collapsed because
   their filenames resemble each other.
8. Save accepted source references with the project: file path, SHA-256, page, original layer,
   profile version and registration-fit residual. **Layers** exposes these and original scalar
   GIS attributes. Project and reference GeoJSON round trips keep them. The bounded JPEG sheet
   preview, PNG class display, compressed native class grid and image-layer tiles are embedded too;
   reloading needs no access to the original PDF. Original PDFs are
   not embedded. Reference-sheet visibility follows its layer's eye and **Fit all layers**.

A stream layer is a `MultiLineString` of recovered drawing paths. It does not imply that a
dash, a branch or a whole PDF painting operation was an original stream record, and it does
not join gaps. Original GIS record boundaries and attributes cannot be recovered from these
sheets. Copying a recovered simple road into a design samples the selected terrain through
the existing road workflow. Reference data do not change crossings, constraints, volumes or
terrain by themselves; only an accepted contour surface replaces the terrain.

## Re-saved copies

A sheet that was opened, marked up and saved again by another program is still read, with two
differences the import notes state.

- **Its registration points can be rounded.** macOS Preview writes them as single-precision
  numbers: the supplied re-saved slope sheet's longitudes lost their last digit (−121.54739 became
  −121.5474), its frame corners moved 1.5–2.1 m and its fit residual rose from 0.08 m to 1.21 m. A
  residual above 0.5 m (`PDF_LIMITS.registrationNoticeM`) is named in the notes; above 3 m the
  sheet is still refused. When another sheet in the same import shows the same frame (every corner
  within `SAME_FRAME_M`, 10 m) and fits more than `REGISTRATION_PREFERENCE_M` (0.3 m) tighter, the
  notes say which sheet sits off, and a class raster or image layer both offer is taken from the
  tighter one (`preferTighterRegistration`, `referenceImport.ts`). Nothing is dropped or moved:
  the person can still tick the copy's layers.
- **Its image tiles are found through the file's own cross-reference table.** Preview copies every
  object of the file it opened, including the original's object streams, which nothing refers to
  any more and which still carry the original's object numbers. pdf-lib reads a file front to back
  and unpacks every object stream it meets, so those stale numbers replaced the real image objects:
  the JPEG tiles were read as lossless, 60% of the supplied copy's slope grid went "colour outside
  the legend tolerance", and the exact 95+ mask over those tiles went unknown with it.
  `deadObjectStreams.ts` renames an object stream only in a file whose cross-reference chain is
  classic tables throughout, where no compressed object can be in use (ISO 32000-1, 7.5.8), and
  only in the copy pdf-lib reads. The supplied copy now gives the same class grid as its original,
  cell for cell. The tiles themselves were never changed by the re-save: the same JPEG bytes.

A tile stored losslessly whose colours are not the legend's was compressed before it was stored (a
program that re-encodes images on save). When more than `PDF_LIMITS.damagedTileShare` (25%) of a
lossless tile's drawn pixels miss every legend colour, the tile is read as a JPEG without its file:
by colour match, as estimates, with a note naming the tile. The original export reads better.

## Image layers

A sheet's hillshade and ortho imagery are image layers of their own (`imageMosaic.ts`,
`ImageLayerProfile` in the profile). The sheet preview is one picture of the whole page, capped at
1,400 pixels, with roads, contours and labels drawn into it. An image layer is the raster alone,
at the pixels the PDF holds:

| Supplied sheet | Layer         | Pixels        | Ground pixel | Tiles  | Stored |
| -------------- | ------------- | ------------- | ------------ | ------ | ------ |
| Hillshade      | Hillshade     | 3,637 × 3,004 | 0.85 m       | 4 JPEG | 2.8 MB |
| Field ortho    | Ortho imagery | 3,061 × 4,181 | 0.85 m       | 6 JPEG | 2.5 MB |

Against the preview's 2.2 m (hillshade) and 2.5 m (ortho) a pixel. Both sheets' tiles are
high-quality JPEG (luma DC step 6, no chroma subsampling).

- **Tiles are kept as stored.** A JPEG tile is the PDF's own JPEG file, passed through without
  decoding, so nothing is compressed a second time. Lossless pixels are written as PNG. A tile
  drawn through a mask, or a JPEG that is not grey or three-colour, is decoded and written as PNG.
- **Placement is the class rasters'.** Tiles must share one pixel grid at whole-pixel offsets
  (`mosaicPlacement`); otherwise the layer is left in the sheet preview, with a notice. The plan
  draws one image a tile, placed by that tile's own four corners.
- **Tiles are whole.** The export's tiles run a few metres past the map frame (2.5 m on the
  supplied sheets), and the layer shows them to their edges.
- **A picture, not a measurement.** No height, slope or shade value is read from an image layer.
  It cannot be a block, a buffer source, a vehicle source or terrain. Its one other use is a block
  map sheet's hillshade base ([Block map sheets](../forestry-block-map-sheets.md), **Rasters from
  an imported map sheet**).

## Class rasters

In **Layers**, expand **Canopy height classes** or **Slope classes**, then its feature.
Choose an imported/drawn block under **Area to summarize** and **Summarize mapped classes**.
Make the class layer visible and click the plan in **Inspect map** to read a published range.
A slope sheet is also set beside each road's estimate: Review's **Ground as steep as the slope
sheet shows** row and the report package's **Slope sheet** option compare area shares along a
strip either side of the road, never one pixel, and never change a quantity (see
[Exports](exports-and-project-files.md), **Report package**). On the supplied block the
estimate's ground showed 7–11 points less 60%+ ground than the sheet on every road, and up to
30 points less on single 200 m stretches.
Visibility follows the layer eye; the plan legend shows the source palette. The class layer is
drawn at the grid's own pixels (`classDisplayRgba`; a grid longer than
`PDF_LIMITS.classDisplaySide`, 4,096, on a side is sampled down to it). Lossless matches draw
solid, JPEG estimates faded, and not-drawn cells are transparent. The source-sheet preview is a
separate layer, so hide it to see the classified layer alone.

### How estimates are drawn

A JPEG estimate is drawn, and answered in **Inspect map**, as the commonest estimated class of
its 10 m cell (`ESTIMATE_DISPLAY_CELL_M`, `displayCells`): 12 × 12 native pixels on the supplied
sheets. Only estimated pixels are repainted, so exact classes and the exact not-drawn mask keep
their own pixels. Area summaries, the slope-sheet check and the saved grid read the stored
per-pixel estimates, never the display.

This is a statement about the cell, not about each pixel in it. On the calibration tiles:

| Reading                                              | Slope: stored pixel | Slope: 10 m cell | Canopy: stored pixel | Canopy: 10 m cell |
| ---------------------------------------------------- | ------------------- | ---------------- | -------------------- | ----------------- |
| The true commonest class of the 10 m cell            | 44%                 | 80%              | 36%                  | 71%               |
| Within one class of it                               | 68%                 | 92%              | 66%                  | 95%               |
| The true class of the single pixel                   | 54%                 | 48%              | 45%                  | 44%               |
| Within one class of the single pixel                 | 81%                 | 73%              | 72%                  | 81%               |

So the drawn cell says what the ground is mostly like within 10 m, and is right about that four
times in five for slope. It is no better than a coin toss at one 0.85 m pixel, which was already
true of the pixel estimates it replaces on the map. The point query prints both: the cell's class,
and the pixel's own estimate where it differs.

Measured and not adopted: a majority filter at the native pixels. A 3 × 3 window read the single
pixel right 58% of the time (slope) and 52% (canopy), against 54% and 45% unfiltered; wider windows
gained less, and at 9 × 9 slope fell below the unfiltered estimate. A few points at the pixel still
leave a speckled map that reads as detail the file does not hold.

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

Choose **Terrain (replaces current)** in the import dialog. The sheet prints no vertical datum.
A company profile can state the datum and units its sheets are taken to use
(`ContourConventions.assumedVerticalDatum`, `profiles.ts`): **Elevation found** then offers
**Heights in metres, vertical datum … (assumed)** ticked, with the profile's reason, and the import
asks nothing. The terrain's vertical reference records it as "…; assumed, the sheet prints no datum"
(`assumedDatumReference`), and the import notice repeats it. The Canfor profile assumes CGVD2013
(CGG2013) in metres for every contour surface it reads: the field sheet's legend states the 10 m
interval in metres, the hillshade sheet's does not but draws the same contours, and BC's LiDAR
specification delivers CGVD2013. Untick it, or import a profile without one, and the existing
terrain question asks; the open terrain's datum is never reused. The surface becomes an ordinary
terrain raster (`contourTerrain.ts`), id ending `-contours`.

### Filling past the contours

A sheet's contours stop at its frame, and an access road usually runs off it: on the supplied
block the main road had ground under 16% of its length. **Fill past the contours from the
regional DEM** (under **Elevation found**, on by default) widens the grid to the roads and blocks being
imported plus 100 m and takes every cell the contours leave missing from the regional Terrarium
DEM (`fillBeyondContours`). The contour cells are copied unchanged on the same grid lines. The
two surfaces are **not shifted** to meet (their datums are not known to agree; see **Against a
regional DEM along mapped roads**), so a step of a metre or two can show where they join, and
the import notice says so.

The widened grid keeps the sheet's whole area when that fits the road terrain's cell limit
(`MAX_ROAD_RASTER_CELLS`) at 2 m; else it is cropped to the roads and blocks; only then do the
cells grow in 0.5 m steps (the contours resampled bilinearly), which the notice states. On the
supplied block the roads and block span about 3.8 × 4.7 km, so the cells are 2.5 m. The
terrain's name gives the filled share, its vertical reference adds "cells beyond the contours:
regional DEM, datum unverified", and `terrain.fill` records the source, its cell size and the
share. Review's **Terrain fit for site quantities** row judges the terrain by the fill's cell
size too: a grid that is two-thirds 22 m regional cells needs attention. A failed regional
read leaves the contours alone, with the missing ground named in the notice.

With no roads or blocks in the same import, the fill still runs over the sheet's own area, filling
its gaps, so the terrain is marked as filled (`terrain.fill`).

A road drawn, copied or imported after that can run past the filled grid. The workspace fills
under it automatically (`roadsPastGrid`, `contourTerrain.ts`): whenever the terrain is a filled
contour terrain and a design road comes within 5 km of the grid and runs past its edge (or within
its section reach of it), the same widening runs for those roads as its own undo step. It runs once
for each set of roads, so Undo stays undone; a refusal (too far, too wide) is named in a notice.
A contour terrain imported with the fill unticked is never filled unasked:
Review's **Ground and design known at every section** row then offers **Fill from the regional
DEM** as its action, whenever the terrain is a contour terrain and a station has no ground under
it or across its section (`readiness.ts`, target `regional-fill`). It runs the same `fillBeyondContours` for the road in Review, as one undo step, with two
differences from the import: the grid the terrain has is never cropped, because other roads stand
on it, and when keeping it would need cells more than twice as coarse the fill is refused with the
reason (the road runs too far from the sheet; load a terrain that covers it). Cells an earlier fill
took are copied as they are and still counted in the filled share, and the name and vertical
reference keep one "regional DEM" note. A road wider than the regional DEM's 64-tile read is
refused by name.

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

## Relief between contours from the hillshade

A contour surface knows nothing finer than its interval: between two contours the ground is a
plane, and triangles on one contour are flat terraces. The same sheet set's hillshade was drawn
from the LiDAR the contours came from, at 0.85 m on the supplied sheets, and it holds the gullies
and benches in between. The import can put the two together (`hillshadeRelief.ts`).

Tick **Read the ground between the contours from the hillshade in *the sheet*** under **Elevation
found**. It is
shown when the import holds a hillshade image layer, and it is off by default: the result is an
estimate, and it takes the better part of a minute on a full sheet.

### How it works

A hillshade pixel is one measurement: the cosine of the angle between the ground's normal and the
sun. For ground rising p to the east and q to the north, under a sun at azimuth a and zenith Z,

    shade = (cos Z − sin Z (p sin a + q cos a)) / √(1 + p² + q²)

That is one equation for two slopes, so a hillshade alone gives no surface: only shape, and errors
that grow with distance. Tied to the contours it does. The labelled lines fix the heights, and
between two lines the shading says how the ground gets from one to the other.

1. **The hillshade is laid on the contour surface's cells** (`hillshadeOnGrid`): each 2 m cell
   takes the mean grey of the sheet's pixels under it. The two sheets must be in the same
   projection.
2. **The sun is read from the two together, and a picture that is not a plain hillshade is
   refused** (`fitHillshadeLighting`). Over ground the contours give a slope for,
   shade × √(1 + slope²) is linear in the two slopes: its constant is the sine of the sun's height
   and its slope terms point at the sun. Both are smoothed alike first, because the contours hold
   only the long shapes. The picture is refused, with the reason, when
   - it does not follow the contours' own shading (correlation under 0.6): another surface, or a
     multi-directional hillshade;
   - level ground reads outside a 20–80° sun;
   - the sun's fitted strength is more than 0.08 above, or 0.15 below, the cosine its height
     implies: a contrast stretch or a gamma curve. A plain hillshade's level-ground value and its
     change with slope are the sine and cosine of one angle, and a stretch breaks that pair.
3. **The surface is solved** as the one that reproduces the hillshade, passes through the contour
   lines, stays smooth where neither speaks, and stays near the plain contour surface where
   nothing pins it. It is a least-squares problem solved by Gauss–Newton, each step by LSQR without
   forming a matrix, at 8 m, 4 m and then 2 m cells, so the long shapes settle before the detail.
4. **It is bounded.** No cell ends more than one contour interval from the plain contour surface,
   which is all two neighbouring contours allow; the share held at that bound is stated. The
   change fades in over 10 cells from the hillshade's edge, so there is no step where the hillshade
   stops. Ground the contours leave empty stays empty: the hillshade fills nothing.

The terrain is named "Contours + hillshade · *file*", records `terrain.relief` (the hillshade
sheet, the share of cells refined, the median and 99th-percentile change), and Review's **Terrain
fit for site quantities** row says the ground between contours is an estimate. If the refinement
fails or is refused, the plain contour surface is used and the import notice says why.

### What was measured

Three checks: the supplied sheets against their own contours and slope sheet, the supplied
project's roads, and a public LiDAR tile where the true ground is known.

On the supplied sheets (`check-pdf-contour-slope.ts` with the hillshade sheet as its fourth
argument), the sun was read at 315.5°, 44.6° up, level ground at 179 of 255 (180 is a 45° sun),
with a correlation of 0.98: a plain, unstretched hillshade. Of the 1.71 million cells with ground,
93% lay under the hillshade and were refined, in 16 s. They moved 0.37 m at the median and under
5.4 m for 99 in 100; 0.04% were held at the 10 m bound.

**Heights, with contours held back.** The surface was rebuilt from the 20 m contours alone, with
and without the hillshade, and read at the 10 m contours left out, whose heights the sheet prints
(97,075 points, a cell apart along them):

| Surface                   | Median error | 90% within | 99% within | RMSE   |
| ------------------------- | ------------ | ---------- | ---------- | ------ |
| 20 m contours alone       | 0.98 m       | 3.8 m      | 10.0 m     | 3.22 m |
| 20 m contours + hillshade | 0.40 m       | 1.6 m      | 10.2 m     | 2.24 m |

The typical error falls by more than half. The worst places do not improve: about one point in a hundred
is still most of an interval out, where the sparse contours leave a terrace or a gap that the
shading cannot rescue. With every contour in, as the import uses them, those stretches are half as
long.

**Slope, with every contour, against the slope sheet's exact pixels** (2.4 million, the same pixels
for both):

| Surface              | Same range | Within one | 35 / 40 / 60% splits | Sheet's 60%+ ground found | Drawn split |
| -------------------- | ---------- | ---------- | -------------------- | ------------------------- | ----------- |
| Contours alone       | 43.4%      | 69.1%      | 86.8 / 88.9 / 90.9%  | 84.2%                     | 84.9%       |
| Contours + hillshade | 52.6%      | 79.9%      | 91.3 / 92.5 / 94.0%  | 91.4%                     | 91.8%       |

The 60%+ share reads 40.6% against the sheet's 41.8% (contours alone: 37.7%). This is the test a
new surface has to pass (**Interpolation between contours**): it beats the TIN on every score.

**Along the supplied project's roads** (`compare-road-terrains.ts --hillshade`), each station's
slope read in the sheet's ranges, within one range of what the slope sheet prints there:

| Road         | Stations | Regional DEM | Contours | Contours + hillshade |
| ------------ | -------- | ------------ | -------- | -------------------- |
| A            | 94       | 48%          | 38%      | 61%                  |
| B            | 324      | 62%          | 70%      | 78%                  |
| C            | 32       | 50%          | 50%      | 69%                  |
| D            | 80       | 46%          | 56%      | 59%                  |
| E            | 62       | 53%          | 66%      | 69%                  |
| F            | 53       | 64%          | 64%      | 76%                  |
| All six      | 645      | 57%          | 62%      | 72%                  |

Better on every road. The centreline also reads rougher: the ground grade changes 7.9 points from
one station to the next on road B against 5.7 on the contours alone, and more on the short spurs.
That is mostly the ground, not noise, as the next check shows. On road B the refined terrain's cut
and fill (8,475 and 6,647 m³) sit nearer the regional DEM's than the plain contours' do (6,908 and
4,467 m³), which under-read both by smoothing the hillside.

**Against real LiDAR** (`check-hillshade-relief-lidar.ts`). PGMaps' public 1 m tile near Prince
George was reduced to what a sheet set gives, 10 m contours and an 8-bit hillshade, then rebuilt
both ways and scored against the DTM it came from (448,000 cells of 2 m):

| Measure                                  | Contours alone | Contours + hillshade | True ground |
| ---------------------------------------- | -------------- | -------------------- | ----------- |
| Height error, median                     | 0.62 m         | 0.22 m               |             |
| Height error, 90% within                 | 2.4 m          | 1.2 m                |             |
| Height error, 99% within                 | 5.2 m          | 4.3 m                |             |
| Slope in the same class                  | 71.5%          | 81.2%                |             |
| Slope within one class                   | 88.1%          | 97.1%                |             |
| 60%+ ground found                        | 54%            | 81%                  |             |
| Grade over 10 m, mean error              | 6.1 points     | 3.1 points           |             |
| Change of grade from one 10 m to the next | 3.9 points     | 9.2 points           | 8.3 points  |

The last row is why the refined centreline reads rougher: real ground changes grade 8.3 points
from one 10 m step to the next, the contour surface shows less than half of that, and the refined
surface shows it with about a tenth too much. This test has no JPEG noise, no mislabelled contour
and no registration error; the sheets' own checks above carry those.

### Limits

- **It needs the contours.** The heights are the contours'. Where the sheet labels no contour the
  surface is empty and stays empty.
- **It is an estimate between contours.** Good for alignment, grades and a preliminary earthwork
  figure; not ground to stake or build from. The licensee's bare-earth DEM, or LidarBC's 1 m
  release, replaces it.
- **One sheet set.** The figures above are one block's sheets, November 2026. Another company's
  hillshade may be stretched, coloured or multi-directional; the checks refuse those rather than
  misread them, and a mild stretch under the tolerance would bias slopes without being refused.
- **Whatever the hillshade shows becomes ground.** An existing road bench, a LiDAR artefact or a
  misclassified building is read as terrain, as it would be in a LiDAR DEM.
- **The hillshade's pixels are JPEG.** High quality on the supplied sheets (luma DC step 6); the
  result reproduces the hillshade to about 7 grey levels of 255.

## Against public terrain

How the sheets compare with the terrain anyone can load for the same ground
(`compare-public-terrains.ts`): slope from each terrain, over its own cells, read in the slope
sheet's ranges and scored on the sheet's exact pixels. On the ground every terrain covers:

| Terrain                               | Same range | Within one | Sheet's 60%+ ground found |
| ------------------------------------- | ---------- | ---------- | ------------------------- |
| Field sheet contours + hillshade      | 52.6%      | 79.9%      | 91.4%                     |
| Field sheet contours (2 m surface)    | 43.3%      | 69.2%      | 84.4%                     |
| BC CDED (0.75″ posts, about 14 × 23 m) | 32.5%      | 57.6%      | 78.9%                     |
| Regional Terrarium (22 m)             | 29.9%      | 56.7%      | 78.9%                     |
| NRCan MRDEM-30                        | 26.2%      | 51.8%      | 74.1%                     |

(The first row is the whole-sheet figure from the table above; the others are on 150,318 sampled
pixels where all four terrains have ground.)

- **Every public terrain finds most of the steep ground**, so each is a fair screen for whether a
  hillside is steep. None places a slope class well: right about three times in ten.
- **Whole-sheet scores flatter the public terrains** (53–57% in the same range), only because they
  cover the flat north-east, where the contour surface is empty and everything reads under 20%.
- **Heights.** Against the contour surface, Terrarium sits 0.9 m higher at the median, CDED 1.4 m
  and MRDEM 0.8 m, and the middle 90% of the differences run about ±10 m (−12 to +16 m for MRDEM):
  coarse cells shave ridges and fill draws. Against laser ground points, the contour surface was
  0.28 m low and Terrarium 0.97 m high
  ([Open canopy and satellite LiDAR](../research/open-canopy-and-satellite-lidar-2026-11-18.md)).
- **No public LiDAR covers the supplied block.** LidarBC lists it as flown and unpublished, and
  NRCan's 1 m mosaic has no data there
  ([Terrain sources](../research/bc-road-terrain-sources-2026-11-12.md)). A hillshade worked out
  from a 14–30 m terrain shows cells, not ground.

The whole comparison, with the canopy sources, is written up in
[Map sheet rasters and public terrain](../research/map-sheet-rasters-and-public-terrain-2026-11-18.md).

## What each sheet gives the road tools

| Sheet        | Becomes               | Used by                                                                                                                                                                                   |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field layout | Terrain (when chosen) | Every analysis view: profiles, sections, cut/fill and quantities, route searches and grade limits, skid reach, cable lines, sight distance. Slope anywhere is computed from this surface. |
| Slope        | Reference class layer | Point readings, block summaries with exact, estimated and **From terrain** columns, the LiDAR slope block map sheet, and the profile's **Map slope** row beside Sidehill ([Profile labels and bands](profile-labels-and-bands.md)). No road tool reads it: route search and skid reach take slope from the terrain. |
| Canopy       | Reference class layer | Point readings, block summaries, the canopy height block map sheet and the profile's **Map canopy** row. Nothing else reads it yet: not extraction reach, cable volume or the canopy background. |
| Hillshade    | Reference image layer | The plan, as a picture under the design, and the hillshade block map sheet. Its greys are read only when the **Elevation found** option asks for the ground between the contours.               |
| Field ortho  | Reference image layer | The plan, as a picture (offered unticked).                                                                                                                                                |

So the LiDAR-derived terrain is a design input; the slope, canopy and hillshade maps are for
reading, comparing and printing. Wiring a class raster into a design check (a slope-class screen
beside the terrain's, canopy height in extraction or cable volume) would be a new, separately
validated feature.

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
numeric rasters or LAS/LAZ for calculations. A preview, a class display and each image-layer tile
is placed by its four registered corners, rather than being resampled as an analytical raster into
Web Mercator.

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
| Class display                       | `PDF_LIMITS.classDisplaySide`: 4,096 pixels on the longer side   | Native pixels up to it; a larger grid's display is sampled down, its analysis grid is not              |
| Estimate display cell               | `ESTIMATE_DISPLAY_CELL_M`: 10 m                                  | Estimates drawn and queried as the cell's commonest class; summaries read the stored pixels            |
| Stored sheet or class display image | `PDF_LIMITS.sheetImageChars`: 12,000,000 base64 characters       | A project holding a larger one is refused on load                                                      |
| Image layer tiles                   | `PDF_LIMITS.mosaicBytes`: 12 MB a layer; `rasterImages`: 32      | Left in the sheet preview, with a notice                                                               |
| Registration residual named         | `PDF_LIMITS.registrationNoticeM`: 0.5 m                          | Import note; the sheet is still read                                                                   |
| Same frame, tighter registration    | `SAME_FRAME_M`: 10 m; `REGISTRATION_PREFERENCE_M`: 0.3 m         | Note naming the looser sheet; a raster both offer is ticked on the tighter one                         |
| Lossless tile off the legend        | `PDF_LIMITS.damagedTileShare`: 25% of its drawn pixels           | Tile read as estimates by colour match, with a note                                                    |
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
| Contour points kept                 | `MAX_ANCHOR_NUMBERS`: 2,000,000 points, a cell apart             | Further points are left out; the surface is built from every vertex regardless                         |
| Hillshade follows the contours      | `RELIEF.minFitCorrelation`: 0.6                                  | Refinement refused; the plain contour surface is used                                                  |
| Hillshade is unstretched            | `RELIEF.strengthAbove`: 0.08; `strengthBelow`: 0.15; sun 20–80°  | Refinement refused; the plain contour surface is used                                                  |
| Refined ground from the contours    | One contour interval                                             | Held at the bound; the share is stated                                                                 |
| Refinement at the hillshade's edge  | `RELIEF.taperCells`: 10 cells                                    | The change fades to nothing at the edge                                                                |
| Refinement levels and effort        | `RELIEF.levels`: 4, 2, 1 × the cell; `steps`; `iterations`       | A level stops early when no cell moves 0.02 m (`settledM`)                                             |
| Contour surface                     | 2 m cells, grown until 4,194,304 cells (`MAX_ROAD_RASTER_CELLS`) | Cell size stated in the import notice                                                                  |

Contours never become a reference layer: they exceed the reference budget, and they stay
visible in the sheet preview. The import dialog can also refuse an aggregate selection that
would exceed the existing project's feature or vertex budget; deselect a layer or use a
separate project. Workbooks, report narratives and photographed/scanned PDFs are not
interpreted by this adapter. An unregistered scan can use the separate georeferencing tool.

## Supported templates

| Profile (`profiles.ts`)                | Sheets read                                                                      | Measured                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Canfor · ArcGIS map sheets (2026, v1)  | Field layout, ortho, general access, hillshade, slope, canopy height (revisions) | This guide's figures: class splits, JPEG calibration, contour slope, road comparison (Nov 2026) |
| No company profile · named layers only | Any other registered sheet: its image and named map layers only                  | **Sheets no profile recognizes**                                                                |

## Sheets no profile recognizes

A registered sheet that no company profile recognizes is read by `genericProfile`
(`profiles.ts`), not refused. It knows no template, so it reads only what needs none:

- the registered sheet image, as for any sheet;
- each named optional-content layer's drawings, clipped to the map frame, under the layer's own
  name. A filled path is an area and a stroked one a line, because nothing else says what the layer
  holds; a layer drawn both ways comes in as two layers (`… · areas`, `… · lines`) that keep the
  one PDF layer name in their source. Every one starts unticked and as **Reference**, and may be
  made a proposed road or planned block only by the person, like any PDF drawing;
- only drawings made under the map frame's own clip (a rectangular clip within 2% of the
  registered frame), which is how map exporters draw a map. A legend, scale bar, title or
  attribution box laid over the map is not drawn under it, and is left on the sheet and counted in
  a notice. A sheet that draws nothing under its frame's clip brings in the sheet image alone.

It reads no class raster, contour terrain or image layer and assigns no role: each needs a
company's conventions, which only a profile states. A layer over its own budget is left on the
sheet with a notice; because the generic profile also reads base maps, one that would take the
page past `PDF_LIMITS.vertices` is left on the sheet the same way instead of refusing the import.
The first notice says no profile recognized the sheet and names the profiles that exist.

Measured on BCTS Prince George 5-year-plan overview sheets (ArcGIS Pro 3.1, BC Albers, November
2026): all 13 read in 1.6–3.1 s; the map's named layers came in and the legend, scale bar, title
and attribution boxes did not. One sheet's plan-area layer lay a median 0.3 m (largest 0.8 m) from
the same areas' shapefile edges, at a control fit of 0.24 m and about 10.6 m of ground per page
point. Paths under non-rectangular clips (most of the Esri topographic base map) stay on the
sheet, as for every profile.

## Supporting another company/template

Everything the reader assumes about a company's sheets is its profile: layer rules, class rasters
and their legend geometry, contour conventions and the colour under transparent pixels.
[map-pdf-profiles.md](map-pdf-profiles.md) is the step-by-step: inspect the sheets with
`scripts/forestry/inspect-map-pdf.ts`, write the profile, try it as a draft with `--profile`, check
it against the company's own data, then ship it with fixtures and tests. Moving Canfor's rules into
its profile left every supplied sheet's output byte-identical.

Tests: `src/lib/geoPdf/geoPdf.test.ts` uses a generated map with known projected coordinates,
clipped legend content, a reserve hole and compound streams, and a class tile stored losslessly in
off-legend colours. `deadObjectStreams.test.ts` re-saves the generated map with a leftover object
stream that carries a JPEG tile's number. `imageMosaic.test.ts` reads a generated hillshade as
lossless tiles and as one JPEG tile, through a project file and back. `classGrid.test.ts` pins the
10 m display cells and the point query on an estimate. `jpegDecode.test.ts` reads a
synthetic Pillow JPEG (with and without restart markers) against jpeglib's coefficients and
checks the decoder beats the nearest colour on area shares. `contours.test.ts` builds a plane's
contours with a wrong label and a spot height. `contourTerrain.test.ts` covers the datum
question, the terrain role, slope ranges and the record of a hillshade refinement.
`hillshadeRelief.test.ts` refines a generated hillside from its own hillshade and contours, and
checks the bound, the fade at the hillshade's edge and the refusal of a stretched picture. The optional `PGMAPS_CANFOR_MAPS=/local/Maps`
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
npx tsx scripts/forestry/check-pdf-contour-slope.ts /local/Maps/Field_Layout.pdf /local/Maps/Slope_Map.pdf /tmp/contour-slope.json /local/Maps/Hillshade_Map.pdf
node --import tsx scripts/forestry/compare-public-terrains.ts /local/Maps/Field_Layout.pdf /local/Maps/Slope_Map.pdf /tmp/public-terrains.json
```

The hillshade sheet is the contour check's optional fourth argument: with it the refined surface
is scored beside the contour surface and the held-out test is run. The public terrain comparison
downloads the regional tiles, two CDED half-sheets and an MRDEM window.

```sh
node --use-env-proxy --import tsx scripts/forestry/compare-road-terrains.ts /local/project.road.json /local/Maps/Field_Layout.pdf /local/Maps/Slope_Map.pdf /tmp/road-terrains.json --hillshade /local/Maps/Hillshade_Map.pdf
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
- Shape from shading (Horn 1970; Horn and Brooks, *Shape from Shading*, 1989): a surface's
  brightness under a known light constrains its slope. The hillshade refinement uses it with the
  contour heights as boundary values, which removes the method's usual ambiguity.
- LSQR (Paige and Saunders, *ACM Transactions on Mathematical Software* 8, 1982): the sparse
  least-squares solver each Gauss–Newton step uses, implemented here from the paper.
- [Deep Colormap Extraction from Visualizations](https://arxiv.org/abs/2103.00741): colour-map
  recovery is an established inverse-graphics problem. Our known-template adapter uses the
  actual printed palette and image objects rather than inferring an unknown palette or
  introducing a learned model.

RustGIS's current [format guide](https://github.com/opengeos/RustGIS/blob/main/docs/user-guide/data-formats.md)
does not provide this native web PDF reader; formats requiring external GDAL are desktop/CLI
only. GDAL itself supports [geospatial PDF vectors](https://gdal.org/en/stable/drivers/vector/pdf.html),
but a GDAL/WASM distribution needs a compiled PDF backend to offer that driver. Merely adding
a GDAL wrapper or RustGIS does not establish browser PDF support.
