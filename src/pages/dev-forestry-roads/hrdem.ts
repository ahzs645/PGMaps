/** NRCan's 1 m bare-earth mosaic. Only selected windows are read, never whole provincial COGs. */
import { BaseClient, type BaseResponse, type GeoTIFF, fromCustomClient } from 'geotiff'
import { preparedTerrain, roadProjection, MAX_ROAD_RASTER_CELLS } from './terrain'
import type { Coordinate, RoadProject } from './types'
import type { LonLatBounds } from './sentinel/stac'
import { createReadQueue } from './sentinel/readQueue'

export const HRDEM_COLLECTION = 'hrdem-mosaic-1m'
export const HRDEM_SEARCH_URL = 'https://datacube.services.geo.ca/stac/api/search'
export const HRDEM_CREDIT = 'NRCan · CanElevation HRDEM 1 m · Open Government Licence – Canada'
export const HRDEM_RELIEF_CREDIT = 'NRCan · CanElevation HRDEM relief (1–2 m source) · Open Government Licence – Canada'
export const HRDEM_MAX_ITEMS = 4
export const HRDEM_TIMEOUT_MS = 90_000
export const HRDEM_MAX_RANGE_BYTES = 32 * 1024 * 1024
export const HRDEM_MAX_DOWNLOAD_CELLS = 32_000_000
export const HRDEM_MAX_DOWNLOAD_BOXES = 64
export const HRDEM_RELIEF_MIN_ZOOM = 12
export const HRDEM_RELIEF_MAX_ZOOM = 16

/** Tile requests are view-local; beyond z16 MapLibre reuses the same source pixels. */
export const HRDEM_RELIEF_TILES = [
  'https://datacube.services.geo.ca/ows/elevation?service=WMS&version=1.3.0&request=GetMap&layers=dtm-hillshade&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=512&height=512&bbox={bbox-epsg-3857}',
]

export type DetailArea = { id: string; name: string; coordinates: Coordinate[] }

function coordinatesOf(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return []
  if (typeof value[0] === 'number' && typeof value[1] === 'number') return [[value[0], value[1]]]
  return value.flatMap(coordinatesOf)
}

/** Import roles are respected: reference buffers never silently become planned blocks. */
export function projectDetailAreas(project: RoadProject): DetailArea[] {
  const areas: DetailArea[] = [
    ...project.context
      .filter((f) => f.kind === 'harvest' || f.kind === 'existing-road')
      .map((f) => ({
        id: `context:${f.id}`,
        name: f.name,
        coordinates: coordinatesOf(f.geometry.coordinates),
      })),
    ...(project.reference ?? [])
      .filter(
        (f) =>
          f.geometry.type !== 'Point' && !project.cutblockBuffers?.some((b) => 'source' in b && b.source === f.source),
      )
      .map((f) => ({
        id: `reference:${f.id}`,
        name: f.name,
        coordinates: coordinatesOf(f.geometry.coordinates),
      })),
    ...project.alignments
      .filter((a) => a.id !== project.designPlaceholderId && project.workspaceMode !== 'access-investigation')
      .map((a) => ({
        id: `road:${a.id}`,
        name: a.name,
        coordinates: a.points.map((p) => p.coordinate),
      })),
  ].filter((a) => a.coordinates.length > 0)
  return areas
}

export type DemBox = { id: string; name: string; window: ReturnType<typeof detailWindow> }
export const HRDEM_BOX_SIDE = 2048

/** Split a large feature envelope into bounded native windows, without joining distant features. */
export function makeDemBoxes(areas: readonly DetailArea[], bufferM: number): DemBox[] {
  const projection = roadProjection(3979)
  return areas.flatMap((area) => {
    const window = detailWindow(area.coordinates, bufferM)
    if (!window.problem || window.width * window.height > HRDEM_MAX_DOWNLOAD_CELLS)
      return [{ id: area.id, name: area.name, window }]
    const boxes: DemBox[] = []
    const columns = Math.ceil(window.width / HRDEM_BOX_SIDE),
      rows = Math.ceil(window.height / HRDEM_BOX_SIDE)
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = Math.floor((column * window.width) / columns),
          y = Math.floor((row * window.height) / rows)
        const width = Math.floor(((column + 1) * window.width) / columns) - x,
          height = Math.floor(((row + 1) * window.height) / rows) - y
        const west = window.bbox[0] + x,
          north = window.bbox[3] - y
        const bbox: LonLatBounds = [west, north - height, west + width, north]
        const quad = [
          [west, north],
          [west + width, north],
          [west + width, north - height],
          [west, north - height],
        ].map((p) => projection.inverse(p) as Coordinate)
        const bounds: LonLatBounds = [
          Math.min(...quad.map((p) => p[0])),
          Math.min(...quad.map((p) => p[1])),
          Math.max(...quad.map((p) => p[0])),
          Math.max(...quad.map((p) => p[1])),
        ]
        boxes.push({
          id: `${area.id}:tile-${boxes.length + 1}`,
          name: `${area.name} · tile ${boxes.length + 1}`,
          window: { bbox, quad, bounds, width, height, problem: null },
        })
      }
    return boxes
  })
}

