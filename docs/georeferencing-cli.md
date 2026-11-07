# Georeferencing projects and owner replay

The `/dev/georeference` editor exports `pgmaps-georeference-v1` JSON. It contains the exact source identity, native pixel dimensions, enabled control/check pairs, and the chosen similarity, affine or thin-plate-spline transform. Anyone can reopen that project in the editor and download it. Browser edits stay local; they do not update the shared collection.

An owner can replay the project against the full-resolution source, inspect a corrected COG and tile preview, then explicitly activate a catalogue patch. Original objects remain available under their immutable hashes. Keep downloaded projects, source files, outputs, private catalogues and publication settings outside public Git: project source URLs may contain an unlisted collection capability.

## Requirements

Install GDAL CLI tools (`gdalwarp`, `gdal_translate`, `gdaltransform`, `gdaladdo`) and the Python dependencies:

```sh
python -m pip install -r scripts/georeference/requirements.txt
python -m unittest discover -s scripts/georeference -p 'test_*.py' -v
```

The numerical replay and raster integration tests were exercised with GDAL3.10.3. The tests use synthetic data and include real RGBA COG output, PMTiles generation, browser/Python/GDAL numerical fixtures and publication conflict handling. No private collection is required.

## Inspect and replay

Use the original file containing the editor's pixel frame. For a loaded collection layer, that is the native download COG, including its current immutable SHA256. A thumbnail, PMTiles tile or full-sheet scan cannot replace that COG unless it is explicitly the project's declared source frame.

```sh
python scripts/georeference/georeference.py inspect /private/maps/original.tif
python scripts/georeference/georeference.py validate /private/maps/project.json
python scripts/georeference/georeference.py rectify \
  --project /private/maps/project.json \
  --source /private/maps/original.tif \
  --out /private/maps/rectify-check \
  --dry-run
python scripts/georeference/georeference.py rectify \
  --project /private/maps/project.json \
  --source /private/maps/original.tif \
  --out /private/maps/rectify-result
```

`--source` overrides only where bytes are read. The project hash and native dimensions must still match; it does not authorize applying thumbnail coordinates to a different source. Without `--source`, replay downloads the declared HTTP(S) source and verifies its hash. A project with a null source hash requires explicit `--allow-unverified-source`; the result records that limitation. A verified original is preferable.

`--out` must be new or empty. `rectify` writes:

- `project.json`: the portable point-pair project, with source identity and conventions preserved.
- `corrected.tif`: full-resolution4-band RGBA COG with explicit alpha interpretation and internal overviews.
- `result.json`: input hash, original pixel frame/CRS, fitted transform, control/check residuals, bounds and output hash.

Input pixels are streamed without resizing or automatic orientation changes. A current GeoTIFF's old geotransform is deliberately ignored while installing pixel-to-world control; it is not applied a second time. Fitting uses EPSG:3857 metres, and the final GeoTIFF defaults to the original COG's CRS. Plain images default to EPSG:3857. `--target-crs` changes only the export CRS. Output resolution is selected by GDAL from the complete source; `--resolution` can explicitly set output-CRS units per pixel. Resolution is sampling, not geographic accuracy.

Original alpha, valid-data masks and nodata are preserved. Grayscale/palette imagery is expanded to display RGB. Non-byte data needs an explicitly prepared display stretch; the utility does not invent one. An undefined fourth band is ambiguous: fix its metadata or use `--alpha-band 4` when that band is known to be alpha. The export always verifies actual RGBA interpretation, avoiding accidental fifth-band tile outputs.

The default source-byte and output-pixel limits are4GiB and250million pixels. Inspect a very large proposed warp before explicitly increasing `--max-source-bytes` or `--max-output-pixels`.

## Point CSV and reopening

JSON remains the complete portable project. CSV is a convenient point-table round trip:

```sh
python scripts/georeference/georeference.py points \
  --project /private/maps/project.json \
  --export-csv /private/maps/points.csv
python scripts/georeference/georeference.py points \
  --project /private/maps/project.json \
  --import-csv /private/maps/points.csv \
  --output /private/maps/edited-project.json
```

Columns are `id,pixelX,pixelY,longitude,latitude,enabled,role`. Import preserves the base project's source identity and transform. `role=check` points are evaluated but never fitted; disabled points are excluded. Repeating a fitted point as a check does not provide independent evidence and is rejected. The browser and CLI share the100-pair limit and reject repeated enabled pixels/targets, collinear affine/TPS controls, unsupported Mercator latitudes and unwrapped dateline-spanning controls.

Pixels use zero-based centres, x right and y down. GDAL GCP coordinates use pixel edges, so replay adds0.5 to each pixel axis. Similarity retains the normal image-y/down to map-north/up reflection; affine uses a general2×3 matrix. TPS uses normalized source/target coordinates and the exact `r² log(r²)` kernel with no smoothing. GDAL replay uses exact-transform evaluation (`-et 0`). Shared synthetic fixtures test browser/Python forward predictions against actual GDAL and its iterative inverse at fractional centres and outer pixel edges.

