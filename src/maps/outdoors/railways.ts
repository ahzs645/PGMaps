/**
 * Rail lines for the outdoors planner, read live from DataBC's WFS
 * (`WHSE_BASEMAPPING.GBA_RAILWAY_TRACKS_SP`, Open Government Licence - British
 * Columbia).
 *
 * The layer says where track was mapped, not whether it can be travelled. In
 * November 2026 it recorded 9,995 of 10,000 segments as "Operational" with a
 * geometry revision of 2017 on every row, including the Takla subdivision north
 * of Fort St. James, a line local users describe as abandoned. So the recorded
 * status is shown with its date and never presented as current condition:
 * the planner's imagery and relief are what a person judges the line from.
 *
 * Parsing and the query are pure; `fetchRailways` is the one network call. The
 * bounding box goes in `CQL_FILTER`, never the WFS `bbox` parameter: WFS 2.0
 * with EPSG:4326 is latitude-first and CQL's `BBOX` is longitude-first.
 */

export const BC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
export const RAILWAY_LAYER = 'WHSE_BASEMAPPING.GBA_RAILWAY_TRACKS_SP'
export const RAILWAY_ATTRIBUTION = 'Rail lines: GeoBC, Open Government Licence - British Columbia'

/** Below this zoom a view spans too much track to ask for at once. */
export const RAILWAY_MIN_ZOOM = 7
/** Widest box asked for at once, degrees. A zoom-7 desktop view is about 11° wide. */
export const MAX_RAILWAY_QUERY_DEGREES = 12
/** Province-wide the layer holds about 10,000 segments; one view never needs them all. */
export const MAX_RAILWAY_FEATURES = 4000

const FIELDS = [
  'RAILWAY_TRACK_ID',
  'TRACK_NAME',
  'TRACK_CLASSIFICATION',
  'USE_TYPE',
  'STATUS',
  'OPERATOR_ENGLISH_NAME',
  'SUBDIVISION1_NAME',
  'GEOMETRY_REVISION_DATE',
  'SHAPE',
]

/** [west, south, east, north] in WGS84 degrees. */
export type Bounds = [number, number, number, number]

export interface RailwayProperties {
  id: string
  /** Subdivision or track name, whichever the record carries. */
  name: string | null
  /** Main, Spur, Siding, Yard… as recorded. */
  classification: string | null
  use: string | null
  operator: string | null
  /** The inventory's own status word. Not a statement about today's condition. */
  recordedStatus: string | null
  /** Year the record's geometry was last revised, when it gives one. */
  recordedYear: number | null
  /** Main and connecting track, as opposed to yards, spurs and sidings. */
  through: boolean
}

export type RailwayFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString, RailwayProperties>
export type RailwayCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString | GeoJSON.MultiLineString,
  RailwayProperties
>

export interface RailwayResult {
  collection: RailwayCollection
  /** The service held more segments in the box than it returned. */
  truncated: boolean
  /** The box actually asked for, after clamping. */
  bounds: Bounds
}

export const EMPTY_RAILWAYS: RailwayCollection = { type: 'FeatureCollection', features: [] }

const THROUGH_CLASSES = new Set(['main', 'connecting', 'ferry route'])

/** Keeps the box centred and no wider than the limit. */
export function clampRailwayBounds(bounds: Bounds, limit = MAX_RAILWAY_QUERY_DEGREES): Bounds {
  const [west, south, east, north] = bounds
  const lng = (west + east) / 2
  const lat = (south + north) / 2
  const half = (span: number) => Math.min(Math.max(span, 0), limit) / 2
  return [lng - half(east - west), lat - half(north - south), lng + half(east - west), lat + half(north - south)]
}

/** True when `inner` lies wholly inside `outer`, so an earlier answer still covers the view. */
export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

/** Grows a box about its centre, so small pans stay inside what was fetched. */
export function padBounds(bounds: Bounds, factor: number): Bounds {
  const [west, south, east, north] = bounds
  const dx = ((east - west) * factor) / 2
  const dy = ((north - south) * factor) / 2
  return [west - dx, south - dy, east + dx, north + dy]
}

