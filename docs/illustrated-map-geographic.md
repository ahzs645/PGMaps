# Rainforest to Rockies: geographic illustration

Revision 4, prepared 25 November 2026 (Vancouver time). Workshop: `/dev/illustrated-map/`. Source-retrieval dates below are UTC, as recorded in provenance.

The workshop now opens a geographic map built from sourced coastlines, inland water, highways and place coordinates. Page 8 of the supplied Destination BC guidelines remains the illustration reference. Its authored schematic is available as a separate mode; it is not used to determine the geographic map's coordinates.

The scenery, tree families, route badges, supplied-font lettering and generated hatch come from the same editable drawing system described in [the reconstruction guide](illustrated-map-reconstruction.md). No image trace, threshold-to-contour conversion, old kit path, or raster-to-vector operation supplies the new geographic geometry. The title remains a reconstructed study rather than a recovered official master.

## What is geographic and what is composed

| Part                                       | Construction and meaning                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marine shoreline, islands and inland water | GSHHG geometry with an official BC Freshwater Atlas supplement for selected major lakes and manmade waterbodies.                                           |
| Province regions                           | Statistics Canada digital boundaries, intersected with the common dry-land geometry. They do not replace the marine shoreline.                             |
| Highways                                   | Actual NRN and WSDOT polylines, generalized for this map's display scale. No invented ferry or straight-line road connection.                              |
| Place markers                              | Official CGNDB points and the Census Seattle internal point. Text can be offset for readability while its marker stays at the source coordinate.           |
| Route shields                              | Designed badge drawings positioned on their corresponding real BC highway centreline.                                                                      |
| Coastal hatch coverage                     | A generalized style region informed by CWH, MH and CDF biogeoclimatic zones. Its offshore extension avoids making a second coastline.                      |
| Hatch marks                                | Seeded, short cubic strokes in authored contour bands. The marks keep their own flow and are clipped by land and water.                                    |
| Trees and activities                       | Decorative regional motifs. Their coordinates support coherent composition; they are not recorded wildlife, vegetation, facility or activity observations. |
| Large regional words, title and compass    | Cartographic labels and furniture. The compass's north orientation is calculated for its location in the projected map.                                    |

Comparing the original page, schematic reconstruction and geographic map side by side is meaningful. Registering the schematic over the geographic map would imply a spatial correspondence that does not exist.

## One projection and one drawing scale

All source geography is provided as WGS84 longitude/latitude and projected together into **NAD83 / BC Albers, EPSG:3005**. The builder fits the projected extent to a 1,536 by 1,040 artboard with one uniform drawing scale. Roads, coastlines, lake holes, province regions, place points and route-marker locations use that same transformation.

The requested view is longitude -129.5 to -112.5 and latitude 47.0 to 54.8. The land input extends to longitude -132.5 to -107.8 and latitude 45.3 to 56.3, beyond the full projected drawing canvas, so a rectangular data cut does not appear as a shoreline. The builder checks that an explicit acquisition footprint covers the complete canvas, including its layout margins; it does not mistake real ocean for missing input. Final verification found **0.0 m² of uncovered canvas**. This is a projected regional map: the uniform drawing scale is not a claim that every ground distance is free from projection distortion.

The footer includes a 100 km projected scale bar. The compass rotation is derived by projecting a small northward latitude step at the compass's reference location. Marker coordinates and source identifiers remain inspectable in the SVG/provenance output.

## Land, water and the hatch boundary

The renderer declares one geographic land path and one BC dry-land path. Those same SVG objects are reused to paint the land and clip its hatch, with even-odd fill/clip rules preserving water holes and islands. There is no inward land offset, white shoreline stroke or separately fitted hatch coastline.

The three coverage modes change only the pattern's permitted region:

- **Coastal style** remains the default and intersects the shared BC dry-land clip with a separate broad coastal style region.
- **Northern BC · reference style** adds a broad northwestern field, with an authored edge west of Mount Robson and Highway 5 that tapers southwest toward the bear/Whistler area.
- **All BC land** uses the shared BC dry-land clip without the coastal restriction.

The northern variant combines the coastal region and its authored northern extent as two sibling paths in one SVG style clip, forming their union. One continuous hatch field is drawn through that union, with the shared geographic BC dry-land clip applied outside it. This preserves coastlines, islands and water holes without doubled strokes or a seam where the style regions meet. The extent uses a few cubic bends positioned relative to existing Mount Robson, Kamloops and Whistler anchors; it is a composed interpretation of the reference, not a traced contour or a mapped forest boundary. It uses the existing regional geographic frame and does not extend the map to the whole northern province. Neither the new extent nor the coastal style is a current forest inventory.

