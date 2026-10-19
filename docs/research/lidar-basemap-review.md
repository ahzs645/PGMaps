# LiDAR context and review workflows

Research and bounded live checks: 2026-10-18. Study tile: BC 093G086,
84,608,005 points acquired 2024-07-13. This extends the compact workbench in
`src/pages/dev-lidar`; it does not rerun or change the scientific products.

## What changed

- **Vector default:** OpenFreeMap Positron supplies actual MVT geometries for
  roads, buildings, water and places, with client-rendered labels. The source
  preparation removes unused provider raster relief. OpenFreeMap states that
  its public service permits commercial use without registration or API keys;
  it does not offer an SLA. Attribution comes from its TileJSON.
- **Satellite option:** Esri World Imagery supplies satellite/aerial photographs,
  with the same vector labels restyled for contrast. Esri and imagery-provider
  credit stays visible through MapLibre attribution. This is an online layer,
  not an offline imagery export or redistribution feature.
- **Comparison:** a surface opacity slider and eye button expose the underlying
  imagery without removing tree/roof candidates. A hidden surface has no height
  colour legend. Raster height/slope/support products remain quantitative grids;
  switching the basemap does not vectorize them.
- **Guided review:** Canopy review blends height at 40% over imagery with crown
  candidates; Roof review hides the opaque surface and shows roof patches on
  imagery; Terrain quality shows ground-support distance on vector context;
  3D structure shows the original streamed cloud. Presets choose relevant camera
  locations and reset unrelated overlays; they do not rerun detection.
- **Provenance:** the satellite comparison panel requests provider source metadata
  at the LiDAR tile centre. Unknown dates stay unknown; source resolution is
  explicitly separated from positional accuracy. This is not metadata for every
  pixel or zoom of the viewport.

Basemap switching changes layer visibility/label paints in place. It never calls
`setStyle`, replaces the map instance, or reloads the point cloud. Vector context
loads independently of the LiDAR and analysis; a context-provider failure leaves
the data available and the Satellite option usable. Base geometry sits below
analysis surfaces; labels sit above surfaces but below candidate overlays.

## Evidence and practical usefulness

The machine-readable [live check record](lidar-basemap-check-2026-10-18.json)
contains 21 bounded HTTP requests and content hashes. It verifies browser CORS,
four decoded vector tiles containing the footprint, all three used font stacks,
sprite assets, five distinct imagery JPEG tiles, and imagery metadata at the
tile centre plus four existing highlights. It is not a bulk map download.

| Check                                     | Result                                                                                                               | Implication                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vector coverage at maximum source zoom 14 | Four nonempty MVT tiles; 55 style layers                                                                             | Roads/places remain vector geometry and labels at closer map zooms; the provider overscales after source zoom 14.                                        |
| OSM building coverage                     | Only 1–3 building features in each containing tile                                                                   | Useful for orientation, insufficient as an exhaustive reference inventory. Counts include tile buffers/outside areas and may duplicate features.         |
| Imagery coverage at cache level 18        | Five distinct JPEGs, 11,863–17,240 bytes, public CORS                                                                | The checked locations have nonempty, independently addressed imagery; this alone does not verify visual registration.                                    |
| Source citations at all five locations    | City of Prince George, 2023-05-15, reported source resolution 0.075 m                                                | Fine source imagery is available for roof/crown review, but predates the 2024-07-13 LiDAR. Changes must not be scored automatically as detection errors. |
| Accuracy field                            | Provider reports sentinel value 99999                                                                                | No claim of 7.5 cm positional accuracy; the UI does not present this sentinel as a measurement.                                                          |
| Basemap integration                       | Repeated vector → satellite → vector unit checks preserve analysis/LiDAR visibility; labels restore original colours | Context switching keeps the current work and the raw-cloud session intact.                                                                               |
| Layer ordering/style                      | Actual 55-layer provider style plus analysis validates under installed MapLibre style spec in both modes             | Context geometry stays below measured surfaces; labels do not disappear under an opaque raster.                                                          |

The most useful immediate improvement is **review**, not another unvalidated
tree-count metric. Imagery can expose obvious crown over-splitting, missed
dominant crowns and planar patches that do not align with roofs. The point cloud
then supports shape/height inspection. These are intended review tasks inferred
from the data and source documentation; no user study, independent field
inventory, precision/recall estimate, positional-accuracy assessment or visual
WebGL acceptance test was performed here. Browser-control tools were unavailable.

## Research that informed the choices

- [OpenFreeMap service and terms](https://openfreemap.org/): free public vector
  service, commercial usage, attribution and absence of an SLA.
- [OpenFreeMap integration](https://openfreemap.org/quick_start/): MapLibre
  styles, glyphs and sprites.
- [Esri World Imagery item](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9):
  satellite/aerial data, contributor credits and usage terms.
- [Live Esri citation layer](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/4):
  acquisition dates, source resolution and scale ranges. Exact point queries are
  retained in the check record.
- [lidR detection and segmentation](https://r-lidar.github.io/lidRbook/itd.html):
  detection and crown delineation are different operations; window size, canopy
  model construction and stand structure materially affect results.
- [lidR surface/canopy models](https://r-lidar.github.io/lidRbook/dsm.html):
  height-model construction, pits and smoothing affect the surface used by tree
  detection. The existing simple surface is not renamed “pit-free”.
- [GeoLibre LiDAR component](https://github.com/opengeos/maplibre-gl-lidar):
  streaming EPT, classification/elevation colours, point picking and native
  controls remain the reusable 3D interface.

CARTO was also evaluated: its current terms require a provider-issued key, so
this feature uses OpenFreeMap instead of assuming old keyless examples still
describe current service requirements. Raw urllib requests with the default
Python user agent received OpenFreeMap error 1010; normal curl requests and a
descriptive PGMaps user agent succeeded. The deployed browser uses its normal
browser user agent. The live check records the successfully retrieved resources.

## Highest-value follow-on work

1. Plot/AOI summaries using explicit area denominators, supported-height coverage,
   height percentiles and candidate counts. Do not equate candidate density with
   stem density; report missing terrain support inside each selected area.
2. Save/export review decisions with candidate ID, accepted/rejected/uncertain
   state, reason, reviewer and data versions. Use a stratified independent sample
   and field reference to evaluate detection accuracy.
3. Compare a pit-free CHM and height-dependent local-maxima windows against the
   present workflow on the same validation plots. Existing results already show
   large count sensitivity to separation distance. Algorithm choice needs local
   validation rather than adopting a published method name as a quality claim.
4. Add normalized canopy/ground cross-sections and inventory overlays with dates
   and provenance. Species, DBH, biomass and fuel metrics require appropriate
   reference information and model validation.

## Reproduce the checks

From the PGMaps checkout with dependencies and processed products present:

```sh
node scripts/lidar/check-basemaps.mjs \
  public/data/lidar-analysis/bc-093g086/summary.json /tmp/lidar-basemaps.json
npx vitest run src/pages/dev-lidar
npx tsc -b
npm run lidar:preview:build
```

Provider tiles, styles and imagery can change independently of this repository.
The archived check record describes the tested date, not permanent availability.
