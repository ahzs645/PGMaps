# Original scans and rectified map variants

A logical map record can retain both its original source image and its rectified
map assets. Source-image thumbnails, previews and zoom tiles are display
derivatives of that source; they do not replace it or establish a new geographic
placement. The existing `assets` and `download`/`downloads` fields continue to
describe the rectified products.

An original document can contain multiple pages, map panels, legends and vertical
sections. Attach an image variant to the specifically verified page or map/panel,
not to every map with a similar title. Retain the original document link alongside
the extracted image and its own checksum. A saved correction can use a cropped
edit source whose pixel frame differs from the complete scanned page.

## Image roles

| Role | What the image represents |
| --- | --- |
| `original-scan` | A verified original scanned image or exact extracted document-page image. |
| `edit-source` | The exact image frame used by a saved correction, including its documented crop or mask. |
| `reading-preview` | An existing reduced or otherwise derived source-reading image. It is not declared to be the archival original. |

Each variant includes a full image descriptor. Optional `thumbnail` and `preview`
descriptors refer to lightweight display files. A `pyramid` enables progressive
native-resolution source viewing; it is not a geographic raster asset and must
not be added to the map's `assets` array.

```json
{
  "id": "example-page-2",
  "label": "Original scan, page 2",
  "role": "original-scan",
  "image": {
    "url": "raw/<source-sha256>.jpg",
    "width": 12095,
    "height": 6712,
    "sha256": "<source-sha256>",
    "bytes": 3600000,
    "mimeType": "image/jpeg"
  },
  "pyramid": {
    "format": "pmtiles-image-v1",
    "url": "sheets/<pyramid-sha256>.pmtiles",
    "width": 12095,
    "height": 6712,
    "tileSize": 512,
    "maxZoom": 5,
    "sha256": "<pyramid-sha256>",
    "bytes": 10000000
  },
  "source": {
    "title": "Original document",
    "url": "https://example.org/document.pdf",
    "page": 2,
    "sha256": "<document-sha256>"
  }
}
```

The placeholders and sizes above illustrate the shape; they are not a real
collection record. Real catalogues, source metadata and prepared assets belong
outside the public Git checkout.

## Prepare a source variant locally

Use `scripts/shared-maps-worker/prepare_image_variants.py` with Pillow built with
WebP support and `pmtiles==3.8.1`. The default in-memory path needs no GDAL;
the optional large-image path also needs rasterio and NumPy. The command makes
no network requests. PDF pages must first be extracted or rendered as separately identified
PNG, JPEG or TIFF images. Prefer lossless extraction of an embedded scan when
that is the actual archival source image.

Create a private metadata JSON containing `id`, `label`, `role`, and optional
`source` and `note`, then run:

```sh
python scripts/shared-maps-worker/prepare_image_variants.py \
  --input /private/extracted-page.jpg \
  --sha256 <verified-source-image-sha256> \
  --metadata /private/page-metadata.json \
  --output-dir /private/prepared/example-page-2
```

The command prepares:

- **`raw/<sha256>.<ext>`:** an exact byte copy of the input image. Its checksum
  must match the expected source-image checksum.
- **`previews/<sha256>.webp`:** a thumbnail with a longest side up to 480 pixels
  and a reading preview up to 1,800 pixels. Images are never upscaled. Identical
  derivatives share one immutable object.
- **`sheets/<sha256>.pmtiles`:** a source-image pyramid with 512-pixel tiles,
  including the source's full spatial resolution. It uses WebP quality 92 display
  compression and lower-resolution overviews (Lanczos in memory, area averaging
  in the bounded streaming path). This lossy delivery
  derivative preserves access to readable detail but is not a byte-identical
  source or a replacement for the original download.
- **`variant.json`:** the catalogue-ready variant, with URLs relative to the
  collection catalogue.
- **`upload-manifest.json`:** each object's relative `key`/`path`, exact `sha256`,
  `bytes` and `contentType`; the recipe and validation receipt are included.

All objects are prepared and verified before ready manifests are written. The
source copy is checked and every encoded tile is read back from the archive and
checked for byte and dimension equality. Existing immutable objects are reused
only when their hashes agree. Temporary work is removed after success or failure.

The output is deterministic for a fixed input, preparation mode, and recorded
Pillow, libwebp and PMTiles versions; streaming also records rasterio/GDAL, and
CMYK conversion records LittleCMS. The recipe records the encoding parameters.
Content hashes remain authoritative if a different software version produces
different compressed bytes.

## Pixel-grid contract

This is a flat image pyramid with its origin at the upper left. The deepest level
uses one source image pixel per tile pixel. For source width `W`, height `H`, tile
size `T`, and maximum level `M`:

