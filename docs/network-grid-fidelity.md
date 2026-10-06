# Network source and box-grid comparison

`createRasterGridLayer` displays one box per original PNG pixel. The default
view preserves original RGBA bytes, including partial transparency, unknown
colours, boundaries and small gaps. Classification affects hover labels only.
Boxes do not dissolve into larger shapes.

`/dev/networks` exposes every saved band, automatic levels and a fixed-level
selector. Source and grid use the same camera and opacity. Source bitmaps use
nearest filtering and explicitly disable browser alpha premultiplication and
colour conversion. Grids decode PNG bytes directly with `fast-png`, avoiding
canvas. Optional 4×4 and 8×8 boxes are **Simplified** and can change boundaries
or gaps. Lossless comparisons use 1×1 boxes with outlines disabled.

## Exhaustive audit, 2026-10-06

Scope: all five archives in the shared Drive **Network** cache folder, including
metadata, backups and native vectors. This compares the saved sources; it does
not refresh live-provider coverage.

| Saved source | Bands/layers | Saved levels | Files or features checked |
| --- | ---: | --- | --- |
| Bell PNG | 7 | 4–10, 49 band/level combinations | 33,299 tiles |
| Rogers PNG | 9 | 3–10, 72 band/level combinations | 136,388 tiles |
| TELUS MVT | 6 | 0–5, plus partial LTE level 6; 37 combinations | 352 tiles, 729,655 features |
| CRTC GeoJSON | 15 | Original geometry at every display zoom | 169,100 features |

Bell: LTE, LTE Advanced, 5G, 5G+, 5G+ Advanced, HSPA+, LTE-M.

Rogers: combined LTE/5G/5G+, 5G/5G+ only, derived 5G only, derived 5G+ only,
4G LTE, HSPA+, LTE-M, NB-IoT and All + Satellite. Derived layers are compared
with their own saved PNGs, not assumed identical to the combined provider layer.

TELUS: LTE, LTE Advanced, 5G, 5G+ / 3500 MHz, HSPA+ and LTE-M. Native vectors
remain intact in both raster comparison modes.

CRTC: wireless, 5G and LTE coverage; major roads with and without LTE/5G;
broadcasting distribution undertakings; DTV, TV, FM and AM day/night contours;
DTV, TV, FM and AM stations. All 15 layers are available. Large road collections
use shared `MapLineLayer` worker tiling with `sourceTolerance={0}`. Both
comparison modes retain the full original GeoJSON payload.

### Every PNG, every saved band and level

Pillow independently decoded every original ZIP entry into RGBA and hashed it.
The app decoder and classifier reconstructed individual boxes for every cached
PNG, then reassembled their RGBA bytes and compared with the independent hash.
Compressed PNG bytes also matched their original ZIP entries.

| Check | Result |
| --- | ---: |
| PNG files compared | 169,687 / 169,687 |
| Original pixels compared | 11,120,607,232 |
| Files with changed RGBA | 0 |
| Cached PNG bytes different from original archive | 0 |
| Decode errors | 0 |
| Largest checked XYZ corner error | 0.0000000261 metres |

Coordinate checks independently project a cell corner in every tile into
EPSG:3857. Unit tests additionally check exact shared edges between cells and
tiles. Pixel equality is exhaustive; coordinate tests do not enumerate every
corner of every cell.

### Rendered source versus conversion

Browser comparisons exercised the actual controls for all **121 raster
band/level combinations**, with one selected tile per combination. Each used
the same map instance, neutral background, camera, source level and opacity,
a 512×512 screenshot, zero pitch/bearing and settled layers.

| Check | Result |
| --- | ---: |
| Rendered comparisons | 121 / 121 |
| Exact screenshots | 111 |
| Screenshots with rounding differences | 10 |
| Changed screenshot pixels | 188 / 31,719,424 |
| Largest rendered channel difference | 1 / 255 |
| Camera changes or browser errors | 0 |

All 49 Bell cases are exact. Ten Rogers cases have small differences consistent
with bitmap versus box GPU rounding. Original RGBA is exact in every file.
Numerical coverage includes all tiles; screenshots represent one tile per
band/level, rather than every tile.

The standalone viewer offers band/level selection, side-by-side, swipe and red
difference views, plus a clickable comparison matrix. The compact
[JSON report](network-comparison.json) records every band/level's counts and
visual results.

### Remaining files and native vectors

All **415 non-PNG archive files** match their originals. Every JSON parses.
Every CRTC and legacy Bell GeoJSON geometry validates. All 352 TELUS tiles
parse, including 33,146,951 geometry points, with no invalid coordinates.
CRTC contains 2,696,620 valid coordinates. Native browser checks load all 15
CRTC layers and all 37 TELUS band/level combinations in both modes.

TELUS's six tar backups duplicate the same 352 MVT tiles, each matching its saved
file. AppleDouble `._` entries are metadata, not extra tiles. Seven legacy Bell
polygon files combine levels 4–8 and omit 9–10; they are validated debug artifacts.
The lossless box path uses PNGs directly.

The `cell-coverage` archive contains references. Videotron LTE and Freedom
nationwide/extended LTE have no saved imagery here, so cannot be converted or
compared from these archives. Missing tiles remain missing. Zooming above
saved limits reuses existing detail, without recovering higher-resolution
provider coverage.

## Reproduce

Restore the five ZIP archives under the scraper-owned
`vendor/bcdatamapper/datascrapers/network/<provider>/output` cache; do not track
raw data in app assets. Requires Node 22+ and Python with Pillow.

```sh
python scripts/network-pixel-oracle.py --archives /path/to/zips --output /path/to/audit
node --experimental-strip-types scripts/audit-network-pixels.mjs --oracles /path/to/audit --output /path/to/audit
python scripts/audit-network-archives.py --archives /path/to/zips --output /path/to/audit/archive-comparison.json
node scripts/audit-network-vectors.mjs --output /path/to/audit/native-vector-comparison.json
```

Start Vite with the caches available. Browser scripts require Playwright and
Chromium. The compact report supplies visual tile coordinates: map its raster
levels to cases containing `provider`, `layer`, `label`, `zoom`, `x`, `y` and
save that array as `render-cases.json`.

```sh
node scripts/compare-network-rendering.mjs --cases /path/to/audit/render-cases.json --output /path/to/audit/rendered --base-url http://127.0.0.1:5173
node scripts/compare-network-native.mjs --output /path/to/audit/native-rendered --base-url http://127.0.0.1:5173
node scripts/build-network-comparison.mjs --audit /path/to/audit --output /path/to/viewer
```

Browser scripts accept `--chromium /path/to/chromium`. Reports and screenshots
are local audit artifacts; no public deployment is implied.

For the saved compressed-grid export, native download packaging, measured sizes
and reproduction commands, see [network grid storage](network-grid-storage.md).
