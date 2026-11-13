/**
 * One area's window read out of bare-earth GeoTIFFs the reader downloaded, at their native cells.
 * The files are read through `Blob` slices, so a 618 MB LidarBC 1:20,000 sheet costs only the rows
 * the window crosses; nothing is resampled, and missing cells stay missing. Several tiles of one
 * acquisition (one projection, one cell size, one grid) join into one window; the first file read
 * wins where two overlap. The result goes through `preparedTerrain`, like a loaded NRCan window.
 *
 * No DOM and no network: the files are passed in, so the tests run on Node's `Blob`.
 */
import { MAX_ROAD_RASTER_CELLS, preparedTerrain, roadProjection } from './terrain'
import type { Coordinate } from './types'

/** Files read for one area at most; a terrain preparation records at most 12 sources. */
export const LOCAL_DEM_MAX_FILES = 12

export type DemFile = Blob & { name: string; lastModified?: number }

const EPS = 1e-6
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The file's identity for the preparation record. Hashing a 618 MB file would hold it all in memory,
 * so this hashes its name, size and modified time, and the record says so.
 */
async function fileIdentity(file: DemFile) {
  const text = `${file.name}|${file.size}|${file.lastModified ?? 0}`
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

interface OpenedDem {
  file: DemFile
  image: Awaited<ReturnType<Awaited<ReturnType<typeof blobTiff>>['getImage']>>
  epsg: number
  /** Outer corner of pixel (0, 0) in the file's CRS. */
  corner: [number, number]
  cell: [number, number]
  noData: number | null
}

/**
 * Byte ranges served from the file itself, so geotiff reads a local file the way it reads a COG:
 * only the header and the strips a window crosses. Its own `fromBlob` needs the browser's
 * `FileReader`; `Blob.slice` works in a worker, a page and the tests alike.
 */
async function blobTiff(file: Blob) {
  const { BaseClient, fromCustomClient } = await import('geotiff')
  class BlobClient extends BaseClient {
    async request(options?: { headers?: HeadersInit }) {
      const range = /bytes=(\d+)-(\d+)/.exec(new Headers(options?.headers).get('Range') ?? '')
      const start = range ? Number(range[1]) : 0,
        end = Math.min(file.size - 1, range ? Number(range[2]) : file.size - 1)
      const data = await file.slice(start, end + 1).arrayBuffer()
      const headers: Record<string, string> = { 'content-range': `bytes ${start}-${end}/${file.size}` }
      // geotiff's BaseResponse declares its abstract status getter as void.
      return {
        ok: true,
        status: 206,
        getHeader: (name: string) => headers[name.toLowerCase()],
        getData: () => Promise.resolve(data),
      } as unknown as import('geotiff').BaseResponse
    }
  }
  return fromCustomClient(new BlobClient('local-file'), { allowFullFile: false, blockSize: 65536, cacheSize: 64 })
}

async function openDem(file: DemFile): Promise<OpenedDem> {
  const image = await (await blobTiff(file)).getImage()
  const keys = image.getGeoKeys() ?? {}
  if (image.getSamplesPerPixel() !== 1) throw Error(`${file.name}: use a single-band bare-earth DEM.`)
  if (image.fileDirectory.ModelTransformation)
    throw Error(`${file.name}: reproject a rotated raster to a north-up GeoTIFF first.`)
  const epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey)
  if (!Number.isInteger(epsg) || epsg === 4326)
    throw Error(`${file.name}: use a projected DEM in metres (UTM, BC Albers or NRCan LCC).`)
  roadProjection(epsg)
  if (keys.VerticalUnitsGeoKey && keys.VerticalUnitsGeoKey !== 9001)
    throw Error(`${file.name}: convert elevations to metres first.`)
  if (keys.ProjLinearUnitsGeoKey && keys.ProjLinearUnitsGeoKey !== 9001)
    throw Error(`${file.name}: convert horizontal coordinates to metres first.`)
  const [sx, sy] = image.getResolution()
  const origin = image.getOrigin()
  const tiepoint = image.fileDirectory.ModelTiepoint
  if (tiepoint?.length === 6) {
    origin[0] -= tiepoint[0] * sx
    origin[1] -= tiepoint[1] * sy
  }
  // A point-registered raster's tiepoint is a cell centre; move it out to the corner.
  if (keys.GTRasterTypeGeoKey === 2) {
    origin[0] -= sx / 2
    origin[1] -= sy / 2
  }
  return { file, image, epsg, corner: [origin[0], origin[1]], cell: [sx, sy], noData: image.getGDALNoData() }
}

