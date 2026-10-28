#!/usr/bin/env node
/**
 * Builds the /dev/data layer library from the City of Prince George snapshots that
 * bcdatamapper owns. For each dataset listed in `sync-citypg-arcgis.mjs` it records
 * the source service, geometry, row count, file size and the date the snapshot was
 * last committed to the submodule, which is what the page shows as "Snapshot …".
 *
 * Rerun after moving the bcdatamapper pointer:
 *   node scripts/generate-dev-data-catalog.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const submodule = path.join(root, 'vendor/bcdatamapper')
const citypgDir = path.join(submodule, 'datascrapers/citypg')
const syncScript = path.join(citypgDir, 'sync-citypg-arcgis.mjs')
const outputFile = path.join(root, 'src/pages/dev-data/catalog.generated.json')

/** Library groups, matched against the dataset name in order. */
const CATEGORIES = [
  ['OCP 2025', /^OCP/],
  ['Parks', /^Park/],
  ['Ecology', /^Ecology/],
  ['Transportation', /cycle|connector|sidewalk|walkway|traffic|road|intersection|transit|snow/i],
  ['Community', /boundar|civic|catchment|evacuation|garbage|ice rink|business/i],
]

function categoryFor(name) {
  return CATEGORIES.find(([, pattern]) => pattern.test(name))?.[0] ?? 'Other'
}

/** Reads the DATASETS literal without executing the sync script (it fetches on import). */
function parseDatasets(source) {
  const entries = []
  const pattern = /name:\s*'([^']+)',\s*url:\s*'([^']+)',\s*output:\s*'([^']+)'/g
  for (const match of source.matchAll(pattern)) {
    entries.push({ name: match[1], url: match[2], output: match[3] })
  }
  return entries
}

function geometryKind(features) {
  const counts = { fill: 0, line: 0, point: 0 }
  for (const feature of features) {
    const type = feature.geometry?.type ?? ''
    if (type.includes('Polygon')) counts.fill += 1
    else if (type.includes('LineString')) counts.line += 1
    else if (type.includes('Point')) counts.point += 1
  }
  const [kind, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return count > 0 ? kind : null
}

function snapshotDate(relativePath) {
  try {
    return (
      execFileSync('git', ['-C', submodule, 'log', '-1', '--format=%cs', '--', relativePath], {
        encoding: 'utf8',
      }).trim() || null
    )
  } catch {
    return null
  }
}

async function main() {
  const datasets = parseDatasets(await readFile(syncScript, 'utf8'))
  if (datasets.length === 0) throw new Error(`No datasets found in ${syncScript}`)

  const layers = []
  for (const dataset of datasets) {
    const fileName = path.basename(dataset.output)
    const relativePath = path.join('datascrapers/citypg/output', fileName)
    const absolutePath = path.join(submodule, relativePath)
    let collection
    let bytes
    try {
      ;[collection, { size: bytes }] = await Promise.all([
        readFile(absolutePath, 'utf8').then((text) => JSON.parse(text)),
        stat(absolutePath),
      ])
    } catch {
      console.warn(`Skipping ${dataset.name}: ${relativePath} is missing`)
      continue
    }
    const features = Array.isArray(collection.features) ? collection.features : []
    const geometry = geometryKind(features)
    if (!geometry) {
      console.warn(`Skipping ${dataset.name}: no drawable geometry`)
      continue
    }
    layers.push({
      id: fileName.replace(/\.geojson$/, '').replace(/_/g, '-'),
      name: dataset.name,
      category: categoryFor(dataset.name),
      path: `/data/citypg/${fileName}`,
      sourceUrl: dataset.url,
      geometry,
      rowCount: features.length,
      bytes,
      snapshotDate: snapshotDate(relativePath),
    })
  }

  layers.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  await writeFile(outputFile, `${JSON.stringify({ source: 'City of Prince George GIS Hub', layers }, null, 2)}\n`)
  console.log(`Wrote ${layers.length} layers to ${path.relative(root, outputFile)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
