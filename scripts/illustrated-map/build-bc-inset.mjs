#!/usr/bin/env node
/* global console, process */
/**
 * Build a tiny illustration asset from an existing geographic boundary response.
 *
 * Usage: node scripts/illustrated-map/build-bc-inset.mjs /path/to/statcan-bc-2021.json
 *
 * The input is the JSON response at SOURCE_QUERY below. Acquisition and full
 * source archives remain outside this illustration module. This script only
 * projects, simplifies and fits the supplied feature; it never traces pixels.
 * The app uses the generated paths offline and does not import proj4 at runtime.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, URL, URLSearchParams } from 'node:url'
import proj4 from 'proj4'
import { format, resolveConfig } from 'prettier'

const SOURCE_SERVICE = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0'
const SOURCE_QUERY = `${SOURCE_SERVICE}/query?${new URLSearchParams({
  where: "PRUID = '59'",
  outFields: 'PRUID,PRENAME,DGUID',
  returnGeometry: 'true',
  outSR: '4269',
  maxAllowableOffset: '0.005',
  geometryPrecision: '6',
  f: 'json',
})}`
const SOURCE_CRS = '+proj=longlat +datum=NAD83 +no_defs'
const WORKING_CRS =
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs'
const MAXIMUM_EFFECTIVE_AREA_SQUARE_METRES = 800000000
const ISLAND_RELATIVE_AREA_DIVISOR = 14
const INSET_BOX = { x: 40, y: 42, width: 156, height: 148 }
const ISLAND_NAMES = ['mainland', 'vancouver-island', 'graham-island', 'moresby-island']
const ATTRIBUTION =
  'Adapted from Statistics Canada, 2021 Census Province and Territory Cartographic Boundary File, January 1, 2021. This does not constitute an endorsement by Statistics Canada of this product.'

function signedArea(points) {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2
  )
}

function segmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const denominator = dx * dx + dy * dy
  const t = denominator
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator))
    : 0
  return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2
}

// Remove the least significant triangle in a circular linked list. An area
// criterion suppresses the thin fjord spikes that a distance-only simplifier
// retains at icon scale. Small islands use a lower, area-relative threshold.
// Every retained vertex is still a projected source vertex, never a raster trace.
function simplifyRing(points) {
  const threshold = Math.min(
    MAXIMUM_EFFECTIVE_AREA_SQUARE_METRES,
    Math.abs(signedArea(points)) / ISLAND_RELATIVE_AREA_DIVISOR,
  )
  const nodes = points.slice(0, -1).map((point, index, all) => ({
    point,
    previous: (index - 1 + all.length) % all.length,
    next: (index + 1) % all.length,
    removed: false,
  }))
  let count = nodes.length
  while (count > 3) {
    let minimum = threshold
    let candidate = -1
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      if (node.removed) continue
      const a = nodes[node.previous].point
      const b = node.point
      const c = nodes[node.next].point
      const triangleArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
      if (triangleArea < minimum) {
        minimum = triangleArea
        candidate = index
      }
    }
    if (candidate === -1) break
    const node = nodes[candidate]
    nodes[node.previous].next = node.next
    nodes[node.next].previous = node.previous
    node.removed = true
    count--
  }
  const retained = nodes.filter((node) => !node.removed).map((node) => node.point)
  return [...retained, retained[0]]
}

function maximumSourceVertexDeviation(source, simplified) {
  return Math.sqrt(
    Math.max(
      ...source.map((point) =>
        Math.min(...simplified.slice(1).map((end, index) => segmentDistanceSquared(point, simplified[index], end))),
      ),
    ),
  )
}

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Pass the local Statistics Canada BC query JSON as the first argument.')
  const raw = await fs.readFile(input)
  const collection = JSON.parse(raw.toString('utf8'))
  if (collection.error || collection.exceededTransferLimit) throw new Error('Incomplete or failed source query.')
  if (collection.spatialReference?.wkid !== 4269)
    throw new Error('Input must use NAD83 longitude/latitude (EPSG:4269).')
  if (collection.features?.length !== 1 || collection.features[0].attributes?.DGUID !== '2021A000259') {
    throw new Error('Expected only the 2021 British Columbia province feature, DGUID 2021A000259.')
  }
  const sourceRings = collection.features[0].geometry.rings
  const projected = sourceRings
    // Esri outer rings run clockwise. Interior lake holes are omitted in this
    // small location symbol, rather than being mistaken for additional islands.
    .filter((ring) => signedArea(ring) < 0)
    .map((ring) => ring.map((point) => proj4(SOURCE_CRS, WORKING_CRS, point)))
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
    .slice(0, ISLAND_NAMES.length)
  const all = projected.flat()
  const minX = Math.min(...all.map((point) => point[0]))
  const maxX = Math.max(...all.map((point) => point[0]))
  const minY = Math.min(...all.map((point) => point[1]))
  const maxY = Math.max(...all.map((point) => point[1]))
  const scale = Math.min(INSET_BOX.width / (maxX - minX), INSET_BOX.height / (maxY - minY))
  const left = INSET_BOX.x + (INSET_BOX.width - (maxX - minX) * scale) / 2
  const top = INSET_BOX.y + (INSET_BOX.height - (maxY - minY) * scale) / 2
  const round = (value) => Number(value.toFixed(3))
  const parts = projected.map((ring, index) => {
    const simplified = simplifyRing(ring)
    const points = simplified.map(([x, y]) => [round(left + (x - minX) * scale), round(top + (maxY - y) * scale)])
    return {
      id: ISLAND_NAMES[index],
      sourceVertices: ring.length,
      retainedVertices: points.length,
      sourceAreaSquareKm: round(Math.abs(signedArea(ring)) / 1e6),
      maximumSourceVertexDeviationMetres: round(maximumSourceVertexDeviation(ring, simplified)),
      d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + ' Z',
    }
  })
  const result = {
    provenance: {
      attribution: ATTRIBUTION,
      source: SOURCE_SERVICE,
      sourceQuery: SOURCE_QUERY,
      sourceSha256: createHash('sha256').update(raw).digest('hex'),
      sourceFeature: '2021A000259',
      referenceDate: '2021-01-01',
      licence: 'Statistics Canada Open Licence',
      licenceUrl: 'https://www.statcan.gc.ca/en/terms-conditions/open-licence',
      sourceCrs: 'EPSG:4269',
      workingCrs: 'EPSG:3005 — NAD83 / BC Albers',
      workingProj4: WORKING_CRS,
      upstreamGeneralizationDegrees: 0.005,
      simplification: 'Visvalingam–Whyatt effective-area simplification on closed projected rings',
      maximumEffectiveAreaSquareMetres: MAXIMUM_EFFECTIVE_AREA_SQUARE_METRES,
      islandRelativeAreaDivisor: ISLAND_RELATIVE_AREA_DIVISOR,
      uniformScale: scale,
      insetBox: INSET_BOX,
      sourceRingCount: sourceRings.length,
      sourceVertexCount: sourceRings.reduce((count, ring) => count + ring.length, 0),
      retainedLandmasses: ISLAND_NAMES,
      limitations:
        'Illustrative scale only. Small islands and interior water holes are omitted. The separate moss journey accent is an authored graphic, not an administrative or measured route boundary.',
    },
    parts,
  }
  const output =
    process.argv[3] ?? fileURLToPath(new URL('../../src/lib/illustratedMap/bcInset.generated.json', import.meta.url))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, await format(JSON.stringify(result), { ...(await resolveConfig(output)), parser: 'json' }))
  console.log(
    `Wrote ${parts.length} landmasses / ${parts.reduce((sum, part) => sum + part.retainedVertices, 0)} vertices to ${output}`,
  )
}

await main()
