// Dissolves B.C.'s census subdivisions into two monolithic North/South
// polygons for the where-is-north-bc story. The granular per-CSD file stays in
// use for scenes that highlight individual subdivisions; this derived file is
// for scenes that only show the two-way split, where interior CSD seams (and a
// 24 MB payload) are just noise.
//
// Usage: node scripts/build-census-north-south-dissolved.mjs [--if-missing]
//
// public/data/census/ is gitignored: this output is generated data, rebuilt by
// predev/prebuild after the census source has been synced.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

// Same pin as vendor/bcdatamapper's mapshaper-topology pipeline.
const MAPSHAPER_VERSION = '0.6.113'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'public/data/census/canada-csd/provinces/59.geojson.gz')
const OUT = path.join(root, 'public/data/census/canada-csd/bc-north-south-dissolved.geojson')

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  console.log(`[census-north-south-dissolved] up to date: ${path.relative(root, OUT)}`)
  process.exit(0)
}

const workDir = mkdtempSync(path.join(tmpdir(), 'census-dissolve-'))
try {
  const inputPath = path.join(workDir, 'csd.geojson')
  writeFileSync(inputPath, gunzipSync(readFileSync(SRC)))

  execFileSync(
    'npx',
    [
      '--yes',
      `mapshaper@${MAPSHAPER_VERSION}`,
      inputPath,
      'snap',
      '-filter', 'north_south == "North" || north_south == "South"',
      '-dissolve2', 'north_south',
      // The story shows this at province zoom; shave coastline detail and
      // sub-2km² islands that read as noise (and 90% of the file size) there.
      '-simplify', 'interval=150', 'keep-shapes',
      '-filter-islands', 'min-area=2km2',
      '-each', 'label = "Statistical " + north_south',
      '-filter-fields', 'north_south,label',
      '-clean',
      '-o', 'precision=0.00001', OUT,
    ],
    { stdio: 'inherit' },
  )

  const result = JSON.parse(readFileSync(OUT, 'utf8'))
  const summary = result.features
    .map((feature) => `${feature.properties.north_south}: ${feature.geometry.coordinates.length} polygons`)
    .join(', ')
  const sizeMb = (readFileSync(OUT).byteLength / 1024 / 1024).toFixed(1)
  console.log(`wrote ${OUT} (${sizeMb} MB) — ${summary}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
