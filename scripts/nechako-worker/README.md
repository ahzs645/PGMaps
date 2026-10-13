# Hosted Nechako read connection

Target: `https://pgmaps-nechako-portal.ahzs645.workers.dev/api/nechako-portal`.
The Worker supports source reads, per-session sign-in/disconnect, association-checked layer attributes and original submission downloads. `/write`, administrative source routes and mutation modes are unavailable. Every status advertises `readOnly:true`, `canWrite:false`, `isAdmin:false`, including source administrator sign-ins.

## Session boundary

The browser retains a cryptographically random 256-bit capability in JavaScript memory and supplies `X-Nechako-Session`. It is never a query parameter, cookie, localStorage value or shared administrator credential. The server keys a Durable Object by its SHA-256 hash. A separate in-memory registry accepts only capabilities minted by this Worker, limits active sessions to 60 and rejects expired/revoked capabilities. Cookies, account flags and capability registration are held in Durable Object instance memory; the implementation never calls persistent storage. SQLite class migrations register the classes but do not persist these values.

Upstream cookie jars are separate per capability. Reloading the page loses its capability. Idle sessions expire after 30 minutes; status peeks do not refresh expiry. Cloudflare eviction/restart can clear RAM sooner. Registry loss returns `401 sessionExpired:true`; a source object replacement returns `sessionReset:true` with anonymous status. A read/download encountering that replacement returns 409 before any source request; the frontend discards the old capability and requires a new connection. The browser immediately aborts and clears protected results on these markers.

While sessions remain registered, bounded timers keep the registry and source objects non-hibernateable. Each callback runs within ten minutes, rechecks the existing deadline and re-arms without extending it. Source reads refresh only their own 30-minute idle deadline; status does not. At expiry, source cookies and account flags are cleared, pending requests are aborted and that object's timer stops. The registry prunes expired entries and stops its timer when empty. This avoids normal ten-second idle hibernation; deployments and platform restarts can still reset RAM and require reconnecting.

Sign-in revokes the earlier capability before allocating a new object. A successful or denied native sign-in returns the new capability, never the earlier identity. Denial keeps the new object anonymous. Disconnect revokes and clears its object and returns no new token. Generation checks and registry revocation reject old in-flight reads even if upstream cancellation is ignored. No source response can set browser cookies.

## API

All routes use the base path above. Bodies are JSON. Reads return native envelopes, including source access failures; errors never become fabricated empty lists.

| Method/path              | Body                     | Result                                                                                                                                             |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/status`            | none                     | No allocation/TTL refresh. Missing header returns anonymous status with `tokenRequired:true`; supplied expired token returns 401.                  |
| POST `/status`           | `{}`                     | Allocates an anonymous capability and returns status plus `sessionToken`.                                                                          |
| POST `/login`            | `{username,password}`    | Optional old header is revoked. Success 200 or native denial 401 returns status plus a fresh `sessionToken`; login attributes are not exposed.     |
| POST `/disconnect`       | `{}`                     | Revokes supplied capability; anonymous status, no allocation.                                                                                      |
| POST `/read`             | `{path,params}`          | Requires capability; native relative endpoint and string parameters must match the fixed non-admin allowlist.                                      |
| POST `/layer-attributes` | `{submissionId,layerId}` | Requires capability; verifies source submission-layer association and derives its descriptor on the server. No caller URL, filename, table or SQL. |
| POST `/download`         | `{submissionId,mode}`    | Requires capability; modes `pdf`, `html`, `csv`, `files`. Same-session metadata access is checked before the fixed native export POST.             |

Anonymous source reads are supported without a sign-in. Original permissions decide which fields/files a signed-in user receives. Native ZIP can fail for a record with no source files; submission 9 returns warning HTML for ZIP, while 745 has a verified PNG attachment archive. These are reported as failures rather than downloaded under a false ZIP extension.

## Request and resource limits

CORS permits exactly `https://pgmaps.ahmadjalil.com`, `http://127.0.0.1:42173` and `http://localhost:42173`. OPTIONS permits GET/POST and only Content-Type/X-Nechako-Session. Missing/foreign origins and unsupported methods/headers are rejected. Remote frontend requests use `credentials:'omit'`; authentication depends on the unpredictable header capability. Login/disconnect require JSON and an approved Origin, so HTML form CSRF and unapproved preflights cannot invoke them. Credentials and capabilities are not logged or included in URLs.

Native requests go only to fixed HTTPS `https://nechakowatershed-portal.ca/`, with canonical Origin/Referer/AJAX identity. The source root is bootstrapped inside each jar before REST reads; its HTML is discarded. Redirects are never followed. Source writes are never forwarded. Cookie capture uses getSetCookie/getAll, with a conservative single-PHPSESSID fallback rather than splitting Expires commas.

Limits: 1 MiB JSON input; 20 MiB source JSON/document reads; 32 MiB binary exports; 60-second operation deadline; at most four queued requests and one upstream operation per object; 60 operations/minute per object. Session allocation is additionally limited to 100/minute/IP and login to 5/minute/IP by separate Cloudflare rate-limit namespaces 46011/46012. Cloudflare edge rate limits are approximate/per-location; the registry/session caps are additional checks. Shared-IP users may encounter the same allocation/login rate limit.

Downloads require an attachment response and expected PDF/ZIP/HTML/CSV content signatures, reject error envelopes and oversized bodies, use controlled filenames and set no-store, nosniff and sandbox/default-src-none headers. HTML is an attachment, never executed or injected into the application. Linked layers are not promised as physical files in the ZIP. Native file bodies are not copied into the public snapshot.

## Validation and deployment

```sh
node --test scripts/nechako-worker/worker.test.mjs
wrangler deploy --dry-run --config scripts/nechako-worker/wrangler.jsonc
```

Deploy the Worker before publishing its endpoint in the frontend build. The config enables workers.dev, disables preview URLs/observability and declares no source credentials. Live acceptance must verify exact CORS rejection, two independent anonymous sessions, source record 9/69 reads, sign-in rotation/revocation, failures/reset/expiry, native PDF/HTML/CSV and the 745 ZIP, and a real PGMaps browser using its RAM-only token. Tests use fake source responses and no live mutations.

Cloudflare documents [in-memory object eviction](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/), [lifecycle and pending-operation limits](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) and [rate-limit locality/approximation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Timers prevent normal hibernation and protect RAM from idle eviction for up to 15 minutes per pending operation, so callbacks renew within ten minutes. Keeping objects non-hibernateable incurs duration usage under the existing plan; the 60-session cap and idle deadlines bound concurrent objects. No paid-plan upgrade or persistent private state is introduced. This service deliberately trades session durability for keeping source credentials/cookies out of persistence; users reconnect when memory resets.
