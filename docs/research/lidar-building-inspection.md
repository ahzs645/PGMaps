# Building inspection and additional LiDAR uses

The workbench now has a **Roofs** tab for all 178 existing roof-like patches.
Select a row to inspect its measurements/profile, or use Imagery / Focus 3D
points to focus that patch. The profile uses the published 1 m terrain and
surface grids, not a reconstructed building mesh.

## Actual additional processing

`scripts/lidar/inspect_roofs.py` samples the existing patch polygons in metric
EPSG:3157, calculates height statistics and ground-support distance, and fits a
least-squares plane to each patch's DSM cells. The residual includes every
sampled cell. The down-slope aspect is undefined below 2° pitch. Cross-sections
follow the long axis of the minimum rotated rectangle with a 6 m margin at each
end, using nearest source-grid samples and at most 65 positions per patch.
Terrain/surface no-data stays missing.

The versioned text snapshot
`src/pages/dev-lidar/roofInspection.generated.json` contains all 178 records and
5,231 profile positions. It records SHA-256 hashes of the candidate polygons,
DTM, DSM and ground-support grid plus the original LAZ hash. Its total size is
about 460 kB; original grids/cloud binaries remain outside Git. This bounded
snapshot lets both the PGMaps application and private Sites build without
processing LiDAR during page load. The inspector verifies the served candidate
bytes and source hash before displaying snapshot metrics. Deployment validation
also verifies all four input file hashes, including on data-cache hits; a changed
analysis requires regenerating the snapshot.

| Example patch | Plan area | Median height above terrain | Whole-patch fit           | Interpretation                                                                                                    |
| ------------- | --------: | --------------------------: | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `roof-234`    |  1,370 m² |                     17.05 m | Pitch 0.86°, RMSE 1.570 m | A near-flat fitted slope conceals a poor fit; inspect multiple facets, mixed surfaces and boundary contamination. |
| `roof-330`    |    692 m² |                      3.76 m | Pitch 0.69°, RMSE 0.135 m | Consistent with a near-flat plane at this grid resolution; still an unvalidated candidate.                        |
| `roof-281`    |    316 m² |                     10.49 m | Pitch 1.23°, RMSE 0.032 m | Geometrically planar sampled surface; not proof of building identity or survey accuracy.                          |

Of the 178 patches, 130 have whole-patch RMSE ≤0.30 m and 48 exceed it. The
0.30 m display threshold is an exploratory fit flag, not an accuracy standard,
building probability, validation score or roof-facet classifier. Multiple
patches can belong to one building, and smooth canopy/other planar objects can
pass the screen. No building count, volume, solar yield, roof condition or
structural capacity is inferred.

## 3D focus and complete workflow state

The main roof area has sampled median ground around 763 m CGVD2013, compared
with the original tile minimum of 589.95 m. A view using only the whole-tile
origin can leave the local scene far above its zero plane. The roof focus now
uses `LidarControl.setZOffset(-localGround)` to put the selected patch's median
ground near scene zero. This is a display translation; no source file or
scientific product is changed. Whole-tile focus restores the global origin.
The status line identifies the viewing origin.

| Workflow        | Basemap               | Surface               | Candidates    | Original points  |
| --------------- | --------------------- | --------------------- | ------------- | ---------------- |
| Canopy review   | Satellite, labels off | Height at 40%         | Crowns        | Hidden/paused    |
| Roof review     | Satellite, labels off | Hidden                | Roof patches  | Hidden/paused    |
| Terrain quality | Vector, labels on     | Ground-support at 80% | Hidden        | Hidden/paused    |
| 3D structure    | None; labels off      | Hidden                | Roof outlines | Visible/streamed |

All presets also clear the reference-test overlay, reset the crown-height filter
and point colour, and close native tools. Individual controls can customize the
view afterward. Provider layers now use `basemap-vector-*` IDs, separate from
the startup background, and installation checks existing sources/layers.
Regression checks use the actual startup style and reject duplicate IDs.

## Implemented analysis workflows

The **Analyze** panel exposes all four workflows below. Selection resets basemap,
labels, raster, candidates, reference points, cloud visibility and native tools.
The map stays mounted. The sidebar owns scrolling; the document does not scroll.
Deep links use `?view=gaps`, `?view=plots`, `?view=clearance` and `?view=models`.

| Workflow                | Actual processing and controls                                                                                                                                                                                                                                                                     | Interpretation                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canopy openings         | 4-connected supported 1 m cells at/below 2 or 5 m, minimum 25 m². Area filters 25/100/500 m². Roof patches plus 2 m excluded. 442/819 openings respectively; 377/696 pass the enclosed screen.                                                                                                     | Enclosed requires ≥80% high-cell boundary and no missing/tile boundary or roof contact. This is a geometric candidate screen; roads, fields, lawns and tile clipping remain possible. A reviewed forest mask is necessary for a forest-gap inventory.                                                                                     |
| Plot statistics         | 3,693 plots at 25 m; 924 at 50 m. Tile-origin squares. Mean/median/P95/SD height, supported area/coverage, share of supported cells >2 m, crown-candidate density and ground-support P95. Coverage filters 0/80/95/100%.                                                                           | Surface-cell statistics, including structures; not return-height percentiles. Candidate density uses supported area and is not stem density. Partial squares retain a complete-square denominator. Both scales partition exactly 2,279,933 supported cells; the existing summary rounds hectares to 0.001 ha.                             |
| Vegetation proximity    | For every roof patch, exact horizontal polygon-to-nearest elevated-cell-centre distance within 30 m at >2 or >5 m height. Roofs plus 2 m excluded. Filters at 5/10/30 m. Pink line connects the patch and selected cell.                                                                           | Elevated surfaces are vegetation candidates, not classified vegetation. The first 2 m outside patches are unassessed. Cell-edge range is centre distance ±0.707 m, bounded at zero; not uncertainty in measured elevation. No branch, wire, physical 3D clearance or compliance conclusion. Missing matches do not prove clearance.       |
| Building reconstruction | Actual Roofer 1.0.0 (`bb2a85a`) on all 178 input roof patches and 508,201 original cropped points: 236,330 height-screened roof points, 271,871 ground points. All 178 return success, producing 392 LoD2.2 roof surfaces and 19,120 display triangles. LoD1.2 + LoD2.2 CityJSONSequence download. | Inputs remain unverified roof-like patches, may split one building or include non-buildings. Class 6 was assigned within patches at height >2 m; not a trained classifier. All models pass original-surface edge-incidence checks. This does not test self-intersection, dimensional accuracy, building identity or semantic correctness. |

