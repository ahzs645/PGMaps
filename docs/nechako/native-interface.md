# Native watershed portal preview

> **October 21, 2026 update:** The [current portal option audit](2026-10-21-parity-audit.md) supersedes implementation-gap and handoff statements below where native workflows have since been added, including submission search and administrator inspection. The dated interface observations and counts are retained as historical evidence. The current source sign-in attempt was rejected; the October 12 administrator session and its private responses were not reverified. Current gateway inspection and write boundaries are documented in the [hosted connection runbook](hosted-gateway.md).

The [authenticated audit below](#authenticated-audit-october-12-2026) supersedes
the earlier assumption that search is broken on both sites: original-portal
search works; PGMaps requests still receive the registration error.

Open `/dev/nechako/portal` from **Dev library → Nechako portal → Portal interface**,
or use **Open portal interface** in the existing workbench. The route has its own
static build entry point and runs on the PGMaps React/MapLibre/shared-toolkit stack.
It does not embed or load the original ExtJS/OpenLayers application.

The teal header, centred navigation, map canvas, collapsible Map Tools and Map
rails, and coordinate footer follow the original portal's map-centred interface.
The PGMaps navigation remains available. Rails become overlays on phones; their
contents scroll independently and keep the same controls mounted across collapse.

## Available workflows

- The initial map uses the bundled 46-location research workspace and EchoScreen's
  existing **BC Freshwater Atlas Nechako polygon**, selected by `namedWatershedId`
  **8886**. It uses the same cyan outline, 14% fill and 2.2-pixel line, and fits
  the polygon extent. Only Nechako is selected from the shared Fraser/Nechako
  file; geometry and properties are retained. This is the existing **50-metre
  topology-preserved simplification**, not full-resolution source geometry.
  Location markers are reference points, not study footprints.
- **Map Tools** reuses the existing WMS catalogue/style selector, local vector
  drawing, geometry processing, attributes and export controls. **Map** contains
  layer order, opacity, visibility, extents, legends and identify selection/results.
  Clicking a local vector reveals its tools; identify results reveal the Map rail.
- **Search** defaults to all 1,408 bundled research records, including unmapped
  records. Its second tab uses the existing live portal submission search, including
  context expressions and current-map or local-polygon geographic limits.
- **Projects** opens the existing JSON import/export and browser save/restore
  workflow. The workspace includes camera, WMS layers/styles, local vector layers,
  warnings and retained original portal project data where supplied.
- **Community projects** searches nine actual anonymously accessible saved-map
  definitions, captured October 12. Open a project to read its description, raster
  images and source links, download the original JSON, inspect conversion notes,
  or load its supported map layers. The administrator saw 19 projects; those
  additional records are not public payloads in this bundle.
- **Stories** opens the native watershed learning adaptation inside the preview:
  seven chapters, five place cases and 25 discussion prompts. The complete original
  module remains linked. Imported supported PGMaps story/explorer packages open
  in the existing project viewer; other story/document exports remain readable
  as escaped text, metadata, source references and original JSON.
- **Collections** imports project, submission, story and document JSON into a
  browser-memory collection. Imports survive closing or switching preview windows;
  export before reloading. Original JSON, source IDs and chosen import types are
  retained. The reader reports exact imported bytes separately from unverified
  declared linked-file sizes; it never treats a missing file size as zero.
- **Data size** separates observed portal entity counts, measured bundled files
  and current browser imports. It does not estimate unknown attachment/GIS storage
  or equate monitoring observations with submissions.
- **All options** searches the capability directory and opens the relevant native
  view or gives the original portal's menu path for publishing, administration,
  schema matching, SLD, BOSS and other source-owned workflows.
- **Import** opens the existing GIS/file conversion and preview component. Adding
  a converted vector closes the window and retains the current map layers.
- **Reports** opens local monitoring CSV matching, validation, charts and exports.
- **Research map** opens the existing bundled research explorer and timeline in
  a window. Its optional Nechako River boundary toggle reads the same shared
  polygon. Returning to **Watershed map** preserves the underlying map workspace.
- **Links** provides the original site, data/source attribution, the comparison,
  and existing saved-project checks. **Login / Sign-up** links to the original
  portal's account flow.

Search, report and project windows leave the primary map mounted. Panel names are
reflected in the `panel` query parameter so direct links and browser Back work.
Escape closes a focused native window immediately; a nested research record
dialog handles its own Escape and leaves the search window open. Browser reload
checks wait for the close and URL update to complete.
Local edits are transient until saved or exported; closing an import/report/search
window discards that window's unsaved form settings, while the map workspace remains.
Collection JSON remains in the parent page's memory across window changes and is
cleared on reload. It is not published or stored in localStorage.

## Sources and limits

The preview reads research JSON, service definitions and capabilities from the
app-owned `public/data/nechako-showcase` snapshot captured October 11, 2026, expanded
with nine anonymous saved-project definitions on October 12. The manifest now
measures **52 files / 7,513,926 bytes**, excluding itself. The nine map definitions
account for **6,253,465 bytes** and their index for **2,958 bytes**. Embedded raster
description images are included in these JSON bytes; external imagery, source GIS
and linked media are not. The **16,765-byte** native learning package lives under
`public/data/projects` outside that manifest. WMS
images, legends and identify responses and the basemap use live HTTPS sources.
The boundary is the generated local asset already used by
`/projects/echoscreen-climate-health`; it is not duplicated in the showcase.
The scraper submodule owns its source shards. Standard data sync builds the shared
asset; `npm run projects:echoscreen-data -- --watersheds-only` builds just the
watershed asset for isolated preview/browser checks. Workspace export/restore
preserves the selected polygon, styling and provenance. Submission search can use
it as the polygon geographic limit; genuine server-side filtering still requires
repairing the portal registration failure.
Anonymous reads use the existing portal transport; no new proxy, authentication,
publishing or administrative endpoint is introduced.

The original portal owns account registration, permissions and publishing. PGMaps
live submission search and saved/default-project API checks still encounter the
registration failure. Locally captured public maps work independently of that
bridge. Protected projects, form-rendered submissions, attachments and server
save/share/default/history workflows have not been migrated.
See [completion matrix](completion-matrix.md) and [data audit](data-audit.md).

Public map conversion is partial: each of the nine maps contains two unsupported
HTTP XYZ basemaps (**18 total**). Of 131 WMS references, **130 convert
structurally**: 19 native references resolve through the verified original
MapServer prefix and supplied mapfile/mapfileName, with safe existing HTTPS
portal SLD references. One external WMS lacks a layer name.
Koh_Wetlands_Teacher_Resources converts **all nine WMS references**. Native
cross-type source order is preserved by the interleaved renderer; full SLD
symbolizers and ordering within split vector geometries remain partial.
Temporary native mapfile/SLD references may expire. A fresh October 12 anonymous
original-interface load of project 10 returned **109 HTTP 200 PNG tiles across
eight native teacher layers**, with `Access-Control-Allow-Origin: *`; this is
scoped delivery evidence, not verification of every project service. See the
[native MapServer audit](data-audit.md#native-mapserver-verification-october-12-2026). The reader reports retained/total layers and individual omissions
before loading, and preserves the complete original JSON. A converted reference
still depends on its service; structural conversion is not proof of live imagery.

JSON collections allow 20 MiB per file, 50 MiB of original JSON per page session,
100 files and 10,000 records, with explicit depth/value limits. Collections too
large for the 20 MiB combined export boundary retain individual original downloads.
ZIP project bundles and HTML import are unsupported. HTTPS references open at
their sources; native download endpoint references retain the original authorized
workflow. Imported markup is never injected as HTML.

## Interface and display parity

Working PGMaps controls do not establish exact parity with every original portal
tool or protected payload. The current comparison is:

| Area | PGMaps behavior | Remaining difference |
| --- | --- | --- |
| Sidebars | Both edge rails expand, collapse and scroll; close/Escape restores focus; map and tool state remain mounted | Desktop panes and phone overlays use PGMaps responsive sizing rather than ExtJS layout internals |
| Layer tools | Catalogue, advertised WMS styles, opacity, visibility, ordering, zoom, legends and click identify | Native cross-type source order and existing HTTPS SLD passthrough are implemented. Permission-dependent sources, temporary references, full SLD symbolizers and ordering within split vector geometries remain limits |
| WMS display | GetMap and legends use the original service, layer and advertised style, preserving server symbology | MapLibre basemap, projection/zoom and labels can differ; upstream broken layers remain broken |
| Local vector selection | A map click opens Map Tools at the selected layer/feature, with original properties, measurements and exports | PGMaps attributes panel replaces the portal's popup/style editor; no promise of identical popup formatting or custom symbol rules |
| Research details | All 1,408 records are searchable, with title, author, year, type, tags and location IDs in PGMaps record dialogs | This is nwsviz literature, not the portal submission catalogue; absent citation/file links cannot be reconstructed |
| Search/projects windows | Open/close/Back preserves the main map; nine captured public saved maps expose original metadata, supported layers and explicit omissions; local workspace JSON/browser saves work | Public conversion retains 130/131 WMS references (teacher resources 9/9); 18 HTTP XYZ basemaps are omitted. Temporary references may expire. Native source order is preserved; full native symbolizers, private projects and server ownership remain separate limits |
| Stories and community collections | Native seven-chapter learning adaptation; public project descriptions/images/links; supported imported story/explorer viewers and browser-memory JSON collections | The learning story is an adaptation. Unsupported story structures are retained for review; no automatic migration of private content or linked media |
| Data size and options | Measured snapshot/import bytes, separately labeled entity counts and a searchable capability directory | Backend storage and media sizes remain unknown; a menu handoff does not implement the source workflow |
| Imports/drawing/processing | Local GeoJSON and optional GDAL formats, drawing, attributes, edits, undo, exports and implemented geometry operations | Converter must be deployed for non-GeoJSON imports; original format-specific styles/media remain in retained files |
| Reports/popups | Local monitoring CSV charts/statistics; read-only submission resource panels and account handoff | Portal form/schema reports, attachment downloads, publication, login/session and administrator tools are not reproduced |

See the completion matrix for data-type limits and the original assessment for
the full portal feature inventory. Unavailable protected flows are not marked as
tested merely because their controls open.

## Verification

`tests/e2e/nechako-native-portal.spec.ts` exercises desktop and phone navigation,
local snapshot boot, WMS/identify fixtures, unmapped research and registration
failure, GIS import into the persistent map, workspace exports, browser restore,
the embedded research timeline and boundary toggle, account hand-off, and failed-boundary retry.
It checks exact shared-source geometry in workspace exports and polygon-search
requests, so a Fraser polygon or an approximate outline cannot pass.
The earlier local suite passed 11 browser workflows and 33 focused unit tests, with
TypeScript, scoped lint, production build, the static subpage entry and existing
project package audit also passing. Fixture reads verify interface integration; they do not establish live CORS.
The existing workbench suites remain the regression checks for reused components.
The October 12 collection parser additionally passes seven focused tests covering
lossless originals/types/IDs, mixed lists, unsafe links, byte-size conflicts and
bounded malformed imports. This does not establish private-resource access or
production deployment of the new views.

## Authenticated audit: October 12, 2026

Compared the real [original interface](https://nechakowatershed-portal.ca/) with
the deployed [PGMaps preview](https://pgmaps.ahmadjalil.com/dev/nechako/portal/),
first anonymously and then using the user-authorized temporary administrator
account. Three parallel reviewers inspected reference guides, forms/schemas and
uploaders, and administration. Credentials, server secrets and account contact
details are deliberately absent from the audit artifacts.

This was interface exploration, not a migration or upload test. Existing records,
configuration dialogs, source projects and reports were inspected. No uploads,
publication, settings changes or permission changes were performed. However,
opening a new literature form **automatically persisted empty draft #1850**:
the Submission Manager confirmed its blank name and DRAFT state after closing,
without content entry, Save, Hold as Draft or Submit. It remains intact. This
side effect means opening a new form is not a read-only preview operation.

### Actual connection behavior

- Original anonymous search for `nechako` returned **419 submissions**.
- The same query through PGMaps's **Search → Portal submissions** returned
  **Website is not registered**. This is a returned portal error, not evidence
  that the original portal cannot search. The origin/request registration
  contract needs diagnosis; this audit did not establish its root cause.
- PGMaps's saved-project and default-project checks returned **Website not
  registered**; its report-form check returned an empty array. The authenticated
  original exposes projects and 31 form choices.
- PGMaps Search defaults to 1,408 research records from nwsviz. These are a
  different collection with different identifiers. The submission search UI,
  expression parser, contexts, result table and CSV code already exist, but
  their live integration cannot be counted as working parity.

Evidence: [catalogue screenshot](evidence/2026-10-12-catalogue.jpg),
[PGMaps project errors](evidence/2026-10-12-pgmaps-project-errors.jpg),
[BOSS interface](evidence/2026-10-12-boss.jpg) and
[sanitized inventory](evidence/2026-10-12-authenticated-audit.json).

### How much information exists

These counts measure different things and must not be added together.

| Inventory | Observed amount | Meaning / qualification |
| --- | ---: | --- |
| Searchable submissions | 1,585 | Original search `{Submission ID} >= 0`; drafts are also present separately in Submission Manager, so this is not a complete database total. The new empty draft did not increase this search count. |
| Literature title matches | 1,411 | Title-only search for `resources_&_literature`; not an identity reconciliation with the 1,408 nwsviz records. |
| Map title matches | 21 | Title-only search `map`; displayed rows identify the map form, including static maps, sampling maps, wildfire time series and a temperature animation. |
| Saved map projects | 19 | Current Project grid, including test projects; distinct from map-form submissions. |
| Form definitions | 31 | Current Form Manager and authenticated report selector. Some are test/draft or near-duplicate variants. |
| Schemas | 13 | Eight Spatial and five Monitor. |
| One ERA5 monitoring table | 77,799 observations | Upper_Nechako, layer 386, linked submission 1477; 500 rows/page, 156 pages. First visible date 1950-01-01. This is nested tabular data, not 77,799 submissions. |
| Shared spatial layers | 72 | Distinct IDs across buffered grid scroll to end; collected rows marked Active and Vetted. |
| System spatial registry | 37 entries | 30 capabilities catalogs, four direct WMS, two XYZ and one OSM. Catalogs expand into sublayers. |
| PGMaps WMS showcase | 32 services / 135 named entries | Existing October 11 snapshot, not a fresh underlying-dataset count. This is a different inventory from the registry or shared-layer table. |
| Accounts / groups | 77 / 5 | Accounts verified across buffered grid scroll to end. Group sizes overlap and cannot be summed. Largest group: 65 members. |
| Informational documents/templates | 23 | Welcome, learning/help, terms and email content; sampled permission/schedule help contains placeholders. |

Other title-only search matches: `nechako_projects` 8; `ERA5_daily_data` 2;
`NHG_Stations_2019-24` 1; `water_temp_stations_data_form` 41;
`air_temp_stations_data_form` 1; `archival_photo` 3; `photo_or_video` 7;
`event_or_activity` 5. These are search inventories, not disjoint totals. A query
containing unquoted leading hyphens failed parsing and was excluded.

Attachment bytes, all monitoring-table row totals, GIS source file sizes and the
full database size remain unknown. A map service's capabilities describe layers;
they do not expose a bulk copy of its source GIS database.

### Missing or incomplete PGMaps workflows

| Priority | Original workflow | PGMaps gap |
| --- | --- | --- |
| First | Keyword/context submission search with actual results | Repair registration/request integration and distinguish this from the default literature collection. |
| First | Expression Builder and Simple Expression Builder | PGMaps accepts typed expressions but lacks visual nested AND/OR rules, form-subtype/content-field builders and saved-query load/save. |
| First | Submission Preview, General, Spatial Data, Attachments, Children, History and Export | Existing PGMaps resource panels are anonymous reads; schema-rendered records, related-resource navigation and authenticated download/edit access are incomplete. |
| First | Literature DOI, ISBN, ISSN, URL, archived URL and rich notes | Form fields exist in the original; the nwsviz snapshot does not provide these canonical citation/file links. Import actual field values rather than constructing them from unrelated record IDs. |
| First | Existing saved projects with native sources, camera and styles | Local workspace JSON/browser saves exist; server load/save/share/default/history and protected sources need integration. An existing Koh_2022 project loaded and exposed saikuz, vanderhoof and track1 alongside contextual WMS/basemaps. |
| Next | Station-linked monitoring tables and charts | PGMaps can review local CSV; it does not reproduce the schema → spatial station → monitoring submission relationships or server paging. |
| Next | Form-driven Reporting and Statistics | Original has form/field selection, labels, presets, table/graph views and exports. PGMaps Reports opens local monitoring CSV. A generation request completed with no labels supplied and an empty table; report completeness was not established. |
| Next | Native submission exports | Original offers PDF, website/HTML, CSV and attachment/spatial ZIP. PGMaps resource JSON/local CSV exports are not equivalent. Export controls were inspected; generated downloads were not comprehensively tested. |
| Next | Native layer query/style/share controls | Local attributes, drawing and seven geometry operations already exist. Original adds layer Query, share requests, Single/Categorized styles, SLD upload/load/download/save and native shared-layer defaults. Arbitrary SLD parity is absent. |
| Next | Bulk CSV, GPAP and schema-matched spatial ingestion | PGMaps's local GIS/bibliographic preview does not create authoritative portal drafts or publish submissions. GPAP support is currently inventory only. |
| Optional integration | Admin moderation, users/groups, informational content and workflow dashboard | Currently handed off to original. These require a conscious ownership decision, not merely new menu buttons. |
| Investigate | BOSS processing tool | Unlike the earlier anonymous audit, a BOSS button and functioning input/output/export/queue UI are visible to this administrator. Execution, processing semantics, costs and intended Nechako use were not tested. |

PGMaps already has WMS discovery/rendering, legends, opacity/order, click identify,
research search/timeline, local workspaces, GIS conversion hooks, drawing,
attributes and geometry operations. Those should not be presented as missing.
Its map tools group functions differently from the original. The source also
has Select By Area/Extent; PGMaps already exposes extent and polygon limits,
although actual server filtering remains unverified through the failing adapter.

### Original data-ingestion pipelines

Reference sources are the March 2025 **Guides/Data Manager.docx** and seven-page
**Guides/How to Load a Project.pdf**, under the user-supplied local folder
`/Users/ahmadjalil/Downloads/OneDrive_1_10-10-2026`. The PDF depicts older Build
6123; current UI is Version 3 Build 6268M. Treat guide claims separately from
tested current behavior.

**Literature / other bulk CSV:** export selected Zotero items as CSV → open the
target form's Bulk Loader → select the documented Zotero Bulk Load match preset
→ upload and match columns → create drafts → review and publish. The live initial
loader accepts CSV with comma, semicolon, colon, pipe, tab or a custom delimiter.
Later matching/import stages require an actual upload and were not exercised.
Preserve Zotero/source identifiers, all columns, mappings, form membership,
permissions and draft/published state. Duplicate/merge/rollback semantics remain
unknown.

**Monitoring:** create/select a Monitor schema → link a spatial form with a
spatial-layers node and a monitoring form with a monitoring node to the same
schema → create a spatial submission → Upload and Match to Schema (the SOP
typically selects ADD NEW ATTRIBUTE) → submit the spatial record → create the
monitoring submission → select its spatial/station row → upload CSV → match
schema fields → View/review → submit. Schema/station/submission IDs and joins
are essential migration data. A loose CSV copied into a chart cannot preserve
this relational structure by itself.

**Spatial submissions / shared layers:** the existing submission editor offers
Upload, Upload and Match to Schema, Draw Layer and Add From Map. Existing layers
can be linked; parent submissions and Copy Parent Permissions are supported.
Shareable Manager separately exposes Add To Map, Grant, Retract and Toggle Active,
plus default SLD editing/copying/upload. Inspecting the controls does not prove
approval enforcement or upload validation.

**External WMS / QGIS cartography:** System Manager → Spatial Layers → Add Layer
→ choose WMS/source type and URL → configure Auto Add, Auto On and Base → save.
For custom cartography, prepare the QGIS project and data with final symbology;
a server administrator uploads the project/dependencies to the server map
directory, then registers the hosted WMS. This is a server publication workflow,
separate from browser GIS import. Copying WMS URLs does not copy source datasets,
QGIS projects or provider dependencies.

**GeoPaparazzi:** live GPAP loader shows Choose File → Match Forms → Match Fields
→ Select Records to Submit; Upload and Upload and Match to Form are available.
Duplicate Protection defaults off. Field notes, forms, media and tracks require
validated mappings; this audit did not supply or upload a GPAP sample.

**Individual form entry:** choose a form → opening it already creates a draft →
enter content/add files/layers/monitoring → review permissions and parent links →
Hold as Draft or Submit Form. Delete Submission is available but was not used.
Do not use the New Submission path merely to preview a form during an audit.

### Administration and original limitations

- Forms have reusable Parent Submission, Content, Permissions, Attachments,
  Shapefiles, Email Notification, Payment, Scheduling, Linkable Layers and
  Monitoring elements. Payment's presence in the form editor does not establish
  active payment use. Form settings include schema rank, visibility, edit rights
  and email templates.
- The SOP says a form with submissions cannot have its structure modified;
  structural changes need a new form. This is a guide claim, not tested
  enforcement. Current form names contain multiple test/draft/near-duplicate
  variants and no version metadata was demonstrated.
- Schema creation offers Spatial/Monitor types; point/linestring/polygon
  geometry; String, Real Number, Integer, Timestamp and Timestamp With Time Zone
  fields; and Linked To. Other geometry/field types were not offered in that
  dialog; that does not prove universal system rejection.
- SOP activation is manual: User Manager → inactive account → activate → Match
  Permissions from a template → maintain group membership. Current manager also
  offers Use Portal As User and BOSS Permission. Detailed user-edit validation
  was not verified; an Edit User action timed out.
- The SOP's “public” project workflow shares View access with **All Nechako
  Users**. This is registered-group access, not proof of anonymous public access.
- Configured values: EPSG:3005 default; five daily GeoPackage-tool uploads;
  forty project-history records; self-registration enabled; email disabled;
  weekends configured as nonbusiness days. Quota/scheduling enforcement was not
  tested, and the GeoPackage quota must not be generalized to all upload types.
- Dashboard has notifications, a calendar and selected-day tasks. Sample account
  showed zero notifications/no tasks for today; this does not prove no tasks
  exist elsewhere. Task Statuses and Holidays lists appeared empty; three
  priority levels exist. System Manager has content/status/task/priority/holiday
  configuration and server variables.
- Original exports and lists use buffered/paged UI. Counts must be based on
  result totals or distinct IDs collected through the end, not first-screen rows.
- Maximum bytes/features, full accepted spatial-format list, CRS transformations,
  key matching, time-zone/unit/null conventions, duplicate behavior, rollback,
  throughput and session isolation still need controlled sample tests.
- PGMaps's GIS import displays a separate 20 MB combined limit and an optional
  GDAL converter requirement. Neither is an established original-portal limit.
- Eight supplied SOP DOCX files are zero bytes; Annual updates.docx is a valid
  document with an empty body. Only two of eleven references contain procedures.
  No source GIS files, monitoring samples or project/data exports were supplied.

### What to bring over and in what order

October 12 implementation now brings over the nine proven anonymous map
definitions, a native adaptation of the public learning module, and browser-only
review of authorized exports. The source's other ten administrator-visible maps,
private submissions and file bodies remain outside the public snapshot. The
read/session bridge and workflows below still require source integration.

1. Fix the read/session/registration contract and reconcile actual source IDs.
   Keep portal submissions, nwsviz research records, projects, spatial layers and
   monitoring observations as distinct entities.
2. Expose real submission search, form-rendered details, citation links,
   attachments and related layers/children with source permissions intact.
3. Import/load native saved projects and approved shared layers, reporting
   unsupported source/style features explicitly. Retain original project data.
4. Integrate monitor schemas/stations/observations with paging, timestamps/units
   and full-resolution exports; inventory every table before estimating volume.
5. Reproduce CSV/schema/GPAP matching and draft review only after controlled
   sample uploads establish duplicates, validation and recovery behavior.
6. Decide which administration, publishing and QGIS hosting remain authoritative
   in the original portal. A static public snapshot cannot carry protected files,
   membership, live approvals or server processing safely by assumption.

Bulk migration still requires native project bundles, monitoring/spatial schema
exports, attachments with sizes and access metadata, QGIS projects/dependencies,
and per-resource permission rules. Administrator visibility alone is not
authorization to publish those resources anonymously.
