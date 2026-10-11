# Nechako workbench completion and verification

Updated October 11, 2026 UTC. “Implemented” means code in this PGMaps change, not a deployed portal feature. Actual public browser reads, synthetic interaction fixtures, format fixtures and isolated PHP tests are kept separate.

| Work item | Delivered | Remaining dependency / limit |
| --- | --- | --- |
| Repository showcase | Default dev entry; 42 public snapshot files with source URLs, byte counts and hashes; local research browsing/map/timeline, catalogue/capabilities, format registry, attachment-link list and downloadable location workspace; explicit refresh and offline consistency check | 1,257,503 bytes excluding manifest. WMS imagery/identify and basemap tiles stay live; no private projects, file bodies or source GIS databases. Original literature project remains live. |
| Public portal map integration | 32-service catalogue, 135 advertised named entries, styles, legends, opacity/visibility/order, extent/camera, identify, attribution and scale | Source rendering: two EchoScreen names fail; full-extent Canvec contours time out. 132/135 original-extent PNG checks passed. |
| Public literature | All 1,408 records, including 365 unmapped; virtual browsing, search, dialogs and CSV | Canonical per-record citation URLs/DOIs absent upstream; no invented link to portal IDs. |
| Portal search | Native AST/context transport; extent/current-map/polygon limit; result table/CSV and resource selection | Live search remains blocked by registration. Successful responses/area semantics need verification after repair. |
| Submission resources | Metadata, spatial/linked layers, attachments, allowed users, history and children via native read-only endpoints; JSON export review | Anonymous only. Real permitted/denied payloads, schema form preview, canonical protected file downloads and logout isolation remain unverified. |
| Saved map workspaces | Versioned local JSON and browser save/restore; native project import, camera/visibility/order, original retention and conversion warnings | Live saved/default projects blocked by registration. SLD/custom styles and exact cross-type interleaving are not reproduced; private native sources need authorized URL resolution. |
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
| Payments / BOSS | Documented evidence and state | Active use not confirmed; BOSS hidden in startup code. No invented implementation requirement. |
| CORS | Actual deployed-origin public/CORS audit; tested candidate PHP include with exact allowlist, credentials, preflight and error headers | Candidate not applied remotely. Auth/session/CSRF and browser privacy acceptance require portal access; CORS does not repair registration. |
| Original portal embedding | Cross-site interface loads, but startup JSON contains PHP warnings and raises an ExtJS exception | Top-level startup succeeds; observed PHP session cookie is Lax, Secure=false, HttpOnly=false. Inspect frame/session handling; top-level portal link retained instead of adding an unreliable frame. |
| Portal registration / QGIS repair | Exact failure evidence, diagnosis steps and acceptance cases in runbook | No portal server source/config/database/QGIS access provided. Root cause and safe configuration change cannot be invented. |
| PGMaps hosting | Static entry-point generation for `/dev/nechako` and project deep routes, including literature route | Change must be deployed through PGMaps repository workflow; remote server behavior is not changed by a local build. |
| Regression checks | Focused TypeScript/unit/lint/browser/format/PHP checks and scoped GitHub Actions workflow | Synthetic fixtures do not prove protected production payloads. |

## Verification

Final local results: **30 focused unit tests**, **8 browser tests** (desktop, phone, XML parsing and real local GDAL browser import/export), **5 GDAL tests** covering 23 format/geometry round trips plus additional validation cases, **7 audit-script checks**, the 42-file snapshot consistency check, and **5 isolated PHP CORS tests** passed. TypeScript, integration lint, the production Vite build, generated deep-route entry-point comparisons, and the existing Nechako package audit passed.

The completed local gates are recorded with their final results in the assessment evidence under `/workspace/nechako-assessment`. Commands:

```sh
npx tsc -b
npx eslint src/maps/nechako src/pages/DevNechako.tsx src/lib/nechakoPortal.ts src/lib/nechakoPortal.test.ts src/types/nechako-turf.d.ts
npx vitest run src/lib/nechakoPortal.test.ts src/maps/nechako/data/nechakoData.test.ts src/maps/project-explorer/adapters/filterResearchRecords.test.ts
python3 scripts/nechako-server/test_converter.py
python3 scripts/nechako-server/test_audit_data.py
python3 scripts/nechako-server/check_showcase.py
php -l scripts/nechako-server/cors.inc.php
python3 scripts/nechako-server/test_cors.py
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 npx playwright test tests/e2e/nechako.spec.ts tests/e2e/nechako-workflows.spec.ts tests/e2e/nechako-showcase.spec.ts --workers=1
npx vite build
node scripts/write-spa-fallback.mjs
node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs public/data/projects/nechako-watershed-research-portal.json
```

Build prerequisites are the repository's pinned toolkit/JSON URL dependencies and existing committed data snapshots. The full scraper prebuild pipeline is not replaced by this verification. Browser tests require the local Vite and converter processes plus Chromium. PHP tests use a separate synthetic handler and never touch the live portal.

GDAL checks cover point/line/polygon round trips through GeoPackage, SQLite, SpatiaLite, GML, KML, KMZ and Shapefile, plus compatible GPX points/lines; a mixed three-layer GeoPackage reprojected from EPSG:3005; original media/entries in KMZ; malformed ZIP/XML rejection; and a synthetic GeoPaparazzi inventory. These demonstrate the implemented transport, not every possible portal-produced file or format-specific metadata/style.

Actual un-intercepted completion browser evidence: `completion-live.json` and corresponding desktop/mobile screenshots. The app console is clean; at 390 px the document width remains 390 px. Public map/identify, literature, contexts and formats work. Search/projects still return the genuine registration error; `getForms.php` remains empty anonymously. The earlier all-service/deployed-origin CORS and all-layer checks remain authoritative; synthetic route tests are not used as CORS evidence.

No portal account from the supplied guide was used. The nine empty SOP files cannot supply procedures; no administrator/publishing/group changes were made. See the [server runbook](server-runbook.md) for the exact remaining deployment and protected acceptance work.
