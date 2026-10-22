/** Terrain adapters keep the source resolution, datum and missing-data footprint explicit. */
import proj4 from 'proj4'
import { loadElevationGrid } from '../dev-forestry/demLoader'
import { demResolutionMeters, demTileRange, type Bounds } from '../dev-forestry/terrain'
import { localRasterResolution, rasterProjection } from '../dev-forestry/localRaster'
import type { LocalRaster } from '../dev-forestry/types'
import { METRIC_CRS, readSourceGrid, type SourceGrid } from '../dev-lidar/sourceGrids'
import { alignmentLength, positionAt } from './engine'
import type {
  Alignment,
  Coordinate,
  RoadProject,
  RoadSettings,
  RoadTemplate,
  TerrainMetadata,
  TerrainSource,
} from './types'

export const DEFAULT_TEMPLATE: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 3,
  cutSlope: 0.75,
  fillSlope: 1.5,
  ditchWidth: 1,
  ditchDepth: 0.5,
  surfaceDepth: 0.25,
}
export const DEFAULT_ROAD_SETTINGS: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 12,
  fillRate: 8,
  surfacingRate: 40,
  clearingRate: 1.5,
  shrinkFactor: 0.9,
}
export const MAX_ROAD_RASTER_CELLS = 4_194_304
export const DEMO_ORIGIN: Coordinate = [-122.72, 53.89]
export const DEMO_BOUNDS: Bounds = [-122.731, 53.884, -122.689, 53.907]
export const LIDAR_BASE = 'https://pgmaps.ahmadjalil.com/data/lidar-analysis/bc-093g086/'
export const LIDAR_SOURCE_SHA256 = 'f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf'
const DEMO_METADATA: TerrainMetadata = {
  kind: 'demo',
  name: 'Synthetic training hillside near Prince George',
  resolutionM: 1,
  verticalReference: 'Synthetic metres; no survey or real-world vertical datum',
  epsg: 4326,
}

function xy(lon: number, lat: number): [number, number] {
  return [(lon - DEMO_ORIGIN[0]) * 111195 * Math.cos((DEMO_ORIGIN[1] * Math.PI) / 180), (lat - DEMO_ORIGIN[1]) * 111195]
}
function demoCoordinate(x: number, y: number): Coordinate {
  return [DEMO_ORIGIN[0] + x / (111195 * Math.cos((DEMO_ORIGIN[1] * Math.PI) / 180)), DEMO_ORIGIN[1] + y / 111195]
}
export const demoTerrain: TerrainSource = {
  elevationAt(lon, lat) {
    if (
      !Number.isFinite(lon + lat) ||
      lon < DEMO_BOUNDS[0] ||
      lon > DEMO_BOUNDS[2] ||
      lat < DEMO_BOUNDS[1] ||
      lat > DEMO_BOUNDS[3]
    )
      return NaN
    const [x, y] = xy(lon, lat)
    return (
      685 +
      0.052 * x +
      0.037 * y +
      5 * Math.sin(x / 155) +
      3 * Math.cos(y / 130) -
      7 * Math.exp(-(((x - 540) / 65) ** 2))
    )
  },
}