The coastal style region unions selected CWH/MH/CDF display polygons, fills small internal _style_ exclusions below 50 km², simplifies that styling boundary at 500 m, adds an offshore/coastal coverage extension, and simplifies the resulting style extent at 250 m. The extension includes marine area buffered by 3 km. It never becomes visible water hatching because the exact common dry-land clip is applied afterward. These are styling operations; actual lake holes are removed by the independent geographic land mask.

GSHHG's full-resolution hierarchy provides the marine footprint and its original lake/island hierarchy. Selected Freshwater Atlas waters replace overlapping older GSHHG lake geometry inside BC, while unmatched GSHHG waters and cross-border continuations are retained. The acquired FWA lake candidate set contains **1,290 source polygons** with **4,222 interior rings**; a separately classified manmade-water set contributes **five polygons**. The service's conservative envelope query returns 67 lakes outside the exact WGS84 rectangle; 1,223 lake polygons intersect that rectangle. Land preparation clips the candidates to the exact working extent. Both queries use source `AREA_HA >= 100`, equivalent to 1 km². This threshold applies to each source polygon, including watershed partitions, rather than to a name-based merge of a whole lake.

Land and water are then simplified together in EPSG:3005 using Mapshaper 0.8.10, topology-preserving Douglas-Peucker at **125 m**, with `keep-shapes` and no gap filling. Every connected selected land/water component is supplied separately. QA found that cleanup had merged 75 narrow-channel islands with adjacent land; exact source land/water topology was restored within 250 m of those components. All **8,315 selected source components** were retained or locally restored. Administrative regions are also simplified together at 125 m to retain shared inland borders.

After WGS84 coordinate rounding, a shared-arc cleanup without further simplification removes independent-rounding slivers. Final land/water overlap is **0.0 m²** in the metric verification; the protected source regions have a combined measured area loss of 0.399 m² after the coordinate round trip. Small features can still change shape or area at this cartographic tolerance; identical SVG fill and clip geometry is not a claim of surveyed shoreline accuracy.

The standalone **geographic-land-mask.svg** exposes the literal dry-land mask: black is land and white is ocean or inland water. It lets the boundary be reviewed without relying on hatch colour or illustrative symbols.

## Actual road corridors

The Canadian extraction searches all five NRN route-number fields to preserve concurrent route attribution. It verifies server counts, complete pages and unique source IDs. Only records explicitly classified as ramps or service lanes are omitted from the illustrated through-road strokes. Each remaining source segment is simplified independently at **75 m in EPSG:3005**, preserving its endpoints, before exact shared endpoints are merged. Distinct carriageways and genuine disconnected components remain separate. No nearby endpoints are snapped together, no incidental crossing is newly noded, and no smoothing spline leaves the supplied corridor.

| Jurisdiction     | Solid primary routes | Dashed supporting routes |
| ---------------- | -------------------- | ------------------------ |
| British Columbia | 1, 3, 5, 99          | 16, 93, 95, 97, 97C      |
| Alberta          | 1, 3                 | 16, 93, 93A              |
| Washington       | -                    | I-5                      |

Supporting routes are drawn first so shared portions do not add dashes over a primary emerald road. BC 93A and Alberta 95 were queried but had no selected source geometry; no replacement was invented.

The Canadian input contained 13,690 route-tagged segments; 11,721 through-road segments remained after removing 1,969 explicit ramps/service lanes. The resulting 14 province/route groups contain 314 line parts and 16,451 vertices, including concurrent-route geometry. Maximum measured simplification deviation was **74.970975 m**, with **zero changed source-segment endpoints**. Final six-decimal WGS84 rounding adds less than 0.08 m in this extent. BC/Alberta geometries for routes 1, 3, 16 and 93 meet with a measured minimum gap of zero, without artificial connectors.

WSDOT's separate I-5 supplement selects mainline `RouteID = '005'`, preserving increasing and decreasing carriageways. Its 788 source segments produce two line parts and 827 vertices. The maximum measured simplification deviation was **73.509607 m**, again with zero endpoint changes. A **7.506 m** mismatch remains between the supplied NRN BC 99 and WSDOT I-5 geometry at the border; it was not joined artificially. The I-5 study extract ends at latitude 47.55, south of central Seattle, which is an extraction limit rather than an official highway terminus.

Highway 5 ends at its real junction with Highway 16 near Tête Jaune Cache. Highway 16 continues toward Mount Robson and Jasper. Vancouver Island Highway 1 and mainland Highway 1 remain separate; no ferry link is inferred. The road subset is not a routing graph or a complete road inventory, and it makes no claim about live closures, road condition or legal access.

## Place points and labels

