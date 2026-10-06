# Saved network grids and compressed sizes

Measured on 2026-10-06 from the previously audited Drive Network archives. MB
means decimal megabytes. Bell/Rogers retain every original pixel at every saved
band and level. TELUS and CRTC retain their native vector geometry.

| Dataset | Gzip grid/native file bytes | Compressed download package |
| --- | ---: | ---: |
| Bell | 55.7 MB | 60.2 MB |
| Rogers | 281.8 MB | 300.1 MB |
| TELUS native MVT | 76.3 MB | 39.8 MB |
| CRTC native gzip GeoJSON | 25.8 MB | 25.8 MB |
| **Total** | **439.6 MB** | **426.0 MB** |

Bell/Rogers grid files already use gzip level 6. Their ZIP packages store those
compressed files directly, adding file indexes, a manifest and format notes.
TELUS's raw MVT is ZIP-deflated at level 9, reducing 76,317,197 bytes to
39,833,079 bytes. CRTC retains its existing gzip compression. The exact total
for the four compressed downloads is **425,950,202 bytes**.

The [measured JSON report](network-grid-size.json) includes every band/level's
source and saved byte counts, package hashes and verification results.

All 169,687 saved grid tiles were decoded after encoding and compared against
the independent source RGBA hashes, with zero changes. All ZIP entries passed
CRC checks. Every packaged native vector file also matched its source entry
byte-for-byte. The saved format is a prototype; the app still loads PNG sources.

## Reproduce exports and size reports

Run from the PGMaps repository root. Python 3.11+ is required. The dependencies
match the measured run:

```sh
python -m venv /path/to/grid-venv
/path/to/grid-venv/bin/pip install -r scripts/requirements-network-grid.txt
```

Place the downloaded source ZIPs in `/path/to/zips`, using these names:
`bell-output.zip`, `rogers-output.zip`, `telus-output.zip`, and
`crtc-network-availability-output.zip`. The source Network folder is
[on Drive](https://drive.google.com/drive/folders/10Ul9AVUO_HsJ4nhHcb2-wV1Kq74Gv3iI).
The reference-only `cell-coverage-output.zip` is used by the full archive audit,
but has no raster tiles to export.

Generate the independent source hashes, then export and package every saved
band and level:

```sh
/path/to/grid-venv/bin/python scripts/network-pixel-oracle.py --archives /path/to/zips --output /path/to/audit
/path/to/grid-venv/bin/python scripts/export-network-grids.py --archives /path/to/zips --oracles /path/to/audit --output /path/to/grids --package-native
```

The exporter writes `bell-pixel-grid.zip`, `rogers-pixel-grid.zip`,
`telus-native.zip`, `crtc-network-availability-native.zip`, `FORMAT.txt`,
per-provider size JSON, `saved-grid-size.json` and `SIZE-REPORT.md`. Source
archives remain intact. Keep generated data in a scraper-owned cache or local
scratch directory; do not commit generated packages as app assets.

Recheck an existing export and regenerate the reports without converting again:

```sh
/path/to/grid-venv/bin/python scripts/export-network-grids.py --verify-only --output /path/to/grids
```

To add native download packages to an older grid export:

```sh
/path/to/grid-venv/bin/python scripts/export-network-grids.py --verify-only --package-native --archives /path/to/zips --output /path/to/grids
```

Tests cover all RGBA channels, hidden RGB in transparent pixels, run boundaries
across rows, exact XYZ metadata, malformed data, source hash failures,
deterministic packages and the complete command-line pipeline:

```sh
/path/to/grid-venv/bin/python scripts/test-network-grid-export.py
```

## Storage format

Each `.grid.gz` file is a gzip-compressed binary grid. The 28-byte little-endian
header uses `<8sHHBBHIII`: magic `PGGRID1` plus a zero byte, width, height, XYZ
zoom, cell size 1, reserved zero, tile X, tile Y and run count. Each run has a
four-byte positive length and four RGBA bytes. Runs cover all cells in row-major
order, including transparent cells; their lengths sum to width × height.

Run-length encoding compresses repeated values without merging display boxes.
Each cell remains one original source pixel. Box positions come from the source
XYZ/Web Mercator lattice, using the same boundaries as `rasterGridCellRing`.
Class labels can be inferred from the retained RGBA and source palette when
loaded. ZIP member timestamps are fixed for repeatable exports; compression
library versions can affect encoded bytes and sizes.

The [fidelity workflow](network-grid-fidelity.md) documents the exhaustive pixel,
archive, native-vector and rendered comparisons and their reproduction scripts.