function exampleAlignment(
  id: string,
  name: string,
  coords: Coordinate[],
  source: TerrainSource,
  color: string,
): Alignment {
  const alignment: Alignment = {
    id,
    name,
    color,
    points: coords.map((coordinate, i) => ({
      id: `${id}-p${i}`,
      coordinate,
      radiusM: i > 0 && i < coords.length - 1 ? 30 : 0,
    })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  const length = alignmentLength(alignment),
    last = source.elevationAt(...coords[coords.length - 1])
  // Initialize a reviewable grade, then keep PVIs independent of subsequent terrain/plan edits.
  const stations = [0, length * 0.24, length * 0.5, length * 0.76, Math.max(0, length - 65), length]
  const controls = stations.map((chainage, i) => ({
    id: `${id}-v${i}`,
    chainage,
    elevation:
      i === stations.length - 2
        ? last - 0.5
        : source.elevationAt(...positionAt(alignment, chainage).coordinate) +
          (i > 0 && i < stations.length - 2 ? 0.5 : 0),
    curveLength: i > 0 && i < stations.length - 1 ? 40 : 0,
  }))
  if (controls.every((p) => Number.isFinite(p.elevation))) alignment.vertical = controls
  alignment.overrides = [
    {
      id: `${id}-turnout`,
      name: 'Passing turnout',
      kind: 'turnout',
      start: Math.min(200, length * 0.2),
      end: Math.min(260, length * 0.3),
      taper: 10,
      side: 'left',
      extraWidth: 4,
    },
    {
      id: `${id}-landing`,
      name: 'Terminal landing',
      kind: 'landing',
      start: Math.max(0, length - 60),
      end: length,
      taper: 12,
      side: 'left',
      extraWidth: 9,
    },
  ]
  return alignment
}

export function createDemoProject(): RoadProject {
  const coords = [
    [0, 0],
    [210, 100],
    [430, 180],
    [580, 320],
    [810, 410],
    [1050, 560],
    [1270, 620],
  ].map(([x, y]) => demoCoordinate(x, y))
  const main = exampleAlignment('demo-main', 'Hillside access · training', coords, demoTerrain, '#d97706')
  const alternative = exampleAlignment(
    'demo-contour',
    'Contour alternative · training',
    [
      [0, 0],
      [180, 180],
      [380, 300],
      [650, 390],
      [860, 570],
      [1100, 650],
      [1270, 620],
    ].map(([x, y]) => demoCoordinate(x, y)),
    demoTerrain,
    '#2563eb',
  )
  const landing = coords[coords.length - 1]
  return {
    schema: 'pgmaps-road-project-v1',
    name: 'Hillside access · synthetic training project',
    activeAlignmentId: main.id,
    alignments: [main, alternative],
    terrain: { ...DEMO_METADATA },
    settings: { ...DEFAULT_ROAD_SETTINGS },
    context: [
      {
        id: 'demo-stream',
        name: 'Synthetic drainage',
        kind: 'stream',
        geometry: {
          type: 'LineString',
          coordinates: [
            demoCoordinate(540, -250),
            demoCoordinate(520, 200),
            demoCoordinate(570, 650),
            demoCoordinate(520, 1050),
          ],
        },
      },
      {
        id: 'demo-existing',
        name: 'Synthetic existing road',
        kind: 'existing-road',
        geometry: {
          type: 'LineString',
          coordinates: [demoCoordinate(-150, -250), demoCoordinate(0, 0), demoCoordinate(60, 260)],
        },
      },
      {
        id: 'demo-avoid',
        name: 'Synthetic review area',
        kind: 'avoid',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              demoCoordinate(700, 200),
              demoCoordinate(950, 200),
              demoCoordinate(950, 330),
              demoCoordinate(700, 330),
              demoCoordinate(700, 200),
            ],
          ],
        },
      },
    ],
    cables: [
      {
        id: 'demo-cable-1',
        name: 'Landing D-line · geometric screen',
        start: landing,
        end: demoCoordinate(950, 940),
        startHeight: 18,
        endHeight: 8,
        deflectionPercent: 5,
      },
    ],
  }
}

export function roadProjection(epsg: number) {
  return epsg === 3157 ? proj4('EPSG:4326', METRIC_CRS) : rasterProjection(epsg)
}

/**
 * Grid coordinates for engineering exports: the terrain's own projected CRS when it has one,
 * otherwise WGS84 UTM for the zone at `at` (EPSG:326xx north, 327xx south).
 */
