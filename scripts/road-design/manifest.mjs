/**
 * What the forestry road designer is, as files: one list that the boundary check
 * (`check-boundary.mjs`), the standalone build (`vite.road-design.config.ts`) and the export
 * (`export.mjs`) all read, so the three cannot drift apart. Guide:
 * docs/forestry-road-design/standalone-build.md.
 */

/** The tool's own code. It may import itself and `shared`, never another page. */
export const OWN = [
  'src/pages/dev-forestry-roads/',
  'src/pages/help/',
  'src/pages/ForestryRoadWorkspace.tsx',
  'src/pages/DevForestryRoads.tsx',
  'standalone/forestry-road-design/',
]

/** The standalone build's entries: everything the designer and its help reach starts here. */
export const ENTRIES = [
  'standalone/forestry-road-design/main.tsx',
  // What `vite.road-design.config.ts` aliases bare `maplibre-gl` to: no import names it.
  'src/lib/maplibre-gl-entry.ts',
]

/**
 * Code shared across PGMaps that the tool may use. A file reached here must itself stay out of every
 * page (`src/pages`, `src/maps`, `src/features`, the app shell), or the tool cannot leave PGMaps.
 */
export const SHARED = [
  'src/lib/',
  'src/components/',
  'src/hooks/',
  'src/branding/',
  'src/config/',
  'src/types/',
  'src/index.css',
  'src/vite-env.d.ts',
]

/** Folders and files from `public/` the designer loads at run time, copied into its build as they are. */
export const PUBLIC = ['brand', 'help', 'interface-previews', 'workspace-layouts.json', 'favicon.svg']

/** Packages resolved by Vite aliases rather than `node_modules` (`vite.road-design.config.ts`). */
export const ALIASED_PACKAGES = ['brandkit']

/** The files those aliases point to, inside submodules: walked only for the npm packages they import. */
export const ALIAS_ENTRIES = [
  'vendor/brandkit/src/engine/consumer.js',
  'vendor/brandkit/src/fonts/provider.js',
  'vendor/brandkit/src/pack/host.js',
]

/**
 * Submodules the tool builds against. The export records each at PGMaps' pinned commit, so the other
 * repository builds exactly what PGMaps tested.
 */
export const SUBMODULES = ['packages/geo-toolkit', 'vendor/brandkit']

/**
 * Everything else the tool owns that no import reaches: the cable optimizer's Rust source and its
 * build, the scripts that regenerate its committed data, and its guides.
 */
export const EXTRAS = [
  'crates/cable-layout/',
  'scripts/build-cable-wasm.mjs',
  'scripts/ensure-tourkit.mjs',
  'scripts/postcss/',
  'scripts/forestry/cost-evidence/',
  'scripts/forestry/cable-equipment/',
  'scripts/road-design/',
  'docs/forestry-road-design.md',
  'docs/forestry-road-design/',
  'docs/shared-ui.md',
  'docs/data-hosts.md',
  'vite.road-design.config.ts',
  // Ambient types (`import.meta.env`, module shims) that no import reaches.
  'src/vite-env.d.ts',
  'src/types/',
  'tailwind.config.js',
  'postcss.config.js',
  'tsconfig.node.json',
  '.nvmrc',
  '.prettierrc',
  'LICENSE',
]

/**
 * Shared tests the export leaves out although their imports could go: each reads a PGMaps file that
 * does not (named in its reason).
 */
export const SHARED_TESTS_LEFT_OUT = {
  'src/lib/dataHosts.test.ts': 'reads vendor/bcdatamapper/pages/site.json, which stays in PGMaps',
}

/** Folders beside a test that hold the files it reads by path rather than by import. */
export const TEST_DATA_FOLDERS = ['testdata', 'fixtures', '__fixtures__']

/** `package.json` scripts the export keeps, by name. */
export const PACKAGE_SCRIPTS = [
  'toolkit:build',
  'wasm:cable',
  'cost-evidence:build',
  'cost-evidence:check',
  'cable-equipment:build',
  'cable-equipment:check',
]

/** Development packages the standalone build, type check and unit tests need. */
export const DEV_PACKAGES = [
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@types/react-test-renderer',
  '@types/sql.js',
  '@vitejs/plugin-react',
  'autoprefixer',
  'fake-indexeddb',
  'postcss',
  'prettier',
  'react-test-renderer',
  'tailwindcss',
  'tsx',
  'typescript',
  'vite',
  'vitest',
]

/** The `AGENTS.md` sections that hold for the tool on its own (by `##` heading). */
export const AGENT_SECTIONS = ['Forestry road design', 'MapLibre 6', 'Shared UI']

/**
 * Cloudflare deployment of an export (Workers static assets, `wrangler.jsonc`). The compatibility date
 * moves only on purpose; wrangler runs by `npx` at this version, so it never enters the lockfile.
 */
export const CLOUDFLARE = { compatibilityDate: '2026-11-01', wrangler: '4.163.0' }
