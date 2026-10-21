# Nechako portal option audit — October 21, 2026

The adaptation has substantial map, search, submission-reading, monitoring and export functionality. It does **not** yet reproduce every source workflow. The largest remaining groups are source submission editing/publication, complete ingestion and matching, style-library management, project GIS packages, BOSS execution, and administrative creation/configuration changes. A link to the original portal is a handoff, not an implementation of that option.

This audit inventories the source's major public tools and **all seven administrator managers**, including their nested options, against the React/MapLibre implementation. It distinguishes existing main-branch behavior, additions in this change, and source-owned work. It supersedes the *gap classifications* in older assessments where implementation has since advanced; it does not replace their dated observations.

## Evidence and limits

| Evidence | What was established | What it cannot establish |
| --- | --- | --- |
| Current public interface, October 21 | The source page was available; the single sign-in attempt with the supplied credentials returned **Invalid username or password**. | No successful current administrator sign-in, protected response, or write operation was verified. |
| Current public client code | The root HTML identifies Stewardship Portal version 3, build `6268M`. All **60 captured portal modules**, **1,521,694 bytes**, were inventoried. They expose the menu labels, nested controls and client request contracts used below. | Client code is not PHP/backend source; a button or endpoint call does not prove current authorization, response content, successful processing, or correct server behavior. |
| Historical authenticated interface, October 12 | The repository's [authenticated audit](native-interface.md#authenticated-audit-october-12-2026) describes actual forms, schemas, accounts, projects, monitoring and admin dialogs seen then. | Those counts, permissions, configuration values and successful access are not current verification. This audit did not reuse or seek other credentials. |
| PGMaps source | Base commit `0c5e4544534ce83b8b34881fa9444220acc4fb20` plus this change were inspected. Native controls and route handlers are distinguished from links and static snapshots. | Local code/tests do not show that a new build or gateway has been deployed. |
| Offline gateway checks | Synthetic fixtures test allowed reads, strict administrator role handling, separate write capability, parameter bounds, session separation and logout. | Fixtures cannot certify live source policy, correctness of real private payloads or production sign-in. |

The [public-source manifest](evidence/2026-10-21-public-source-manifest.json) records each captured module's exact public URL, byte size and SHA-256, plus the root document's hash. It excludes raw source, inline configuration, credentials, cookies and private records. Eight custom widget scripts and third-party libraries referenced by the HTML were not captured; their internals are outside this option inventory. The 60 application modules include every major tool/manager and the form-node implementations. Options supplied dynamically by server content remain data-dependent.

**Status meanings:** **Implemented** means a native PGMaps workflow exists for the stated scope; **Partial** means a meaningful subset exists with the listed boundary; **Added** means code added by this change, pending deployment/current authenticated acceptance; **Source** means use the original portal; **Unverified** identifies a client control whose live behavior was not established. These are not a percentage score: a menu item, a read inspector and a transactional workflow have very different scope.

The hosted gateway remains **read-only**. A source-verified `isAdmin:true` enables permitted inspection; it does not imply `canWrite:true`. Existing local gateway mutations are a separate, explicitly reviewed subset. No live source records or settings were changed for this audit. Opening a new source form was avoided: the October 12 audit records that merely opening one allocated draft 1850, before any Save/Submit action.

## 1. Navigation, account and dashboard