```text
M = max(0, ceil(log2(max(W, H) / T)))
factor(z) = 2 ** (M - z)
levelWidth(z) = ceil(W / factor(z))
levelHeight(z) = ceil(H / factor(z))
```

Tiles use PMTiles `getZxy(z, x, y)` addressing. Native edge tiles are cropped to
their remaining dimensions. Lower levels pad the last partial source cells with
transparency before resizing, keeping the coordinate factor exactly a power of
two. A renderer clips displayed tiles to the original `W × H` rectangle.

Archive metadata contains `kind: "pgmaps-image-pyramid-v1"`, `sourceSha256`,
`width`, `height`, `tileSize`, `maxZoom` and encoding details. `sourceSha256` must
equal the full image descriptor's SHA-256. Geographic header bounds are zero:
these are not map coordinates. A source-image viewer must check the metadata and
dimensions before displaying the archive.

## Limits and explicit preprocessing

The source and every prepared object must be **smaller than 95,000,000 bytes** to
fit the existing owner-upload route. The default source budget is 200 million
pixels and the maximum side is 200,000 pixels. A generated object that exceeds
the upload limit fails before a ready upload manifest is written. Do not
silently downsample an original to satisfy an upload limit. A lossless TIFF
compression change can be documented as a new byte wrapper only after checking
native dimensions and decoded pixel equality; retain the document and extraction
recipe alongside its distinct checksum.

The command accepts single-frame PNG/JPEG/TIFF byte imagery in RGB, RGBA,
greyscale, bilevel or palette modes. It preserves source alpha and carries an ICC
profile into display derivatives when present. It does not invent a numeric
display stretch, choose a page from a
multi-frame TIFF, or silently rotate a nontrivial EXIF orientation. Such inputs
need an explicitly documented preprocessing step and a new verified source hash.

### Large scans without discarding native detail

After checking the exact input's provenance, dimensions and compressed file
size, explicitly increase its budget with `--max-source-pixels`; the hard maximum
is one billion pixels. An input above 200 million pixels automatically uses the
bounded rasterio/GDAL path. `--streaming` selects the same path for a smaller input.

```sh
python scripts/shared-maps-worker/prepare_image_variants.py \
  --input /private/large-extracted-page.tif \
  --sha256 <verified-source-image-sha256> \
  --metadata /private/page-metadata.json \
  --output-dir /private/prepared/large-page \
  --max-source-pixels 700000000
```

Run large sources one at a time. This path reads sequential source stripes of
at most 32 MiB, caps the GDAL block cache at 64 MiB and uses one GDAL thread. It
creates a disposable lossless tiled TIFF on disk, then builds overviews and
encodes one display tile at a time. Temporary free space must exceed six bytes
per padded native pixel plus 256 MiB; this covers four-band pixels, their
overviews and working space without relying on favourable compression. Stripe
arrays, codec buffers and small output images use additional bounded memory;
the 64 MiB cache value is not a claim about total process RSS. For operating
records, wrap a large invocation in `/usr/bin/time -v` and retain its peak RSS
and runtime beside the private receipt.

The bounded path rejects source decode blocks larger than 64 MiB, progressive
JPEGs and interlaced PNGs, whose decoders can buffer an entire image despite
windowed reads. Prepare a separately verified lossless tiled or short-strip
wrapper for such a source before using this path. These checks do not affect
baseline JPEGs or the ordinary tiled/short-strip TIFFs used by this workflow.

The native level is never resampled. The temporary cache expands palette and
bilevel colours faithfully, premultiplies colour by alpha for averaging, and
pads only beyond the source's right/bottom edges. Lower levels use area averaging
on this exact power-of-two grid. Transparent partial cells remain partial rather
than stretching the last source pixel across a complete cell. The rendering
cache is neither an original nor a newly georeferenced raster, and it is removed
after preparation. The downloadable original is still the exact verified input.

### Explicit CMYK display conversion

CMYK inputs are rejected unless `--allow-cmyk-display` is supplied. Within the
200-million-pixel in-memory budget, a valid embedded CMYK ICC profile is converted
to sRGB with LittleCMS and perceptual rendering intent. Without an embedded ICC
profile, Pillow's CMYK-to-RGB conversion is used and explicitly described as an
**uncalibrated display conversion**. Invalid embedded profiles fail rather than
silently falling back. The generated sRGB profile uses a fixed header timestamp
so repeating a conversion does not change its bytes just because the clock changed.

The variant note, pyramid metadata and recipe identify this conversion. The
source file's `image` descriptor, SHA-256, dimensions and exact downloadable bytes
remain CMYK. Only previews and display tiles become RGB. A CMYK image above the
in-memory budget requires a separately documented bounded conversion before
preparation; the command does not attempt an uncontrolled whole-image decode.