export interface LocalDemWindow {
  metadata: Awaited<ReturnType<typeof preparedTerrain>>['metadata']
  source: Awaited<ReturnType<typeof preparedTerrain>>['source']
  /** Share of the window's cells with an elevation. */
  coveragePercent: number
  /** Files whose footprint reached the window, and whether any of their cells had an elevation. */
  read: { name: string; hadData: boolean }[]
  /** Files that lie wholly outside the window. */
  outside: string[]
}

/** Coarsest cell a window may be read at, as a multiple of the files' own cell. */
export const LOCAL_DEM_MAX_CELL_FACTOR = 4

/** The smallest whole cell multiple that brings `nativeCells` inside the road terrain's cell limit. */
export const cellFactorFor = (nativeCells: number) =>
  Math.max(1, Math.ceil(Math.sqrt(nativeCells / MAX_ROAD_RASTER_CELLS)))

/**
 * Reads the cells of `files` around `area` (lon/lat coordinates, widened by `bufferM`). The window is
 * the area's bounding box in the files' own projection: a box drawn in another projection first comes
 * out turned, and its outline needs a rectangle up to 2.7× larger (a reference road in NRCan's LCC box
 * read as 5.7 million UTM cells instead of 2.1). `cellFactor` reads every `f` × `f` block of native
 * cells as their mean, the reader's explicit choice for an area too large at native cells; it is
 * stated in the name and the preparation record. Throws, with nothing changed, when the files disagree
 * on grid, when the window would pass the road terrain's cell limit, or when no cell has an elevation.
 */
