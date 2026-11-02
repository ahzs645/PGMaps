# Forest drought loading and deployment audit

Checked on 2 November 2026, starting from PGMaps PR #64 at
`72c51759519a020e33db52f21e6fc7980a25ace4`. The observations below describe that
deployment state, not a claim that the PR has subsequently been published.

## Live HTTP and browser observations

Read-only GET requests used the request header
`Origin: https://pgmaps.ahmadjalil.com`. Responses were recorded at
`2026-11-02T08:04:55Z` through the configured network proxy.

| Asset | HTTP | Content type | Access-Control-Allow-Origin | Body |
| --- | --- | --- | --- | --- |
| [Standalone published CSV](https://projects.ahmadjalil.com/forDRAT/data/forest-drought/fordrat.csv) | 200 | `text/csv; charset=utf-8` | `*` | 338,744 bytes; exact pinned SHA-256 |
| [Production PGMaps CSV path](https://pgmaps.ahmadjalil.com/data/forest-drought/fordrat.csv) | 404 | `text/html; charset=utf-8` | `*` | HTML fallback containing production version `cc511ee` |

The standalone CSV's SHA-256 was
`abdb1a26645d6d24e6d45380f55aa555a5f69ffdad79c5f7fb47627003f0d2df`.
Its response had `Cache-Control: max-age=600` and ETag `"6ae83e54-52b38"`.
The wildcard origin permits an ordinary public, credentialless cross-origin
fetch from PGMaps. The integration itself does not need that permission: it
loads its own committed static copy from the PGMaps origin.

Fresh Chrome navigation confirmed that the standalone forDRAT app loaded and
validated its dataset, and that the standalone calculator ran its synthetic
demonstration to completion. Neither produced CORS or worker console errors.
The production PGMaps drought route displayed the application's 404 page.

## Why production PGMaps returned 404

At the check, [PR #64](https://github.com/ahzs645/PGMaps/pull/64) was open and
unmerged. Production main remained
`cc511eea4fc4840113ac822e583680d625da5660`.

- [The main Pages run](https://github.com/ahzs645/PGMaps/actions/runs/41383994811)
  successfully deployed that main revision.
- [The PR Pages run](https://github.com/ahzs645/PGMaps/actions/runs/41408538839)
  built successfully, but its deployment job was skipped. A successful PR build
  does not publish the PR to the production domain.

The missing route and missing CSV were deployment-state observations, not CORS
denials. Deploying the integration through the normal reviewed merge process
is required before the production URLs can serve the new feature.

A separate [Nechako browser run](https://github.com/ahzs645/PGMaps/actions/runs/41408539710)
timed out in two local-style tests after reloading immediately after clicking
Close. The existing dialog's close callback runs after its exit animation and
then clears `?panel=projects`; reloading sooner can reopen the modal and hide the
navigation the test expects. The test helper now waits for dialog removal and
query-parameter removal before returning. This is a test synchronization repair;
Nechako's application behavior is unchanged. The failing test and dialog code
also exist in the base revision, but no separate baseline browser reproduction
was performed.

## Runtime request boundaries

| Workflow | Required network resources | Processing |
| --- | --- | --- |
| PGMaps published explorer | Same-origin CSV and provenance/download assets | Browser parsing, checksum validation, selection and export |
| PGMaps custom calculator | Same-origin Vite-built worker | Local CSV text passed by `postMessage`; no model-service call |
| Standalone forDRAT | Relative scripts, stylesheet, CSV and manifest | Browser-only published-data exploration |
| Standalone calculator | Relative scripts and module worker | Browser-only climate and soil calculations |

There is no runtime fetch to GitHub raw data, ECCC, ClimateBC, R2 or an external
calculation service. Node preparation scripts may fetch pinned source files
when explicitly requested; those are separate from the browser workflow.
The implementation uses neither Wasm threads nor `SharedArrayBuffer`, and does
not require COOP/COEP headers. Both standalone CSPs permit their own static
resources; the calculator explicitly permits `worker-src 'self'`.

## Hardening and coverage added after this audit

The CSV URL now includes its pinned SHA-256 in a `v` query parameter. Cache
Storage includes this query in its key, so a previously cached source revision
cannot shadow the new revision. The body checksum is still independently
verified before results are shown. Static source/download paths also use
Vite's configured base URL. This does not claim full application routing under
an arbitrary subpath; the current production deployment is at the origin root.
An unavailable Web Crypto API now produces an explicit HTTPS/localhost message.

The focused workflow now serves the actual `dist/` build through Vite preview.
Its production acceptance case does not intercept the CSV. It checks HTTP
success, CSV content type, exact SHA-256 and same origin, then reloads through
the actual production service worker and runs the compiled worker to completion.
It also seeds an obsolete unversioned CSV cache entry to ensure the versioned
request does not read it. The other four acceptance cases retain their controlled
fixtures for exact UI assertions and deliberate corruption/retry behavior.

The production test is explicitly enabled with `PGMAPS_E2E_PRODUCTION=1` so a
normal local development-server run does not claim to test the production
service worker or hashed worker output. CI retains the browser report and
screenshots with the test results.

For the distinction between same-origin loading and cross-origin permission,
see [MDN's CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
