import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
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
  'dev/flatten',
  'dev/flatten/pg',
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
  'dev/transit',
  'dev/projects',
  'dev/nechako',
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
// Give static hosts real entry points for the registered project deep routes.
const projectsRoot = join(root, 'public', 'data', 'projects')
if (existsSync(projectsRoot)) {
  for (const filename of readdirSync(projectsRoot)) {
    if (!filename.endsWith('.json') || filename === 'index.json') continue
    const slug = filename.slice(0, -5)
    if (!/^[a-z0-9-]+$/.test(slug)) continue
    const entry = join(root, 'dist', 'dev', 'projects', slug, 'index.html')
    mkdirSync(dirname(entry), { recursive: true })
    copyFileSync(indexPath, entry)
  }
}
console.log(`[spa] copied route and project entry points`)
