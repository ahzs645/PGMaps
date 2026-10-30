# MMGIS interaction comparison

Reviewed 2026-10-30 against MMGIS development commit
[`c576fe49`](https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd).
The comparison target is PG Maps `/dev/mmgis`, built on GeoToolkit
[`72c3e853`](https://github.com/ahzs645/geo-toolkit/tree/72c3e853454a40dee3185060a65e1881468dffac).

**This page implements an Earth GIS subset, not full MMGIS behavior parity.**
All 59 core plugin manifests were inventoried. The tables below compare the
source contracts and relevant implementations with the workbench. They do not
claim that every branch, gesture, configuration combination or deployment was
executed. MMGIS itself was not deployed or driven in a browser. Automated browser
checks exercise the PG Maps implementation with controlled source responses.

The [initial toolkit gap analysis](mmgis-geotoolkit-gap-analysis.md) describes the
package before this example was built. The [workbench guide](mmgis-workbench.md)
documents the resulting application, limits and ownership. Application features
added here do not become reusable toolkit APIs; the toolkit pointer is unchanged.
The [desktop/mobile validation matrix](mmgis-device-validation.md) adds the
viewport and input coverage for the implemented workflows, including touch taps,
vertex/pane dragging, pinch zoom and responsive split scenes.

## Tools: source behavior and local result

Source links are pinned. “Partial” means a useful subset works but behavior or
scope differs; it does not mean equivalent implementation.

| MMGIS core tool          | Source interaction contract                                                                                                                                                | Workbench result and remaining difference                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Layers][layers]         | Hierarchical headers, visibility, drag stacking, settings, opacity, styling, layer information/download and attachment controls                                            | Partial: vector groups, toggles, menu stacking, styles, opacity, metadata, filtering and tables. Reordering uses menu actions. Groups have one level; no arbitrary nested headers, attachment controls or raster shader editor.                                                               |
| [Legend][legend]         | Layer-aware legends, CSV/JSON symbols, continuous and domain-specific entries                                                                                              | Partial: toolkit legends derive from vector styles and selected categories filter map/table/export. No MMGIS geological symbol catalog or CSV legend configuration.                                                                                                                           |
| [Info][info]             | Select/intersection browsing, fields, nested property inspection/filtering, copy feature, locate, feature hide/unhide, datasets and links                                  | Partial: one feature, properties, map selection, table linkage, editable JSON and delete. No intersecting-feature browser, individual hide/unhide, primary-CRS clipboard or linked datasets.                                                                                                  |
| [Draw][draw]             | Geometry input/edit, files, templates, snapping, operations, annotations/symbols, permissions, history and publish                                                         | Partial: point/line/polygon input, live draft, double-click/Finish, vertex drag/keyboard, properties/delete, local undo/redo and import/export. No snapping, insert/remove vertex, hole editing, merge/split, template forms, annotations, file permissions, server history or collaboration. |
| [Measure][measure]       | Click anchor, live segment distance/clockwise-from-north bearing, segment/continuous/color modes; DEM profile, chart-to-map sample, CSV; profile line of sight and heights | Partial: geographic draft totals/area, live segment distance/bearing, dashed preview, sampled profile, cursor/map marker, keyboard sample and CSV. Profile generation is explicit. No mode selector, automatic per-click profile refresh, colored segments or profile line-of-sight overlay.  |
| [Identifier][identifier] | Hover samples multiple eligible raster layers/bands with configured scale/offset/units and temporal/COG/STAC sources                                                       | Partial: hover or tap inspects the original imported DEM cell; a separate action queries one connected COG band at the last pointer. No simultaneous multi-raster hover sampling, full metadata/scaling UI or STAC source resolver.                                                           |
| [Viewshed][viewshed]     | Observer/target heights, multiple analyses, FOV, resolution and color/reverse modes, terrain options                                                                       | Partial: shared PG Maps worker, one observer, radius/eye height, pending/current result, terrain/no-data semantics. Fixed 128×128 display grid and bounded Earth overview data. No multi-observer/FOV/reverse/target-height UI or claim of numerical equivalence.                             |
| [Sites][sites]           | Configured sites navigate to a view and can apply layer state                                                                                                              | Partial: user-created named camera bookmarks. No site-specific layer presets or mission/site hierarchy.                                                                                                                                                                                       |
| [Animation][animation]   | Frame/crop planning, temporal rendering readiness, forward/reverse/swing, frame sequence/GIF/MP4                                                                           | Absent: cumulative daily vector playback and a single map-canvas PNG exist, but no animation export or frame-readiness pipeline.                                                                                                                                                              |
| [Curtain][curtain]       | Radar/subsurface imagery aligned to a path in globe, linked image interaction/depth controls                                                                               | Absent. Two MapLibre views do not provide a radar curtain.                                                                                                                                                                                                                                    |
| [Sightline][sightline]   | SPICE body/orbiter/terrain visibility, time sweeps and scientific geometry                                                                                                 | Absent. Earth terrain viewshed is a different analysis.                                                                                                                                                                                                                                       |