export function demBoxesGeoJson(boxes: readonly DemBox[]) {
  return {
    type: 'FeatureCollection' as const,
    features: boxes.map(({ id, name, window }) => ({
      type: 'Feature' as const,
      properties: { id, name, source: HRDEM_COLLECTION, cellM: 1, width: window.width, height: window.height },
      geometry: { type: 'Polygon' as const, coordinates: [[...window.quad, window.quad[0]]] },
    })),
  }
}

/** Native Float32 pixels and explicit no-data, so the downloaded raster reopens without rounding. */
export async function hrdemGeoTiff(
  raster: NonNullable<Awaited<ReturnType<typeof loadHrdemArea>>['metadata']['raster']>,
) {
  const { writeArrayBuffer, fromArrayBuffer } = await import('geotiff')
  // geotiff.js 2.x writes byte pixels only. Use its GeoTIFF tags, then write the declared Float32 strip.
  const header = writeArrayBuffer(new Uint8Array(raster.values.length), {
    width: raster.width,
    height: raster.height,
    BitsPerSample: [32],
    SampleFormat: [3],
    SamplesPerPixel: [1],
    StripByteCounts: [raster.values.length * 4],
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, raster.origin[0] - 0.5, raster.origin[1] + 0.5, 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: 3979,
    ProjLinearUnitsGeoKey: 9001,
    VerticalCSTypeGeoKey: 6647,
    VerticalUnitsGeoKey: 9001,
    GeoKeyDirectory: [
      1, 1, 0, 6, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3979, 3076, 0, 1, 9001, 4096, 0, 1, 6647, 4099, 0, 1, 9001,
    ],
    GDAL_NODATA: '-32767',
  }) as ArrayBuffer
  const image = await (await fromArrayBuffer(header)).getImage()
  const offset = image.fileDirectory.StripOffsets[0]
  const bytes = new Uint8Array(offset + raster.values.length * 4)
  bytes.set(new Uint8Array(header))
  const view = new DataView(bytes.buffer)
  const littleEndian = view.getUint16(0) === 0x4949
  for (let i = 0; i < raster.values.length; i++)
    view.setFloat32(offset + i * 4, raster.values[i] ?? -32767, littleEndian)
  return bytes.buffer
}

/** Explicit batch download: one bounded box at a time; failures are recorded, never filled. */
export async function downloadHrdemBoxes(
  boxes: readonly DemBox[],
  signal: AbortSignal,
  progress: (label: string) => void,
) {
  if (
    !boxes.length ||
    boxes.length > HRDEM_MAX_DOWNLOAD_BOXES ||
    boxes.some((b) => b.window.problem) ||
    boxes.reduce((n, b) => n + b.window.width * b.window.height, 0) > HRDEM_MAX_DOWNLOAD_CELLS
  )
    throw Error(
      `Select at most ${HRDEM_MAX_DOWNLOAD_BOXES} boxes and ${HRDEM_MAX_DOWNLOAD_CELLS / 1e6} million cells per download.`,
    )
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('download-boxes.geojson', JSON.stringify(demBoxesGeoJson(boxes)))
  const outcomes: { name: string; file?: string; coveragePercent?: number; error?: string }[] = []
  const session = createHrdemSession()
  for (const [index, box] of boxes.entries()) {
    signal.throwIfAborted()
    progress(`Reading 1 m DEM ${index + 1} of ${boxes.length} · ${box.name}`)
    try {
      const loaded = await loadHrdemArea(box.window, signal, session)
      const filename = `${index + 1}-${box.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 75)}.tif`
      zip.file(filename, await hrdemGeoTiff(loaded.metadata.raster!))
      outcomes.push({ name: box.name, file: filename, coveragePercent: loaded.coveragePercent })
    } catch (error) {
      signal.throwIfAborted()
      outcomes.push({ name: box.name, error: error instanceof Error ? error.message : 'Elevation not read.' })
    }
  }
  signal.throwIfAborted()
  zip.file(
    'sources-and-coverage.json',
    JSON.stringify({ credit: HRDEM_CREDIT, verticalReference: 'CGVD2013', epsg: 3979, outcomes }, null, 2),
  )
  progress('Packing 1 m DEM download…')
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  })
  signal.throwIfAborted()
  return { bytes, succeeded: outcomes.filter((o) => o.file).length, failed: outcomes.filter((o) => o.error).length }
}

