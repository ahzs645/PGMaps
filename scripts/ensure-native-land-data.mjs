// /dev/acknowledgement reads Native Land Digital polygon snapshots from
// public/data/native-land/, which is gitignored. The data is committed as a
// snapshot in the bcdatamapper submodule, so copy it into place for local use.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const submodulePkg = join(root, 'vendor', 'bcdatamapper', 'package.json')

if (!existsSync(submodulePkg)) {
  console.warn(
    '[native-land] vendor/bcdatamapper not initialized; skipping data copy.\n' +
      '              Run: git submodule update --init vendor/bcdatamapper',
  )
  process.exit(0)
}

const result = spawnSync('npm', ['--prefix', 'vendor/bcdatamapper', 'run', 'native-land:copy', '--'], {
  cwd: root,
  stdio: 'inherit',
})

if (result.status !== 0) {
  console.warn(
    '[native-land] snapshot copy skipped/failed; /dev/acknowledgement may 404 until you run:\n' +
      '              npm run native-land:copy   (or NATIVE_LAND_API_KEY=... npm run native-land:geojson to refresh from source)',
  )
}

process.exit(0)
