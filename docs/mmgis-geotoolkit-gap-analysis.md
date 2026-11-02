# MMGIS versus @pgmaps/geo-toolkit: feature and architecture gap analysis

Reviewed 2026-10-30.

This is the initial package-level review, before the `/dev/mmgis` host example
was implemented. Statements about checks not being run refer to this initial
review. See the [workbench guide](mmgis-workbench.md) for the implementation and
the [interaction comparison](mmgis-interaction-comparison.md) for its verified
subset and remaining differences. The host example does not change the toolkit
revision or turn host adapters into exported package capabilities.

## Finding

**GeoToolkit can serve as the foundation for an MMGIS-like Earth GIS application today, but it is not currently a complete MMGIS replacement.** The missing work is concentrated in reusable GIS interaction/orchestration, scientific raster and terrain workflows, a configuration product, and multi-user services. Recreating NASA's planetary workflows adds a separate rendering, coordinate-system, and ephemeris problem.

There is no evidence of a fundamental limitation preventing an application built with GeoToolkit from reaching comparable functionality. There are substantial capabilities that neither the package nor its current exported contracts implement. Some can be extracted from PG Maps; others require new libraries or backend services. A map engine's ability to render something is not the same as the toolkit providing a supported end-to-end feature.

## Scope and evidence

- GeoToolkit: local clean checkout `72c3e853454a40dee3185060a65e1881468dffac`, package `@pgmaps/geo-toolkit` 0.1.0. Read README, API guide, package boundaries/exports, source inventory, and relevant map, grid, workspace, project, story, chart and export implementations.
- MMGIS: GitHub default branch **development**, pinned at `c576fe4925ef6e65c74141516d3b0ffa50def6bd`; package version `5.4.6-20261020`. Inventoried all core plugin manifests and examined documentation and implementations for layers, tools, rendering/viewers, temporal state, configuration, geodatasets, collaboration and services.
- Official optional MMGIS plugins: manifest inventory and selected documentation at `NASA-AMMOS/MMGIS-Plugins` commit `d58f249be98105bc86391ffa31223e375c01ec26`.
- PG Maps: local checkout `37058a774315fd30d32103db385e581a80ee53d2`; examined relevant existing host implementations as extraction candidates. This is not an exhaustive audit of every PG Maps feature.

This is a source-based feature/architecture review, not a line-by-line correctness or security audit. MMGIS was not deployed, external services were not provisioned, and no runtime parity, performance benchmark, or browser verification was performed. “Present” means an implementation/API exists in the inspected source, not that every production scenario was exercised. Absence judgments apply to the inspected GeoToolkit source and documented exports.

### Important corrections to MMGIS's headline feature list

The README is useful orientation but is not an exact inventory of the current checkout:

- **11 core tool manifests:** Animation, Curtain, Draw, Identifier, Info, Layers, Legend, Measure, Sightline, Sites, Viewshed.
- **11 core layer types:** Data, Header, Image, Model, Query, ThreeDTiles, Tile, Vector, VectorTile, Velocity, Video. The README's “10 layer types” omits the current ThreeDTiles type.
- Additional core families: **8 layer attachments, 13 interactions, 2 UI components, 14 backend plugins**.
- **TimeControl is a shared core subsystem**, not one of the 11 tool manifests. The old Kinds behavior is now represented by an interactions system.
- **Shade was renamed Sightline**; do not count them as two independent capabilities.
- **Chemistry and Isochrone are official optional plugins**, not tools bundled in this core checkout.
- The README's standalone Query tool is not present in the core tool inventory or the inspected official plugin inventory. Query layers, filtering, feature search and spatial APIs do exist. Compare those actual capabilities rather than assuming an extra shipped tool.
- The official plugin collection also includes experimental Agent/AgentChat, Analysis, Segment and Workflows integrations. Analysis and Segment document unreleased backend dependencies; Workflows requires an external API. These are not baseline production-parity requirements.
- STAC, TiTiler, TiTiler-PgSTAC, TiPG and velocity service integration depend on deployment configuration. WebSocket features are also configurable and disabled in the sample environment. Presence of code does not mean every installation enables it.
- MMGIS's layer types are not universally supported in every view: Image, Data, Velocity and Video are map-only in their manifests; Model and ThreeDTiles are globe-only. Full parity does not require inventing unsupported cross-view behavior.

