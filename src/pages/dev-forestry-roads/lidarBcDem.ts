/**
 * LidarBC bare-earth DEM tiles under a road or block, for **Load 1 m DEM**'s LidarBC source. The tile
 * index is queried live (its CORS is open); the files themselves cannot be read by a browser on
 * another site (`docs/research/bc-lidar-portal.md`), so the page links to them, the reader downloads
 * them, and `localDemWindow.ts` reads the area's window back out of the downloaded files.
 *
 * A listed tile is a footprint, not coverage: a 1:20,000 sheet from a floodplain acquisition can be
 * no-data almost everywhere (093i003, 2019, under the reference block's roads, is). The load reports the share
 * of the area that has elevations; nothing here claims coverage.
 *
 * No DOM and no network: `fetch` is passed in, so the tests run anywhere.
 */
import { LIDAR_BC_SERVICE, productById, type LidarBcProduct } from '../dev-lidar/lidarbc/bcLidarIndex'
import type { Coordinate } from './types'

/** The DEM products a road can be built on: the 1:2,500 tiles first, then the older 1:20,000 sheets. */
export const LIDAR_BC_DEM_PRODUCTS = ['dem2500', 'dem20000'] as const
/** The most tiles listed for one area; past it, choose a smaller area. */
export const LIDAR_BC_MAX_TILES = 60
/** Vertical datum LidarBC states for its DEMs; the GeoTIFFs carry no vertical key of their own. */
export const LIDAR_BC_VERTICAL_REFERENCE = 'CGVD2013 · stated by LidarBC for its bare-earth DEMs'

export interface LidarBcDemTile {
  productId: (typeof LIDAR_BC_DEM_PRODUCTS)[number]
  /** "1:2,500" or "1:20,000". */
  grid: LidarBcProduct['grid']
  maptile: string
  year: number
  /** The acquisition, e.g. "LidarBC Program" or "NDMP Floodplains 2019". */
  project: string
  /** "1 metre", as the index states it. */
  spacing: string
  filename: string
  url: string
  /** Median file size for the product, measured in 093G; the index carries no sizes. */
  estimatedBytes: number | null
}

/** The query for one product's tiles that intersect `ring` (lon/lat), sent as a form POST. */
export function demTileQuery(productId: (typeof LIDAR_BC_DEM_PRODUCTS)[number], ring: readonly Coordinate[]) {
  const product = productById(productId)!
  const closed = ring.length && ring[0] !== ring.at(-1) ? [...ring, ring[0]] : [...ring]
  const body = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({ rings: [closed.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])] }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'maptile,year,spacing,oper_name,filename,s3Url',
    returnGeometry: 'false',
    orderByFields: 'year DESC',
    resultRecordCount: String(LIDAR_BC_MAX_TILES + 1),
    f: 'json',
  })
  return { url: `${LIDAR_BC_SERVICE}/${product.layer}/query`, body }
}

/** The tiles in one product's query answer, with only https links into the LidarBC object store. */
export function parseDemTiles(productId: (typeof LIDAR_BC_DEM_PRODUCTS)[number], json: unknown): LidarBcDemTile[] {
  const product = productById(productId)!
  const answer = json as { features?: { attributes?: Record<string, unknown> }[]; error?: { message?: string } }
  if (answer?.error) throw Error(`LidarBC index: ${answer.error.message ?? 'the query failed'}`)
  if (!Array.isArray(answer?.features)) throw Error('The LidarBC index returned no tile list.')
  return answer.features.flatMap(({ attributes: a = {} }) => {
    const url = typeof a.s3Url === 'string' ? a.s3Url : ''
    if (!/^https:\/\/nrs\.objectstore\.gov\.bc\.ca\/gdwuts\/.+\.tiff?$/i.test(url)) return []
    return [
      {
        productId,
        grid: product.grid,
        maptile: String(a.maptile ?? ''),
        year: Number(a.year),
        project: String(a.oper_name ?? '').trim() || 'Not stated',
        spacing: String(a.spacing ?? '').trim() || 'Not stated',
        filename: typeof a.filename === 'string' && a.filename ? a.filename : (url.split('/').at(-1) ?? url),
        url,
        estimatedBytes: product.medianBytes,
      },
    ]
  })
}

