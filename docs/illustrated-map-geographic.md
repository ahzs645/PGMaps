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