Sources: [core manifests][M-core], [layer contract][M-layer-contract], [changelog][M-changelog], [optional plugin collection][M-plugins], [sample environment][M-env].

## What GeoToolkit already contributes

These capabilities should be retained and assembled rather than rebuilt:

- MapLibre maps with controlled camera callbacks, globe projection, map refs, custom styles and fallback styles; persistent-map support.
- GeoJSON polygons, lines and circles, mixed-geometry overlays, heatmaps, clustered pie markers, routes, image/canvas overlays, raster tile display and PMTiles polygon layers.
- MapLibre expression-based paint/filter inputs, layer ordering, feature selection/hover/click hooks, and optional deck.gl overlay integration.
- Reusable sidebars, responsive layouts, scoped workspace events, mobile cards, lists, dialogs, legends, range controls and playback controls.
- Explicit classification and no-data semantics, source RGBA preservation, uncertainty-aware classified grids, and exact scale/legend contracts.
- Time series, range bands, scatter plots and linked chart building blocks, plus generic scoring/Index Lab workflows.
- Scene stories, editorial stories, comparison presentation contracts and a swipe component. Hosts supply map/data/comparison adapters.
- Validated project JSON import/export through host codecs, memory/Web Storage repositories, injectable share/export interfaces, CSV export and map-canvas image capture.

Sources: [API][T-api], [map implementation][T-map], [map layers][T-layers], [projects][T-projects], [stories][T-stories].

## Feature matrix

Status refers to **GeoToolkit itself**. “Partial” means usable foundations exist but the equivalent workflow is incomplete. “Host candidate” means relevant PG Maps code exists outside the package; it is not automatically portable or equivalent.

