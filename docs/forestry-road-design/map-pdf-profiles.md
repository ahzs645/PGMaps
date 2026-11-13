# Adding a company's map PDFs

**Layers → Add files** reads a company's georeferenced map PDFs only when a profile in
`src/lib/geoPdf/profiles.ts` recognizes their template. Everything the reader assumes about a
company's sheets lives in that profile, so supporting another company is one profile, its tests,
and the checks below. What the reader does with a recognized sheet is
[source-pdf-import.md](source-pdf-import.md).

Work through the steps in order. Each one names the report section you read and the profile field
you fill. The Canfor 2026 profile (`CANFOR_PROFILE`) is the worked example throughout.

## Ground rules

- A company's sheets, their renders, the inspection reports and anything traced from them stay with
  the source files. Never commit them, their block or road names, coordinates or logos. Tests read
  real sheets only from a local path in an environment variable.
- A profile records how a template is drawn, never what it means legally: no road status, stream
  class or reserve restriction is inferred from a colour or symbol.
- Never copy another company's thresholds, palette or layer names into a profile, and never take a
  palette from a screenshot. Every value comes from the company's own PDFs.
- A changed profile must leave every other profile's output unchanged (step 6).

## What to ask the company for

1. One of each sheet type they export: field layout, class maps (slope, canopy), imagery. Two or
   three blocks if their templates vary.
2. The GIS layers behind one block (block boundary, roads) to check positions against.
3. Their legend wording, and what the class maps leave undrawn (below the lowest class, no data or
   both).
4. Ideally, one class map exported losslessly (Esri: Deflate instead of JPEG). It gives exact
   classes and measures how much the JPEG ones lose.

## 1. Inspect the sheets

```sh
npx tsx scripts/forestry/inspect-map-pdf.ts /tmp/inspect /local/CompanyMaps
```

For each PDF this writes `<sheet>.inspect.md` and `.inspect.json` to the output folder. The
inspector (`src/lib/geoPdf/inspect.ts`) reports and never decides. It reads unregistered PDFs too,
and says so.

## 2. Recognize the template: `id`, `label`, `matches`

Read the report header and the **Layers** table.

- `matches(creator, layers)` gets the PDF's creator and every optional-content layer name. Require
  the creator family (`/ArcGIS/`) and three or four layer names this template always has and other
  templates are unlikely to share. Canfor uses its block, road, stream and reserve layer names.
- Run the inspector over every supported company's sheets too: a new `matches` must not accept
  them, and **Recognized by** must name the right profile for each sheet.
- `id` is versioned (`company-arcgis-2027-v1`). When the rules change in a way that changes what is
  extracted, make a new id; saved projects keep the label they were read with.
- `PDF_PROFILES` is tried in order: put a more specific profile before a more general one.

## 3. Map frame and CRS

The header lists each map frame: CRS, EPSG, size, metres per point and the control-point fit.

- The reader takes one registered rectangular frame per page. Multiple frames or a non-rectangular
  frame are refused, not guessed.
- The fit is the embedded controls' residual (refused over 3 m), not positional accuracy.
- A contour terrain needs an EPSG the road tools accept: BC Albers, or NAD83, NAD83(CSRS) zone 10 or
  WGS84 UTM zones 7–11. `projectedEpsg` (`georeference.ts`) decides from the projection's
  parameters, in Esri or OGC spelling. Anything else gets drawings and class layers but no terrain.

## 4. Drawing layers: `rules`

Read the **Layers** table: each innermost layer, the layers it sits inside, how many paths it
strokes and fills, their colours, the share inside the map frame, and the rule it matches now.

- A rule's `match` is an anchored regular expression for the innermost layer name. The reader walks
  outward through enclosing layers until a name matches, so a sublayer can inherit its group's rule.
  Check the **Inside** column for groups that hold labels or masks.
- `shape`: `line` for layers that only stroke, `polygon` for filled ones. `compound: true` keeps a
  layer's paths as one `MultiLineString` (streams drawn as many dashes).
- **White fills and strokes are halos and masks.** Canfor's contour group has "- Index" and
  "- Default" sublayers that are only the white boxes behind labels. Never write a rule for them.
