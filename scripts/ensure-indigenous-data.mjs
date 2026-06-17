// /dev/acknowledgement reads the Indigenous support layers from public/data/indigenous/,
// which is gitignored. The data is committed as a snapshot in the bcdatamapper submodule,
// so copy it into place. Non-fatal: a missing submodule/snapshot only affects that one page.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const submodulePkg = join(root, 'vendor', 'bcdatamapper', 'package.json')

if (!existsSync(submodulePkg)) {
  console.warn(
    '[indigenous] vendor/bcdatamapper not initialized; skipping data copy.\n' +
      '            Run: git submodule update --init vendor/bcdatamapper',
  )
  process.exit(0)
}

const result = spawnSync('npm', ['--prefix', 'vendor/bcdatamapper', 'run', 'indigenous:copy', '--'], {
  cwd: root,
  stdio: 'inherit',
})

if (result.status !== 0) {
  console.warn(
    '[indigenous] snapshot copy skipped/failed; /dev/acknowledgement may 404 until you run:\n' +
      '            npm run indigenous:copy   (or npm run indigenous:sync to refresh from source)',
  )
}

process.exit(0)