| MMGIS capability                                                                    | GeoToolkit status                                               | What is missing or needs integration                                                                                                                          | Likely owner / route                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Standard interactive 2D map, camera, controls, popups                               | Present foundation                                              | Compose the application and data adapters                                                                                                                     | Host app, using existing map/UI modules                            |
| GeoJSON points, lines, polygons and thematic styling                                | Present foundation                                              | A uniform layer descriptor and user-facing style editor                                                                                                       | Toolkit explorer plus host catalog                                 |
| Hierarchical layer browser, visibility, opacity, ordering                           | Partial; host candidate                                         | General layer tree/store, nested groups, reorder UI, metadata, zoom-to-layer and consistent state restoration                                                 | Extract generic parts of PG Maps data workspace                    |
| Legends                                                                             | Present foundation                                              | Resolve legends uniformly from arbitrary source/renderer metadata; edit or register symbols where needed                                                      | Toolkit layer registry over existing scales/legend UI              |
| Raster tile display                                                                 | Present                                                         | Generic XYZ display exists; standardized TMS/WMTS/WMS connection and metadata handling do not                                                                 | Source adapters; host config                                       |
| Vector tiles and large vector data                                                  | Partial                                                         | PMTiles fill exists; generic remote MVT/TileJSON point/line/fill APIs, full-feature retrieval and server query adapters are not a complete supported workflow | Toolkit adapters plus tile/query service                           |
| Arbitrary dataset upload                                                            | Missing in package; host candidate                              | Reusable file readers, validation/CRS normalization, progress/errors and add-layer workflow                                                                   | Extract PG Maps GeoJSON/shapefile/KML/CSV importer                 |
| Managed, indexed geodatasets                                                        | Missing                                                         | Durable ingestion/storage, schema/statistics, spatial/time indexes, append/recreate, query endpoints and generated tiles                                      | Backend; PostGIS or equivalent                                     |
| COG/GeoTIFF imagery                                                                 | Missing general workflow; host candidate for bounded DEM import | Georeferencing, metadata, range reads or tile service, overview/band selection and styling                                                                    | Optional raster module; TiTiler-style service or client decoder    |
| Numeric raster rendering                                                            | Partial                                                         | Current PNG/grid code is not a general float/multiband raster stack; add numeric source contract, masks, scaling and shader/renderer integration              | Optional raster module                                             |
| COG/STAC band combinations, expressions, mosaics                                    | Missing                                                         | STAC discovery/search, asset resolution, mosaic selection, band/expression/style requests                                                                     | Raster adapters and STAC/TiTiler-PgSTAC services                   |
| Identifier: raw pixel values with units and scaling                                 | Missing general tool                                            | Source-space sampling, bands, time, no-data, units and cursor result UI                                                                                       | Toolkit inspector plus raster query provider                       |
| Feature properties/info panel                                                       | Partial; host candidate                                         | Generic field schema, formatting, feature identity, cross-layer selection and linked detail/table experience                                                  | Toolkit explorer; PG Maps feature attributes/table code            |
| Cross-layer feature search                                                          | Partial; host candidate                                         | Search provider/index, autocomplete, filter/select modes, and server-backed search; `requestMapSearch` only requests UI behavior                              | Toolkit search contracts/UI; host provider                         |
| Attribute filtering and spatial queries                                             | Partial; host candidate                                         | Query model, field metadata, filter editor, geometry selection, query result layer and server aggregations                                                    | Toolkit query contracts plus backend adapter                       |
| Interactive distance/angle measurement                                              | Missing packaged tool; host candidate                           | Input controller, overlays, units, segment/continuous modes and interaction arbitration                                                                       | Extract/generalize PG Maps interaction tools                       |
| Elevation profiles linked to a path/map cursor                                      | Missing packaged workflow; host candidates                      | DEM provider, path sampling, profile controller and chart/map selection link; chart primitives already exist                                                  | Optional terrain module                                            |
| Geometry creation/editing                                                           | Missing packaged tool; host candidate for basic input           | Draw/edit state, vertex operations, selection, snapping, undo/redo and metadata forms                                                                         | Optional editing module; established editor integration is viable  |
| Merge/split, geologic symbols, arrows, annotations, feature templates               | Missing complete editing suite                                  | Geometry operations and symbol/template contracts plus specialized editor UI                                                                                  | Toolkit editing/symbology, domain extensions                       |
| Multi-user files, publish/history/restore                                           | Missing                                                         | Authoritative feature/file persistence, ownership, history, published snapshots and conflict behavior                                                         | Backend with toolkit client adapters                               |
| Live drawing and layer/configuration notifications                                  | Missing                                                         | Authenticated subscriptions, refresh/invalidation, reconnect behavior and stale-state UX                                                                      | Backend plus collaboration client                                  |
| Application-wide temporal control                                                   | Partial; host candidate                                         | Workspace time model, per-layer overrides, availability, relative windows, temporal requests, refresh/cancellation and persistence                            | Toolkit temporal controller and source adapters                    |
| Animated playback of temporal map layers                                            | Partial                                                         | Playback UI exists; coordinate it with layer request completion and application time                                                                          | Temporal controller plus host adapters                             |
| GIF/MP4/frame-sequence export                                                       | Missing                                                         | Frame planning/readiness, image composition, overlays/crop, encoding, cancellation and state restoration                                                      | Optional export module/worker or service                           |
| Static map image/data export                                                        | Partial                                                         | Canvas capture, CSV and project JSON exist; complete capture including HTML overlays, GIS export formats and unified export UI need work                      | Toolkit export adapters; host policy                               |
| Sites / named saved views                                                           | Partial                                                         | Scene/place/camera contracts exist; add independent bookmark management and storage                                                                           | Small toolkit controller plus host repository                      |
| Shareable full workspace URL, short links                                           | Partial                                                         | Share port exists but has no transport; camera/layers/time/selection/tool/viewer URL serialization is not a generic workspace API                             | Toolkit state codec; host router/share service                     |
| Earth globe / tilted 3D-looking map                                                 | Present foundation                                              | Globe projection and MapLibre access already exist; this alone is not MMGIS's scientific 3D environment                                                       | Existing map, with host integrations                               |
| Tiled terrain and configurable DEMs                                                 | Partial engine access; host candidate                           | Supported terrain source/configuration, elevation provider, sampling, rendering lifecycle and source metadata                                                 | Optional terrain module over MapLibre                              |
| Synced 2D map, 3D globe and selected feature/media                                  | Missing complete workflow                                       | Shared cross-view state and layout, camera mapping, feature/media IDs and adapter lifecycle                                                                   | Toolkit viewer coordination plus optional 3D engine                |
| OBJ/GLTF models and streamed 3D Tiles                                               | Missing packaged workflow                                       | Model/tileset loading, georeferencing, scale/orientation, picking and lifecycle                                                                               | Optional 3D adapters; deck.gl or Cesium/LithoSphere as appropriate |
| Deep-zoom images, photospheres, scientific model/PDF/video viewer                   | Partial ordinary story media only                               | Feature-linked media manifest, deep zoom, camera/pose, target overlays and synchronized selection                                                             | Optional viewer module with specialist libraries                   |
| Radar curtains / subsurface imagery                                                 | Missing                                                         | Path-aligned textured curtain, elevation/depth mapping, vertical scale and radargram viewer coordination                                                      | Optional scientific 3D extension                                   |
| Velocity particles / animated vector fields                                         | Missing packaged renderer                                       | Grid-field contract, particle renderer, temporal updates and legend                                                                                           | Optional renderer / external library adapter                       |
| Georeferenced video overlay                                                         | Missing packaged layer                                          | Map video source wrapper, time/extent/lifecycle and layer descriptor                                                                                          | Small map adapter plus explorer support                            |
| Per-coordinate attributes, bearings, path gradients, uncertainty ellipses, pairings | Partial low-level drawing only                                  | Reusable typed attachment/decorator contracts and corresponding renderers; generic grid uncertainty is a different capability                                 | Toolkit symbols/attachments extension                              |
| Viewshed and terrain line of sight                                                  | Missing in package; strong host candidate                       | Portable elevation input, analysis/worker lifecycle and controls; audit limits against MMGIS FOV, curvature, multi-view and resolution semantics              | Extract PG Maps terrain-viewshed and visibility code               |
| Terrain reachability / least-cost paths                                             | Missing packaged equivalent                                     | Raster cost/slope/obstacle models, solver, reachable-area layer and path inspection                                                                           | Optional terrain analysis; MMGIS Isochrone is an optional plugin   |
| Celestial/orbiter visibility, shadows, mission time                                 | Missing full equivalent; limited Earth sun host candidate       | SPICE kernels, body/orbit frames, mission time conversion, terrain visibility sweep and service APIs                                                          | Specialist backend and scientific tool extension                   |
| Planetary CRS, custom projected tile matrices and local frames                      | Missing complete architecture                                   | Body/ellipsoid model, CRS transforms, tile matrix support, coordinate display/export and body-aware measurements                                              | Projection/body contracts plus a suitable renderer                 |
| Visual mission/application configuration                                            | Missing                                                         | General workspace schema, authoring forms, preview, validation, template creation and layer/tool configuration                                                | Separate builder application consuming toolkit                     |
| Multiple hosted missions, versioned configuration                                   | Partial generic project storage only                            | Mission catalog/access, remote version history, clone/restore, publish, multi-admin conflict detection                                                        | Backend/configuration product                                      |
| Accounts, SSO, roles, mission permissions, API tokens                               | Missing                                                         | Authentication and authorization service, sessions/tokens and server-enforced resource access                                                                 | Host backend / identity provider                                   |
| Plugins for layers, tools, interactions, attachments and backends                   | Partial React/adapters only                                     | Explicit capability registry, lifecycle, source/style/time/legend/inspect hooks and validation; CLI optional                                                  | Small toolkit extension contracts; host manages installation       |
| Webhooks / external operational workflows                                           | Missing                                                         | Server event delivery, configured destinations and external job adapters                                                                                      | Host services; optional workflow integration                       |
| Tiling/preprocessing and deployment                                                 | Outside toolkit's role                                          | Raster/terrain preparation, data hosting, service deployment, database operations and storage management                                                      | Data/service infrastructure                                        |

