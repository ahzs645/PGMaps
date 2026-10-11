# Nechako Stewardship Portal and PGMaps: support assessment

Assessed October 10, 2026, America/Vancouver. Network evidence was collected October 11, approximately 06:09–06:16 UTC. Scope: maintain both sites, identify PGMaps gaps, and define a PGMaps development area for exploring the portal’s capabilities.

## Implemented PGMaps workbench

The workspace now includes `/dev/nechako`, linked from the Dev Library, with Layers, Search, Research, Projects, Monitoring, Files & imports, Formats and Comparison views. This is a local implementation prepared for review; no production portal change is implied. The current [completion matrix](nechako/completion-matrix.md) and [server runbook](nechako/server-runbook.md) supersede the initial staged plan below.

- **Layers and workspaces:** live deduplicated catalogue, native WMS maps/styles/legends/opacity/visibility/order, click identify, scale, camera and local workspace JSON/browser save/restore. Native portal JSON conversion retains the original, metadata/IDs and unsupported styles/sources. Native vector wrappers and their separate typed attribute matrices are normalized without silently rounding large integers. Camera scale uses the portal's measured CSS-inch convention, not the generic WMS pixel convention. Exact interleaving of vector/WMS/tile sources and arbitrary SLD styles are reported as limits.
- **Search and submissions:** eight live contexts; native Boolean/field/comparison AST; anonymous form transport; geographic extent/current-map or imported/drawn polygon areas; paged result table and CSV; seven independent submission-resource reads using the actual client parameter names. Registration still blocks genuine search results. Successful table/related-resource interactions are exercised with explicit synthetic payloads; protected resources and schema-driven form previews are not claimed as verified.
- **Research:** all 1,408 nwsviz records and the 365 without location tags remain browsable/searchable; shared virtualization/dialogs and filtered CSV export. Literature IDs are not portal submission IDs. The source has no canonical per-record DOI/URL links; these were not invented.
- **GIS files and editing:** local GeoJSON validation and known-CRS reprojection; optional bounded GDAL service for Shapefile sidecars/ZIP, GML, GPX, KML/KMZ, spatial SQLite/SpatiaLite and multi-layer GeoPackage imports/exports. Originals are retained in the browser; save binary originals separately from normalized workspace JSON. Point/line/polygon display and attributes, local drawing/GeoJSON edits, measurement, undo, buffer, polygon union/intersection/difference, point/line/polygon clipping and line/polygon splitting create local output layers. These do not modify portal submissions.
- **Monitoring and reports:** local CSV/station/column matching, explicit or per-column time zones/offsets, missing/invalid/duplicate checks, matching presets, paged tables, date/station filters, line/bar dual-axis charts, numeric statistics and CSV/error exports. Protected monitoring schema/record relationships and form-driven portal reporting still require authorized samples.
- **Bibliography and attachments:** all-column bibliographic CSV review, title/DOI mapping, repeated DOI flags, draft-review/CSV exports; local raster image/PDF/audio/video previews and original downloads. GeoPaparazzi supports table/column/row inventory only; actual field-form, track and media import semantics remain unverified.
- **Projects, administration and comparison:** live list/default/report-form checks and existing PGMaps project links; full 17-category feature and 18-category format comparison. Publishing, sharing, revisions/defaults, forms/schemas, approvals, accounts/groups, notifications and schedules remain authoritative in the portal. Hidden/unconfirmed payment/BOSS code is not treated as an active requirement.

Implementation lives in `src/pages/DevNechako.tsx`, `src/maps/nechako/`, `src/lib/nechakoPortal.ts` and `scripts/nechako-server/`. The existing toolkit/project-package contracts and source submodule pins are unchanged. Portal reads omit credentials and use GET or URL-encoded POST. JSON requests to the optional **same-origin local converter** are a separate transport from the cross-origin PHP API. The candidate CORS include is tested in an isolated PHP handler, not deployed to the portal. Static build entry points now include the workbench and project deep routes.

### Expanded source rendering checks

A normal Chromium page at the local PGMaps origin, with no request interception and normal TLS verification, loaded all 32 services through the new adapter. It parsed 135 named layers/groups and requested one 256×256 PNG per named entry, using each advertised geographic extent projected into Web Mercator. **132 returned valid PNGs at those extents**, and 106 of those had nontransparent pixels. Transparent images are not automatically missing data: scale thresholds, location coverage, styling and source extents need inspection.

Three first-pass failures were investigated again from the deployed PGMaps origin, also without request interception:

