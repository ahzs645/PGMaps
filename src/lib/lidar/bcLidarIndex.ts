/**
 * BC's LiDAR tile index (LidarBC, https://lidar.gov.bc.ca/pages/download-discovery). The portal is an
 * ArcGIS app over one hosted feature service, which sends `Access-Control-Allow-Origin: *`, so this
 * page queries it live. The files it lists sit on the NRS object store, which sends no CORS headers
 * and answers a preflight with 403: a browser on another site can link to them but cannot read them,
 * their sizes or the bucket listing. The LAZ files are not COPC and the GeoTIFFs are not COG either,
 * so nothing here could stream them even with CORS. See `docs/research/bc-lidar-portal.md`.
 *
 * No DOM or network access: this file builds URLs and reads attributes, so its tests run anywhere.
 */

export const LIDAR_BC_SERVICE =
  'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer'
export const LIDAR_BC_PORTAL = 'https://lidar.gov.bc.ca/pages/download-discovery'
/**
 * The 2024 point-cloud tile 093G086 4.4.4 near Prince George (84,608,005 returns, 550,572,701 bytes),
 * the sample the LiDAR viewer's products and the restoration tool's real-data check were built from.
 * A link only: the object store sends no CORS headers, so the page cannot read it.
 */
export const LIDAR_BC_SAMPLE_LAZ =
  'https://nrs.objectstore.gov.bc.ca/gdwuts/093/093g/2024/pointcloud/bc_093g086_4_4_4_xyes_8_utm10_20240713_20240713.laz'

export type LidarBcProductId = 'pointcloud' | 'dem2500' | 'dem20000' | 'dsm2500' | 'dsm10000' | 'dsm20000'

export interface LidarBcProduct {
  id: LidarBcProductId
  /** Feature service layer. */
  layer: number
  label: string
  format: string
  /** BCGS grid the files are cut to. */
  grid: '1:2,500' | '1:10,000' | '1:20,000'
  /** Area of one grid cell. */
  cellKm2: number
  /** Tiles draw from this zoom; below it the page counts them instead (the portal does the same by scale). */
  minZoom: number
  /**
   * Median file size measured from the bucket listing for NTS sheet 093G (Prince George) on 2026-11-09.
   * The index carries no sizes, so totals from this are estimates; `null` where nothing was measured.
   */
  medianBytes: number | null
  medianNote: string
  outFields: string
}

const RASTER_FIELDS = 'OBJECTID,maptile,year,spacing,projection,contract,oper_name,filename,s3Url'

export const LIDAR_BC_PRODUCTS: readonly LidarBcProduct[] = [
  {
    id: 'pointcloud',
    layer: 4,
    label: 'Point clouds',
    format: 'LAZ',
    grid: '1:2,500',
    cellKm2: 2.56,
    minZoom: 10,
    medianBytes: 574e6,
    medianNote: '2024 tiles in 093G; 2019 tiles were 261 MB and 2025 tiles 693 MB',
    outFields: 'OBJECTID,maptile,year,density,projection,contract,oper_name,filename,s3Url,s3RptUrl',
  },
  {
    id: 'dem2500',
    layer: 5,
    label: 'Bare-earth DEM',
    format: 'GeoTIFF',
    grid: '1:2,500',
    cellKm2: 2.56,
    minZoom: 10,
    medianBytes: 6.5e6,
    medianNote: '2024 tiles in 093G',
    outFields: RASTER_FIELDS,
  },
  {
    id: 'dem20000',
    layer: 6,
    label: 'Bare-earth DEM',
    format: 'GeoTIFF',
    grid: '1:20,000',
    cellKm2: 164,
    minZoom: 7,
    medianBytes: 604e6,
    medianNote: '2019 sheets in 093G',
    outFields: RASTER_FIELDS,
  },
  {
    id: 'dsm2500',
    layer: 1,
    label: 'Surface model (DSM)',
    format: 'GeoTIFF',
    grid: '1:2,500',
    cellKm2: 2.56,
    minZoom: 10,
    medianBytes: 6.8e6,
    medianNote: '2024 tiles in 093G',
    outFields: RASTER_FIELDS,
  },
  {
    id: 'dsm10000',
    layer: 2,
    label: 'Surface model (DSM)',
    format: 'LAZ',
    grid: '1:10,000',
    cellKm2: 41,
    minZoom: 8,
    medianBytes: null,
    medianNote: 'not measured',
    outFields: RASTER_FIELDS,
  },
  {
    id: 'dsm20000',
    layer: 3,
    label: 'Surface model (DSM)',
    format: 'GeoTIFF',
    grid: '1:20,000',
    cellKm2: 164,
    minZoom: 7,
    medianBytes: null,
    medianNote: 'not measured',
    outFields: RASTER_FIELDS,
  },
]