## Concrete gesture and state checks

Tests live in [mmgis.spec.ts](../tests/e2e/mmgis.spec.ts),
[mmgis-responsive.spec.ts](../tests/e2e/mmgis-responsive.spec.ts) and
[mission.test.ts](../src/pages/dev-mmgis/mission.test.ts). A check verifies the
described PG Maps outcome, not that the corresponding MMGIS implementation was
run. Where relevant, browser checks inspect actual MapLibre sources, terrain and
paint state in addition to accessible controls.

| Interaction                        | Local behavior checked                                                                                                | Difference or remaining verification                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hide/show and history              | Hidden features leave the visible set; undo restores it.                                                              | No remote invalidation or server history.                                                                                                              |
| Legend and styling                 | Category filtering changes the feature set; simple style and zero opacity reach renderer paint.                       | Other style editors reuse existing PG Maps controls; every style combination is not browser-tested here.                                               |
| Layer stack/group                  | Menu move changes stacking; group checkbox hides members.                                                             | Drag sorting/nested group behavior differs.                                                                                                            |
| Search → selection → table         | Search can filter map/table, and result selection opens the same feature.                                             | Local property search only; no MMGIS server/spatial search syntax.                                                                                     |
| Selection after visibility change  | Hiding the selected layer clears inspector/selection and corresponding highlight.                                     | Overlapping-feature cycling and per-feature hiding are absent.                                                                                         |
| Point → property edits → undo/redo | Geometry created; JSON editor follows undo even when only a non-name property changes.                                | Read-only examples must first be copied; no authorization service.                                                                                     |
| Rapid clicks/double-click          | A three-vertex line is committed once with all vertices and no repeated terminal coordinate.                          | No snapping; click-first-vertex polygon completion is not implemented.                                                                                 |
| Polygon closure/keyboard edit      | Closed ring survives keyboard vertex movement, mission undo, delete and restore; mouse/touch drag is also exercised.  | Mouse/touch drag, pane resize and rotation are covered; holes/multi-geometries cannot be vertex-edited.                                                |
| Escape                             | Stops drawing so subsequent map clicks do not add draft vertices.                                                     | Keeps the draft available; it does not implement MMGIS's complete tool switching semantics.                                                            |
| Live measure                       | Mouse movement after the first anchor produces segment distance/bearing and the draft preview.                        | Fixed Earth/geographic units; no planetary body radius.                                                                                                |
| Profile → map                      | Decoded overview terrain produces numeric samples; keyboard profile cursor shows corresponding map marker.            | Pointer hover uses the same sample path, but MMGIS was not run for side-by-side comparison.                                                            |
| Terrain/viewshed                   | Terrain is enabled on the map and the real shared worker produces a rendered analysis source.                         | Test terrain is a controlled flat Terrarium tile, not an accuracy benchmark. Local imported DEM does not drive the viewshed.                           |
| Mixed geometry import              | Point and line features reach separate rendered GeoJSON sources; switching views keeps data.                          | Browser fixture is GeoJSON. Shapefile/KML/CSV decoder behavior relies on existing importer/unit coverage.                                              |
| Plan/globe/split                   | Alternate view mounts and view changes retain sources.                                                                | Plan drives split camera; no bidirectional scientific globe/media pose synchronization.                                                                |
| Time stepping/playback             | Inclusive UTC end-day filtering, daily step and play/pause change visible data.                                       | Vector date fields only. No sub-day UI, rolling relative window, raster reload or request-ready frame export.                                          |
| Bookmark                           | Save view, zoom away and restore camera.                                                                              | Does not capture layer visibility as an MMGIS site can.                                                                                                |
| Mission persistence/share          | Save/reload, create a link, clear workspace and restore data through that link; invalid files leave workspace intact. | Browser local storage and embedded compressed data, not accounts, durable uploads or shortened links. Selection/tool/draft are not mission-file state. |
| Raster query/failure               | COG tile source attaches; numeric zero remains zero; a 503 shows an error while vectors remain available.             | Stubbed TiTiler responses. External server/CORS/auth availability and arbitrary asset metadata are not proven.                                         |
| Export/mobile                      | Mission/CSV/GeoJSON/profile/PNG downloads, usable touch tools and no horizontal page overflow.                        | PNG captures the WebGL map only. No composed HTML markers/panels or KML/shapefile export.                                                              |

