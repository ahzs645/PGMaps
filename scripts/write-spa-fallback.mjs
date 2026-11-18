import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iconType, pageIconFor, parsePageIcons } from '../src/lib/pageIcons.ts'

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
  'labs',
  'density-lab',
  'correlation-lab',
  'projects',
  'dev',
  'dev/view',
  'dev/georeference',
  'dev/view/edit',
  'dev/lidar',
  ...[
    'coverage',
    'canopy',
    'trees',
    'forestry',
    'species',
    'buildings',
    'transects',
    'compare',
    'volume',
    'inventory',
    'data',
    'restoration',
  ].map((tool) => `dev/lidar/${tool}`),
  'dev/forestry',
  ...[
    'road-design',
    'roads',
    'visual-quality',
    'cciss-suitability',
    'avast-volume',
    'drought-risk',
    'road-restoration',
    'thlb-impact',
    'castor',
    'block-sheets',
  ].map((tool) => `dev/forestry/${tool}`),
  'dev/gov',
  'dev/mmgis',
  'dev/viewshed',
  'dev/viewshed/terrain',
  'dev/flatten',
  'dev/flatten/pg',
  'dev/boundaries',
  'dev/boundaries/bcer',
  'dev/design',
  'dev/interact',
  'dev/interact/sewage',
  'dev/wait',
  'dev/wait/specialist',
  'dev/health/wait',
  'dev/health/wait/specialist',
  'dev/fallout',
  'dev/acknowledgement',
  'dev/health/msp',
  'dev/networks',
  'dev/transit',
  'dev/projects',
  'dev/nechako',
  'dev/nechako/portal',
  'dev/aqmap',
  'dev/aqmap/main',
  'dev/aqmap/ring',
  'dev/data',
  'dev/load',
  'dev/outdoors',
  'dev/water-temperature',
  'dev/color-palettes',
  'dev/climate-vulnerability',
  'dev/early-learning',
  'help',
]

if (!existsSync(indexPath)) {
  console.error('[spa] dist/index.html does not exist; run vite build first')
  process.exit(1)
}

copyFileSync(indexPath, fallbackPath)
console.log('[spa] copied dist/index.html -> dist/404.html')

// Each entry page names its route's tab icon (src/config/page-icons.json, docs/page-icons.md), so the
// tab is right before the app's script runs; the shell's `usePageIcon` keeps it right after that.
const indexHtml = readFileSync(indexPath, 'utf8')
const pageIcons = parsePageIcons(JSON.parse(readFileSync(join(root, 'src', 'config', 'page-icons.json'), 'utf8')))
const iconLink = /<link rel="icon" type="[^"]*" href="([^"]*)"\s*\/?>/
const shellIcon = indexHtml.match(iconLink)
if (!shellIcon || !shellIcon[1].endsWith(`/${pageIcons.default}`)) {
  console.error(`[spa] dist/index.html has no <link rel="icon"> naming ${pageIcons.default}`)
  process.exit(1)
}
const iconBase = shellIcon[1].slice(0, -pageIcons.default.length)
const writeEntry = (target, route) => {
  const icon = pageIconFor(pageIcons, `/${route}`)
  mkdirSync(dirname(target), { recursive: true })
  if (icon === pageIcons.default) return copyFileSync(indexPath, target)
  writeFileSync(
    target,
    indexHtml.replace(iconLink, `<link rel="icon" type="${iconType(icon)}" href="${iconBase}${icon}" />`),
  )
}

for (const route of spaRoutes) writeEntry(join(root, 'dist', route, 'index.html'), route)
// Give static hosts real entry points for the registered project deep routes.
const projectsRoot = join(root, 'public', 'data', 'projects')
if (existsSync(projectsRoot)) {
  for (const filename of readdirSync(projectsRoot)) {
    if (!filename.endsWith('.json') || filename === 'index.json') continue
    const slug = filename.slice(0, -5)
    if (!/^[a-z0-9-]+$/.test(slug)) continue
    // /projects/<slug> is the canonical story URL; /dev/projects/<slug> is kept for old links.
    for (const base of [['projects'], ['dev', 'projects']]) {
      const entry = join(root, 'dist', ...base, slug, 'index.html')
      mkdirSync(dirname(entry), { recursive: true })
      copyFileSync(indexPath, entry)
    }
  }
}
// The road designer's help: a page per lesson (`/help/<lesson>`), and an entry at each address of the
// old static help (`<lesson>/tour.html`, `ribbon.html`), which the app redirects to the lesson's page.
const lessonsRoot = join(root, 'src', 'pages', 'dev-forestry-roads', 'tours', 'lessons')
const helpEntries = ['help/ribbon.html']
for (const filename of readdirSync(lessonsRoot)) {
  if (!filename.endsWith('.json')) continue
  const lesson = filename.slice(0, -5)
  helpEntries.push(`help/${lesson}/index.html`, `help/${lesson}/tour.html`)
}
for (const entry of helpEntries) writeEntry(join(root, 'dist', ...entry.split('/')), dirname(entry))
console.log(`[spa] copied route and project entry points`)
