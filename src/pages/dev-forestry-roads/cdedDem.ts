/**
 * BC's CDED terrain (derived from TRIM air photos) as a **Load 1 m DEM** source for where no LiDAR is
 * published: 0.75 arc-second posts, about 14 m east–west by 23 m north–south at 54° N. It is an
 * independent survey from the satellite-derived regional terrain, so it is worth loading as a second
 * opinion on a hillside; it is no finer, and it does not resolve a road bench.
 *
 * The files sit on `pub.data.gov.bc.ca`, which sends no CORS headers: like LidarBC's, they are linked
 * to, downloaded by the reader and read back here. Each is a USGS-format ASCII DEM (one half of an
 * NTS 1:50,000 sheet, 1,201 × 1,201 posts) in a zip. Tile names follow from the NTS grid, so no index
 * is queried; a link can still be dead where BC publishes no file.
 *
 * Elevations are stated as CGVD28 by the CDED product specification; the files' own header code is
 * recorded beside it, and the claim is unverified for these BC files. No DOM and no network.
 */
import { unzipSync } from 'fflate'
import { MAX_ROAD_RASTER_CELLS, preparedTerrain } from './terrain'
import type { Coordinate } from './types'

export const CDED_BASE_URL = 'https://pub.data.gov.bc.ca/datasets/175624'
export const CDED_VERTICAL_REFERENCE = 'CGVD28 · per the CDED product specification; not verified for this file'
/** CDED's void value. */
const CDED_VOID = -32767

export interface CdedTile {
  /** e.g. `093i04_e`. */
  name: string
  url: string
}

const LETTERS = 'ABCDEFGHIJKLMNOP'
/** Position in a 4 × 4 block numbered boustrophedon from the south-east corner, as NTS letters and sheets are. */
const serpentine = (row: number, fromEast: number) => row * 4 + (row % 2 ? 3 - fromEast : fromEast)

/** The CDED half-sheet holding a point: NTS series, 1:250,000 letter, 1:50,000 sheet, east or west half. */
export function cdedTileAt([lon, lat]: Coordinate): CdedTile {
  const blockSouth = 40 + 4 * Math.floor((lat - 40) / 4),
    blockIndex = Math.floor((-112 - lon) / 8),
    blockEast = -112 - 8 * blockIndex
  const series = `${8 + blockIndex}${Math.floor((lat - 40) / 4)}`
  const letterRow = Math.min(3, Math.floor(lat - blockSouth)),
    letterCol = Math.min(3, Math.floor((blockEast - lon) / 2))
  const letter = LETTERS[serpentine(letterRow, letterCol)].toLowerCase()
  const letterSouth = blockSouth + letterRow,
    letterEast = blockEast - 2 * letterCol
  const sheetRow = Math.min(3, Math.floor((lat - letterSouth) / 0.25)),
    sheetCol = Math.min(3, Math.floor((letterEast - lon) / 0.5))
  const sheet = String(serpentine(sheetRow, sheetCol) + 1).padStart(2, '0')
  const half = lon >= letterEast - 0.5 * sheetCol - 0.25 ? 'e' : 'w'
  const name = `${series.padStart(3, '0')}${letter}${sheet}_${half}`
  return { name, url: `${CDED_BASE_URL}/${series}${letter}/${name}.dem.zip` }
}

/** Every CDED half-sheet under a lon/lat ring's bounding box, west to east, south to north. */
export function cdedTilesFor(ring: readonly Coordinate[]): CdedTile[] {
  if (!ring.length) return []
  const west = Math.min(...ring.map((c) => c[0])),
    east = Math.max(...ring.map((c) => c[0])),
    south = Math.min(...ring.map((c) => c[1])),
    north = Math.max(...ring.map((c) => c[1]))
  const tiles = new Map<string, CdedTile>()
  // Half-sheets are 0.25° square: step by that, and take the far edges too.
  for (let lat = south; ; lat = Math.min(north, lat + 0.25)) {
    for (let lon = west; ; lon = Math.min(east, lon + 0.25)) {
      const tile = cdedTileAt([lon, lat])
      tiles.set(tile.name, tile)
      if (lon >= east) break
    }
    if (lat >= north) break
  }
  return [...tiles.values()]
}

