# Map styles in other programs: limits and checks

This guide covers how the road tool's GIS exports carry their look into QGIS, ArcGIS Pro, GeoServer,
MapLibre and GeoLibre, and how a style from one of those programs comes back in. It says which
files each export writes, where each symbol comes from, what each format cannot draw exactly, and
how the files were checked.

## Before you rely on it

- **The symbols are the plan's own.** Every exported style is written from the symbols the plan and
  the block sheets already draw (`src/lib/forestry/blockSheet/styles.ts`, `symbolCatalogue.ts`,
  `planSheetSymbols.ts`), through one model (`src/lib/styleExchange/model.ts`). Nothing is
  re-entered per format, so a colour changed in `styles.ts` reaches every export.
- **Read the README in each zip.** It says how to open the bundle and lists every symbol part a
  format could not carry exactly. The Save & export preview shows the same list.
- **Keep the folder together.** QGIS and ArcGIS Pro files find their data by relative path
  (`data/…`).
- **An imported style changes the exports only.** The plan, its legend and the block sheets keep
  PGMaps' symbols (AGENTS.md: the three classify context the same way and must agree).
- **Fonts and pictures are not imported.** A symbol drawn from a font glyph (ArcGIS character
  markers, QGIS font markers) or from a picture is reported, not traced: choose a PGMaps icon.

## What each export writes

