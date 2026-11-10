# Block map sheets

A block map sheet is a printed PDF of one harvest block: a map frame at a stated scale, a title
bar, block information, a legend that lists only what is drawn, a scale bar, a north arrow and a
footer. Six presets reproduce the layout and symbology of a set of ArcGIS Pro block-map sheets
(field layout, three LiDAR design sheets, a 1:50,000 access sheet and a portrait imagery sheet).
No licensee names or logos come with them; a user can add one logo of their own.

The road design tool offers it as **Files → Project & exports → Block map sheet**. The engine is
generic and other tools can adopt it; see [Adopting it in another tool](#adopting-it-in-another-tool).

| Part                     | Where                                                               | DOM / network                               |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------- |
| Layouts, paper sizes     | `src/lib/mapSheet/layout.ts`                                        | None                                        |
| Scale, frame, scale bar  | `src/lib/mapSheet/scale.ts`                                         | None                                        |
| Draw operations, helpers | `src/lib/mapSheet/drawOps.ts`                                       | None                                        |
| Fixed-interval contours  | `src/lib/mapSheet/contours.ts`                                      | None                                        |
| Text widths              | `src/lib/mapSheet/textMetrics.ts`                                   | None                                        |
| PDF and SVG renderers    | `src/lib/mapSheet/renderPdf.ts`, `renderSvg.ts`                     | None (jsPDF is passed in)                   |
| PNG encoder              | `src/lib/mapSheet/png.ts`                                           | None (`CompressionStream`)                  |
| Imagery capture          | `src/lib/mapSheet/printCapture.ts`                                  | Browser: hidden MapLibre map, tile requests |
| Presets and colours      | `src/lib/forestry/blockSheet/sheets.ts`, `styles.ts`                | None                                        |
| Classed rasters          | `src/lib/forestry/blockSheet/classedRasters.ts`                     | None                                        |
| Block facts, BCGS        | `src/lib/forestry/blockSheet/blockFacts.ts`, `bcgs.ts`              | None                                        |
| Sheet composer           | `src/lib/forestry/blockSheet/composeSheet.ts`, `prepareSheet.ts`    | None                                        |
| Setup form               | `src/components/ui/map-sheet-setup.tsx`                             | React                                       |
| Road tool adapter        | `src/pages/dev-forestry-roads/blockSheet.ts`, `BlockSheetSetup.tsx` | Loads capture and jsPDF on demand           |

## Before you rely on it

- **The map is Web Mercator, north up.** The stated scale is exact at the frame's centre latitude,
  which the footer prints ("Scale true at 54.06°N"). At 1:50,000 on a tabloid frame in central BC
  the top and bottom edges are about 0.2 % off. The reference sheets were BC Albers with a north
  arrow rotated about 3.4° for meridian convergence; these sheets are not.
- **Gross area is planar BC Albers (EPSG:3005)**, outer rings less holes, as BC tenure areas are
  reported. It is not a geodesic area and not a merchantable area.
- **Min. and max. elevation are sampled, not surveyed.** They come from the tool's terrain, on a
  grid at the terrain's own resolution inside the block. A block only partly on the terrain prints
  the covered part and says how many samples had no ground. No terrain prints "not recorded".
- **Merch area, NAR, timbermark, FIZ, district, region, TSA, operating area and nearest community
  are typed.** Nothing looks them up. Blank fields print "not recorded" in grey.
- **The legend lists what the frame shows.** A layer with nothing inside the frame is left out, and
  the class legend appears only with a classed base.
- **Slope is from the terrain grid as sampled for the sheet**, about 150 dpi on paper (1.7 m on the
  ground at 1:10,000). It is raw slope, not the 12 m ground trend the route searches use, so
  micro-relief shows as steep streaks, as on the reference sheets.
- **The preview is a thumbnail.** It samples at 40 dpi and shows imagery as a flat colour; the
  PDF loads the imagery.

## Sheet presets

| Preset                        | Layout (tabloid, 1224 × 792 pt)                  | Default scale | Base                  | Contours    | Block outline            | Extras                           |
| ----------------------------- | ------------------------------------------------ | ------------- | --------------------- | ----------- | ------------------------ | -------------------------------- |
| Field Layout                  | Landscape, side panel (`FIELD_SIDE_PANEL`)       | 1:10,000      | White                 | 10 m, black | `#ffaa00` 2.5 on white 3 | Road Information table           |
| LiDAR Design Slope            | Landscape, side panel (`LIDAR_SIDE_PANEL`)       | 1:10,000      | Slope classes         | 10 m, black | `#000000` 2.5 on white 3 | Source bar, class legend         |
| LiDAR Design Canopy Height    | Same                                             | 1:10,000      | Canopy height classes | 10 m, black | Same                     | Source bar, class legend         |
| LiDAR Design Hillshade        | Same                                             | 1:10,000      | Greyscale hillshade   | 10 m, black | Same                     | Source bar                       |
| General Block Access 1:50,000 | Landscape, bottom panels (`ACCESS_BOTTOM_PANEL`) | 1:50,000      | White                 | None        | `#ffaa00` 2.5 on white 3 | Block Access Comments box        |
| Field Ops Imagery             | Portrait, bottom panels (`IMAGERY_PORTRAIT`)     | 1:10,000      | Satellite imagery     | 10 m, white | `#ffaa00` 2.5 on white 3 | Ruled notes area, imagery credit |

Letter, ANSI D (22 × 34 in), A3 and A4 use the same fractional layout. ANSI D is exactly twice
tabloid, so it prints the tabloid sheet at `k` = 2 with four times the ground at a given scale; its
terrain raster then meets the 4,000,000-cell budget at about 90 dpi rather than 150, and imagery
the 4,096 px side at about 150 dpi instead of 200. Saved sheet setups keep the sheet, paper, scale
and typed fields in the road tool (`docs/forestry-road-design/exports-and-project-files.md`, Saved
sheet setups). Type and line widths scale by
`k = min(width / 1224, height / 792)` (portrait swaps the sides), never below 4.5 pt
(`MIN_SHEET_FONT_PT`). The dialog offers 1:5,000, 1:10,000, 1:20,000, 1:50,000 (`SHEET_SCALES`) or
**Fit the block**, which picks the smallest scale in `FIT_SCALES` whose frame holds the block's box
at 80 % (`FIT_FILL`).

### Sheet furniture

| Element        | Style                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Title bar      | Fill `#ffd37f`, 1 pt black stroke; title Helvetica Bold 16 pt; Lat, Long, F.L., CP and Block fields Helvetica Bold 12 pt, **black** text   |
| Header fields  | Laid out left to right after the title and measured; shrunk to 7 pt, then cut with "...", so none overlap                                  |
| Section bars   | Fill `#ffd37f`, 1 pt black; Helvetica Bold, black, centred                                                                                 |
| Panels         | White, 1 pt black                                                                                                                          |
| Scale bar      | Alternating black and white, about 1 cm a segment rounded to 1, 2, 2.5 or 5 × 10ⁿ m; the left segment halved; 2–6 right segments; "Metres" |
| North arrow    | Vector needle, red `#ff0000` and white with a white 3 pt outline, bottom left in the frame, pointing up                                    |
| Graticule      | DMS labels Times Italic 6 pt with a white halo, 1.5 pt ticks 3 pt long; interval from 5" up so at most six ticks show                      |
| Labels in map  | White halo 1.2 pt; block label Helvetica Bold 8 pt black (CP, then Block ID); road names Helvetica Bold 6 pt `#ff0000`                     |
| Road table     | Header `#cccccc`; two halves of five rows: colour key, road name, chainage `0+000 - 1+080`; "Summary Date/By" in bold red                  |
| Footer         | Scale, date, prepared by; scale bar; logo row with the organisation, the projection note, revision and the planning caveat                 |
| Imagery credit | 6.5 pt `#323232` with halo, bottom right in the frame                                                                                      |

The reference sheets printed white text on `#ffd37f`, about 1.4:1 contrast. These print black.

### Map styles

Each colour is a constant in `styles.ts`. The sheet's map, its legend swatch and
`lineSymbolPaint`/`areaSymbolPaint` (MapLibre paints) all read the same object, so a legend cannot
disagree with the map. Widths are points on tabloid at the sheet's scale.

**Slope classes, percent** (`SLOPE_CLASSES`, drawn at `SLOPE_CLASS_OPACITY` = 216/255 ≈ 0.85). A value
on a break belongs to the class below it (`min < value ≤ max`, ArcGIS's "≤ upper").

| Class  | < 20  | 20–30     | 30–35     | 35–40     | 40–50     | 50–60     | 60–85     | 85 +      | 95 + (overlay, opaque) |
| ------ | ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | ---------------------- |
| Colour | clear | `#ffff73` | `#a3ff73` | `#73dfff` | `#df73ff` | `#ffaa00` | `#ff7f7f` | `#e81515` | `#000000`              |

**Canopy height, metres** (`CANOPY_HEIGHT_CLASSES`, opaque):

| Class  | < 5   | 5–10      | 10–15     | 15–20     | 20–25     | 25–30     | 30–35     | 35–40     | 40 +      |
| ------ | ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Colour | clear | `#ff7f7f` | `#4ce600` | `#267300` | `#beffe8` | `#00a9e6` | `#e8beff` | `#a900e6` | `#000000` |

**Hillshade** (`HILLSHADE_PRESET`): greyscale, opaque, sun azimuth 315°, altitude 45°, z-factor 1.
Flat ground prints grey 180.

**Contours** (`CONTOUR_INTERVAL_M` = 10, index every `CONTOUR_INDEX_EVERY` = 2nd line, so 20 m):

| Variant     | Index line        | Intermediate line | Labels                                                    |
| ----------- | ----------------- | ----------------- | --------------------------------------------------------- |
| `default`   | `#4e4e4e` 0.35 pt | `#b2b2b2` 0.25 pt | 6 pt, index `#000000`, intermediate `#828282`, white halo |
| `onImagery` | `#ffffff` 0.35 pt | `#ffffff` 0.25 pt | 6 pt `#ffffff`, no halo                                   |

Labels run along the line every 220 pt, staggered by level, at least 34 pt apart.

**Features** (detail widths up to 1:25,000, `DETAIL_SCALE_LIMIT`; overview widths beyond):

| Feature                  | Symbol                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Block of interest        | `#ffaa00` 2.5 over white 3.0; on LiDAR sheets `#000000` 2.5 over white 3.0                |
| Other blocks             | `#000000` 1.0 outline                                                                     |
| Constraint area          | `#e60000` 0.5 hatch at 45°, 5 pt apart; `#a80000` 0.4 outline                             |
| Stream                   | `#00a9e6` 1.0 (overview 0.4)                                                              |
| NCD stream               | `#00a9e6` 1.0 dash 5/2 (overview 0.4 dash 2/2)                                            |
| Forest service road      | `#000000` 4.0 with a white 1.0 centre dash 5/5 (overview 2.0 / 0.75)                      |
| Existing road            | `#734c00` 2.5 with a white 1.0 centre dash 5/5 (overview 1.5 / 0.75)                      |
| Proposed (designed) road | The road's own colour 2.5 with a white 1.0 centre dash 5/5 (overview 1.5 / 0.75)          |
| Review markup            | Each note's colour: lines 2.0, areas filled at 0.35 with a 1.0 outline, pins 3 pt circles |

Designed roads take the road tool's own colours (`distinctRoadColors`) rather than the reference
red, so the Road Information table's colour keys tell them apart.

## Block information: worked out or typed

| Field                                     | Source                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Lat / Long (title bar)                    | Area-weighted centroid of the block, computed in BC Albers; 4 decimals (field, access) or 6 (LiDAR, imagery) |
| Gross Block Area (ha)                     | Planar BC Albers area, one decimal                                                                           |
| Mapsheet                                  | BCGS 1:20,000 sheet of the centroid, by arithmetic (`bcgsMapsheet`); null outside 48–60°N, 112–144°W         |
| Min. / Max. Block Elev. (m)               | Terrain samples inside the block (`blockElevationRange`)                                                     |
| F.L., CP, Block ID                        | Typed; Block ID falls back to the block's name                                                               |
| Everything else                           | Typed                                                                                                        |
| Date, prepared by, organisation, revision | The project's issue stamp (`projectIssue.ts`); the date is ISO, YYYY-MM-DD                                   |

The BCGS arithmetic: series tens count 8 to 11 westward from 112°W in 8° steps and units 2 to 4
northward from 48°N in 4° steps; letters A–P are 2° × 1° blocks snaking from the south (A–D east to
west, E–H back, I–L, M–P); sheets 001–100 are 0.2° × 0.1° cells from the south-west corner, west
to east, rows northward. It reproduces `093I003` at (−121.5254, 54.0595) and `093G087` at
(−122.71, 53.895), the second checked against the provincial grid layer. A point on a cell line
falls in the cell north or east of it.

## Limits and budgets

| Limit                       | Value                                          | Enforced in                                                                     | What happens when exceeded                                 |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Coarsest scale              | 1:250,000                                      | `scale.ts`, `MAX_SHEET_SCALE`                                                   | Refused; fitting stops at it                               |
| Terrain raster resolution   | 150 dpi                                        | `prepareSheet.ts`, `SHEET_RASTER_DPI`                                           | —                                                          |
| Terrain raster cells        | 4,000,000                                      | `classedRasters.ts`, `MAX_SHEET_GRID_CELLS`                                     | Coarsened to fit                                           |
| Contour grid                | One sample per 2.5 pt of paper                 | `prepareSheet.ts`, `CONTOUR_GRID_PT`                                            | —                                                          |
| Contour segments            | 250,000                                        | `contours.ts`, `MAX_SHEET_CONTOUR_SEGMENTS`                                     | Interval doubled; the source bar says "widened to fit"     |
| Elevation samples per block | 250,000, no finer than 1 m                     | `blockFacts.ts`, `MAX_BLOCK_ELEVATION_SAMPLES`, `MIN_BLOCK_ELEVATION_SPACING_M` | Spacing widened by 1.5× until it fits                      |
| Imagery capture             | 200 dpi, longest side 4,096 px                 | `printCapture.ts`, `PRINT_CAPTURE_DPI`, `MAX_CAPTURE_SIDE_PX`                   | Resolution lowered to fit                                  |
| Imagery load time           | 30 s                                           | `printCapture.ts`, `PRINT_CAPTURE_TIMEOUT_MS`                                   | Export fails: "The imagery did not finish loading in time" |
| Typed field                 | 120 characters                                 | `sheets.ts`, `MAX_SHEET_FIELD_LENGTH`                                           | Cut; on the sheet a long value is cut with "..." to fit    |
| Access comments             | 2,000 characters                               | `sheets.ts`, `MAX_SHEET_COMMENTS_LENGTH`                                        | Cut; lines past the box end in "(continues: shorten …)"    |
| Road table                  | 10 roads (two halves of `ROAD_TABLE_ROWS` = 5) | `composeSheet.ts`, `ROAD_TABLE_ROWS`                                            | Nine listed and "+N more roads"                            |
| Legend                      | As many rows as the panel holds                | `composeSheet.ts`, `legendPanel`                                                | "+N more not shown"                                        |
| Logo                        | 2 MB, PNG or JPEG                              | `BlockSheetSetup.tsx`, `MAX_SHEET_LOGO_BYTES`                                   | Refused with a message                                     |
| Smallest type               | 4.5 pt                                         | `layout.ts`, `MIN_SHEET_FONT_PT`                                                | Held at 4.5 pt                                             |

## Built-in assumptions

- Web Mercator framing; the frame centres on the middle of the block's box, not its centroid.
- Raster pixels are sampled at cell centres on the sheet's own frame, so the raster and the vectors
  line up without resampling. The PDF holds the raster as PNG (`png.ts`), RGB when opaque.
- Gradients are central differences, one-sided beside a gap; a missing cell stays transparent and
  no contour crosses a gap.
- A stream draws dashed as NCD only when its imported class is "NCD". An unassessed reach draws as
  a stream.
- A mapped road whose evidence names it an FSR draws as a forest service road; every other mapped
  road draws as an existing road. FTEN has no surface or use class, so paved, gravel main,
  operational and spur are not told apart.
- In the road tool the block is a harvest area or an imported reference area; with none, the sheet
  frames the roads and block facts print "not recorded". Other harvest areas draw as other blocks;
  avoid areas draw as constraint areas.
- Review markup is the plan's map notes, drawn as they are. There is no separate markup layer.
- The canopy height sheet needs a canopy height grid. In the road tool that is a named reference
  surface whose name contains "canopy" or "CHM"; otherwise the preset is unavailable.

## Failure modes

| Symptom                                                        | Cause                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "Choose a block, or draw a road, before making a block sheet." | Nothing to frame: no block area, road or note                                         |
| Min./Max. elevation "not recorded"                             | No terrain under the block, or no terrain loaded                                      |
| Blank or partial slope raster                                  | The terrain does not cover the frame; outside it the base stays white                 |
| "No canopy height grid is loaded."                             | Canopy height preset without a canopy surface                                         |
| "A map image provider blocks image export."                    | The imagery server sent no CORS header (from `captureMapImage`)                       |
| "The imagery did not finish loading in time."                  | Tiles slower than 30 s; retry, or pick a smaller paper or coarser scale               |
| Red "NOT CURRENT" box over the map                             | An invalid section or engineering input: the sheet is stamped (`INVALID_INPUT_RULES`) |
| "Contours … (widened to fit)" in the source bar                | Too many contour segments at 10 m for the budget                                      |

## Adopting it in another tool

1. Build `SheetLayers` from the tool's own data: the block polygon, roads, streams, notes.
2. Call `sheetFrame(kind, paper, scale, { bounds: sheetFocus(layers) })`.
3. Run `prepareSheetTerrain(frame, { terrain, canopy })` in slices (it is a generator) with any
   `ElevationSource`: a LiDAR DTM for slope, hillshade and contours; a CHM for canopy height.
4. For the imagery preset call `captureBasemap(IMAGERY_BASEMAP, frame.projection, signal)`.
5. `composeSheet({...})`, then `encodeSheetImages(ops)` and `drawSheetPdf` (or `sheetSvg` for a
   preview).
6. Offer `MapSheetSetup` for the choices, with the tool's own `kinds`, `areas` and `fields`.

A LiDAR tool that already has `slope.tif` or a CHM grid can wrap it as an `ElevationSource`
(`elevationAt(lng, lat)`) and pass it straight in. Keep the presets' colours in `styles.ts` and
use `lineSymbolPaint`/`areaSymbolPaint` for any MapLibre layer that should match the sheet.
