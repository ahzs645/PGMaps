# Standalone build and export

The road designer and its help are developed in PGMaps, at `/dev/forestry/road-design` and
`/help`. The same code also builds as a site of its own, and exports to a repository of its own,
without being copied by hand or developed twice. This guide covers the three parts that make that
work: the boundary, the standalone build and the export.

## The boundary

The designer's own code is `src/pages/dev-forestry-roads/`, `src/pages/help/`,
`src/pages/ForestryRoadWorkspace.tsx`, `src/pages/DevForestryRoads.tsx` and
`standalone/forestry-road-design/`. It may import itself and PGMaps' shared code (`src/lib`,
`src/components`, `src/hooks`, `src/branding`, `src/config`, `src/types`), and nothing else: never
another page (`src/pages/dev-forestry`, `src/pages/dev-lidar`, `src/maps`, `src/features`) or the
app shell (`App.tsx`, `main.tsx`, the navbar).

`npm run road-design:check-boundary` (`scripts/road-design/check-boundary.mjs`) walks every import
from the designer's files, its tests included, and fails on anything outside that boundary, printing
the chain of imports that reached it. It also fails on a package `package.json` does not list (and
npm has not installed) and on an import that resolves to no file. `checks.yml` runs it on every
pull request.

When the designer needs something another page has, move it to shared code and point both at it.
The DEM tile maths, elevation mosaic, tile loader and local rasters the designer shared with the
visual-quality tool now live in `src/lib/forestry/terrain/`; the LiDAR source grids and the LidarBC
index in `src/lib/lidar/`; the VRI request limits in `src/lib/forestry/bcVegetationWfs.ts`; the
`shpjs` declarations in `src/types/shpjs.d.ts`.

`scripts/road-design/manifest.mjs` is the one list of what the designer is: its own folders, its
entries, the shared folders, the `public/` files it loads at run time, the submodules it builds
against and the files that go with it although no import reaches them (the cable optimizer's Rust
crate, the cost-evidence and cable-equipment generators, its guides). The check, the build and the
export all read it. Add a path there, not in one of the three.

## The standalone build

```bash
npm run road-design:build
```

builds `standalone/forestry-road-design/dist/`: the designer at the site's root and the help at
`help/`, with no PGMaps router, navbar, service worker or `public/data`. `verify-build.mjs` then
checks it (every asset the page names, the 404 fallback, the designer's public files, the cable
wasm, a worker, no data and no service worker). `npm run road-design:dev` serves it locally on
port 42180, and `npm run road-design:preview` serves the build.

The entry is `standalone/forestry-road-design/main.tsx`; the configuration is
`vite.road-design.config.ts`. It copies only the `public/` entries the manifest names (`brand`,
`help`, `interface-previews`, `workspace-layouts.json`, `favicon.svg`) and writes
`source-manifest.json` with the PGMaps commit, whether the tree was dirty, the deployment settings
and a checksum for each public file.

### Where it is deployed

Nothing about a deployment is written into the code. The defaults are in
`standalone/forestry-road-design/.env`; override them for one deployment in
`standalone/forestry-road-design/.env.production.local` (git-ignored) or in the build's
environment, which wins over both.

