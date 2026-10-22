# Nechako workbench completion and verification

> **October 21, 2026 update:** Use the [current portal option audit](2026-10-21-parity-audit.md) for implementation coverage, additions in the current change and remaining gaps. It supersedes the older gap classifications below where implementation has advanced. The October 11–12 observations, source counts and verification totals remain historical; they are not current deployment or authenticated-access evidence.

Updated October 12, 2026, America/Vancouver. “Implemented” means code in this PGMaps change, not a deployed portal feature. Actual public browser reads, synthetic interaction fixtures, format fixtures and isolated PHP tests are kept separate.

## Current proof of concept — October 12

The original backend/deployment is unavailable; the user requested completion using current interfaces as a proof of concept. This section supersedes historical registration-blocked statements below. The development gateway reproduces the verified source request/session lifecycle without modifying the original server. Actual reads and mocked mutations are distinct. No deployment or production backend parity is claimed.

| Requested area | Proof of concept delivered | Practical limit |
| --- | --- | --- |
| Search | Unified research/project/story/layer/import search; native submission search, nested visual expressions, contexts/areas and browser-saved queries. Results open a submission dialog. | Actual anonymous gateway query `nechako`: 419 results. Direct mode may fail registration. Research IDs are never treated as submission IDs. |
| Submission details | Source-defined dynamic form rendering, safe readable content/links, independent attachments, children/history/layers and record navigation. | Unsupported static/form nodes remain labelled; protected files follow original access. |
| Projects | Browser versions and exports; live source catalogue/history/defaults/shares/ownership; reviewed native save/rename/share/default adapters. | Native mutations verified with mocks only. Unsupported source/category serialization remains browser export. |
| Monitoring | Verified form/station/schema and Attributes record relationships; bounded live 500-row pages, page CSV/JSON and chart transfer with explicit daily-date format and timezone selection. | Layer 386/record 1 reports 25,933 records; page payload 197,276 bytes. Historical 77,799 count has a different scope. Full server storage unknown. |
| Reports | Original form/statistics field selection, labels, local presets, CSV/HTML/PDF/ZIP exports. | Live source definitions/statistics read; export rendering verified with fixtures. Not all legacy node types are supported. |
| Uploads | CSV/spatial schema mapping, quality checks and local draft review/export; explicit bounded CSV-to-source-draft adapter; GPAP table inventory. | Source writes mocked only. Spatial/GPAP multipart publishing and final approval/publication remain original workflows. |
| Styling | Typed vector categories, advertised WMS styles, existing HTTPS SLD references, source interleaving, queryable identify and default reads. | 130/131 WMS references convert; full SLD symbolizers and ordering within split vector geometries remain partial. Native SQL layer-query editing and shared-layer default writes remain source-owned. |
| Administration | Source dashboard/form/schema reads; reviewed existing permissions/groups, shared-layer approval/active state and help-content edits. | Mocked write contracts only; no deletion, password/identity mutations, scheduling or notification writes. |