The source comparison led to fixes for dropped rapid-click vertices, repeated
double-click endpoints, stale property JSON after undo, stale selection after
hiding a layer, and lost elevation ordinates during XY vertex edits. It also led
to live measurement feedback and profile/map cursor linkage. Validation rejects
malformed map colors before restoring a mission.

## Layer types: complete core inventory (11)

See the pinned [layer contracts][types]. MMGIS's own renderer support differs by
type; globe-only layers are not assumed to work on its map.

| Core type   | Workbench result                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Header      | Partial: one-level vector groups; no arbitrary hierarchy.                                                                                       |
| Vector      | Partial: local/URL/catalog GeoJSON plus file conversions, geometry-family rendering, styles and interactions.                                   |
| Tile        | Partial: XYZ overlays; no WMS/TMS controls or arbitrary tile matrices.                                                                          |
| Data        | Partial: original local DEM inspection and TiTiler COG band query; no complete scientific raster contract, shader, formula or band metadata UI. |
| Query       | Partial local search/filter only; no server spatial-query layer.                                                                                |
| VectorTile  | No configurable mission vector-tile layer. Toolkit low-level capabilities alone are not a workbench feature.                                    |
| Image       | No configurable georeferenced image mission layer. Toolkit image primitives alone are not feature parity.                                       |
| Model       | Absent: no georeferenced OBJ/GLTF model lifecycle/picking.                                                                                      |
| ThreeDTiles | Absent: no streamed 3D tileset.                                                                                                                 |
| Velocity    | Absent: no vector-field particle renderer.                                                                                                      |
| Video       | Absent: no georeferenced video layer/time linkage.                                                                                              |

## Interaction plugins: complete core inventory (13)

MMGIS runs a [configured phased interaction pipeline][runner]. The workbench uses
scoped React state/callbacks and does not reproduce this plugin contract.

| Core interaction | Workbench comparison                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Select           | Partial: one selected local vector feature with map highlight and inspector; shared selection in split views. |
| InfoOpen         | Partial: feature click opens inspector; no gathering/browsing all intersecting features.                      |
| InfoSilent       | Absent as a configurable background information action.                                                       |
| CursorShow       | Basic hover/tool cursor, not configurable per-layer interaction rules.                                        |
| CursorHide       | Basic cursor cleanup, not MMGIS's configured suppression/phase behavior.                                      |
| DrawContextMenu  | Editing lives in inspector; no equivalent feature context menu.                                               |
| EventNotify      | Scoped application state/read-only WebMCP exists; no `newActiveFeature` document-event compatibility.         |
| SearchUrl        | Absent: no feature-configured external URL search action.                                                     |
| ViewerOpenPanel  | Absent: no scientific media viewer panel.                                                                     |
| ViewerUpdate     | Absent: no selected-feature media/pose update pipeline.                                                       |
| WaypointImage    | Absent: no image waypoint interaction.                                                                        |
| WaypointModel    | Absent: no model waypoint interaction.                                                                        |
| ChemistryUse     | Absent: optional Chemistry plugin integration is not provided.                                                |

Source: all manifests and handlers under [core interactions][interactions].

## Attachments and components: complete core inventories (8 + 2)

