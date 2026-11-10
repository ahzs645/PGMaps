# Block map sheets

A block map sheet is a printed PDF of one harvest block: a map frame at a stated scale, a title
bar, block information, a legend that lists only what is drawn, a scale bar, a north arrow and a
footer. Six presets reproduce the layout and symbology of a set of ArcGIS Pro block-map sheets
(field layout, three LiDAR design sheets, a 1:50,000 access sheet and a portrait imagery sheet).
No licensee names or logos come with them; a user can add one logo of their own.

The road design tool offers it as **Files → Project & exports → Block map sheet**. The engine is
generic and other tools can adopt it; see [Adopting it in another tool](#adopting-it-in-another-tool).

| Part                     | Where                                                                   | DOM / network                               |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| Layouts, paper sizes     | `src/lib/mapSheet/layout.ts`                                            | None                                        |
| Scale, frame, scale bar  | `src/lib/mapSheet/scale.ts`                                             | None                                        |
| Draw operations, helpers | `src/lib/mapSheet/drawOps.ts`                                           | None                                        |
| Fixed-interval contours  | `src/lib/mapSheet/contours.ts`                                          | None                                        |
| Text widths              | `src/lib/mapSheet/textMetrics.ts`                                       | None                                        |
| PDF and SVG renderers    | `src/lib/mapSheet/renderPdf.ts`, `renderSvg.ts`                         | None (jsPDF is passed in)                   |
| PNG encoder              | `src/lib/mapSheet/png.ts`                                               | None (`CompressionStream`)                  |
| Imagery capture          | `src/lib/mapSheet/printCapture.ts`                                      | Browser: hidden MapLibre map, tile requests |
| Symbol model and drawing | `src/lib/mapSheet/symbols.ts`, `icons.ts`                               | None                                        |
| Map patterns and icons   | `src/lib/mapSheet/symbolRaster.ts`, `mapSymbols.ts`                     | None (the map is passed in)                 |
| Swatch SVG, sheet PNG    | `src/lib/mapSheet/symbolSvg.ts`; `sheetPng.ts`                          | None; `sheetPng.ts` needs a canvas          |
| Presets and colours      | `src/lib/forestry/blockSheet/sheets.ts`, `styles.ts`                    | None                                        |
| Symbol catalogue         | `src/lib/forestry/blockSheet/symbolCatalogue.ts`, `symbolMismatches.ts` | None                                        |
| Gallery sheets           | `src/lib/forestry/blockSheet/gallerySheets.ts`, `blockSheetFixtures.ts` | None                                        |
| Classed rasters          | `src/lib/forestry/blockSheet/classedRasters.ts`                         | None                                        |
| Block facts, BCGS        | `src/lib/forestry/blockSheet/blockFacts.ts`, `bcgs.ts`                  | None                                        |
| Sheet composer           | `src/lib/forestry/blockSheet/composeSheet.ts`, `prepareSheet.ts`        | None                                        |
| Setup form               | `src/components/ui/map-sheet-setup.tsx`                                 | React                                       |
| Road tool adapter        | `src/pages/dev-forestry-roads/blockSheet.ts`, `BlockSheetSetup.tsx`     | Loads capture and jsPDF on demand           |
| Road plan sheet symbols  | `src/pages/dev-forestry-roads/planSheetSymbols.ts`, `PlanView.tsx`      | Module none; the plan adds the layers       |
| Legend swatch            | `src/components/ui/sheet-symbol-swatch.tsx`                             | React                                       |
| Symbol gallery           | `src/pages/DevForestryBlockSheets.tsx`, `dev-forestry-block-sheets/`    | React, `/dev/forestry/block-sheets`         |

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

Letter, A3 and A4 use the same fractional layout. Type and line widths scale by
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

| Feature                  | Symbol                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Block of interest        | `#ffaa00` 2.5 over white 3.0; on LiDAR sheets `#000000` 2.5 over white 3.0                     |
| Other blocks             | `#000000` 1.0 outline                                                                          |
| Constraint area          | `#e60000` 0.5 hatch at 45°, 5 pt apart; `#a80000` 0.4 outline                                  |
| Riparian reserve zone    | The reserve symbol: `#38a800` 0.5 hatch at 45°, 5 pt apart; `#38a800` 1.2 outline              |
| Riparian management zone | `#97dbf2` 1.6 hatch with a `#4065eb` 0.4 hatch on it, 45°, 5 pt apart; `#4065eb` 0.4 outline   |
| Stream                   | `#00a9e6` 1.0 (overview 0.1)                                                                   |
| NCD stream               | `#00a9e6` 1.0 dash 5/2 (overview 0.1 dash 2/2)                                                 |
| Forest service road      | `#000000` 4.0 with a white 1.0 centre dash 5/5 (overview 2.0 / 0.75)                           |
| Existing road            | `#734c00` 2.5 with a white 1.0 centre dash 5/5 (overview 1.5 / 0.75)                           |
| Road deactivation        | Black × 7 pt every 24 pt along a deactivated mapped road, over its own symbol                  |
| Proposed (designed) road | The road's own colour 2.5 with a white 1.0 centre dash 5/5 (overview 1.5 / 0.75)               |
| Review markup            | Each note's colour: lines 2.0, areas filled at 0.35 with a 1.0 outline, pins 6.6 pt dots, halo |
| Any catalogue symbol     | `SheetLayers.extras`: a geometry with the catalogue symbol it draws with, listed by its label  |

The 1:50,000 sheet draws streams as 0.1 pt hairlines, as the reference map did; its legend showed
0.4 pt. Every catalogue symbol, and why most have no data yet, is in
[Symbol library](#symbol-library).

## Symbol library

A symbol is data (`src/lib/mapSheet/symbols.ts`). One function per kind turns it into drawing
operations, and the sheet's map, its legend swatches, the road plan's legend and the gallery all call
it, so a symbol cannot be drawn two ways.

| Kind  | Parts                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Line  | Strokes stacked bottom first, each with colour, width, dash, cap and a sideways `offset` (positive to the right of travel, as MapLibre's `line-offset`); then `markers`: an icon every `spacing` points along the line                                                   |
| Area  | Fill and opacity; `hatches` (one for a single hatch, two for a cross-hatch, a grid, a double hatch or alternating stripes, a second set shifted by `phase`); a `markerFill` grid of icons, staggered or not; outline strokes, `inside` for a casing just inside the edge |
| Point | An icon, its size in points, a primary and secondary colour and a halo drawn round every part first                                                                                                                                                                      |
| Class | A raster class colour and opacity                                                                                                                                                                                                                                        |

Hatches and marker fills are clipped to their polygon, anchored to the page origin so neighbouring
areas line up, and drawn as PDF vectors. Markers follow the line's direction; the first sits half a
spacing in (`start`), none past the end. A legend swatch shorter than one spacing shows one marker
in its middle.

**Icons are PGMaps' own drawings** (`icons.ts`): simple vector parts in a unit box, made to read like
the usual map symbols at 5–12 pt (bridge, culvert, pipe arch, gate, fish, fish barrier, point of
diversion, wellsite, scenic "P", spot height, pits, plot, tree, warning, marsh mark, ticks, crosses,
dots). The reference sheets drew points with symbol-font glyphs; none were extracted or traced, and
no symbol font is embedded. The wetland's marsh marks are a generated staggered grid.

**The catalogue** (`symbolCatalogue.ts`) defines every feature on the reference sheets (ArcGIS Pro
block-map sheets supplied by a BC licensee, November 2026) that PGMaps could draw: 167
symbols (16 of them raster classes) in the source's groups (classes, contours, blocks and management areas, hydrology, roads and
linear features, point features, final layout features, GPS and design polygons) and a group of
PGMaps' own additions. Each entry carries the source's values as text (`spec`) and either where
PGMaps draws it from (`source`) or what data it lacks (`missing`). Labels are generic; branded
labels became "Other licensee blocks", "Operating areas" and "Licensee road permit". Where the
source left a value unrecorded (a marker's spacing, an outline's colour), the entry says which value
was chosen.

Drawn from PGMaps data today: the block of interest, other blocks, constraint areas, the riparian
screen (reserve and management zones), streams and NCD streams, forest service roads (gravel main),
other mapped roads (spur), deactivation crosses, designed roads, contours and review markup.
Everything else is defined, drawn in the gallery and ready for `SheetLayers.extras`, but has no data
source in the forestry tools yet:

| Missing data                                       | Symbols waiting for it                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| FWA lakes and wetlands                             | Lake / river, wetland                                                                                          |
| Land designations (parks, UWR, WHA, OGMA, tenures) | Parks, eco/rec reserve, recreation site, woodlot, community forest, UWR, WHA, caribou, OGMA, range, ecosystems |
| RESULTS silviculture status                        | Previously harvested, satisfactorily restocked, free growing, other openings                                   |
| Road surface or use class (FTEN has only status)   | Paved, operational, temporary, other road, barge crossing, licensee road permit                                |
| Structure and field point inventory                | Bridges, culverts, pipe arches, gates, crossings, pits, plots, CMTs, invasive plants                           |
| Field traverse or design (GPS) layers              | GPS lines, prework lines, final layout features, design polygons                                               |
| Other provincial layers                            | Rail, pipeline, transmission line, seismic line, fence, wellsite, private land, archaeology, VRI               |

Nine features (landing, yard tower, high value snag, wildlife point, beetle trap, borrow pit, measure
plot, count plot, research installation) were listed on the reference legends with nothing to read,
so they have no symbol (`UNSPECIFIED_FEATURES`).

### Legend and map disagreements

Where a reference legend drew a symbol differently from its map, PGMaps uses the map's value and its
legend draws from that same symbol (`symbolMismatches.ts`, checked by `symbolCatalogue.test.ts`):

| Feature                             | Reference legend      | Reference map                | PGMaps |
| ----------------------------------- | --------------------- | ---------------------------- | ------ |
| Intermediate contour (field layout) | `#828282` 0.1         | `#b2b2b2` 0.25               | Map    |
| Contour on imagery                  | `#cccccc` 0.5         | `#ffffff` 0.35 / 0.25        | Map    |
| LiDAR stream                        | `#005ce6` 1.0         | `#005ce6` 0.5                | Map    |
| Block of interest (field layout)    | `#ffaa00` 1.5         | `#ffaa00` 2.5 over white 3.0 | Map    |
| Classified and NCD streams          | 0.4                   | 1.0 at 1:10,000              | Map    |
| Previously harvested                | outline `#9c9c9c` 0.4 | outline `#6e6e6e` 0.1        | Map    |

### On the live map

`mapSymbols.ts` gives MapLibre the same symbols: `lineSymbolPaint` (widths, dashes and offsets),
`lineMarkerLayers` (`symbol-placement: line` icons at the sheet spacing, rotated with the line),
`areaSymbolPaint` (a colour fill, or a `fill-pattern` tile for hatched and marker-filled areas, with
the fill baked into the tile) and `pointSymbolLayout`. `symbolRaster.ts` draws the tiles and icons as
RGBA pixels at the device pixel ratio, without a canvas, and `keepSymbolImages` adds them and answers
`styleimagemissing`, so they come back after a style reload or theme change.

A point is 96/72 CSS pixels, as for line widths, so on screen a pattern matches the print at the
sheet's scale on a 96 dpi display. The road plan offers this as **Map settings → Block sheet
symbols**: the context (avoid areas, harvest areas, the riparian screen, streams and mapped roads)
then draws with the sheet symbols, classed by `contextSheetKey` exactly as the sheet classes it, and
the legend lists those symbols with swatches drawn by `SheetSymbolSwatch`. The plan's own context
colours come back when it is off.

Where the map cannot match the print:

- **Patterns do not scale with zoom.** A `fill-pattern` tile is fixed in screen pixels, so hatch
  spacing matches the paper only at the zoom of the sheet's scale. Paper hatches are fixed in points
  too, so the look is the same; the ground distance between lines is not.
- **A tile has whole pixels.** `tileSide` picks the smallest tile holding whole periods of every
  hatch within `PATTERN_TILE_TOLERANCE` (2 %), up to `MAX_PATTERN_TILE_PX`, and draws the nearest
  exactly repeating family of lines. A hatch at an odd angle (the special harvest area's 55°) is drawn
  within about a degree; `PatternTile.hatches` reports the angle and spacing drawn, and the gallery
  prints them under each tile.
- **MapLibre places line markers itself.** It chooses where the first marker falls and drops markers
  near tile edges and tight bends, so the count and phase differ from the sheet; spacing and
  orientation match.
- **An `inside` casing draws centred on the edge**, because a MapLibre line cannot be clipped to its
  polygon.
- **The tile's colours are blended once.** A hatched area with a fill draws as one pattern layer, so
  the fill's opacity is in the tile and the layer is opaque.

## Symbol gallery

`/dev/forestry/block-sheets` (linked as **Symbol gallery** under the block sheet setup) shows:

- **Sheet presets**: each preset at 1:5,000, 1:10,000, 1:20,000 and 1:50,000 on tabloid, and on
  letter, A3 and A4 at its default scale, drawn from the synthetic fixtures (`galleryLayers`) through
  the real composer and SVG renderer. Previews draw when scrolled into view, one at a time; each card
  downloads its PDF (terrain at 150 dpi) and PNG (100 dpi, 2 px a point). The imagery sheet uses a
  synthetic stand-in, so the gallery needs no network.
- **Symbols**: every catalogue symbol in its group, drawn on a sample shape at twice print size, its
  legend swatch and, for patterned areas, the map's pattern tile, beside the source values and the
  data it comes from.
- **Legend vs map**: the disagreements above, with the legend's, the map's and PGMaps' renderings
  side by side.

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
| Markers along one line      | 4,000                                          | `drawOps.ts`, `MAX_LINE_MARKERS`                                                | Spacing widened so the count fits                          |
| Icons in one marker fill    | 5,000                                          | `symbols.ts`, `MAX_MARKER_FILL`                                                 | Grid widened so the count fits                             |
| Map pattern tile            | 256 device pixels a side                       | `symbolRaster.ts`, `MAX_PATTERN_TILE_PX`                                        | Closest fit within it; spacing off by more than 2 %        |
| Map pattern spacing error   | 2 %                                            | `symbolRaster.ts`, `PATTERN_TILE_TOLERANCE`                                     | A larger tile with more periods is tried                   |
| Points to screen pixels     | 96/72                                          | `symbolRaster.ts`, `PX_PER_PT`                                                  | —                                                          |
| PNG sheet                   | 8,192 pixels on the longest side               | `sheetPng.ts`, `MAX_SHEET_PNG_SIDE`                                             | Pixels per point lowered to fit                            |

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
  operational and spur are not told apart. A road with a recorded deactivation also carries the
  deactivation crosses.
- The riparian screen's reserve band draws with the reserve symbol and its management and
  unresolved bands with the riparian management zone symbol. The management zone covers the
  reserve, so the reserve shows both hatches.
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
