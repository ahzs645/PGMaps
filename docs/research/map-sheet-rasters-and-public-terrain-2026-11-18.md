# Map sheet rasters, public terrain and ground from a hillshade (18 November 2026)

What a company's LiDAR map sheets give a road project, how that compares with the terrain and
canopy data anyone can load, and whether a hillshade picture can be turned back into ground.
Worked on "the reference block" of `bc-road-terrain-sources-2026-11-12.md`: a licensee block east of
Prince George with seven imported roads, a set of ArcGIS Pro map sheets (field layout, ortho,
general access, hillshade, slope, canopy height, and a marked-up copy of the slope sheet) and no
public LiDAR. The block's names, files and coordinates stay out of the repository. Every figure was
measured that day; the scripts are named with each.

The guides that carry the rules are
[Company source-map imports](../forestry-road-design/source-pdf-import.md),
[Profile labels and bands](../forestry-road-design/profile-labels-and-bands.md) and
[Block map sheets](../forestry-block-map-sheets.md).

## Short version

- **The sheets are the best data for the block, and more of them is usable than was being used.**
  The hillshade and ortho are 0.85 m pictures that the import was showing at 2.2–2.5 m with the
  linework drawn in; the class rasters were drawn at 1,400 pixels; none of it reached a printed
  sheet or a chart.
- **A marked-up copy read wrongly.** A sheet re-saved from macOS Preview lost 60% of its slope
  raster, because the PDF library unpacked object streams the file no longer uses.
- **Public terrain finds the steep ground and little else.** Three public DEMs put a slope in the
  right class about three times in ten, against four in ten for the sheet's own contours.
- **The hillshade can be turned back into ground, tied to the contours.** It is a plain,
  unstretched hillshade, so each pixel measures how the ground faces the sun. Read between the
  contours, it halves the typical height error and lifts slope within one class from 69% to 80%.
  On real LiDAR, where the truth is known, the median height error fell from 0.62 m to 0.22 m.
- **It is still an estimate.** One point in a hundred stays most of a contour interval out, it
  needs the contours for its heights, and it is one block's sheets.

## What the sheets hold

Read with `scripts/forestry/inspect-map-pdf.ts`.

| Sheet                        | Raster it holds                                               | Native pixels | Ground pixel |
| ---------------------------- | ------------------------------------------------------------- | ------------- | ------------ |
| Field layout                 | None (vector: contours, roads, streams, blocks)               |               |              |
| Hillshade                    | 4 JPEG tiles, high quality (luma DC step 6, no subsampling)   | 3,637 × 3,004 | 0.85 m       |
| Field ortho                  | 6 JPEG tiles, high quality                                    | 3,061 × 4,181 | 0.85 m       |
| Slope                        | 3 JPEG and 1 lossless class tile, plus 4 lossless mask tiles  | 3,637 × 3,004 | 0.85 m       |
| Canopy height                | 2 JPEG and 2 lossless class tiles                             | 3,637 × 3,004 | 0.85 m       |
| General access (1:50,000)    | None                                                          |               |              |
| Marked-up copy of the slope sheet | The slope sheet's tiles, byte for byte                   | 3,637 × 3,004 | 0.85 m       |

The class tiles' JPEG is very low quality (luma DC step 57, 4:2:0), which is why a class in a JPEG
tile is an estimate. The hillshade's and ortho's is high quality, which is why they can be used as
they are.

## What was wrong or unused, and what changed