All distances and areas are processed in metric EPSG:3157. Gap display polygons
are simplified by 0.75 m and coordinates rounded to 7 decimal places; reported
area comes from original cells. Plot geometries are unsimplified square outlines.
New snapshots contain input SHA-256 hashes and are loaded on first opening
Analyze; they do not delay the initial map or rerun heavy algorithms in the browser.
The interface compares all input hashes against the deployed checksums before
showing results. CI also checks the snapshots, source identity and model export.

The model view draws the **actual triangulated LoD2.2 surfaces**, with amber roofs,
blue walls and a selected-patch ground viewing origin. It is not a height-only
extrusion. Triangulation uses a local best-fit plane and constrained Delaunay
triangles, preserving holes. Exports retain original CGVD2013 elevations. Compare
original points using the native GeoLibre control; its local Z offset is restored
after asynchronous cloud loading. Selecting another model changes the local origin.

Each model supports a local review decision (unreviewed, retain for inspection,
reject) and notes. Import/export checks source identity, candidate IDs and decision
values. Storage is browser-local, not shared or authoritative. Review labels never
silently edit footprints or regenerate model geometry. Editing roofprints requires
rerunning the versioned batch script; no server claims to process arbitrary uploads.

[Roofer](https://innovation.3dbag.nl/roofer/) is the executed reconstruction engine.
Its [input requirements](https://innovation.3dbag.nl/roofer/input_data.html) and
[architecture](https://github.com/3DBAG/roofer/blob/main/ARCHITECTURE.md) explain why
reviewed roofprints and building/ground separation matter. The full point cloud
has no original building or vegetation classes. A successful reconstruction from
candidate geometry does not supply that missing validation.
[lidR metrics](https://r-lidar.github.io/lidRbook/metrics.html) and
[INRAE forest structure](https://lidar.pages-forge.inrae.fr/lidaRtRee/articles/forest.structure.metrics.html)
provide the forestry context. Species, biomass, engineering clearance, solar yield,
runoff design and structural capacity are not inferred by these workflows.

## Reproduction and tests

Use the pinned scientific environment in `scripts/lidar/requirements.txt`.
Roofer is optional for the base pipeline and required to regenerate models.
Download the official Linux x86_64 **v1.0.0** release, extract it, make `bin/roofer`
executable and verify `roofer --version` is `roofer 1.0.0 (bb2a85a)`.
The package is GPLv3; this repository stores model products and scripts, not
Roofer binaries. Other platforms can use the corresponding official release.

```sh
python scripts/lidar/inspect_roofs.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --output src/pages/dev-lidar/roofInspection.generated.json
python scripts/lidar/workflows.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --output src/pages/dev-lidar/workflows.generated.json
python scripts/lidar/reconstruct_buildings.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --source /path/to/original.laz --work /path/to/roofer-work \
  --roofer /path/to/roofer/bin/roofer
python scripts/lidar/package_models.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --work /path/to/roofer-work \
  --output src/pages/dev-lidar/models.generated.json \
  --city-output src/pages/dev-lidar/buildings.generated.city.jsonl
python -m unittest discover -s scripts/lidar -p 'test_*.py'
python scripts/lidar/validate.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --roof-inspection src/pages/dev-lidar/roofInspection.generated.json
python scripts/lidar/validate_workflows.py \
  --analysis public/data/lidar-analysis/bc-093g086
npx vitest run src/pages/dev-lidar
npx tsc -b
npm run lidar:preview:build
```

Roofer runs with three jobs, EPSG:3157, the input `id` field, LoD1.2 + LoD2.2,
and a 30-second expensive-reconstruction fallback budget per building. Other
parameters use 1.0.0 defaults and are captured in its command record. Original
LAZ SHA-256 is checked before cropping. Points within roof raster cells are
height-screened; classified ground within an 8 m neighborhood is retained.
Roofer further crops points to the roofprint itself. No input binary is modified.

Tests cover known slopes, gables, no-data, gap connectivity and thresholds,
plot denominators/percentiles, exact polygon proximity/search radius, constrained
3D triangulation with holes, snapshot provenance, every mesh buffer, repeated
layer transitions, duplicate IDs, review import, and server-rendered controls,
metrics, errors and exports for all four workflows. Source plots partition the
supported raster cells at both scales. CI validates tracked snapshots even when
data products are cached. Browser/WebGL visual acceptance and independent
building/forest validation remain unperformed because browser-control tools are
unavailable in this session. HTTP and adapter tests do not substitute for them.