The input contains **24 sourced anchors**. CGNDB's generalized points retain their official record IDs, feature types, names and stated coordinate accuracy where supplied. Whistler uses its populated-community record, Osoyoos its town record, and Jasper its townsite record rather than the broader municipality centroid.

Mount Robson is represented by two distinct source records: **JBLBR**, the mountain peak, and **JCRQL**, the roadside populated locality. The map's mountain flag uses the peak, approximately 9.03 km from the selected Highway 16 geometry. The locality, about 86 m from that road, remains available in the data. Neither is silently substituted for the other.

Seattle uses Census GEOID **5363000** and its published 2025 incorporated-place internal point. It lies approximately 1.72 km from the selected I-5 geometry. No spur is drawn to the point. Victoria uses its official city point; the nearby Mile 0 leaf is a decorative cue, not a sourced monument location.

Great Forest labels use genuine supplied font glyphs, including the lowercase-codepoint capital alternates found in the typography review. Natural glyph advances, zero added tracking, and a uniform scale per face avoid the earlier horizontal compression. White halos follow the actual glyph outlines in drawing coordinates. They do not use rectangular background patches. The general label-halo default is 1.8 drawing units, and the foreground illustrations may overlap the hatch edge by default.

## Five ordinary shield numerals

The ordinary 3, 5 and 99 shields were compared in the same native source crops, with the previous and revised vectors rendered at the same placement. Measurements use numeral ink bounds relative to the coloured shield body, excluding its white outer halo. Vector measurements use an 8× render; compressed source edges have approximately one native pixel of uncertainty.

| Shield  | Source ink/body width × height | Earlier vector | Revised vector |
| ------- | ------------------------------ | -------------- | -------------- |
| 3 east  | 0.279 × 0.487                  | 0.395 × 0.644  | 0.271 × 0.488  |
| 3 west  | 0.279 × 0.486                  | 0.395 × 0.644  | 0.271 × 0.488  |
| 5 north | 0.286 × 0.487                  | 0.395 × 0.617  | 0.281 × 0.488  |
| 5 south | 0.256 × 0.462                  | 0.395 × 0.617  | 0.281 × 0.488  |
| 99      | 0.651 × 0.487                  | 0.763 × 0.529  | 0.659 × 0.492  |

The revised numerals restore the smaller ink height and calmer proportions while preserving the authored badge and numeral constructions. The source variation between the two tiny 5 instances is retained in the evidence rather than treated as a demand for dense pixel fitting. The maple Highway 1 and small Mile 0 instances were reviewed separately; this pass changes the five ordinary shields.

## Source vintages and notices

The source notices live under [`public/illustrated-map/notices/geographic/`](../public/illustrated-map/notices/geographic/NOTICE.md). There is no blanket licence covering all geographic inputs.

