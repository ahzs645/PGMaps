// Rebuilds bcdatamapper's national Census Subdivision overview before the data
// sync copies it into public/data/census.
//
// The overview is git-ignored in bcdatamapper, so its --if-missing check never
// finds it in a fresh CI checkout and mapshaper reruns for about two minutes.
// When PGMAPS_SKIP_VENDOR_DATA_SYNC=1 (the deploy build, which restores
// public/data from its cache) the sync that would copy the result is skipped,
// so the rebuild is thrown away: skip it too.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const deployed = join(root, 'public', 'data', 'census', 'canada-csd-simplified.geojson')

if (process.env.PGMAPS_SKIP_VENDOR_DATA_SYNC === '1') {
  if (existsSync(deployed)) {
    console.log('[canada-csd-simplified] skipped: vendor data sync is off and public/data has the overview')
  } else {
    console.warn(
      '[canada-csd-simplified] skipped: vendor data sync is off, so a rebuild would not reach public/data,\n' +
        '                        which has no overview. Run without PGMAPS_SKIP_VENDOR_DATA_SYNC to build it.',
    )
  }
  process.exit(0)
}

const result = spawnSync('npm', ['run', 'census:canada-csd-simplified', '--', '--if-missing'], {
  cwd: root,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