- `selected` is the dialog's starting tick. Keep context layers (field lines, contours) off.
- `contour: true` marks the contour lines: they are collected for a terrain surface, never a
  reference layer, and only stroked paths count. Put the contour layer here, not in a normal rule.

## 5. Contour heights: `contours`

Read **Numbers inside the map frame**, then **Numbers lying on a drawn line, by that line's layer**.
The contour layer is the one with many numbers on its lines, a plausible elevation range and one
step. Canfor's field sheet shows its contour layer with a step of 10.

- `contours.statedInterval`: a pattern for the legend text that states the interval, with the
  interval as its first group (Canfor: `/^Contours\s*-\s*(\d+)\s*m$/i`). Look in **Text outside the
  map frame**. Without it the reader takes the largest step at least 80% of labels sit on.
- `contours.label`: only when heights print with more than digits ("1200 m"). The default is an
  optionally signed whole number of 1–5 digits. The reader keeps a label only when it lies on
  exactly one contour line, so stray numbers on other layers do no harm.
- The inspector's numbers-on-lines check considers every layer and ignores white strokes. The reader
  considers only the contour rule's lines, so it usually finds more (step 7 shows the reader's
  count).

## 6. Class rasters: `rasters`, `legend`, `transparentFill`

Read **Images**, **Colours drawn in lossless images** and **Legend swatches**. Each raster is a
`RasterProfile` (`rasterProfiles.ts`).