| Source                                                                                                                                                                                                           | Edition or currency                                                                                                                         | Terms and attribution                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/)                                                                                                                                                             | Version 2.3.7, released 15 June 2017; full source resolution, levels 1-4                                                                    | LGPL version 3 or later. Exact release licence/README and LGPL/GPL texts accompany the derived data notice.                                                                                                                                                                 |
| [Freshwater Atlas lakes](https://catalogue.data.gov.bc.ca/dataset/cb1e3aba-d3fe-4de1-a2d4-b8b6650fb1f6) and [manmade waterbodies](https://catalogue.data.gov.bc.ca/dataset/055fd71e-b771-4d47-a863-8a54f91a954c) | Official service retrieved 26 November 2026. Catalogue data dates list 2006 and 2008; the 2026 catalogue modification is not a survey date. | Open Government Licence - British Columbia.                                                                                                                                                                                                                                 |
| [2021 Census digital province boundaries](https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/0)                                                                                | Reference date 1 January 2021; service publication 21 September 2022                                                                        | Open Government Licence - Canada, explicitly declared in the acquired service's [item metadata](https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/info/iteminfo).                                                                        |
| [National Road Network](https://open.canada.ca/data/en/dataset/3d282116-e556-400c-9306-ca1a3cada77f)                                                                                                             | Service snapshot retrieved 26 November 2026. Catalogue modification: 18 December 2024; temporal-coverage field ends May 2020.               | Open Government Licence - Canada. Segment currency may vary.                                                                                                                                                                                                                |
| [WSDOT State Route Lines](https://data.wsdot.wa.gov/geospatial/DOT_TDO/LRS/24kLRS.htm)                                                                                                                           | Snapshot effective 31 December 2025; metadata publication 27 April 2026                                                                     | WSDOT source notice: no access constraints; its liability/fitness terms apply. No CC or OGL licence is asserted.                                                                                                                                                            |
| [Canadian Geographical Names](https://open.canada.ca/data/en/dataset/e27c6eba-3c5d-4051-9db2-082dc6411c2c)                                                                                                       | Official records retrieved 26 November 2026                                                                                                 | Open Government Licence - Canada.                                                                                                                                                                                                                                           |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html)                                                                                              | 2025 Washington places file                                                                                                                 | US Government data, credited to the Census Bureau. Its copyright policy describes no copyright protection in the United States for employee works, with stated exceptions and possible foreign protection; no worldwide public-domain dedication or CC0 status is asserted. |
| [BC BEC Map](https://catalogue.data.gov.bc.ca/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3)                                                                                                                      | Version 13.1; contextual display source published 8 July 2026                                                                               | Open Government Licence - British Columbia. This map uses a generalized style extent, not an analytical ecological boundary.                                                                                                                                                |

These editions have different purposes and dates. The finished map is a sourced geographic illustration, not a surveyed legal boundary, complete hydrographic inventory, navigation product, current forest map or live road-status service. Source generalization and positional uncertainty are additional to the measured display simplification.

## Implementation and exports

The final artboard contains **6,289 dry-land polygons**, **1,183 inland-water holes**, **15 road groups**, **24 source place anchors** and **seven route shields**. These are the frame-clipped drawing counts, so they differ from the padded source-component counts. Eight geographic point checks confirm Vancouver, Victoria, Whistler and Calgary as land, and the Strait of Georgia, Juan de Fuca Strait, Okanagan Lake and the official Kamloops Lake interior point as water. `Geographic-provenance.json` retains their coordinates and results.

- `src/lib/illustratedMap/geographic.ts` renders the common geographic geometry with the reconstructed drawing system.
- `src/lib/illustratedMap/geography.generated.json` contains the compact projected paths, geographic anchors and provenance used by the app.
- `scripts/illustrated-map/build-geographic-map.py` reads local WGS84 geography, roads and anchors, plus their provenance, and generates the drawing data. It does not fetch or trace artwork.
- `scripts/illustrated-map/export-geographic.ts` creates the SVG layers, element catalogue, provenance, and self-contained offline review page from the same renderer.

To rebuild the drawing geometry with supplied local inputs:

```sh
python scripts/illustrated-map/build-geographic-map.py \
  --geography /path/to/geography.geojson \
  --land-provenance /path/to/land-provenance.json \
  --roads /path/to/combined-routes.geojson \
  --places /path/to/anchors.geojson \
  --road-provenance /path/to/combined-road-provenance.json
```

The Python builder requires Shapely and pyproj. Its input acquisition and shared-topology preparation are separate from the app build. Full-detail GSHHG/FWA archives stay outside the application; the app uses only the compact derived geometry and source notices.

To export:

```sh
node --import tsx scripts/illustrated-map/export-geographic.ts /absolute/path/to/output
```

The output includes the full geographic map, base land/water, literal land mask, northern and all-BC hatch alternatives, separate transparent forest/roads/lettering/illustration layers, schematic reference, 64 individually editable elements, the hatch swatch, and `Geographic-provenance.json`. `geographic-northern-hatch.svg` contains the complete northern variant; `geographic-northern-forest.svg` contains its transparent hatch layer. The offline review embeds the engine and source preview, works directly from disk, and regenerates SVG downloads from the selected hatch, composition, coverage and layer state. Select **Northern BC · reference style** to use the new coverage; the coastal default and all-BC option remain available.

The five hatch controls remain seed, spacing, band height, stroke width and curvature. Geographic coverage and layer controls do not alter source road or place coordinates. The SVG layer groups, metadata, actual place coordinates and route IDs remain available to inspect or edit independently.

## Reusing the style elsewhere

The hatch, the land rule and the map frame are not tied to BC.

- **The hatch is a saved recipe.** The generator lives in the toolkit (`@pgmaps/geo-toolkit/patterns`). `src/lib/illustratedMap/hatching.ts` wraps it and produces byte-identical SVG: all 77 SVGs of the v5 export were regenerated unchanged after the move. An `OrganicHatchRecipe` records the pattern type and version, seed, spacing, band height, stroke width, curvature, colour, opacity, origin and scale. `ORGANIC_HATCH_PRESETS['northern-bc-reference']` is this map's field; other presets are general treatments.
- **Pattern field, coverage and land mask stay separate.** The painted area is _coverage ∩ dry land_. The coastline clips the strokes and never steers them. Coverage shapes share one clip, so overlapping coverage is inked once; the land clip uses even-odd, so lakes stay clear and islands are painted.
- **Density is predictable.** `organicHatchStrokes` keeps the recipe's spacing for any window and refuses a window it cannot draw at that density. Neighbouring windows share the field's origin and draw identical strokes where they meet. Only the artboard writer used by this map widens its spacing past 30,000 strokes, and it records that as `data-budget-limited`.
- **The region is configuration.** `build-geographic-map.py --region region.json` replaces any of the BC settings: frame, view bounds, margin, footer, EPSG code, the region and coverage feature kinds, road jurisdiction, compass position, motifs, trees, shields and land/water checkpoints. Without `--region` the output is unchanged; the old and new scripts were run on the same input and wrote identical bytes. A configured region also records its name and kinds under `region`.
- **Any region prints through the sheet renderers.** `src/lib/illustratedMap/regionSheet.ts` draws a generated geography with a recipe as sheet operations. `scripts/illustrated-map/compose-region.ts` writes it as an editable SVG and a one-page vector PDF; in both, the hatch strokes are cubic curves.

```sh
python scripts/illustrated-map/build-geographic-map.py ... --region island-region.json --output island.json
node --import tsx scripts/illustrated-map/compose-region.ts island.json out/ --preset northern-bc-reference
node --import tsx scripts/illustrated-map/compose-region.ts src/lib/illustratedMap/geography.generated.json out/ --coverage region
```

When this was added, the BC geography and a synthetic island region were checked. The island has a lake and an offshore islet and uses EPSG:3035. Both PDFs have one page and no raster images. In 2× renders, no hatch fell outside the land mask beyond the one-pixel edge band: 0 of 4,007,159 water pixels for BC, and 0 of 2,024,132 for the island. The lakes are clear and the islet is hatched.

Map sheets offer the same field as the **Organic hatch** area pattern. Its seed, spacing, band height, stroke width and curvature are saved with a layer's look. It prints as curves in SVG and PDF. On the live map it becomes a 512-pixel tile that repeats without seams; the tile's field is blended to repeat, so its waves are calmer than in print. QGIS, ArcGIS Pro, SLD, MapLibre, GeoLibre and KML exports receive a near-vertical straight hatch at the same spacing, with a note in the bundle's README.

## Page 8's own hatch

The northern hatch on page 8 of the brand guidelines is not one continuous banded field. Measured on its embedded 1536 × 945 image, it is built like this:

- Short strokes about 3 px apart, 8.6 px long and 1.2 px wide sit in rows about 11 px tall.
- The rows are stacked ribbons. Neighbouring ribbons wave together every 60–100 px, and stay nearly parallel down the stack.
- Each stroke stands square to its ribbon, so strokes lean where the ribbon slopes: a median of 6° from vertical, with a tenth of them past 25°, more often to the right.
- The field is a mosaic of wide, irregular patches. Each patch leans its own way, and its ribbons stop against the next patch's.
- About a third of the area is inked.

The continuous field used so far draws longer strokes (11–12 px) in taller bands (13–14 px), and leans only half as far (90th percentile 12–15°).

`hatchStyle: 'patch'` draws page 8's texture, with the toolkit's patch field (`patchHatchStrokes`, preset `page-8-reference`). It was fitted with `scripts/illustrated-map/measure-hatch.py`, which measures a rendered hatch the same way as page 8:

|                                         | page 8    | patch field | continuous field |
| --------------------------------------- | --------- | ----------- | ---------------- |
| ink coverage                            | 0.32–0.33 | 0.32        | 0.19–0.38        |
| stroke spacing                          | 3         | 3           | 3                |
| band period                             | 8–12      | 11          | 13–14            |
| stroke length (median)                  | 8.5–8.9   | 8.6         | 11–12            |
| lean from vertical, median abs          | 6–6.7°    | 6.5°        | 4.5–5.6°         |
| lean from vertical, 90th percentile abs | 25–28°    | 26°         | 12–15°           |

Each patch is generated on its own, from the seed and its lattice position. A stroke that crosses a seam is cut there and kept by the patch holding its longest piece. As a result, any window of the field, anywhere, draws exactly what a larger window draws there. The same holds for map tiles and print pieces, and the cost doesn't grow with distance from the origin.

The workshop's **Hatch style** chooses **Page 8 · patches**. The export adds `geographic-northern-page8.svg`, its transparent forest layer and `hatch-page8.svg`. Every earlier export is unchanged, because the default style is still the continuous field. Map sheets offer the same field as the **Patch hatch (page 8)** area pattern.

## The hatch on a live map

The workshop's **Live map** tab (`/dev/illustrated-map?view=live`) shows the same recipe and coverage on a MapLibre map, through the toolkit's `MapHatchLayer`.

- Each 512 px tile is a window of the open field, drawn in a worker. It is inked only on BC land (lakes as holes) within the chosen coverage, on the same 4 × 4 sample grid as the strokes.
- Tiles of one recipe meet without a seam, so a pan shows more of the same field. Nothing repeats, unlike the 512 px `fill-pattern` tile a map sheet uses.
- The field is anchored to the ground at the land's north-west corner, and measured in CSS pixels at each tile's zoom. Its strokes keep their size on screen up to the last field zoom: 13 for the patch style and 10 for the continuous field, whose cost grows with distance from the anchor. Past that, MapLibre enlarges the last level's tiles and the strokes grow with the ground.
- The land is the drawing's own, put back on the ground (`liveGeography.ts`). It undoes the artboard fit, inverts BC Albers with proj4, and nests the even-odd rings into polygons by their winding. All eight land/water checkpoints come back within 0.002° of their source coordinates.

Measured with `scripts/map-loading/measure.mjs` and `setups/illustrated-live-hatch.mjs` (docs/map-layer-loading.md, **What was measured**):

- The layer was on screen on every frame of a drag, a zoom in, a zoom out and a change of style.
- A drag left 0.9% of the view waiting; a fast zoom-out left 9.6% waiting, filled 0.4 s later.

## A real region outside BC: Te Waipounamu / South Island

The synthetic island showed that the pipeline was not tied to BC. New Zealand's South Island shows it on real geography with the same parts: fjords like BC's coast, large lakes, an offshore island (Stewart Island), two main highways (State Highways 1 and 6), and its own projection (EPSG:2193, NZTM2000).

- `scripts/illustrated-map/prepare-natural-earth-region.py` turns Natural Earth 1:10m GeoJSON (public domain; edition and input SHA-256 recorded) into the build script's inputs for any bounding box:
  - land and minor islands, with lakes cut out;
  - the region's land, minus excluded parts (here the North Island's tip);
  - a coastal coverage: land within `--coast-km` of the sea, as decorative as BC's coastal style;
  - the chosen roads, and the places on the region.
- `scripts/illustrated-map/regions/south-island.json` is the region config. It has a portrait frame (1100 × 1300) and eight checkpoints (three lakes, two seas, Christchurch, Fiordland, Stewart Island), which the build verifies. The four route shields are snapped onto SH1 and SH6.
- `src/lib/illustratedMap/regions/south-island.generated.json` is the result: 21 land polygons and 17 lake holes.

```sh
python scripts/illustrated-map/prepare-natural-earth-region.py --ne-dir <natural-earth geojson> \
  --bounds 164.5,-48.6,176.5,-39.4 --exclude 174.4,-41.75,178,-38 --epsg 2193 --coast-km 25 \
  --road-labels SH1,SH6,SH8,SH73,SH94,SH7 --primary-roads SH1,SH6 --jurisdiction NZ --out <dir>
python scripts/illustrated-map/build-geographic-map.py --geography <dir>/geography.geojson \
  --land-provenance <dir>/land-provenance.json --roads <dir>/roads.geojson --places <dir>/places.geojson \
  --road-provenance <dir>/road-provenance.json --region scripts/illustrated-map/regions/south-island.json \
  --output src/lib/illustratedMap/regions/south-island.generated.json
node --import tsx scripts/illustrated-map/compose-region.ts src/lib/illustratedMap/regions/south-island.generated.json <out> --preset page-8-reference
```

The first, landscape frame showed far more ground than the data covered. The build refused it (“Source land/water coverage misses … square metres”) instead of drawing that ground as ocean.

With the page 8 recipe, both coverages (coastal, and all of the region) make one-page vector PDFs with no raster images. In 2× renders, no hatch fell outside the land mask beyond the one-pixel edge band (0 of 4,277,296 water pixels), and every water checkpoint is water.

Natural Earth's 1:10m data is generalised. Small lakes and islands are missing, and Iceland, tried first, has no lakes at all at this scale. One of its two “Lake Te Anau” features is a sub-pixel sliver; a checkpoint taken from it was water to the build but invisible in the drawing, so checkpoints use the main lake's interior point.

## Channel gap and export structure

**Channel gap.** At about a kilometre a pixel, Johnstone Strait and Discovery Passage are hairlines, and the hatch strokes bridge them. Vancouver Island is its own shape in the data, but it read as part of the mainland. `channelGap` (drawing units, default 0) masks the land and its hatch with the coastline's stroke, keeping that much water along every shore. The land path itself is unchanged, and the frame edges get no water line. The workshop starts at 1.2 (about a kilometre) with a **Channel gap** slider. The page 8 export, the live map and `compose-region.ts --channel-gap` draw the same gap; every earlier export keeps 0.

**Export structure.** The sheet drawing model (`src/lib/mapSheet/drawOps.ts`) writes the same structure to SVG and PDF:

- `group` / `endGroup`, with `layer: true`: named layers. In SVG these are Inkscape layers, which Illustrator imports as layers too. jsPDF cannot write optional content groups, so a PDF keeps only their drawing order.
- `symbol` / `use`: a symbol drawn once and placed by position, scale and rotation (counter-clockwise, as icons turn). In SVG it is a group in `<defs>` placed with `<use>`; in PDF it is one form XObject drawn with `Do`.
- `textPath`: text along a line, run left to right so it reads upright. In SVG it stays editable as `<textPath>`. In PDF each glyph is placed and turned along the line with the same Helvetica widths, every halo first. `baseline: 'middle'` centres the letters on the line. `smoothedPath` evens out a winding road under a label.

`regionSheetOps` uses all three:

- layers named Water, Land, Hatch, Roads and Places;
- one place mark placed at every town;
- each primary route's number set along its longest stretch.

In the South Island PDF the place mark is one form XObject, placed 19 times.

## Page 8 edition

`PAGE8_EDITION` draws the map the way the guide's page 8 does (`geographic-page8.svg`; `geographic-page8.pdf` is its vector print):

- **Coverage `page8`.** All of BC west and north of the journey region is hatched with page 8's patch field. The journey region is left white. It is `PAGE8_JOURNEY_REGION`: a Catmull-Rom curve through anchors set off the real places (Mount Robson, Helmcken Falls, Lillooet, the Sea to Sky Gondola, Vancouver), closed east along the frame. The style clip is the frame less that region, even-odd; land still clips first. On the live map, `liveHatchAreas('page8')` gives the same area in longitude and latitude.
- **Compass.** The top-left compass is the reference badge. Its BC inset colours the journey region itself: the same polygon taken from artboard units back to BC Albers, then into the inset's units by `COMPASS_INSET_FROM_ALBERS`. That transform is the inset's own uniform scale plus two offsets, fitted on BC's 49° N / 114.0683° W and 60° N / 120° W corners (`compassInset.test.ts`). Roads stop at the compass ring.
- **Labels `page8`.** Only the names page 8 prints; the secondary towns are left out. The lettering is the outlined Great Forest glyphs every geographic export uses.
- **Channels open.** `channelGap` 1.2, as in the workshop.
- **Vector print.** `vectorMasks` draws the channel gap as a water-coloured stroke over land and hatch, and the compass and illustration clearances as even-odd clip paths. On screen it is the same as the masks, but Chromium's PDF turns SVG masks into 300 ppi images. With it the printed PDF has no images: `node scripts/illustrated-map/svg-to-pdf.mjs geographic-page8.svg geographic-page8.pdf`.

The workshop's **Page 8 edition** button sets all of these, and _Page 8 labels only_ switches the label set by itself.

## Lakes and waves

**Lakes off.** `lakes: false` (the workshop's _Lakes_ checkbox) fills every lake as dry land. `landPath(kind, false)` leaves out the lake holes, which the build writes with the opposite winding to the land, and the islands inside them: once a lake is land, an island in it would keep a shoreline and a channel gap in the middle of the province. BC's lakes and reservoirs hold about 3,800 such islets; 2,250 rings remain, the coast and its islands. The land, its hatch and the channel gap all use the filled path. On the live map, `liveHatchAreas(coverage, false)` and `liveLandGeoJson(kind, false)` do the same. The basemap keeps its lakes, so the map is not reloaded, and the filled land is drawn over it. Lakes stay on by default.

**Waves on water.** A wave motif's coordinate is rounded, and at this scale the Central Coast and Juan de Fuca are full of islands: two waves sat on land. `drawnMotifs()` moves each wave to the nearest spot where its box, with a 3-unit margin, touches no land. It searches rings 3 units apart out to 150 units, and lakes count as land here. `boxTouchesLand` tests the box against every outer land ring, indexed in runs of 64 edges. The search runs once, in about 0.2 s. The north wave moved 45 units west into Queen Charlotte Sound; the orca wave moved 39 units west, off Cape Flattery. The west wave was already clear. Other motifs are drawn as built.

## Cleaning up small shapes

At this scale one drawing unit is 982 m on the ground, so a square unit is about 0.96 km². The frame's land has 6,289 outer rings and 1,183 lakes.

| left out            | rings | path points        | land area       |
| ------------------- | ----- | ------------------ | --------------- |
| islands under 1 km² | 5,885 | 46%                | 0.03%           |
| islands under 4 km² | 6,070 | 50%                | 0.06%           |
| lakes under 2 km²   | 517   | 21% of lake points | 5% of lake area |

The islets are what reads as specks offshore: almost every ring, almost none of the land. The lake data already stops at about 1 km², but the 500 lakes between 1 and 2 km² are pin-holes in the hatch. `minIslandKm2` and `minLakeKm2` (the workshop's _Smallest island_ and _Smallest lake_) leave them out, through `landPath(kind, filter)`. A filled lake takes its islets with it, and an island left out takes its own lakes. Leaving out islands under 1 km² also makes the SVG about 14% smaller. The page 8 edition uses 1 km² and 2 km². Hatching only the larger islands was tried and dropped: the small ones turned into white specks instead of hatched ones.

## Hidden road stretches and the compass

`hiddenRoads` leaves out a road's parts on the landmass holding a place. `VANCOUVER_ISLAND_HIGHWAY_1` is `{ road: 'bc-1', landmassOf: 'victoria' }`: Highway 1 from Victoria north to Nanaimo. The mainland stretch from Horseshoe Bay east is kept. `drawnRoads()` takes out each subpath whose middle point lies on Vancouver Island's outer ring. The page 8 edition hides it; the workshop's _Highway 1 on Vancouver Island_ turns it back on.

`compassLettering: 'smallcaps'` sets the compass's BC in Great Forest Small Caps outlines, 17 units tall on the badge lettering's baseline, in place of the constructed badge letters. It applies to either compass, the page 8 one or the catalogue one. N, E, S and W keep their badge letters.

## Map themes

A map theme is the map's look as one file: a ZIP with `theme.json`, its fonts under `fonts/`, and a `README.txt` that lists each font's licence (`mapTheme.ts`). `theme.json` holds:

- `hatch`: a saved `OrganicHatchRecipe`, as `compose-region.ts --recipe` reads.
- `map`: coverage, label set, channel gap, lakes, smallest island and lake, hidden road stretches, compass lettering, vector masks.
- `fonts`: each with an id, a file, a family, its SHA-256, a licence note, and whether its lowercase are capital-shaped alternates.
- `lettering`: which font sets the `places` (place names, ALBERTA and USA, the compass's BC), the `regions` (RAINFOREST, CANADIAN ROCKIES) and the `body` (the footer). A role left out uses the built-in Great Forest, or Arial for the body.

**Fonts.** Place and region names stay outlined glyphs. `letteringFontFromBytes` reads a theme's TrueType, OpenType (CFF) or WOFF font with opentype.js and gives `lettering()` its outlines, advances and bounds. Read from the same files, these match the committed `fontGlyphs.generated.json` (`mapTheme.test.ts`). The website Small Caps and v2 Simplified are exactly the files the built-in lettering was outlined from. The body font is embedded in the SVG as `@font-face`. WOFF2 is refused: opentype.js cannot read it.

**Reading a theme** checks, before any font is parsed:

- paths (only `theme.json`, `README.txt` and `fonts/…`; no `..` or absolute paths);
- sizes (40 MB ZIP, 60 MB expanded, 12 MB a font, 12 fonts);
- the JSON's shape and ranges, and that every lettering role names an included font;
- each font's SHA-256 against `theme.json`;
- each font's signature against its extension.

Writing a theme works out the checksums from the bytes it writes.

**In the workshop**, _Map theme_ lists the built-in themes (`mapThemePresets.ts`) and imported ones. Imports are kept in IndexedDB (`mapThemeStore.ts`), so they survive a reload. _Import theme_ reads a ZIP; _Export current settings as a theme_ writes the workshop's settings with the fonts of the theme in use. The built-in themes:

- _Page 8 · Great Forest_: the page 8 edition, lettered in the website Small Caps and v2 Simplified, footer in BC Sans.
- _Page 8 · Great Forest 2015_: the same, lettered in the 2015 Vancouver Island North builds.
- _Coastal · continuous bands_: the first edition, with the built-in lettering.

The palette is not part of a theme yet: the map's colours are still `MAP_PALETTE`. A hatch recipe's colour is kept in the file but not applied.

Brand kits (`src/branding`) are separate: they style reports and documents. A map theme styles the illustrated map, and carries its own fonts so it works on its own.

## Great Forest on map sheets

The Great Forest fonts are committed under `public/illustrated-map/fonts/great-forest/` for this test project (their README has the copyright and licence notes). Any sheet text can name `family: 'great-forest'` (Small Caps) or `'great-forest-display'` (Simplified):

- **Layout.** `textWidth` uses the font's own advances, from `greatForestMetrics.generated.json` (`build-great-forest.py`). A character the font lacks takes its base letter's advance, so labels centre and run along paths as they print.
- **SVG.** `standaloneSheetSvg(…, { fonts })` embeds the WOFF as an `@font-face` data URL, so the text stays text and editable.
- **PDF.** `registerGreatForestPdf` adds the TTF to jsPDF as an Identity-H font, and `drawSheetPdf` sets those families in it.

`compose-region.ts --lettering great-forest` sets a region sheet's place names in upper-case Small Caps, and its route numbers along the road, in Great Forest.
