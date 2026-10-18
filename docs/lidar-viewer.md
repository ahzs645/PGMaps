# LiDAR forest and structures workbench

`/dev/lidar/` is a native PGMaps page. The same React workspace is built by
`npm run lidar:preview:build` for the private Sites preview. There is no iframe,
embedded upstream application, or second copy of the workspace implementation.

## Architecture and ownership

- `src/pages/dev-lidar/LidarWorkspace.tsx`: host UI, layer choices, metrics,
  downloads and methodology. Shared PGMaps sidebar/fullscreen/button components
  provide the frame.
- `NativeLidarMap.tsx`: MapLibre plus `maplibre-gl-lidar@0.21.0`, the same LiDAR
  rendering component used by GeoLibre. It streams EPT on demand with a
  750,000-point display budget. Raw source attributes remain unchanged.
- `types.ts` and the analysis `summary.json`: the frontend/data contract.
  Images, vectors and source-grid downloads are separate assets.
- `scripts/lidar/`: reproducible batch processing, version-pinned dependencies,
  actual GeoLibre WASI runs, scientific checks and publication. Heavy processing
  does not rerun whenever someone opens the page.
- `scripts/prepare-lidar.py`: the complete original cloud's EPT index. No source
  points are removed from this visualization dataset.
- `lidar-preview/`: a small entrypoint importing the same workspace for Sites.
  Sites is a hosting adapter, not the source of the analytical methods.

GeoLibre supplies directly reusable JS rendering and WASI processing components.
RustGIS is a companion for inspecting exported rasters/point clouds and shares
GeoLibre tools, but its complete app is not required inside this interface.
Browser plugins and processing versions are pinned and can be upgraded with the
recorded output checks. Re-evaluate thresholds/CRS/source metadata when adapting
the dataset-specific pipeline to another tile.

## Source and audit

- Supplied source: <https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view>
- File: `bc_093g086_4_4_4_xyes_8_utm10_20240713_20240713.laz`
- SHA-256: `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`
- LAS 1.4 / point format 6; 84,608,005 points; 550,572,701 compressed bytes.
- EPSG:3157, NAD83(CSRS) / UTM 10N; EPSG:6647, CGVD2013 (CGG2013) height.
- Header elevation limits 589.95–864.47 m; no RGB channels.
- Classification audit over the entire file: 78,253,302 unclassified (1),
  4,921,625 ground (2), 146,764 low-noise (7), 1,286,314 legacy overlap (12).
  There are no vegetation (3–5) or building (6) classes. No withheld or overlap
  flags were set.

Source classes 7, 12 and 18 are excluded from the analysis. The raw EPT cloud
retains all original classes and points. The point cloud is transformed to
EPSG:3857 for web streaming; all scientific analysis remains in metre-based
EPSG:3157 and preserves the source vertical datum.

## Methods and results

### Terrain, surface and height

Ground DTM: mean of classified-ground returns in each 1 m cell. Missing ground
cells are interpolated linearly from a TIN of ground-cell centres coarsened in
3×3-cell bins. Interpolation is limited to 30 m from an observed ground cell and
60 m maximum triangle edge. A two-cell nearest fill only repairs the coarsened
TIN's outer rim. Cells outside the observed footprint remain no-data.

This fills terrain under roofs without using roofs as ground or flattening a
slope through nearest-value interpolation. The ground-support-distance layer
makes the distance to actual ground returns visible; it is not a vertical error
estimate. No independent vertical accuracy assessment was supplied.

DSM: maximum valid return elevation per 1 m cell. The canopy-height proxy is
`max(DSM - DTM, 0)` on supported cells, with values >80 m excluded. Because
vegetation is unclassified, structures can remain in this elevated-surface
height raster. The downloadable DSM retains supported-cell absolute elevations.

The processed footprint covers 228.544 ha; height estimates cover 227.993 ha
(99.759% of observed cells). Median elevated-cell height (>2 m, excluding detected
roof patches) is 20.246 m; P95 is 29.247 m. These are grid-area statistics, not
field-measured tree heights.

### Cover and vertical structure

Elevated first-return cover is first returns >2 m above the terrain divided by
all valid first returns with supported normalization (74.55% here). It includes
buildings and other elevated objects and must not be described as verified
vegetation closure. The 1 m cover grid and the tile aggregate have different
weighting: the aggregate is return-weighted, not the mean of grid percentages.

