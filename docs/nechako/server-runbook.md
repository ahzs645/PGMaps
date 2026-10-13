# Nechako server integration and maintenance

Updated October 12, 2026, America/Vancouver. The user requested a proof of concept because the original backend source/deployment is unavailable. The PGMaps interface supports static publication through GitHub Pages. Its two Python services remain loopback-only. A separately deployed read-only Cloudflare gateway now supplies temporary per-tab source access for the hosted frontend; see [the hosted connection runbook](hosted-gateway.md). The authorized temporary account was used for interface inspection and a gateway login/read/logout check, then disconnected. Current implementation verification did not execute source save, upload, permission, moderation or content mutations. The earlier native-interface audit's automatically allocated empty draft #1850 remains disclosed in [the interface audit](native-interface.md).

## Local portal gateway proof of concept

```sh
python3 scripts/nechako-server/portal_gateway.py
npx vite --host 127.0.0.1 --port 42173 --strictPort
```

Open `/dev/nechako/portal?panel=account`, check gateway availability, then choose **Local gateway**. This mode is remembered in browser storage; credentials and session tokens are not. Direct anonymous mode remains available and can return the original registration error.

Vite proxies `/api/nechako-portal` to loopback port 42175. The gateway sends the original canonical Referer/AJAX request identity and first visits the source root to initialize each PHP session. These reproduce the source client's observed lifecycle; no original registration/configuration/CORS repair was applied. Actual anonymous gateway reads returned 419 `nechako` search results, nine public saved projects, one Attributes row for submission 1477/layer 386, and 500 observations from layer 386/record 1 out of a reported 25,933. A page was 197,276 decoded response bytes; this is not a full database storage size. Historical 77,799 observations describe a separately scoped earlier audit. The actual ERA5 dates are DD/MM/YYYY: select that explicit daily-date format and a timezone when charting. Daily values are placed at midnight in the selected zone for display; original strings and source fields remain in exports.

Optional sign-in creates a separate in-memory upstream cookie jar per browser session. Local cookies are HttpOnly/SameSite=Strict and scoped; sessions expire after 30 idle minutes or a service restart. Login/logout and cross-tab state changes invalidate protected views. Explicitly saved local artifacts remain user-controlled exports. Do not expose this development HTTP service as a public proxy.

All upstream routes and parameters are allowlisted against one fixed HTTPS origin. Reads have bounded requests/responses. `/layer-attributes` accepts submission/layer IDs, verifies their association, and constructs its Attributes descriptor from the original source; it accepts no client URL, SQL or file path. Reviewed mutations require a signed-in source session, a local CSRF token and an approved local origin. Admin mutations additionally require strict source administrator status; project mutations check source ownership. Original permissions still decide access. No original CSRF token was observed; local protection does not repair the legacy backend.

Implemented reviewed adapters cover native project save/rename/share/default operations, existing user permissions, group membership, shared-layer approval/active state, existing help content and bounded CSV draft creation. Their contracts are checked with mocked writes and offline validation; no actual mutation acceptance is claimed. CSV source uploads allocate fresh drafts only, check current dynamic fields and stop on error without automatic retry. Multipart spatial/GeoPaparazzi upload, final publication, deletion, password/identity changes, notifications and scheduling writes are absent. Preserve native originals where style/source serialization cannot be verified.

The proof of concept includes hosted live reads and original downloads, local review/export flows and review-gated native write adapters. Hosted sessions deliberately remain temporary and may end on runtime eviction. Source write acceptance still requires transaction validation with disposable records and multiple user scopes; hosted publication, permission changes, project saves and uploads are disabled.

For repeatable public data sizing, project-list checks and attachment inventories, use [the read-only data audit script](data-audit.md). It distinguishes file sizes from metadata, linked websites and unknown/protected resources.

## Local read-only submission export

`scripts/nechako-server/export_submissions.py` exports the submissions currently visible in the native administrator catalogue. It reconciles native search metadata, reads current form definitions and bulk dynamic-field reports, fills omitted field values through individual read endpoints, and captures metadata plus attachment/owned-layer/linked-layer inventories for every listed ID. It never allocates drafts, edits records, publishes, changes permissions, or fetches file bodies or monitoring observations.