| Finding                                                                                                   | Evidence                                                                                                                                                               | Change                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A re-saved copy reads its JPEG tiles as lossless                                                          | 60.2% of the grid estimated in the original, 0% in the copy; 44% of its exact cells lost with the 95+ mask; 6,024 JPEG pixels reported exact                            | `deadObjectStreams.ts`; the copy now gives the original's grid cell for cell                              |
| The same copy is registered 1.5–2.1 m off                                                                 | Preview wrote the registration longitudes in single precision; fit residual 1.21 m against 0.08 m                                                                      | The import notes say so, and a raster both sheets offer is taken from the tighter one                     |
| Hillshade and ortho exist only in a 1,400 px page preview                                                 | 2.2 and 2.5 m a pixel against 0.85 m native, with roads, contours and labels drawn in                                                                                   | Image layers at their own pixels, the stored JPEG tiles passed through (`imageMosaic.ts`)                 |
| Class layers drawn at 1,400 px by picking one pixel in 2.6                                                | Thin 95+ lines drop out                                                                                                                                                | Drawn at the grid's own pixels                                                                            |
| A JPEG estimate drawn per pixel is a coin toss                                                            | Right for 54% (slope) and 45% (canopy) of pixels on the calibration tiles                                                                                              | Drawn and queried as the commonest class of a 10 m cell; summaries keep the stored pixels                 |
| Block map sheets cannot use the sheet's rasters                                                           | The LiDAR slope, canopy and hillshade presets took only a terrain or canopy surface; their class ranges are the sheet's own                                            | They print from the imported sheet where the project has nothing finer (`pdfSheetRasters.ts`)             |
| Nothing in the charts reads a sheet                                                                       | The profile's bands had Sidehill from the terrain only                                                                                                                 | **Map slope** and **Map canopy** rows under Sidehill (`sheetBands.ts`)                                    |
| The contour surface is flat between contours                                                              | Terraces in its hillshade; slope within one class of the slope sheet at 69% of exact pixels                                                                            | Optional refinement from the hillshade (`hillshadeRelief.ts`)                                             |

### The 10 m cell: what it is worth