The return-height profile tabulates valid returns in <0.5, 0.5–2, 2–5, 5–15,
15–30 and >=30 m bands. It describes vertical sampling, not fuel load, biomass,
canopy base height or understory completeness. Occlusion and flight sampling
influence these fractions.

### Full-tile crown candidates

A Gaussian-smoothed height surface (sigma 0.7 m) supplies local maxima separated
by at least 3 m and >5 m high, with >=1 m local relief. Candidate seeds must be
within 3 m of a ground-supported cell and outside a 2 m buffer around detected
roof patches. Marker-controlled watershed partitions connected height >2 m
surfaces; regions smaller than 4 m² are not reported as crown candidates.

This produces 16,136 dominant-crown candidates. It does not locate stems,
identify species, measure DBH, separate every overlapping crown, or count
suppressed trees. Crown area is the watershed region's planimetric area.
Tile-edge and unusually large regions require review. Some non-tree objects can
remain. The interface reports sensitivity to 2, 3 and 5 m peak separation;
these alternatives are algorithm sensitivity checks, not confidence intervals.

### Roof-like planar patches

A 5 m DSM neighbourhood estimates a local plane. Candidate cells are 2.5–35 m
above ground, have <=0.22 m plane-fit residual, >=65% local single-return
fraction, complete local surface support and slope <=atan(1.2). A one-cell
closing joins small holes; connected regions >=20 m² become candidate patches.

There are 178 patches, not necessarily 178 buildings. A building can produce
several disconnected facets, and rock, smooth canopy, vehicles or other planar
objects can pass the screen. No authoritative footprints or field validation
were used. Raw candidates remain the default displayed geometries.

GeoLibre's `regularize_building_footprints` also runs on these candidate polygons
in UTM coordinates (`right_angles`, tolerance 1 m). The regularized GeoJSON is a
separate download. Cartographic regularization does not validate building use or
make candidate boundaries survey-grade.

### Actual reference-engine executions

`geolibre-wasm==1.7.1` uses the GeoLibre/Whitebox WASI engine through Wasmtime.
`geolibre-runs.json` records exact arguments, input/output SHA-256 hashes,
exit codes, stdout and timings.

- `slope`: full 1 m DTM, degrees; Zevenbergen–Thorne gradient.
- `hillshade`: full DTM, azimuth 315°, altitude 45°, Z factor 1.
- `individual_tree_detection`: fixed 100×100 m forest ROI at UTM
  [512700,5971550,512800,5971650], 8,756 normalized 1 m surface samples.
  Search radii 2–4 m, minimum height 5 m, vegetation-class restriction disabled
  because the source has no vegetation labels. It returns 131 candidates,
  shown as a separate pink overlay. Its exported Z attribute is integer-valued.
  This is a method comparison on a derived surface, not full-cloud segmentation.
- `regularize_building_footprints`: candidate polygons, as described above.
- `individual_tree_segmentation`: attempted on the same ROI with grid
  acceleration. It fails with `failed building thread pool: Not supported
(os error 58)` in this WASI runtime, even with one thread requested. No output
  from it is displayed. The full-tile watershed regions are explicitly separate.

An exploratory full-surface GeoLibre tree-detection run was stopped after about
five minutes without output. The published reproducible run uses the bounded
ROI. The general ROI scope is recorded; a fresh run does not repeat that
unbounded attempt.

## Running and validation

Create a Python environment and install `scripts/lidar/requirements.txt`, then:

```sh
python scripts/lidar/run.py --source /absolute/path/to/source.laz
python scripts/lidar/validate.py --analysis public/data/lidar-analysis/bc-093g086
python scripts/lidar/test_processing.py
npm run lidar:preview:build
```

Without `--source`, the runner downloads the supplied public Drive file and
verifies its checksum. Intermediate full-resolution arrays and LAS samples stay
in temporary working storage. Published output is ignored under
`public/data/lidar-analysis/`; generated binary artifacts are not committed.

The scientific unit checks use known sloping terrain under a synthetic roof,
a wide unsupported gap and an outside-footprint mask. Product readback checks
source count/hash, asset digests, vector counts, source-grid size/CRS, no-data
preservation, area accounting and actual successful reference-engine executions.
A complete local rerun reproduced the two full-tile candidate counts.

