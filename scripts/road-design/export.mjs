#!/usr/bin/env node
/**
 * Exports the forestry road designer to a repository of its own: its code, the shared code it
 * reaches, its public files, guides, the cable optimizer's source and the submodules it builds
 * against, with a package.json, configs, README and AGENTS.md of its own. PGMaps stays where it is
 * developed; the export is a one-way snapshot taken whenever you choose.
 *
 *   node scripts/road-design/export.mjs --out <dir> [--commit] [--push <remote>] [--branch <name>] [--allow-dirty]
 *
 * Nothing about the target is written here: `--out`, `--push` and `--branch` (or
 * ROAD_DESIGN_EXPORT_DIR, ROAD_DESIGN_EXPORT_REMOTE and ROAD_DESIGN_EXPORT_BRANCH) name it. The target
 * is a git working tree (one is initialised when the folder is new or empty). Files the export wrote
 * last time are listed in its EXPORTED-FROM.json: those it no longer produces are deleted, and any
 * other file in the target (your own workflow, a local .env) is left alone. Its package-lock.json is
 * PGMaps' lockfile pruned to the exported packages (`--no-lock` skips it), so it installs the versions
 * PGMaps tested. Guide:
 * docs/forestry-road-design/standalone-build.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  boundaryProblems,
  installedVersion,
  isShared,
  packageDependencies,
  toolStarts,
  trackedFiles,
  walk,
} from './graph.mjs'
import {
  AGENT_SECTIONS,
  ALIAS_ENTRIES,
  ALIASED_PACKAGES,
  DEV_PACKAGES,
  EXTRAS,
  OWN,
  PACKAGE_SCRIPTS,
  PUBLIC,
  SHARED_TESTS_LEFT_OUT,
  SUBMODULES,
  TEST_DATA_FOLDERS,
} from './manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RECORD = 'EXPORTED-FROM.json'
const SCHEMA = 'pgmaps-road-design-export-v1'

const { values: options } = parseArgs({
  options: {
    out: { type: 'string', default: process.env.ROAD_DESIGN_EXPORT_DIR },
    commit: { type: 'boolean', default: false },
    push: { type: 'string', default: process.env.ROAD_DESIGN_EXPORT_REMOTE },
    branch: { type: 'string', default: process.env.ROAD_DESIGN_EXPORT_BRANCH ?? 'main' },
    'allow-dirty': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    lock: { type: 'boolean', default: true },
  },
  allowNegative: true,
})

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

if (!options.out) fail('Name the export folder: --out <dir> (or ROAD_DESIGN_EXPORT_DIR).')
if (options.push && !options.commit) fail('--push sends a commit: add --commit.')
const out = path.resolve(options.out)
if (out === root || out.startsWith(root + path.sep)) fail('Export outside the PGMaps checkout, not into it.')

// --- What PGMaps is at ---------------------------------------------------------------------------

const revision = git(root, 'rev-parse', 'HEAD')
const dirty = !!git(root, 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=dirty')
if (dirty && !options['allow-dirty'])
  fail(
    'PGMaps has uncommitted changes. Commit them first, so the export names the commit it came from (or pass --allow-dirty).',
  )

// --- Which files go ------------------------------------------------------------------------------

const dependencies = packageDependencies(root)
const graph = walk(root, toolStarts(root))
const problems = boundaryProblems(root, graph, dependencies)
if (problems.length)
  fail(`The road designer's boundary is broken; run npm run road-design:check-boundary.\n- ${problems.join('\n- ')}`)

const tracked = new Set(trackedFiles(root, ['.']))
const files = new Set()
const packages = new Map(graph.packages)
// Packages the aliased submodule files import (brandkit's fonts read opentype.js) are the build's too.
for (const [pkg, from] of walk(root, ALIAS_ENTRIES).packages) if (!packages.has(pkg)) packages.set(pkg, from)
const add = (rel) => tracked.has(rel) && files.add(rel)

for (const rel of trackedFiles(root, OWN)) add(rel)
for (const rel of graph.reached.keys()) add(rel)
for (const rel of trackedFiles(root, EXTRAS)) add(rel)
for (const rel of trackedFiles(
  root,
  PUBLIC.map((entry) => `public/${entry}`),
))
  add(rel)

// Ambient declarations (`declare module 'brandkit/consumer'`) are never imported: take those beside the files that go.
const folders = new Set([...files].map((rel) => path.posix.dirname(rel)))
for (const rel of tracked) if (rel.endsWith('.d.ts') && folders.has(path.posix.dirname(rel))) files.add(rel)

// A shared file's own tests go too, when everything they reach can go as well.
let sharedTests = 0
for (const rel of [...graph.reached.keys()].filter(isShared)) {
  for (const ext of ['.test.ts', '.test.tsx', '.test.mjs']) {
    const test = rel.replace(/\.(tsx?|m?js)$/, ext)
    if (test === rel || !tracked.has(test) || files.has(test) || test in SHARED_TESTS_LEFT_OUT) continue
    const testGraph = walk(root, [test])
    if (boundaryProblems(root, testGraph, dependencies).length) continue
    for (const reached of testGraph.reached.keys()) add(reached)
    for (const [pkg, from] of testGraph.packages) if (!packages.has(pkg)) packages.set(pkg, from)
    sharedTests++
  }
}

// Files a test reads by path (`testdata/`, `fixtures/` beside it) rather than by import.
const testFolders = new Set(
  [...files]
    .filter((rel) => /\.test\.(tsx?|m?js)$/.test(rel))
    .flatMap((rel) => TEST_DATA_FOLDERS.map((name) => `${path.posix.dirname(rel)}/${name}/`)),
)
for (const rel of tracked) if ([...testFolders].some((folder) => rel.startsWith(folder))) files.add(rel)

// --- What is generated ---------------------------------------------------------------------------

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const builtin = (pkg) => pkg.startsWith('node:') || (!installedVersion(root, pkg) && !dependencies.has(pkg))
const versionOf = (pkg) => dependencies.get(pkg) ?? `^${installedVersion(root, pkg)}`

const runtime = {}
for (const pkg of [...packages.keys()].sort()) {
  if (ALIASED_PACKAGES.includes(pkg) || builtin(pkg) || DEV_PACKAGES.includes(pkg)) continue
  runtime[pkg] = versionOf(pkg)
}
const development = Object.fromEntries(DEV_PACKAGES.map((pkg) => [pkg, versionOf(pkg)]))
for (const pkg of Object.keys(development)) delete runtime[pkg]

const generated = new Map()
generated.set(
  'package.json',
  `${JSON.stringify(
    {
      name: 'forestry-road-design',
      version: rootPackage.version,
      private: true,
      type: 'module',
      description: 'The forestry road designer, exported from PGMaps.',
      scripts: {
        prepare: 'npm run toolkit:build && node scripts/ensure-tourkit.mjs',
        dev: 'vite --config vite.road-design.config.ts',
        build:
          'vite build --config vite.road-design.config.ts && node standalone/forestry-road-design/verify-build.mjs',
        preview: 'vite preview --config vite.road-design.config.ts',
        typecheck: 'tsc -b',
        test: 'vitest run',
        'check-boundary': 'node scripts/road-design/check-boundary.mjs',
        ...Object.fromEntries(PACKAGE_SCRIPTS.map((name) => [name, rootPackage.scripts[name]])),
      },
      engines: rootPackage.engines,
      workspaces: ['packages/geo-toolkit'],
      dependencies: { '@pgmaps/geo-toolkit': 'file:packages/geo-toolkit', ...runtime },
      devDependencies: development,
      overrides: rootPackage.overrides,
    },
    null,
    2,
  )}\n`,
)

const rootTsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'))
generated.set(
  'tsconfig.json',
  `${JSON.stringify({ ...rootTsconfig, include: ['src', 'standalone/forestry-road-design/main.tsx'] }, null, 2)}\n`,
)
const nodeTsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.node.json'), 'utf8'))
generated.set(
  'tsconfig.node.json',
  `${JSON.stringify({ ...nodeTsconfig, include: ['vite.road-design.config.ts'] }, null, 2)}\n`,
)
files.delete('tsconfig.node.json')

generated.set(
  'vitest.config.ts',
  `import path from 'node:path'
import { defineConfig } from 'vitest/config'

// As PGMaps' vitest.config.ts, for the exported files only.
export default defineConfig({
  resolve: {
    alias: {
      'brandkit/consumer': path.resolve(__dirname, 'vendor/brandkit/src/engine/consumer.js'),
      'brandkit/fonts': path.resolve(__dirname, 'vendor/brandkit/src/fonts/provider.js'),
      'brandkit/pack/host': path.resolve(__dirname, 'vendor/brandkit/src/pack/host.js'),
      '@': path.resolve(__dirname, 'src'),
      '@pgmaps/geo-toolkit': path.resolve(__dirname, 'packages/geo-toolkit/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.test.mjs'],
  },
})
`,
)

generated.set(
  '.gitignore',
  `node_modules
dist
.env.local
.env.*.local
*.tsbuildinfo
`,
)

const pins = SUBMODULES.map((sub) => {
  const [, , sha] = git(root, 'ls-tree', 'HEAD', sub).split(/\s+/)
  const url = git(root, 'config', '-f', '.gitmodules', `submodule.${sub}.url`)
  return { path: sub, url, sha }
})
generated.set(
  '.gitmodules',
  pins.map((pin) => `[submodule "${pin.path}"]\n\tpath = ${pin.path}\n\turl = ${pin.url}\n`).join(''),
)

generated.set(
  '.github/workflows/build.yml',
  `name: Build

# Builds the standalone road designer and, when the repository variable ROAD_DESIGN_DEPLOY_PAGES is
# "true", deploys it to GitHub Pages. Where it is served comes from repository variables, never this
# file: ROAD_DESIGN_BASE ("/" at a domain's root, "/<repo>/" for a project site) and any
# VITE_ROAD_DESIGN_* or VITE_DATA_HOSTS value that should differ from standalone/forestry-road-design/.env.
# Generated by PGMaps' scripts/road-design/export.mjs: a change made here is replaced by the next export.
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: build-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      ROAD_DESIGN_BASE: \${{ vars.ROAD_DESIGN_BASE || '/' }}
      VITE_ROAD_DESIGN_PATH: \${{ vars.VITE_ROAD_DESIGN_PATH }}
      VITE_ROAD_DESIGN_GALLERY_URL: \${{ vars.VITE_ROAD_DESIGN_GALLERY_URL }}
      VITE_ROAD_DESIGN_LIDAR_MIRROR: \${{ vars.VITE_ROAD_DESIGN_LIDAR_MIRROR }}
      VITE_DATA_HOSTS: \${{ vars.VITE_DATA_HOSTS }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run prepare
      - run: npm run check-boundary
      - run: npx tsc -b
      - run: npx vitest run
      - name: Build
        # A repository variable left unset arrives empty, and an empty value would replace .env's default.
        run: |
          for name in VITE_ROAD_DESIGN_PATH VITE_ROAD_DESIGN_GALLERY_URL VITE_ROAD_DESIGN_LIDAR_MIRROR VITE_DATA_HOSTS; do
            if [ -z "\${!name}" ]; then unset "$name"; fi
          done
          npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: standalone/forestry-road-design/dist

  deploy:
    needs: build
    if: vars.ROAD_DESIGN_DEPLOY_PAGES == 'true' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`,
)

const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const sections = agents
  .split(/^(?=## )/m)
  .filter((part) => AGENT_SECTIONS.some((heading) => part.startsWith(`## ${heading}\n`)))
if (sections.length !== AGENT_SECTIONS.length)
  fail(`AGENTS.md is missing one of the sections the export carries: ${AGENT_SECTIONS.join(', ')}.`)
generated.set(
  'AGENTS.md',
  `# Forestry road designer: agent instructions

This repository is exported from PGMaps (\`ahzs645/PGMaps\`, \`scripts/road-design/export.mjs\`) and is
replaced file by file at each export. Make lasting changes in PGMaps; a change made only here is
overwritten. Files the export does not list in \`${RECORD}\` are this repository's own and are kept.
These sections are PGMaps' own instructions for the files exported here; paths are the same.

${sections.join('').trim()}
`,
)

generated.set(
  'README.md',
  `# Forestry road designer

The forestry road designer and its help, exported from
[PGMaps](https://github.com/ahzs645/PGMaps) at \`${revision.slice(0, 12)}\`${dirty ? ' (with uncommitted changes)' : ''}.
PGMaps is where it is developed; this repository is a snapshot of it, replaced at each export.

## Build

\`\`\`bash
git submodule update --init
\`\`\`

\`\`\`bash
npm ci
\`\`\`

\`\`\`bash
npm run build
\`\`\`

The site is \`standalone/forestry-road-design/dist/\`. \`npm run dev\` serves it locally.

## Where it is deployed

Nothing about the deployment is written into the code. \`standalone/forestry-road-design/.env\`
holds the defaults; override them in \`.env.production.local\` beside it, in the build's environment,
or as repository variables for \`.github/workflows/build.yml\`:

| Variable | Default | What it sets |
| --- | --- | --- |
| \`ROAD_DESIGN_BASE\` | \`/\` | The path the site is served from (\`/road-design/\` under a subpath) |
| \`VITE_ROAD_DESIGN_PATH\` | \`/\` | The designer's route below that path; the help is at \`help\` |
| \`VITE_ROAD_DESIGN_GALLERY_URL\` | PGMaps' gallery | *Symbol gallery*'s link, or empty for none |
| \`VITE_ROAD_DESIGN_LIDAR_MIRROR\` | PGMaps' copy | Where the LiDAR sample terrain is read when the site has none |
| \`VITE_DATA_HOSTS\` | PGMaps' data | Hosts for the data folders the designer reads |

Set \`ROAD_DESIGN_DEPLOY_PAGES\` to \`true\` to deploy to GitHub Pages from \`main\`.

## Checks

\`npm run check-boundary\`, \`npm run typecheck\` and \`npm test\` run here as in PGMaps. Browser
(Playwright) suites stay in PGMaps.

Full guide: \`docs/forestry-road-design/standalone-build.md\`.
`,
)

// --- Writing ---------------------------------------------------------------------------------------

const written = new Map()
for (const rel of [...files].sort()) written.set(rel, fs.readFileSync(path.join(root, rel)))
for (const [rel, text] of generated) written.set(rel, Buffer.from(text))
const record = {
  schema: SCHEMA,
  source: { repository: 'https://github.com/ahzs645/PGMaps', revision, dirty },
  submodules: pins,
  files: [...written.keys(), RECORD, ...(options.lock ? ['package-lock.json'] : [])].sort(),
}
written.set(RECORD, Buffer.from(`${JSON.stringify(record, null, 2)}\n`))

const summary = `${written.size} files (${files.size} from PGMaps, ${sharedTests} shared tests, ${generated.size + 1} generated), ${Object.keys(runtime).length} packages, submodules ${pins.map((pin) => `${pin.path}@${pin.sha.slice(0, 7)}`).join(', ')}`
if (options['dry-run']) {
  console.log(`Would export ${summary} to ${out}.`)
  process.exit(0)
}

fs.mkdirSync(out, { recursive: true })
if (!fs.existsSync(path.join(out, '.git'))) {
  if (fs.readdirSync(out).length) fail(`${out} is not a git repository and is not empty.`)
  git(out, 'init', '--quiet', '--initial-branch', options.branch)
}

const previous = (() => {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(out, RECORD), 'utf8'))
    return old.schema === SCHEMA ? old : null
  } catch {
    return null
  }
})()

const removed = []
for (const rel of previous?.files ?? []) {
  if (written.has(rel) || (options.lock && rel === 'package-lock.json')) continue
  const abs = path.join(out, rel)
  if (fs.existsSync(abs)) {
    fs.rmSync(abs)
    removed.push(rel)
    // Drop folders the removal emptied, up to the target's root.
    for (let dir = path.dirname(abs); dir !== out && fs.readdirSync(dir).length === 0; dir = path.dirname(dir))
      fs.rmdirSync(dir)
  }
}
let changed = 0
for (const [rel, bytes] of written) {
  const abs = path.join(out, rel)
  if (fs.existsSync(abs) && fs.readFileSync(abs).equals(bytes)) continue
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, bytes)
  // Keep scripts runnable as they are in PGMaps.
  if (fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.mode & 0o111) fs.chmodSync(abs, 0o755)
  changed++
}
// Submodules are recorded at PGMaps' pinned commits, as gitlinks: the other repository builds what PGMaps tested.
for (const pin of pins) {
  const abs = path.join(out, pin.path)
  if (fs.existsSync(abs) && !fs.existsSync(path.join(abs, '.git')) && fs.readdirSync(abs).length)
    fail(`${pin.path} in ${out} holds files but is not a submodule checkout; remove it and export again.`)
  git(out, 'update-index', '--add', '--cacheinfo', `160000,${pin.sha},${pin.path}`)
}

// PGMaps' lockfile, pruned by npm to what the exported package.json names: the same tested versions.
if (options.lock) {
  if (!fs.existsSync(path.join(out, 'packages/geo-toolkit/package.json')))
    execFileSync('git', ['submodule', 'update', '--init', 'packages/geo-toolkit'], { cwd: out, stdio: 'inherit' })
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(out, 'package-lock.json'))
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: out,
    stdio: 'inherit',
  })
  written.set('package-lock.json', fs.readFileSync(path.join(out, 'package-lock.json')))
}

console.log(`Exported ${summary} to ${out}: ${changed} written, ${removed.length} removed.`)

if (options.commit) {
  git(out, 'add', '--', ...written.keys())
  if (removed.length) git(out, 'rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...removed)
  const staged = git(out, 'diff', '--cached', '--name-only')
  if (!staged) console.log('Nothing changed since the last export; no commit made.')
  else {
    git(
      out,
      'commit',
      '--quiet',
      '-m',
      `Export the road designer from PGMaps ${revision.slice(0, 12)}${dirty ? ' (dirty)' : ''}`,
      '-m',
      `Source: https://github.com/ahzs645/PGMaps/commit/${revision}`,
    )
    console.log(`Committed ${git(out, 'rev-parse', '--short', 'HEAD')} in ${out}.`)
  }
  if (options.push) {
    execFileSync('git', ['push', options.push, `HEAD:${options.branch}`], { cwd: out, stdio: 'inherit' })
    console.log(`Pushed to ${options.push} ${options.branch}.`)
  }
}
