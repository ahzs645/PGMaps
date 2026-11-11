/**
 * Sentinel-2 scene search through Element 84's Earth Search STAC API. DOM-free and network-injected:
 * the caller passes `fetch`, so the unit tests run on a recorded response.
 */
import {
  SENTINEL_CLOUD_MAX_PERCENT,
  SENTINEL_COLLECTION,
  SENTINEL_MAX_SCENES,
  SENTINEL_REQUEST_TIMEOUT_MS,
  SENTINEL_SEARCH_LIMIT,
  SENTINEL_STAC_SEARCH_URL,
} from './limits'

/** West, south, east, north in degrees. */
export type LonLatBounds = [number, number, number, number]

export type SentinelErrorKind = 'no-terrain' | 'outside-bc' | 'too-large' | 'no-scene' | 'network' | 'read' | 'zones'

/** A failure with the reason the panel states. Every kind offers a retry. */
export class SentinelError extends Error {
  constructor(
    readonly kind: SentinelErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'SentinelError'
  }
}

/** Digital numbers to reflectance, from the item's `raster:bands` (processing baseline 04.00 adds −0.1). */
export type BandScaling = { scale: number; offset: number }

export type SentinelScene = {
  id: string
  /** Acquisition time as the item gives it (ISO 8601, UTC). */
  datetime: string
  /** Acquisition date, YYYY-MM-DD. */
  date: string
  /** Whole-tile cloud cover from the item, not the cover over the terrain. */
  cloudPercent: number | null
  /** The COGs' CRS: WGS84 / UTM north (EPSG:326xx). */
  epsg: number
  /** The tile footprint in degrees, when the item gives one. */
  bbox: LonLatBounds | null
  assets: { visual: string; red: string; nir: string; scl: string }
  scaling: { red: BandScaling; nir: BandScaling }
}

export type DateRange = { from: string; to: string }

const DAY_MS = 86_400_000

/** The last `days` days up to `now`, as STAC datetimes. */
export function recentRange(now: Date, days: number): DateRange {
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to: now.toISOString() }
}

