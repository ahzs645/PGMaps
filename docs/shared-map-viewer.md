# Shared map viewer and Cloudflare delivery

The reusable viewer is **https://pgmaps.ahmadjalil.com/dev/view**. It is intentionally absent from the `/dev` library and project catalogue. Opening it without a data URL shows an empty import form, never a list of hosted collections.

Share links use the fragment, so the collection address is not sent to GitHub Pages as a page request:

```text
https://pgmaps.ahmadjalil.com/dev/view#catalog=<URL-encoded HTTPS catalogue URL>
```

The actual collection capability URLs are **not committed to this public repository**. Keep the local `PRIVATE_SHARE.json`, generated catalogues and publication receipts outside the checkout. The viewer sets `noindex, nofollow, noarchive` and `no-referrer`. This is unlisted, anyone-with-the-link access, not account authentication: recipients can forward their link and download the data it exposes. Do not put a real link in issues, PR bodies, fixtures or public build logs.

## Library and image previews

Collection links open a scrolling image library, including older links that contain a `map` identifier. All raster representations are available by default; a separate selections tab shows curated stories. Search and the virtualized preview grid keep large catalogues usable without fetching every image or opening a basemap.

On phones, the header, filters and cards scroll together so the full card actions and the final record stay reachable, including when filters are expanded. Desktop keeps the header and toolbar above a separately scrolling card grid. Check this at short phone heights as well as full desktop sizes.

Choose **View image** to inspect a larger raster image, then **Open on map** to explore its geographic placement. The larger preview is assembled on demand from existing raster tiles (up to 1,800 pixels on its longest side); it is a display derivative, not a replacement for the native GeoTIFF. Full source sheets, available legend crops, source notes and original downloads remain accessible from the image preview.

Map links explicitly add `&view=map&map=<map id>`. The map's **Library** button returns to browsing with the current search and scroll position retained. The mobile map title sits below the main navigation, has a dismiss button, and can be restored with **Map info**. Loading background imagery does not block its controls or the historic overlay.

## What the viewer accepts

- A `raster-catalog-v1` JSON catalogue (example structure below).
- A raster `.pmtiles` archive: PNG, JPEG, WebP or AVIF tiles.
- Raster TileJSON with tile URL templates and geographic `bounds`.

URLs must use HTTPS without embedded credentials. The remote server must permit cross-origin requests; PMTiles also requires byte-range GETs. Loading happens directly in the visitor's browser with credentials omitted, not through an unrestricted server proxy. There is no anonymous upload or server-side URL-fetch endpoint. The initial release supports raster display; vector PMTiles need a vector styling interface and raw GeoTIFFs must first be prepared as tiles.

```json
{
  "schema": "raster-catalog-v1",
  "title": "Example map collection",
  "items": [
    {
      "id": "example-map",
      "title": "Example map",
      "bounds": [-126, 53, -124, 55],
      "assets": [
        {
          "url": "tiles/example.pmtiles",
          "bounds": [-126, 53, -124, 55],
          "minZoom": 3,
          "maxZoom": 14
        }
      ],
      "sources": [{ "title": "Original source", "url": "https://example.org/source" }],
      "caveat": "Record the map's actual placement uncertainty."
    }
  ]
}
```

Paths resolve relative to the catalogue URL. Optional `thumbnail`, `download`/`downloads`, `dateLabel`, `alignmentReview`, `fullSheets` and `fullSheets[].legend` supply previews, original downloads and source-reading views. `featured` is an optional array of curated stories; it may group several raster assets, and is not added to the `items` raster-representation count. Identifiers must be unique within `items`; catalogues are limited to 5,000 records and 6 MB.

## Categories, source groups and image-only records

Optional `organization` metadata on a raster record supplies `subjects` (an array of IDs), `primarySubject`, `region`, `era`, `sourceGroupId`, `sourceGroupTitle`, `sourceGroupSize`, `pageLabel` and `variantLabel`. Top-level `facets` maps `subjects`, `regions` and `eras` to arrays of `{ "id": "…", "label": "…" }`. The library filters these supplied fields; it does not infer map dates from filenames or geographic placement from category names. It retains every raster and uses source IDs to browse variants, without collapsing repeated titles.

Category provenance can include `classificationConfidence`, `evidence`, `regionConfidence`, `regionEvidence`, `dateKind`, `dateEvidence`, `contextDateLabel` and `labelBasis`. Low-confidence region assignments are marked as inferred. These fields are independent of the raster's geographic `confidence` and `alignmentReview`. Map-date eras should describe supported map dates; edition, report, interview, imagery and scan dates belong in explicitly attributed date labels/context.