An extracted PDF JPEG can require a different CMYK component polarity from the
decoder's standalone-image interpretation. Compare the extracted image with a
render of its actual PDF page before preparing it. An Adobe/YCCK marker or a dark
page alone does not prove that inversion is appropriate. If the original page
confirms inverted decoded components, add `--invert-cmyk-display` together with
`--allow-cmyk-display` and `--cmyk-polarity-evidence "PDF SHA-256, page and the
observed comparison"`. This explicitly applies `255 - value` to each decoded C,
M, Y and K channel before the uncalibrated RGB conversion. It does not invert the
resulting RGB image, alter the original bytes, rotate the sheet or change its
pixel coordinates.

The polarity option rejects non-CMYK inputs, embedded ICC profiles, the streaming
decoder and missing verification evidence. The note names the inversion; the
recipe and pyramid metadata also preserve the owner's evidence. Prepare into a
new output directory and retain the old manifests as review history. Check the
new preview and representative native tiles against the original PDF before
publishing a display-only refresh. The uncalibrated conversion is not a guarantee
of exact colourimetry, even when the page appearance is restored.

Optional `--tile-size` values are 256, 512 and 1024. `--thumbnail-side`,
`--preview-side` and `--quality` can change display derivatives, but do not modify
the original. The preview longest side cannot exceed 4,096 pixels.

## Attach verified variants to a catalogue

`scripts/shared-maps-worker/update_image_variants_catalogue.py` creates a local
catalogue and review receipt from an existing catalogue, a native-resolution
audit and explicit source-to-record bindings:

```sh
python scripts/shared-maps-worker/update_image_variants_catalogue.py \
  --catalogue /private/before.json \
  --inventory /private/native-resolution-audit.json \
  --bindings /private/bindings.json \
  --output /private/after.json \
  --receipt /private/catalogue-update-receipt.json
```

The private bindings JSON has schema `pgmaps-source-variant-bindings-v1`, a
`collectionBase` (or supply `--collection-base-file`), and `bindings` entries:

```json
{
  "variantPath": "prepared/example-page-2/variant.json",
  "targets": [{
    "id": "exact-raster-record-id",
    "expectedNativeSha256": "<existing-native-download-sha256>"
  }],
  "includeFeaturedByNativeSha256": true
}
```

Relative variant paths resolve from the bindings file. Each target must match
both its exact record ID and native-download checksum. Featured selections may
be included by matching the exact native checksum, or by explicit `featuredIds`;
title similarity is not evidence of source identity. A target can additionally
declare `sourceFrame: {"kind": "published-project-source",
"expectedSourceSha256": "<exact-project-source-sha256>"}`. The updater sets
`sourceVariantId` only when the saved project's source and native hashes prove
that precise image frame. A full-page original with a different crop must not be
declared to be the correction's edit source.

The inventory adds verified native GeoTIFF dimensions and checksums. The update
preserves geography, transforms, saved projects and unrelated catalogue fields;
its receipt makes the intended attachments reviewable before publication.

## Publication and recovery

Use the existing owner-authorised Cloudflare publication route described in
[shared-map-viewer.md](shared-map-viewer.md). Upload the manifest's immutable
objects, verify their remote size and checksum, and only then attach `variant.json`
to the exact map/panel's `imageVariants` array and update the catalogue using its
current ETag. Preserve the record's rectified downloads, assets, alignment review,
confidence and saved-project pointers.

Save the input source, document/page identity, preparation metadata, manifests,
published catalogue snapshot and verification receipt with the private Drive
project records. The original file and an edit source can both be attached to the
same record with their distinct roles. The current geometric correction and its
source/crop relationship remain in the saved alignment project.

Serving an original alongside a small rectified image does not require a new
fit. Producing a more detailed rectified master from that original requires the
documented original-to-edit-source relationship and transform. Treat that as a
separate operation with its own validation.

## Checks

```sh
python -m unittest discover \
  -s scripts/shared-maps-worker -p test_prepare_image_variants.py -v
```

The tests cover exact source retention, differing document/source hashes,
asymmetric non-square images, transparent pixels, one-pixel edge tiles, partial
overview cells, directory readback, no upscaling, duplicate small previews,
repeatability across process hash seeds, mismatched sources, upload-size failure,
streaming palette/bilevel fidelity and bounded decoding, explicit pixel budgets,
CMYK opt-in, verified component polarity and original retention, and rejected
ambiguous inputs.

## Publish the reviewed source-image update

`scripts/shared-maps-worker/publish_image_variants.py` uses the existing owner
upload route and requires `httpx`. Prepare a private publication stage after
reviewing the updater's candidate catalogue and receipt:

