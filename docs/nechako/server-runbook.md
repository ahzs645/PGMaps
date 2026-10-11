# Nechako server integration and maintenance

Reviewed October 11, 2026 UTC. The PGMaps changes and conversion service are local, reviewable implementation. No remote portal configuration, database, QGIS project, permission, deployment or account was changed. No portal server credentials or authenticated portal session were available. PGMaps GitHub access is available for preparing a reviewable pull request; the portal server has a separate access/deployment requirement. Example logins in the uploaded guide are documentary content and were not used.

## 1. Restore portal registration

The portal's own search, saved project listing and default project calls returned “Website is not registered”. HTTP 200 is not success: the JSON `error` and failure status must be checked. This also happened from PGMaps, so changing browser CORS will not resolve it.

On the portal server, inspect the REST bootstrap and registration/license lookup shared by `rest/portal/getSearchResults.php`, `rest/openmap/savedProjects.php` and `rest/openmap/getDefaultProject.php`. Check the configured canonical hostname and scheme, stored registration record, reverse-proxy forwarded host handling, configuration loading and server logs. Determine the actual cause before editing anything. The public client cannot establish the responsible database table, license key, config file or safe replacement value. Do not issue a guessed database update.

After repair, use the portal's own Search UI and project catalogue first. Verify an ordinary permitted user and a denied user. Then test the same anonymous form POST from the deployed PGMaps origin. Capture successful payloads for the new adapters; do not map nwsviz literature IDs onto portal submission IDs.

## 2. Correct browser CORS

Current live results: public GET and simple URL-encoded POST pass; `credentials: include` on wildcard PHP responses fails; `X-Requested-With` and JSON content-type preflights fail. WMS capabilities on all 32 services pass. OPTIONS handling, credentialed PHP access and registration are separate problems.

The candidate patch is [`cors.inc.php`](../../scripts/nechako-server/cors.inc.php). Include it **before** sessions, auth/registration checks and output in the shared REST bootstrap. Set `NECHAKO_ALLOWED_ORIGINS` to an audited comma-separated list of exact origins. Defaults are the bare portal origin and `https://pgmaps.ahmadjalil.com`; inventory other existing consumers before deployment. Add individual localhost origins only on development servers. Never use `*` with credentials or reflect an unvalidated Origin.

Remove old wildcard/duplicate CORS headers in PHP and the HTTP server. Confirm allowed-origin headers are present on errors too. OPTIONS must return 204 without invoking the business handler, session or registration. Reject preflight methods/headers outside the declared set. Preserve `Vary: Origin` through proxies and caches.

Continue using URL-encoded form bodies: permitting the `Content-Type` header does not make PHP `$_POST` parse JSON. If JSON is desired, migrate endpoint body parsing and validate both transports explicitly.

CORS is not authentication or CSRF protection. Before enabling private requests, verify real per-user sessions, existing CSRF protection on mutations, server-side permission checks and logout/expiry. Cross-site cookies require deliberate Secure/SameSite handling and can still be blocked by browser privacy settings. A same-origin per-user backend session exchange may be preferable. Do not proxy a shared administrator cookie or put credentials in frontend files. This workbench deliberately keeps anonymous reads; a protected adapter must be validated before enabling it.

Acceptance browser cases from the actual deployed PGMaps origin, without route interception or disabled security:

- Public GET and existing form POST succeed.
- Allowed credentialed reads return exact allowed Origin and `Access-Control-Allow-Credentials: true`; a denied user remains denied.
- `X-Requested-With` OPTIONS returns 204 with the allowed header/method; the subsequent read succeeds.
- An unapproved Origin and unsupported preflight header/method are rejected.
- Registration/permission errors remain visible JSON errors with correct CORS headers.
- Login, expiry, logout and a second user's isolation are verified. JSON request bodies remain a separate acceptance check.

## 3. Repair QGIS sources

Two EchoScreen layers advertised by capabilities return `LayerNotDefined` for GetMap: `Cancer rank - Sensitive Population` and `COPD rank - Sensitive Population`. In the corresponding `.qgs` project, check the published WMS layer names, short names, grouping and duplicate names against capabilities and server logs. Reload the project/cache and verify the **exact advertised name** at regional and full extents. Do not mask failures by replacing source names in PGMaps without correcting capabilities.

`contours_bcBdy` in Canvec timed out twice at its advertised extent, but returned a PNG at watershed scale. Review data extent/CRS, scale visibility, source indexes and rendering cost. A PNG response alone does not prove visible coverage. Use the saved evidence and inspect pixels/coverage after repair. Blank responses on other layers may be legitimate scale/coverage choices; diagnose before declaring missing data.