MMGIS sources: [tools][M-tools], [layer contract][M-layer-contract], [layer types][M-types], [geodatasets][M-geodata], [time][M-time], [viewer][M-viewer], [configuration][M-config], [coordinates/projections][M-proj], [plugins][M-plugin-contract]. Toolkit sources: [API][T-api], [map][T-map], [layers][T-layers], [grids][T-grids], [projects][T-projects], [workspace][T-workspace], [export capture][T-capture].

## The gaps that actually block an equivalent application

### 1. A configurable explorer is not yet a portable toolkit feature

Today a consumer must assemble layer state, metadata, source loading, tables, filters, selection, time and controls. Rendering components alone cannot turn an arbitrary dataset configuration into MMGIS's explorer.

The most useful addition is a reusable explorer controller and layer registry that understands source identity, geometry/renderer, style, visibility, opacity, ordering/groups, attribution, extent, legend, inspection, filtering and time capabilities. Preserve the existing low-level map components. Let the application supply catalogs and service connections.

**PG Maps head start:** `src/pages/dev-data/` already has a workspace reducer, groups with all/one/swipe modes, styling, legend/table/detail and add-data UI. `src/maps/project-explorer/` has search, category filter, timeline, ranked results and aggregate features. These are starting points, not a complete arbitrary-source explorer. Source-specific catalog logic and `@/` imports must be replaced with injected contracts. [H-data] [H-explorer]