export const productById = (id: string) => LIDAR_BC_PRODUCTS.find((product) => product.id === id)

/** Attributes the tile layers share; fields a layer lacks come back undefined. */
export interface LidarBcTile {
  OBJECTID: number
  maptile: string
  year: number
  /** Point clouds only: points per square metre. */
  density?: number | null
  /** Rasters only, e.g. "1 metre". */
  spacing?: string | null
  projection?: string | null
  contract?: string | null
  /** The acquisition project. */
  oper_name?: string | null
  filename?: string | null
  s3Url?: string | null
  /** Point clouds only: the contract's accuracy report. */
  s3RptUrl?: string | null
}

export type LonLatBounds = { west: number; south: number; east: number; north: number }

function query(layer: number, params: Record<string, string | number | boolean>) {
  const search = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
  return `${LIDAR_BC_SERVICE}/${layer}/query?${search}`
}

/**
 * What sets a tile's detail: point clouds carry their points per square metre (`density`, every tile
 * has one), the rasters their cell size as text (`spacing`, "1 metre"; blank on the 1:10,000 DSMs and
 * some 1:2,500 ones).
 */
export const detailField = (product: LidarBcProduct): 'density' | 'spacing' =>
  product.id === 'pointcloud' ? 'density' : 'spacing'

/** Stands for a tile whose detail field is empty, null or blank text. */
export const DETAIL_NOT_STATED = 'not-stated'

/**
 * A filter on the index. `detail` is the value of `detailField` as text (`"8"`, `"1 metre"`) or
 * `DETAIL_NOT_STATED`.
 */
export interface TileFilter {
  year: number | null
  detail: string | null
}

export const NO_FILTER: TileFilter = { year: null, detail: null }

function detailWhere(product: LidarBcProduct, detail: string | null) {
  if (detail == null) return null
  const field = detailField(product)
  if (detail === DETAIL_NOT_STATED)
    return field === 'density' ? 'density IS NULL' : "(spacing IS NULL OR spacing='' OR spacing=' ')"
  if (field === 'density') {
    const value = Number(detail)
    // A density is a number; anything else must not reach the where clause.
    return Number.isFinite(value) ? `density=${value}` : '1=0'
  }
  return `spacing='${detail.replace(/'/g, "''")}'`
}

/** The where clause for a filter, leaving out any part the filter does not set. */
export function filterWhere(product: LidarBcProduct, filter: TileFilter, omit?: keyof TileFilter) {
  const parts = [
    omit !== 'year' && filter.year != null ? `year=${Math.trunc(filter.year)}` : null,
    omit !== 'detail' ? detailWhere(product, filter.detail) : null,
  ].filter((part): part is string => part != null)
  return parts.length ? parts.join(' AND ') : '1=1'
}
const envelope = (b: LonLatBounds) => ({
  geometry: [b.west, b.south, b.east, b.north].map((n) => n.toFixed(5)).join(','),
  geometryType: 'esriGeometryEnvelope',
  inSR: 4326,
  spatialRel: 'esriSpatialRelIntersects',
})

/** At most this many tiles per view; the service allows 4,000 for tile queries. */
export const TILE_PAGE = 2000

/** Tiles of one product inside a view, as GeoJSON in WGS84. */
export function tilesUrl(product: LidarBcProduct, bounds: LonLatBounds, filter: TileFilter) {
  return query(product.layer, {
    where: filterWhere(product, filter),
    ...envelope(bounds),
    outFields: product.outFields,
    outSR: 4326,
    geometryPrecision: 6,
    orderByFields: 'OBJECTID',
    resultRecordCount: TILE_PAGE,
    f: 'geojson',
  })
}

/** How many tiles of one product a view holds (or the province, without bounds). */
export function countUrl(product: LidarBcProduct, bounds: LonLatBounds | null, filter: TileFilter) {
  return query(product.layer, {
    where: filterWhere(product, filter),
    ...(bounds ? envelope(bounds) : {}),
    returnCountOnly: true,
    f: 'json',
  })
}

/** Tile counts per acquisition year, counted by the service, optionally within a where clause. */
export function yearCountsUrl(product: LidarBcProduct, where = '1=1') {
  return query(product.layer, {
    where,
    outStatistics: JSON.stringify([
      { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'tiles' },
    ]),
    groupByFieldsForStatistics: 'year',
    orderByFields: 'year',
    f: 'json',
  })
}

