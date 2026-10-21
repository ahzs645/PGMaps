// Updated 2026-10-21. Current public/client evidence and remaining gaps:
// docs/nechako/2026-10-21-parity-audit.md. Older authenticated counts are dated observations.
export const FEATURE_COMPARISON = [
  {
    feature: 'Map, layers, visibility, legends, camera',
    portal: 'Live catalogue and WMS tests',
    pgmaps:
      'Shared MapLibre/toolkit components; existing portal WMS project preview; GeoJSON/PMTiles and raster support',
    next: 'Verify permission-dependent native sources and service availability. Native source order is preserved; full SLD symbolizers and ordering within split vector geometries remain partial.',
    devView:
      'Live catalogue, WMS styles/opacity/visibility/order/legends/identify; camera and workspace save/restore; local vector and imported tile layers.',
  },
  {
    feature: 'Literature search and timeline',
    portal: 'Portal accepts Zotero CSV per SOP',
    pgmaps:
      'Existing Nechako research explorer; title/author/tag substring search, categories, decades, locations, paging',
    next: 'Upstream citation URLs/DOIs are absent; retain source IDs and acquire canonical citation metadata.',
    devView: 'All and unmapped research browsing/search, record dialogs and filtered CSV export.',
  },
  {
    feature: 'Portal-wide submission search',
    portal: 'Original catalogue exposed 1,585 searchable submissions; local gateway query nechako returns 419 results',
    pgmaps: 'Global site search and literature search cover different sources',
    next: 'The hosted gateway supports permitted live reads; direct browser mode can fail registration. Current administrator sign-in was rejected, so protected production acceptance remains.',
    devView:
      'Unified public-content search, native submission search and a captured form/year browser; form-scoped field selectors, nested visual expressions, local saved queries, geographic limits, paged results/CSV and form detail dialogs.',
  },
  {
    feature: 'Submission detail',
    portal: 'Client has General, Preview, Allowed Users, Spatial Data, Attachments, Child Submissions, History, Export',
    pgmaps: 'General cards/dialogs available; no portal submission adapter found',
    next: 'Isolated gateway sign-in and dynamic form reads work locally. Verify production permission scopes, protected file access and unsupported static nodes.',
    devView:
      'Dynamic source form preview, safe links/content, seven independent resources, child navigation, layer Attributes/monitoring links and JSON review.',
  },
  {
    feature: 'Project catalogue and JSON packages',
    portal: 'Administrator grid lists 19 saved maps; anonymous grid lists nine. Project-form submissions are separate.',
    pgmaps: '`/projects`, project folders, imported packages, story/explorer modes, Index Lab handoff',
    next: 'Live source catalogue/default/history reads through local gateway; reviewed write adapters are mocked-contract verified, with no source mutations executed.',
    devView:
      'Nine actual public map definitions with descriptions, original raster images, links and partial map loading; local JSON collection import/export and existing PGMaps library.',
  },
  {
    feature: 'Saved map workspaces',
    portal: 'Client saves camera/scale, ordered layers, styles and native source references',
    pgmaps: 'Local package repository and outdoors JSON/share/save workflows',
    next: '130 of 131 WMS references convert: 19 native references use the verified MapServer prefix and supplied mapfile/layer names, with existing HTTPS SLDs. Teacher resources retain 9/9 WMS. One empty WMS name and 18 HTTP XYZ basemaps remain omitted; temporary references may expire. Native cross-type order is preserved; full SLD symbolizers remain partial.',
    devView:
      'Versioned local workspace JSON, browser save/restore and native project conversion; retains original styles/IDs/unsupported sources with warnings.',
  },
  {
    feature: 'Stories and learning modules',
    portal:
      'Verified public Learning Module has five place cases and 25 questions; content templates are not a story total.',
    pgmaps: 'Existing story-map renderer and project packages',
    next: 'Obtain permitted exports for other stories, their linked media and any original answer material. Complete story count and storage remain unknown.',
    devView:
      'Playable seven-chapter learning adaptation, source links, readable imported story text/JSON and supported PGMaps story packages.',
  },
  {
    feature: 'Information inventory and size',
    portal:
      'Observed record, layer, form, schema and saved-map counts measure different collections; full server storage is not disclosed.',
    pgmaps: 'App-owned public snapshot with per-file manifest hashes and byte counts',
    next: 'Measure original GIS archives, monitoring exports, attachments and private collections from permitted exports; do not infer bytes from record counts.',
    devView:
      'Per-capture manifest file/byte totals; separate learning-package and browser-import sizes; searchable collection inventory and 77 explicitly scoped workflow options. Client-module audit bytes are separate from data/storage totals.',
  },
  {
    feature: 'Collaborative project ownership/sharing/history/defaults',
    portal: 'Portal client and SOP',
    pgmaps: 'Local storage/file/share capabilities; no equivalent portal account/group synchronization found',
    next: 'Source ownership stays authoritative. Reviewed native project adapters need disposable-record and multi-user production acceptance.',
    devView:
      'Live source projects/shares/history/defaults and review-gated owner save/rename/share/default adapters; browser versions and original-preserving exports.',
  },
  {
    feature: 'Point/line/polygon data and attributes',
    portal: 'Schemas, uploaded layers, drawing, identify and attributes in client',
    pgmaps: 'Typed map layers, interaction tools, bottom tables, specialized imports',
    next: 'Verify schema-linked portal vector exports with authorized samples. Geometry validation is not a complete topology audit.',
    devView:
      'Validated/reprojected GeoJSON and GDAL imports; point/line/polygon maps, attributes/CSV, local geometry/property edits and measurement.',
  },
  {
    feature: 'WMS identify',
    portal: 'GetFeatureInfo tested on hosted and DataBC examples',
    pgmaps: 'Feature inspection exists for other sources; existing WMS project preview focuses on rendering',
    next: 'Do not mistake identify for complete geometry. Native schema/vector download still requires source-specific authorized transport.',
    devView: 'Queryable WMS GetFeatureInfo, up to 10 features/click, source styles and readable attributes.',
  },
  {
    feature: 'Monitoring tables and charts',
    portal: 'CSV/schema/station links, pagination, time-zone matching, line/bar chart builder in client/SOP',
    pgmaps: '`/dev/water-temperature`, reusable time series/scatter/range charts and exports',
    next: 'Actual layer 386/record 1 read returns 500 rows of 25,933; page exports/charts are scoped to the loaded page. Full database size and production access remain unknown.',
    devView:
      'Live station/schema/Attributes relationships and bounded observations; local CSV/time-zone quality review, chart presets, dual axes and page CSV/JSON.',
  },
  {
    feature: 'Attachments and archives',
    portal: 'Attachment metadata/upload/download client; SOP and archive WMS',
    pgmaps: 'Story/document displays and shared cards can be reused',
    next: 'Protected attachment retrieval/previews and server whitelist/limits require authorization; unsupported document formats retain originals.',
    devView:
      'Local raster image/PDF/audio/video preview, original downloads, GIS archive inventory and anonymous attachment metadata resource reads.',
  },
  {
    feature: 'Bulk CSV/Zotero and GeoPaparazzi import',
    portal: 'Client and SOP described',
    pgmaps: 'Specialized import paths and scraper infrastructure',
    next: 'Portal draft publishing stays authoritative. GeoPaparazzi form/note/photo/track mapping needs a real sample; inventory is not full import parity.',
    devView:
      'Source-form CSV/spatial mapping, typed validation, local draft review/exports; optional signed-in CSV draft adapter, GeoPaparazzi table inventory.',
  },
  {
    feature: 'GIS editing/processing',
    portal: 'Draw/edit/buffer/clip/difference/split/intersect/union client modules',
    pgmaps: 'Related selection, drawing, measurements and domain analysis exist',
    next: 'Broader topology/processing parity beyond the verified operations still needs representative samples; no portal edit/publish operations enabled.',
    devView:
      'Local drawing, GeoJSON geometry/property editing, measurement, bounded undo, buffer, polygon union/intersection/difference, point/line/polygon clipping and line/polygon splitting; output exports.',
  },
  {
    feature: 'Map image composition and layer names',
    portal:
      'Public Export window has title, dimensions, Same as Map, two north-arrow styles, scale distance, legend scale and attribution.',
    pgmaps: 'Shared MapLibre map, canvas and export primitives',
    next: 'PNG composition uses the current rendered extent and reports missing imagery/legends. It does not retrieve vector data or increase the source map resolution.',
    devView:
      'PNG preview/download with source credits and complete-map aspect ratio; local WMS/vector/tile display-name editing preserves source identifiers and workspace round trips.',
  },
  {
    feature: 'Reporting and statistics',
    portal:
      'Source form/statistics, presets, CSV and Table/Graphs controls; the current client Graphs handler is a placeholder.',
    pgmaps: 'Charts and export building blocks',
    next: 'Native graphs adapt exact returned numeric rows/statistics; unsupported shapes stay in the table. Source preset sharing, static-node/report coverage and current authenticated acceptance remain limits.',
    devView:
      'Original dynamic form reports, Table/Graphs, source field labels, local presets and CSV/HTML/PDF/ZIP exports; measured zero, missing values and source counts remain distinct.',
  },
  {
    feature: 'Forms, schemas, users, groups, approvals, shared-layer review',
    portal:
      'Earlier authenticated audit recorded 31 forms, 13 schemas, 77 accounts and five groups. The October 21 source login could not be revalidated.',
    pgmaps:
      'Native inspectors for source forms, schema field links, users, permissions, groups, submissions and system registries.',
    next: 'The updated hosted connection exposes verified administrator reads and remains read-only. Local reviewed permission/group/moderation/help updates are preserved. Form/schema editing, account creation and publication remain original workflows; fresh authenticated acceptance is pending.',
    devView:
      'Searchable tables with local paging and CSV/JSON export; form field/schema/group/user relationships; schema monitoring associations; native submission catalogue; source registry defaults, flags, task statuses, priorities and holidays.',
  },
  {
    feature: 'Notifications, schedules and relationship nodes',
    portal: 'Loaded client modules/SOP',
    pgmaps: 'Native calendar, selected-day task and notification inspectors use the source request contracts.',
    next: 'Live authenticated schedule acceptance remains pending. Scheduling, assignment and notification changes remain in the original dashboard.',
    devView:
      'Calendar month highlights, tasks for a selected local date, and separate new-task/near-deadline categories retain original task and submission IDs; no workflow writes.',
  },
  {
    feature: 'Payments and BOSS',
    portal: 'October 12 administrator could open BOSS inputs, output/export and queue controls.',
    pgmaps: 'No matching integration established',
    next: 'Confirm business use before specifying or building parity.',
    devView: 'Options directory and documented original workflow; execution, costs and payment use are unverified.',
  },
] as const