Supply `NECHAKO_EXPORT_USERNAME` and `NECHAKO_EXPORT_PASSWORD` in the process environment; the script writes neither credentials nor cookies. Then run:

```sh
python3 scripts/nechako-server/export_submissions.py --output /absolute/private/export-folder --workers 2
```

Workers are bounded to 1, 2 or 4. Content reads default to 20 MiB; use `--max-content-response-mib 64` or `128` for known large inline-media form content. Other read responses stay capped at 20 MiB. One actual project description was 41,459,125 UTF-8 JSON value bytes. `--resume` reuses structurally complete captures from the original cohort and verifies hashes when a final manifest exists; it is not a fresh snapshot. Each record carries its own capture time. Source reads occur over an interval, not an atomic database transaction. The final administrator catalogue is compared with the initial one to identify added, removed or changed catalogue records.

Deliverables include individual source-ID JSON files, a combined `submissions.json`, a spreadsheet index, source form definitions/raw reports, per-form CSV, a field dictionary, separate attachment/layer inventories, completeness summary, SHA-256 manifest and compressed ZIP. CSV protects formula-like text and flattens complex values; JSON retains exact returned values. Empty/false/zero values are not discarded or inferred from omitted bulk keys. Failed reads stay explicit.

Keep administrator-visible exports outside Git and `public/data`. The October 12 user selected submission content and attachment/layer inventories; binary documents/GIS files, full monitoring observations, permissions and historical revisions are separate scopes. The data is not publicly published by this exporter. Offline capture/resume/hash/value-preservation checks run with `python3 scripts/nechako-server/test_export_submissions.py` and make no network requests.

The completed October 12 capture contains 1,667 submissions (1,585 submitted and 82 drafts), 31 form definitions, 19,885 dynamic field values, 173 attachment references, 543 owned-layer references and 1,279 linked-layer references. All records completed without read errors; the final catalogue comparison found no added, removed or changed catalogue entries. The combined JSON is 255,540,175 bytes and the ZIP is 566,994,673 bytes. These are export artifact sizes, including duplicate native report/evidence content, not the original portal's database or file-storage size.

## Public submission search snapshot

The public search data belongs to `vendor/bcdatamapper/datascrapers/bc/nechako-portal`, with its capture script, tests, manifest and deterministic compressed content. `npm run data:sync-from-bcdatamapper` assembles the deployable output into the ignored `public/data/nechako-portal` directory. Commit and push the submodule first, then update the PGMaps pointer; never commit a second generated snapshot in PGMaps.

An optional private export supplies submitted-ID eligibility only for a bounded cohort; the scraper can also refresh directly from the anonymous source catalogue. It independently reads each included field and inventory through successful anonymous source responses. Administrator-only drafts, private catalogue text, permissions and assigned users are excluded. Rich content keeps its text and safe references, with embedded media replaced by source submission/field references and digests. Existing HTTP(S) image URLs remain on their original hosts; image and attachment bodies are not copied into the snapshot.

Search opens a compact submission table with text/expression search, form filtering, CSV export, a full public-data ZIP download and a tabbed, form-aware submission viewer. The ZIP includes decompressed submission JSON, form definitions, original capture manifest and exclusions/readme; it excludes file bodies, live history and permission data. The broader search over research, projects, stories, advertised layers and imported collections remains under **Data inventory → Search collections**. Geographic restrictions use the original source's spatial search and intersect its returned IDs with local content results; source failures remain explicit.

The original client opens records using in-page `openSubmission(id)` and has no verified submission deep-link URL. Embedded data-URI images therefore reference the portal root together with the source submission and field IDs. The native HTML export is a download POST and rejects the tested PGMaps/localhost request identity; it is not exposed as an invented image URL or a working direct report link.

