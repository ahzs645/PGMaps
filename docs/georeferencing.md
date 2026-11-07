# Adjust a map's alignment

Open [Georeference a map](https://pgmaps.ahmadjalil.com/dev/georeference) to match an image to the reference map, inspect the warped result, and save editable control points. Editing does not publish changes to the shared collection.

## Open or resume a source

Use **Choose image / GeoTIFF** for a PNG, JPEG, WebP, or TIFF. **Open a collection or image URL** also accepts a collection catalogue, a viewer share link, or a direct image URL. Search the collection and choose **Load selected map**. Remote sources must allow browser access; an authenticated download can instead be opened as a local file.

The editor displays the declared **native source pixel frame**, even when the reading image is sampled. For a collection GeoTIFF, points address that TIFF's native grid, not a thumbnail, map tile, or different full-sheet scan. A source labelled **Supplied image view only** is limited to the supplied image's detail.

Use **Import edit file** to reopen a `.georeference.json`, or **Resume local draft** when available. Local originals must be selected again; the edit file does not embed their pixels. Source dimensions and recorded SHA-256 identity are checked on reload and native export. Keep the exact original file alongside the edit project.

## Match landmarks and review the warp

1. Click a landmark in the source image, then its matching position on the reference map. Zoom before picking small features.
2. Spread pairs around the map. Drag either numbered point, edit its native pixel or longitude/latitude values, or use **Pick image again** / **Pick map again**. **Undo**, **Redo**, and **Cancel pending pick** support corrections.
3. Choose a transformation:

   | Method               | What it changes                                | Minimum controls          |
   | -------------------- | ---------------------------------------------- | ------------------------- |
   | **Scale & rotate**   | Position, uniform scale, and rotation          | Two distinct pairs        |
   | **Stretch (affine)** | Position, rotation, separate scales, and shear | Three non-collinear pairs |
   | **Local warp (TPS)** | Flexible local deformation                     | Six distributed pairs     |

4. Reserve independently identified pairs as **Check (withheld)**. They measure the result without changing the fit. **Control (fit)** pairs determine the transformation; disabled pairs do neither. A fitted point repeated as a check is not independent evidence.
5. Compare **Reference**, **Original placement**, and **Adjusted**, using **Satellite** or **Street map** and **Overlay opacity**. **Adjusted** warps the image interior through a triangulated mesh; it is more than a moved bounding rectangle.

**Start from current corners** supplies an initial placement when one exists. Those generated pairs are a starting guess, not verified geographic controls. Replace or refine them using identifiable landmarks.

Residuals describe agreement with the selected points, not survey accuracy. Prefer stable features across the whole sheet. Historical shorelines, eroding rivers, relocated bridges, and proposed streets can differ from current imagery. TPS can fit controls closely while distorting elsewhere; inspect independent checks and areas outside the controls. Folded or singular fits must be corrected before raster export.

## Download and continue editing

| Action                            | What you receive                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Download edit file**            | A portable `pgmaps-georeference-v1` JSON containing source identity, native dimensions, point roles, transformation, and notes. Reimport it to continue editing.              |
| **Download rectified GeoTIFF**    | A Cloud Optimized GeoTIFF warped from the exact native source with GDAL, exported in EPSG:3857. Save the edit file too; a raster alone does not preserve the editing session. |
| **Download preview + world file** | A ZIP with a sampled PNG, its EPSG:3857 world/projection files, and the edit project. This is a reading preview, not the full-resolution source product.                      |

Browser native export loads GDAL only when requested. It checks the original file and proposed output before writing. Current limits include a 256 MiB input file, 64 million native/output pixels, and a working-memory budget that can reject a smaller raster. Larger jobs use the same edit file with the [owner CLI](georeferencing-cli.md).

Output pixel spacing follows fitted source sampling; it does not state geographic accuracy. Nonlinear mesh previews and GDAL raster sampling can differ between controls. Review the exported GeoTIFF as well as the preview.

## Pixel conventions and live revisions

Projects store zero-based **pixel centres**, X right and Y down: the upper-left pixel centre is `(0,0)`. Fractional positions are retained, and display scaling does not change their native coordinates. GDAL uses pixel-edge coordinates, so export adds `0.5` to each source axis. The existing GeoTIFF placement is deliberately bypassed during the new warp, rather than applied twice.

To update the live collection, download the edit project and follow **Apply a revision to the shared live map**. The owner replays it against the exact original pixel frame, reviews the full-resolution COG and generated tiles, then stages a replacement for the stable native item ID. Browser edits never contain publishing credentials.

The [owner workflow](georeferencing-cli.md) checks the expected native hash and a fresh catalogue ETag before activation. A conflicting catalogue update stops publication. Previous immutable assets remain available, and a new manual warp is marked experimental pending review. To revise an earlier correction, reopen its saved project and replay against the same immutable original pixels. Stage against the current live native hash; recorded source lineage authorizes that original frame. An unrelated replacement source needs its own matching controls.

Edit projects can contain unlisted source URLs. Keep private projects, sources, and owner publication settings outside public Git.

## Related tools and references

- [GeoLibre](https://github.com/opengeos/GeoLibre) is a separate GIS application. Its [georeferencer workflow](https://github.com/opengeos/GeoLibre/blob/main/apps/geolibre-desktop/src/components/layout/GeoreferencerDialog.tsx) and [client GDAL export](https://github.com/opengeos/GeoLibre/blob/main/apps/geolibre-desktop/src/lib/georeference-gdal.ts) informed this utility. PGMaps implements its own project format, projected fitting, mesh preview, and owner replay; it does not vendor the GeoLibre application.
- [QGIS Georeferencer](https://docs.qgis.org/latest/en/docs/user_manual/managing_data_source/georeferencer.html) provides a desktop alternative. QGIS `.points` files use a different source-coordinate convention, particularly for an already georeferenced TIFF; the portable PGMaps edit JSON is the complete editor round trip.
- [Allmaps](https://allmaps.org/) offers [transformation](https://github.com/allmaps/allmaps/tree/main/packages/transform), [projection](https://github.com/allmaps/allmaps/tree/main/packages/project), and [IIIF/MapLibre rendering](https://github.com/allmaps/allmaps/tree/main/packages/maplibre) tools. Its renderer is not the arbitrary native-COG loading path used here.
- [GDAL warp documentation](https://gdal.org/en/stable/programs/gdalwarp.html) describes the raster transformation and resampling used for native exports.