| Variable                        | Default                            | What it sets                                                                                                                   |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ROAD_DESIGN_BASE`              | `/`                                | The path the site is served from: `/` at a domain's root, `/road-design/` under a subpath                                      |
| `VITE_ROAD_DESIGN_PATH`         | `/`                                | The designer's route below that path. The help is always at `help`                                                             |
| `VITE_ROAD_DESIGN_GALLERY_URL`  | PGMaps' gallery                    | Where _Symbol gallery_ goes in the block sheet setup: a route, an https URL, or empty for no link                              |
| `VITE_ROAD_DESIGN_LIDAR_MIRROR` | PGMaps' copy                       | Where the LiDAR sample terrain is read when the site has no copy below `<base>data/lidar-analysis/bc-093g086/`                 |
| `VITE_DATA_HOSTS`               | PGMaps' data for `boundaries/BCNR` | The data folders the designer reads from another site, as `src/config/data-hosts.json`'s JSON ([data hosts](../data-hosts.md)) |

For example, under a subpath of another domain:

```bash
ROAD_DESIGN_BASE=/tools/road-design/ npm run road-design:build
```

PGMaps itself sets none of these, so `src/pages/dev-forestry-roads/deployment.ts` falls back to
PGMaps' own addresses (`/dev/forestry/road-design`, `/dev/forestry/block-sheets`). A page reads a
deployment's address from `deployment.ts`, never a literal.

The LiDAR sample is read from the site's own copy first, then the mirror. Either way the bytes are
checked against the pinned checksum, and a project records the published address
(`PUBLISHED_LIDAR_SAMPLE_BASE`), so a project saved on one deployment reopens on another.

Upload the **contents** of `dist/` to any static host. Build again with the matching
`ROAD_DESIGN_BASE` to serve it from another path: a build is tied to its base. Drafts and preferences
live in the browser's storage for the site's origin, so a standalone site does not see PGMaps'
drafts: move a project between them as a project file.

The standalone page sets no Content Security Policy: the designer reads DataBC, Esri imagery, CDED,
Earth Search and other hosts directly, and a policy would have to list each one.

## Exporting to a repository of its own

```bash
npm run road-design:export -- --out ../forestry-road-design --commit
```

writes a snapshot of the designer into another git working tree (`scripts/road-design/export.mjs`).
The folder is initialised as a repository when it is new or empty. Name a remote to push to as well:

```bash
npm run road-design:export -- --out ../forestry-road-design --commit --push origin --branch main
```

`--out`, `--push` and `--branch` (or `ROAD_DESIGN_EXPORT_DIR`, `ROAD_DESIGN_EXPORT_REMOTE` and
`ROAD_DESIGN_EXPORT_BRANCH`) are the only places the target is named. `--dry-run` reports what
would be written. The export refuses a PGMaps tree with uncommitted changes unless
`--allow-dirty` is given, so the snapshot always names the commit it came from.

The snapshot holds:

- every file in the designer's own folders, the shared files it reaches, their tests where everything
  those tests reach goes too (and the `testdata/` or `fixtures/` folder beside them), and the ambient
  declarations (`*.d.ts`) beside them;
- the `public/` files the manifest names, and the extras it lists (the cable crate, the generators,
  the guides, the Tailwind and PostCSS configs);
- `packages/geo-toolkit` and `vendor/brandkit` as submodules at PGMaps' pinned commits;
- a generated `package.json` listing only the packages the snapshot imports, at PGMaps' versions, and
  a `package-lock.json` that is PGMaps' lockfile pruned by npm to those packages (`--no-lock` skips
  it), so the repository installs the versions PGMaps tested;
- generated `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `.gitignore`, `README.md`,
  an `AGENTS.md` carrying this repository's road design, MapLibre 6 and shared UI instructions, and
  `.github/workflows/build.yml`;
- `EXPORTED-FROM.json`: the PGMaps commit, the submodule pins and every file the export wrote.

The export is one-way. Develop in PGMaps and export again; a change made only in the other
repository is overwritten by the next export. Files the export did not write (they are not in
`EXPORTED-FROM.json`) are that repository's own and are never touched: a deploy workflow of its own,
a `.env.production.local`, a licence note. A file the export wrote last time and no longer writes is
deleted. Exporting the same commit again writes nothing and makes no commit.

In the other repository, `npm ci`, `npm run prepare` (builds the toolkit and Tourkit), then
`npm run check-boundary`, `npm run typecheck`, `npm test` and `npm run build`, as in PGMaps. Its
`build.yml` runs them on every push to `main`, reading `ROAD_DESIGN_BASE` and the other variables
from the repository's variables (Settings → Secrets and variables → Actions → Variables), and deploys
to GitHub Pages when `ROAD_DESIGN_DEPLOY_PAGES` is `true`. Browser (Playwright) suites stay in
PGMaps.

### Cloudflare

Every export carries a `wrangler.jsonc` that deploys the build as a Cloudflare Worker with static
assets (no server code), named by `--name`, with `not_found_handling: "single-page-application"` so a
deep link such as `/help/sketch-road` opens the page. The build writes a `_headers` file that lets
Cloudflare cache the hashed files under `assets/` for a year. In the exported repository,
`npm run deploy` builds and deploys with wrangler (run by `npx` at `CLOUDFLARE.wrangler` in the
manifest, so it never enters the lockfile), and `build.yml` deploys from `main` when the variable
`ROAD_DESIGN_DEPLOY_CLOUDFLARE` is `true` and the secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are set. Keep `ROAD_DESIGN_BASE` at `/` for a Worker. The largest file, the
WhiteboxTools wasm at about 17.6 MB, is under Cloudflare's 25 MiB limit per asset.

### From GitHub Actions

**Road design standalone** (`.github/workflows/road-design-standalone.yml`, by hand only) builds the
site with the `base` you give and uploads it as the `road-design-standalone` artifact. Given
`export_repository` (`owner/name`) and `export_branch`, it also exports there and pushes. It needs a
`ROAD_DESIGN_EXPORT_TOKEN` secret in PGMaps: a fine-grained token for that repository with
**Contents: read and write** and **Workflows: read and write** (the export writes a workflow file).
The repository may be private and may be empty; a branch that does not exist yet starts empty.

## Limits

| Limit                                                                                                                 | Where                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Only the files the manifest and the imports reach go; a file read by path at run time must be in `PUBLIC` or `EXTRAS` | `scripts/road-design/manifest.mjs` |
| Shared tests that read PGMaps-only files are left out by name                                                         | `SHARED_TESTS_LEFT_OUT`            |
| The export's tests and checks are the unit suite; Playwright specs are not exported                                   | `export.mjs`                       |
| A build serves one base path                                                                                          | `ROAD_DESIGN_BASE`                 |