The October 12 public capture contains 1,465 submissions across 11 forms and 18,688 dynamic fields, with zero read omissions. It excludes 120 administrator-visible submitted records and all 82 drafts. The snapshot is 7,462,208 decoded JSON bytes and 1,174,698 gzip bytes, with 124 attachment references and 1,713 layer references (482 direct and 1,231 linked, across 489 distinct layer IDs). Its 55 media references comprise 24 embedded entries with 22 distinct digests, and 31 original HTTPS image URLs. Final anonymous ID/state/form membership, dataset hashes, gzip determinism and the absence of inline data-URI bodies were verified before publication. The earlier 14.4 MB estimate describes the larger, duplicated private export after removing inline media; it is not this public deployment snapshot.

## Submission viewer and source access

The public search popup uses the original viewer’s eight sections: Preview, General, Allowed Users, Spatial Data, Attachments, Child Submissions, History and Export. Preview starts selected. Its `forms.json.gz` contains only the current definitions independently returned by anonymous source reads for the public cohort’s 11 form IDs. It preserves native returned node order, page and rank, field IDs, labels and types. Dynamic groups are rendered as readable, read-only fields; static attachment/layer/permission/parent nodes link to the corresponding section rather than executing legacy ExtJS controls. An unavailable definition produces an explicit captured-field fallback and retry. General keeps native Title and Name distinct. Missing metadata is not inferred.

Allowed Users, History and source child listings are live reads, loaded only when selected, using the original `getSubmissionPermissions.php(submissionId)`, `getHistory.php(sub_id)` and `getChildren.php(parentId)` contracts. The original portal decides access. The nested connection dialog retains the selected public record while switching or signing in. Successful connection/sign-in completion refreshes the selected live tab. Cross-tab changes and logout require a new explicit read. Connection changes, the start of sign-in/logout (including a rejected sign-in), switching submissions or closing the popup abort requests and discard protected response data; delayed responses cannot restore it. Permission/history payloads are held in browser memory only and excluded from snapshots, local storage and public exports. Errors and unexpected response shapes remain visible; unavailable access is not presented as an empty list. These panels do not edit permissions or history. Anonymous and authorized temporary-account source reads verified the grouped permission schema and a real two-row child list; the sampled history endpoints returned successful empty lists. Nonempty history rendering uses the field names verified in the native client and synthetic tests, rather than claiming a captured nonempty history example.

Spatial Data separates owned and linked layer references. Attachments show the captured inventory; binary files and geometry are still at the source. Child Submissions distinguishes children in the public capture from the live source listing. JSON, readable HTML and field CSV export public captured content with source IDs, capture date and form definition. The form-definition artifact adds 26,030 decoded bytes / 2,203 gzip bytes (11 forms, 82 dynamic nodes and 52 static markers). The Export tab now provides a public-content PDF plus JSON, HTML and field CSV. Original PDF/HTML/CSV and attachment ZIP can be downloaded through the isolated hosted or local connection, using fixed `downloadSubmission.php` POST modes (`pdf`, `html`, `csv`, `files`). Downloads first check source metadata access, have a 32 MiB/60-second limit, validate file signatures and attachment responses, use controlled filenames and no-store headers, and abort on connection changes. An empty-file submission can fail at the source: ID 9 returns PHP warning HTML for ZIP, while ID 745 returned a valid 44,869-byte attachment ZIP. Linked layers are not promised as downloadable spatial files. No unverified GET or submission deep-link is generated. Original HTTPS media URLs render directly; embedded media retain submission/field references and digests.

Direct PGMaps-origin reads of metadata, permissions and children for IDs 9, 69 and 1477 returned source access failures, while canonical anonymous gateway reads succeeded. Submission 9 has no children; 69 has two. This discrepancy is the source request-identity check, not a requirement to publish an administrator session. The live tabs offer “Use portal connection” when direct mode is selected. The production build uses the separately hosted Cloudflare connection by default; an explicitly saved direct-mode preference remains respected. The live gateway reproduces the successful anonymous child counts above. Public captured content and its downloads remain available independently of the source service. Readable form presentation is implemented; arbitrary source workflow controls and source submission editing are not reproduced by this popup.


## 1. Original direct-request registration (historical findings)

The portal's own search, saved project listing and default project calls returned “Website is not registered”. HTTP 200 is not success: the JSON `error` and failure status must be checked. This also happened from PGMaps, so changing browser CORS will not resolve it.

