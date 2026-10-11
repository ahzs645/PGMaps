# Nechako portal test-account access check

Checked 2026-10-11 UTC against the live portal using the account explicitly supplied by the user. This was a read-only browser assessment; no portal configuration, content, users or permissions were changed.

## Result

The original portal's Login interface submitted the credentials to `rest/portal/login.php`. HTTP 200 returned application status `failure` and:

> This website is not registered to use the Portal API.

`rest/checkLoginStatus.php` subsequently returned `loggedIn: false`. No authenticated session was established. This response does not establish whether the supplied credentials are valid or invalid; the API registration rejection prevents testing authenticated access.

Startup also reports `Website not registered` when loading the default project. Welcome and error windows overlap and block pointer interaction until dismissed. Browser security and HTTPS verification remained enabled; no mocked responses were used.

## Data availability

| Read | Observed result |
| --- | --- |
| Saved project listing | HTTP 200, application failure, `Website not registered` |
| Default project | HTTP 200, application failure, `Website not registered` |
| Search for `nechako` using the portal's own expression parser and all eight returned search fields | HTTP 200, application failure, `Website is not registered` |
| Admin submission listing | HTTP 200, application failure, `You are not an administrator`, logged out |
| Report forms, first page | Success with an empty array while logged out; this is not evidence that the authenticated portal contains no forms |
| Search field catalogue | Eight public metadata/content search fields accessible |
| Spatial format registry | Eight public formats accessible: Shapefile, GeoJSON, GML, GPX, KML, SQLite, Spatialite and GeoPackage |

No additional saved projects, submission records, source GIS data or attachment file bodies were retrieved. The existing public PGMaps snapshot remains the previously assessed 1,408 research records and 32 WMS service definitions; this check does not establish completeness or total source-storage size.

## CORS retest from deployed PGMaps

Browser origin was the actual `https://pgmaps.ahmadjalil.com`, with normal browser enforcement.

| Request to savedProjects.php | Browser result |
| --- | --- |
| Anonymous form-encoded POST | Readable HTTP 200; application registration failure |
| Form-encoded POST with `credentials: include` | Fetch blocked |
| JSON POST requiring preflight | Fetch blocked |

The readable response has `Access-Control-Allow-Origin: *` and no `Access-Control-Allow-Credentials`. An independent OPTIONS request with the PGMaps Origin, POST requested method and content-type requested header also returned only the wildcard allowed-origin header, with no allowed-methods or allowed-headers declaration. This explains the credentialed and JSON browser failures. There is no authenticated cross-site session to validate because login itself was rejected.

## What is required next

Restore the portal API's site registration/configuration on its server, then repeat the account check. The public response cannot identify the exact configuration file, registration record or safe corrective value. There is no demonstrated portal server/database access in this workspace.

After login succeeds, enumerate authorized projects and submissions, export project definitions and metadata, inventory linked layers/attachments and retrieve permitted file bodies. Only then can total storage size and data completeness be measured. PGMaps authenticated integration also needs exact allowed origins, credentialed CORS/preflight support and an appropriate per-user session design. Do not place a shared administrator password or session in frontend code.

## Evidence and repeatable check

The [recorded access/CORS results](evidence/2026-10-11-access.json) contain only the failed-login response summary and public or denied read responses. No credentials, cookies or session identifiers are included. The [live interface screenshot](evidence/2026-10-11-registration-error.png) shows the registration error after dismissing the welcome window. A separate visual browser visit confirmed that the map renders and the visible Login button opens its dialog.

Run [check-access.cjs](../../scripts/nechako-server/check-access.cjs) from the repo root. It uses the installed Playwright dependency; install its Chromium with `npx playwright install chromium`, or set `NECHAKO_CHROMIUM` to a system Chromium executable. Supply account details interactively:

```bash
read -r -p 'Portal username: ' NECHAKO_USERNAME
read -r -s -p 'Portal password: ' NECHAKO_PASSWORD
export NECHAKO_USERNAME NECHAKO_PASSWORD
node scripts/nechako-server/check-access.cjs
unset NECHAKO_USERNAME NECHAKO_PASSWORD
```

The read-only script saves results under ignored `tmp/nechako-access-audit` by default. `NECHAKO_AUDIT_DIR` can select another local output directory. It never modifies portal content. Successful authenticated responses may contain protected metadata; keep those exports local rather than adding them to the public showcase. A successful check establishes access, not an exhaustive project/attachment export.

The existing [server runbook](server-runbook.md) covers the separate registration, CORS and session repairs. No authenticated/private data was added to the showcase.
