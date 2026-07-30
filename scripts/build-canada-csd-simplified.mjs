#!/usr/bin/env node
/* global Buffer, console, process */
// Derives a lightweight national census-subdivision boundary file from the
// full-detail canada-csd province chunks that data:sync-from-bcdatamapper
// copies into public/data. The output is generated at build time (predev /
// prebuild) and lives under the gitignored public/data tree, so the simplified
// copy is never committed alongside the full-detail source data.
//
// Pass --if-missing to skip the rebuild when the output is newer than every
// input (used by predev/prebuild); pass nothing to force a rebuild.

import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { area, polygon, simplify } from '@turf/turf'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(root, 'public', 'data', 'census', 'canada-csd')
const manifestPath = path.join(sourceDir, 'manifest.json')
const outputPath = path.join(root, 'public', 'data', 'census', 'canada-csd-simplified.geojson')

// Tuning knobs: raise the tolerance or area floors for a smaller file, lower
// them for more fidelity. The floors are what remove the thousands of tiny
// coastal islands and slivers that dominate the full file's vertex count.
const SIMPLIFY_TOLERANCE_DEG = 0.01
const MIN_POLYGON_KM2 = 4
const MIN_HOLE_KM2 = 8
const COORD_DECIMALS = 3

const KEEP_PROPERTIES = [
  'id',
  'boundaryId',
  'boundaryCode',
  'boundaryName',
  'boundarySource',
  'boundaryLevel',
  'CSDUID',
  'CSDNAME',
  'CSDTYPE',
  'CDUID',
  'PRUID',
  'areaKm2',
  'north_south',
  'north_south_code',
]

function ringAreaKm2(ring) {
  return area(polygon([ring])) / 1_000_000
}

function roundRing(ring) {
  const rounded = []
  for (const [lng, lat] of ring) {
    const point = [Number(lng.toFixed(COORD_DECIMALS)), Number(lat.toFixed(COORD_DECIMALS))]
    const previous = rounded[rounded.length - 1]
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue
    rounded.push(point)
  }
  const first = rounded[0]
  const last = rounded[rounded.length - 1]
  if (first && (first[0] !== last[0] || first[1] !== last[1])) rounded.push([first[0], first[1]])
  // A closed ring needs at least a triangle (3 distinct points + closure).
  return rounded.length >= 4 ? rounded : null
}

function simplifyPolygons(polygons) {
  const keptBySize = polygons
    .map((rings) => ({ rings, areaKm2: ringAreaKm2(rings[0]) }))
    .sort((a, b) => b.areaKm2 - a.areaKm2)
  // Always keep the largest polygon so every CSD stays on the map, even the
  // ones made only of small islands.
  const kept = keptBySize.filter((entry, index) => index === 0 || entry.areaKm2 >= MIN_POLYGON_KM2)

  const result = []
  for (const { rings } of kept) {
    const [outer, ...holes] = rings
    const keptHoles = holes.filter((ring) => ringAreaKm2(ring) >= MIN_HOLE_KM2)
    const simplified = simplify(
      polygon([outer, ...keptHoles]),
      { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false, mutate: true },
    )
    const [simplifiedOuter, ...simplifiedHoles] = simplified.geometry.coordinates
    const roundedOuter = roundRing(simplifiedOuter)
    if (!roundedOuter) continue
    const roundedHoles = simplifiedHoles.map(roundRing).filter((ring) => ring !== null)
    result.push([roundedOuter, ...roundedHoles])
  }
  return result
}

function simplifyFeature(feature) {
  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
  let simplified = simplifyPolygons(polygons)
  if (simplified.length === 0) {
    // Simplification collapsed everything (micro island CSDs): fall back to the
    // largest source polygon, rounded but unsimplified.
    const largest = polygons
      .map((rings) => ({ rings, areaKm2: ringAreaKm2(rings[0]) }))
      .sort((a, b) => b.areaKm2 - a.areaKm2)[0]
    const outer = roundRing(largest.rings[0])
    if (!outer) return null
    simplified = [[outer]]
  }

  const properties = {}
  for (const key of KEEP_PROPERTIES) {
    if (feature.properties?.[key] != null) properties[key] = feature.properties[key]
  }

  return {
    type: 'Feature',
    geometry: simplified.length === 1
      ? { type: 'Polygon', coordinates: simplified[0] }
      : { type: 'MultiPolygon', coordinates: simplified },
    properties,
  }
}

function countVertices(features) {
  let count = 0
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      count += 1
      return
    }
    for (const entry of coords) visit(entry)
  }
  for (const feature of features) visit(feature.geometry.coordinates)
  return count
}

async function isUpToDate(inputPaths) {
  try {
    const outputStat = await fs.stat(outputPath)
    const inputStats = await Promise.all(inputPaths.map((inputPath) => fs.stat(inputPath)))
    return inputStats.every((stat) => stat.mtimeMs <= outputStat.mtimeMs)
  } catch {
    return false
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const inputPaths = [
    manifestPath,
    fileURLToPath(import.meta.url),
    ...manifest.chunks.map((chunk) => path.join(sourceDir, chunk.path)),
  ]

  if (process.argv.includes('--if-missing') && (await isUpToDate(inputPaths))) {
    console.log(`[canada-csd-simplified] up to date: ${path.relative(root, outputPath)}`)
    return
  }

  const features = []
  let sourceVertices = 0
  for (const chunk of manifest.chunks) {
    const collection = JSON.parse(await fs.readFile(path.join(sourceDir, chunk.path), 'utf8'))
    sourceVertices += countVertices(collection.features)
    for (const feature of collection.features) {
      const simplified = simplifyFeature(feature)
      if (simplified) features.push(simplified)
    }
  }

  features.sort((a, b) => String(a.properties.CSDUID).localeCompare(String(b.properties.CSDUID)))
  const text = JSON.stringify({ type: 'FeatureCollection', features })
  await fs.writeFile(outputPath, text)

  const outputVertices = countVertices(features)
  const rawMiB = (Buffer.byteLength(text) / 1024 / 1024).toFixed(1)
  const gzipMiB = (gzipSync(text, { level: 9 }).byteLength / 1024 / 1024).toFixed(1)
  console.log(
    `[canada-csd-simplified] ${features.length.toLocaleString()} features, ` +
    `${sourceVertices.toLocaleString()} -> ${outputVertices.toLocaleString()} vertices, ` +
    `${rawMiB} MiB raw (${gzipMiB} MiB gzip) -> ${path.relative(root, outputPath)}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