Evidence lives under `/workspace/nechako-assessment`: `render-failure-rechecks.json`, `workbench-all-layer-images.json`, capability XML and inventories. The assessment document records the observed counts and limits.

## 4. Run GIS conversion locally

Install GDAL (`ogrinfo` and `ogr2ogr`) and Python 3. No third-party Python packages are needed.

```sh
python3 scripts/nechako-server/converter.py
npx vite --host 127.0.0.1 --port 42173 --strictPort
```

Vite proxies `/api/nechako` to the loopback service on port 42174. GeoJSON import/export needs no server. Other GIS imports and exports show an explicit unavailable-service error if the service is absent. Uploaded files are held in temporary directories and deleted after each operation; originals remain in the browser. The service accepts files, not remote URLs or portal credentials.

Limits: 20 MB source files combined, 16 sidecars, 200 archive entries, 60 MB expanded archive, 50 dataset layers, 100,000 features per layer, 30 MB converted output, 45 seconds per GDAL subprocess and 180 seconds browser deadline. Archive traversal, symlinks, duplicate basenames and XML document types/entities are rejected. Driver conversions can lose styling or target-format fields; retain original files. Shapefile mixed geometry or incompatible GPX polygons can fail explicitly; separate homogeneous layers before export.

The Python HTTP server is **development only**. Production needs a same-origin authenticated/rate-limited job endpoint backed by isolated GDAL workers, OS memory/CPU/time/process limits, bounded job concurrency, blocked worker outbound networking, accepted driver review, private temporary storage and logs that exclude uploaded contents. Do not expose the loopback dev server with permissive CORS. No production converter deployment was attempted here.

GeoPaparazzi currently supports read-only table inventory, not verified form/photo/station publishing. SQLite or GeoPackage tables without spatial registration/CRS must be treated as tables or supplied a known source CRS, never silently interpreted as WGS84 vectors.

## 5. Deploy PGMaps and verify deep routes

Build the existing toolkit and JSON URL dependency, then run TypeScript/Vite and the existing `scripts/write-spa-fallback.mjs`. Preserve project data/submodule pins. Deploy through the host's existing process. Configure history fallback to `index.html` for app routes while leaving missing assets/API paths as real 404s. The deployed literature deep link returned HTTP 404 even though client navigation worked; the host must actually apply the fallback.

Verify direct visits and refresh on `/dev/nechako?view=files`, `/dev/nechako?view=monitoring` and `/dev/projects/nechako-watershed-research-portal`. Verify HTTPS, mobile layout, no console exceptions, source attribution, portal links, public reads and the converter's explicit availability state. The local production bundle does not prove remote deployment.

## 6. Protected workflow acceptance

Portal remains authoritative for users/groups, forms, schemas, draft/publish/approval, project sharing/defaults/history, notifications, schedules and relationship nodes. Open the portal for those workflows. No account/group synchronization or write API is enabled in PGMaps.

Before claiming parity, use authorized, redacted samples and at least two permission scopes to validate:

- Submission metadata, schema-driven preview, attachments/downloads, spatial and linked layers, child submissions and history. New resource reads preserve errors and raw payloads, but do not reconstruct arbitrary portal forms.
- Search result columns and IDs, Boolean/field and geographic results. Area payload uses the public client's GeoJSON contract; live results are blocked pending registration.
- Native saved project payloads, scale/camera, source URL resolution, SLD/custom style subset and exact cross-type layer order. Local conversion retains the original and warns about unsupported source/style/order behavior.
- Monitoring schema/record/submission relationships, pagination, units, timestamps/time zones and duplicate/missing values. Local CSV matching, line/bar dual-axis charts, paged tables, exports and statistics are implemented; protected monitor transport still needs samples.
- Zotero draft mapping with canonical citation identifiers and duplicate policy; local review does not publish. GeoPaparazzi field forms, images and tracks need a real validated sample.
- Report form/schema definitions, source-side statistical scope and saved report permissions; local CSV statistics are not equivalent to all portal reports.

The uploaded archive contains nine zero-byte SOP files and an annual-update DOCX with no extractable instructions. Their original procedures cannot be recovered from that archive. Use the completed assessment and this runbook as draft operational guidance; obtain the originals before representing them as authoritative SOPs. Payment/BOSS modules are not confirmed active requirements; BOSS was hidden in startup code.