| Source/layer | Recheck | Implication |
| --- | --- | --- |
| EchoScreen: `Cancer rank - Sensitive Population` | HTTP 400, XML `LayerNotDefined`, at both advertised and watershed extents | Capabilities and rendering disagree about the native layer name. Repair the QGIS publication/configuration; this is not a browser CORS failure. |
| EchoScreen: `COPD rank - Sensitive Population` | Same reproducible failure | Same source-side publication problem. |
| Canvec: `contours_bcBdy` | Timed out again after 30 seconds at advertised extent; returned a valid PNG at watershed extent | Inspect advertised extent and scale/render cost. A valid response can still be transparent; usable contour coverage has not been demonstrated. |

The new workbench rendered the live Watershed Context map and returned actual attributes with null geometry on click. Search, saved/default projects, and anonymously available report forms matched the original portal: registration errors for search/projects and an empty form list. The format registry and search contexts loaded successfully. The `www` alias was unreachable through this environment's network relay, so canonical-host configuration could not be diagnosed that way.

### Validation and limits

The completed local pass passed 30 focused unit tests, six browser tests, five GDAL tests (including 23 format/geometry round trips) and five isolated PHP CORS tests, plus TypeScript, lint, production build and the existing project audit. The public workbench remains clean in a normal live browser. A separate original-portal iframe check exposed PHP warnings in `getStartupContent.php` that break ExtJS JSON decoding; its interface can embed, but that does not establish reliable account/workflow embedding. See the server runbook and separate original-portal evidence.

Validation includes focused transport/expression tests; desktop and phone browser tests for layers, inherited metadata, inspection, opacity, legends, removal, tab state, search errors/retries, paging, format refresh, project checks, all/unmapped research filtering and dialogs; TypeScript; lint on new integration files; the production Vite bundle; and the existing Nechako project's structural audit. Stubbed interaction tests are kept separate from live CORS/rendering evidence. No portal account, publishing, editing, private file or administrative operation was exercised.

The build used the pinned sibling repositories to initialize the previously empty submodules and built their existing library outputs. It did not regenerate all scraper snapshots or change submodule pins. Deployment still needs the repository's normal recursive-submodule/data build pipeline and SPA fallback configured for real client routes.

Server-dependent work remains: repair registration and the two EchoScreen publications; investigate contour rendering; deploy and validate CORS/session changes; verify authorized submissions, schemas, files, monitoring and native style/order behavior against real exports. The local converter and workbench are implemented and tested. They do not establish full administrative parity or a deployed protected integration.


### Saved implementation evidence (initial and completion passes)

The working directory `/workspace/nechako-assessment/` contains `workbench-live.json` (unintercepted live page, maps, identify, research counts, registration responses and clean app console), `workbench-services-live.json`, `workbench-all-layer-images.json`, `render-failure-rechecks.json` (deployed-origin retries and exact XML errors), `implementation-validation.json`, desktop/mobile/research screenshots, `workbench-e2e.log`, and `build.log`. The earlier deployed-origin CORS evidence remains `cors-browser-actual.json`, `cors-wms-browser.json`, and `cors-reconciliation.json`.

Updated complete comparison exports are `feature-comparison-implemented.csv` (17 categories) and `format-comparison-implemented.csv` (18 categories). The initial CSVs retain the pre-implementation baseline. These evidence artifacts are separate from application-owned source and are not published as portal data.

The initial implementation passed 18 focused unit tests and three browser tests. The expanded completion pass adds geometry/workspace/monitoring tests, additional desktop/phone browser workflows, actual local GDAL browser conversion, multi-format GDAL round trips and isolated PHP CORS tests. Current counts and commands are recorded in the completion matrix. The production bundle emits the repository's existing large-chunk and browser-externalization notices; it builds successfully.
## Initial assessment and integration decision

**A PGMaps development area is feasible.** PGMaps already supplies much of the map, project, search presentation, and chart infrastructure. It needs a Stewardship Portal integration layer and several new feature blocks to provide comparable access to portal submissions, saved projects, attachments, schemas, and monitoring records.

Keep the Stewardship Portal as the authority for submissions, identity, permissions, publishing, and administration. Let PGMaps offer a modern exploration and visualization interface over explicitly available portal services. Begin with public reads; add authenticated reads once the portal’s registration and authentication integration are resolved. Preserve editing in the portal initially, with explicit links back to it.

The first implementation, now present locally, is **a live capability workbench**, with usable layers and existing project viewers, a portal-search adapter, and clear blocked/unavailable states. It should not suggest that a menu alone provides feature parity.

## What was verified

