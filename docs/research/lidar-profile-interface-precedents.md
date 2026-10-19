# Forestry profile viewers: precedents and interface recommendations

Reviewed 2026-10-19 against official documentation, upstream source and the current PGMaps implementation. These are recommendations, not additional implemented features. No external viewer was run against our tile, and browser interaction testing was unavailable.

## Closest precedents

| Tool                                                                                                                                                                                                                           | Verified behaviour                                                                                                                                                                                     | Useful adaptation for PGMaps                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LiDAR360 Individual Tree Editor](https://www.greenvalleyintl.com/docs/lidar360/ToolReference/TLSForest/IndividualTreeEditor.html)                                                                                             | Tree selection/filtering, a linked profile editing area, point inspection, merge/create/delete, seed-based re-segmentation and undo/redo. Its guide recommends normalized heights for profile editing. | A selected-candidate inspector with explicit review decisions and neighbouring-candidate context. Keep viewing, review annotations and point-label edits as distinct operations.                                                 |
| [Potree profile example](https://potree.org/demo/sitn/profile/examples/georeferencing.html) and [profile implementation](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/viewer/profile.js) | A profile linked to a movable map line; profile pan/zoom, point picking linked to the 3D scene, and CSV/LAS/DXF export in the source implementation.                                                   | Keep map and profile visible together. Link a picked point to its location and original attributes. Export exactly the selected subset with its coordinate/height definitions.                                                   |
| [CloudCompare Cross Section](https://www.cloudcompare.org/doc/wiki/index.php/Cross_Section)                                                                                                                                    | Adjustable box position, dimensions and orientation; orthogonal face views; single or repeated slice extraction.                                                                                       | Add an explicit thin-slice mode alongside the existing whole-crown projection. Show the actual cut footprint, offset and thickness on the map.                                                                                   |
| [FORA](https://github.com/fora-platform/fora) and [view implementation](https://github.com/fora-platform/fora/blob/e866d5b6a8cf0267515cd0fedef95043f3df3c01/src/App.jsx)                                                       | Browser forestry processing; simultaneous top/side canvases in 2D mode; two-point transects drawn in a lower panel. MIT licensed.                                                                      | Adopt the linked layout and task-specific controls. Its species-specific allometry is for Turkish species; transfer to this BC tile is unsupported. Its documented comparison measures cross-tool agreement, not field accuracy. |
| [3DFin](https://github.com/3DFin/3DFin) and [official tutorial](https://github.com/3DFin/3DFin_Tutorial)                                                                                                                       | Terrestrial-cloud inventory workflows with diagnostic layers. The tutorial flags suspect stem fits and withholds unreliable DBH estimates.                                                             | Present evidence and availability beside metrics: loaded-node coverage, terrain support, excluded height band and reviewer status. A visually plausible shape should not automatically produce a stem measurement.               |
| [3D Forest manual](https://vukoz-oel.github.io/3d-forest-documentation/3d-forest-user-manual.html)                                                                                                                             | Ground/elevation/descriptor preparation followed by trunk-connected segmentation.                                                                                                                      | Make prerequisites visible before offering a derived metric. Trunk-oriented methods depend on observable lower stems, which our airborne crown crop does not provide.                                                            |

These sources establish useful precedents. They do not establish that any method will achieve a particular accuracy or runtime on our 84.6-million-point tile.

## Existing GeoLibre capability we can reuse

The installed `maplibre-gl-lidar` 0.21.0 public declarations already expose:

- `enableCrossSection()` / `disableCrossSection()`;
- `setCrossSectionBufferDistance(meters)`;
- `getCrossSectionLine()` / `getCrossSectionProfile()`;
- `getCrossSectionPanel()`.

The upstream [control](https://github.com/opengeos/maplibre-gl-lidar/blob/main/src/lib/core/LidarControl.ts) obtains the merged currently loaded cloud for extraction. The [extractor](https://github.com/opengeos/maplibre-gl-lidar/blob/main/src/lib/tools/ElevationProfileExtractor.ts) returns source Z, point coordinates/attributes, distance along the cut and perpendicular offset. These APIs were inspected, not exercised in a browser during this review.

Use its line-drawing interaction for a native transect mode. Label a profile derived from the displayed cloud as a loaded-point preview. Quantitative forestry inspection should request a bounded source crop, normalize each retained return with our verified DTM and retain node/point identity. A plugin buffer distance is a distance from the centre line; expose **total slice width** unambiguously as twice that distance. Keep our source-metric calculations for short quantitative cuts rather than silently treating latitude/longitude degrees as equal-length axes.

## Current interface gaps

The existing `TreeProfilePanel` is inside the sidebar. Expansion helps comparisons, but it covers the map used to select the next candidate. Pinning requires repeated navigation, and pins disappear when the workflow changes. Profiles project all depths in the crown columns; rotation cannot separate points that overlap along the viewing direction. There is no candidate review record or link from an individual profile point to its map position.

The data already supports rotation, normalized heights, exact crown-column membership, original point identities, source-cell crown area and loaded-node/budget reporting. Those capabilities should become easier to use before adding more metric names.

## Recommended interaction and implementation order

### 1. Linked inspection workspace

Keep the existing native map mounted. On desktop, show the map beside a resizable profile pane; place a collapsible comparison strip below them. Keep the narrow sidebar for workflow, candidate filters and a short selected-candidate summary. On phones, stack the map and active profile within the fixed viewport and put controls in the existing drawer. Scroll the result list, gallery and inspector internally.

One selection must drive the footprint, treetop, 3D points, profile and statistics. Add candidate-ID search, Previous/Next within the filtered set, and a visible selection highlight. Selecting a new candidate should open its profile without a second navigation step, with cancellation and explicit progress/retry states. Fetch only the selected crop and bounded comparisons.

Keep black-on-white and height colour, cardinal view presets and shared metre scale. Add a point-size control and profile zoom/pan with an explicit **Fit / Lock comparison scale** choice. If a user enlarges one profile independently, visibly end the shared-scale claim for that view. Collapse long method explanations into help, preserving a short visible data-availability note.

### 2. Whole-crown projection versus thin slice

Add two clearly named modes. **Whole crown** retains the current projection of every eligible point in the candidate columns. **Thin slice** filters those same points by perpendicular metric distance from a movable/rotatable plane. Offer total widths such as 0.5, 1 and 2 m plus an offset control. Draw the cut band on the map and highlight eligible points consistently in 3D. Report slice returns / crop returns, and preserve the cut parameters in exports.

An empty thin slice is a valid result. Do not connect sparse dots, invent a trunk or smooth across missing height ranges. An optional return-count-by-height histogram can explain vertical sampling; label it as observed returns, not foliage density or leaf area.

### 3. Review queue and reusable comparisons

Add reviewer labels such as unreviewed, tree-like, possible structure, merged crowns, split crown and insufficient data, with notes. Distinguish human observations from model confidence. Review should be reversible and should not overwrite the original crown segmentation or LAS classifications.

Keep the four-profile budget initially, but save source/crown IDs, view parameters and review notes across workflow changes; re-fetch point data on demand. Store no large raw point arrays in localStorage. Export/import a versioned review manifest tied to source and segmentation hashes. Use distinct symbols/badges so reviewer status does not compete with height colours or the inventory-species legend.

Show observed return maximum, canopy-surface peak and exact source-cell area with their different definitions. Show budget/coverage limits and terrain support next to the values. The current 2 m lower crop limit excludes breast height: DBH remains unavailable. Lowering a display slider cannot restore discarded points; a future lower-stem inspection mode must request those original returns separately.

### 4. Compare segmentation methods on bounded plots

The [lidR individual-tree chapter](https://r-lidar.github.io/lidRbook/itd.html) demonstrates variable-window detection, raster/point-cloud segmentation and side-by-side method comparison. It is a suitable first benchmark for our canopy watershed. Compare a small buffered, reviewed set of plots using a CHM method such as `dalponte2016` and a point method such as `li2012`, preserving each run's inputs, parameters, IDs and unassigned points. Map disagreements and compare profiles before considering full-tile processing. Agreement between two methods is not ground-truth accuracy.

[PointTree/treeX](https://github.com/ai4trees/pointtree) is a further 3D-instance-segmentation candidate. Its documented input assumes terrain and vegetation, and its presets target TLS/ULS. Our source lacks vegetation/building labels and contains structure-like candidates, so first prepare and review suitable test plots and assess applicability to this airborne survey. Do not offer a treeX result as an available or validated workflow before actually running and checking it. PointTree is MIT licensed; native/Python dependencies belong in the reproducible processing pipeline rather than an assumed drop-in browser module.

Actual split/merge editing can follow this comparison, using a versioned point-assignment layer with undo/redo and immutable original returns. A hand-edited footprint alone must not be described as complete 3D tree isolation.

## Acceptance checks for the proposed work

1. At desktop and phone sizes, the document does not scroll; the map remains visible during profile selection, and internal panels remain reachable by keyboard and touch. Resizing/expansion preserves the MapLibre instance.
2. Rapidly selecting candidates cancels obsolete reads; only the active candidate can replace its profile. Empty, failed, sparse and budget-limited crops have different visible states.
3. At 0°, 90° and an oblique angle, known metric test points enter/leave the slice at the expected half-width and offset. Map band, profile dots, 3D highlights and exported point IDs agree, including boundary cases.
4. Shared-scale comparisons preserve equal horizontal/vertical metric scale. Independent chart zoom is visibly distinguished; hidden lower returns remain absent.
5. Picking a profile point locates its original coordinate and attributes. Pan/zoom, basemap changes and 3D rotation preserve selected ID and review state.
6. Saving/reloading a review restores IDs and view settings without retaining unbounded point data. Mismatched source/segmentation imports fail clearly; undo restores prior labels.
7. Algorithm comparison reports unassigned points, boundary buffering, parameter sensitivity and manually reviewed false/merged/split detections. Runtime/memory and field accuracy are measured separately.

The first three stages improve inspection with the existing data. The fourth requires new processing and a reviewed benchmark. Retain MapLibre/GeoLibre/EPT as the maintained rendering and data-loading base; adopt interaction patterns from these references rather than introducing a second embedded viewer.