On the portal server, inspect the REST bootstrap and registration/license lookup shared by `rest/portal/getSearchResults.php`, `rest/openmap/savedProjects.php` and `rest/openmap/getDefaultProject.php`. Check the configured canonical hostname and scheme, stored registration record, reverse-proxy forwarded host handling, configuration loading and server logs. Determine the actual cause before editing anything. The public client cannot establish the responsible database table, license key, config file or safe replacement value. Do not issue a guessed database update.

After repair, use the portal's own Search UI and project catalogue first. Verify an ordinary permitted user and a denied user. Then test the same anonymous form POST from the deployed PGMaps origin. Capture successful payloads for the new adapters; do not map nwsviz literature IDs onto portal submission IDs.

## 2. Correct browser CORS

Current live results: public GET and simple URL-encoded POST pass; `credentials: include` on wildcard PHP responses fails; `X-Requested-With` and JSON content-type preflights fail. WMS capabilities on all 32 services pass. OPTIONS handling, credentialed PHP access and registration are separate problems.

The candidate patch is [`cors.inc.php`](../../scripts/nechako-server/cors.inc.php). Include it **before** sessions, auth/registration checks and output in the shared REST bootstrap. Set `NECHAKO_ALLOWED_ORIGINS` to an audited comma-separated list of exact origins. Defaults are the bare portal origin and `https://pgmaps.ahmadjalil.com`; inventory other existing consumers before deployment. Add individual localhost origins only on development servers. Never use `*` with credentials or reflect an unvalidated Origin.

Remove old wildcard/duplicate CORS headers in PHP and the HTTP server. Confirm allowed-origin headers are present on errors too. OPTIONS must return 204 without invoking the business handler, session or registration. Reject preflight methods/headers outside the declared set. Preserve `Vary: Origin` through proxies and caches.

Continue using URL-encoded form bodies: permitting the `Content-Type` header does not make PHP `$_POST` parse JSON. If JSON is desired, migrate endpoint body parsing and validate both transports explicitly.

CORS is not authentication or CSRF protection. Before enabling private requests, verify real per-user sessions, existing CSRF protection on mutations, server-side permission checks and logout/expiry. Cross-site cookies require deliberate Secure/SameSite handling and can still be blocked by browser privacy settings. The observed PHPSESSID is Lax with Secure/HttpOnly false, so direct authenticated cross-site use requires a session-cookie change as well as CORS, or a per-user backend session design. A same-origin per-user backend session exchange may be preferable. Do not proxy a shared administrator cookie or put credentials in frontend files. The local gateway above isolates per-user upstream sessions; this section describes remaining direct-browser and production acceptance.

Acceptance browser cases from the actual deployed PGMaps origin, without route interception or disabled security:

- Public GET and existing form POST succeed.
- Allowed credentialed reads return exact allowed Origin and `Access-Control-Allow-Credentials: true`; a denied user remains denied.
- `X-Requested-With` OPTIONS returns 204 with the allowed header/method; the subsequent read succeeds.
- An unapproved Origin and unsupported preflight header/method are rejected.
- Registration/permission errors remain visible JSON errors with correct CORS headers.
- Login, expiry, logout and a second user's isolation are verified. JSON request bodies remain a separate acceptance check.

### Original portal embedding and startup JSON

A normal cross-site iframe from the local PGMaps origin could load the portal interface; the portal root did not advertise X-Frame-Options or CSP frame-ancestors. However `rest/portal/admin/getStartupContent.php` returned PHP HTML warnings before its JSON: undefined `configuration` and access to a null value, both reported at line 8. ExtJS then raised an invalid-JSON client exception; the default-project registration error was also visible. Embedding is not a completed substitute for the workbench or portal login.

A separate normal top-level portal visit returned valid startup JSON with `startup:true` and no JavaScript exception. Its PHP session cookie was observed as SameSite=Lax, Secure=false and HttpOnly=false (cookie values were not recorded); that cookie cannot establish the same cross-site iframe/session behavior. The issue is specific to the tested frame/session context, not evidence that top-level startup always fails.