GitHub Actions independently caches EPT and analysis artifacts. An uncached
analysis run installs pinned dependencies and regenerates these products after
the application build. Every deployment validates cache hits too. The Site's
initial HTML/JS renders a loading/error state if its analysis is unavailable;
opening an application is not treated as proof of rendered points.

## Display and hosting

Web previews are warped to a 3 m Web Mercator display grid. Source downloads
retain the 1 m UTM grid. A clicked height is labelled as a resampled web-grid
value. Crown-region colours are categorical and never indicate species.
Raw points use a display Z translation to place the lowest point at scene zero;
that is a visual shift, not an elevation/datum conversion.

The workspace fills its host's available height with no document scrolling.
The map uses the remaining space below the compact header and toolbar, without
a fixed minimum height. A collapsible 310 px desktop sidebar holds Map,
Analyze, Stats, Roofs, About and Files tabs; only its content scrolls. On phones the panel
starts closed and opens into the bottom 42% of the workspace, leaving the map
visible. Fullscreen uses the same mounted map and observes its resized container.

Stats contains processed height, terrain, GeoLibre slope and crown-region PNGs,
which remain accessible without WebGL. Selecting a preview opens that map layer.
The native GeoLibre LiDAR control starts collapsed with the original EPT cloud
streaming. Its toolbar button opens tools on demand; panel dimensions track the
available map space. Display buttons switch between processed layers and 3D
points. Crown and roof candidates start enabled.

The Roofs tab inspects every existing roof-like patch with height statistics,
whole-patch plane diagnostics and a sampled terrain/surface profile. Focus 3D
points uses a local ground viewing origin. The 3D workflow hides basemaps and
labels as well as surface/crown overlays. See [building inspection and further
LiDAR uses](research/lidar-building-inspection.md) for measured examples, exact
snapshot provenance, reconstruction requirements and tests.

Context uses OpenFreeMap vector geometry by default and offers Esri satellite /
aerial imagery with vector labels. The eye button and opacity slider reveal the
basemap without hiding candidate features. Presets support canopy, roof and
ground-support review, and imagery source dates are available at the study-tile
centre. Switching context preserves the map and LiDAR session. See
[the research and validation record](research/lidar-basemap-review.md) for sources,
coverage checks, scientific limits and prioritized follow-on work.

The private Sites host uses the same compiled React entrypoint. Its small Worker
proxies the two private static tile bundles using server-only service credentials.
The analysis products are partitioned alongside the existing EPT files to stay
within Sites' 256 MiB archive input limit. No bypass token is sent to the browser.
This adapter does not change the PGMaps GitHub Pages production publication.

Browser-control tools were unavailable during authoring. Type/bundle checks,
scientific output checks and authenticated production HTTP checks are recorded;
visual/WebGL verification remains separate.

The Analyze tab implements canopy-opening screening, 25/50 m plot statistics,
horizontal elevated-surface proximity to roof patches, and actual Roofer LoD2.2
meshes with local review notes and exports. Four deep links select workflows.
Small versioned text snapshots are lazily loaded and checked against served
product hashes. See [workflow methods and reproduction](research/lidar-building-inspection.md)
for counts, thresholds, classification limits, all rerun commands and test coverage.

## Primary references

- GeoLibre reusable rendering: <https://github.com/opengeos/maplibre-gl-lidar>
- GeoLibre/Whitebox processing: <https://github.com/opengeos/geolibre-rust>
- RustGIS: <https://github.com/opengeos/RustGIS>
- Local maxima / crown segmentation context: <https://r-lidar.github.io/lidRbook/itd.html>
- Canopy-model context: <https://r-lidar.github.io/lidRbook/dsm.html>

The full-tile watershed implementation uses SciPy/scikit-image. It is not
labelled as `lidR::dalponte2016`, pit-free CHM, or the failed GeoLibre mean-shift
algorithm.

## Forestry structure lab

Analyze now includes original-return vertical layers, canopy texture and
opening-edge/interior screening on 924 source-grid plots. Compare high/low
plots, pin A/B fingerprints, inspect original 3D points and export a spatially
spread field-check shortlist. [Methods, findings, metric definitions and reruns](research/lidar-forestry-explorer.md)
describe the actual 82.6 million accepted returns and the evidence needed for
forest boundaries, inventory modelling and change detection. The workflow
selector keeps navigation compact, with legends visible below the map.