Source evidence: [MainView](https://nechakowatershed-portal.ca/definitions/MainView.js?v=6268M), [Login](https://nechakowatershed-portal.ca/definitions/portal/Login.js?v=6268M), [SelfRegistration](https://nechakowatershed-portal.ca/definitions/portal/SelfRegistration.js?v=6268M), [Dashboard](https://nechakowatershed-portal.ca/definitions/portal/Dashboard.js?v=6268M), [About](https://nechakowatershed-portal.ca/definitions/portal/About.js?v=6268M).

| Source path / options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Header → Fill a Form | Import/draft-review tools exist; opening the original form wizard and completing every source node is not a native PGMaps flow. | Partial / Source |
| Header → Search; Reports; Links | Native search/report windows exist. Links supplies source and provenance links; dynamically configured source Links content is not automatically recreated. | Partial |
| Header → Login; Logout; As Guest | Gateway sign-in, anonymous reads and disconnect are implemented. Source credentials/cookies remain out of browser persistence; current supplied sign-in was rejected. | Implemented; current authentication unverified |
| Header → Sign-Up → first/last name, email, username, password/confirmation, terms, Clear, Register | Original-account handoff exists. Account creation and email behavior are not ported or tested. | Source |
| Dashboard → Action Center → Change password / repeat password | No native source password-change operation. | Source |
| Dashboard → Submit error report → Subject, Content, Submit | No native submission/email operation. | Source |
| Dashboard → Notifications → new tasks, near deadline, More Info, close notification | This change adds explicit reads by starting date, separate returned categories and source-submission navigation. Source five-minute polling, notification badge and dismissible popup layout are not reproduced. | Added / Partial |
| Dashboard → Schedule → monthly highlights, day selection, event/task/rank/status/details, open submission | This change adds calendar month navigation, source day highlights and selected-day task inspection. Reads are manual, preserve returned IDs and distinguish markers from task counts. | Added |
| Header/footer → About, source version/build, welcome and description content | PGMaps has its own About/provenance and source links; build metadata describes separate software. Source-configured welcome content remains source content. | Partial |

Implementation: [portal route](../../src/pages/DevNechakoPortal.tsx), [connection](../../src/lib/nechakoConnection.ts), [account panel](../../src/maps/nechako/LocalPortalConnection.tsx), [dashboard](../../src/maps/nechako/PortalAdminDashboard.tsx). The dashboard is a signed-in user workflow, not an administrator capability; manager reads separately require the source admin role.

## 2. Map, layers, styling and processing

Source evidence: [MapPanel](https://nechakowatershed-portal.ca/definitions/MapPanel.js?v=6268M), [MapController](https://nechakowatershed-portal.ca/definitions/map/MapController.js?v=6268M), [AddLayers](https://nechakowatershed-portal.ca/definitions/map/AddLayers.js?v=6268M), [Draw](https://nechakowatershed-portal.ca/definitions/map/Draw.js?v=6268M), [EditVectors](https://nechakowatershed-portal.ca/definitions/map/EditVectors.js?v=6268M), [Attributes](https://nechakowatershed-portal.ca/definitions/map/Attributes.js?v=6268M), [Identify](https://nechakowatershed-portal.ca/definitions/map/Identify.js?v=6268M), [DefinitionQuery](https://nechakowatershed-portal.ca/definitions/map/DefinitionQuery.js?v=6268M), [Stylize](https://nechakowatershed-portal.ca/definitions/map/Stylize.js?v=6268M).

### Add Layer and layer controls

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Add Layer → WMS Source → search, service/layer selection, Add To Map | WMS catalogue, capabilities, advertised layers/styles and live map loading exist. A structural catalogue entry does not guarantee its remote service currently responds. | Implemented |
| Add Layer → Schema Source → name/geometry filter, Add This Schema | Schema definitions can be inspected. Selecting an arbitrary native schema as a live map layer is not a native picker workflow. | Partial / Source |
| Add Layer → Submission Source → layer/submission name/ID search | Submission detail exposes source spatial/linked-layer descriptors and supported map layers; the source's dedicated cross-submission layer picker is absent. | Partial |
| Add Layer → Shared Layer → filter/search, Add To Map | Admin review queue inspection exists; a complete general-user shared-layer picker and arbitrary native layer materialization remain source-owned. | Partial |
| Add Layer → BOSS Output Layer → export ID, process/analysis/input/overlay | No native BOSS output catalogue or map handoff. | Source |
| Add Layer → Vector Layer → Layer Name, Point/Line/Polygon, Attribute Template | Local geometry creation and imports exist. Creating a native layer from a selected source attribute template is not implemented. | Partial |
| Map → base layer folder, visibility, opacity, Move Up / Move Down, Remove, Zoom to Extent | Native PGMaps layer controls support WMS and local vectors. Unsupported original sources are retained in imported project originals with explicit conversion notes. | Implemented / bounded |
| Layer context → Rename / Save | This change adds local display-name editing while preserving source IDs and map-service names. It does not rename database layers. | Added |
| Map → Legend, Project; footer coordinates; discrete scale selector | Legend/project controls exist; pointer coordinate display is added in this change. The source's complete fixed ratio scale selector and OpenLayers display are not identical. | Partial |
| Layer context → Attribute Table; Identify Results | Local properties, WMS identify and source-backed attribute reads exist. Editable source attributes and full server table behavior are not implied. | Partial |
| Layer context → Query → attribute/value lists, AND/OR/NOT, parentheses and comparisons, Query Results | Submission expressions exist, but they are a different endpoint and data model. A native layer definition-query UI/transport is not implemented. | Source |
| Layer context → Share Layer → Reason, Send For Consideration | No native source publication/review-submission operation. | Source |

### Drawing, geometry operations and attributes

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Draw Vectors → selected layer, Start Edits / Done | Point/line/polygon drawing, selected local feature inspection and editing controls exist. | Implemented / local |
| Draw → Draw New Features; Erase Points; Erase Features; Reposition Misplaced Points; Erase All Features | New feature creation, removal and GeoJSON edits exist. Direct pointer-based vertex insertion/removal/repositioning is not equivalent to editing JSON and remains a gap. | Partial |
| Draw → Edit Attributes; Export JSON | Local feature properties can be edited through retained GeoJSON; feature/layer exports exist. The source grid/editor arrangement is not reproduced. | Partial |
| Buffer → Layer; Distance (m); Create Buffer; job/status list | Local buffer exists with bounded input and undo/export. Source server job execution/status persistence is not ported. | Implemented / local |
| Clip → Layer; Mask; Clip Layer | Supported local geometries can be clipped to a polygon. | Implemented / local |
| Difference → Layer; Overlay; Difference Layer | Local polygon difference exists. Arbitrary native server layers are not interchangeable local inputs. | Implemented / local |
| Split → Layer; Overlay; Split Layer | Supported local line and polygon splitting exists. | Implemented / local |
| Intersection → Layer; Overlay; Intersect Layers | Local polygon intersection exists. | Implemented / local |
| Union → Layer; Overlay; Union Layers | Local polygon union exists. | Implemented / local |
| Attributes / Identify → submission link, linked monitor View Data, page size, First / ±1 / ±5 / Last | Native submission IDs and monitoring associations are retained; source reads are bounded to at most 500 monitor rows/request. Local vectors have their own paginated table. | Partial |
| Monitor table → separator; Download CSV (This Page) / (All Records) | Current-page exports and local imported/filtered dataset exports exist. They are not a full source-table export; unbounded source downloads remain disabled. | Partial |

The local algorithms are useful framework features, but the original geometry engine, CRS rules, large jobs and all source layer types were not compared numerically. Do not describe algorithm-name coverage as full computational parity. Implementation: [layers](../../src/maps/nechako/PortalLayers.tsx), [vectors](../../src/maps/nechako/PortalVectors.tsx), [layer records](../../src/maps/nechako/PortalLayerRecords.tsx), [workspace adapters](../../src/maps/nechako/data/workspace.ts).

### Stylize and SLD

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Stylize → Single → symbol type/icon, size, opacity, fill/stroke colour, stroke width/opacity | Local colours, radius, line width and opacity exist; full source icon/symbolizer semantics are not reproduced. | Partial |
| Categorized → attribute, condition, value, rule name; add/remove rule | Local attribute categories and per-category colours exist. Source ordered rules, comparisons and rule names are not represented fully. | Partial |
| Rule conditions → Equals, Not Equals, Less Than, Less or Equal, Greater Than, Greater or Equal, Between | Category equality is not the entire rule system. Comparison/range rule editor remains source-owned. | Partial / Source |
| Categorized → Add All, Add Unique Classes | Local category discovery exists; native rule construction and classification semantics need dedicated adapters. | Partial |
| Edit Gradient → add/remove colour, offset %, presets, Confirm | No full gradient-rule editor or source colour-ramp round trip. | Source |
| Apply Custom Style; Remove Applied Style | Local styling, advertised WMS styles and safe existing HTTPS SLD references are supported. Native custom SLD processing/rendering is not fully portable to MapLibre. | Partial |
| Download SLD | Native source SLD generation/download is absent; workspace JSON is not an SLD substitute. | Source |
| Save SLD to Portal → Name, Share style, group/user permission tree, Save | No hosted source-style mutation or permission editor. | Source |
| Load Style → search, ownership/shared/schema columns; Delete Style; Load and Apply | No source saved-style gallery/ownership workflow. | Source |
| Upload SLD → file, Upload and Apply | Existing SLD URL passthrough does not implement file upload, validation or source staging. | Source |

Implementation: [vector styles](../../src/maps/nechako/data/vectorStyle.ts), [WMS and SLD references](../../src/maps/nechako/PortalLayers.tsx). The source's [SLDforge](https://nechakowatershed-portal.ca/definitions/map/SLDforge.js?v=6268M) is additional serializer evidence, not a MapLibre-compatible style specification.

### Download and map image export

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Download → Name, Layer, Format, Download | Local vectors export GeoJSON/CSV; optional GDAL conversion supports additional formats. Arbitrary source layer extraction uses separate server operations and is not fully ported. | Partial |
| Export → Title, North Arrow, Scalebar, Legend, Legend Scale, width/height, Same as Map, distance units, Attribution | This change adds native PNG composition from the current map with title/legend/north arrow/scale/attribution and bounded output sizing. Layout/rendering is an adaptation; use the component's supported controls rather than claim every original setting is identical. | Added / Partial |
| Export remote WMS imagery | Successful canvas capture depends on service CORS and loaded tiles. The new composer reports capture errors instead of claiming a complete export when imagery cannot be captured. | Conditional |

Source: [Download](https://nechakowatershed-portal.ca/definitions/map/Download.js?v=6268M), [ExportMap](https://nechakowatershed-portal.ca/definitions/map/ExportMap.js?v=6268M). Implementation: [map export](../../src/maps/nechako/PortalMapExport.tsx), [capture helper](../../src/lib/mapImageCapture.ts), [conversion](../../src/maps/nechako/data/conversion.ts). Non-GeoJSON conversion requires its separately running service; a deployed frontend alone does not provide GDAL.

## 3. Search and submission browsing

Source: [Search](https://nechakowatershed-portal.ca/definitions/portal/Search.js?v=6268M), [ExpressionBuilder](https://nechakowatershed-portal.ca/definitions/portal/ExpressionBuilder.js?v=6268M), [SearchParser](https://nechakowatershed-portal.ca/definitions/portal/SearchParser.js?v=6268M).

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Find Submissions → text query, Search, contextual fields, Toggle All | Actual source submission search, source identifiers and captured public submission inventory exist. Research/literature records are a separately named collection. | Implemented / source access dependent |
| Results → Type, Submission Title, Name, Date, Submitted By; open submission; Export to CSV | Native results/readers and CSV exist. Returned/captured results do not establish complete source database coverage. | Implemented |
| Selection Type → Normal, Select By Area, Select By Extent; Selection Layer | Current-map extent and local polygon filtering exist. Native server-layer area selection has a different geometry acquisition path. | Partial |
| Expression Builder / Simple Expression Builder → nested AND/OR, add rule/condition, Accept, query-text preview | Native visual nested expression builder and typed queries exist; unsupported source syntax must not silently change meaning. | Implemented / subset |
| Builder tabs → General Search; Search by Subtypes in Form; Search by Content Field Names | This change adds General and captured-form field pickers, with explicit Form ID scope and distinct field IDs for duplicate labels. Source form-subtype hierarchy is not reproduced and unsupported expression syntax is not invented. | Added / Partial |
| Saved Searches → Name, Load, Save, Clear | Browser-local saved queries and JSON transfer exist. This does not reproduce source-owned/shared query persistence. | Partial |
| Switch to Submission Browser / Switch to Submission Search | This change adds a captured-public-data form → year browser with independent filters/pages and the existing source reader. It is a useful native adaptation; the source's form/subtype hierarchy and private catalogue are not reproduced. | Added / Partial |

Implementation: [submission search](../../src/maps/nechako/PortalSubmissionSearch.tsx), [unified search](../../src/maps/nechako/PortalUnifiedSearch.tsx), [expression UI](../../src/maps/nechako/PortalExpressionBuilder.tsx), [expression adapter](../../src/maps/nechako/data/searchBuilder.ts). A previously reported missing visual AND/OR builder is now implemented and must not be carried forward as an unchanged gap.

## 4. Submission detail, forms and ingestion

Source: [FillAForm](https://nechakowatershed-portal.ca/definitions/portal/FillAForm.js?v=6268M), [SubmissionViewer](https://nechakowatershed-portal.ca/definitions/portal/SubmissionViewer.js?v=6268M), [Submission](https://nechakowatershed-portal.ca/definitions/submission/Submission.js?v=6268M), and form-node modules listed in the manifest.

### Existing submissions and the form wizard

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Viewer → Preview | Source form definitions and returned values render in native PGMaps; safe rich text, source links and explicit unsupported-node labels retain provenance. | Implemented / bounded |
| Viewer → General → Name, Title, Status, Creator, Assigned To, Date | Read inspection exists. Update Info, change reason and authoritative status/assignment edits remain source-owned. | Partial |
| Viewer → Allowed Users; Child Submissions; History | Native read tabs, source IDs, child navigation and history values exist. Readers are not ACL or audit-log editors. | Implemented / read-only |
| Viewer → Spatial Data → Submission Spatial Data / Submission Linked Layers; Add to Map; Download | Native descriptors and supported map/monitoring handoffs exist. All original GIS extraction formats and linkage edits are not implemented. | Partial |
| Viewer → Attachments → list/metadata/download | Native source-authorized download paths exist; unreturned/denied content is not inferred from filenames. | Implemented / access dependent |
| Viewer → Export → Submission as PDF / Website / CSV / Attachments ZIP | Native original exports are implemented through bounded, signature-checked download routes. A report ZIP and a native attachments ZIP are different artifacts. | Implemented |
| Fill a Form → form search, Start New Submission, Resume a Draft Submission, Open | Definitions and local review are available; full original form entry/resume is a source handoff. Creating a source draft is a mutation, including automatic allocation on open. | Partial / Source |
| Wizard → Submit Form; Hold as Draft; Delete Submission | Hosted writes are disabled. Local gateway only supports reviewed new-draft allocation/content/name for selected rows, not publication, arbitrary draft resume or deletion. | Partial / Source |

### Nested form nodes

| Source node / exact option group | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Submission Name → Title, Name, Name is Title | Values render; reviewed local draft uploader can supply a selected name column. Full interactive source node behavior is not ported. | Partial |
| Dynamic Content → text, rich HTML, number, checkbox, textarea, date, month/year, label | Source values render safely and local field review preserves types. The complete WYSIWYG authoring/media toolbar and source editing lifecycle remain separate. | Partial |
| Parent Submission → choose parent / no parent | Existing relationships can be read. Parent assignment and inheritance are source operations. | Partial / Source |
| Attachments → upload files, metadata, Remove, Download | Read/download and local file review exist; multipart source uploads, metadata mutation and removal are absent. | Partial |
| Permissions → group/user selection, Can Edit, Users Added, Copy Parent Permissions, Save | Returned access can be inspected; editing per-submission ACL and inheritance remain source-owned. | Partial |
| Notifications → Add Recipient, comment, Remove, Send Notification To Selected User(s), Copy Parent Notifications | Dashboard notification reads are separate from sending submission emails. No send/copy recipient mutation is implemented. | Source |
| Schedule → Priority, Start Date, End Date | Dashboard tasks/configuration can be read. Saving submission scheduling and derived deadlines is absent. | Partial / Source |
| Spatial Layers → Upload; Upload and Match to Schema; Remove; Download; Draw Layer and Add From Map | Local GIS import/matching review exists; source multipart staging, schema-assigned insertion and removal remain absent. | Partial |
| Linked Layers → All / Only Linked / Only Non-Linked; layer/ID filter; Linked toggle; Download; Add to Map | Existing linked layers are inspected; source link/unlink toggles and complete catalogue selection remain absent. | Partial |
| Monitoring → Upload CSV; View Data; View Chart | Native association reads, bounded pages and local charts exist. Writing monitor observations to the source is not enabled. | Partial |
| Payment → identity/card/expiry, Process Transaction | Present in shipped client code. No payment workflow is implemented, exercised or assumed active. | Source / Unverified |
| Node Help | Original node help is linked/inspectable via content resources; not every help panel is reproduced beside each field. | Partial |

Implementation: [source submission dialog](../../src/maps/nechako/PortalSourceSubmissionDialog.tsx), [source resources](../../src/maps/nechako/PortalSubmission.tsx), [form layout](../../src/maps/nechako/data/submissionFormLayout.ts), [draft review](../../src/maps/nechako/PortalDraftReview.tsx), [native draft adapter](../../src/maps/nechako/data/nativeDraftUpload.ts). The [RestoreQueue](https://nechakowatershed-portal.ca/definitions/portal/RestoreQueue.js?v=6268M) supports source wizard restoration; reading a definition is not restoration of a persisted editable submission.

### Bulk CSV, GIS/schema matching and GeoPaparazzi

Source: [BulkLoader](https://nechakowatershed-portal.ca/definitions/portal/BulkLoader.js?v=6268M), [ShapefileNode](https://nechakowatershed-portal.ca/definitions/submission/nodes/ShapefileNode.js?v=6268M), [GeoPaparazziLoader](https://nechakowatershed-portal.ca/definitions/portal/GeoPaparazziLoader.js?v=6268M), [MapImportSession](https://nechakowatershed-portal.ca/definitions/portal/MapImportSession.js?v=6268M).

| Source option group | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Bulk-Loader → Spreadsheet, Separator including custom delimiter, Has Header | Local CSV parsing/review exists. Source wizard options and server import lifecycle are not identical. | Partial |
| Bulk-Loader → Form Name, Name Column; map form field to CSV column or New Attribute Value | Source form/schema field matching, explicit review, duplicate identifiers and selected name column exist. Arbitrary per-field constant overrides are not a complete native source matcher. | Partial |
| Bulk-Loader → Match Preset; Load / Save; preset name; Share Preset; group/user permission tree | Local mapping JSON import/export exists. Source preset creation/sharing/ACL does not. | Partial |
| Bulk-Loader → Previous / Next, selected reviewed records → draft creation | Local review can create a bounded selected batch using the local gateway; stages/IDs/errors remain visible and ambiguous allocations are not retried. Hosted source creation is disabled. | Partial / local gateway only |
| GIS upload → select schemas for layers, schema field/type, layer attribute or constant | Local GIS conversion and source-schema mapping review exist. Actual source GIS upload/staging/commit is absent. | Partial |
| GIS match → Date/Time Format; Time Zone Settings; data UTC offset / timezone lookup / column / explicit offset | Local monitoring normalization implements a documented subset with explicit formats/timezones and error reporting. It is not all source SQL date-format syntax or GIS import semantics. | Partial |
| GIS match → Load / Save / Share presets; Back / Finish; type-mismatch review | Local review/preset files exist; source persisted matching and transactional completion are absent. | Partial |
| Draw Layer and Add From Map → layer list; Name, geometry Type, Schema; draw/edit; Cancel / Done | Local vectors exist, but creating schema-backed source submission geometry from the map is not ported. | Partial / Source |
| GeoPaparazzi → Choose File; Duplicate Protection; Upload / Upload and Match to Form | Optional converter provides database table/column/count inventory only. It does not parse all original note/form/media/track relationships or implement source duplicate-key rules. | Partial / inventory only |
| GeoPaparazzi → Match Forms → note name/ID/timestamp to Portal Form | No native note-to-form import workflow. | Source |
| GeoPaparazzi → Match Fields → portal field label/key/ID/type, GPAP item key; Point Schema; Include Attachments | No complete GPAP field/media/geometry mapping. CSV/GeoJSON exported elsewhere can be reviewed, with originals retained. | Source |
| GeoPaparazzi → Match Preset load/save/share; Select Records to Submit; Match Viewer; Create Draft Submission(s) From Selection | No native GPAP draft transaction or duplicate/recovery implementation. A database inventory or general CSV draft uploader is not equivalent. | Source |

Implementation: [file review](../../src/maps/nechako/PortalFiles.tsx), [field review](../../src/maps/nechako/data/submissionReview.ts), [conversion service contract](../../src/maps/nechako/data/conversion.ts). Original files and unmapped source values are retained; neither a preview nor exported review JSON publishes data.

### Monitoring data and charts

Source: [MonitoringNode](https://nechakowatershed-portal.ca/definitions/submission/nodes/MonitoringNode.js?v=6268M).

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Layer/Schema/Submission ID selection; filter/search; open linked submission | Native association chain and source IDs are used rather than conflating layer, schema and record IDs. | Implemented / read scope |
| Upload monitor CSV → separator/header, schema field/type, CSV column/constant, date/time/timezone | Local monitoring preparation and validation exist; actual source observation inserts remain disabled. | Partial |
| Monitoring presets → load/save/share and access tree | Local preset JSON exists; source preset ownership and sharing remain absent. | Partial |
| View Data → page size, First / ±1 / ±5 / Last, page/all CSV | Bounded source pages and current-page downloads exist; complete table download is not claimed. | Partial |
| View Chart → chart type, field position, include-used fields, min/max, colour, Edit / Test, record count, Make Chart | Native PGMaps line/bar/scatter views, variable mapping, date/row validation and statistics exist. The complete source multi-field chart editor/test paging/axis settings are not reproduced. | Partial |

Implementation: [live monitoring](../../src/maps/nechako/PortalLiveMonitoring.tsx), [local monitoring](../../src/maps/nechako/PortalMonitoring.tsx), [relationship adapter](../../src/maps/nechako/data/monitoringRelations.ts). Counts apply to the selected association; observation rows are not submission counts. Empty numeric values remain missing; duplicate station/timestamps are retained and reported.

## 5. Reports, projects and BOSS

### Form reports

Source: [ReportingTool](https://nechakowatershed-portal.ca/definitions/portal/ReportingTool.js?v=6268M).

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Generate → For Form → source form selector, Form Element / User Label, Generate | Native form discovery/field mapping and `GetFormStatistics` read exist. Returned rows retain real submission IDs. | Implemented |
| Match Preset → Load; Save; name; Share Preset; group/user permissions | Local report preset files exist; source saved preset/ACL workflow is absent. | Partial |
| View → Table | Native returned rows and separately supplied source statistics are inspectable. Unknown statistics shape is preserved, not redefined. | Implemented |
| View → Graphs | Current source client exposes the option but its handler only hides other panes; its graph call is commented out. A PGMaps numeric graph adaptation is included in this change; it must not be described as reproducing a working source renderer. | Added / source rendering unverified |
| Export → Spreadsheet → separator, Download | Native CSV export exists, plus PGMaps HTML/PDF/review ZIP. Those extra exports preserve provenance and are separate from native submission/attachment exports. | Implemented |

Implementation: [form reports](../../src/maps/nechako/PortalFormReports.tsx), [graph adapter](../../src/maps/nechako/data/formReportGraph.ts), [report adapters](../../src/maps/nechako/data/submissionReview.ts), [report exports](../../src/maps/nechako/data/formReportExport.ts). Graphs use the shared toolkit ScatterPlot, preserving response positions and original values. Only supported finite numeric values/decimal strings are plotted; booleans, missing values, unsupported statistics shapes and unsafe precision conversions are excluded visibly. Source `results`, `count` and other statistics are never inferred from the number of submission rows. The original table and exports remain available.

### Saved projects and descriptions

Source: [Project](https://nechakowatershed-portal.ca/definitions/map/Project.js?v=6268M), [ProjectDescription](https://nechakowatershed-portal.ca/definitions/portal/ProjectDescription.js?v=6268M).

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Project → search/filter, project ID/name/creator, description, Load | Native local workspace plus captured public maps and source-authorized saved-project reads exist. Private projects require successful current source access. | Implemented / partial conversion |
| New Project; Save; Save As; Rename | Local workspace creation/save/export exist; reviewed local gateway supports selected source save/new/rename operations. Hosted source writes remain disabled. | Partial |
| Delete Project | Source deletion is absent. | Source |
| Share → Set Permissions; Share; Stop Sharing | Local gateway supports reviewed source sharing changes with ownership checks. Hosted read-only deployment cannot mutate sharing. | Partial / local gateway only |
| Set As Default; Unset Default; Load Default | Read/load plus reviewed local default mutation exist; hosted source mutation remains disabled. | Partial |
| Project history → select version, Load Latest / Continue As Is / Cancel | Source history/load and browser snapshots are represented distinctly; unsupported native layers stay in retained original JSON. | Partial |
| Edit Project Description → rich content/editor | Source descriptions/images/links can be read; authoring/persisting native rich description content is absent. | Partial / Source |
| Download Project Files → Spatial File Format; Download For SMASH | Original JSON export is available. A server-built GIS/media package and SMASH package are not implemented by exporting that JSON. | Source |

Implementation: [project manager](../../src/maps/nechako/PortalProjectManager.tsx), [project writes](../../src/maps/nechako/PortalProjectWrites.tsx), [project adapter](../../src/maps/nechako/data/projectManager.ts), [public projects](../../src/maps/nechako/PortalPublicProjects.tsx). Conversion preserves originals and reports omissions; native temporary mapfiles/SLDs may expire, HTTP-only basemaps are not silently upgraded, and no new authoritative vector serialization is invented.

### BOSS

Source: [Boss](https://nechakowatershed-portal.ca/definitions/map/Boss.js?v=6268M). The launcher is initially hidden and source login/permissions determine availability. The original backend's analysis semantics, job limits and any costs were not verified.

| Source option | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Inputs → layer, user attribute, process description, table, Keep; Add Layer to Inputs; Upload Layer and Add; Remove Layer | No native BOSS input/job workflow. Generic GIS imports/operations are not BOSS. | Source |
| BOSS Queue → queue/jobs and state | No native BOSS execution, queue, cancellation/recovery or server-status integration. | Source |
| Outputs / BOSS Exports → search/filter, Refresh Exports; export/process/analysis/input/overlay fields; Layers / Groups | No native BOSS result catalogue. | Source |
| Result → Report / Admin Report → PDF, HTML, View HTML; Download CSV; Keep | No BOSS-specific native report/admin-report permissions or downloads. | Source |

The option directory supplies the original menu path only. BOSS needs its own verified backend contract and acceptance fixtures; it should not be implemented by assigning its label to local geometric overlay.

## 6. Administrator managers — complete major option inventory

The root source HTML contains **User Manager, Group Manager, Submission Manager, Form Manager, Schema Manager, Shareable Manager, System Manager**. “Shareable Manager” opens a window titled “Shared Layers Manager”; these are one manager. Every row below is established by current publicly shipped manager code, with historical UI evidence where available. None is a current successful administrator session claim.

### User Manager

Source: [UserManager](https://nechakowatershed-portal.ca/definitions/portal/UserManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Account list → username, user ID, active, first/last name, email, edit-submission and BOSS flags; Refresh | Account/group inspection exists. The account directory is admin-gated at both gateway boundaries in this change even though its source path lacks `/admin/`. | Partial / hardened |
| Add User → username/password/confirmation, first/last name, email, Can Edit Submissions, BOSS Permission; Create | Account creation is not enabled. | Source |
| Edit User → General → username, password, identity/email, Primary Group | Current user details can be read. Permission writes deliberately preserve identity/password fields; general account editing is not implemented. | Partial |
| User Options → Active, BOSS; Submission Settings → Can Edit; Task Settings → Can Be Assigned, Can Assign | Flags may be inspected; mutation remains source-owned. | Partial / Source |
| Initial Notification → None / Required / Notify By Default | No native account policy editor. | Source |
| Initial Permission → None / Required / Grant Default; Group → None / Grant Primary / Grant All | No native default-inheritance policy editor. | Source |
| Permissions → forms, submissions, match presets, shared styles, shared projects; Look At / Field Filter; read/edit checks | Native resource-permission inspection and reviewed local permission updates exist. Hosted controls remain read-only. | Partial |
| Match another user's permissions → target user, per-resource switches, Match Permissions | No native permission-copy transaction. | Source |
| Save; Save & Email | Reviewed local permission-only saves exist. General account save/email notification is absent. | Partial / Source |
| Delete User; Use Portal As User | No native deletion or impersonation operation. | Source |

Implementation: [administration](../../src/maps/nechako/PortalAdministration.tsx), [permission workflow validation](../../src/maps/nechako/data/adminWorkflow.ts).

### Group Manager

Source: [GroupManager](https://nechakowatershed-portal.ca/definitions/portal/GroupManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Groups → list, Refresh; Edit Group → members, available users, Primary Group | Native read inspection, filtering and reviewed local membership/primary-group edits exist. | Partial |
| Add Group → name, Create | No native group creation. | Source |
| Remove Group | No native group deletion. | Source |
| Edit Group → add/remove members, primary toggles, Cancel / Save | Changes are reviewable through the local gateway only; hosted state is read-only. | Partial / local gateway only |

Implementation: [groups](../../src/maps/nechako/PortalAdminGroups.tsx).

### Submission Manager

Source: [SubmissionManager](https://nechakowatershed-portal.ca/definitions/portal/SubmissionManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| All submissions → Refresh, field/search filter, state/identity columns, Edit Submission | This change adds returned catalogue inspection, distinct source IDs/state filtering, 25-row local pages and opening existing submission details. Pages describe the loaded response, not a proven complete server scan. | Added / read-only |
| Permissions → Look At, Field Filter, Permission / Edit Permission | Submission ACL inspection exists in detail; a dedicated per-submission permission editor is absent. | Partial |
| Allowed Users | Native detail tab exposes returned access information. | Implemented / read-only |
| Match Permissions To Submission → Match; Save | No native permission-copy or per-submission ACL save. | Source |

Implementation: [submission manager](../../src/maps/nechako/PortalAdminSubmissions.tsx), [native detail](../../src/maps/nechako/PortalSourceSubmissionDialog.tsx). Opening an existing record rechecks its access; it does not allocate a draft.

### Form Manager

Source: [FormManager](https://nechakowatershed-portal.ca/definitions/portal/FormManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| List → Refresh, Create Form, Copy Form, View, Remove Form | This change adds structured form catalogue/definition inspection. Creation, copying and deletion remain absent. | Added / Partial |
| View → General Details → Form Name, ID, ordered fields; Preview | Structured field/node inspection is added; native value rendering already exists. No new submission is allocated to inspect a definition. | Added |
| Linked Schemas / Unlinked Schemas → associate, remove, rank | Associated schema/order reads are inspectable. Link/unlink/reordering writes remain source-owned. | Added / Partial |
| Group Visibility → visible / not visible | Both returned lists are displayed. Visibility mutations are absent. | Added / Partial |
| Users → Allowed / Disallowed; Can Edit | Source `getUserForms` contract is added to the read allowlist and displayed with edit flags. Grant/revoke changes are absent. | Added / Partial |
| Email Templates → used / unused, link/unlink | No native form email-template assignment editor. Content inspection does not reproduce template relationships. | Source |
| Create/Copy editor → Form Name; Available Elements / Used Elements, drag/order, labels/content; Preview Form, Save, Cancel | No native form-definition authoring/publishing workflow. Supported rendering is not form creation. | Source |

### Schema Manager

Source: [SchemaManager](https://nechakowatershed-portal.ca/definitions/portal/SchemaManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| List → Details, New, Copy, Delete, Refresh; name/geometry/schema-type filter | This change adds searchable/paged schema definition inspection. New/copy/delete remain source-owned. | Added / Partial |
| Details → Fields → source field name/type and relationships | Structured schema-field table replaces raw-only inspection. | Added |
| Details → Monitors → layer, schema, submission state/ID, enabled status; View Data | Verified bounded admin association reads are added, including draft/disabled flags and source submission navigation. Enabling/disabling monitors is not ported. | Added / Partial |
| Monitor data → page size/navigation; separator; CSV This Page / All Records | Existing bounded monitoring reader remains distinct from a full-table export. | Partial |
| Default Style → From Layer; Local SLD; SLD Editor; Reload Saved; Save SLD as Schema Default | No native default-style editor or save. Applying a local style does not alter schema defaults. | Source |
| New/Copy → Name, Geometry Type, Schema Type, field name/type; Add Field / Remove Selected; Save / Cancel | No native schema-definition mutation. Geometry/data-type selections and linking require the source transaction. | Source |

Implementation for both managers: [definition inspector](../../src/maps/nechako/PortalAdminDefinitions.tsx), [admin data contracts](../../src/maps/nechako/data/adminInspection.ts).

### Shareable Manager / Shared Layers Manager

Source: [LinkableManager](https://nechakowatershed-portal.ca/definitions/portal/LinkableManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Queue → ID, Submitter, Layer Name, Reason, Active, Vetted; filter/search | Native review table and source descriptor reads exist. | Implemented / read-only hosted |
| Grant; Toggle Active | Reviewed local gateway mutations exist; hosted worker never enables them. | Partial / local gateway only |
| Add To Map | Complete native manager-to-map materialization is not implemented. | Source |
| Retract → confirm | Native retraction/deletion operation is absent. | Source |
| Default Style → Open Editor; From Layer; Local SLD; SLD Editor; Reload Saved; Save SLD as Layer Default | No native authoritative layer-default style workflow. | Source |

Implementation: [layer moderation](../../src/maps/nechako/PortalModeration.tsx).

### System Manager

Source: [SystemManager](https://nechakowatershed-portal.ca/definitions/portal/SystemManager.js?v=6268M).

| Source options | PGMaps coverage and remaining work | Status |
| --- | --- | --- |
| Server Variables → option/value grid, Save | No gateway route or native editor. Public client references do not authorize exposing secrets/configuration contents. | Source |
| Content Editor → select document, rich HTML, Put in Links; Save | Existing help/content inspection and reviewed local save for an existing document exist. Full editor semantics remain partial. | Partial |
| Content Editor → New Document → name/type/add to menu; Delete | No native content creation/deletion. | Source |
| Spatial Layers → Name, Type, Auto Add, Auto On, Base, Resource, Layers, Attributions; add/remove/save | This change adds structured registry inspection. Registry creation/edit/deletion remains source-owned. | Added / Partial |
| Status Flags → add/remove rows, Save | Read table added; definitions are not editable. | Added / Partial |
| Task Statuses → Name, ID, Colour, Description, Rank; add/remove/save | Read table added; workflow status policy writes absent. | Added / Partial |
| Priorities → description, start delay, duration, preferred start/end day; add/remove/save | Read table added; scheduling policy editor absent. | Added / Partial |
| Holidays → search, name, description, date; add/remove/save | Read table added. Holiday rows do not describe all weekend/nonbusiness-day server policy. | Added / Partial |

Implementation: [system inspector](../../src/maps/nechako/PortalAdminSystem.tsx), [resource renderer](../../src/maps/nechako/PortalAdminResource.tsx). The source registry lists services/catalogues, not necessarily individual datasets or local copies of GIS data.

## 7. Data coverage and privacy boundaries

The historical authenticated audit reported 31 forms, 13 schemas, 72 shared spatial layers, 37 registry entries, 19 saved projects, 77 accounts, five groups and 23 informational documents/templates. These are **October 12 observations** retained for scope, not current counts and not disjoint values to sum. The public bundle, search index, map projects, monitoring rows, file bytes and account inventory measure different things. See the [data audit](data-audit.md) for measured payload scope and original collection dates.

The adaptation should continue to distinguish these representations:

| Representation | Appropriate claim |
| --- | --- |
| Captured public submission index and selected public detail payloads | A dated public snapshot with its own manifest; not all live private/draft content. |
| Research/literature dataset | A separate collection with its own identifiers; no fabricated source submission/citation mapping. |
| Saved map JSON and retained unsupported sources | Original project definition plus explicit conversion scope; not a GIS/media archive. |
| One monitor association/page | Returned observations for that specific schema/layer/record; not a portal-wide record total. |
| Admin response in a signed-in session | Private per-session source data; never a new public snapshot or durable browser cache. |
| All Options directory | Navigation and honest support labels; not proof of implementation or successful source execution. |

### Gateway changes in this branch

The hosted worker previously hid administrator identity and excluded every `/admin/` read. The new contract exposes only a strict boolean role returned by successful source login, with `canWrite:false` and `readOnly:true`. It adds exact allowlisted reads for groups/members, user details and resource permissions, form access, shared-layer review/descriptors, spatial registry, content and administrator submissions. Monitor schema associations include explicit draft/disabled flags and are administrator-only.

`getUsers.php` also requires source-verified administrator access: the public client contract includes account names, email and flags, despite lacking `/admin/` in its path. No live account-directory response was fetched for this finding. Anonymous and nonadmin calls are blocked before an upstream request. The local gateway applies the same role boundary for these reads.

IDs are positive bounded integers; requested administrator lists use 1–500 rows, monitoring reads use 1–500 rows, params/modes are exact, and unknown paths/writes are rejected. Omitted pagination retains the source endpoint default and therefore does **not** establish complete retrieval. Responses are bounded and `no-store`; source cookies are not forwarded to the browser. Session changes/disconnect invalidate protected in-flight results. Username text, a client `isAdmin` flag, truthy strings and unrelated source payloads cannot grant the role.

This is a reviewed contract, not a declaration that every nonadmin endpoint is public. Existing submission/form/project/monitor reads still rely on source authorization for the current session and their endpoint-specific validation. Future reads need sensitivity review based on payload semantics, not the URL prefix alone. Server-variable reads are deliberately outside the gateway contract.

## 8. Remaining work in implementation order

| Work package | Why it remains and concrete completion evidence |
| --- | --- |
| Current authenticated acceptance and deployment | A valid authorized source account is required to verify new admin inspectors against real shapes. Deploy gateway capability changes together with UI; demonstrate anonymous denial, user/admin separation, logout cleanup and useful populated/empty/error states. A valid username/password cannot be inferred from public scripts. |
| Source search discovery | Extend the new captured form/year browser and field-ID pickers to verified live form/subtype discovery. Tests must preserve query meaning and source IDs, including form scoping and duplicate labels. The source subtype hierarchy requires its own verified data contract. |
| Native source layer pickers and materialization | Add schema/submission/shared-layer choices using verified descriptors and explicit layer-type support. Preserve temporary-source lifetime, permissions, ordering and original project JSON. |
| Complete form editing and ingestion | Define authoritative lifecycle, node validation, uploads/staging, duplicate handling, partial failure/recovery and finalization. Support parent/permissions/notifications/schedule/attachments/spatial/monitor nodes individually; avoid a generic proxy. |
| GPAP | Parse real note/form/media/track relationships and duplicate keys before claiming import. Compare draft results and attachments to source fixtures, then add bounded transactional writes. |
| Styling and layer queries | Model comparison/range/gradient rules, SLD library ownership/defaults and native layer query contracts explicitly. Validate rendering and round trips rather than forwarding arbitrary SQL or pretending an SLD URL is an upload. |
| Project GIS/SMASH bundles | Verify source package contents, source authorization, format metadata and completeness. Keep these separate from JSON workspace exports and source attachment ZIPs. |
| Administrative mutation packages | Separate account/identity, group CRUD, submission ACL, form/schema authoring, default styles and system policy/content CRUD. Each needs source permission checks, a concrete preview/diff, rollback/error semantics and focused acceptance evidence. |
| Full monitor extraction | Provide bounded incremental export only after verified page/total semantics, cancellation and source load limits. Never label one page as all records. |
| BOSS | Obtain the actual job/input/output/report contract and a known test case; verify permissions, cost/resource limits and results independently of local overlay tools. |

Framework integration should reuse the existing shared dialog, tabs, paginated/virtualized tables and chart primitives. Source transport, role capabilities, parsing and domain rules belong in adapters; reusable table/chart components should not know Nechako endpoint names. Use `isAdmin` for inspection and `canWrite` separately for an approved operation. Keep the source-owned advanced controls visibly discoverable with their exact menu paths while these work packages remain incomplete.

## 9. Verification record

The following were executed against fixtures for the gateway changes; they made no live source requests:

| Check | Result |
| --- | --- |
| `node --test scripts/nechako-worker/worker.test.mjs` | 22 passed; includes every admin read, anonymous/nonadmin denial, strict role values, contradictory failed-login rejection, unsupported/write route rejection, bounds, session isolation and in-flight logout suppression. |
| `python3 scripts/nechako-worker/check_hosted_gateway.py --self-test` | 10 passed; hosted read-only status contract accepts a verified boolean admin role and rejects contradictory write capability. |
| `python3 scripts/nechako-server/test_portal_gateway.py` | 24 passed; includes manager/account-directory authorization, other-session denial, disconnect, contradictory failed-login rejection, partial-login cookie cleanup and existing local write boundaries. This suite uses a temporary loopback server and mocked upstream. |
| `npx vitest run src/lib/nechakoConnection.test.ts` | 24 passed; includes verified hosted administrator propagation, no role inference from username/nonboolean values, no admin role without current capability, transition suppression, and both hosted write paths blocked. |
| `npx vitest run src/maps/nechako/data/formReportGraph.test.ts src/maps/nechako/data/submissionReview.test.ts` | 11 passed; numeric row/ID preservation, zero/missing/false distinction, original source statistics separate from row count, unsupported shape/unsafe numeric handling, and existing report exports. |
| `tests/e2e/nechako-source-forms.spec.ts` in Chromium | Two passed at 1440px and 390px using synthetic source responses. Table/Graphs switching, plotted-zero tooltip, excluded-value counts, source `results:7` versus four rows, original-value retention, ZIP/PDF exports and local draft review were exercised. |

UI, chart and map-export changes have their own focused checks recorded in the change summary. They are not a substitute for current authenticated acceptance. The public manifest can be reproduced by hashing the same public URLs; hashes naturally change when the source deploys a different build. This document does not certify a production deployment or a successful full admin walkthrough on October 21.

### Integrated application checks and visual evidence

The full focused Nechako Vitest run passed **191 tests across 26 files**, including connection, captured content, source-ID handling, administration, exports, geometry/workspaces and graph adapters. The TypeScript project build, scoped ESLint and production Vite build passed. The production build used the existing pinned toolkit and scraper submodules; no submodule revision or generated source dataset was changed.

Across the focused and existing regression suites, **41 distinct Chromium browser cases passed**: 14 submission-search/browser cases, seven hosted-administrator cases, two map-image cases, one options-navigation case, two source-report cases, four collection cases, two layer-record cases, three native-portal cases and six existing search/administration/session cases. Relevant views were exercised at both 1440px and 390px.

The administrator cases used a synthetic login and source-shaped fixtures, including anonymous/member denial, Forms, Schemas, dashboard tasks, catalogue paging, mobile system settings and session-reset cleanup. The map-image cases verified actual rendered-map pixels, PNG dimensions, stale-preview handling, unchanged map camera/geometry/source IDs, persistent canvas and no horizontal overflow. Existing regressions also verified map persistence, cross-tab logout and exact reviewed permission changes. The public submission/browser/field-selector tests use explicit captured fixtures; protected reads and downloads are synthetic, never real account records. These are the executed Nechako suites, not a claim that every repository end-to-end suite was run.

These screenshots show the development implementation, not a deployed or live authenticated source session:

- [Map composer](evidence/2026-10-21-map-composer-fixture.png) and [exported PNG](evidence/2026-10-21-map-export-fixture.png): real bundled watershed geometry, a solid test basemap, and a transparent WMS fixture. The empty fixture legend does not establish live service availability.
- [Desktop form and linked-schema inspection](evidence/2026-10-21-admin-forms-synthetic-desktop.png): all account and form responses are visibly synthetic.
- [Mobile system registry](evidence/2026-10-21-admin-system-synthetic-mobile.png): synthetic registry rows in the phone layout, with horizontal scrolling for the wide source table.
