# Standalone forestryCastor web build

This entry builds the **same full workbench** used by PGMaps at
`/dev/forestry/castor`, with a browser router base for `/forestryCastor/` and an
absolute navigation link back to PGMaps. It imports the existing page, engine,
Web Worker, SQLite reader, raster importer and exporters. There is no separately
maintained model implementation in this folder.

The source lives in a pinned PGMaps checkout. A forestryCastor fork can retain
the original R module and run this build from that reviewed revision. See
[the deployment contract](../../docs/forestry-castor-standalone.md).

## Build and verify

From the PGMaps repository root, with the toolkit submodule initialized:

```sh
npm ci
npm run toolkit:build
npx tsc --noEmit -p standalone/forestry-castor/tsconfig.json
npx vite build --config vite.castor.config.ts --base /forestryCastor/
node standalone/forestry-castor/verify-build.mjs /forestryCastor/
```

The output is `standalone/forestry-castor/dist/`. Upload the **contents** of that
folder to the repository's static deployment. Keep the same base path used in
the build; a different deployment path requires rebuilding with its `--base`.

```sh
npx vite preview --config vite.castor.config.ts --base /forestryCastor/ --host 127.0.0.1 --port 42179
```

Open `http://127.0.0.1:42179/forestryCastor/`. Use HTTPS on a public deployment.
For local development, replace `preview` with `--config vite.castor.config.ts`
after `vite`, retaining the base/host/port arguments.

The dedicated Vite config excludes the full PGMaps `public` folder. Its static
asset allowlist contains only the original Castor SQLite sample and its licence,
notice and provenance. It verifies the sample checksum before emitting files.
`source-manifest.json` records the PGMaps Git revision, dirty-worktree flag,
upstream module pins, and hashes of the four data files. A local dirty build is
labelled as such; production should be built from a clean pinned checkout.

The built worker, SQL.js JavaScript and SQLite Wasm use Vite-generated asset URLs
under the configured base. This entry does not register PGMaps's service worker
or load its route table. Data imports, calculations and output generation remain
local to the browser. The spatial view uses a local background style by default.
