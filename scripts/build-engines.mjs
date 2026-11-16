// Builds the road view's other renderers that run as workers PGMaps starts itself (externalRenderers.ts,
// `worker`), from their submodules, into public/engines/<id>/: generated output, git-ignored, served beside the app so
// the worker is same-origin. Each engine's own build makes the bundle (its plugins and aliases stay its own business);
// this only installs its dependencies when they are missing, runs it and copies the result.
//
//   node scripts/build-engines.mjs            build every engine whose output is older than its submodule's commit
//   node scripts/build-engines.mjs --force    build them all again
//   node scripts/build-engines.mjs --if-ready skip (with a note) an engine whose submodule is not checked out
//
// An engine's output records the commit it was built from (engine.json), so an unchanged submodule costs nothing.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const ifReady = args.has('--if-ready')

/** The engines PGMaps runs as workers: their submodule, the script that builds the worker, and where it lands. */
const ENGINES = [
  {
    id: 'nanite',
    label: 'Nanite Forest',
    submodule: 'vendor/threejs-nanites',
    script: 'build:pgmaps-worker',
    output: 'dist-pgmaps-worker',
    entry: 'pgmaps-engine.js',
  },
  {
    id: 'worldgen',
    label: 'threejs-worldgen',
    submodule: 'vendor/threejs-worldgen',
    script: 'build:pgmaps-worker',
    output: 'dist-pgmaps-worker',
    entry: 'pgmaps-engine.js',
  },
]

const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, encoding: 'utf8' }).trim()

let failed = false
for (const engine of ENGINES) {
  const source = join(root, engine.submodule)
  const target = join(root, 'public', 'engines', engine.id)
  if (!existsSync(join(source, 'package.json'))) {
    const note = `${engine.label}: ${engine.submodule} is not checked out (git submodule update --init ${engine.submodule}).`
    if (ifReady) {
      console.log(`${note} Skipped; the road view will say it is not built.`)
      continue
    }
    console.error(note)
    failed = true
    continue
  }
  const commit = git(source, 'rev-parse', 'HEAD')
  const dirty = git(source, 'status', '--porcelain', '--untracked-files=no') !== ''
  const stamp = join(target, 'engine.json')
  const built = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : null
  if (!force && !dirty && built?.commit === commit && existsSync(join(target, engine.entry))) {
    console.log(`${engine.label}: up to date (${commit.slice(0, 7)}).`)
    continue
  }
  if (!existsSync(join(source, 'node_modules'))) {
    console.log(`${engine.label}: installing its dependencies…`)
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: source, stdio: 'inherit' })
  }
  console.log(
    `${engine.label}: building its worker (${commit.slice(0, 7)}${dirty ? ', with uncommitted changes' : ''})…`,
  )
  execFileSync('npm', ['run', engine.script], { cwd: source, stdio: 'inherit' })
  const output = join(source, engine.output)
  if (!existsSync(join(output, engine.entry))) {
    console.error(`${engine.label}: its build made no ${engine.output}/${engine.entry}.`)
    failed = true
    continue
  }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(output, target, { recursive: true })
  writeFileSync(
    stamp,
    `${JSON.stringify({ id: engine.id, commit, dirty, entry: engine.entry, built: new Date().toISOString() }, null, 2)}\n`,
  )
  console.log(`${engine.label}: public/engines/${engine.id}/${engine.entry}`)
}
if (failed) process.exit(1)