/** The province's coverage, one simplified outline per acquisition year (about 28 KB gzipped). */
export function coverageUrl() {
  return query(0, {
    where: '1=1',
    outFields: 'YEAR_',
    outSR: 4326,
    geometryPrecision: 4,
    maxAllowableOffset: 0.005,
    f: 'geojson',
  })
}

export function parseYearCounts(json: unknown): { year: number; tiles: number }[] {
  const features = (json as { features?: { attributes?: { year?: unknown; tiles?: unknown } }[] })?.features
  if (!Array.isArray(features)) throw Error('The LiDAR index returned no year counts')
  return features
    .map((f) => ({ year: Number(f.attributes?.year), tiles: Number(f.attributes?.tiles) }))
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.tiles))
    .sort((a, b) => a.year - b.year)
}

/** Tile counts per density (point clouds) or cell size (rasters), counted by the service. */
export function detailCountsUrl(product: LidarBcProduct, where = '1=1') {
  const field = detailField(product)
  return query(product.layer, {
    where,
    outStatistics: JSON.stringify([
      { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'tiles' },
    ]),
    groupByFieldsForStatistics: field,
    orderByFields: field,
    f: 'json',
  })
}

export interface DetailCount {
  /** The filter value: the field's text, or `DETAIL_NOT_STATED`. */
  key: string
  label: string
  tiles: number
}

/**
 * Reads detail counts back: densities in ascending order as "8 pts/m²", cell sizes by their metres,
 * and every empty value merged into one "Not stated" row, last.
 */
export function parseDetailCounts(product: LidarBcProduct, json: unknown): DetailCount[] {
  const field = detailField(product)
  const features = (json as { features?: { attributes?: Record<string, unknown> }[] })?.features
  if (!Array.isArray(features)) throw Error('The LiDAR index returned no density counts')
  const rows = new Map<string, DetailCount & { order: number }>()
  for (const feature of features) {
    const tiles = Number(feature.attributes?.tiles)
    if (!Number.isFinite(tiles)) continue
    const raw = feature.attributes?.[field]
    const text = raw == null ? '' : String(raw).trim()
    const stated = text !== '' && (field === 'spacing' || Number.isFinite(Number(text)))
    const key = stated ? (field === 'spacing' ? String(raw) : text) : DETAIL_NOT_STATED
    const order = stated ? (field === 'density' ? Number(text) : parseFloat(text)) : Infinity
    const label = !stated ? 'Not stated' : field === 'density' ? `${text} pts/m²` : text.replace(/ metres?$/, ' m')
    const previous = rows.get(key)
    rows.set(key, { key, label, tiles: (previous?.tiles ?? 0) + tiles, order: Number.isNaN(order) ? 0 : order })
  }
  return [...rows.values()].sort((a, b) => a.order - b.order).map(({ key, label, tiles }) => ({ key, label, tiles }))
}

export function parseCount(json: unknown): number {
  const count = (json as { count?: unknown })?.count
  if (typeof count !== 'number') {
    const message = (json as { error?: { message?: string } })?.error?.message
    throw Error(message ? `LiDAR index: ${message}` : 'The LiDAR index returned no count')
  }
  return count
}

/**
 * Older surface models are listed as `*_dsm.tif` but stored as `*_dsm.laz`: every 1:10,000 DSM (2017)
 * and the 1:2,500 DSMs from 2016 and 2018. The listed link returns 404, so point at the stored file.
 */
export function storedFile(product: LidarBcProduct, tile: Pick<LidarBcTile, 'year' | 's3Url'>) {
  const url = tile.s3Url ?? null
  const laz =
    url != null &&
    /_dsm\.tif$/i.test(url) &&
    (product.id === 'dsm10000' || (product.id === 'dsm2500' && (tile.year === 2016 || tile.year === 2018)))
  return {
    url: laz ? url.replace(/\.tif$/i, '.laz') : url,
    format: laz ? 'LAZ' : product.format,
    corrected: laz,
  }
}

/** Estimated download size for `tiles` files of a product, from the measured median. */
export function estimatedBytes(product: LidarBcProduct, tiles: number) {
  return product.medianBytes == null ? null : product.medianBytes * tiles
}

export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes,
    unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Colours acquisition years from early (light) to recent (dark), for the map and its legend. */
export const YEAR_STOPS: readonly [number, string][] = [
  [2011, '#fde68a'],
  [2016, '#f59e0b'],
  [2019, '#10b981'],
  [2023, '#0ea5e9'],
  [2026, '#4338ca'],
]

export function yearColorExpression(field: string) {
  return ['interpolate', ['linear'], ['to-number', ['get', field]], ...YEAR_STOPS.flat()] as unknown as string
}