export async function readLocalDemWindow(
  files: readonly DemFile[],
  area: { coordinates: readonly Coordinate[]; bufferM: number },
  options: { name: string; verticalReference: string; sourceLabel: string; cellFactor?: number },
): Promise<LocalDemWindow> {
  if (!files.length) throw Error('Choose the downloaded DEM files.')
  if (files.length > LOCAL_DEM_MAX_FILES) throw Error(`Load at most ${LOCAL_DEM_MAX_FILES} files at once.`)
  if (!area.coordinates.length) throw Error('Choose an area.')
  const factor = options.cellFactor ?? 1
  if (!Number.isInteger(factor) || factor < 1 || factor > LOCAL_DEM_MAX_CELL_FACTOR)
    throw Error(`Choose a cell multiple from 1 to ${LOCAL_DEM_MAX_CELL_FACTOR}.`)
  const opened = await Promise.all(files.map(openDem))
  const [first] = opened
  for (const dem of opened)
    if (
      dem.epsg !== first.epsg ||
      Math.abs(dem.cell[0] - first.cell[0]) > EPS ||
      Math.abs(dem.cell[1] - first.cell[1]) > EPS
    )
      throw Error(
        `${dem.file.name} is EPSG:${dem.epsg} at ${Math.abs(dem.cell[0])} m but ${first.file.name} is EPSG:${first.epsg} at ${Math.abs(first.cell[0])} m. Load files of one acquisition together.`,
      )
  const [sx, sy] = first.cell
  const projection = roadProjection(first.epsg)
  const points = area.coordinates.map((c) => projection.forward([...c]) as [number, number])
  const buffer = Math.max(0, area.bufferM)
  const minX = Math.min(...points.map((p) => p[0])) - buffer,
    maxX = Math.max(...points.map((p) => p[0])) + buffer,
    minY = Math.min(...points.map((p) => p[1])) - buffer,
    maxY = Math.max(...points.map((p) => p[1])) + buffer
  // The window, in whole cells of the first file's grid, rounded out to whole output cells.
  const [ox, oy] = first.corner
  const c0 = Math.floor((minX - ox) / sx + EPS),
    r0 = Math.floor((maxY - oy) / sy + EPS)
  const outWidth = Math.ceil((Math.ceil((maxX - ox) / sx - EPS) - c0) / factor),
    outHeight = Math.ceil((Math.ceil((minY - oy) / sy - EPS) - r0) / factor)
  const width = outWidth * factor,
    height = outHeight * factor,
    c1 = c0 + width,
    r1 = r0 + height
  if (outWidth < 2 || outHeight < 2) throw Error('Choose a larger area.')
  const cellM = Math.abs(sx) * factor
  if (outWidth * outHeight > MAX_ROAD_RASTER_CELLS) {
    const needed = cellFactorFor(width * height)
    throw Error(
      `This area needs ${((outWidth * outHeight) / 1e6).toFixed(1)} million ${cellM} m cells (limit ${(MAX_ROAD_RASTER_CELLS / 1e6).toFixed(2)} million). ${needed <= LOCAL_DEM_MAX_CELL_FACTOR && needed > factor ? `Read it at ${Math.abs(sx) * needed} m cells, or pick` : 'Pick'} one block or road, or a smaller buffer.`,
    )
  }
  // Native cells already taken (the first file wins), and each output cell's running mean.
  const taken = new Uint8Array(width * height)
  const sums = new Float64Array(outWidth * outHeight),
    counts = new Uint32Array(outWidth * outHeight)
  const read: LocalDemWindow['read'] = [],
    outside: string[] = []
  const used: OpenedDem[] = []
  for (const dem of opened) {
    const dc = (dem.corner[0] - ox) / sx,
      dr = (dem.corner[1] - oy) / sy
    if (Math.abs(dc - Math.round(dc)) > 1e-3 || Math.abs(dr - Math.round(dr)) > 1e-3)
      throw Error(`${dem.file.name} is not on the same cell grid as ${first.file.name}.`)
    const left = Math.max(0, c0 - Math.round(dc)),
      top = Math.max(0, r0 - Math.round(dr)),
      right = Math.min(dem.image.getWidth(), c1 - Math.round(dc)),
      bottom = Math.min(dem.image.getHeight(), r1 - Math.round(dr))
    if (left >= right || top >= bottom) {
      outside.push(dem.file.name)
      continue
    }
    const pixels = (await dem.image.readRasters({
      window: [left, top, right, bottom],
      samples: [0],
      interleave: true,
    })) as unknown as ArrayLike<number>
    const noData = dem.noData !== null && pixels instanceof Float32Array ? Math.fround(dem.noData) : dem.noData
    let hadData = false
    const xOffset = left + Math.round(dc) - c0,
      yOffset = top + Math.round(dr) - r0
    for (let row = 0; row < bottom - top; row++)
      for (let col = 0; col < right - left; col++) {
        const v = Number(pixels[row * (right - left) + col])
        if (!Number.isFinite(v) || v === noData || v < -12000 || v > 12000) continue
        hadData = true
        const x = col + xOffset,
          y = row + yOffset
        if (taken[y * width + x]) continue
        taken[y * width + x] = 1
        const at = Math.floor(y / factor) * outWidth + Math.floor(x / factor)
        sums[at] += v
        counts[at]++
      }
    read.push({ name: dem.file.name, hadData })
    used.push(dem)
  }
  const values = Array.from(counts, (n, i) => (n ? sums[i] / n : null))
  const covered = values.reduce<number>((n, v) => n + (v === null ? 0 : 1), 0)
  if (!covered)
    throw Error(
      read.length
        ? `${read.map((r) => r.name).join(', ')} ${read.length === 1 ? 'has' : 'have'} no elevations in this area: the tile is listed here, but its acquisition did not reach it. Your current terrain is unchanged.`
        : 'None of these files reaches this area. Your current terrain is unchanged.',
    )
  const sources = await Promise.all(
    used.map(async (dem) => ({
      name: dem.file.name.slice(0, 200),
      sha256: await fileIdentity(dem.file),
      epsg: dem.epsg,
      verticalReference: options.verticalReference,
    })),
  )
  const averaged = factor > 1 ? ` · ${cellM} m cells, each the mean of ${factor} × ${factor} source cells` : ''
  const loaded = await preparedTerrain(
    {
      name: `${options.name}${averaged}`.slice(0, 200),
      kind: 'terrain',
      epsg: first.epsg,
      // Cell centres, as every road raster stores its origin.
      origin: [ox + (c0 + factor / 2) * sx, oy + (r0 + factor / 2) * sy],
      pixelSize: [sx * factor, sy * factor],
      width: outWidth,
      height: outHeight,
      values,
      acquired: '',
      verticalReference: options.verticalReference,
    },
    {
      operation: 'mosaic',
      sources,
      method: `${options.sourceLabel} · pixel windows read from downloaded files${factor > 1 ? `, each ${factor} × ${factor} block of source cells averaged over its known cells` : ', native cells'}; no-data retained; first file wins where tiles overlap`,
      parameters: {
        bounds: [minX, minY, maxX, maxY].map((n) => n.toFixed(1)).join(','),
        cellM,
        sourceCellM: Math.abs(sx),
        sourceIdentity: 'SHA-256 of each file name, size and modified time',
      },
    },
  )
  return { ...loaded, coveragePercent: (100 * covered) / values.length, read, outside }
}
