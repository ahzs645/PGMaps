// Updated 2026-10-11. Live evidence and deployment limits: docs/nechako-portal-assessment.md.
export const FEATURE_COMPARISON = [
  {
    feature: 'Map, layers, visibility, legends, camera',
    portal: 'Live catalogue and WMS tests',
    pgmaps:
      'Shared MapLibre/toolkit components; existing portal WMS project preview; GeoJSON/PMTiles and raster support',
    next: 'Verify native private sources and exact cross-type order; deploy the prepared workbench.',
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
    portal: 'Live Search UI; eight search contexts; query failed with registration error',
    pgmaps: 'Global site search and literature search cover different sources',
    next: 'Live results/area behavior are blocked by portal registration; verify payloads and permission scopes after server repair.',
    devView:
      'Native expression/context form transport; geographic extent filter, current map extent, paged result table/CSV and submission resource links.',
  },
  {
    feature: 'Submission detail',
    portal: 'Client has General, Preview, Allowed Users, Spatial Data, Attachments, Child Submissions, History, Export',
    pgmaps: 'General cards/dialogs available; no portal submission adapter found',
    next: 'Anonymous connection only. Verify authorized payloads, schema-driven form previews, file downloads, child/history and permission boundaries.',
    devView:
      'Seven independent read-only resource sections using native endpoint parameter names; exported JSON review.',
  },
  {
    feature: 'Project catalogue and JSON packages',
    portal: 'Portal project UI tested; listing failed with registration error',
    pgmaps: '`/projects`, project folders, imported packages, story/explorer modes, Index Lab handoff',
    next: 'Registration blocks live catalogue/defaults. Authorized project transport and revision integration remain server work.',
    devView:
      'Live list/default/form checks plus native portal project file conversion in Layers; existing PGMaps library retained.',
  },
  {
    feature: 'Saved map workspaces',
    portal: 'Client saves camera/scale, ordered layers, styles and native source references',
    pgmaps: 'Local package repository and outdoors JSON/share/save workflows',
    next: 'SLD/custom style rendering, portal-native source resolution and exact cross-type order need validated native samples; private ownership/history stays in portal.',
    devView:
      'Versioned local workspace JSON, browser save/restore and native project conversion; retains original styles/IDs/unsupported sources with warnings.',
  },
  {
    feature: 'Collaborative project ownership/sharing/history/defaults',
    portal: 'Portal client and SOP',
    pgmaps: 'Local storage/file/share capabilities; no equivalent portal account/group synchronization found',
    next: 'Retained in portal. Any future PGMaps synchronization needs per-user authentication and server-side authorization checks.',
    devView: 'Portal links and clear anonymous access errors; local saves do not claim shared ownership.',
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
    next: 'Protected monitor schema/record/submission transport and source-side paging remain unverified; compare real samples with portal output.',
    devView:
      'CSV/station/column/time-zone matching, per-row zones, quality report, presets, paged table, line/bar dual axes, filters/CSV and numeric statistics.',
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
      'Bibliographic CSV all-column review, mapped titles/DOIs, repeated-DOI flags, draft review/CSV exports; GeoPaparazzi table inventory.',
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
    feature: 'Reporting and statistics',
    portal: 'Live Reports UI; no forms visible anonymously; client presets/statistics/CSV',
    pgmaps: 'Charts and export building blocks',
    next: 'Portal form/schema-driven report definitions and permissions remain authoritative; local statistics are not full portal reporting.',
    devView: 'Local monitoring numeric statistics/CSV and anonymous report-form availability check.',
  },
  {
    feature: 'Forms, schemas, users, groups, approvals, shared-layer review',
    portal: 'Client and Data Manager SOP',
    pgmaps: 'Reusable UI primitives; no matching portal admin subsystem found',
    next: 'Maintain these workflows in the portal; verify them with an authorized administrator after server fixes.',
    devView: 'Original portal handoff for administration; anonymous schema/form reads are not an admin replacement.',
  },
  {
    feature: 'Notifications, schedules and relationship nodes',
    portal: 'Loaded client modules/SOP',
    pgmaps: 'No portal-equivalent workflow found',
    next: 'Maintain in portal. Confirm active workflows and obtain authorized samples before a further integration.',
    devView: 'Original portal handoff; no notification/schedule writes in PGMaps.',
  },
  {
    feature: 'Payments and BOSS',
    portal: 'Loaded client modules; BOSS explicitly hidden in startup HTML',
    pgmaps: 'No matching integration established',
    next: 'Confirm business use before specifying or building parity.',
    devView: 'Documented loaded modules and hidden BOSS state; no inferred active requirement.',
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
    next: 'Implemented versioned local conversion retaining originals/IDs/styles and reporting unsupported sources. CSS-inch scale translated; custom SLD and cross-type order require further verified adapters.',
  },
] as const