### 2. There is no general scientific raster source/query contract

Rendering colored PNG tiles is insufficient for “show a multispectral COG, change its band expression, inspect raw values, and sample its DEM.” GeoToolkit's PNG decoder explicitly accepts 8-bit RGBA data; its classified grids preserve evidence and uncertainty but are not general 16/32-bit scientific raster readers.

Add raster metadata and sampling contracts covering CRS, extent, band data types, scale/offset, units, masks/no-data, native resolution, time and asset identity. Rendering and queries must use the same band/expression/time configuration. Never infer exact scientific values from rendered colors.

**Integration route:** retain `MapRasterLayer` for display and provide TiTiler/STAC adapters, or add a client decoder for appropriate workloads. Mosaic catalogs and on-demand tile generation remain services. Existing PG Maps single-band, cropped local DEM import is an extraction candidate, not COG/STAC parity. [T-grids] [M-identifier] [M-data-layer] [H-raster]

### 3. Editing is a product-sized gap beyond drawing a shape

MMGIS Draw includes files, feature geometry/properties, templates, annotations, history, publish flows and permissions. Basic map click capture covers only the initial input step.

Separate a reusable local editor from multi-user persistence. Define commands and feature IDs, undo/redo, geometry validation, snapping and selection; add a server-backed file/feature/history interface for collaboration. A mature editor adapter can avoid implementing every vertex interaction from scratch.

**PG Maps head start:** `MapDrawCapture`, domain draw workflows and measurement undo/redo. None establishes collaborative editing parity. [M-draw] [M-draw-backend] [H-draw] [H-measure]

### 4. Time is UI today, not a common data lifecycle

`PlaybackControls` and chart ranges are useful existing pieces. MMGIS also ties time to raster URLs, vector requests, per-layer windows and availability. GeoToolkit needs a per-workspace temporal controller, source refresh contract, cancellation/stale-response behavior, and state serialization.

For deterministic frame export, wait for the relevant data to finish loading before capture and restore the prior workspace state after export or cancellation. A play button plus canvas screenshot does not provide that guarantee. [M-time] [M-animation] [T-api]

### 5. Terrain analysis exists in PG Maps but is not a toolkit API

PG Maps contains reusable-looking viewshed, skyline, solar-position, DEM loading/caching and visibility algorithms. They still import forestry terrain/visibility code and application aliases. Extract pure calculations separately from transport, workers, UI and region defaults.

