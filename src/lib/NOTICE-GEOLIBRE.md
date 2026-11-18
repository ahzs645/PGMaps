# GeoLibre adaptation

`colorVision.ts` adapts GeoLibre's colour-vision simulation (`apps/geolibre-desktop/src/lib/cvd-simulation.ts`
in [GeoLibre](https://github.com/opengeos/GeoLibre)): the mode list, the full-severity matrices of
Machado, Oliveira and Fernandes (2009) with the BT.709 luminance row for achromatopsia, and the
`feColorMatrix` value layout.

The map essentials (`src/components/ui/map-essentials.tsx` and the files it composes) follow
GeoLibre's map context menu, status bar, camera keys and *Identify* as ideas only; their code is
PGMaps' own.

Changes in this adaptation: PGMaps naming, a filter applied to the page's root element rather than
to the map canvases, so legends and sidebars are simulated with the map, and a session-only
setting.

## Export writers and helpers

These adapt code from `apps/geolibre-desktop/src/lib/` in GeoLibre. Each PGMaps file's header says
what it took.

| PGMaps file | GeoLibre file | What was adapted |
| --- | --- | --- |
| `gis/geoPackage.ts` | `geopackage-writer.ts`, `geometry-wkb.ts`, `gpkg-ogr-contents.ts` | The `gpkg_spatial_ref_sys`, `gpkg_contents` and `gpkg_geometry_columns` table definitions with the WGS 84 text, the `application_id` and `user_version` settings, column-name sanitising, the byte writer and the structure of the WKB geometry writer, and the `gpkg_ogr_contents` table |
| `gis/kml.ts`, `gis/layers.ts` | `kml-writer.ts`, `vector-export-errors.ts` | Decimal text without exponents, XML-safe text, the KML colour and opacity conversion, attributes as `ExtendedData`, and an error that names the feature whose coordinate cannot be written |
| `model3d/glb.ts`, `obj.ts`, `stl.ts`, `model.ts` | `extrusion-model.ts` | The GLB chunk layout and padding, bounds from stored float32 values, the root node carrying the origin, one material per colour, safe OBJ names and number formatting, the binary STL record layout, the Y-up rotation, sRGB to linear light, JSON-safe attributes |
| `mapRecording/recordingFormat.ts`, `recordingCaption.ts`, `canvasRecorder.ts` | `map-recorder.ts` | The recording MIME candidates and their choice, the extension for a MIME, the 12 Mbps bitrate, the frame-rate bounds, even frame sides, the encoder stop timeout, the caption's layout and drawing, the recorder options and its one-second timeslice |
| `mapRecording/tourTimeline.ts` | `tour-recorder.ts` | Stops with a hold and a transition time, the duration estimate, bearing normalising, and the clamped, versioned save and load |
| `clipboardImage.ts` | `print-layout-export.ts` | Writing a `ClipboardItem` whose PNG is a promise, so the write starts inside the click |
| `saveFile.ts` | `file-io/file-dialogs.ts`, `file-io/shared.ts` | The browser save-file picker with its download fallback, and telling a cancelled dialog from an error |

Changes in these adaptations: several layers and heights in one GeoPackage, typed columns, a stored
QGIS style per layer, KML folders and styles per layer, 16-bit indices and optional normals in glTF,
a `.mtl` beside the OBJ, a recorder with a composed mode fed from a map's render event, a generic
camera pose and a drive along a line in the timeline, and a save dialog that opens before the file
is built.

Taken as ideas only, with PGMaps' own code: the sheet formats, sheet series and outside-the-block
mask (`print-layout-svg.ts`, `print-atlas.ts`, `print-atlas-mask.ts`, `print-layout-export.ts`), and
the field brief's location links (`storymap-pdf.ts`).

GeoLibre is licensed under the MIT License:

```
MIT License

Copyright (c) 2026 Qiusheng Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
