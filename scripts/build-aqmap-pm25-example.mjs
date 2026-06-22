import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://geo.weather.gc.ca/geomet'
const COVERAGE_ID = 'RAQDPS.SFC_PM2.5'
const OUTPUT_NAME = 'modelled-pm25-example.geojson.gz'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const VENDOR_OUTPUT_PATH = path.join(PROJECT_ROOT, 'vendor/bcdatamapper/datascrapers/eccc/output', OUTPUT_NAME)
const APP_OUTPUT_PATH = path.join(PROJECT_ROOT, 'public/data/aqmap', OUTPUT_NAME)
const onlyIfMissing = process.argv.includes('--if-missing')
const gzipAsync = promisify(gzip)

const EXAMPLE_BOUNDS = {
  west: -140,
  south: 47,
  east: -110,
  north: 62,
}

const PM25_VECTOR_COLORS = [
  { value: 0, color: '#21c5f4' },
  { value: 10, color: '#1899c9' },
  { value: 20, color: '#0d6796' },
  { value: 30, color: '#fefc37' },
  { value: 40, color: '#fecb2e' },
  { value: 50, color: '#fd993f' },
  { value: 60, color: '#fc6769' },
  { value: 70, color: '#fe3b3b' },
  { value: 80, color: '#fe0101' },
  { value: 90, color: '#ca0713' },
  { value: 100, color: '#650205' },
]

function buildWcsUrl() {
  const params = new URLSearchParams({
    SERVICE: 'WCS',
    REQUEST: 'GetCoverage',
    VERSION: '2.0.1',
    COVERAGEID: COVERAGE_ID,
    FORMAT: 'image/x-aaigrid',
  })
  params.append('SUBSET', `long(${EXAMPLE_BOUNDS.west},${EXAMPLE_BOUNDS.east})`)
  params.append('SUBSET', `lat(${EXAMPLE_BOUNDS.south},${EXAMPLE_BOUNDS.north})`)
  return `${SOURCE_URL}?${params.toString()}`
}

function extractAsciiGridPart(payload) {
  const start = payload.search(/\bncols\s+/i)
  if (start === -1) throw new Error('WCS response did not include an ASCII grid part.')

  const rest = payload.slice(start)
  const nextBoundary = rest.search(/\r?\n--wcs\b/i)
  return (nextBoundary === -1 ? rest : rest.slice(0, nextBoundary)).trim()
}

function parseAsciiGrid(payload) {
  const lines = extractAsciiGridPart(payload)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const header = new Map()
  let dataStartIndex = 0

  for (const [index, line] of lines.entries()) {
    const [rawKey, rawValue] = line.split(/\s+/, 2)
    const key = rawKey.toLowerCase()
    const value = Number(rawValue)
    if (!Number.isFinite(value) || !['ncols', 'nrows', 'xllcorner', 'yllcorner', 'dx', 'dy', 'cellsize', 'nodata_value'].includes(key)) {
      dataStartIndex = index
      break
    }
    header.set(key, value)
  }

  const ncols = header.get('ncols')
  const nrows = header.get('nrows')
  const xllcorner = header.get('xllcorner')
  const yllcorner = header.get('yllcorner')
  const dx = header.get('dx') ?? header.get('cellsize')
  const dy = header.get('dy') ?? header.get('cellsize')
  if (ncols === undefined || nrows === undefined || xllcorner === undefined || yllcorner === undefined || dx === undefined || dy === undefined) {
    throw new Error('WCS ASCII grid header is missing required fields.')
  }

  return {
    ncols,
    nrows,
    xllcorner,
    yllcorner,
    dx,
    dy,
    nodata: header.get('nodata_value') ?? null,
    values: lines.slice(dataStartIndex, dataStartIndex + nrows).map((line) => line.split(/\s+/).slice(0, ncols).map(Number)),
  }
}

function pm25Color(value) {
  return [...PM25_VECTOR_COLORS].reverse().find((stop) => value >= stop.value)?.color ?? PM25_VECTOR_COLORS[0].color
}

function gridToFeatures(grid) {
  const features = []

  for (let row = 0; row < grid.nrows; row += 1) {
    for (let col = 0; col < grid.ncols; col += 1) {
      const rawValue = grid.values[row]?.[col]
      if (!Number.isFinite(rawValue)) continue
      if (grid.nodata !== null && rawValue === grid.nodata) continue

      const pm25 = rawValue * 1_000_000_000
      if (!Number.isFinite(pm25) || pm25 < 0.25) continue

      const west = grid.xllcorner + col * grid.dx
      const east = grid.xllcorner + (col + 1) * grid.dx
      const north = grid.yllcorner + (grid.nrows - row) * grid.dy
      const south = grid.yllcorner + Math.max(grid.nrows - row - 1, 0) * grid.dy

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [Number(west.toFixed(6)), Number(south.toFixed(6))],
            [Number(east.toFixed(6)), Number(south.toFixed(6))],
            [Number(east.toFixed(6)), Number(north.toFixed(6))],
            [Number(west.toFixed(6)), Number(north.toFixed(6))],
            [Number(west.toFixed(6)), Number(south.toFixed(6))],
          ]],
        },
        properties: {
          pm25: Number(pm25.toFixed(2)),
          fill: pm25Color(pm25),
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    properties: {
      source: 'ECCC GeoMet WCS RAQDPS.SFC_PM2.5',
      bounds: EXAMPLE_BOUNDS,
      generatedAt: new Date().toISOString(),
      unit: 'ug/m3',
    },
    features,
  }
}

async function copyExistingVendorOutput() {
  const existing = await stat(VENDOR_OUTPUT_PATH)
  if (existing.size <= 0) return false
  await mkdir(path.dirname(APP_OUTPUT_PATH), { recursive: true })
  await copyFile(VENDOR_OUTPUT_PATH, APP_OUTPUT_PATH)
  console.log(`Copied ${path.relative(PROJECT_ROOT, VENDOR_OUTPUT_PATH)} -> ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)}`)
  return true
}

async function main() {
  if (onlyIfMissing) {
    try {
      const existing = await stat(APP_OUTPUT_PATH)
      if (existing.size > 0) {
        console.log(`PM2.5 example already exists at ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)}`)
        return
      }
    } catch {
      // Missing app file: copy the vendor snapshot or build it below.
    }

    try {
      if (await copyExistingVendorOutput()) return
    } catch {
      // Missing vendor file: build it below.
    }
  }

  const url = buildWcsUrl()
  console.log(`Fetching modelled PM2.5 example from ${url} ...`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`PM2.5 WCS request failed: ${response.status} ${response.statusText}`)
  }

  const grid = parseAsciiGrid(await response.text())
  const output = gridToFeatures(grid)
  const body = JSON.stringify(output)
  const compressed = await gzipAsync(body, { level: 9 })

  await mkdir(path.dirname(VENDOR_OUTPUT_PATH), { recursive: true })
  await mkdir(path.dirname(APP_OUTPUT_PATH), { recursive: true })
  await writeFile(VENDOR_OUTPUT_PATH, compressed)
  await writeFile(APP_OUTPUT_PATH, compressed)

  console.log(
    `Wrote ${output.features.length} cells -> ${path.relative(PROJECT_ROOT, VENDOR_OUTPUT_PATH)} ` +
      `and ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)} ` +
      `(${(body.length / 1e6).toFixed(2)} MB raw, ${(compressed.length / 1e6).toFixed(2)} MB gzip)`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
