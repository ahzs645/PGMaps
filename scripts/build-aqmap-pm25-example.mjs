import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://geo.weather.gc.ca/geomet'
const COVERAGE_ID = 'RAQDPS.SFC_PM2.5'
const OUTPUT_NAME = 'modelled-pm25-example.geojson.gz'
const GRID_OUTPUT_NAME = 'modelled-pm25-example.grid.json.gz'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor/bcdatamapper/datascrapers/eccc/output')
const APP_DIR = path.join(PROJECT_ROOT, 'public/data/aqmap')
// [vendor copy, app copy] for each emitted artifact.
const OUTPUTS = [OUTPUT_NAME, GRID_OUTPUT_NAME].map((name) => ({
  name,
  vendor: path.join(VENDOR_DIR, name),
  app: path.join(APP_DIR, name),
}))
const onlyIfMissing = process.argv.includes('--if-missing')
const gzipAsync = promisify(gzip)

// Canada-wide. North is capped at the RAQDPS coverage limit (~80.2°N).
const EXAMPLE_BOUNDS = {
  west: -141,
  south: 41,
  east: -52,
  north: 80,
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

// Compact numeric grid snapshot consumed by the deck.gl raster layer. Values are
// stored RAW (as returned by WCS) so the client reuses the same scale factor
// (×1e9 → µg/m³) as the live path; rounded to keep the gzip small.
function gridToSnapshot(grid) {
  const round = (value) => (Number.isFinite(value) ? Number(value.toExponential(4)) : value)
  return {
    source: 'ECCC GeoMet WCS RAQDPS.SFC_PM2.5',
    bounds: EXAMPLE_BOUNDS,
    generatedAt: new Date().toISOString(),
    unit: 'raw (multiply by 1e9 for ug/m3)',
    ncols: grid.ncols,
    nrows: grid.nrows,
    xllcorner: grid.xllcorner,
    yllcorner: grid.yllcorner,
    dx: grid.dx,
    dy: grid.dy,
    nodata: grid.nodata,
    values: grid.values.map((row) => row.map(round)),
  }
}

async function fileHasContent(filePath) {
  try {
    const info = await stat(filePath)
    return info.size > 0
  } catch {
    return false
  }
}

async function copyVendorOutputs() {
  let copiedAll = true
  for (const output of OUTPUTS) {
    if (!(await fileHasContent(output.vendor))) {
      copiedAll = false
      continue
    }
    await mkdir(APP_DIR, { recursive: true })
    await copyFile(output.vendor, output.app)
    console.log(`Copied ${path.relative(PROJECT_ROOT, output.vendor)} -> ${path.relative(PROJECT_ROOT, output.app)}`)
  }
  return copiedAll
}

async function writeArtifact(output, body) {
  const compressed = await gzipAsync(body, { level: 9 })
  await mkdir(path.dirname(output.vendor), { recursive: true })
  await mkdir(path.dirname(output.app), { recursive: true })
  await writeFile(output.vendor, compressed)
  await writeFile(output.app, compressed)
  return compressed.length
}

async function main() {
  if (onlyIfMissing) {
    const appReady = (await Promise.all(OUTPUTS.map((output) => fileHasContent(output.app)))).every(Boolean)
    if (appReady) {
      console.log('PM2.5 example artifacts already present in public/data/aqmap')
      return
    }
    if (await copyVendorOutputs()) return
    // Otherwise fall through and rebuild from source.
  }

  const url = buildWcsUrl()
  console.log(`Fetching modelled PM2.5 example from ${url} ...`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`PM2.5 WCS request failed: ${response.status} ${response.statusText}`)
  }

  const grid = parseAsciiGrid(await response.text())

  const geojson = gridToFeatures(grid)
  const geojsonBody = JSON.stringify(geojson)
  const geojsonGzip = await writeArtifact(OUTPUTS[0], geojsonBody)

  const gridBody = JSON.stringify(gridToSnapshot(grid))
  const gridGzip = await writeArtifact(OUTPUTS[1], gridBody)

  console.log(
    `Wrote ${geojson.features.length} cells -> ${OUTPUT_NAME} ` +
      `(${(geojsonBody.length / 1e6).toFixed(2)} MB raw, ${(geojsonGzip / 1e6).toFixed(2)} MB gzip)`,
  )
  console.log(
    `Wrote ${grid.ncols}x${grid.nrows} grid -> ${GRID_OUTPUT_NAME} ` +
      `(${(gridBody.length / 1e6).toFixed(2)} MB raw, ${(gridGzip / 1e6).toFixed(2)} MB gzip)`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
