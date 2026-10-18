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

## Additional useful analyses

| Analysis                                           | What this tile provides                                 | What remains necessary                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roof heights, profiles, plane consistency          | Implemented inspection snapshot                         | Validate candidate identity and terrain under roofs.                                                                                                                                                                                                                              |
| Detailed LoD1/LoD2 buildings / CityJSON            | Dense original points and candidate locations           | Reviewed roofprint polygons, roof/ground point separation and reconstruction QA. [Roofer](https://innovation.3dbag.nl/roofer/) takes points plus roofprints; it does not turn arbitrary roof patches into verified building footprints. Roofer was researched, not executed here. |
| Roof facet pitch/aspect, solar or runoff screening | Existing DSM and points; whole-patch diagnostics        | Segment/validate facets first, then account for occlusion, shading, irradiation/weather or drainage assumptions. Current plane fits are insufficient for design.                                                                                                                  |
| Vegetation proximity to buildings                  | Crown candidates, normalized height and points          | Complete verified building outlines, suitable 3D geometry and an explicit clearance definition; current patches are incomplete.                                                                                                                                                   |
| Plot-level forest structure and height percentiles | Normalized returns, height surface, ground-support grid | Plot boundaries, explicit denominators and independent inventory reference for stand attributes. [lidR metrics](https://r-lidar.github.io/lidRbook/metrics.html).                                                                                                                 |
| Canopy gaps, edges and heterogeneity               | Height/cover grids and candidate crowns                 | Forest mask and thresholds; roads, fields and lawns are not automatically forest gaps. [INRAE forest-structure workflow](https://lidar.pages-forge.inrae.fr/lidaRtRee/articles/forest.structure.metrics.html).                                                                    |
| Habitat / vertical structure metrics               | Height-binned returns and original 3D points            | Voxel/return-structure analysis and ecological validation; leaf area or habitat quality is not directly measured by a point count.                                                                                                                                                |

Building reconstruction requirements are described in the
[Roofer input/architecture documentation](https://github.com/3DBAG/roofer/blob/main/ARCHITECTURE.md).
[PDAL normalized-height processing](https://pdal.org/en/stable/stages/filters.hag_delaunay.html)
and the [lidR area-based approach](https://r-lidar.github.io/lidRbook/modelling.html)
provide maintained foundations for extending the current batch pipeline.

## Reproduction and tests

```sh
python scripts/lidar/inspect_roofs.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --output src/pages/dev-lidar/roofInspection.generated.json
python scripts/lidar/test_roof_inspection.py
python scripts/lidar/validate.py \
  --analysis public/data/lidar-analysis/bc-093g086 \
  --roof-inspection src/pages/dev-lidar/roofInspection.generated.json
npx vitest run src/pages/dev-lidar
```

Tests cover a known pitched plane, a gable that must have a poor single-plane
fit, unknown aspect on flat planes, missing/outside profile samples, duplicate
startup/provider IDs, repeated installation, full workflow visibility transitions,
local viewing-origin arithmetic and existing height/provenance behavior. The
actual provider style validates with the startup style in Vector/Satellite/None
modes. Browser/WebGL visual acceptance and independent building validation remain
unperformed because browser-control tools are unavailable in this session.