None of the eight [layer attachment contracts][attachments] is implemented as a
configurable mission attachment: **Bearing, CoordinateMarkers, ImageOverlays,
Labels, Model, Pairings, PathGradient, UncertaintyEllipses**. A drawing's vertex
handles and profile marker are purpose-specific controls, not those contracts.
Toolkit grid uncertainty does not implement feature uncertainty ellipses.

Of the two [components][components], **Search** has a partial local property-search
equivalent, without MMGIS's configurable providers/coordinate search. There is no
**OperationsClock** equivalent with relative intervals/live refresh.

## Backends: complete core inventory (14)

The workbench implements none of the MMGIS [backend plugin APIs][backends]:
**Accounts, Broadcast, Config, Datasets, Draw, GeneralOptions, Geodatasets,
LongTermToken, Shortener, Sightline, Stac, Users, Utils, Webhooks**.

Local mission JSON is a subset of configuration behavior, not Config API parity.
Local feature edits are not the Draw service. URL data fetches are not indexed
Geodatasets. A TiTiler URL is not a STAC catalog. Local persistence/share cannot
provide accounts, server-enforced permissions, multi-user history/publish,
subscriptions/reconnect or webhook delivery. Those require separately deployed
services and explicit client contracts.

## Shared systems and optional plugins

- [TimeControl][time]: only vector inclusive-date filtering/daily playback is
  implemented. MMGIS per-layer time windows, relative windows, availability and
  refreshed raster/query sources remain missing.
- [Viewer][viewer]/globe: plan/globe/split provide Earth MapLibre cameras, not
  deep zoom, photosphere, PDF/video/scientific model viewers, georeferenced poses
  or planetary globe integration.
- [Projection configuration][projection]: no custom body/ellipsoid, native
  planetary tile matrix, primary-CRS clipboard/export or SPICE clock. Imported
  local DEM CRS conversion is bounded as described in the workbench guide.
- Configuration administration: no visual mission builder with versioned server
  save, conflict/publish/restore, plugin installation or mission permissions.
- [Official optional plugins][optional] were inventoried at `d58f249b`.
  Chemistry and Isochrone are not implemented. Experimental Agent/AgentChat,
  Analysis, Segment and Workflows are not baseline core requirements; external
  dependencies do not become available by adding this route.

## Remaining acceptance work for stronger parity

1. Extract the local layer/editor/temporal contracts into independently tested
   GeoToolkit APIs; this example currently composes PG Maps host adapters.
2. Add scientific raster metadata/band/no-data/time contracts and one injectable
   DEM provider shared by display, inspection, profiles and analysis.
3. Implement multi-feature editing, snapping/vertex operations, feature templates
   and declared interaction precedence; test mouse/touch/keyboard and overlapping
   geometry cases.
4. Add provider-backed spatial/search/time queries, cancellation/refresh state and
   animation frame readiness.
5. Supply backend contracts for accounts, durable geodata, versioned missions,
   collaboration and publishing before exposing corresponding controls.
6. Deploy a pinned MMGIS reference with matching Earth fixtures and services,
   then run the same user journeys on both. Include no-data, service failures,
   permissions, reconnects and larger datasets. No runtime parity claim should
   precede that comparison. Planetary/scientific viewers add separate acceptance
   requirements.

[layers]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Layers/LayersTool.js
[legend]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Legend/LegendTool.js
[info]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Info/InfoTool.js
[draw]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Draw
[measure]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Measure/MeasureTool.js
[identifier]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Identifier/IdentifierTool.js
[viewshed]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Viewshed/Viewshed.md
[sites]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Sites/SitesTool.js
[animation]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Animation/Animation.md
[curtain]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Curtain
[sightline]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Sightline/Sightline.md
[types]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/layertypes
[runner]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/Basics/InteractionRunner/InteractionRunner.js
[interactions]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/interactions
[attachments]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/layerattachments
[components]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/components
[backends]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/backend
[time]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/Basics/TimeControl_/TimeControl.js
[viewer]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/Basics/Viewer_
[projection]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Configure/Tabs/Projection/Projection_Tab.md
[optional]: https://github.com/NASA-AMMOS/MMGIS-Plugins/tree/d58f249be98105bc86391ffa31223e375c01ec26