Do not assume parity after moving files: the shared implementation has documented latitude/date-line, radius, observer-count, grid and tile-budget limits. One older terrain page is specifically BC-limited. The Earth solar planner is not a substitute for MMGIS SPICE-based spacecraft/body visibility. [H-viewshed] [H-terrain] [M-viewshed] [M-sightline]

### 6. Planetary support needs explicit coordinate and body semantics

GeoToolkit's `Map` already accepts globe projection. This should not be reported as “no 3D support.” However, MMGIS also supplies custom projected tiles, body dimensions, local relative coordinates, globe terrain and scientific camera/media relationships.

GeoToolkit's `haversineKm` uses a fixed Earth radius of 6,371 km. Its current geographic calculations cannot simply be reused for Mars/Moon measurements. Add explicit body/radius/ellipsoid, CRS, units, axis-order, vertical reference and time semantics where needed. Converting coordinates into WGS84 does not reproduce a native planetary or polar tile matrix.

For ordinary Earth exploration, retain MapLibre and add supported terrain/model adapters incrementally. For strict native planetary projections and scientific 3D scenes, evaluate a dedicated view adapter rather than assuming MapLibre's globe option covers them. This is the largest likely engine-level constraint. [T-geo] [T-map] [M-proj] [M-viewer]

### 7. A multi-user GIS requires backend services

GeoToolkit's generic project repository supports local persistence and injection of remote implementations. Its share interface does not supply a hosted share service. It has no bundled identity, indexed geodata backend, authoritative edit history, subscriptions, tokens or webhook service.

MMGIS implements these in Express/PostgreSQL/PostGIS modules and optional adjacent services. Keep equivalent infrastructure outside the reusable browser package. Add typed client adapters, permission-aware UI states and optimistic-concurrency/version contracts where needed. Server authorization remains authoritative.

MMGIS's WebSocket updates and configuration conflict detection should not be mistaken for proof of arbitrary conflict-free simultaneous geometry merging. Establish the intended concurrency behavior explicitly. [T-projects] [M-backend] [M-geodata] [M-config] [M-ws]

### 8. A builder is distinct from a runtime renderer

Current project/story renderers can consume authored definitions; they do not provide an MMGIS-style visual administration interface. Build a separate authoring app around validated schemas, a layer/tool capability registry, preview, saved revisions and publish/restore workflows. A memory/local-storage repository is insufficient for multi-admin mission management. [T-readme] [M-configure] [M-config]

## Existing PG Maps code worth reusing first

| Candidate                                  | Existing location                                                                                              | Work needed before making it a portable capability                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| File import                                | `src/lib/geoFileImport.ts`                                                                                     | Inject policy/limits and lazy decoder dependencies; retain explicit skipped-feature reports and CRS handling   |
| Layer explorer                             | `src/pages/dev-data/{model,layerData,LayerPanel,LayerDetail,DataTablePanel,AddDataDialog}.tsx/ts`              | Separate catalog and host UI from reusable state, field schema, style editing and selection                    |
| Search/filter/timeline feature blocks      | `src/maps/project-explorer/features/` and `adapters/`                                                          | Extract generic interaction contracts; leave research/BC normalization in adapters                             |
| Measurement and draw input                 | `src/pages/dev-interact/measurement.ts`, `MeasurementOverlay.tsx`, `src/pages/dev-forestry/MapDrawCapture.tsx` | Compose input arbitration and editing/measurement controllers without application imports; preserve undo/redo  |
| Terrain sampling, sightlines and viewsheds | `src/pages/dev-forestry/{terrain,visibility,demLoader,terrainTileCache}.ts`, `src/features/terrain-viewshed/`  | Inject elevation source and transport; isolate limits/body assumptions; package worker lifecycle independently |
| Local GeoTIFF elevation import             | `src/pages/dev-forestry/toolImports.ts` and `localRaster.ts`                                                   | Split unrelated image/domain import code; expose CRS, vertical reference, masks and native-resolution limits   |
| Earth sun/horizon planning                 | `src/features/terrain-viewshed/model.ts`                                                                       | Keep the approximation/precision and terrain limits explicit; do not advertise as SPICE/planetary ephemerides  |