Inspect that endpoint's configuration/session initialization and server logs. Keep production warnings out of REST JSON (`display_errors=Off`, `log_errors=On`) and fix the missing value rather than only suppressing its warning. Test a normal top-level portal visit separately from an iframe, and inspect cookie SameSite/Secure behavior without exporting session values. A frame's presence does not prove protected login or third-party cookies work. Evidence: `portal-embedding.json`, `portal-embedded.png`, and the separate `portal-top-level-startup.json` follow-up. PGMaps continues to offer a top-level portal link; no broken iframe integration was added.

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

Limits: 20 MB source files combined, 16 sidecars, 200 archive entries, 60 MB expanded archive, 50 dataset layers, 100,000 features per layer, 30 MB converted output, 45 seconds per GDAL subprocess, 120 seconds per converted dataset and 180 seconds browser deadline. Archive traversal, symlinks, duplicate basenames and XML document types/entities are rejected. Driver conversions can lose styling or target-format fields; retain original files. Shapefile mixed geometry or incompatible GPX polygons can fail explicitly; separate homogeneous layers before export.

The Python HTTP server is **development only**. Production needs a same-origin authenticated/rate-limited job endpoint backed by isolated GDAL workers, OS memory/CPU/time/process limits, bounded job concurrency, blocked worker outbound networking, accepted driver review, private temporary storage and logs that exclude uploaded contents. Do not expose the loopback dev server with permissive CORS. No production converter deployment was attempted here.

GeoPaparazzi currently supports read-only table inventory, not verified form/photo/station publishing. SQLite or GeoPackage tables without spatial registration/CRS must be treated as tables or supplied a known source CRS, never silently interpreted as WGS84 vectors.

## 5. Deploy PGMaps and verify deep routes

Build the existing toolkit and JSON URL dependency, then run TypeScript/Vite and the existing `scripts/write-spa-fallback.mjs`. Preserve project data/submodule pins. Deploy through the host's existing process. Configure history fallback to `index.html` for app routes while leaving missing assets/API paths as real 404s. The deployed literature deep link returned HTTP 404 even though client navigation worked; the host must actually apply the fallback.

Verify direct visits and refresh on `/dev/nechako?view=files`, `/dev/nechako?view=monitoring` and `/dev/projects/nechako-watershed-research-portal`. Verify HTTPS, mobile layout, no console exceptions, source attribution, portal links, public reads and the converter's explicit availability state. The local production bundle does not prove remote deployment.

## 6. Protected workflow acceptance

The original portal remains authoritative for permissions and publication. PGMaps now has the local reviewed adapters described above. Full production acceptance and unsupported operations still require the original backend; no source migration or permanent synchronization was performed.

Before claiming parity, use authorized, redacted samples and at least two permission scopes to validate:

- Submission metadata, schema-driven preview, attachments/downloads, spatial and linked layers, child submissions and history. New resource reads preserve errors and raw payloads, and render verified dynamic form fields; arbitrary static nodes remain explicitly unsupported.
- Search result columns and IDs, Boolean/field and geographic results. Area payload uses the public client's GeoJSON contract; gateway results are live; direct-mode registration and permission-scoped area semantics remain acceptance checks.
- Native saved project payloads, scale/camera, source URL resolution, SLD/custom style subset and exact cross-type layer order. Local conversion retains the original and warns about unsupported source/style/order behavior.
- Monitoring schema/record/submission relationships, pagination, units, timestamps/time zones and duplicate/missing values. Local CSV matching, line/bar dual-axis charts, paged tables, exports and statistics are implemented; protected monitor transport still needs samples.
- Zotero draft mapping with canonical citation identifiers and duplicate policy; local review does not publish. GeoPaparazzi field forms, images and tracks need a real validated sample.
- Report form/schema definitions, source-side statistical scope and saved report permissions; local CSV statistics are not equivalent to all portal reports.

The uploaded archive contains nine zero-byte SOP files and an annual-update DOCX with no extractable instructions. Their original procedures cannot be recovered from that archive. Use the completed assessment and this runbook as draft operational guidance; obtain the originals before representing them as authoritative SOPs. Payment/BOSS modules are not confirmed active requirements; BOSS was hidden in startup code.
