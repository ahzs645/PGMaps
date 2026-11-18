// document-kit (vendor/document-kit, docs/document-kit.md) writes the VIA report's Word file and lays it out to a PDF.
// Its package entries point at dist/, which the submodule does not commit, so the kit is built here before the dev
// server, the build and the checks: when dist/ is missing, or older than anything it is built from. The kit builds
// with its own pinned tools from its own lockfile (`npm ci` inside the submodule), never with PGMaps' node_modules.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kit = join(root, 'vendor', 'document-kit')

if (!existsSync(join(kit, 'package.json'))) {
  console.error(
    '\nvendor/document-kit is an empty git submodule. Initialize it first:\n\n' +
      '  git submodule update --init vendor/document-kit\n',
  )
  process.exit(1)
}

/** The entries the app imports; the build is stale when one is missing or older than a source. */
const ENTRIES = ['index.js', 'docx.js', 'layout.js', 'types/index.d.ts', 'types/layout/index.d.ts']
/** What the build reads, besides src/. */
const INPUTS = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.build.json']

function newest(path) {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.mtimeMs
  let latest = stat.mtimeMs
  for (const name of readdirSync(path)) latest = Math.max(latest, newest(join(path, name)))
  return latest
}

const built = ENTRIES.map((entry) => join(kit, 'dist', entry))
const oldestBuilt = Math.min(...built.map((path) => (existsSync(path) ? statSync(path).mtimeMs : 0)))
const newestSource = Math.max(newest(join(kit, 'src')), ...INPUTS.map((name) => newest(join(kit, name))))
if (oldestBuilt > 0 && oldestBuilt >= newestSource) process.exit(0)

const run = (args) => execFileSync('npm', args, { cwd: kit, stdio: 'inherit' })
try {
  // `npm ci` writes node_modules/.package-lock.json; without it the kit's own tools are not installed (PGMaps' root
  // install only links the kit and adds its runtime dependencies).
  if (newest(join(kit, 'node_modules', '.package-lock.json')) < newest(join(kit, 'package-lock.json'))) {
    console.log('Installing vendor/document-kit’s build tools…')
    run(['ci', '--no-audit', '--no-fund'])
  }
  console.log('Building vendor/document-kit…')
  run(['run', 'build'])
} catch {
  console.error(
    '\nFailed to build vendor/document-kit. Try:\n\n' +
      '  npm --prefix vendor/document-kit ci\n  npm --prefix vendor/document-kit run build\n',
  )
  process.exit(1)
}