These are source reuse opportunities only. No code was moved, and no extraction build or compatibility checks were run. Follow the toolkit's independent-consumer boundary: no PG Maps aliases, datasets, application URLs, storage keys or domain defaults. [H-boundary]

## Recommended implementation order

Priorities are for reaching a broadly useful Earth MMGIS-like app. A lunar mission would move projection/body and scientific viewer work much earlier. Relative size describes scope, not a calendar estimate.

| Priority    | Deliverable                                                       | Relative size    | Concrete acceptance checkpoint                                                                                                                                          |
| ----------- | ----------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0          | Explorer layer schema, registry/controller and core browser UI    | Large            | Independent consumer loads multiple layer sources, groups/toggles/reorders them, adjusts opacity/styles, inspects a feature and restores the same state                 |
| P0          | File import, field schema, feature table/search/filter            | Medium–large     | Upload GeoJSON/shapefile/KML/CSV; retain attributes and stable identity; selected/filter results agree across map/table and invalid/skipped input is explained          |
| P0          | Local editing and measurement tools                               | Large            | Draw/edit/delete point/line/polygon, undo/redo, measure with declared units, export/import geometry; incompatible tools cannot consume the same gesture                 |
| P0          | Raster metadata/render/inspect adapters                           | Large            | Display a remote COG, select bands/style, inspect raw values/no-data, and show native resolution and provenance correctly                                               |
| P1          | Workspace time and spatial/attribute query contracts              | Large            | A time change refreshes vector/raster sources together; old requests cannot overwrite new state; full server query results are distinguished from rendered-tile subsets |
| P1          | Terrain/elevation/profile/viewshed extraction                     | Large            | Same injected DEM drives sampling and analysis; missing terrain remains unknown; worker cancellation and limits behave correctly; profile cursor maps to the path       |
| P1          | Bookmark, workspace URL/state and capture/export workflow         | Medium–large     | A shared state restores camera/layers/time/selection; image/export content is documented; temporal exports preserve/restore state and wait for frame readiness          |
| P1          | Remote project/configuration/geodata services                     | Large            | Multiple users can save/load authorized projects, upload/query durable data and recover prior configuration revisions                                                   |
| P2          | Collaboration, permissions/history/publishing                     | Large            | Two authenticated clients receive permitted changes; unauthorized edits fail at the server; concurrent/stale edits and reconnects have defined behavior                 |
| P2          | Visual builder application                                        | Large            | A non-developer creates/configures/previews/publishes a workspace using supported layer/tool descriptors                                                                |
| Conditional | Feature-linked deep zoom/model/photosphere/3D Tiles/curtain views | Large–very large | Selection synchronizes across declared supported views; loading, disposal, orientation and units are correct                                                            |
| Conditional | Planetary CRS/body/ephemeris support                              | Very large       | A non-Earth reference mission renders its native tiles, measures correctly on its body, shows correct coordinate/time systems and verifies SPICE-driven geometry        |

Start with an independent **Earth GIS workbench example** that exercises these capabilities using injected sources. Evolve it into the reference app and verification target. Avoid claiming MMGIS parity based only on separate demos that never combine loading, time, selection, editing and saved state.

Suggested future package boundaries could be `/explorer`, `/editing`, `/raster`, `/terrain`, `/temporal` and `/viewers`, with service adapters supplied by the host. **These are proposals, not existing exports.** Keep heavyweight raster/3D/encoding dependencies optional and isolated from pure calculations and the normal map entry point.

## Useful differences to preserve

GeoToolkit already invests in independent embeddable workspaces, responsive scoped state, explicit data uncertainty, reusable charts/scoring and richer editorial story presentation. These are valuable capabilities even though they do not replace MMGIS's mission tools. Preserve them while filling the GIS gaps; a literal port of MMGIS's global controllers is unnecessary.