export interface CdedGrid {
  name: string
  /** Longitude and latitude of the south-west post, degrees. */
  west: number
  south: number
  /** Post spacing, degrees. */
  dx: number
  dy: number
  cols: number
  rows: number
  /** Elevations in metres, column by column from the west, each south to north; null where void. */
  columns: (number | null)[][]
  /** The header's vertical datum code (1 local mean sea level, 2 NGVD 29, 3 NAVD 88), as written. */
  verticalDatumCode: number | null
}

const real = (text: string) => Number(text.trim().replace(/D/i, 'E'))

/** Parses a USGS-format ASCII DEM with geographic coordinates in arc-seconds, as CDED files are. */
export function parseCdedDem(bytes: Uint8Array, name: string): CdedGrid {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length < 2048) throw Error(`${name} is too short to be a CDED DEM.`)
  const header = text(0, 1024)
  const groundUnit = Number(header.slice(528, 534)),
    elevationUnit = Number(header.slice(534, 540))
  if (Number(header.slice(156, 162)) !== 0 || groundUnit !== 3)
    throw Error(`${name} is not a geographic DEM in arc-seconds; CDED files are.`)
  const dxSeconds = real(header.slice(816, 828)),
    dySeconds = real(header.slice(828, 840)),
    dz = real(header.slice(840, 852)) * (elevationUnit === 1 ? 0.3048 : 1)
  const cols = Number(header.slice(858, 864))
  if (!(dxSeconds > 0 && dySeconds > 0 && dz > 0) || !Number.isInteger(cols) || cols < 2 || cols > 5000)
    throw Error(`${name} has an unreadable DEM header.`)
  const datum = Number(header.slice(888, 890))
  const columns: (number | null)[][] = []
  let west = 0,
    south = 0,
    rows = 0,
    at = 1024
  for (let c = 0; c < cols; c++) {
    if (at + 1024 > bytes.length) throw Error(`${name} ends before its last profile.`)
    const record = text(at, at + 1024)
    const count = Number(record.slice(12, 18))
    const x = real(record.slice(24, 48)) / 3600,
      y = real(record.slice(48, 72)) / 3600,
      local = real(record.slice(72, 96))
    if (!Number.isInteger(count) || count < 2 || count > 5000) throw Error(`${name} has an unreadable profile.`)
    if (!c) {
      west = x
      south = y
      rows = count
    } else if (count !== rows || Math.abs(y - south) > 1e-9)
      throw Error(`${name} has profiles of different lengths; only full CDED sheets are read.`)
    const values: (number | null)[] = []
    let body = record.slice(144)
    at += 1024
    for (;;) {
      for (let i = 0; i + 6 <= body.length && values.length < count; i += 6) {
        const raw = Number(body.slice(i, i + 6))
        values.push(!Number.isFinite(raw) || raw === CDED_VOID ? null : local + raw * dz)
      }
      if (values.length >= count) break
      if (at + 1024 > bytes.length) throw Error(`${name} ends inside a profile.`)
      // Continuation blocks hold 170 values and four spare bytes.
      body = text(at, at + 1020)
      at += 1024
    }
    columns.push(values)
  }
  return {
    name,
    west,
    south,
    dx: dxSeconds / 3600,
    dy: dySeconds / 3600,
    cols,
    rows,
    columns,
    verticalDatumCode: Number.isFinite(datum) && datum > 0 ? datum : null,
  }
}

/** The DEM inside a downloaded file: a `.dem`, or the `.dem.zip` BC serves. */
export function cdedFromDownload(bytes: Uint8Array, fileName: string): CdedGrid {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes, { filter: (file) => /\.dem$/i.test(file.name) })
    const [entry] = Object.keys(entries)
    if (!entry) throw Error(`${fileName} holds no .dem file.`)
    return parseCdedDem(entries[entry], entry)
  }
  return parseCdedDem(bytes, fileName)
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The posts of `grids` around `area` (lon/lat, widened by `bufferM`) as one road terrain in WGS84
 * degrees, native posts, voids kept. Adjoining half-sheets share their edge post; the first grid
 * wins there. Throws, with nothing changed, when the grids differ in spacing or no post in the window
 * has an elevation.
 */
