# EchoScreen consultant climate vectors

The canonical `/dev/projects/echoscreen-climate-health` package uses the verified
consultant GeoPackage, not the live portal's >30°C surface. Heat is annual days
above **29°C**, P50, SSP585, BCCAQv2 CMIP6. Past and future are 1971–2000 and
2071–2100. Summer and winter precipitation change is future minus past in mm,
matching the embedded QGIS print-layout legend titles.

The source and builder belong to `vendor/bcdatamapper/datascrapers/climate/echoscreen`.
Its README documents downloading the source and running `build.py`. The source
SHA256 is pinned. Rebuilding twice produces byte-identical manifests and gzip
blocks. Source cell values and the missing mask are checked by rasterizing the
published polygons, without rounding or simplification. The four source grids
are 249 × 97 with 12,779 valid cells each.

## Portal recipe contract

`portalMap.rasterLayers[]` accepts an optional nonempty `vectorManifest` URL:

```json
{
  "id": "hot-days-future",
  "layerName": "Days >29°C, 2071–2100",
  "vectorManifest": "/data/echoscreen-climate/hot-days-future/manifest.json"
}
```

Without this field the existing WMS adapter remains active. With it the renderer
loads a `numeric-raster-polygons-v1` manifest, requiring numeric polygon blocks
and a valid ordered linear RGBA ramp. It never falls back to WMS on failure.
The legend displays the same continuous source ramp, units, scenario and period
used to colour polygons. The adapter matches QGIS Float32 colour interpolation
and channel truncation, including alpha, endpoint clamping and clipping. A click
returns the exact numeric property used for colouring; the popup formats it to
three decimals, with the unformatted value in its title. Opacity multiplies the
source opacity. Vector recipes default to 100% so the source ramp is reproduced
without additional fading. Enabled vector layers share one ordered overlay;
context remains above climate surfaces as blocks load.

These are gzip GeoJSON native-grid vector blocks, the existing CCISS-style
browser approach, not MVT or PMTiles. Only visible layers load; block loading
follows the viewport. Every zoom uses full cells because this regional payload
is small enough to preserve the original continuous surface.

`scripts/sync-bcdatamapper-data.mjs` copies canonical `output/` to generated,
ignored `public/data/echoscreen-climate`. Do not add that duplicate to PGMaps.
The four layer packages total 1,065,537 bytes plus the small collection manifest;
future heat alone is 257,192 bytes. This excludes existing basemap and context.

The extraction reproduces the archive's climate surfaces, masks and colour
ramps. The surrounding hospitals, watershed boundaries and health outline use
existing PGMaps sources; river and watershed-label context still uses portal WMS.
It does not copy all consultant print layouts or every vector context feature.