For an Earth data exploration product, the practical path is to extract the existing PG Maps explorer/import/measurement/terrain foundations, add raster/time/query contracts, and build the host services and builder around them. Full planetary mission operations remains a distinct additional scope.

## Source links

Links below are pinned to the inspected commits so later upstream changes do not alter the evidence.

[M-core]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core
[M-tools]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools
[M-types]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/layertypes
[M-layer-contract]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/layertypes/README.md
[M-changelog]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/CHANGELOG.md
[M-env]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/sample.env
[M-plugins]: https://github.com/NASA-AMMOS/MMGIS-Plugins/blob/d58f249be98105bc86391ffa31223e375c01ec26/README.md
[M-plugin-contract]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/README.md
[M-backend]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/backend
[M-geodata]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/backend/Geodatasets/routes/geodatasets.js
[M-config]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/backend/Config/routes/configs.js
[M-configure]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/configure/src/components
[M-time]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/Basics/TimeControl_/TimeControl.js
[M-viewer]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/Basics/Viewer_
[M-proj]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Configure/Tabs/Projection/Projection_Tab.md
[M-identifier]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Identifier/IdentifierTool.js
[M-data-layer]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/layertypes/Data/map.js
[M-draw]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/tools/Draw
[M-draw-backend]: https://github.com/NASA-AMMOS/MMGIS/tree/c576fe4925ef6e65c74141516d3b0ffa50def6bd/plugins/core/backend/Draw
[M-animation]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Animation/Animation.md
[M-viewshed]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Viewshed/Viewshed.md
[M-sightline]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/docs/pages/Tools/Sightline/Sightline.md
[M-ws]: https://github.com/NASA-AMMOS/MMGIS/blob/c576fe4925ef6e65c74141516d3b0ffa50def6bd/src/essence/services/WebSocketService.js
[T-readme]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/README.md
[T-api]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/API.md
[T-map]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/src/map/map.tsx
[T-layers]: https://github.com/ahzs645/geo-toolkit/tree/72c3e853454a40dee3185060a65e1881468dffac/src/map/layers
[T-grids]: https://github.com/ahzs645/geo-toolkit/tree/72c3e853454a40dee3185060a65e1881468dffac/src/grids
[T-projects]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/src/projects/projectRepository.ts
[T-stories]: https://github.com/ahzs645/geo-toolkit/tree/72c3e853454a40dee3185060a65e1881468dffac/src/stories
[T-workspace]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/src/workspace/workspace-context.tsx
[T-capture]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/src/map/map-capture.ts
[T-geo]: https://github.com/ahzs645/geo-toolkit/blob/72c3e853454a40dee3185060a65e1881468dffac/src/calculations/geo.ts
[H-data]: https://github.com/ahzs645/PGMaps/tree/37058a774315fd30d32103db385e581a80ee53d2/src/pages/dev-data
[H-explorer]: https://github.com/ahzs645/PGMaps/tree/37058a774315fd30d32103db385e581a80ee53d2/src/maps/project-explorer
[H-draw]: https://github.com/ahzs645/PGMaps/blob/37058a774315fd30d32103db385e581a80ee53d2/src/pages/dev-forestry/MapDrawCapture.tsx
[H-measure]: https://github.com/ahzs645/PGMaps/tree/37058a774315fd30d32103db385e581a80ee53d2/src/pages/dev-interact
[H-viewshed]: https://github.com/ahzs645/PGMaps/blob/37058a774315fd30d32103db385e581a80ee53d2/src/features/terrain-viewshed/README.md
[H-terrain]: https://github.com/ahzs645/PGMaps/blob/37058a774315fd30d32103db385e581a80ee53d2/src/features/terrain-viewshed/model.ts
[H-raster]: https://github.com/ahzs645/PGMaps/blob/37058a774315fd30d32103db385e581a80ee53d2/src/pages/dev-forestry/toolImports.ts
[H-boundary]: https://github.com/ahzs645/PGMaps/blob/37058a774315fd30d32103db385e581a80ee53d2/docs/toolkit-extraction.md