| Field                          | Where it comes from                                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`, `unit`                 | `canopy` (m) or `slope` (%). Other kinds need a code change (`PdfClassGrid.kind`).                                                                                                                                                |
| `layer`                        | The layer named in the image rows' **Layers** column. Every tile of one raster must sit on one native pixel grid; the reader refuses resampling.                                                                                  |
| `alpha`                        | The non-zero value in **Alpha values** (Canfor canopy 255, slope 216). Pixels with another alpha stay unknown.                                                                                                                    |
| `heading`, `classes[].label`   | The legend heading and each class label exactly as printed, from **Legend swatches** and **Text outside the map frame**. Matching ignores spaces, case and dash style.                                                            |
| `classes[].minimum`, `maximum` | The printed range; `null` maximum for an open class (40+).                                                                                                                                                                        |
| `classes[].aliases`            | Where a colour in **Colours drawn** is more than 2 RGB units (straight-line distance) from its swatch. Canfor's 85+ swatch is `#e81515` but its raster draws `#ff0000`; `#ff8080` against a `#ff7f7f` swatch is within tolerance. |
| `undrawn`                      | What a transparent pixel means. Its `maximum` must equal the lowest printed minimum. Confirm with the company; a layer named "9 Category" printing 8 classes is the kind of evidence that settles it.                             |
| `overlay`                      | A separate lossless mask layer drawing one class over the base (Canfor's black 95+ "Slope Breaks"): its layer, its label and the base class it must agree with.                                                                   |

`legend` is the template's swatch geometry, taken from the swatch boxes: their width and height
ranges (both bounds exclusive), whether they sit to the right of the map frame or anywhere outside
it, and how far a label may start from its swatch and sit off its middle. Leave margin, but not so
much that a neighbouring symbol's box qualifies: every class must find exactly one swatch.

`transparentFill` is the **Under transparent** colour of the class images (Canfor: black). The JPEG
decoder takes it as the colour the encoder saw under transparent pixels.

Two things decide what the class maps can deliver:

- **Is the mask lossless?** If a raster's **Mask** column says lossless and **Alpha values** has
  two values, drawn/not drawn is exact everywhere. If the mask is lossy, stop: the exact split, and
  the decoder that relies on it, do not hold, and that needs its own validated design.
- **Are tiles JPEG?** A **JPEG** column means the coefficient decoder runs (baseline only;
  progressive files fall back to the colour match, recorded in the class grid's notes). Its accuracy was
  measured on Canfor's quality settings (DC step 57, 2 × 2 chroma). For different settings, measure
  again (step 8) before quoting area-share accuracy.

## 7. Try the draft

Write the profile in a local file (not in the repo yet):

```ts
// /local/acme-profile.ts
import { type PdfTemplateProfile } from '/path/to/PGMaps/src/lib/geoPdf/profiles'
export const profile: PdfTemplateProfile = { id: 'acme-arcgis-2027-v1', label: 'Acme · ArcGIS map sheets (2027, v1)', … }
```

```sh
npx tsx scripts/forestry/inspect-map-pdf.ts /tmp/inspect /local/AcmeMaps --profile /local/acme-profile.ts
```

The draft is tried before the shipped profiles. Each `<sheet>.read.md` lists what the importer
extracts with it: each layer's feature count and role; for a class raster its legend, the share of
cells with an exact class, a JPEG estimate, not drawn and other, and its notes; for a contour
surface its EPSG, coverage and label assignment; and every notice. Adjust and rerun until:

- every expected layer is extracted, nothing else is, and no notice is unexplained;
- every class raster's legend matched (otherwise the notice names the class), and **other** is
  under 1% of cells;
- the contour surface has an EPSG, most labelled lines carry a label (**labelsOnLines** close to the
  number of contour labels you can see), few **conflicts**, and coverage over the area the contours
  are drawn.

`readGeoPdf` takes the same list as `options.profiles`, which is how tests try a profile too.

## 8. Check against the company's data

| Check                                | How                                                                                                                                            | Pass                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions                            | Import a sheet and the company's block shapefile together (**Layers → Add files**) and compare the recovered block outline with the shapefile. | Within the sheet's drawing precision: a few metres at 1:10,000 (one point is about 3.5 m).                                                        |
| Class areas                          | `check-pdf-rasters.ts` with a class map folder and a block shapefile.                                                                          | Exact + estimate + not drawn account for the block; percentages the company recognizes.                                                           |
| JPEG estimates (when tiles are JPEG) | `pdf-jpeg-calibration.py` then `check-pdf-jpeg-calibration.ts`: needs one lossless tile in the same sheet.                                     | Decoder misallocation well below nearest colour; quote the measured figure. No lossless tile: say the estimates are unmeasured for this template. |
| Contour terrain                      | `check-pdf-contour-slope.ts` with the field sheet and the company's slope sheet; `compare-road-terrains.ts` with a project on another terrain. | Same order as Canfor's (69% within one range, 87–91% on thresholds), or explained.                                                                |

Commands are in [source-pdf-import.md](source-pdf-import.md#reproduce-the-source-and-compression-checks).
These scripts read with the shipped `PDF_PROFILES`, so add the profile there (step 9, item 1) before
running them. `check-pdf-rasters.ts` reads every PDF in the folder that has a class raster and
records which profile read it; the calibration then uses that profile's raster definitions. Name the
class maps for the calibration when their files are not called `*Slope_Map*` / `*Canopy_Height*`:
`python3 scripts/forestry/pdf-jpeg-calibration.py /local/Maps /tmp/cal slope=Slope.pdf canopy=Canopy.pdf`.

## 9. Ship it

1. Add the profile to `profiles.ts` and to `PDF_PROFILES`. Rasters go in `rasterProfiles.ts` beside
   `CANFOR_RASTERS`.
2. Add a synthetic fixture, `tests/fixtures/<company>Pdf.ts`, built like `canforPdf.ts`: made-up
   geometry, the template's layer vocabulary, a small raster with its legend, alpha and an undrawn
   pixel. No company artwork.
3. Unit tests with the fixture: recognized by the new profile and not by the others; rules extract
   the expected layers; the legend, classes, `undrawn` and any overlay come out right; a sheet
   without the template's layers is refused with both profiles named.
4. An env-gated real-sheet test (`PGMAPS_<COMPANY>_MAPS`), like `geoPdf.test.ts`'s.
5. **Other profiles unchanged:** run the existing unit tests and, with their local sheets, the
   real-sheet tests (`PGMAPS_CANFOR_MAPS=… npx vitest run src/lib/geoPdf`).
6. Add the template to **Supported templates** in [source-pdf-import.md](source-pdf-import.md) with
   what was measured in step 8, and its limits.

## What a profile cannot express yet

These need code changes, each with its own tests:

- class raster kinds other than canopy height and slope;
- legend labels anywhere but to the right of their swatches;
- more than one registered map frame per page, insets, or a non-rectangular frame;
- CRSs other than BC Albers and the UTM zones listed in step 3, for terrain;
- class tiles that do not share one native pixel grid;
- progressive or arithmetic-coded JPEG tiles (they fall back to the colour match);
- scanned or flattened PDFs without vector layers or embedded registration.
