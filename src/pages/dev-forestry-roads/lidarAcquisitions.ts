/**
 * Which LidarBC flights cover a block, and when each was flown against the block's harvest.
 *
 * A flight before harvest (or before a planned harvest) shows the ground a new road would be designed on; one after
 * shows the road that was built; both together measure what construction actually moved. The tile index is queried
 * live (its CORS is open). The point-cloud and 1:2,500 DEM file names carry the flight dates
 * (`…_utm10_20240714_20240714.laz`); the older 1:20,000 sheets carry only a year. A listed tile is a footprint, not
 * coverage, and harvest dates stand in for road construction, which no public record dates.
 *
 * No DOM and no network: `fetch` is passed in.
 */
import { LIDAR_BC_SERVICE, productById } from '@/lib/lidar/bcLidarIndex'
import type { RoadQueryBounds } from './existingRoads'

export const LIDAR_ACQUISITION_PRODUCTS = ['pointcloud', 'dem2500', 'dem20000'] as const
export type LidarAcquisitionProduct = (typeof LIDAR_ACQUISITION_PRODUCTS)[number]
/** Tiles read per product for one block; a block crosses a handful of 1:2,500 tiles per flight. */
export const LIDAR_ACQUISITION_MAX_TILES = 200
/** The widest area checked at once, in degrees each way: a block and its approach, not a landscape. */
export const LIDAR_ACQUISITION_MAX_SPAN = 0.1

export interface LidarTileRecord {
  product: LidarAcquisitionProduct
  year: number
  project: string
  /** ISO dates from the file name, when it carries them. */
  flownFrom?: string
  flownTo?: string
  /** Points per square metre (point cloud only). */
  density?: number
}

export interface LidarAcquisition {
  year: number
  /** Earliest and latest flight date named by its files, when any file names one. */
  flownFrom?: string
  flownTo?: string
  products: LidarAcquisitionProduct[]
  projects: string[]
  tiles: number
  /** Tiles listed per product, for the download estimate. */
  tilesByProduct: Partial<Record<LidarAcquisitionProduct, number>>
  density?: number
  /** A flood-mapping survey (NDMP, floodplain): listed tiles can hold data only along the valley floor. */
  partialLikely: boolean
}

/**
 * Flood-mapping acquisitions are flown along rivers, and their tiles are indexed whole: in 2017 Okanagan tiles only
 * 29–38% of each tile held data, all of it valley bottom, so an upslope block under such a tile can have no ground.
 */
export const PARTIAL_FLIGHT = /\bNDMP\b|flood/i

export type LidarTiming = 'before' | 'during' | 'after' | 'unknown'
export interface HarvestDates {
  /** Reported harvest start and completion (completion may be estimated). */
  start?: string
  end?: string
  /** A planned harvest date, used only when no harvest is reported. */
  planned?: string
}