export function railwayQueryUrl(bounds: Bounds): string {
  const [west, south, east, north] = clampRailwayBounds(bounds)
  const round = (value: number) => value.toFixed(5)
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: RAILWAY_LAYER,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    propertyName: FIELDS.join(','),
    count: String(MAX_RAILWAY_FEATURES),
    CQL_FILTER: `BBOX(SHAPE,${round(west)},${round(south)},${round(east)},${round(north)},'EPSG:4326')`,
  })
  return `${BC_WFS}?${params.toString()}`
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function recordedYear(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d{4})/.exec(value) : null
  if (!match) return null
  const year = Number(match[1])
  return year >= 1900 && year <= 2100 ? year : null
}

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function lineGeometry(value: unknown): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  const geometry = value as { type?: unknown; coordinates?: unknown } | null
  if (!geometry || !Array.isArray(geometry.coordinates)) return null
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates.filter(isPosition).map(([lng, lat]) => [lng, lat])
    return line.length >= 2 ? { type: 'LineString', coordinates: line } : null
  }
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates
      .map((part) => (Array.isArray(part) ? part.filter(isPosition).map(([lng, lat]) => [lng, lat]) : []))
      .filter((part) => part.length >= 2)
    return lines.length > 0 ? { type: 'MultiLineString', coordinates: lines } : null
  }
  return null
}

/** Reads a WFS answer; rows without a usable line are dropped, never guessed. */
export function parseRailways(payload: unknown): { collection: RailwayCollection; truncated: boolean } {
  const source = payload as { features?: unknown; numberMatched?: unknown } | null
  const rows = Array.isArray(source?.features) ? source.features : []
  const features: RailwayFeature[] = []
  rows.forEach((row, index) => {
    const record = row as { geometry?: unknown; properties?: Record<string, unknown> | null } | null
    const geometry = lineGeometry(record?.geometry)
    if (!geometry) return
    const properties = record?.properties ?? {}
    const classification = text(properties.TRACK_CLASSIFICATION)
    const rawId = properties.RAILWAY_TRACK_ID
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id: typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId) : `row-${index}`,
        name: text(properties.SUBDIVISION1_NAME) ?? text(properties.TRACK_NAME),
        classification,
        use: text(properties.USE_TYPE),
        operator: text(properties.OPERATOR_ENGLISH_NAME),
        recordedStatus: text(properties.STATUS),
        recordedYear: recordedYear(properties.GEOMETRY_REVISION_DATE),
        through: classification != null && THROUGH_CLASSES.has(classification.toLowerCase()),
      },
    })
  })
  const matched = typeof source?.numberMatched === 'number' ? source.numberMatched : null
  return {
    collection: { type: 'FeatureCollection', features },
    truncated: rows.length >= MAX_RAILWAY_FEATURES || (matched != null && matched > rows.length),
  }
}

/** One line for a hover card: what the record says, and how old it is. */
export function describeRailway(properties: Partial<RailwayProperties>): {
  title: string
  detail: string
  caution: string
} {
  const title = properties.name ? `${properties.name} rail line` : 'Rail line'
  const detail = [properties.classification, properties.use, properties.operator].filter(Boolean).join(' · ')
  const status = properties.recordedStatus ?? 'Status not recorded'
  const caution = properties.recordedYear
    ? `Recorded as "${status}" in ${properties.recordedYear}. Check imagery for its condition today.`
    : `Recorded as "${status}", date unknown. Check imagery for its condition today.`
  return { title, detail, caution }
}

export async function fetchRailways(bounds: Bounds, signal?: AbortSignal): Promise<RailwayResult> {
  const response = await fetch(railwayQueryUrl(bounds), { signal })
  if (!response.ok) throw new Error(`DataBC answered ${response.status}`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown } | null)?.exceptions) throw new Error('DataBC refused the query')
  return { ...parseRailways(payload), bounds: clampRailwayBounds(bounds) }
}