| Output (Save & export → GIS data) | Files                                                                                                                                                                                                                                      | Opens in                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Shapefile                         | `road_centrelines`, `road_stations`, `road_culverts` shapefiles, and beside each a `.qml`, an `.sld` and a `.lyrx`                                                                                                                         | Any GIS; QGIS loads the `.qml` with the layer automatically |
| QGIS project                      | `<project>.qgz`; `data/` with the road layers plus `context_lines` (streams, existing and deactivated roads) and `context_areas` (constraints, other blocks), each with its `.qml`; `layouts/` with the four block sheet layouts as `.qpt` | QGIS 3.28 and later, including 4.x                          |
| ArcGIS Pro map                    | A `.lyrx` per layer, `<project>.mapx`, `layouts/*.pagx`, `styles/*.stylx` (every PGMaps symbol), `data/`                                                                                                                                   | ArcGIS Pro 3.x (see [Checks](#checks))                      |
| Web map styles                    | `maplibre/style.json` with the data inline and `sprite(@2x).json/png`; `geolibre/<project>.geolibre` and a `.geolibre.style.json` per layer; `sld/*.sld`; `geojson/*.geojson`                                                              | MapLibre GL, GeoLibre, GeoServer, QGIS                      |
| Symbol library                    | Every catalogue symbol as a QGIS style library (`qgis/*.xml`), an ArcGIS Pro style (`arcgis/*.stylx`) and a GeoLibre style library (`geolibre/*.json`)                                                                                     | QGIS Style Manager, ArcGIS Pro Styles, GeoLibre             |

Roads take the proposed-road symbol in each road's own colour and are labelled with their names.
Context takes the sheet symbol `contextSheetKey` gives it (`exportStyles.ts`); a deactivated road
takes the existing-road symbol with the deactivation crosses on it, as the plan draws the two.
Culverts and stations take the plan's colours.

## Rules and first match

A layer's rules are tried in order and the first match draws the feature, as in the plan. QGIS's
rule-based renderer and SLD draw every rule that matches, so those writers make each rule's
filter exclude the ones above it; a rule list of `=` tests on one field becomes a categorized
renderer (QGIS) or a unique value renderer (ArcGIS) instead.

## Importing a style

Save & export → a styled output → **Styles**. Import a `.qml`, `.qgs`/`.qgz`, `.qpt`, QGIS style
`.xml`, `.sld`, MapLibre `style.json`, `.lyrx`, `.mapx`, `.pagx`, `.stylx`, `.geolibre` or
`.geolibre.style.json`, or a `.zip` of them (an exported bundle reads back whole). Every symbol
found is listed with a swatch and what was approximated; tick the ones to keep and **Save to
library**. Then choose a saved style for a feature under **Exported features draw with**. The
library is kept in this browser (`styleLibrary.ts`, storage key
`pgmaps.forestryRoads.styleLibrary`), never in the project file; the README of an export that used
one names it.

## Limits and budgets

| Limit                      | Value           | Enforced in                                | What happens when exceeded              |
| -------------------------- | --------------- | ------------------------------------------ | --------------------------------------- |
| Style file or zip          | 50 MB           | `readStyleFile.ts`, `MAX_STYLE_FILE_BYTES` | Refused, naming the file                |
| Style files in one zip     | 200             | `readStyleFile.ts`, `MAX_ZIP_STYLE_FILES`  | Refused                                 |
| XML file                   | 16 MB           | `xml.ts`, `MAX_XML_BYTES`                  | Refused; XML entity declarations always |
| Saved styles               | 200 per browser | `styleLibrary.ts`, `MAX_SAVED_STYLES`      | Refused until some are deleted          |
| Widths, sizes and spacings | 0–500 pt        | `checkedSymbol.ts`, `MAX_SYMBOL_POINTS`    | The symbol is refused                   |
| Strokes, hatches, markers  | 16 per symbol   | `checkedSymbol.ts`                         | The symbol is refused                   |

## What each format approximates

Writing PGMaps' symbols out:

| Symbol part              | QGIS (`.qml`, `.qgz`, style `.xml`)                | ArcGIS Pro (CIM: `.lyrx`, `.mapx`, `.stylx`)                                        | SLD 1.1                                                                                                 | MapLibre                                      | GeoLibre                                                                  |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Stacked strokes, offsets | Exact                                              | Exact; CIM offsets are positive left, so the sign is flipped on write               | Exact; offset sign follows QGIS (positive right), which GeoServer reads mirrored                        | Exact                                         | Main stroke only; offsets lost                                            |
| Dashes                   | Exact                                              | Exact                                                                               | Exact                                                                                                   | Exact                                         | One per layer                                                             |
| Markers along a line     | Exact                                              | Exact spacing; Pro fits patterns to line ends, so end markers can move              | Spacing exact; QGIS ignores the first marker's position                                                 | Spacing exact; MapLibre picks the phase       | Dot or square decoration only                                             |
| Hatches                  | Exact; phase is anchored to the view, not the page | Exact (`CIMHatchFill`, phase as `offsetY`)                                          | `horline` mark turned counter-clockwise, as QGIS writes it; phase lost; GeoServer turns marks clockwise | Sprite tile                                   | Exact SVG tile only when every rule shares it, else the key colour at 50% |
| Marker fills             | Exact                                              | Exact (`CIMMarkerPlacementInsidePolygon`)                                           | Inline SVG tile                                                                                         | Sprite tile                                   | As hatches                                                                |
| Inside casing            | Exact (`draw_inside_polygon`)                      | Stroke moved inward half its width: close, but not clipped at sharp concave corners | Inward offset                                                                                           | Centred on the edge                           | Lost                                                                      |
| Point icons              | Embedded SVG, exact                                | Vector marker drawn from the icon's own shapes, exact                               | `data:` URL, inline SVG and a mark fallback                                                             | Sprite                                        | Custom SVG only when every rule shares the icon, else circles             |
| Labels                   | Exact                                              | Exact (`$feature.FIELD`, halo)                                                      | Exact                                                                                                   | Needs a glyphs URL; without one, no labels    | Exact                                                                     |
| Range rules              | Exact                                              | Class breaks one floating-point step below our upper bound, so both ends match      | Exact                                                                                                   | Exact; a missing value falls to the else rule | Exact                                                                     |

MapLibre refuses a relative sprite URL, so `style.json` says `./sprite`: replace it with the absolute
URL of the hosted folder, or rewrite it with `transformStyle`. The MapLibre style carries the data
inline; GeoLibre's project does too.

Reading other programs' symbols in:

| Format     | Read                                                                                                                                                                                                                                             | Reported, not read                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QGIS       | Simple lines and fills, line and point pattern fills, marker lines, simple markers (as the nearest PGMaps icon, warned), PGMaps' own SVGs; single, categorized, graduated and rule renderers with `=`, `IN` and range expressions; simple labels | Foreign SVGs and font markers (choose a PGMaps icon); other expressions; nested rules under a filtered rule; brush hatches and hash lines are approximated with a warning |
| ArcGIS Pro | Solid strokes and fills, dashes, offsets, hatches, vector markers PGMaps wrote; simple, unique value (one field) and class breaks renderers; PGMaps' own Arcade rules                                                                            | Character (font) and picture markers, gradient fills, foreign vector markers, other Arcade, unique values on several fields, text symbols and north arrows in a `.stylx`  |
| SLD        | Line, polygon and point symbolizers with the filters PGMaps writes, ranges typed as numbers                                                                                                                                                      | Expressions beyond comparisons; external graphics that are not PGMaps' SVGs                                                                                               |
| MapLibre   | `line`, `fill`, `circle` and `symbol` layers grouped by source, `==`/`in`/`match`/`all` filters                                                                                                                                                  | Sprite icons and patterns from other styles (a dot is substituted and reported); data-driven paint; filters on more than one field                                        |
| GeoLibre   | Projects, URL styles and Style Manager libraries: the flat style                                                                                                                                                                                 | Everything the flat style does not hold                                                                                                                                   |

Tested on real files: OS Open Zoomstack's SLDs and MapLibre style, OpenMapTiles Positron, Esri's
`dictionary-renderer-toolkit` and `arcgis-pro-sdk-community-samples` layer and style files, and
files QGIS 4.3 saved from PGMaps' own. These samples are not committed; the unit tests use small
self-authored files shaped like them.

## Checks

| What                            | How it was checked                                                                                                                                                                                                                                                               | Result                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| QGIS files                      | `scripts/style-exchange/qgis-check.py` in the `qgis/qgis` container: each `.qml` loads with its shapefile, renderer and symbol layers match, every feature is drawn by the rule PGMaps uses, the `.qgz`, layout and `.qpt` open, the library imports, QGIS's own saves read back | QGIS 4.3: 101 checks pass. Run `style-exchange-qgis.yml` (by hand) for 4.x and 3.40                                    |
| The real exports from this page | The training example's five downloads opened in QGIS 3.40: every shapefile with its `.qml` and `.sld`, the `.qgz` with its layouts and templates, the web bundle's SLDs, the library                                                                                             | QGIS 3.40.15, 14 November 2026: 40 checks pass; every feature drawn; the four layouts export                           |
| SLD                             | `xmllint --schema` against the OGC SLD 1.1 / SE 1.1 / Filter 1.1 schemas; GeoStyler's SLD parser; QGIS 4.3 load and render                                                                                                                                                       | All valid; drawn as on the plan                                                                                        |
| MapLibre                        | `validateStyleMin`; rendered in headless Chromium with the repo's `maplibre-gl`                                                                                                                                                                                                  | Valid; drawn as on the plan                                                                                            |
| GeoLibre                        | `@geolibre/core` `parseProject` and `normalizeStyleLibraryEntries`; render layers compared with GeoLibre's own `buildGeoLibreQueryStyle`                                                                                                                                         | Nothing dropped; render layers identical                                                                               |
| ArcGIS Pro                      | GeoStyler's `.lyrx` parser; a key-by-key comparison with 19 Pro-written files and the CIM specification; the `.stylx` schema and `meta` rows compared with Esri's `Parks.stylx`                                                                                                  | Parsed as Esri's files are; no key outside the samples and spec; schema identical. **Not opened in ArcGIS Pro itself** |

Not yet checked in ArcGIS Pro: that Pro opens the `.lyrx`, `.mapx`, `.pagx` and `.stylx` at all; that
`DATABASE=.\data` resolves from a `.mapx` and `.pagx` as it does from a `.lyrx`; the direction of CIM
offsets, hatch offsets and line-marker placement; and how the layouts' legend, scale line and
north arrow look. Open each file in Pro before relying on it, and record what it shows here.
