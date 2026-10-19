# Linked tree inspection workspace

Open `/dev/lidar/?view=trees` or the same query on the private Sites preview. This implements the linked inspection, slicing, review and bounded method comparisons identified in [the viewer research](lidar-profile-interface-precedents.md). It keeps MapLibre, GeoLibre and the original EPT source; there is no embedded external application.

## Inspect and compare

The map stays mounted beside a resizable inspector on desktop. On smaller screens the map and inspector stack within the fixed viewport; the inspector, result list and comparison gallery scroll internally. Use the top toolbar for **Top map / 3D points**, inspector width and whole-tile fit. The shared fullscreen action expands the complete linked workspace. The existing vector/satellite context controls remain available in Map.

Selecting a crown on the map or candidate list automatically requests its bounded original-return crop. The inspector also provides candidate-ID search and Previous/Next navigation within the filtered/review queue. Selecting a saved comparison broadens height/area/edge filters as needed to reveal that candidate. Changing candidates cancels obsolete requests; source loading limits and retries remain visible.

The Trees workspace’s **Profile** tab provides:

- Black, height or manual-group colours, point size, cardinal-angle rotation, fit/shared-scale lock and independent pan/zoom.
- **Whole crown** or **Thin slice**, with explicit total width and perpendicular offset. The source-metric cut band appears on the map, and the 3D point layer uses the same filtered returns. A 0.5 m slice selects original points; it does not imply 0.5 m measurement accuracy or improve the 1 m segmentation grid.
- A shown-height range starting at 2 m, visible/crop counts, observed crop maximum, canopy-surface peak, exact source-cell crown area, terrain support and node/budget diagnostics.
- Picking by clicking a point or using the virtualized keyboard list. The picked original EPT node/index, geographic coordinates, source CGVD2013 elevation, terrain-normalized height and class appear together; the map and native 3D layer highlight that same return.
- Observed return counts by height, explicitly distinguished from foliage density or leaf area.
- A collapsible height-sorted gallery, fitted SVG/PNG figures and visible-return CSV with original coordinates, elevations, identities and review-group labels. Figure exports use the current slice/height/group filters and include method/source/view metadata. They fit the figure to its own shared metre scale rather than capturing an independently zoomed canvas.

Up to four candidate IDs and 150,000 comparison returns can be retained, plus the active bounded crop. IDs and view settings survive workflow changes and reloads. Source points remain in bounded memory; restoration re-fetches the original crops on demand. Raw point arrays are never written to localStorage.

The current crown crop excludes class 2/7/12/18 and heights below 2 m or above 80 m, using exact source-cell membership and source DTM normalization. Missing trunks, neighbouring branches, suppressed trees and non-tree structures remain important limits. A profile is an observed crown-column projection. It is not a complete tree model, a confirmed stem, a species identification or a DBH measurement. Empty/thin/sparse profiles are legitimate results and are not filled with invented geometry.

## Review and edit

The **Review / edit** tab adds reviewer decisions (unreviewed, tree-like, possible structure, merged crowns, split crown, insufficient data), notes and a filtered queue. These are human review records, not calibrated model probabilities or new training labels.

The point-group editor operates on bounded loaded returns. Select a polygon in the side profile, select individual original returns through the point inspector/list, or select all visible returns. Create a group, assign points to an existing group, merge loaded groups or reject points into group `0`. Rejected returns can be shown again. These operations update a separate assignment layer without modifying LAS classes, source coordinates or the original crown-cell partition.

Pick two to eight seed returns and use **Split by nearest 3D seed** to partition selected/visible points in terrain-normalized metric XYZ space. This is a deterministic manual nearest-seed operation, not LiDAR360's proprietary algorithm or a trained model. Reviewing from several angles is required; a merge only applies to loaded points, not every unseen point in a full tree.

Undo/redo retains twenty edit/review steps in the current session. Reviews, assignment identities, settings and comparison IDs persist in browser storage keyed to the source and crown-label hashes. Export/import a versioned JSON review manifest for backup or transfer between the Sites and PGMaps origins. Imports check source/segmentation identity, known candidate IDs, decisions, bounds and point-identity syntax; mismatches fail visibly. Edited assignments are bounded to 50,000 identities, notes to 2,000 characters each and imported manifests to 3 MB. Storage failure is shown and the current review remains exportable.

## Native transects

