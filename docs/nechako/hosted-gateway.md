# Hosted Nechako portal connection

The PGMaps frontend is hosted on GitHub Pages. Its production build sets `VITE_NECHAKO_GATEWAY_URL` to a separately deployed Cloudflare Worker. The existing authenticated Cloudflare account supplies Workers hosting; the home Kubernetes hostnames did not resolve publicly during setup.

The deployed gateway base is `https://pgmaps-nechako-portal.ahzs645.workers.dev/api/nechako-portal`. Worker version `05b9197d-9faa-452c-a3bb-f9ec6d775b57` was deployed October 12, 2026. Live anonymous source reads returned successful child lists: zero for submission 9 and two for submission 69. The production build configures this endpoint in the GitHub Pages deployment workflow. Use the acceptance checklist below when changing either deployment.

## Access model

The hosted bridge accepts only verified reads, source submission downloads, sign-in and disconnect. It does not provide source publication, permission changes, project saves or administrative mutations. The original portal decides resource access for every upstream request. Anonymous access is used until the visitor signs in with their own portal account.

Each browser tab holds its opaque gateway capability in memory. It is not written to local/session storage, put in URLs, or broadcast to another tab. Upstream PHP cookies stay in a dedicated Durable Object's memory and are never returned to the browser. The bridge needs no third-party browser cookies. Cross-origin requests use HTTPS, an exact allowlist of frontend origins and a capability header. Credentials, response content and cookies are not logged or placed in public snapshots.

Temporary source sessions expire after 30 minutes without reads. Bounded timers retain session and registry memory through ordinary idle periods, renewing within ten minutes without moving the expiry deadline; the registry limits active sessions to 60. Status checks do not extend that deadline. Runtime resets/eviction can end a session sooner; the frontend must clear old protected results and require a new connection. Successful and failed sign-in attempts replace the previous capability, and disconnect revokes it. Pending reads/downloads cannot restore data from a superseded session.

Requests use a fixed HTTPS source, native request identity and allowlisted parameters. Redirects, caller-provided source URLs, headers, SQL descriptors and filenames are rejected. JSON requests are bounded to 1 MiB, source JSON reads to 20 MiB, and original file downloads to 32 MiB. Original files need permitted source metadata and verified file responses; source warning HTML is not a ZIP or PDF.

## Deployment

The Worker configuration and implementation live under `scripts/nechako-worker`. Use the existing Wrangler account; no portal username, password or upstream cookie is a deployment secret. Do not enable a paid plan as an incidental repair.

```sh
node --test scripts/nechako-worker/worker.test.mjs
python3 scripts/nechako-worker/check_hosted_gateway.py --self-test
npx wrangler deploy --config scripts/nechako-worker/wrangler.jsonc --dry-run
npx wrangler deploy --config scripts/nechako-worker/wrangler.jsonc
```

Deploy the verified backend before pushing the frontend endpoint configuration to `main`. The existing GitHub Pages workflow publishes the frontend; it does not deploy the Worker. Preserve the BCDataMapper submodule and generated-data ownership rules.

## Verified checks

On October 12, 2026, the deployed gateway passed 26 live authenticated acceptance checks, including independent anonymous sessions across original downloads/sign-in/disconnect, capability replacement and revocation, exact CORS handling, successful child/metadata/history reads, and PDF/HTML/CSV/ZIP validation. The original ZIP passed its CRC check. Source cookie/session resets were reproduced in the initial deployment and corrected with bounded in-memory retention before frontend publication. No source record mutations were performed.

Local validation passed 133 focused frontend unit tests, 15 Worker tests, nine acceptance-script self-tests, 12 submission-browser cases, scoped ESLint, TypeScript and the production build. Source history samples returned successful empty lists; nonempty history rendering is checked with native-contract fixtures.

## Acceptance checks

Verify from the actual hosted PGMaps origin, with ordinary browser security enabled:

- Anonymous children, permissions and history reads succeed for source IDs 9, 69 and 1477; distinguish real empty lists from unavailable reads.
- Original PDF/HTML/CSV for 9 and attachment ZIP for 745 download with valid file content. Empty-file ZIP failures remain explicit.
- A permitted temporary account can sign in, inspect resources and disconnect. A separate tab stays anonymous; capabilities and upstream identity never leak between tabs.
- Invalid sign-in, source denial, idle expiry, disconnect, runtime reset and delayed responses clear protected panels and pending downloads.
- Foreign/missing/null origins and unsupported preflights are denied. Exact allowed origins get matching CORS headers on success and errors.
- Mutations, arbitrary URLs, redirects, oversized bodies/responses and invalid IDs are rejected before unsafe source operations.

The explicit live acceptance command is `python3 scripts/nechako-worker/check_hosted_gateway.py`. Optional sign-in checks take `NECHAKO_CHECK_USERNAME` and `NECHAKO_CHECK_PASSWORD` from the environment; keep credentials out of command histories and public files. Its downloads stay in memory and its output contains only check labels, counts and sizes.

The original portal continues to own records, files, permissions and history. The bridge is a transport connection, not a migrated source database.
