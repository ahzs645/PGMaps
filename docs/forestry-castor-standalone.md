# forestryCastor standalone deployment

## Purpose and ownership

The standalone build publishes the same `DevForestryCastor` workbench that PGMaps
uses at `/dev/forestry/castor`. The integrated implementation lives in PGMaps;
the fork can carry an editable mirror of the Castor-specific files while using
the same pinned shared UI/build host. Matching source revisions share import
validation, model behavior, scientific assumptions, output formats and tests.

The browser entry is `standalone/forestry-castor/main.tsx`; its configuration is
`vite.castor.config.ts`. It adds the theme provider and browser router with the
deployment basename, then renders `<DevForestryCastor standalone />`. That flag
changes the back-navigation link; the workbench features and model are shared.

A fork of `bcgov/forestryCastor` preserves the original R files and adds editable
`web/src/features/forestry-castor`, `web/src/pages/forestry-castor` and
`web/src/pages/DevForestryCastor.tsx` files. Its source lock lists every file and
checksum. The build checks out a reviewed PGMaps commit, verifies the mirrored
files, overlays them into that isolated host and runs the dedicated build. The
shared host is a reproducible dependency; the converted model and interface are
editable within the fork.

## Source lock for the fork

Record a full 40-character PGMaps commit SHA in the fork's source lock. Also keep
the upstream forestry/growth/data pins and the original data SHA-256 shown in
`public/data/forestry-castor/provenance.json` and the source audit. The deployment
workflow should require that the checkout's `git rev-parse HEAD` equals the lock.
Use a pinned revision rather than a moving branch or whichever PGMaps version
happens to be current on a deploy day.

The original fork's licence and R source stay intact. The browser build carries
its own source manifest and the upstream attribution. Updating the dependency
pin or mirrored files should be a reviewable change together with validation
results. The final source manifest records the fork revision and overlay hashes
as well as the underlying PGMaps revision; a changed overlay is not represented
as an unchanged upstream host.

## Build sequence

The required checkout is PGMaps with `packages/geo-toolkit` initialized at its
pinned submodule commit. The forestry standalone does not need scraper datasets
or the application's data-generation lifecycle scripts.

```sh
git submodule update --init packages/geo-toolkit
npm ci --ignore-scripts
npm run toolkit:build
python scripts/forestry-castor/reference/generate.py --check
npx vitest run src/features/forestry-castor
npx tsc --noEmit -p standalone/forestry-castor/tsconfig.json
npx vite build --config vite.castor.config.ts --base /forestryCastor/
node standalone/forestry-castor/verify-build.mjs /forestryCastor/
```

Upload `standalone/forestry-castor/dist/` as the static-site artifact. The proposed
fork URL is `https://projects.ahmadjalil.com/forestryCastor/`; the path's case is
significant. The dedicated command calls Vite directly so the general PGMaps
`prebuild` data-synchronization pipeline is not required.

For a different root/subpath, supply the corresponding absolute `--base` and pass
that same value to `verify-build.mjs`. Test the compiled build under that base;
testing a development page at `/` does not prove subpath delivery.

## Emitted files and data boundaries

The Vite config uses `publicDir: false` and an explicit static-asset allowlist.
It emits only these application data files:

| File | Purpose |
| --- | --- |
| `data/forestry-castor/simple_castordb.sqlite` | Unmodified original 696,320-byte example database |
| `data/forestry-castor/provenance.json` | Source revision, checksum, exact schema and preparation observations |
| `data/forestry-castor/LICENSE` | Upstream Apache-2.0 licence |
| `data/forestry-castor/NOTICE` | Source attribution and adaptation notice |

It also emits `index.html`, `404.html`, `.nojekyll`, compiled JavaScript/CSS/Wasm,
and `source-manifest.json`. It does not recursively copy the PGMaps public data
directory. The source manifest records the PGMaps revision and whether the
worktree was dirty, the shared page/engine paths, the upstream revisions, and
SHA-256 checksums for each allowlisted data file.

The artifact verifier checks the original SQLite bytes, exact data-file
allowlist, HTML asset basename and existence, compiled calculation worker,
self-hosted SQLite Wasm, and matching 404 fallback. It is independent of a live
deployment and does not claim that uploading an artifact has deployed it.

## Runtime loading and CORS

The standalone sample request is built from `import.meta.env.BASE_URL` and the
sample checksum query parameter. SQLite Wasm and the calculation worker use
Vite's compiled asset URLs. They therefore load from the same origin and subpath
as the page; no third-party CORS permission or calculation backend is required
for these inputs and computations.

The entry does not register the PGMaps service worker or import the PGMaps app
router. Draft storage uses the Castor-specific IndexedDB database on the current
origin. Drafts on `projects.ahmadjalil.com` and `pgmaps.ahmadjalil.com` are separate;
export/import a session JSON to move a scenario between them.

Spatial output uses the workbench's local background style. Adding a remote map
style or data service later would require its own loading/access check. None of
this preparation establishes direct browser access to the provincial PostgreSQL
database used by the original data-preparation workflow.

The standalone HTML sets a Content Security Policy that allows scripts from its
own origin, Wasm compilation and local/blob workers. Network connections remain
restricted to its own origin; data/blob images and inline component styles are
allowed for local map rendering. Browser acceptance must also check policy
violations so a deployment does not silently lose a worker, theme or map asset.

## Browser acceptance before deployment

Run a production preview under `/forestryCastor/`, load the bundled upstream
example without intercepting its response, and confirm its checksum. Run a
scenario and verify that the compiled worker loads beneath the same base. Verify
the source example's 100 × 100 grid, map rendering, at least one GeoTIFF download,
and the complete report ZIP. Also import a saved session and confirm that its
settings return while saved outputs require a rerun.

Exercise the same workbench at phone and desktop widths and inspect console and
network failures. The unit/SQL/artifact checks complement this browser evidence;
none is a substitute for a complete R/SpaDES comparison with all original inputs.

The scientific scope and explicit differences remain documented in
[the source audit](forestry-castor-source-audit.md) and
[the workbench guide](forestry-castor.md).