On the calibration tiles (a lossless tile re-encoded with a JPEG tile's own tables):

| Reading                                   | Slope: stored pixel | Slope: 10 m cell | Canopy: stored pixel | Canopy: 10 m cell |
| ----------------------------------------- | ------------------- | ---------------- | -------------------- | ----------------- |
| The true commonest class of the 10 m cell | 44%                 | 80%              | 36%                  | 71%               |
| The true class of the single pixel        | 54%                 | 48%              | 45%                  | 44%               |

The cell says what the ground is mostly like within 10 m. It is no better at one pixel. A majority
filter at the native pixels gained 4–7 points at the pixel (3 × 3) and lost them again by 9 × 9.

## Public terrain against the slope sheet

`scripts/forestry/compare-public-terrains.ts`. Slope from each terrain, by central differences one
of its own cells either way, read in the slope sheet's printed ranges and scored on the sheet's
exact pixels: its lossless tile, its not-drawn mask and its lossless 95+ mask.

On the ground every terrain covers (150,318 sampled pixels):

| Terrain                                | Same class | Within one | Sheet's 60%+ found | Terrain's 60%+ right |
| -------------------------------------- | ---------- | ---------- | ------------------ | -------------------- |
| Field sheet contours (2 m surface)     | 43.3%      | 69.2%      | 84.4%              | 93.4%                |
| BC CDED (0.75″ posts, about 14 × 23 m) | 32.5%      | 57.6%      | 78.9%              | 88.1%                |
| Regional Terrarium (22 m)              | 29.9%      | 56.7%      | 78.9%              | 88.8%                |
| NRCan MRDEM-30 DTM                     | 26.2%      | 51.8%      | 74.1%              | 85.6%                |

Each terrain over its own coverage (269,929 pixels for the public ones): Terrarium 56.0% in the same
class, CDED 57.3%, MRDEM 53.4%. Those are higher only because the public terrains cover the flat
north-east of the sheet, where the contour surface has no ground and everything reads under 20%.
The comparison that means something is the one on common ground.

Heights against the contour surface, at 9,989 points:

| Terrain            | Median  | Middle half      | Middle 90%         |
| ------------------ | ------- | ---------------- | ------------------ |
| Regional Terrarium | +0.90 m | −2.05 to +4.23 m | −10.6 to +10.4 m   |
| BC CDED            | +1.42 m | −1.50 to +4.62 m | −10.1 to +10.8 m   |
| NRCan MRDEM-30     | +0.76 m | −4.73 to +6.94 m | −12.3 to +16.2 m   |

Close on average, wrong locally by enough to matter for cut and fill: coarse cells shave ridges and
fill draws. Against laser ground points the contour surface was 0.28 m low and Terrarium 0.97 m
high (`open-canopy-and-satellite-lidar-2026-11-18.md`).

What reads the same in all of them: the hillside is steep, and each terrain finds about three
quarters of the ground the LiDAR calls 60% or more. None resolves a road bench. A hillshade worked
out from any of them shows cells, not ground.

### Other public sources at the block

From the two earlier write-ups, for the whole picture:

| Source                                | What it gave here                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| LidarBC 1 m DEM and point cloud       | Nothing published; flown in 2024 according to the status layer. A listed 1:20,000 sheet had no elevations under the roads      |
| NRCan HRDEM 1 m and 2 m mosaic        | No data at every sampled road point (12 November)                                                                             |
| ICESat-2 ground photons               | A 0.3 m check of any terrain's bias, on tracks; it picked the contour surface over the regional DEM                           |
| Meta canopy height map v2             | Cover agrees with the canopy sheet at r 0.82 over 20 m; it fills crown gaps (49.6% cover against 35.6%) and predates the cuts |
| SCANFI v2 (30 m)                      | Dates each opening to a five-year step; single cells ±6 m                                                                     |
| GEDI                                  | No usable shot                                                                                                                |
| VRI                                   | Polygon heights and closures                                                                                                  |

## Ground from the hillshade

The question was whether the hillshade picture is usable for elevation. Alone, no: a hillshade
pixel is the cosine of the angle between the ground's normal and the sun, one equation for two
slopes, and a surface integrated from it drifts. Tied to the sheet's contours, yes.

### It is a plain hillshade

Over ground the contour surface gives a slope for, shade × √(1 + slope²) should be linear in the
two slopes, with the sine of the sun's height as its constant. On the sheet it is: level ground
reads 179 of 255 (a 45° sun gives 180), the slope terms point at 315.5°, their strength matches a
44.6° sun, and the correlation is 0.98. No stretch, no gamma, one sun. That is what makes the grey
values measurements, and it is checked on every use: a picture that fails is refused.

### The method

Solve for the surface that reproduces the hillshade, passes through the contour lines, is smooth
where neither speaks, and stays within one contour interval of the plain contour surface.
Gauss–Newton on the shading equation, each step by LSQR without a matrix, at 8, 4 and 2 m cells
(`src/lib/geoPdf/hillshadeRelief.ts`). The first trial was a Python prototype (SciPy's LSMR on one
1.8 × 1.4 km window, 96 s); the TypeScript version solves the whole sheet, 1.7 million cells, in
16 s, with the coarse levels doing most of the work.

### What it gives

`scripts/forestry/check-pdf-contour-slope.ts` with the hillshade sheet.

Heights at contours held back (surfaces built from the 20 m contours only, read at the 10 m
contours in between, 97,075 points):

| Surface                   | Median error | 90% within | 99% within | RMSE   |
| ------------------------- | ------------ | ---------- | ---------- | ------ |
| 20 m contours alone       | 0.98 m       | 3.8 m      | 10.0 m     | 3.22 m |
| 20 m contours + hillshade | 0.40 m       | 1.6 m      | 10.2 m     | 2.24 m |

Slope against the slope sheet's exact pixels, every contour in (2,416,395 pixels):

| Surface              | Same class | Within one | 35 / 40 / 60% splits | Sheet's 60%+ found |
| -------------------- | ---------- | ---------- | -------------------- | ------------------ |
| Contours alone       | 43.4%      | 69.1%      | 86.8 / 88.9 / 90.9%  | 84.2%              |
| Contours + hillshade | 52.6%      | 79.9%      | 91.3 / 92.5 / 94.0%  | 91.4%              |

The refined cells moved 0.37 m at the median and under 5.4 m for 99 in 100; 0.04% were held at the
10 m bound.

Along the project's roads (`compare-road-terrains.ts --hillshade`), station slope within one class
of the slope sheet at 645 stations: regional DEM 57%, contours 62%, contours + hillshade 72%, and
better on each of the six roads. The centreline reads rougher on the refined terrain (grade change
from one station to the next 7.9 points on the longest covered road against 5.7).

### Against real LiDAR

`scripts/forestry/check-hillshade-relief-lidar.ts`, on PGMaps' public 1 m tile near Prince George,
reduced to 10 m contours and an 8-bit hillshade and rebuilt both ways (448,000 cells of 2 m):

| Measure                                   | Contours alone | Contours + hillshade | True ground |
| ----------------------------------------- | -------------- | -------------------- | ----------- |
| Height error, median                      | 0.62 m         | 0.22 m               |             |
| Height error, 90% within                  | 2.4 m          | 1.2 m                |             |
| Height error, 99% within                  | 5.2 m          | 4.3 m                |             |
| Slope in the same class                   | 71.5%          | 81.2%                |             |
| Slope within one class                    | 88.1%          | 97.1%                |             |
| 60%+ ground found                         | 54%            | 81%                  |             |
| Grade over 10 m, mean error               | 6.1 points     | 3.1 points           |             |
| Change of grade from one 10 m to the next | 3.9 points     | 9.2 points           | 8.3 points  |

The roughness is the ground's: a contour surface shows less than half of the grade change real
ground has over 10 m. The refined surface shows it with about a tenth too much. The sun was read at
313.4° and 44.3° against the true 315° and 45°.

### What it does not do

- **No heights of its own.** Where the sheet labels no contour (the block's north-east) the surface
  is empty and stays empty.
- **The worst places stay bad.** One held-back point in a hundred is still about an interval out.
- **It trusts the picture.** An existing road bench or a LiDAR artefact in the hillshade becomes
  ground. A mild stretch under the tolerance would bias slopes without being refused.
- **One block's sheets, one public tile.** No second company's hillshade has been tried.
- **Not a survey.** Fit for alignment, grades and a preliminary earthwork figure. The licensee's
  bare-earth DEM, or LidarBC's release, replaces it.

## What this gives a road project on such a block

| Need                                         | Use                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ground to design on, inside the sheet        | The contour surface, refined from the hillshade when the estimate is acceptable                |
| Ground for a road that runs off the sheet    | The regional DEM past the contours (the import's fill option), read as a screen                |
| How steep the LiDAR says it is, at a station | The profile's **Map slope** row and Review's slope-sheet row                                   |
| Timber on the line                           | The **Map canopy** row; public canopy maps only where the imagery postdates the cuts           |
| A picture of the ground under the plan       | The hillshade image layer                                                                      |
| Printed LiDAR sheets                         | The block map sheets, from the imported rasters                                                |
| Ground to build from                         | Not here: the licensee's DEM, or LidarBC's 1 m tiles when the 2024 flight is published         |

## What was built

| Piece                                                               | File                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unused object streams of a re-saved PDF                             | `src/lib/geoPdf/deadObjectStreams.ts`                                             |
| Image layers at their own pixels                                    | `src/lib/geoPdf/imageMosaic.ts`                                                   |
| Class display at native pixels, 10 m estimate cells                 | `src/lib/geoPdf/classGrid.ts` (`displayCells`, `classDisplayRgba`)                |
| Tighter registration preferred between sheets of one frame          | `src/pages/dev-forestry-roads/referenceImport.ts` (`preferTighterRegistration`)   |
| Block map sheets from imported rasters                              | `src/pages/dev-forestry-roads/pdfSheetRasters.ts`, `src/lib/forestry/blockSheet/prepareSheet.ts` |
| Profile rows from a slope or canopy sheet                           | `src/pages/dev-forestry-roads/sheetBands.ts`                                      |
| Ground between contours from a hillshade                            | `src/lib/geoPdf/hillshadeRelief.ts`, its worker and client, `hillshadeRefine.ts`   |
| Checks                                                              | `scripts/forestry/check-pdf-contour-slope.ts`, `compare-road-terrains.ts`, `compare-public-terrains.ts`, `check-hillshade-relief-lidar.ts` |

To run the checks again (the sheets and outputs stay outside the repository):

```sh
npx tsx scripts/forestry/check-pdf-contour-slope.ts /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/contour-slope.json /local/Hillshade_Map.pdf
node --import tsx scripts/forestry/compare-public-terrains.ts /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/public-terrains.json
node --import tsx scripts/forestry/compare-road-terrains.ts /local/project.road.json /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/road-terrains.json --hillshade /local/Hillshade_Map.pdf
npm run lidar:fetch-analysis
node --import tsx scripts/forestry/check-hillshade-relief-lidar.ts public/data/lidar-analysis/bc-093g086/dtm-1m.tif /tmp/relief-lidar.json
```

## Sources

- Horn, B. K. P. (1970), *Shape from Shading: A Method for Obtaining the Shape of a Smooth Opaque
  Object from One View*, MIT; Horn and Brooks (eds.), *Shape from Shading*, MIT Press, 1989.
- Paige, C. C. and Saunders, M. A. (1982), "LSQR: An algorithm for sparse linear equations and
  sparse least squares", *ACM Transactions on Mathematical Software* 8(1).
- Esri, hillshade function: <https://pro.arcgis.com/en/pro-app/latest/tool-reference/3d-analyst/how-hillshade-works.htm>
- ISO 32000-1:2008, 7.5.7 and 7.5.8 (object streams and cross-reference streams).
- NRCan CanElevation STAC mosaics: <https://nrcan.github.io/CanElevation/stac-dem-mosaics/>
- BC elevation data (TRIM, CDED): <https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/elevation>
