# LiDAR viewer

`/dev/lidar/` is listed in the Dev library. GeoLibre displays the full
84,608,005-point tile as streaming Entwine Point Tiles (EPT). RustGIS opens
`overview.laz`, a spatially distributed overview from the octree root. This
is explicitly labelled as an overview: RustGIS Web has a 500,000-point layer
budget, and the original LAZ is too large for GeoLibre's whole-file web loader.
Both applications are hosted by OpenGeos and embedded by their documented URL
parameters. No application code is copied into PGMaps. Viewer controls and
point budgets remain owned by the upstream applications.

## Data provenance

- Original: `bc_093g086_4_4_4_xyes_8_utm10_20240713_20240713.laz`
- User-provided source: <https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view>
- SHA-256: `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`
- Compressed bytes: 550,572,701; LAS 1.4, point format 6 (no RGB).
- Horizontal CRS: EPSG:3157, NAD83(CSRS) / UTM zone 10N.
- Vertical CRS: EPSG:6647, CGVD2013 (CGG2013) height.
- Header elevation limits: 589.95–864.47 m.

The preparation script transforms horizontal coordinates to EPSG:3857 for
web-viewer compatibility and retains the source orthometric heights. It does
not convert them to ellipsoidal heights; do not interpret a globe's absolute
vertical placement as a survey measurement. No points are deliberately thinned
from the EPT dataset. The full hierarchy and each node's LAS header are checked
against the original count before publication. Display budgets still limit
points drawn at a given moment.

## Local preparation

Install the environment with micromamba (or an existing Entwine installation):

```sh
micromamba create -f scripts/lidar-environment.yml
micromamba run -n pgmaps-lidar python scripts/prepare-lidar.py
```

To reuse the original file rather than download it:

```sh
micromamba run -n pgmaps-lidar python scripts/prepare-lidar.py --source /absolute/path/to/source.laz
```

The output is ignored under `public/data/lidar/bc-093g086/`. Vite serves it
locally. The source size and checksum are verified before indexing. Preparation
uses two threads by default; `--threads` can override that. Allow several minutes
and several GB of working disk/memory for the first build. An interrupted output
without `ept.json` must be removed or a fresh `--output` path chosen before retry.

## GitHub Pages deployment

The existing `deploy.yml` still publishes pushes to `main`. After the application
build, Actions restores the prepared EPT cache or installs Entwine and rebuilds
it from Drive. The script writes directly into `dist/data/lidar/bc-093g086/`, so
the app's data synchronization cannot erase it. Changing either preparation
script or environment invalidates the LiDAR cache. Every build verifies the
hierarchy count and individual node headers, including cache hits.

EPT nodes are small independent LAZ files, avoiding a single 551 MB object and
byte-range requirements. GitHub Pages supplies cross-origin access headers, which
the hosted viewers need. Do not commit the original or generated binary tree.
If the Pages artifact outgrows GitHub's site-size allowance as other datasets
grow, move the generated tree to a static CORS-enabled object host and update
`LIDAR_TILE.basePath`; all EPT files must retain their relative paths.

The source Drive link must continue allowing public downloads for uncached
builds. A failed download or changed checksum fails the build and leaves the
previous Pages deployment intact. The page checks the local EPT and summary
metadata before mounting a viewer and shows a clear unavailable state when the
data is absent. An iframe load event means the application page opened; it does
not establish that points rendered. Point loading/errors are shown by the
viewer itself. Network/WebGL failures can be investigated using Open viewer.

## Upstream references

- <https://github.com/opengeos/GeoLibre/blob/main/docs/user-guide/embedding.md>
- <https://github.com/opengeos/RustGIS/blob/main/apps/rustgis-web/src/web.rs>
- <https://github.com/opengeos/RustGIS/blob/main/crates/data/src/lidar.rs>
- <https://entwine.io/entwine-point-tile.html>