export function exportGrid(metadata: TerrainMetadata, at: Coordinate) {
  if (metadata.epsg && metadata.epsg !== 4326) {
    const projection = roadProjection(metadata.epsg)
    return {
      epsg: metadata.epsg,
      toGrid: (c: Coordinate) => projection.forward([...c]) as [number, number],
      toLonLat: (xy: [number, number]) => projection.inverse([...xy]) as Coordinate,
    }
  }
  const zone = Math.max(1, Math.min(60, Math.floor((at[0] + 180) / 6) + 1)),
    south = at[1] < 0
  const projection = proj4(
    'EPSG:4326',
    `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
  )
  return {
    epsg: (south ? 32700 : 32600) + zone,
    toGrid: (c: Coordinate) => projection.forward([...c]) as [number, number],
    toLonLat: (xy: [number, number]) => projection.inverse([...xy]) as Coordinate,
  }
}

/** Validate before decoding/sampling project-embedded cells; never reinterpret unknown CRS. */
export function validateRoadRaster(raw: unknown): LocalRaster {
  const r = raw as LocalRaster
  if (
    !r ||
    r.kind !== 'terrain' ||
    !Number.isInteger(r.width) ||
    !Number.isInteger(r.height) ||
    r.width < 2 ||
    r.height < 2 ||
    r.width * r.height > MAX_ROAD_RASTER_CELLS ||
    !Array.isArray(r.values) ||
    r.values.length !== r.width * r.height ||
    !Array.isArray(r.origin) ||
    r.origin.length !== 2 ||
    !Array.isArray(r.pixelSize) ||
    r.pixelSize.length !== 2 ||
    ![...r.origin, ...r.pixelSize].every(Number.isFinite) ||
    r.pixelSize[0] <= 0 ||
    r.pixelSize[1] >= 0 ||
    typeof r.name !== 'string' ||
    r.name.length > 200 ||
    typeof r.id !== 'string' ||
    r.id.length > 100 ||
    typeof r.verticalReference !== 'string' ||
    !r.verticalReference.trim() ||
    r.verticalReference.length > 300 ||
    typeof r.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.sha256) ||
    r.values.some((v) => v !== null && (!Number.isFinite(v) || v < -12000 || v > 12000))
  )
    throw Error(
      'Invalid terrain raster: use a north-up, metre-valued GeoTIFF with at most 4,194,304 cells and its vertical datum.',
    )
  roadProjection(r.epsg)
  return {
    id: r.id,
    name: r.name,
    kind: 'terrain',
    epsg: r.epsg,
    origin: [...r.origin],
    pixelSize: [...r.pixelSize],
    width: r.width,
    height: r.height,
    values: r.values.slice(),
    acquired: typeof r.acquired === 'string' ? r.acquired.slice(0, 100) : '',
    verticalReference: r.verticalReference.trim(),
    sha256: r.sha256,
  }
}

function rasterSource(r: LocalRaster): TerrainSource {
  const projection = roadProjection(r.epsg)
  return {
    elevationAt(lon, lat) {
      const [x, y] = projection.forward([lon, lat])
      let col = (x - r.origin[0]) / r.pixelSize[0],
        row = (y - r.origin[1]) / r.pixelSize[1]
      // Projection round trips can move an exact edge centre by a few nanometres.
      // Admit only floating-point fuzz, never extrapolate the outer half-pixel.
      const tolerance = 1e-6
      if (
        !Number.isFinite(col + row) ||
        col < -tolerance ||
        row < -tolerance ||
        col > r.width - 1 + tolerance ||
        row > r.height - 1 + tolerance
      )
        return NaN
      col = Math.min(r.width - 1, Math.max(0, col))
      row = Math.min(r.height - 1, Math.max(0, row))
      const c = Math.min(r.width - 2, Math.floor(col)),
        q = Math.min(r.height - 2, Math.floor(row)),
        u = col - c,
        v = row - q
      const values = [
        r.values[q * r.width + c],
        r.values[q * r.width + c + 1],
        r.values[(q + 1) * r.width + c],
        r.values[(q + 1) * r.width + c + 1],
      ]
      if (values.some((n) => n === null || !Number.isFinite(n))) return NaN
      return values[0]! * (1 - u) * (1 - v) + values[1]! * u * (1 - v) + values[2]! * (1 - u) * v + values[3]! * u * v
    },
  }
}

function sourceGridTerrain(grid: SourceGrid): TerrainSource {
  const projection = roadProjection(3157)
  return {
    elevationAt(lon, lat) {
      const [x, y] = projection.forward([lon, lat])
      let col = (x - grid.bounds[0]) / grid.resolution - 0.5,
        row = (grid.bounds[3] - y) / grid.resolution - 0.5
      const tolerance = 1e-6
      if (
        !Number.isFinite(col + row) ||
        col < -tolerance ||
        row < -tolerance ||
        col > grid.width - 1 + tolerance ||
        row > grid.height - 1 + tolerance
      )
        return NaN
      col = Math.min(grid.width - 1, Math.max(0, col))
      row = Math.min(grid.height - 1, Math.max(0, row))
      const c = Math.min(grid.width - 2, Math.floor(col)),
        r = Math.min(grid.height - 2, Math.floor(row)),
        u = col - c,
        v = row - r
      const values = [
        grid.values[r * grid.width + c],
        grid.values[r * grid.width + c + 1],
        grid.values[(r + 1) * grid.width + c],
        grid.values[(r + 1) * grid.width + c + 1],
      ]
      if (values.some((n) => !Number.isFinite(n) || n === grid.noData)) return NaN
      return values[0] * (1 - u) * (1 - v) + values[1] * u * (1 - v) + values[2] * (1 - u) * v + values[3] * u * v
    },
  }
}

const loaded = new Map<string, { source: TerrainSource; bounds: Bounds }>()
const terrainKey = (m: TerrainMetadata) => `${m.kind}:${m.sha256 ?? `${m.sourceUrl ?? ''}:${m.name}:${m.resolutionM}`}`
export function terrainFromMetadata(metadata: TerrainMetadata): TerrainSource | null {
  if (metadata.kind === 'demo') return demoTerrain
  if (metadata.raster) return rasterSource(validateRoadRaster(metadata.raster))
  if (metadata.kind === 'geotiff' && (metadata.epsg !== 3157 || metadata.resolutionM !== 1)) return null
  return loaded.get(terrainKey(metadata))?.source ?? null
}
export function terrainBounds(metadata: TerrainMetadata): Bounds | null {
  if (metadata.kind === 'demo') return [...DEMO_BOUNDS]
  if (metadata.raster) {
    const r = metadata.raster,
      project = roadProjection(r.epsg)
    const corners = [
      [r.origin[0], r.origin[1]],
      [r.origin[0] + (r.width - 1) * r.pixelSize[0], r.origin[1]],
      [r.origin[0], r.origin[1] + (r.height - 1) * r.pixelSize[1]],
      [r.origin[0] + (r.width - 1) * r.pixelSize[0], r.origin[1] + (r.height - 1) * r.pixelSize[1]],
    ].map((p) => project.inverse(p))
    return [
      Math.min(...corners.map((p) => p[0])),
      Math.min(...corners.map((p) => p[1])),
      Math.max(...corners.map((p) => p[0])),
      Math.max(...corners.map((p) => p[1])),
    ]
  }
  return loaded.get(terrainKey(metadata))?.bounds ?? null
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Terrain loading cancelled', 'AbortError')
}
/** Shared raster reads may serve another view; cancel this consumer without disturbing that cache. */
function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Terrain loading cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    task.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

/** Restore the recorded bytes, not whatever a later publication calls its current DTM. */
export async function loadTerrainMetadata(metadata: TerrainMetadata, signal?: AbortSignal): Promise<TerrainSource> {
  checkAbort(signal)
  const ready = terrainFromMetadata(metadata)
  if (ready) return ready
  if (metadata.kind === 'regional')
    throw Error('Reload regional terrain for the alignment extent; this project does not embed those tiles.')
  const url = metadata.sourceUrl ? new URL(metadata.sourceUrl) : null
  if (
    metadata.kind !== 'geotiff' ||
    metadata.epsg !== 3157 ||
    metadata.resolutionM !== 1 ||
    !metadata.sha256 ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    !url ||
    url.protocol !== 'https:' ||
    url.pathname !== new URL('dtm-1m.tif', LIDAR_BASE).pathname ||
    url.username ||
    url.password
  )
    throw Error('This project needs its original terrain GeoTIFF re-imported; no substitute terrain has been loaded.')
  const grid = await abortable(readSourceGrid(new URL('.', url).href, 'dtm-1m.tif', metadata.sha256), signal)
  checkAbort(signal)
  const source = sourceGridTerrain(grid),
    projection = roadProjection(3157)
  const corners = [
    [grid.bounds[0], grid.bounds[1]],
    [grid.bounds[0], grid.bounds[3]],
    [grid.bounds[2], grid.bounds[1]],
    [grid.bounds[2], grid.bounds[3]],
  ].map((p) => projection.inverse(p))
  const bounds: Bounds = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ]
  loaded.set(terrainKey(metadata), { source, bounds })
  return source
}

export async function loadLidarTerrain(
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<{ metadata: TerrainMetadata; source: TerrainSource; alignments?: Alignment[] }> {
  checkAbort(signal)
  onProgress?.('Reading the published LiDAR terrain manifest…')
  const local =
    typeof location === 'undefined'
      ? LIDAR_BASE
      : new URL(`${import.meta.env.BASE_URL}data/lidar-analysis/bc-093g086/`, location.origin).href
  let base = local,
    checksums: Record<string, { sha256: string }>,
    summary: { source_sha256?: string }
  async function manifest(at: string) {
    const replies = await Promise.all([
      fetch(new URL('checksums.json', at), { signal }),
      fetch(new URL('summary.json', at), { signal }),
    ])
    if (replies.some((r) => !r.ok)) throw Error('Published LiDAR products are not available on this host.')
    return Promise.all(replies.map((r) => r.json())) as Promise<
      [Record<string, { sha256: string }>, { source_sha256?: string }]
    >
  }
  try {
    ;[checksums, summary] = await manifest(base)
  } catch (error) {
    checkAbort(signal)
    if (base === LIDAR_BASE) throw error
    base = LIDAR_BASE
    ;[checksums, summary] = await manifest(base)
  }
  const hash = checksums['dtm-1m.tif']?.sha256
  if (summary.source_sha256 !== LIDAR_SOURCE_SHA256 || !hash || !/^[a-f0-9]{64}$/.test(hash))
    throw Error('LiDAR source or terrain checksum does not match the documented BC tile.')
  checkAbort(signal)
  onProgress?.('Loading and verifying the native 1 m bare-earth DTM…')
  const grid = await abortable(readSourceGrid(base, 'dtm-1m.tif', hash), signal)
  checkAbort(signal)
  const source = sourceGridTerrain(grid),
    projection = roadProjection(3157)
  const corners = [
    [grid.bounds[0], grid.bounds[1]],
    [grid.bounds[0], grid.bounds[3]],
    [grid.bounds[2], grid.bounds[1]],
    [grid.bounds[2], grid.bounds[3]],
  ].map((p) => projection.inverse(p))
  const bounds: Bounds = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ]
  const metadata: TerrainMetadata = {
    kind: 'geotiff',
    name: 'BC 093G086 · classified-ground LiDAR DTM · 1 m (July 2024)',
    resolutionM: 1,
    epsg: 3157,
    verticalReference: 'CGVD2013 (CGG2013), EPSG:6647; metres',
    sourceUrl: new URL('dtm-1m.tif', base).href,
    sha256: hash,
  }
  loaded.set(terrainKey(metadata), { source, bounds })
  // A transparent example alignment on the real terrain, not a surveyed or optimized road.
  const coords: Coordinate[] = [
    [0.15, 0.35],
    [0.3, 0.4],
    [0.45, 0.48],
    [0.6, 0.52],
    [0.75, 0.6],
  ].map(
    ([u, v]) =>
      projection.inverse([
        grid.bounds[0] + (grid.bounds[2] - grid.bounds[0]) * u,
        grid.bounds[1] + (grid.bounds[3] - grid.bounds[1]) * v,
      ]) as Coordinate,
  )
  const alignment = exampleAlignment(
    'lidar-example',
    'Draft alignment on real LiDAR · review required',
    coords,
    source,
    '#d97706',
  )
  onProgress?.('Native 1 m LiDAR terrain ready; unsupported cells remain missing.')
  return { metadata, source, alignments: [alignment] }
}

export async function loadRaster(
  file: File,
  verticalReference: string,
): Promise<{ metadata: TerrainMetadata; source: TerrainSource }> {
  if (!verticalReference.trim() || verticalReference.trim().length > 300)
    throw Error('Enter the terrain vertical datum and confirm elevation values are metres.')
  if (file.size > 64_000_000) throw Error('Crop the terrain GeoTIFF first; the file limit is 64 MB.')
  const bytes = await file.arrayBuffer(),
    { fromArrayBuffer } = await import('geotiff'),
    image = await (await fromArrayBuffer(bytes)).getImage()
  const width = image.getWidth(),
    height = image.getHeight(),
    keys = image.getGeoKeys()
  if (width < 2 || height < 2 || width * height > MAX_ROAD_RASTER_CELLS)
    throw Error('Use a cropped GeoTIFF with 2–4,194,304 native cells. No automatic downsampling is applied.')
  if (image.getSamplesPerPixel() !== 1) throw Error('Use a single-band bare-earth terrain elevation GeoTIFF.')
  if (image.fileDirectory.ModelTransformation)
    throw Error('Reproject a rotated raster to a north-up GeoTIFF before importing.')
  const epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey)
  roadProjection(epsg)
  if (keys.VerticalUnitsGeoKey && keys.VerticalUnitsGeoKey !== 9001)
    throw Error('Convert elevation values to metres before importing.')
  if (epsg !== 4326 && keys.ProjLinearUnitsGeoKey && keys.ProjLinearUnitsGeoKey !== 9001)
    throw Error('Convert projected horizontal coordinates to metres before importing.')
  const origin = image.getOrigin(),
    size = image.getResolution(),
    shift = keys.GTRasterTypeGeoKey === 2 ? 0 : 0.5
  const rasterValues = await image.readRasters({ samples: [0], interleave: true }),
    noData = image.getGDALNoData()
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const raster = validateRoadRaster({
    id: `terrain-${sha256.slice(0, 16)}`,
    name: file.name.slice(0, 200),
    kind: 'terrain',
    epsg,
    origin: [origin[0] + size[0] * shift, origin[1] + size[1] * shift],
    pixelSize: [size[0], size[1]],
    width,
    height,
    values: Array.from(rasterValues as ArrayLike<number>, (v) => (!Number.isFinite(v) || v === noData ? null : v)),
    acquired: '',
    verticalReference: verticalReference.trim(),
    sha256,
  })
  const latitude = roadProjection(epsg).inverse(raster.origin)[1]
  const metadata: TerrainMetadata = {
    kind: 'geotiff',
    name: raster.name,
    resolutionM: localRasterResolution(raster, latitude),
    epsg,
    verticalReference: raster.verticalReference,
    sha256,
    raster,
  }
  return { metadata, source: rasterSource(raster) }
}

export interface PointCloudImport {
  /** Run the ground filter: 'auto' only when the cloud has no ground-classified points. */
  classify: boolean | 'auto'
  /** Cell mean of the ground points, or a TIN of them that honours `breaklines`. */
  surface: 'mean' | 'tin'
  /** GeoJSON lines (WGS84) whose vertices and segments the TIN must keep. */
  breaklines?: unknown
  onProgress?: (message: string) => void
  signal?: AbortSignal
}

/**
 * A LAS or LAZ point cloud as terrain. A worker decodes it (LAZ through whitebox-wasm), classifies
 * ground when asked, and grids the ground points to about 1 m: as a cell mean with short gaps
 * filled, or as a TIN, which can carry breaklines and leaves gaps wider than its edge limit
 * missing. The grid then behaves like an imported GeoTIFF.
 */
export async function loadLas(
  file: File,
  verticalReference: string,
  options: PointCloudImport = { classify: 'auto', surface: 'mean' },
): Promise<{ metadata: TerrainMetadata; source: TerrainSource; summary: string }> {
  if (file.size > 1_000_000_000) throw Error('Crop the point cloud first; the limit is 1 GB.')
  const bytes = await file.arrayBuffer()
  const { readPointCloudHeader } = await import('./pointCloud')
  const header = readPointCloudHeader(new Uint8Array(bytes))
  if (header.epsg === null)
    throw Error('This point cloud has no projected CRS key. Assign one (for example with PDAL) before importing.')
  const projection = roadProjection(header.epsg)
  const vertical = verticalReference.trim() || (header.verticalEpsg ? `EPSG:${header.verticalEpsg}; metres` : '')
  if (!vertical) throw Error('Enter the vertical datum of the point-cloud elevations before importing.')
  const breaklines =
    options.surface === 'tin' && options.breaklines
      ? (await import('./tinSurface')).readBreaklines(
          options.breaklines,
          (lon, lat) => projection.forward([lon, lat]) as [number, number],
        )
      : []
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const { runPointCloudWorker } = await import('./pointCloudClient')
  const stages = { reading: 'Reading points', classifying: 'Classifying ground', gridding: 'Building the surface' }
  const result = await runPointCloudWorker(bytes, {
    classify: options.classify,
    surface: { method: options.surface, cellM: 1, maxCells: MAX_ROAD_RASTER_CELLS, gapCells: 3, breaklines },
    signal: options.signal,
    onProgress: (stage, done, total) =>
      options.onProgress?.(`${stages[stage]}${total > 1 ? ` · ${done} of ${total} tiles` : ''}…`),
  })
  const grid = result.surface!.grid
  const raster = validateRoadRaster({
    id: `terrain-${sha256.slice(0, 16)}`,
    name: `${file.name.slice(0, 160)} · ground ${options.surface === 'tin' ? 'TIN' : 'mean'} ${grid.cellM.toFixed(2)} m`,
    kind: 'terrain',
    epsg: header.epsg,
    origin: grid.origin,
    pixelSize: grid.pixelSize,
    width: grid.width,
    height: grid.height,
    values: grid.values,
    acquired: '',
    verticalReference: vertical.slice(0, 300),
    sha256,
  })
  const latitude = projection.inverse(raster.origin)[1]
  const metadata: TerrainMetadata = {
    kind: 'geotiff',
    name: raster.name,
    resolutionM: localRasterResolution(raster, latitude),
    epsg: header.epsg,
    verticalReference: raster.verticalReference,
    sha256,
    raster,
  }
  const known = grid.values.filter((v) => v !== null).length
  const count = (n: number) => n.toLocaleString('en-CA')
  const { cloud, summary, classifiedBy, timings } = result
  const tin = result.surface!.tin
  const parts = [
    `${cloud.format.toUpperCase()} ${cloud.version}: ${count(summary.ground)} of ${count(cloud.count)} points are ground`,
    cloud.thinCellM !== null
      ? `(thinned from ${count(cloud.sourceCount)}, lowest point per ${cloud.thinCellM.toFixed(2)} m)`
      : '',
    classifiedBy ? `, classified here in ${(timings.classifyMs / 1000).toFixed(1)} s` : '',
    `; ${grid.width} × ${grid.height} cells at ${grid.cellM.toFixed(2)} m`,
    tin
      ? ` from a TIN with ${count(tin.constrained)} breakline segments${tin.skipped.length ? ` (${tin.skipped.length} skipped: ${tin.skipped[0].reason})` : ''}`
      : `, ${count(grid.filledCells)} short gaps filled`,
    `, ${count(grid.width * grid.height - known)} cells left missing.`,
  ]
  return { metadata, source: rasterSource(raster), summary: parts.join('') }
}

export async function loadRegionalTerrain(
  bounds: Bounds,
  signal?: AbortSignal,
): Promise<{ metadata: TerrainMetadata; source: TerrainSource }> {
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3] ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -85 ||
    bounds[3] > 85
  )
    throw Error('Choose a finite geographic terrain extent.')
  const zoom = 12,
    range = demTileRange(bounds, zoom, 100)
  if (range.tileCount > 64) throw Error('Zoom in to a smaller area before loading regional terrain (maximum 64 tiles).')
  const { grid, missingTileCount } = await loadElevationGrid({ range, signal, concurrency: 4 })
  checkAbort(signal)
  if (missingTileCount === range.tileCount)
    throw Error('Regional terrain could not be loaded; your existing design is unchanged.')
  const resolutionM = demResolutionMeters((bounds[1] + bounds[3]) / 2, zoom)
  const metadata: TerrainMetadata = {
    kind: 'regional',
    name: `Regional Terrarium DEM · coarse screening · ${bounds.map((n) => n.toFixed(5)).join(',')}${missingTileCount ? ` · ${missingTileCount} missing tiles` : ''}`,
    resolutionM,
    epsg: 3857,
    verticalReference: 'Mixed-source regional DEM; vertical datum/accuracy unverified for design',
    sourceUrl: 'https://registry.opendata.aws/terrain-tiles/',
  }
  loaded.set(terrainKey(metadata), { source: grid, bounds: [...bounds] })
  return { metadata, source: grid }
}