/** One calendar year (UTC). */
export function yearRange(year: number): DateRange {
  return { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` }
}

/**
 * One year's leaf-on summer, June to September (UTC). A year's list is mostly for comparing
 * clearings, which read best with leaves on, high sun and no snow.
 */
export function seasonRange(year: number): DateRange {
  return { from: `${year}-06-01T00:00:00Z`, to: `${year}-09-30T23:59:59Z` }
}

/** The POST body of an Earth Search item search, newest first. */
export function sentinelSearchBody(
  bounds: LonLatBounds,
  range: DateRange,
  { limit = SENTINEL_SEARCH_LIMIT, cloudMax = SENTINEL_CLOUD_MAX_PERCENT } = {},
) {
  return {
    collections: [SENTINEL_COLLECTION],
    bbox: bounds.map((value) => Math.round(value * 1e6) / 1e6),
    datetime: `${range.from}/${range.to}`,
    limit,
    query: { 'eo:cloud_cover': { lt: cloudMax } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  }
}

type StacAsset = { href?: unknown; 'raster:bands'?: Array<{ scale?: unknown; offset?: unknown }> }
type StacItem = {
  id?: unknown
  bbox?: unknown
  properties?: Record<string, unknown>
  assets?: Record<string, StacAsset | undefined>
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function itemEpsg(properties: Record<string, unknown>): number | null {
  if (finite(properties['proj:epsg'])) return properties['proj:epsg']
  const code = properties['proj:code']
  const match = typeof code === 'string' ? /^EPSG:(\d+)$/i.exec(code) : null
  return match ? Number(match[1]) : null
}

/**
 * Earth Search re-encodes baseline 04.00+ scenes with the −0.1 BOA offset already removed from the
 * pixel values (`earthsearch:boa_offset_applied`), yet still lists the offset in `raster:bands`.
 * Applying it again read September 2025 conifer at zero red reflectance and NDVI at 1 everywhere.
 */
function scaling(asset: StacAsset | undefined, offsetApplied: boolean): BandScaling {
  const band = asset?.['raster:bands']?.[0]
  return {
    scale: finite(band?.scale) ? band.scale : 1,
    offset: !offsetApplied && finite(band?.offset) ? band.offset : 0,
  }
}

function href(asset: StacAsset | undefined): string | null {
  return typeof asset?.href === 'string' && /^https:\/\//.test(asset.href) ? asset.href : null
}

/** One item as a scene, or null when it lacks a date, a UTM CRS or one of the four COGs. */
export function parseSentinelItem(item: StacItem): SentinelScene | null {
  const properties = item.properties ?? {}
  const datetime = properties.datetime
  const epsg = itemEpsg(properties)
  if (typeof item.id !== 'string' || typeof datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(datetime)) return null
  if (!epsg || epsg < 32601 || epsg > 32660) return null
  const assets = item.assets ?? {}
  const visual = href(assets.visual),
    red = href(assets.red),
    nir = href(assets.nir),
    scl = href(assets.scl)
  if (!visual || !red || !nir || !scl) return null
  const box = Array.isArray(item.bbox) && item.bbox.length === 4 && item.bbox.every(finite) ? item.bbox : null
  const cloud = properties['eo:cloud_cover']
  const offsetApplied = properties['earthsearch:boa_offset_applied'] === true
  return {
    id: item.id,
    datetime,
    date: datetime.slice(0, 10),
    cloudPercent: finite(cloud) ? cloud : null,
    epsg,
    bbox: box as LonLatBounds | null,
    assets: { visual, red, nir, scl },
    scaling: { red: scaling(assets.red, offsetApplied), nir: scaling(assets.nir, offsetApplied) },
  }
}

const contains = (outer: LonLatBounds | null, inner: LonLatBounds) =>
  !!outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]

/**
 * Scenes from a search response, newest first, one per date. Neighbouring tiles overlap, so a date
 * can come back two or three times: keep the tile whose footprint holds the whole window, then the
 * one in the window's own UTM zone, then the least cloudy.
 */
export function parseSentinelScenes(
  response: unknown,
  window: LonLatBounds,
  { max = SENTINEL_MAX_SCENES, preferEpsg }: { max?: number; preferEpsg?: number } = {},
): SentinelScene[] {
  const features = (response as { features?: unknown })?.features
  if (!Array.isArray(features)) throw new SentinelError('network', 'The scene search returned an unreadable answer.')
  const rank = (scene: SentinelScene) => [
    contains(scene.bbox, window) ? 0 : 1,
    scene.epsg === preferEpsg ? 0 : 1,
    scene.cloudPercent ?? 100,
  ]
  const byDate = new Map<string, SentinelScene>()
  for (const feature of features) {
    const scene = parseSentinelItem(feature as StacItem)
    if (!scene) continue
    const kept = byDate.get(scene.date)
    if (!kept) {
      byDate.set(scene.date, scene)
      continue
    }
    const [a, b] = [rank(scene), rank(kept)]
    const better = a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
    if (better < 0) byDate.set(scene.date, scene)
  }
  return [...byDate.values()].sort((a, b) => b.datetime.localeCompare(a.datetime)).slice(0, max)
}

/** A signal that aborts with the caller's or after `ms`, whichever comes first. */
export function timeoutSignal(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new SentinelError('network', 'timeout')), ms)
  const forward = () => controller.abort(signal?.reason)
  if (signal?.aborted) forward()
  else signal?.addEventListener('abort', forward, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
    },
    timedOut: () => controller.signal.reason instanceof SentinelError,
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

/** Search Earth Search for scenes over `window`, newest first. Throws a SentinelError with a stated reason. */
export async function searchSentinelScenes({
  window,
  range,
  fetch,
  signal,
  preferEpsg,
  timeoutMs = SENTINEL_REQUEST_TIMEOUT_MS,
}: {
  window: LonLatBounds
  range: DateRange
  fetch: FetchLike
  signal?: AbortSignal
  preferEpsg?: number
  timeoutMs?: number
}): Promise<SentinelScene[]> {
  const timed = timeoutSignal(signal, timeoutMs)
  let body: unknown
  try {
    const response = await fetch(SENTINEL_STAC_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sentinelSearchBody(window, range)),
      signal: timed.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok)
      throw new SentinelError('network', `The Sentinel-2 scene search failed (HTTP ${response.status}).`)
    body = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof SentinelError) throw error
    throw new SentinelError(
      'network',
      timed.timedOut()
        ? `The Sentinel-2 scene search took longer than ${Math.round(timeoutMs / 1000)} s.`
        : 'The Sentinel-2 scene search could not be reached.',
    )
  } finally {
    timed.done()
  }
  return parseSentinelScenes(body, window, { preferEpsg })
}

/** The Copernicus credit for the scenes shown: "Contains modified Copernicus Sentinel data 2021, 2025". */
export function sentinelCredit(dates: readonly string[]): string {
  const years = [...new Set(dates.map((date) => date.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort()
  return `Contains modified Copernicus Sentinel data${years.length ? ` ${years.join(', ')}` : ''}`
}