export async function cdedWindow(
  grids: readonly CdedGrid[],
  area: { coordinates: readonly Coordinate[]; bufferM: number },
  fileBytes: readonly Uint8Array[],
) {
  if (!grids.length) throw Error('Choose the downloaded CDED files.')
  if (!area.coordinates.length) throw Error('Choose an area.')
  const [first] = grids
  for (const grid of grids)
    if (Math.abs(grid.dx - first.dx) > 1e-12 || Math.abs(grid.dy - first.dy) > 1e-12)
      throw Error(`${grid.name} and ${first.name} have different post spacing.`)
  const midLat = area.coordinates.reduce((sum, c) => sum + c[1], 0) / area.coordinates.length
  const bufferLat = Math.max(0, area.bufferM) / 110_574,
    bufferLon = Math.max(0, area.bufferM) / (111_320 * Math.cos((midLat * Math.PI) / 180))
  const west = Math.min(...area.coordinates.map((c) => c[0])) - bufferLon,
    east = Math.max(...area.coordinates.map((c) => c[0])) + bufferLon,
    south = Math.min(...area.coordinates.map((c) => c[1])) - bufferLat,
    north = Math.max(...area.coordinates.map((c) => c[1])) + bufferLat
  // Whole posts of the first grid's lattice, one post beyond the box on every side.
  const c0 = Math.floor((west - first.west) / first.dx + 1e-9) - 1,
    c1 = Math.ceil((east - first.west) / first.dx - 1e-9) + 1,
    r0 = Math.floor((south - first.south) / first.dy + 1e-9) - 1,
    r1 = Math.ceil((north - first.south) / first.dy - 1e-9) + 1
  const width = c1 - c0 + 1,
    height = r1 - r0 + 1
  if (width * height > MAX_ROAD_RASTER_CELLS)
    throw Error(`This area needs ${((width * height) / 1e6).toFixed(1)} million CDED posts. Choose a smaller area.`)
  const values: (number | null)[] = Array(width * height).fill(null)
  const used: string[] = []
  for (const grid of grids) {
    const dc = Math.round((grid.west - first.west) / first.dx),
      dr = Math.round((grid.south - first.south) / first.dy)
    let any = false
    for (let c = Math.max(c0, dc); c <= Math.min(c1, dc + grid.cols - 1); c++)
      for (let r = Math.max(r0, dr); r <= Math.min(r1, dr + grid.rows - 1); r++) {
        const z = grid.columns[c - dc][r - dr]
        if (z === null) continue
        any = true
        // Row 0 of the raster is the northernmost.
        const at = (r1 - r) * width + (c - c0)
        if (values[at] === null) values[at] = z
      }
    if (any) used.push(grid.name)
  }
  const covered = values.reduce<number>((n, v) => n + (v === null ? 0 : 1), 0)
  if (!covered) throw Error('None of these CDED files has elevations in this area. Your current terrain is unchanged.')
  const sources = await Promise.all(
    grids.map(async (grid, i) => ({
      name: grid.name.slice(0, 200),
      sha256: hex(await crypto.subtle.digest('SHA-256', (fileBytes[i] ?? new Uint8Array()) as BufferSource)),
      epsg: 4326,
      verticalReference: CDED_VERTICAL_REFERENCE,
    })),
  )
  const loaded = await preparedTerrain(
    {
      name: 'BC CDED · 0.75 arc-second terrain (TRIM)',
      kind: 'terrain',
      epsg: 4326,
      // CDED values are posts: the raster's cell centres are the posts themselves.
      origin: [first.west + c0 * first.dx, first.south + r1 * first.dy],
      pixelSize: [first.dx, -first.dy],
      width,
      height,
      values,
      acquired: '',
      verticalReference: CDED_VERTICAL_REFERENCE,
    },
    {
      operation: 'mosaic',
      sources,
      method: 'BC CDED (TRIM-derived) posts read from downloaded files at their own spacing; voids retained',
      parameters: {
        bounds: [west, south, east, north].map((n) => n.toFixed(6)).join(','),
        postArcSeconds: Number((first.dx * 3600).toFixed(4)),
        headerVerticalDatumCodes: grids.map((g) => g.verticalDatumCode ?? 'none').join(','),
      },
    },
  )
  return { ...loaded, coveragePercent: (100 * covered) / values.length, used }
}
