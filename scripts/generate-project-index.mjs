import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectsDir = path.join(repoRoot, 'public/data/projects')
const indexPath = path.join(projectsDir, 'index.json')
const checkOnly = process.argv.includes('--check')

async function listJsonFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(path.join(directory, entry.name), relativePath)))
    } else if (entry.isFile() && entry.name.endsWith('.json') && relativePath !== 'index.json') {
      files.push(relativePath)
    }
  }

  return files
}

function previousProjectOrder(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.projects)) return new Map()
    return new Map(
      parsed.projects.flatMap((entry, index) => {
        const file = typeof entry === 'string' ? entry : entry?.file
        return typeof file === 'string' ? [[file, index]] : []
      }),
    )
  } catch {
    return new Map()
  }
}

function compareProjectFiles(left, right, previousOrder) {
  const leftOrder = previousOrder.get(left)
  const rightOrder = previousOrder.get(right)
  if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
  if (leftOrder !== undefined) return -1
  if (rightOrder !== undefined) return 1

  const leftGenerated = left.startsWith('scorebuilder/')
  const rightGenerated = right.startsWith('scorebuilder/')
  if (leftGenerated !== rightGenerated) return leftGenerated ? 1 : -1
  return left.localeCompare(right)
}

// Everything the catalog page renders (listing, preview pane, search, lab
// links) without the heavy layers/scenes/workspace payloads. Embedding these
// in the index lets the catalog load one file instead of one per project.
const CATALOG_FIELDS = [
  'slug',
  'title',
  'kind',
  'theme',
  'owner',
  'created',
  'updated',
  'region',
  'status',
  'summary',
  'sourceNote',
  'details',
  'image',
  'links',
  'catalogMetrics',
  'files',
  'lab',
]

function buildCatalogMetadata(project) {
  const catalog = {}
  for (const field of CATALOG_FIELDS) {
    if (project[field] !== undefined) catalog[field] = project[field]
  }
  catalog.layerCount = Array.isArray(project.layers) ? project.layers.length : 0
  catalog.sceneCount = Array.isArray(project.scenes) ? project.scenes.length : 0
  return catalog
}

async function buildProjectEntries(files) {
  const slugs = new Map()

  return Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(projectsDir, file), 'utf8')
      let project
      try {
        project = JSON.parse(source)
      } catch (error) {
        throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`)
      }

      if (!project || typeof project !== 'object' || typeof project.slug !== 'string' || !project.slug.trim()) {
        throw new Error(`${file} must contain a non-empty project slug`)
      }
      if (typeof project.title !== 'string' || !project.title.trim()) {
        throw new Error(`${file} must contain a non-empty project title`)
      }

      const duplicate = slugs.get(project.slug)
      if (duplicate) throw new Error(`Duplicate project slug "${project.slug}" in ${duplicate} and ${file}`)
      slugs.set(project.slug, file)

      return {
        file,
        revision: createHash('sha256').update(source).digest('hex').slice(0, 12),
        catalog: buildCatalogMetadata(project),
      }
    }),
  )
}

async function main() {
  const previous = await readFile(indexPath, 'utf8').catch(() => '')
  const order = previousProjectOrder(previous)
  const files = (await listJsonFiles(projectsDir)).sort((left, right) => compareProjectFiles(left, right, order))
  const projects = await buildProjectEntries(files)
  const output = `${JSON.stringify({ version: 1, projects }, null, 2)}\n`

  if (checkOnly) {
    if (previous !== output) {
      throw new Error('public/data/projects/index.json is stale; run npm run projects:index')
    }
    console.log(`Project index is current (${projects.length} packages).`)
    return
  }

  await writeFile(indexPath, output)
  console.log(`Indexed ${projects.length} project packages.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