/** Keep native 1 m cells. Large extents are refused before any network read. */
export function detailWindow(coordinates: readonly Coordinate[], bufferM: number) {
  if (!coordinates.length || !Number.isFinite(bufferM) || bufferM < 0 || bufferM > 2000)
    throw Error('Choose an area and a buffer between 0 and 2,000 m.')
  if (
    coordinates.some(
      ([lon, lat]) =>
        !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -139.1 || lon > -114 || lat < 48 || lat > 60.1,
    )
  )
    throw Error('Choose an area in British Columbia.')
  const projection = roadProjection(3979)
  const points = coordinates.map((c) => projection.forward([...c]))
  const west = Math.floor(Math.min(...points.map((p) => p[0])) - bufferM)
  const north = Math.ceil(Math.max(...points.map((p) => p[1])) + bufferM)
  const east = Math.max(west + 2, Math.ceil(Math.max(...points.map((p) => p[0])) + bufferM))
  const south = Math.min(north - 2, Math.floor(Math.min(...points.map((p) => p[1])) - bufferM))
  const width = east - west,
    height = north - south
  const bbox: LonLatBounds = [west, south, east, north]
  const quad = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ].map((p) => projection.inverse(p) as Coordinate)
  const bounds: LonLatBounds = [
    Math.min(...quad.map((p) => p[0])),
    Math.min(...quad.map((p) => p[1])),
    Math.max(...quad.map((p) => p[0])),
    Math.max(...quad.map((p) => p[1])),
  ]
  const problem =
    width * height > MAX_ROAD_RASTER_CELLS
      ? `This box needs ${((width * height) / 1e6).toFixed(1)} million 1 m cells. Pick one block or road, reduce the buffer, or zoom in (limit ${(MAX_ROAD_RASTER_CELLS / 1e6).toFixed(2)} million).`
      : null
  return { bbox, bounds, quad, width, height, problem }
}

type Item = { id: string; assets: { dtm: { href: string } }; properties?: { 'proj:epsg'?: number } }

/** The browser is allowed to range-read these COGs; reject a whole-file or oversized answer. */
class RangeClient extends BaseClient {
  private queued = createReadQueue(4)
  private bytes = 0
  constructor(
    url: string,
    private signal: AbortSignal,
  ) {
    super(url)
  }
  resume(signal: AbortSignal) {
    this.signal = signal
    this.bytes = 0
  }
  async request(options?: { headers: HeadersInit; signal: AbortSignal }): Promise<BaseResponse> {
    return this.queued(async () => {
      const response = await fetch(this.url, { ...options, signal: this.signal, credentials: 'omit' })
      if (response.status !== 206 || Number(response.headers.get('content-length')) > HRDEM_MAX_RANGE_BYTES) {
        await response.body?.cancel()
        throw Error('The elevation archive did not return a bounded byte-range response.')
      }
      const data = await response.arrayBuffer()
      this.bytes += data.byteLength
      if (data.byteLength > HRDEM_MAX_RANGE_BYTES || this.bytes > 64 * 1024 * 1024)
        throw Error('This elevation window exceeded its 64 MB transfer budget. Choose a smaller box.')
      // geotiff's BaseResponse declaration types its abstract status getter as void.
      return {
        ok: response.ok,
        status: response.status,
        getHeader: (name: string) => response.headers.get(name),
        getData: () => Promise.resolve(data),
      } as unknown as BaseResponse
    }, this.signal)
  }
}

function createHrdemSession() {
  return new Map<string, { tiff: Promise<GeoTIFF>; client: RangeClient }>()
}

export async function loadHrdemArea(
  window: ReturnType<typeof detailWindow>,
  signal: AbortSignal,
  session = createHrdemSession(),
) {
  if (window.problem) throw Error(window.problem)
  const controller = new AbortController()
  const timed = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(HRDEM_TIMEOUT_MS)])
  try {
    return await readHrdemWindow(window, timed, session)
  } finally {
    controller.abort()
  }
}