Optional top-level `coverage` can report `sourceDocuments`, `sourceRecords` and `unplacedSources`; these counts are distinct from `items.length`. The optional `unplacedSources` array supplies image-only source records, shown in **Source images N**. Its historical field name does not imply that every entry is an additional cartographic map or a member of the same placement queue. Each source record has `id`, `title`, `sources` and optional `description`, `thumbnail`, `image`, `imageLabel`, `imageScope`, `statusNote`, `dateLabel` and `organization`. Source-image entries never receive an **Open on map** action. Records without a direct image show their source links and status instead. Label excerpts, contextual images and incomplete archive leads honestly through `imageScope` and `statusNote`.

## Cloudflare resources

### Original scans alongside rectified maps

Optional `imageVariants` keep original scans, recovered edit sources and reading
previews on the same logical map record. The image dialog offers source, map and
comparison views, with separate downloads and native pixel dimensions. Large
source images use a flat-image PMTiles pyramid for progressive zoom; existing
geographic assets and saved project frames retain their own identities.

See [source-image preparation and publication](shared-map-image-variants.md) for
the metadata contract, lossless source retention, thumbnail/preview generation,
large-image preparation and conditional catalogue publication. This uses the
existing Worker/R2 service and does not require a new tile server.

### Delivery resources

- Worker: `pgmaps-shared-maps`, source/config in `scripts/shared-maps-worker/`.
- Private R2 Standard bucket: `pgmaps-shared-maps`, binding `MAPS`.
- Public Worker root and incomplete URLs reveal no collection listing. Objects are served only through `/c/<43-character random capability>/<allowed path>`.
- An owner-only temporary upload token authorizes `/__upload/<capability>/<allowed path>`. R2 validates SHA256 on upload. Remove `UPLOAD_TOKEN` when a publication is complete to disable writes.
- Worker responses support HEAD, HTTP ranges, conditional requests, ETags and CORS. Workers Cache is enabled; catalogues use a short TTL, versioned display/raw objects use immutable caching. No permanent GDAL or tile-rendering server is required.

The frontend stays on the existing GitHub Pages deployment. Cloudflare serves the map bytes; this does not change the main site's DNS or migrate unrelated applications.

For a reviewed transparency-mask repair or a finer export from a recovered
frozen model, use the bounded workflow in [Reviewed raster revisions](shared-map-raster-revisions.md).

## Owner setup and publication

Use the repository's existing Wrangler convention for this service. With owner-authorized Cloudflare credentials configured normally (never pasted into chat or committed):

```sh
wrangler r2 bucket create pgmaps-shared-maps
wrangler deploy --config scripts/shared-maps-worker/wrangler.jsonc
wrangler secret put UPLOAD_TOKEN --config scripts/shared-maps-worker/wrangler.jsonc
```

Use a cryptographically random 32-byte base64url collection identifier. The builder accepts its endpoint, collection identifier and owner token on hidden stdin, not command arguments. It requires GDAL, rasterio, NumPy, Pillow, httpx and `pmtiles==3.8.1`:

```sh
python scripts/shared-maps-worker/build_catalog.py \
  --inventory /private/ALL900_STORAGE_SIZE.json \
  --raster-index /private/effective_raster_index.json \
  --site-root /private/curated-site/dist \
  --replacement-model /private/optional-correction/model.json \
  --state-dir /private/publication-state \
  --scratch /private/temporary-tiles --workers 3
```

The inventory's `rasters` records contain `path`, `sha256`, `bytes` and `output_id`; the effective index is the source/provenance record array. `--site-root` supplies the existing curated collection and its sibling `curation-all.json`. The optional correction model explicitly replaces one old SHA with a new product, without modifying the frozen originals. Use `--limit` for an initial trial. State files allow completed items to be reused when resuming the same collection publication.

The builder snaps GDAL's EPSG:3857 output resolution to the XYZ grid, builds WebP display tiles and lower-resolution overviews, and packages each raster independently as PMTiles. Every packaged tile is checked against GDAL's tile bytes. It preserves the source GeoTIFF bytes, uploads original files and small previews, verifies remote size/SHA metadata, and only publishes the complete catalogue when all requested rasters succeed. Display resampling/compression does not improve georeferencing or restore absent scan detail. Keep original uncertainty and source notes with each map.

After verification, disable owner uploads:

```sh
wrangler secret delete UPLOAD_TOKEN --config scripts/shared-maps-worker/wrangler.jsonc
```

Changing a catalogue can take up to its cache TTL to appear. Revocation requires retiring the capability's objects and purging cached responses (browser copies already downloaded cannot be recalled). Keep private link records in owner-controlled storage.

## Checks

```sh
node --test scripts/shared-maps-worker/worker.test.mjs
npx vitest run src/pages/dev-view/catalogue.test.ts
npx tsc -b
npx eslint src/pages/DevView.tsx src/pages/dev-view
```

Exercise empty/import/error states, catalogue search and scope switching, actual ranged tile loads, opacity, basemap changes, source reading, legend/full-sheet switching, downloads, copy/share and browser history at desktop and phone widths. Verify the blank viewer and Worker roots never disclose a real collection. The main GitHub Pages workflow verifies/builds the app and emits a real `/dev/view/index.html` entry point; it does not publish private map data.