The dedicated **Transects** workspace (`/dev/lidar/transects/`) enables GeoLibre's own cross-section drawing API and streams the original full-cloud view. It has its own map/profile pane; crown selection/isolation belongs to the Trees workspace. Pick two endpoints on the map, change the total width, or draw a replacement. The adapter passes half of the displayed width as GeoLibre's perpendicular buffer distance. **Refresh loaded points** re-extracts the current cut without restarting the drawing.

These transects use the currently loaded streaming cloud, with a 750,000-input-return budget, and are labelled as previews. Source 1 m DTM values normalize the retained points. Classes 7/12/18, nonfinite values and supported heights outside −0.5–80 m are screened; source ground points remain available. Individual withheld/overlap flags are not exposed by this native profile API. Unsupported terrain stays blank in the exported CSV rather than becoming height zero. Charts draw at most 50,000 deterministically selected supported points; CSV retains all screened loaded returns. Export the geographic cut line with its total width and preview provenance.

## Actual algorithm comparison

The **Methods** tab loads the source-checked benchmark snapshot only when requested. Choose a plot and methods A/B, compare the sampled original returns at one metre scale, inspect per-method group colours and unassigned points, and focus the processing buffer/evaluation core/treetop locations on the map. The map shows method A. Colours identify each method's own instance IDs; equal colours across methods do not identify the same tree.

The saved outputs comprise twelve actual runs: current watershed membership, lidR Dalponte 2016, lidR Li 2012 and PointTree treeX ULS on three buffered source plots. The algorithms processed complete screened plot inputs; only display points are sampled. Selecting a method displays saved output rather than running R/Python in the browser. Runtime/RSS, input/output hashes, parameters and common-assigned-point agreement are inspectable/exportable. Watershed runtime measures existing membership lookup, not recomputation. Adjusted Rand agreement is not field accuracy.

TreeX's tested preset completed with zero instances in all three plots. Its stem search did not find support under those inputs/settings; this does not establish an absence of trees or rule out other settings. The UI preserves the unassigned output and does not manufacture diameters. [The benchmark record](lidar-segmentation-benchmarks.md) contains counts, exact screening differences, pinned versions and reproduction commands.

## Verification and maintenance

Pure tests cover metric rotations, full slice widths/offsets, height/rejection filters, map-band geometry, idempotent map layers, point-coordinate preservation, safe figures, source-bound review import, label alignment and all actual benchmark outputs. React interaction tests exercise picking, persistence across workflow switches/reload, original-ID restoration, decisions/notes, group creation/rejection/seed splitting, undo/redo, CSV/review export, failed imports and method/plot selection. These use a React test renderer and do not substitute for browser rendering.

The native adapter tests check half-width conversion, replacement versus refresh, source terrain normalization, missing support and CSV screening. Scientific tests check all full method-label arrays against sampled original identities where local processing arrays exist. `validate_tree_benchmarks.py` checks shipped benchmark/source/segmentation/generator/terrain identities without R/Torch and runs in the Pages deployment workflow, including cache hits. Actions also runs the LiDAR unit/interaction suite. R/Torch are only needed to regenerate benchmark outputs.

The repeatable local Chromium check is `npm run lidar:inspector:browser`, after `npm run lidar:preview:build` and preparation of the original EPT/analysis files. It uses the actual compiled app and original data through a temporary loopback server, saves screenshots/downloads in ignored `test-results/lidar-inspector`, and fails on page errors or failed HTTP responses. An installed Chromium or Playwright browser is required; `LIDAR_CHROMIUM_PATH` selects another executable. It exercises desktop/phone bounds, top/3D views, slices, actual canvas point picking, PNG download, persistent comparison IDs, review notes/undo/redo, real method outputs and GeoLibre's drawn transect. The completed run loaded 3,095 original returns for crown-1, downloaded a 97,129-byte PNG, compared actual saved method outputs, drew a terrain-normalized native transect, restored two saved comparison IDs, and passed desktop/390×844 phone no-document-scroll checks with no page errors or failed HTTP responses. Screenshots were inspected; the phone controls fold above the visible profile. The candidate virtual list mounts only while its panel is visible, avoiding synchronous zero-height remeasurement during resizing. This local browser check is separate from Actions' unit suite.

Future changes should preserve source precision, the no-document-scroll layout, bounded reads, distinct preview/measurement states and original-return lineage. Browser acceptance does not establish field accuracy, full-tree completeness, calibrated species identification or engineering clearance.

Navigation and code are organized into [focused tool workspaces](lidar-tool-workspaces.md). Use the header tool switcher for transects; the Trees task tabs remain Profile, Review/edit and Methods.