Residuals in EPSG:3857 are projected metric differences; `groundResidualM` uses great-circle distance and is the comparable geographic diagnostic. Training residuals and a sampled no-fold screen do not certify accuracy. Use independently identified checks across the map and inspect the final overlay, especially beyond the control footprint. An original map's datum can remain unknown even after useful empirical alignment.

## Stage a reviewable replacement

Download the current private catalogue to an owner working directory. Use the stable native item ID from `items`, not a curated story ID. Bind the patch to the exact native SHA currently in that record:

```sh
python scripts/georeference/georeference.py stage \
  --result /private/maps/rectify-result/result.json \
  --catalogue /private/maps/current-catalogue.json \
  --id NATIVE_ITEM_ID \
  --expected-native-sha CURRENT_NATIVE_SHA256 \
  --out /private/maps/review-patch
```

Staging calls the existing shared-map delivery builder to generate raster PMTiles and a thumbnail. Every stored tile is checked against GDAL's generated tile bytes. It writes a `catalogue-patch.json` containing stable ID, expected old native SHA, new immutable artifact hashes, geographic bounds and point-fit diagnostics. It contains no collection URL and performs no remote writes. Review the project, corrected native raster, tile/thumbnail artifacts and patch before activation.

Activation replaces the selected native item and matching components of curated stories that reference its exact old native. Story bounds are recomputed. Unrelated records and source images remain intact. A newly applied warp is marked experimental and `manual_adjustment_unreviewed` on the native item and affected stories. It cannot inherit a prior supported/provisional approval. Previous confidence, caveats and alignment-review evidence remain explicitly in `georeferenceRevision.previousPlacement`. Featured components are matched by a valid nonempty asset hash or their exact old URL; a missing hash never matches another missing hash. If a referenced component cannot be identified, activation stops without changing the catalogue. Introducing an entirely new catalogue item is a separate owner catalogue operation.

## Resume, tweak and publish from the same original

A saved project's source URL, SHA256, native dimensions and pixel-frame description continue to identify its immutable original. Reopen that JSON in the editor, adjust the point pairs and export the project again. Replay it with the same original file:

```sh
python scripts/georeference/georeference.py rectify \
  --project /private/maps/edited-project.json \
  --source /private/maps/original.tif \
  --out /private/maps/second-result
python scripts/georeference/georeference.py stage \
  --result /private/maps/second-result/result.json \
  --catalogue /private/maps/current-catalogue.json \
  --id NATIVE_ITEM_ID \
  --expected-native-sha CURRENT_DERIVED_NATIVE_SHA256 \
  --out /private/maps/second-review-patch
```

The current native SHA protects the live revision being replaced. The project's source SHA protects the original pixels used to calculate the new warp. After the first publication these hashes normally differ. Repeated replay is allowed when the current item's recorded source lineage contains that original SHA and exactly the same native dimensions, source frame and stable item ID. New revisions store this as `georeferenceRevision.sourceIdentity`; previous revisions remain linked through `previousPlacement.previousRevision`.

Legacy lineage qualifies only when a revision explicitly recorded both `sourceSha256` and the exact `sourceFrame`. A complete-file hash binds its native dimensions even if the older record did not store them separately. A previous output/replaced-native hash alone does not authorize interpreting it as another source frame. Unrelated old sources, changed frames and other item IDs are rejected. Existing patch files without the new immutable source-identity fields must be staged again.

This workflow recalculates each output from the same original pixels. It does not successively resample the first corrected COG or silently move saved point coordinates into its different pixel grid.

## Explicit owner activation

```sh
python scripts/georeference/georeference.py publish \
  --patch /private/maps/review-patch/catalogue-patch.json \
  --apply
```

The command requests JSON settings on hidden stdin: `endpoint`, `shareId`, and `uploadToken`, using the existing private shared-map Worker uploader contract. Keep these settings in an owner secret store; never put an upload token in a browser, public repository, command-line argument or project download. The utility does not persist credentials or print collection capability URLs.

Immutable native/PMTiles/thumbnail objects are uploaded and hash-verified first. Activation then fetches a fresh, cache-busted catalogue, checks the stable ID and expected native SHA again, applies only the relevant replacement to that fresh document, and sends its quoted ETag in `If-Match`. The Worker performs an atomic R2 conditional write. A412 conflict leaves the catalogue untouched; uploaded immutable objects can remain available for a later reviewed retry. The CLI does not retry a stale catalogue write. If another owner changed this native item, fetch the current catalogue and restage with its new expected native SHA. The saved original project remains reusable only while the item explicitly records the matching original pixel-frame lineage.

This requires the shared-map Worker's conditional catalogue-upload support. The current Worker limits each uploaded object to95MB; larger owner artifacts require a separately configured owner upload path. Successful activation is followed by catalogue-body/hash readback. The original native and tiles are never deleted.