async function readHrdemWindow(
  window: ReturnType<typeof detailWindow>,
  timed: AbortSignal,
  session: ReturnType<typeof createHrdemSession>,
) {
  const url = new URL(HRDEM_SEARCH_URL)
  url.search = new URLSearchParams({
    collections: HRDEM_COLLECTION,
    bbox: window.bounds.join(','),
    limit: String(HRDEM_MAX_ITEMS + 1),
  }).toString()
  const response = await fetch(url, { signal: timed, credentials: 'omit' })
  if (!response.ok) throw Error(`NRCan elevation search failed (HTTP ${response.status}). Try again.`)
  const body = (await response.json()) as { features?: Item[]; links?: { rel: string }[] }
  if (!Array.isArray(body.features)) throw Error('NRCan returned an unreadable elevation catalogue.')
  if (body.features.length > HRDEM_MAX_ITEMS || body.links?.some((l) => l.rel === 'next'))
    throw Error('This area intersects too many elevation mosaics. Choose a smaller box.')
  const values: (number | null)[] = Array(window.width * window.height).fill(null)
  const sources = []
  for (const item of body.features) {
    timed.throwIfAborted()
    const href = item.assets?.dtm?.href
    if (
      !href ||
      !href.startsWith('https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/') ||
      item.properties?.['proj:epsg'] !== 3979
    )
      throw Error('NRCan returned an unsupported 1 m terrain asset.')
    let entry = session.get(href)
    if (!entry) {
      const client = new RangeClient(href, timed)
      const tiff = fromCustomClient(client, { allowFullFile: false, blockSize: 65536, cacheSize: 64 }, timed)
      entry = { client, tiff }
      session.set(href, entry)
      void tiff.catch(() => session.delete(href))
      while (session.size > 2) session.delete(session.keys().next().value!)
    } else entry.client.resume(timed)
    const tiff = await entry.tiff
    const image = await tiff.getImage()
    if (image.getResolution()[0] !== 1 || image.getResolution()[1] !== -1 || image.getSamplesPerPixel() !== 1)
      throw Error('The requested NRCan model does not have native 1 m bare-earth cells.')
    const [ox, oy] = image.getOrigin()
    const [west, south, east, north] = window.bbox
    const left = Math.max(0, Math.floor(west - ox)),
      top = Math.max(0, Math.floor(oy - north))
    const right = Math.min(image.getWidth(), Math.ceil(east - ox)),
      bottom = Math.min(image.getHeight(), Math.ceil(oy - south))
    if (left >= right || top >= bottom) continue
    // Reading the base image by integer pixel window keeps the native cells; no overview or resampling.
    const pixels = await image.readRasters({
      window: [left, top, right, bottom],
      samples: [0],
      interleave: true,
      signal: timed,
    })
    const nodata = image.getGDALNoData()
    const xOffset = ox + left - west,
      yOffset = north - (oy - top)
    for (let row = 0; row < bottom - top; row++)
      for (let col = 0; col < right - left; col++) {
        const v = Number(pixels[row * (right - left) + col])
        if (Number.isFinite(v) && v !== nodata && v >= -12000 && v <= 12000)
          values[(row + yOffset) * window.width + col + xOffset] = v
      }
    sources.push(href)
  }
  timed.throwIfAborted()
  const covered = values.filter((v) => v !== null).length
  if (!covered) throw Error('No 1 m elevation coverage in this box. Your current terrain is unchanged.')
  const bytes = new TextEncoder().encode(sources.join('\n'))
  const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')
  const name = 'NRCan HRDEM · 1 m bare-earth terrain'
  const loaded = await preparedTerrain(
    {
      name,
      kind: 'terrain',
      epsg: 3979,
      origin: [window.bbox[0] + 0.5, window.bbox[3] - 0.5],
      pixelSize: [1, -1],
      width: window.width,
      height: window.height,
      values,
      acquired: '',
      verticalReference: 'CGVD2013 · NRCan HRDEM mosaic',
    },
    {
      operation: 'mosaic',
      sources: [{ name, sha256: sourceHash, epsg: 3979, verticalReference: 'CGVD2013' }],
      method: 'NRCan hrdem-mosaic-1m DTM · native pixel windows; no-data retained',
      parameters: { bounds: window.bounds.join(','), sourceUrls: sources.join('; '), cellM: 1 },
    },
  )
  return { ...loaded, coveragePercent: (100 * covered) / values.length }
}
