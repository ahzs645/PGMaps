// Tourkit (the live lessons' player, docs/forestry-road-design/live-lessons.md) is a GitHub
// dependency whose `prepare` script builds its dist/ on install. `npm ci --ignore-scripts`, which the
// checks job runs, installs it without dist/, and every `tourkit/*` import then fails. When dist/ is
// missing this packs the pinned commit, which runs that build, and copies its dist/ into place. An
// ordinary `npm ci` or `npm install` has already built it, so this does nothing then.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installed = join(root, 'node_modules', 'tourkit')

if (!existsSync(join(installed, 'package.json'))) {
  console.error('\nTourkit is not installed. Run `npm ci` (or `npm install`) first.\n')
  process.exit(1)
}
if (existsSync(join(installed, 'dist', 'player.js'))) process.exit(0)

const spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.tourkit
const work = mkdtempSync(join(tmpdir(), 'pgmaps-tourkit-'))
try {
  console.log(`Building Tourkit's dist/ from ${spec} (installed without install scripts)…`)
  execFileSync('npm', ['pack', spec, '--pack-destination', work, '--no-audit', '--no-fund'], {
    cwd: work,
    stdio: 'inherit',
    env: { ...process.env, npm_config_ignore_scripts: 'false' },
  })
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball.')
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', work])
  if (!existsSync(join(work, 'package', 'dist', 'player.js'))) throw new Error('The packed Tourkit has no dist/.')
  cpSync(join(work, 'package', 'dist'), join(installed, 'dist'), { recursive: true })
} finally {
  rmSync(work, { recursive: true, force: true })
}