/**
 * Every LidarBC DEM tile under `ring`, newest first within each grid, 1:2,500 tiles before 1:20,000
 * sheets. `truncated` is set when an area lists more than `LIDAR_BC_MAX_TILES`.
 */
export async function findLidarBcDem(
  ring: readonly Coordinate[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ tiles: LidarBcDemTile[]; truncated: boolean; status: LidarBcStatus[] | null }> {
  // The status is extra: when it cannot be read the tiles still list, and it reads "not read".
  const status = lidarBcStatus(ring, fetcher, signal).catch(() => null)
  const lists = await Promise.all(
    LIDAR_BC_DEM_PRODUCTS.map(async (id) => {
      const { url, body } = demTileQuery(id, ring)
      const response = await fetcher(url, {
        method: 'POST',
        body,
        signal,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!response.ok) throw Error(`The LidarBC index did not answer (HTTP ${response.status}). Try again.`)
      return parseDemTiles(id, await response.json())
    }),
  )
  const all = lists.flat()
  return { tiles: all.slice(0, LIDAR_BC_MAX_TILES), truncated: all.length > LIDAR_BC_MAX_TILES, status: await status }
}

/**
 * LidarBC's acquisition-status layer, the one behind its availability dashboard
 * (https://bcgov03.maps.arcgis.com/apps/dashboards/5dd565b56e6140128f32b4d51ddd6dd7). It says where
 * LiDAR is planned, flown ("Actual Acquisition") or available, by year; it is the only public sign
 * of data flown but not yet published. The service is named "Progress_Dummy_Data" by its owner, so a
 * status is a lead to confirm with LidarBC (lidar@gov.bc.ca), never a promise of a release.
 */
export const LIDAR_BC_STATUS_LAYER =
  'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/LidarBC_Progress_Dummy_Data/FeatureServer/0'

export interface LidarBcStatus {
  /** "Planned Acquisition", "Actual Acquisition" or "Available", as the layer states it. */
  status: string
  year: number | null
}

/** The distinct statuses in the layer's answer, flown and available before planned, newest first. */
export function parseLidarBcStatus(json: unknown): LidarBcStatus[] {
  const answer = json as { features?: { attributes?: Record<string, unknown> }[]; error?: { message?: string } }
  if (answer?.error) throw Error(`LidarBC status: ${answer.error.message ?? 'the query failed'}`)
  if (!Array.isArray(answer?.features)) throw Error('The LidarBC status layer returned no list.')
  const seen = new Map<string, LidarBcStatus>()
  for (const { attributes: a = {} } of answer.features) {
    const status = String(a.status_of_availability ?? '').trim()
    if (!status) continue
    const year =
      Number.isFinite(Number(a.availability_year)) && a.availability_year != null ? Number(a.availability_year) : null
    seen.set(`${status}|${year}`, { status, year })
  }
  const rank = (s: string) => (/^available/i.test(s) ? 0 : /actual/i.test(s) ? 1 : 2)
  return [...seen.values()].sort((a, b) => rank(a.status) - rank(b.status) || (b.year ?? 0) - (a.year ?? 0))
}

/** LidarBC's acquisition status over `ring` (lon/lat). */
export async function lidarBcStatus(
  ring: readonly Coordinate[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<LidarBcStatus[]> {
  const closed = ring.length && ring[0] !== ring.at(-1) ? [...ring, ring[0]] : [...ring]
  const body = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({ rings: [closed.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])] }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'status_of_availability,availability_year',
    returnGeometry: 'false',
    f: 'json',
  })
  const response = await fetcher(`${LIDAR_BC_STATUS_LAYER}/query`, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!response.ok) throw Error(`The LidarBC status layer did not answer (HTTP ${response.status}).`)
  return parseLidarBcStatus(await response.json())
}