Run locally with [the gateway instructions](server-runbook.md#local-portal-gateway-proof-of-concept). Temporary login was read-tested and disconnected. Current implementation tests did not mutate source data. The earlier native form audit allocated empty draft #1850; see [the audit](native-interface.md#authenticated-audit-october-12-2026).

Current integration gates passed: **119 focused unit tests** across 14 files; **22 desktop/phone browser cases** (14 native/workbench/collections/source-form/showcase cases, six search/admin/session cases, two layer-record/daily-chart cases); **16 offline gateway tests**; **12 snapshot validation/preservation tests**; TypeScript, scoped ESLint, production Vite build, deep-route generation, learning-package audit and 128-package index freshness. The final live walkthrough rendered submission 1477/form 39 values, layer 386's actual record sequence 1, and 500 observations of 25,933. Explicit DD/MM/YYYY + UTC produced 500 valid chart observations, zero rejected rows and zero duplicates in that loaded page. This checks parsing and that page's duplicate keys, not scientific validation of the full dataset. Temporary login was tested then disconnected; source write tests used mocks.

The retained baseline table below records the prior public-data delivery and historical dependency checks. Gateway and workflow capabilities above supersede its blocked-search/anonymous-only/handoff statements.

| Work item | Delivered | Remaining dependency / limit |
| --- | --- | --- |
| Native portal interface | `/dev/nechako/portal`: portal-style header/navigation, persistent map, collapsible tools/layers rails, local research search/map/timeline, project workspace windows, imports and monitoring; shared EchoScreen BC Freshwater Atlas Nechako polygon (8886), including styling, polygon search and workspace persistence | Existing 50-metre simplified boundary. React/MapLibre/shared toolkit; original portal still owns login, permissions and publishing. [Interface and display parity](native-interface.md#interface-and-display-parity). |
| Repository showcase | 52 public snapshot files / 7,513,926 bytes excluding manifest, with source URLs, bytes and hashes; research/catalogue, format registry, attachment links, derived workspace and nine saved-map definitions | External WMS/tiles and linked media remain live. Private projects/submissions and source GIS databases are absent. Historical October 11 subset was 42 files / 1,257,503 bytes. |
| Community projects | Search nine anonymously returned maps, read descriptions/raster images/source links, download original JSON, inspect retained/total layers and explicit omissions, then load supported workspace data | Definitions total 6,253,465 bytes; index 2,958 bytes. Conversion retains 130/131 WMS references (teacher resources 9/9): 19 native references resolve through verified MapServer metadata with safe existing HTTPS SLDs; one external WMS lacks a name. Every map skips two HTTP XYZ basemaps (18 total). Native cross-type source order is preserved; temporary references, full SLD symbolizers and GIS/media sizes remain limits. [October 12 check: 109 HTTP 200 PNG responses across eight teacher layers, CORS*](data-audit.md#native-mapserver-verification-october-12-2026). |
| Stories and learning | Native seven-chapter watershed learning adaptation, five place cases and 25 prompts; existing project viewer for supported imported PGMaps story/explorer packages | Adaptation is 16,765 bytes outside the showcase manifest. Original module linked; unsupported story formats remain escaped text/JSON review. |
| Imported collections | Browser-memory project/submission/story/document JSON, search/details/references, original-file downloads and collection type/ID round trip; state survives modal switches | 20 MiB/import, 50 MiB original JSON/session, 100 files, 10,000 records; bounded nesting/values. Large combined exports use individual originals. Reload clears imports. ZIP/HTML bundle import and publishing are absent. |
| Data size and options | Separate observed portal counts, measured bundle/import bytes and unverified declared link sizes; searchable native-view/original-menu directory | Full attachment/GIS/backend storage and total monitoring observations remain unknown. Directory links do not implement server-owned workflows. |
| Public portal map integration | 32-service catalogue, 135 advertised named entries, styles, legends, opacity/visibility/order, extent/camera, identify, attribution and scale | Source rendering: two EchoScreen names fail; full-extent Canvec contours time out. 132/135 original-extent PNG checks passed. |
| Public literature | All 1,408 records, including 365 unmapped; virtual browsing, search, dialogs and CSV | Canonical per-record citation URLs/DOIs absent upstream; no invented link to portal IDs. |
| Portal search | Native AST/context transport; extent/current-map/polygon limit; result table/CSV and resource selection | Live search remains blocked by registration. Successful responses/area semantics need verification after repair. |
| Submission resources | Metadata, spatial/linked layers, attachments, allowed users, history and children via native read-only endpoints; JSON export review | Anonymous only. Real permitted/denied payloads, schema form preview, canonical protected file downloads and logout isolation remain unverified. |
| Saved map workspaces | Versioned local JSON/browser save/restore; native project import and nine captured public definitions with camera/visibility, original retention and conversion warnings | Live saved/default API checks still blocked by registration. Native source interleaving and safe existing HTTPS SLD passthrough are implemented. Server workflow integration, permission-dependent native sources, temporary references, full SLD symbolizers and ordering within split vector geometries remain separate limits. |
| Native vector attributes | Wrapper GeoJSON/CRS plus the separate Attributes matrix; typed values, missing values and precision-safe bigint retention | Matrix mismatch is an explicit conversion warning; no guessed row association. Native source IDs and style metadata retained in original. |
| GIS formats | GeoJSON locally; bounded optional GDAL import/export for Shapefile, GML, GPX, KML/KMZ, SQLite/SpatiaLite and GeoPackage; separate layer review | Converter needs a production endpoint to work on deployed static PGMaps. Format limitations are explicit; styling/media stay in originals. |
| CRS / multi-layer data | WGS84, Web Mercator, BC Albers; GDAL CRS metadata/override; three-layer GeoPackage round trip | Unknown CRS is not guessed. Plain non-spatial database tables are not rendered as invented points. |
| Geometry and attributes | Point/line/polygon maps, map/table selection, paged attributes/CSV, local GeoJSON edits, drawing preview, measurement, undo; processing output layers | No portal edits/publishing. Exploratory spherical/geodesic measurements do not establish cadastral precision. |
| Geometry operations | Buffer; polygon union/intersection/difference; point/line/polygon clip; line split and topology-noded polygon split | GeometryCollection clip needs flattening. Topology and source precision should be checked with actual intended data; no universal GIS parity claim. |
| Monitoring | CSV/station/measurement/unit/time-zone matching, per-column zones, errors/missing/duplicate reports, presets, filters, paged table, dual-axis line/bar, CSV and statistics | Protected schema/record/submission API and source-side reporting/paging need authorized samples. Charts require one station and ≤10,000 filtered observations; exports retain all filtered rows. |
| Bibliographic import | All-column CSV preview, title/DOI mapping, repeated DOI review, draft-review/CSV export | Publishing/merge policy stays in portal. No automatic destructive deduplication. |
| GeoPaparazzi | Read-only table/column/row inventory and retained original | Field form/note/photo/track transformation and portal publishing require a real sample and validated mapping. |
| Attachments | Local raster image/PDF/audio/video preview and original download; GIS archive inventory; portal metadata read section | Protected retrieval, whitelist/size limits and Office/archive viewers remain portal responsibilities until verified. |
| Reports / administration | Local monitoring statistics; report-form availability checks; original portal handoff | Portal form/schema reports, approval, account/group permissions, project ownership/history/defaults, notifications/schedules remain in portal. This is intentional authority separation. |
| Payments / BOSS | October 12 administrator saw BOSS input/output/export/queue UI; options directory hands off to original | No execution, cost or processing-semantics test. Payment use remains unconfirmed. Earlier anonymous hidden-code observation is historical. |
| CORS | Actual deployed-origin public/CORS audit; tested candidate PHP include with exact allowlist, credentials, preflight and error headers | Candidate not applied remotely. Auth/session/CSRF and browser privacy acceptance require portal access; CORS does not repair registration. |
| Original portal embedding | Cross-site interface loads, but startup JSON contains PHP warnings and raises an ExtJS exception | Top-level startup succeeds; observed PHP session cookie is Lax, Secure=false, HttpOnly=false. Inspect frame/session handling; top-level portal link retained instead of adding an unreliable frame. |
| Portal registration / QGIS repair | Exact failure evidence, diagnosis steps and acceptance cases in runbook | No portal server source/config/database/QGIS access provided. Root cause and safe configuration change cannot be invented. |
| PGMaps hosting | Static entry-point generation for `/dev/nechako` and project deep routes, including literature route | Change must be deployed through PGMaps repository workflow; remote server behavior is not changed by a local build. |
| Regression checks | Focused TypeScript/unit/lint/browser/format/PHP checks and scoped GitHub Actions workflow | Synthetic fixtures do not prove protected production payloads. |

## Verification

October 12 implementation checks passed: **116 focused unit tests** across nine
files (including 21 tests using the actual anonymous project captures), **seven
browser scenarios** for desktop/phone navigation, imported collections, all
learning chapters and original project/image loading, and **12 offline snapshot
validation/preservation tests**. TypeScript, scoped lint, production Vite build,
learning-package audit, project-index freshness and generated deep-route entry
points passed. Manual browser review also rendered the original learning map's
live WMS layers and the Climate and Health embedded illustration. These checks
do not establish protected backend parity or deploy the changes remotely.

October 12 collection-parser verification adds **seven passing unit tests** for
original UTF-8/type/ID preservation, mixed wrappers, unsafe URLs, size conflicts,
native maps and bounded imports. New-view browser/build results belong to the
current integration checks; the counts below describe the previous completed
suite and must not be used as proof of protected or production access.

October 11 local results: **33 focused unit tests**, **11 browser tests** (native portal desktop/phone navigation and workspace persistence, workbench/showcase, XML parsing and real local GDAL browser import/export), **5 GDAL tests** covering 23 format/geometry round trips plus additional validation cases, **7 audit-script checks**, the then-42-file snapshot consistency check, and **5 isolated PHP CORS tests** passed. TypeScript, integration lint, the production Vite build, generated deep-route entry-point comparisons, and the existing Nechako package audit passed.

The completed local gates are recorded with their final results in the assessment evidence under `/workspace/nechako-assessment`. Commands:

```sh
npm run projects:echoscreen-data -- --watersheds-only
npx tsc -b
npx eslint src/maps/nechako src/pages/DevNechako.tsx src/pages/DevNechakoPortal.tsx src/lib/nechakoPortal.ts src/lib/nechakoPortal.test.ts src/types/nechako-turf.d.ts
npx vitest run src/lib/nechakoPortal.test.ts src/maps/nechako/data/nechakoData.test.ts src/maps/nechako/data/boundary.test.ts src/maps/project-explorer/adapters/filterResearchRecords.test.ts
python3 scripts/nechako-server/test_converter.py
python3 scripts/nechako-server/test_audit_data.py
python3 scripts/nechako-server/check_showcase.py
php -l scripts/nechako-server/cors.inc.php
python3 scripts/nechako-server/test_cors.py
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 npx playwright test tests/e2e/nechako.spec.ts tests/e2e/nechako-workflows.spec.ts tests/e2e/nechako-showcase.spec.ts tests/e2e/nechako-native-portal.spec.ts --workers=1
npx vite build
node scripts/write-spa-fallback.mjs
node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs public/data/projects/nechako-watershed-research-portal.json
```

Build prerequisites are the repository's pinned toolkit/JSON URL dependencies and existing committed data snapshots. The shared EchoScreen watershed asset is built from its pinned scraper shards before native page checks. The full scraper prebuild pipeline is not replaced by this verification. Browser tests require the local Vite and converter processes plus Chromium. PHP tests use a separate synthetic handler and never touch the live portal.

GDAL checks cover point/line/polygon round trips through GeoPackage, SQLite, SpatiaLite, GML, KML, KMZ and Shapefile, plus compatible GPX points/lines; a mixed three-layer GeoPackage reprojected from EPSG:3005; original media/entries in KMZ; malformed ZIP/XML rejection; and a synthetic GeoPaparazzi inventory. These demonstrate the implemented transport, not every possible portal-produced file or format-specific metadata/style.

Actual un-intercepted completion browser evidence: `completion-live.json` and corresponding desktop/mobile screenshots. The app console is clean; at 390 px the document width remains 390 px. Public map/identify, literature, contexts and formats work. Search/projects still return the genuine registration error; `getForms.php` remains empty anonymously. The earlier all-service/deployed-origin CORS and all-layer checks remain authoritative; synthetic route tests are not used as CORS evidence.

No portal account was used for the October 11 checks. The October 12 audit used
the user-authorized temporary account and documented the automatic draft side
effect above. Nine empty SOP files supply no procedures. No account/group/settings
or publishing changes were performed. See the [server runbook](server-runbook.md)
for remaining deployment and protected acceptance work.