```json
{
  "schema": "pgmaps-image-variant-publication-v1",
  "beforeCatalogue": "before.json",
  "afterCatalogue": "after.json",
  "beforeSha256": "<exact-before-file-sha256>",
  "afterSha256": "<exact-after-file-sha256>",
  "collectionBase": "https://maps.example.org/c/<collection-capability>/",
  "uploadManifests": ["prepared/example-page-2/upload-manifest.json"]
}
```

The file hashes are available as `beforeFileSha256` and `afterFileSha256` in the
updater receipt. Paths resolve from the stage file. Include every manifest needed
by the newly attached variants. The publisher checks each new full image,
thumbnail, preview and pyramid against the staged immutable object's exact
checksum, byte count and collection URL before making any network request.

### Refresh reviewed display files or descriptive text

By default, publication preserves every existing source variant exactly. To
correct an existing variant's display derivatives, list each affected record
explicitly in the private stage. A variant attached to both a native `items`
record and a `featured` selection needs a target for each changed attachment:

```json
{
  "displayRefreshes": [
    {"group": "items", "id": "exact-raster-record-id", "variantId": "existing-source-id"},
    {"group": "featured", "id": "exact-selection-id", "variantId": "existing-source-id"}
  ],
  "metadataUpdates": [
    {
      "group": "featured",
      "id": "exact-selection-id",
      "field": "description",
      "before": "Exact current description.",
      "after": "Reviewed description supported by the source document."
    }
  ]
}
```

These are optional fields on the publication stage above, not a separate stage
schema. A display refresh may change only `thumbnail`, `preview`, `pyramid` and
`note`. The exact original `image` descriptor, source metadata, id, label, role,
other variant properties and order of existing variants stay unchanged.
Existing display derivatives cannot be removed. Include the refreshed manifest
and its unchanged original object: every referenced file must match a staged,
content-addressed object. Existing matching objects are reused.

`metadataUpdates` permits only an existing record's `title`, `dateLabel` or
`description`, with exact before/after strings. Titles/date labels are limited to
500 characters and descriptions to 12,000. Each optional array has at most 128
unique targets; missing, duplicate, stale and no-op targets fail validation.
Confidence, caveats, alignment reviews, geography and saved projects remain
protected. A text-only update may use an empty `uploadManifests` array. It still
requires the reviewed catalogue hashes, strong conditional ETag and readback.

The publication receipt records both reviewed-change counts. Keep the previous
manifests and catalogue as history, and place corrected files and receipts in a
recovery supplement rather than rewriting an existing immutable archive.

### Run the owner publication

Keep the owner configuration in a separate private file with mode `0600`. It
contains the existing Worker's HTTPS `endpoint` origin, `shareId`, and temporary
`uploadToken`. Neither a collection capability nor an owner token belongs in a
command argument, public fixture or repository file.

```sh
python scripts/shared-maps-worker/publish_image_variants.py \
  --stage /private/publication-stage.json \
  --owner-config-file /private/owner-upload.json \
  --receipt /private/publication-receipt.json \
  --apply
```

The publisher uploads or reuses the content-addressed image objects and verifies
their remote SHA and size. Source-image archives also receive byte-range readback
checks. It rereads the live catalogue immediately before activation and requires
the exact reviewed before-file hash plus a strong `If-Match` ETag. A conflicting
live edit or HTTP 412 stops activation. If the reviewed after-file is already
active, the command verifies it without writing the catalogue again.

The final catalogue is read back and checked against the reviewed file hash.
Geographic assets, bounds, existing native download bytes and identities, saved
projects, and unrelated catalogue fields remain unchanged. Existing source
variants cannot be removed or assigned a different original; only explicitly
reviewed display refreshes and descriptive-text updates are permitted as above.
Native metadata comes from the header audit and is matched to existing native
hashes. This publication does not regenerate or independently reread every
native GeoTIFF.

The receipt records object checks and activation status without the owner token
or collection URL. A stopped publication can leave verified immutable objects
uploaded while its catalogue remains unchanged; retain the receipt and restage
against a fresh live catalogue if its revision changed. Save the stage, before
and after snapshots, manifests and receipt with the private recovery bundle.
The command does not manage the Worker's temporary upload secret; disable that
secret after publication using the owner workflow in
[shared-map-viewer.md](shared-map-viewer.md).

The updater and publication boundaries have separate regression checks:

```sh
python -m unittest discover \
  -s scripts/shared-maps-worker -p test_update_image_variants_catalogue.py -v
python -m unittest discover \
  -s scripts/shared-maps-worker -p test_publish_image_variants.py -v
```