export function acquisitionQuery(product: LidarAcquisitionProduct, bounds: RoadQueryBounds) {
  const [west, south, east, north] = bounds
  if (
    !bounds.every(Number.isFinite) ||
    west >= east ||
    south >= north ||
    east - west > LIDAR_ACQUISITION_MAX_SPAN ||
    north - south > LIDAR_ACQUISITION_MAX_SPAN
  )
    throw Error(`Check LiDAR for one block at a time (at most ${LIDAR_ACQUISITION_MAX_SPAN}° each way).`)
  const layer = productById(product)!.layer
  const body = new URLSearchParams({
    where: '1=1',
    geometry: bounds.map((value) => value.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: product === 'pointcloud' ? 'year,oper_name,filename,density' : 'year,oper_name,filename',
    returnGeometry: 'false',
    resultRecordCount: String(LIDAR_ACQUISITION_MAX_TILES + 1),
    f: 'json',
  })
  return { url: `${LIDAR_BC_SERVICE}/${layer}/query`, body }
}

const isoDate = (compact: string) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`

export function parseAcquisitionTiles(
  product: LidarAcquisitionProduct,
  json: unknown,
): { tiles: LidarTileRecord[]; truncated: boolean } {
  const answer = json as { features?: { attributes?: Record<string, unknown> }[]; error?: { message?: string } }
  if (answer?.error) throw Error(`LidarBC index: ${answer.error.message ?? 'the query failed'}`)
  if (!Array.isArray(answer?.features)) throw Error('The LidarBC index returned no tile list.')
  const tiles = answer.features.flatMap(({ attributes: a = {} }): LidarTileRecord[] => {
    const year = Number(a.year)
    if (!Number.isInteger(year) || year < 1990 || year > 2100) return []
    const tile: LidarTileRecord = { product, year, project: String(a.oper_name ?? '').trim() || 'Not stated' }
    const dates = /_((?:19|20)\d{6})_((?:19|20)\d{6})(?:_dsm)?\.(?:laz|tiff?)$/i.exec(String(a.filename ?? ''))
    if (dates && dates[1].startsWith(String(year))) {
      tile.flownFrom = isoDate(dates[1])
      tile.flownTo = isoDate(dates[2])
    }
    const density = Number(a.density)
    if (product === 'pointcloud' && Number.isFinite(density) && density > 0) tile.density = density
    return [tile]
  })
  return { tiles: tiles.slice(0, LIDAR_ACQUISITION_MAX_TILES), truncated: tiles.length > LIDAR_ACQUISITION_MAX_TILES }
}

/**
 * One acquisition per year and project. Two projects can fly the same ground in one year (VRI 100 Mile House and the
 * NDMP floodplain survey both flew 2019), and only one of them may cover the block wall to wall.
 */
export function groupAcquisitions(tiles: readonly LidarTileRecord[]): LidarAcquisition[] {
  const groups = new Map<string, LidarTileRecord[]>()
  for (const tile of tiles) {
    const key = `${tile.year}|${tile.project}`
    groups.set(key, [...(groups.get(key) ?? []), tile])
  }
  return [...groups.values()]
    .sort((a, b) => a[0].year - b[0].year || a[0].project.localeCompare(b[0].project))
    .map((group) => {
      const year = group[0].year
      const from = group.flatMap((tile) => (tile.flownFrom ? [tile.flownFrom] : [])).sort()
      const to = group.flatMap((tile) => (tile.flownTo ? [tile.flownTo] : [])).sort()
      const densities = group.flatMap((tile) => (tile.density ? [tile.density] : []))
      return {
        year,
        ...(from.length ? { flownFrom: from[0], flownTo: to.at(-1) } : {}),
        products: LIDAR_ACQUISITION_PRODUCTS.filter((product) => group.some((tile) => tile.product === product)),
        projects: [...new Set(group.map((tile) => tile.project))].sort(),
        tiles: group.length,
        tilesByProduct: Object.fromEntries(
          LIDAR_ACQUISITION_PRODUCTS.flatMap((product) => {
            const count = group.filter((tile) => tile.product === product).length
            return count ? [[product, count]] : []
          }),
        ),
        ...(densities.length ? { density: Math.max(...densities) } : {}),
        partialLikely: group.some((tile) => PARTIAL_FLIGHT.test(tile.project)),
      }
    })
}

/**
 * When a flight falls against the harvest. A flight known only by its year counts as the whole year, so a year that
 * overlaps the harvest is `during`. With no reported harvest, a flight before the planned date is `before`; one after
 * it is `unknown`, because nothing says whether the harvest or its road has happened.
 */
export function lidarTiming(acquisition: LidarAcquisition, harvest: HarvestDates): LidarTiming {
  const from = acquisition.flownFrom ?? `${acquisition.year}-01-01`
  const to = acquisition.flownTo ?? `${acquisition.year}-12-31`
  if (harvest.start) {
    if (to < harvest.start) return 'before'
    if (from > (harvest.end ?? harvest.start)) return 'after'
    return 'during'
  }
  if (harvest.planned && to < harvest.planned) return 'before'
  return 'unknown'
}

const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** The DEM download the terrain load needs, and the point cloud's, from the product medians (the index has no sizes). */
export function downloadEstimate(acquisition: LidarAcquisition): string {
  const size = (product: LidarAcquisitionProduct) =>
    (acquisition.tilesByProduct[product] ?? 0) * (productById(product)?.medianBytes ?? 0)
  const dem = size('dem2500') || size('dem20000')
  const parts = [
    dem ? `DEM about ${megabytes(dem)}` : '',
    acquisition.tilesByProduct.pointcloud ? `point cloud about ${megabytes(size('pointcloud'))}` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(', ')} to download` : ''
}

export interface LidarSummary {
  kind: 'before-and-after' | 'before' | 'after' | 'other' | 'none'
  text: string
}

const products = (acquisition: LidarAcquisition) =>
  acquisition.products
    .map((product) => (product === 'pointcloud' ? 'point cloud' : product === 'dem2500' ? 'DEM' : '1:20,000 DEM'))
    .join(' + ')

export function summarizeLidar(acquisitions: readonly LidarAcquisition[], harvest: HarvestDates): LidarSummary {
  if (!acquisitions.length) return { kind: 'none', text: 'No LidarBC tile is listed here.' }
  const timed = acquisitions.map((acquisition) => ({ acquisition, timing: lidarTiming(acquisition, harvest) }))
  const describe = ({ acquisition, timing }: (typeof timed)[number]) =>
    `${acquisition.flownFrom ?? acquisition.year} ${acquisition.projects.join(', ')} (${[
      products(acquisition),
      acquisition.density ? `${acquisition.density} pts/m²` : '',
      downloadEstimate(acquisition),
      acquisition.partialLikely ? 'a flood-mapping survey that may hold data only on the valley floor' : '',
    ]
      .filter(Boolean)
      .join(', ')}) ${
      timing === 'before'
        ? harvest.start
          ? 'before harvest'
          : 'before the planned harvest'
        : timing === 'after'
          ? 'after harvest'
          : timing === 'during'
            ? 'during harvest'
            : 'timing unknown'
    }`
  const before = timed.some((entry) => entry.timing === 'before')
  const after = timed.some((entry) => entry.timing === 'after')
  return {
    kind: before && after ? 'before-and-after' : before ? 'before' : after ? 'after' : 'other',
    text: timed.map(describe).join('; '),
  }
}

/** Every LidarBC flight over `bounds`, oldest first. Footprints only: a tile can hold no data over the block. */
export async function findLidarAcquisitions(
  bounds: RoadQueryBounds,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ acquisitions: LidarAcquisition[]; truncated: boolean }> {
  const answers = await Promise.all(
    LIDAR_ACQUISITION_PRODUCTS.map(async (product) => {
      const { url, body } = acquisitionQuery(product, bounds)
      const response = await fetcher(url, {
        method: 'POST',
        body,
        signal,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!response.ok) throw Error(`The LidarBC index did not answer (HTTP ${response.status}). Try again.`)
      return parseAcquisitionTiles(product, await response.json())
    }),
  )
  return {
    acquisitions: groupAcquisitions(answers.flatMap((answer) => answer.tiles)),
    truncated: answers.some((answer) => answer.truncated),
  }
}
