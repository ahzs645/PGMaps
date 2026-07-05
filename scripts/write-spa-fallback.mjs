import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = join(root, 'dist', 'index.html')
const fallbackPath = join(root, 'dist', '404.html')
const spaRoutes = [
  'explorer',
  'foodmap',
  'airquality',
  'pgdata',
  'census',
  'socioeconomic',
  'parks',
  'score-builder',
  'misc',
  'bc-assessment',
  'dev',
  'dev/boundaries',
  'dev/design',
  'dev/interact',
  'dev/interact/sewage',
  'dev/wait',
  'dev/wait/specialist',
  'dev/fallout',
  'dev/acknowledgement',
  'dev/health/msp',
  'dev/networks',
  'dev/projects',
  'dev/aqmap',
  'dev/aqmap/main',
  'dev/aqmap/ring',
]

if (!existsSync(indexPath)) {
  console.error('[spa] dist/index.html does not exist; run vite build first')
  process.exit(1)
}

copyFileSync(indexPath, fallbackPath)
console.log('[spa] copied dist/index.html -> dist/404.html')

for (const route of spaRoutes) {
  const routeIndexPath = join(root, 'dist', route, 'index.html')
  mkdirSync(dirname(routeIndexPath), { recursive: true })
  copyFileSync(indexPath, routeIndexPath)
}
console.log(`[spa] copied dist/index.html -> ${spaRoutes.length} route fallback(s)`)