export const FORMAT_COMPARISON = [
  {
    format: 'GeoJSON',
    evidence: 'Enabled registry and upload chooser',
    pgmaps: 'Native renderers/import paths exist',
    next: 'Implemented local GeoJSON import/export with coordinate/ring/property checks and known-CRS reprojection; original file retained.',
  },
  {
    format: 'ESRI Shapefile (`.shp`, `.shx`, `.dbf`, `.prj`)',
    evidence: 'Enabled registry and upload chooser',
    pgmaps: 'Specialized forestry import uses shpjs',
    next: 'Implemented GDAL sidecar/ZIP import and homogeneous geometry Shapefile ZIP export; original sidecars retained. Requires the optional conversion service.',
  },
  {
    format: 'GML',
    evidence: 'Enabled registry',
    pgmaps: 'No generic portal ingestion found',
    next: 'Implemented GDAL GML import/export and CRS normalization; XML document types/entities rejected. Service deployment and real portal samples still required.',
  },
  {
    format: 'GPX',
    evidence: 'Enabled registry',
    pgmaps: 'Specialized route GPX export exists',
    next: 'Implemented GDAL waypoint/route/track import and compatible point/line export; retained originals. Polygon GPX export is unsupported.',
  },
  {
    format: 'KML',
    evidence: 'Enabled registry and chooser',
    pgmaps: 'Some dataset pipelines use KML',
    next: 'Implemented GDAL KML import/export; geometry/attributes normalized, original styling/document retained rather than reproduced.',
  },
  {
    format: 'KMZ',
    evidence: 'Upload chooser, absent from enabled registry',
    pgmaps: 'No general import verified',
    next: 'Implemented safe KMZ extraction/KML conversion and archive inventory. Original media remains in the archive; portal KMZ acceptance still needs verification.',
  },
  {
    format: 'SQLite / SpatiaLite',
    evidence: 'Enabled registry',
    pgmaps: 'No generic browser database reader found',
    next: 'Implemented GDAL spatial SQLite/SpatiaLite import/export. Non-spatial tables/unknown CRS are not silently treated as vectors. Requires conversion service.',
  },
  {
    format: 'GeoPackage',
    evidence: 'Enabled registry',
    pgmaps: 'No general multi-layer GeoPackage loader found',
    next: 'Implemented GDAL multi-layer GeoPackage import, layer selection and export; three-layer BC Albers reprojection round trip verified. Requires conversion service.',
  },
  {
    format: 'WMS: hosted QGIS and DataBC',
    evidence: '32 services live tested; representative map/identify tested',
    pgmaps: 'Existing WMS raster/legend construction',
    next: 'Live catalogue, maps, styles, legends and identify implemented here. Repair two EchoScreen source layers; investigate blank/slow layers. Native vector transport is separate.',
  },
  {
    format: 'XYZ/OSM/Esri imagery',
    evidence: 'Live default catalogue',
    pgmaps: 'Existing tiled map components',
    next: 'Native HTTPS XYZ/OSM file-import sources and attribution retained. HTTP and embedded-credential source URLs rejected.',
  },
  {
    format: 'WFS/raw feature export',
    evidence: 'Referenced capabilities/related tools; no full portal vector-export audit',
    pgmaps: 'PGMaps uses bounded feature queries elsewhere',
    next: 'Add only when the source explicitly supports it; validate paging, geometry and permission scope',
  },
  {
    format: 'Historical map rasters',
    evidence: 'Cheslatta archive advertises two named WMS layers',
    pgmaps: 'Raster rendering exists',
    next: 'Keep georeferencing/symbology on QGIS; serve WMS and attach archive metadata',
  },
  {
    format: 'Raw GeoTIFF/other raster datasets',
    evidence: 'Not established by the uploaded files or portal registry',
    pgmaps: 'Some specialized PGMaps raster analysis exists',
    next: 'Treat as optional extension until actual source files and requirements are identified',
  },
  {
    format: 'Monitoring CSV',
    evidence: 'Monitoring CSV matching, presets, timestamps/time zones and station/schema linking in client and guides',
    pgmaps: 'Specialized temperature datasets and reusable charts; no generic portal monitor importer',
    next: 'Implemented CSV matching, explicit/per-row time zones, quality/duplicate reports, presets, tables, dual-axis line/bar, filters, statistics and exports. Protected portal transport pending.',
  },
  {
    format: 'Zotero / bibliographic CSV',
    evidence: 'Draft submission import described by Data Manager guide and BulkZotero client',
    pgmaps: 'Existing public research JSON adapter; all/unmapped browser now available in this dev view',
    next: 'Implemented all-column CSV review, title/DOI mapping, repeated DOI flags and draft-review/CSV export. No portal draft publishing; source citation metadata still needed.',
  },
  {
    format: 'GeoPaparazzi (.gpap)',
    evidence: 'Field-form, spatial and attachment matching in GeoPaparazziLoader client',
    pgmaps: 'No generic GeoPaparazzi importer verified',
    next: 'Implemented read-only SQLite table/column/row inventory for .gpap. Form/note/photo/track semantics and portal publishing remain unverified without a real sample.',
  },
  {
    format: 'Documents, photos, audio/video and archives',
    evidence: 'Attachment workflow in client and guides; no complete server whitelist or size limits verified',
    pgmaps: 'Reusable document/story/dialog presentation; no portal attachment browser',
    next: 'Implemented local image/PDF/audio/video preview and original downloads; anonymous portal attachment metadata reads. Protected files and whitelist/limits remain server integration work.',
  },
  {
    format: 'Native portal project JSON',
    evidence: 'OpenLayers project camera/scale/layers/styles/source references in Project.js',
    pgmaps: 'PGMaps project packages use a different typed workspace schema',
    next: 'Implemented versioned local conversion retaining originals/IDs/styles and reporting unsupported sources. CSS-inch scale translated; native mapfile references, safe HTTPS SLD passthrough and cross-type source order preserved. Temporary service references, full SLD symbolizers and ordering within split vector geometries remain limits.',
  },
] as const
