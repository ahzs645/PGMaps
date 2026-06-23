// Shared helpers for the ECCC GeoMet RAQDPS PM2.5 numeric grid (WCS GetCoverage,
// FORMAT=image/x-aaigrid). Used by both the GeoJSON vector layer and the deck.gl
// numeric raster layer so the parsing / colour scale stays in one place.

export type AsciiGrid = {
  ncols: number
  nrows: number
  xllcorner: number
  yllcorner: number
  dx: number
  dy: number
  nodata: number | null
  /** Row 0 is the northernmost row (ESRI ASCII grid ordering). */
  values: number[][]
}

export type GeoBounds = { west: number; south: number; east: number; north: number }

/** RAQDPS PM2.5 coverage extent — clamp WCS subset requests to this. */
export const PM25_WCS_BOUNDS: GeoBounds = {
  west: -176.842409132,
  south: 16.149189226,
  east: -18.825681315,
  north: 80.210751469,
}

export const PM25_LOCAL_EXAMPLE_URL = '/data/aqmap/modelled-pm25-example.geojson.gz'

/** Committed numeric grid snapshot (raw values) used by the deck.gl raster layer. */
export const PM25_GRID_SNAPSHOT_URL = '/data/aqmap/modelled-pm25-example.grid.json.gz'

/** Raw WCS values are tiny fractions; scale to µg/m³ for display. */
export const PM25_RAW_SCALE = 1_000_000_000

/** Top of the colour scale in µg/m³ (matches the highest ramp stop). */
export const PM25_MAX = 100

export const PM25_VECTOR_COLORS = [
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
] as const

export function buildPm25WcsGridUrl(bounds: GeoBounds): string | null {
  const west = Math.max(PM25_WCS_BOUNDS.west, bounds.west)
  const east = Math.min(PM25_WCS_BOUNDS.east, bounds.east)
  const south = Math.max(PM25_WCS_BOUNDS.south, bounds.south)
  const north = Math.min(PM25_WCS_BOUNDS.north, bounds.north)
  if (west >= east || south >= north) return null

  const params = new URLSearchParams({
    SERVICE: 'WCS',
    REQUEST: 'GetCoverage',
    VERSION: '2.0.1',
    COVERAGEID: 'RAQDPS.SFC_PM2.5',
    FORMAT: 'image/x-aaigrid',
  })
  params.append('SUBSET', `long(${west.toFixed(6)},${east.toFixed(6)})`)
  params.append('SUBSET', `lat(${south.toFixed(6)},${north.toFixed(6)})`)

  return `https://geo.weather.gc.ca/geomet?${params.toString()}`
}

function extractAsciiGridPart(payload: string): string {
  const start = payload.search(/\bncols\s+/i)
  if (start === -1) throw new Error('WCS response did not include an ASCII grid part.')

  const rest = payload.slice(start)
  const nextBoundary = rest.search(/\r?\n--wcs\b/i)
  return (nextBoundary === -1 ? rest : rest.slice(0, nextBoundary)).trim()
}

export function parseAsciiGrid(payload: string): AsciiGrid {
  const lines = extractAsciiGridPart(payload)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const header = new Map<string, number>()
  let dataStartIndex = 0

  for (const [index, line] of lines.entries()) {
    const [rawKey, rawValue] = line.split(/\s+/, 2)
    const key = rawKey.toLowerCase()
    const value = Number(rawValue)
    if (
      !Number.isFinite(value) ||
      !['ncols', 'nrows', 'xllcorner', 'yllcorner', 'dx', 'dy', 'cellsize', 'nodata_value'].includes(key)
    ) {
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
  if (
    ncols === undefined ||
    nrows === undefined ||
    xllcorner === undefined ||
    yllcorner === undefined ||
    dx === undefined ||
    dy === undefined
  ) {
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
    values: lines
      .slice(dataStartIndex, dataStartIndex + nrows)
      .map((line) => line.split(/\s+/).slice(0, ncols).map(Number)),
  }
}

export function pm25Color(value: number): string {
  return [...PM25_VECTOR_COLORS].reverse().find((stop) => value >= stop.value)?.color ?? PM25_VECTOR_COLORS[0].color
}

/** Geographic extent of the grid as [west, south, east, north]. */
export function pm25GridBounds(grid: AsciiGrid): [number, number, number, number] {
  const west = grid.xllcorner
  const east = grid.xllcorner + grid.ncols * grid.dx
  const south = grid.yllcorner
  const north = grid.yllcorner + grid.nrows * grid.dy
  return [west, south, east, north]
}

/**
 * Encode the grid into an RGBA image for GPU rendering: the red channel carries
 * the normalized value (pm25 / PM25_MAX, 0..1) and alpha masks nodata / sub-0.25
 * cells out. The deck.gl raster layer reads red back and applies a colour ramp
 * in its fragment shader — the deck.gl-raster pattern.
 */
export function pm25GridToImageData(grid: AsciiGrid): ImageData {
  const { ncols, nrows } = grid
  const data = new Uint8ClampedArray(ncols * nrows * 4)

  for (let row = 0; row < nrows; row += 1) {
    for (let col = 0; col < ncols; col += 1) {
      const raw = grid.values[row]?.[col]
      const idx = (row * ncols + col) * 4
      if (!Number.isFinite(raw) || (grid.nodata !== null && raw === grid.nodata)) continue

      const pm25 = raw * PM25_RAW_SCALE
      if (!Number.isFinite(pm25) || pm25 < 0.25) continue

      data[idx] = Math.round(Math.min(pm25 / PM25_MAX, 1) * 255)
      data[idx + 3] = 255
    }
  }

  return new ImageData(data, ncols, nrows)
}

/** Fetch a (optionally gzipped) JSON document, transparently inflating gzip. */
export async function fetchGzipJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(stream).text()
    return JSON.parse(text) as T
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

/** Sample µg/m³ at a lng/lat from the parsed grid (nearest cell). */
export function pm25ValueAt(grid: AsciiGrid, lng: number, lat: number): number | null {
  const [west, south, east, north] = pm25GridBounds(grid)
  if (lng < west || lng > east || lat < south || lat > north) return null

  const col = Math.floor((lng - west) / grid.dx)
  const rowFromTop = Math.floor((north - lat) / grid.dy)
  if (col < 0 || col >= grid.ncols || rowFromTop < 0 || rowFromTop >= grid.nrows) return null

  const raw = grid.values[rowFromTop]?.[col]
  if (!Number.isFinite(raw) || (grid.nodata !== null && raw === grid.nodata)) return null

  const pm25 = raw * PM25_RAW_SCALE
  return Number.isFinite(pm25) && pm25 >= 0 ? pm25 : null
}