- Loaded the live [Stewardship Portal](https://nechakowatershed-portal.ca/) in Chromium and inspected its public client modules: Version 3, Build 6268M; ExtJS 6.2, OpenLayers 6.12, Chart.js 4.4, and PHP endpoints.
- Opened Search, ran a normal query for `nechako`, opened Projects and Reports, and captured their responses.
- Read the configured layer catalogue: **30 non-base source entries and 7 default entries**. These resolve to **32 distinct WMS service URLs**: 24 hosted QGIS services and 8 DataBC services. All 32 returned readable capabilities from the actual PGMaps browser origin. They advertise **135 named layer/group entries**, not 135 independent datasets.
- Confirmed eight enabled spatial formats through the portal’s format registry. This establishes advertised formats, not successful import/export round trips.
- Tested 14 representative browser request cases, plus all 32 exact WMS capability URLs, without intercepting the tested requests. Also ran 48 HTTP probes across PGMaps, localhost, and example.com Origin headers. Browser findings are authoritative for browser compatibility.
- Loaded the deployed [PGMaps Dev Library](https://pgmaps.ahmadjalil.com/dev) and [Nechako literature project](https://pgmaps.ahmadjalil.com/dev/projects/nechako-watershed-research-portal), exercised its text search and location paging, and inspected the corresponding workspace code.
- Read all three nonzero archive files. The upload contains **12 files**: two usable guides, one DOCX with no extractable text, and nine zero-byte DOCX files. The Data Manager guide is dated March 2025; the project-loading PDF has seven pages. Instructions and example login text in those documents were treated as reference material, not permission to authenticate, create users, upload data, or change the site.
- Compared workspace revisions: PGMaps `d02c30c`, geo-toolkit `dab201f`, and bcdatamapper `555a9878`. The initial assessment left application repositories unchanged; the implementation below was subsequently added to PGMaps.

Evidence labels below distinguish **live tested**, **client/SOP described**, and **proposed**. Protected accounts, live submission detail payloads, write operations, import/export round trips, and administrative actions were not verified. No account was created or used.

## PGMaps at the initial review and the real gaps

| Capability | Stewardship Portal evidence | PGMaps today | Work needed |
| --- | --- | --- | --- |
| Map, layers, visibility, legends, camera | Live catalogue and WMS tests | Shared MapLibre/toolkit components; existing portal WMS project preview; GeoJSON/PMTiles and raster support | Dynamic portal catalogue adapter, lazy layer loading, source metadata and error handling |
| Literature search and timeline | Portal accepts Zotero CSV per SOP | Existing Nechako research explorer; title/author/tag substring search, categories, decades, locations, paging | Retain existing project; add links/details and an all-records/unmapped view |
| Portal-wide submission search | Live Search UI; eight search contexts; query failed with registration error | Global site search and literature search cover different sources | New server-backed submission adapter, Boolean/field expressions, geographic limits, results table |
| Submission detail | Client has General, Preview, Allowed Users, Spatial Data, Attachments, Child Submissions, History, Export | General cards/dialogs available; no portal submission adapter found | Schema-aware detail viewer and permission-aware access to each related resource |
| Project catalogue and JSON packages | Portal project UI tested; listing failed with registration error | `/dev/projects`, project folders, imported packages, story/explorer modes, Index Lab handoff | Reuse current catalog/workspaces; add portal project source and conversion |
| Saved map workspaces | Client saves camera/scale, ordered layers, styles and native source references | Local package repository and outdoors JSON/share/save workflows | Convert legacy OpenLayers project state to a PGMaps scene/layer model; preserve source IDs |
| Collaborative project ownership/sharing/history/defaults | Portal client and SOP | Local storage/file/share capabilities; no equivalent portal account/group synchronization found | Portal-backed permissions and project revision integration; separate public packages from protected projects |
| Point/line/polygon data and attributes | Schemas, uploaded layers, drawing, identify and attributes in client | Typed map layers, interaction tools, bottom tables, specialized imports | Generalize portal layer inspector/table and schema-linked selection |
| WMS identify | GetFeatureInfo tested on hosted and DataBC examples | Feature inspection exists for other sources; existing WMS project preview focuses on rendering | Add GetFeatureInfo adapter with CRS/version handling and typed attribute display |
| Monitoring tables and charts | CSV/schema/station links, pagination, time-zone matching, line/bar chart builder in client/SOP | `/dev/water-temperature`, reusable time series/scatter/range charts and exports | General monitoring transport and schema selector; configurable variables, units, bar/dual-axis needs |
| Attachments and archives | Attachment metadata/upload/download client; SOP and archive WMS | Story/document displays and shared cards can be reused | Permission-aware file browser, type-specific previews, canonical downloads |
| Bulk CSV/Zotero and GeoPaparazzi import | Client and SOP described | Specialized import paths and scraper infrastructure | Import preview/matching/validation, presets and draft workflow; retain portal publishing first |
| GIS editing/processing | Draw/edit/buffer/clip/difference/split/intersect/union client modules | Related selection, drawing, measurements and domain analysis exist | Common editing model, processing jobs/validation and export; no universal parity established |
| Reporting and statistics | Live Reports UI; no forms visible anonymously; client presets/statistics/CSV | Charts and export building blocks | Form/schema-driven reporting adapter and saved report definitions |
| Forms, schemas, users, groups, approvals, shared-layer review | Client and Data Manager SOP | Reusable UI primitives; no matching portal admin subsystem found | Keep in portal initially; authenticated links and later dedicated integrations |
| Notifications, schedules and relationship nodes | Loaded client modules/SOP | No portal-equivalent workflow found | Later integration only if actively used and desired |
| Payments and BOSS | Loaded client modules; BOSS explicitly hidden in startup HTML | No matching integration established | Confirm enabled business use before treating as parity requirements |

PGMaps is already a useful presentation platform. Full portal parity requires identity, authorization, workflow, data conversion, and server integration in addition to reusable UI.

### The existing Nechako project is a distinct data source

It loads four public JSON files from [nwsviz](https://projects.ahmadjalil.com/nwsviz/data/overview.json), not the Stewardship Portal submission API. All four returned HTTP 200 with wildcard CORS:

| File | Verified contents |
| --- | --- |
| `overview.json` | 1,408 records; 51 source locations; years 1918–2024 |
| `submissions.cleaned.json` | 1,408 records; 1,043 with locations and **365 without locations** |
| `locations.cleaned.json` | 51 locations, all with coordinates |
| `decades.cleaned.json` | 12 decade buckets |

The live viewer displays **46 locations** because five regional/aggregate location IDs are separated from the mapped-location list. This is consistent with the configuration, not a missing-data or CORS finding. There are 214 records tagged only to those aggregate locations.

Searching `salmon` changed the live publication count from **1,408 to 198** and mapped-location count from 46 to 16; location paging exposed the second page. The current search function performs case-insensitive substring matching in the selected title, author and tag fields. It does not implement the portal’s query grammar or query live portal submissions.

Two concrete gaps within this existing project:

1. Add an **All records / Unmapped records** view. The 365 unlocated records contribute to the counts, but the current location-driven dialogs and aggregate-only dialog exclude records without location IDs. The new workbench Research view now provides that route; the original location-driven project remains unchanged.
2. Extend the source contract with verified citation URLs, DOI/Zotero item references or canonical source links. Current record payloads contain title, author, year, type, tags and location IDs, but no per-record download/citation URL. Preserve IDs within their source namespace; do not assume nwsviz IDs are portal submission IDs.

## Data-type support strategy

### Spatial formats and services

| Portal format/source | Evidence | PGMaps support level | Recommended handling |
| --- | --- | --- | --- |
| GeoJSON | Enabled registry and upload chooser | Native renderers/import paths exist | First common transport; validate geometry, properties, CRS and bounds |
| ESRI Shapefile (`.shp`, `.shx`, `.dbf`, `.prj`) | Enabled registry and upload chooser | Specialized forestry import uses shpjs | Reuse/generalize ZIP parsing; retain projection and original sidecars; support points as well as lines/polygons |
| GML | Enabled registry | No generic portal ingestion found | Parse validated GML or convert server-side to GeoJSON; handle CRS and version |
| GPX | Enabled registry | Specialized route GPX export exists | Add general track/route/waypoint import and export; retain time/elevation where supplied |
| KML | Enabled registry and chooser | Some dataset pipelines use KML | General conversion to GeoJSON plus retained original styles/documents |
| KMZ | Upload chooser, absent from enabled registry | No general import verified | ZIP/KML handling, referenced media and safe relative paths; explicitly test portal acceptance |
| SQLite / SpatiaLite | Enabled registry | No generic browser database reader found | Prefer controlled server-side conversion/export; preserve tables, keys, CRS and original file |
| GeoPackage | Enabled registry | No general multi-layer GeoPackage loader found | Server-side GDAL or an evaluated browser reader; offer layer selection and import report |
| WMS: hosted QGIS and DataBC | 32 services live tested; representative map/identify tested | Existing WMS raster/legend construction | Dynamic GetCapabilities catalogue, GetMap, GetLegendGraphic and GetFeatureInfo |
| XYZ/OSM/Esri imagery | Live default catalogue | Existing tiled map components | Preserve attribution and use reviewed HTTPS endpoints |
| WFS/raw feature export | Referenced capabilities/related tools; no full portal vector-export audit | PGMaps uses bounded feature queries elsewhere | Add only when the source explicitly supports it; validate paging, geometry and permission scope |
| Historical map rasters | Cheslatta archive advertises two named WMS layers | Raster rendering exists | Keep georeferencing/symbology on QGIS; serve WMS and attach archive metadata |
| Raw GeoTIFF/other raster datasets | Not established by the uploaded files or portal registry | Some specialized PGMaps raster analysis exists | Treat as optional extension until actual source files and requirements are identified |

The eight enabled registry formats are Shapefile, GeoJSON, GML, GPX, KML, SQLite, SpatiaLite, and GeoPackage. A format appearing there does **not** prove every upload UI exposes it: the submission chooser explicitly lists Shapefile sidecars, GeoJSON, KML and KMZ. Test each intended import and export path independently.

WMS delivers rendered maps. It does not supply a complete analytic vector dataset. The hosted GetFeatureInfo sample returned GeoJSON-shaped features with **null geometry**; retain those as identify results, not features suitable for clipping or spatial analysis. A DataBC sample returned an empty feature collection at the chosen pixel, which establishes transport/response compatibility, not a positive aquifer hit.

### Content and measurement types

- **Submissions:** form-specific structured fields, submission metadata, parent/child relationships, status, histories, permissions and spatial links. Use a schema-driven record viewer, not only the literature title/year model.
- **Typed schema fields:** the inspected schema editor lists string, real number, integer, timestamp, and timestamp with time zone. Preserve nulls, numeric types and original time-zone semantics.
- **Monitoring CSV:** join measurements to their source spatial layer/station IDs; retain units, variable names, source timestamp/time zone, quality information if supplied, and provenance. Existing water-temperature charts are reusable presentation, not a generic monitor importer. The portal chart builder describes line and bar charts with left/right Y-axis assignments; verify those requirements before choosing chart composition.
- **Zotero/literature CSV:** map source columns to a versioned bibliographic schema, report unmapped columns and duplicate candidates, and preserve citation identifiers. The SOP describes creation of draft submissions before publication.
- **Documents and multimedia:** retain PDFs, Office files, photographs, audio, video, links and arbitrary attachment originals where permitted. The client attachment picker has no format whitelist, but actual backend limits and installed previews were not inspected. A downloadable file is different from a supported native preview.
- **GeoPaparazzi `.gpap`:** the client describes field-form/spatial/attachment matching. Treat as a separate import adapter or an explicit “open in portal” workflow until a real package is tested.
- **Project state and styles:** retain camera, layer ordering, visibility, source definitions, attribution, schema/submission references, vector data, SLD/style metadata, owner and revision. OpenLayers styling and scale cannot simply be pasted into MapLibre JSON.

The [Roundtable’s description](https://www.nechakowatershed.ca/whats-happening/nechako-portal) and [UNBC’s portal description](https://www.unbc.ca/integrated-watershed-research-group/theme-4-co-benefits-climate-catchments-watersheds-and-communities) establish the community, archival, multimedia and submitter-control context. They do not establish tested format limits or authorized redistribution of every technically accessible resource.

## CORS and integration results

The authoritative browser tests ran from the actual deployed document at `https://pgmaps.ahmadjalil.com/dev`, with normal Chromium security and no Playwright routing/interception. The managed environment’s normal outbound proxy remained in place.

| Browser request from PGMaps | Result | Meaning |
| --- | --- | --- |
| Public format registry GET, credentials omitted | Pass | Public JSON-like response can be read |
| Search contexts, form-encoded POST | Pass | Portal’s expected request encoding works for this public read |
| Format GET with `credentials: include` | **CORS blocked** | Wildcard allowed origin is incompatible with credentialed reads |
| Format GET with `X-Requested-With` | **CORS blocked** | Preflight does not allow this request header |
| Search-context POST with JSON Content-Type | **CORS blocked** | Preflight does not allow `content-type`; JSON is not interchangeable with legacy form POST |
| Saved-project list, form-encoded POST | Transport pass, application failure | Response says `Website not registered` |
| Default-project GET | Transport pass, application failure | Response says `Website not registered` |
| Portal search for `nechako`, same-origin UI | Application failure | Response says `Website is not registered`; this occurs within the portal too |
| Public nwsviz overview GET | Pass | Existing literature integration works |
| All 32 exact configured WMS capabilities URLs | Pass | Browser could read all configured capability documents |
| Hosted QGIS sample: GetMap and GetFeatureInfo | Pass | PNG and JSON readable |
| DataBC aquifer sample: GetMap and GetFeatureInfo | Pass | PNG and JSON readable; sampled identify had no hits |
| example.com negative control | CORS blocked as expected | Confirms the actual-page test enforced browser CORS |

**Confirmed issues:** credentialed requests and custom/JSON preflights. The portal’s PHP responses advertise `Access-Control-Allow-Origin: *` and lack the tested preflight allowances. OPTIONS returns HTTP 200 but executes normal handler logic; a 200 status alone is not a valid preflight policy. Some endpoints return `success: true` alongside `status: failure`; the integration must inspect both the response body and HTTP status.

**Not a confirmed CORS issue:** portal registration failures, empty anonymously available form lists, and the configured DataBC services. Raw HTTP probes did not consistently expose DataBC’s allowed-origin header, whereas real browser responses reflected the PGMaps origin and allowed reads. Do not label those eight services broken based on curl-style probes alone.

The literature host returned OPTIONS 405 in HTTP probes. This does not affect the normal public GET path currently used by PGMaps; do not add unnecessary custom headers to it.

### Recommended integration choices

**Public exploration:** use simple GETs and `application/x-www-form-urlencoded` POSTs, with `credentials: 'omit'`, no unconditional `X-Requested-With`, and no unnecessary custom headers. Parse the portal’s JSON responses even where it labels them `text/html`; validate the envelope rather than assuming all 200s mean success.

**Authenticated exploration:** establish a supported identity/session bridge. Logging into the portal in a separate tab does not establish PGMaps access to the portal’s session. Direct browser integration needs an explicit approved origin, credential allowance, proper OPTIONS handling and permitted headers/methods, plus confirmed session cookie and browser privacy behavior. An alternative is a same-origin PGMaps backend/BFF using a documented per-user portal session/token exchange. A proxy cannot invent authorization or use one administrator session for every user.

**CORS configuration requirements, if direct credentialed access is selected:** exact allowed origins, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, an early OPTIONS response with the supported methods/headers, and CORS headers on error responses too. Allow only the headers actually required. Test session expiry, logout, inaccessible records, attachment downloads and export headers. Supporting JSON additionally requires backend JSON decoding; changing CORS alone will not make PHP form handlers parse JSON.

**WMS:** preserve the hosted QGIS services and their authoring workflow. Add a generic catalogue/identify adapter around existing raster components. Negotiate CRS and WMS version explicitly: 1.1.1 SRS/BBOX behavior differs from 1.3.0 EPSG:4326 axis ordering. Use EPSG:3857 where supported and keep native layer identifiers distinct from user-visible titles.

## Proposed PGMaps development menu

Add one **Nechako Portal** entry to the existing `/dev` library, opening `/dev/nechako`. Its capabilities should be visible as navigation tabs/sections, with server failures and access states shown inside the affected view. These are proposed routes, not implemented routes.

| Menu/view | Purpose and first usable behavior | Readiness |
| --- | --- | --- |
| Overview | Source/version, public service status, formats, data ownership and capabilities available to this session | Build first |
| Search & Submissions | Portal keyword/context search, field expressions, extent/area limits, paged results, record detail, canonical portal links | UI/client contract known; results blocked by registration failure |
| Layers | Browse all service entries and named layers, filter by theme/provider, inspect metadata, add to map, toggle/opacity/order, legend and identify | Public service discovery works now |
| Projects | Tabs for PGMaps packages and portal saved projects; preserve current catalog, existing Nechako explorer and portal-WMS previews | Existing PGMaps side reusable; portal side blocked pending repair/auth |
| Monitoring | Station/layer/schema selector, paged observations, variable/unit selection, date range, chart/table and CSV | Charts reusable; live portal payloads require validation |
| Files & Archives | Permission-aware attachments and document/media previews linked to submissions | Contract adaptation and representative files needed |
| Import & Export | Local previews for GeoJSON/CSV/Shapefile; format conversion report; clear portal handoff for publishing; later protected import/export calls | Partial primitives exist; new adapters needed |
| Map Tools | Identify/table/selection/draw/measure first; processing and styling capabilities added deliberately | Reuse existing interaction/table UI; advanced parity is later work |
| Administration | Open authoritative user/group/form/schema/shared-layer managers in the portal; later session-aware shortcuts | Keep portal administration authoritative |

Suggested query-addressable state: `/dev/nechako?view=search`, `?view=layers`, `?view=projects`, `?view=monitoring`. A selected submission/project should retain a source-qualified identity. Keep implementation diagnostics in an explicit developer panel, with ordinary loading, unavailable, sign-in-required and source-error messages in the normal view.

The Layers view and existing literature explorer can deliver value while portal search/project APIs are repaired. Search should show the source’s actual failure and a retry/open-in-portal action; it must not replace a failed live portal query with unrelated nwsviz results.

## Initial implementation boundaries and staged plan

### Stage 0: repair and confirm the shared contract

1. Repair or diagnose the portal’s website registration lookup. The failure was reproduced on its own default-project load, normal search and project list. Check canonical host/alias/configuration and the request context it expects; root cause was not established without backend access.
2. Select a public-read and authenticated-read transport strategy; repair the confirmed CORS/preflight conditions if direct browser access is required.
3. Obtain representative authorized payloads for one submission of each active form type, one vector layer, one monitoring schema/data series, one attachment of each required kind, and one saved project/export. Confirm permission behavior with actual accounts belonging to different groups.
4. Confirm which loaded modules are enabled features. Payments, BOSS and some workflow nodes may be framework capabilities rather than active Nechako requirements.

### Stage 1: public development workbench

- Register the Dev Library entry and route, reuse the shared responsive workspace/sidebar/table/dialog primitives.
- Load the portal’s public catalogue and capability documents lazily; reuse WMS rendering/legends and add identify. Preserve existing PGMaps projects and expose their source clearly.
- Add a portal search adapter and form-based query transport, with source errors exposed accurately. Start with keyword/context search; add expressions and geographic limits against the proven backend contract.
- Add an All/Unmapped records view to the existing literature explorer, rather than conflating it with live portal search.
- Keep results and layer previews usable on mobile; test empty states, retry, partial service failures, and representative map queries.

### Stage 2: authorized records and saved projects

- Add per-user access, schema-driven submission details, attachments, histories and parent/child navigation.
- Convert portal projects into existing PGMaps workspace models. Resolve native sources explicitly; translate vector styles/SLD within a documented supported subset; report unsupported layers instead of silently dropping them.
- Preserve owner, source ID, source revision and protected layer references. Keep local/public JSON packages distinct from server-governed portal projects. Add portal-backed save/share/history only after the authorization contract is verified.

### Stage 3: monitoring and conversion

- Add generic monitoring loading, schema-field/unit mapping and charts; reuse the water-temperature and toolkit chart components while preserving source semantics.
- Build import previews/matching and safe format conversion. Keep originals and generate display derivatives. Continue to use portal drafts/publishing initially.
- Add authoritative submission exports and paged CSV downloads. Test file size, content type, filename headers, permissions, projections and round trips.

### Stage 4: advanced tools and administration

- Add processing/editing/style capabilities individually with clear source contracts. Large geometry/format conversion may belong in backend jobs rather than unbounded browser processing.
- Integrate recurring workflows and administration only where operational use justifies them. Continue maintaining the portal’s QGIS/server/user management independently of PGMaps releases.

These stages are an implementation order, not time estimates. Backend/session access, samples, publishing rules and project conversion complexity must be established before committing to a reliable schedule.

### Concrete code ownership

| Existing file/boundary | Role |
| --- | --- |
| `/workspace/PGMaps/src/pages/DevLibrary.tsx` and `src/App.tsx` | Register the development entry and route |
| `/workspace/PGMaps/src/pages/DevProjects.tsx` | Reuse package catalogue/import experience |
| `/workspace/PGMaps/src/lib/projectPackages.ts` | Existing package schema; add source adapter types rather than assuming portal JSON matches |
| `/workspace/PGMaps/src/maps/project-workspace/ProjectWorkspace.tsx` | Existing WMS GetMap/legend construction and portal map preview |
| `/workspace/PGMaps/src/maps/project-explorer/adapters/useResearchRecordsAdapter.ts` | Current nwsviz transport; keep separate from portal submissions |
| `/workspace/PGMaps/src/maps/project-explorer/adapters/filterResearchRecords.ts` | Current substring/tag filtering and decade aggregation |
| `/workspace/PGMaps/src/pages/dev-water-temperature/` | Monitoring display/aggregation/export example; its transport is source-specific |
| `/workspace/geo-toolkit/API.md` | Shared maps, UI, charts, workspace and project ports; host owns authentication/data |
| Implemented `src/lib/nechakoPortal.ts` | Portal envelope parsing, search/project/submission/monitoring/WMS adapters and transport |
| Implemented `src/pages/DevNechako.tsx` and `src/maps/nechako/` | Workbench orchestration and feature views, separated by capability |
| bcdatamapper scraper/data ownership | Own any approved generated snapshots; do not duplicate generated scraper data in app-owned source |

A portal adapter should normalize data into source-qualified records, layers, attachments, monitoring series and projects while retaining native identifiers. Permissions must be enforced by the authoritative backend on every resource request. Shared geo-toolkit components should remain free of Nechako defaults, credentials and portal endpoints.

## Maintaining both systems

- **Portal:** retain QGIS map authoring/hosting, schema/form versioning, approved account activation, groups, submission publishing, layer-review decisions and protected exports.
- **PGMaps:** maintain adapters, public exploration, project rendering, responsive interaction, charts, accessibility and source-status reporting.
- **Shared contract:** document supported endpoints, envelope errors, request encoding, identity and revision fields, resource permissions, source dates and the supported project/style conversion subset. Check the contract when either site changes.

The SOP’s “All Nechako Users” sharing workflow refers to a group of registered users. It must not be interpreted as anonymous public access. Project access must also be reconciled with access to its constituent layers, submissions and files. A public project package must not automatically embed a private layer or attachment.

Documentation work is needed too: replace zero-byte SOPs; verify form-manager and project-manager navigation against the current UI; distinguish group-visible from anonymous-public content; and document the current transport errors. Preserve the SOP’s form-versioning constraint until the actual backend behavior is confirmed.

The default catalogue still contains HTTP Google imagery and OSM URLs. Prefer reviewed HTTPS alternatives and correct attribution/provider terms. This is a mixed-content/provider configuration concern, not proof of a CORS defect; those optional basemaps were not visually validated.

The deployed PGMaps project deep link rendered the app but returned **HTTP 404 for the main document**. Repair the SPA route fallback to return a proper 200 for real client routes; map/data rendering was functional despite that response. This is a separate hosting issue from portal registration and CORS.

## Original end-to-end acceptance criteria (status in completion matrix)

A completed public workbench should:

1. Discover the catalogue with independent lazy loading and isolate a failing service without losing others.
2. Render representative point, polygon and historical-raster WMS layers; show attribution, legends and actual identify responses with CRS/version handling.
3. Run portal search and return genuine backend results once registration is repaired; preserve context, expression and area semantics, with bounded results and clear error states.
4. Expose all literature records, including the 365 with no locations, while retaining existing aggregate-tag semantics.
5. Load an authorized saved portal project without silently losing camera, layer order, visibility, styles or references.
6. Respect different permissions for submissions, projects, layers and files; reject unauthorized downloads and invalidate protected caches after logout/access changes.
7. Reproduce monitoring timestamps, units, missing values and joins from a sample export; validate charts and paged CSV against source records.
8. Exercise intended format round trips with actual samples; preserve original geometry/projection and attachment originals.
9. Work at desktop/mobile sizes, handle source outages/session expiry, and keep the actual browser console free of integration CORS errors.

At the initial source review, empty submodules blocked the local audit. Those dependencies were subsequently initialized at their existing pins; the project audit, focused tests, TypeScript and local production bundle now pass. The full scraper/deployment pipeline and protected portal acceptance cases are separate checks; see the current completion matrix.

## Evidence files

- `archive-inventory.json`: all supplied filenames and sizes.
- `feature-support-matrix.csv`: 17 feature comparisons with existing PGMaps support and required work.
- `format-support-matrix.csv`: 13 spatial format/service support comparisons.
- `spatial-formats.json`: live registry payload.
- `layers-notbase.json`, `layers-default.json`: live configured sources.
- `service-inventory.json` / `.csv`: 32 services, advertised layers, HTTP and actual-browser CORS results.
- `advertised-wms-layers.csv`: 135 named layer/group entries.
- `capabilities/`: exact capability documents collected from configured service URLs.
- `browser-home.json`, `browser-workflows.json`: live UI request/payload evidence and observed failures.
- `cors-http.json`: 48 HTTP probes; use with browser evidence.
- `cors-browser-actual.json`: 14 cases from the actual PGMaps document, including confirmed preflight and credential blocks.
- `cors-wms-browser.json`: all 32 exact service capability reads and response headers.
- `cors-reconciliation.json`: actual-page repeat and negative control.
- `literature-validation.json`: four source files, counts, shapes and headers.
- `pgmaps-browser.json`, `pgmaps-interactions.json`: live Dev Library/project, search, paging and deep-link status evidence.
- `portal-*.png`, `pgmaps-*.png`: captured UI screenshots.

An early synthetic-document browser harness was used for diagnosis. Request interception affected its apparent preflight results, so `cors-browser.json` is **not authoritative** for those results. The actual deployed-page tests supersede it; the final conclusions and inventories use those tests only.
