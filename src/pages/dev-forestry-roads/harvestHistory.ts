/** Historical harvest evidence and geographic access candidates. No road-use or connectivity inference. */
import type { Bounds } from '../dev-forestry/terrain'
import type { ContextFeature } from './types'

export const BC_HARVEST_SERVICE =
  'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/4'
export const MAX_HARVEST_FEATURES = 500
export const MAX_HARVEST_VERTICES = 50_000
export const MAX_HARVEST_QUERY_SPAN = 0.3
export const MAX_HARVEST_RESPONSE_BYTES = 10 * 1024 * 1024
export const HARVEST_YEAR_MIN = 1800
export const HARVEST_YEAR_MAX = 2200
export const HARVEST_RECENT_YEARS = 10
export const HARVEST_MEDIUM_YEARS = 30
export const MAX_NEARBY_ROAD_CHECKS = 2_000_000

export interface HarvestEvidence {
  source: 'bc-consolidated' | 'user' | 'scenario'
  status?: 'harvested' | 'proposed'
  sourceId?: string
  sourceUrl?: string
  retrievedAt?: string
  dataSource?: string
  sourceDate?: string
  publishedDate?: string
  openingId?: string
  areaHectares?: number
  startDate?: string
  endDate?: string
  startYear?: number
  endYear?: number
  midYear?: number
  /** Describes the available source precision, not independent verification of a harvest event. */
  yearMethod: 'reported-dates' | 'reported-year' | 'estimated-range' | 'estimated-midpoint' | 'start-only' | 'unknown'
}

function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
function optionalText(value: unknown, label: string, max = 1000): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(`${label} must be text of at most ${max} characters.`)
  return value.trim()
}
export function parseHarvestHistoryYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < HARVEST_YEAR_MIN || value > HARVEST_YEAR_MAX)
    throw Error(`Harvest year must be an integer between ${HARVEST_YEAR_MIN} and ${HARVEST_YEAR_MAX}.`)
  return value
}
function optionalYear(value: unknown): number | undefined {
  return value == null || value === '' ? undefined : parseHarvestHistoryYear(value)
}
function dateValue(value: unknown, label: string): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error(`${label} must be a valid date.`)
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) throw Error(`${label} must be a valid date.`)
    return dateValue(date.toISOString().slice(0, 10), label)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    throw Error(`${label} must be a valid ISO date.`)
  if (value.includes('T') && !Number.isFinite(Date.parse(value))) throw Error(`${label} must be a valid ISO date.`)
  const day = value.slice(0, 10),
    date = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== day)
    throw Error(`${label} must be a valid date.`)
  parseHarvestHistoryYear(date.getUTCFullYear())
  return day
}
function sourceUrl(value: unknown): string | undefined {
  const text = optionalText(value, 'Harvest source URL', 2000)
  if (text === undefined) return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw Error('Harvest source URL must be an HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Harvest source URL must be an HTTP or HTTPS URL.')
  return text
}

/** Used on both project restore and GeoJSON import so invalid evidence never becomes a numeric age. */
export function parseHarvestEvidence(raw: unknown): HarvestEvidence {
  const r = record(raw, 'Harvest evidence')
  if (!['bc-consolidated', 'user', 'scenario'].includes(String(r.source)))
    throw Error('Unknown harvest evidence source.')
  if (r.status !== undefined && !['harvested', 'proposed'].includes(String(r.status)))
    throw Error('Unknown harvest status.')
  if (
    !['reported-dates', 'reported-year', 'estimated-range', 'estimated-midpoint', 'start-only', 'unknown'].includes(
      String(r.yearMethod),
    )
  )
    throw Error('Unknown harvest year method.')
  const startDate = dateValue(r.startDate, 'Harvest start date')
  const endDate = dateValue(r.endDate, 'Harvest end date')
  const startYear = optionalYear(r.startYear) ?? (startDate ? Number(startDate.slice(0, 4)) : undefined)
  const endYear = optionalYear(r.endYear) ?? (endDate ? Number(endDate.slice(0, 4)) : undefined)
  const midYear = optionalYear(r.midYear)
  if (
    (startDate && startYear !== Number(startDate.slice(0, 4))) ||
    (endDate && endYear !== Number(endDate.slice(0, 4)))
  )
    throw Error('Harvest dates must agree with their calendar years.')
  if (
    (startYear !== undefined && endYear !== undefined && startYear > endYear) ||
    (startDate && endDate && startDate > endDate)
  )
    throw Error('Harvest end must not precede its start.')
  if (
    midYear !== undefined &&
    ((startYear !== undefined && midYear < startYear) || (endYear !== undefined && midYear > endYear))
  )
    throw Error('Harvest midpoint year must fall within the reported harvest years.')
  if (r.status === 'proposed' && [startDate, endDate, startYear, endYear, midYear].some((value) => value !== undefined))
    throw Error('A proposed cutblock cannot contain historical harvest dates.')
  if (r.yearMethod === 'reported-dates' && !endDate)
    throw Error('Reported harvest dates need an explicit completion date.')
  if (['reported-year', 'estimated-range'].includes(String(r.yearMethod)) && endYear === undefined)
    throw Error('A harvest-year interval needs an explicit end year.')
  if (r.yearMethod === 'estimated-midpoint' && (midYear === undefined || endYear !== undefined))
    throw Error('Midpoint harvest evidence needs a midpoint year and no claimed completion year.')
  if (r.yearMethod === 'start-only' && (startYear === undefined || endYear !== undefined || midYear !== undefined))
    throw Error('Start-only harvest evidence needs only a start year.')
  if (r.yearMethod === 'unknown' && [startYear, endYear, midYear].some((value) => value !== undefined))
    throw Error('Choose the harvest-year method that describes the supplied date evidence.')
  const evidence: HarvestEvidence = {
    source: r.source as HarvestEvidence['source'],
    yearMethod: r.yearMethod as HarvestEvidence['yearMethod'],
  }
  if (r.status !== undefined) evidence.status = r.status as HarvestEvidence['status']
  for (const key of ['sourceId', 'dataSource', 'openingId'] as const) {
    const value = optionalText(r[key], `Harvest ${key}`)
    if (value !== undefined) evidence[key] = value
  }
  const url = sourceUrl(r.sourceUrl)
  if (url !== undefined) evidence.sourceUrl = url
  if (r.retrievedAt !== undefined) {
    const retrieved = optionalText(r.retrievedAt, 'Harvest retrieval date', 100)
    if (!retrieved || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(retrieved) || !Number.isFinite(Date.parse(retrieved)))
      throw Error('Harvest retrieval date must be a valid ISO date.')
    dateValue(retrieved, 'Harvest retrieval date')
    evidence.retrievedAt = retrieved
  }
  for (const key of ['sourceDate', 'publishedDate'] as const) {
    const value = dateValue(r[key], `Harvest ${key}`)
    if (value !== undefined) evidence[key] = value
  }
  if (r.areaHectares !== undefined && r.areaHectares !== null) {
    if (
      typeof r.areaHectares !== 'number' ||
      !Number.isFinite(r.areaHectares) ||
      r.areaHectares < 0 ||
      r.areaHectares > 1e8
    )
      throw Error('Harvest area must be a finite, non-negative number of hectares.')
    evidence.areaHectares = r.areaHectares
  }
  Object.assign(
    evidence,
    Object.fromEntries(
      Object.entries({ startDate, endDate, startYear, endYear, midYear }).filter(([, value]) => value !== undefined),
    ),
  )
  return evidence
}

export interface HarvestAge {
  kind: 'proposed' | 'unknown' | 'future' | 'start-only' | 'reported' | 'estimated'
  /** Calendar-year differences, not an exact anniversary or stand age. */
  minYears?: number
  maxYears?: number
}
export function harvestAge(evidence: HarvestEvidence | undefined, year: number): HarvestAge {
  parseHarvestHistoryYear(year)
  if (evidence?.status === 'proposed') return { kind: 'proposed' }
  if (!evidence) return { kind: 'unknown' }
  const { startYear, endYear, midYear } = evidence
  if (endYear !== undefined) {
    if (year < endYear) return { kind: 'future' }
    return {
      kind:
        evidence.yearMethod === 'estimated-range' || evidence.source === 'bc-consolidated' ? 'estimated' : 'reported',
      minYears: year - endYear,
      maxYears: year - (startYear ?? endYear),
    }
  }
  if (midYear !== undefined) {
    if (year < midYear) return { kind: 'future' }
    return { kind: 'estimated', minYears: year - midYear, maxYears: year - midYear }
  }
  if (startYear !== undefined) return { kind: year < startYear ? 'future' : 'start-only', maxYears: year - startYear }
  return { kind: 'unknown' }
}
export function harvestAgeSummary(evidence: HarvestEvidence | undefined, year: number): string {
  const age = harvestAge(evidence, year)
  if (age.kind === 'proposed') return 'Proposed cutblock · no harvest history'
  if (age.kind === 'unknown') return 'Harvest date unknown'
  if (age.kind === 'future') return `Harvest record is after reference year ${year}`
  if (age.kind === 'start-only') return `Harvest started ${evidence!.startYear} · completion unknown`
  if (age.kind === 'estimated') {
    const range = age.minYears === age.maxYears ? String(age.minYears) : `${age.minYears}–${age.maxYears}`
    const sourceYears =
      evidence!.endYear !== undefined
        ? evidence!.startYear === undefined || evidence!.startYear === evidence!.endYear
          ? String(evidence!.endYear)
          : `${evidence!.startYear}–${evidence!.endYear}`
        : String(evidence!.midYear)
    return `About ${range} calendar years since estimated harvest (${sourceYears})`
  }
  if (age.minYears !== age.maxYears)
    return `${age.minYears}–${age.maxYears} calendar years since reported harvest (${evidence!.startYear}–${evidence!.endYear})`
  return `${age.minYears} calendar years since reported harvest (${evidence!.endYear})`
}
export function harvestHistoryStyle(
  evidence: HarvestEvidence | undefined,
  year: number,
): { key: string; label: string; color: string } {
  const age = harvestAge(evidence, year)
  if (age.kind === 'proposed') return { key: 'proposed', label: 'Proposed cutblock', color: '#7c3aed' }
  const unknown = { key: 'unknown', label: 'Harvest age unknown or uncertain', color: '#64748b' }
  if (age.minYears === undefined || age.maxYears === undefined) return unknown
  const bin = (years: number) =>
    years <= HARVEST_RECENT_YEARS ? 'recent' : years <= HARVEST_MEDIUM_YEARS ? 'medium' : 'older'
  if (bin(age.minYears) !== bin(age.maxYears)) return unknown
  if (age.minYears <= HARVEST_RECENT_YEARS)
    return { key: 'recent', label: 'Harvest 0–10 calendar years ago', color: '#d97706' }
  if (age.minYears <= HARVEST_MEDIUM_YEARS)
    return { key: 'medium', label: 'Harvest 11–30 calendar years ago', color: '#0d9488' }
  return { key: 'older', label: 'Harvest over 30 calendar years ago', color: '#166534' }
}

const FIELDS = [
  'VCCB_SYSID',
  'OBJECTID',
  'OPENING_ID',
  'DATA_SOURCE',
  'AREA_HA',
  'HARVEST_START_DATE',
  'HARVEST_END_DATE',
  'HARVEST_START_YEAR_CALENDAR',
  'HARVEST_MID_YEAR_CALENDAR',
  'DATA_SOURCE_DATE',
  'PUBLISHED_DATE',
]
export function buildHarvestHistoryQueryUrl(bounds: Bounds): string {
  const [west, south, east, north] = bounds
  if (
    !bounds.every(Number.isFinite) ||
    west >= east ||
    south >= north ||
    west < -180 ||
    east > 180 ||
    south <= -85 ||
    north >= 85 ||
    east - west > MAX_HARVEST_QUERY_SPAN ||
    north - south > MAX_HARVEST_QUERY_SPAN
  )
    throw Error('Select a smaller local extent (at most 0.3° per side) for harvest history.')
  return `${BC_HARVEST_SERVICE}/query?${new URLSearchParams({ geometry: bounds.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: FIELDS.join(','), returnGeometry: 'true', resultRecordCount: String(MAX_HARVEST_FEATURES + 1), orderByFields: 'OBJECTID ASC', f: 'geojson' })}`
}
function sourceEvidence(properties: Record<string, unknown>, retrievedAt?: string): HarvestEvidence {
  const startDate = dateValue(properties.HARVEST_START_DATE, 'Harvest start date')
  const endDate = dateValue(properties.HARVEST_END_DATE, 'Harvest end date')
  const startYear =
    optionalYear(properties.HARVEST_START_YEAR_CALENDAR) ?? (startDate ? Number(startDate.slice(0, 4)) : undefined)
  const midYear = optionalYear(properties.HARVEST_MID_YEAR_CALENDAR)
  const identity = properties.VCCB_SYSID ?? properties.OBJECTID
  if (identity == null || !String(identity).trim())
    throw Error('BC harvested area is missing its unique source record ID.')
  return parseHarvestEvidence({
    source: 'bc-consolidated',
    status: 'harvested',
    sourceId: String(identity),
    sourceUrl: BC_HARVEST_SERVICE,
    retrievedAt,
    openingId: properties.OPENING_ID == null ? undefined : String(properties.OPENING_ID),
    dataSource: properties.DATA_SOURCE,
    areaHectares: properties.AREA_HA,
    sourceDate: properties.DATA_SOURCE_DATE,
    publishedDate: properties.PUBLISHED_DATE,
    startDate,
    endDate,
    startYear,
    midYear,
    yearMethod: endDate
      ? 'estimated-range'
      : midYear !== undefined
        ? 'estimated-midpoint'
        : startYear !== undefined
          ? 'start-only'
          : 'unknown',
  })
}
function hash(value: unknown): string {
  const text = JSON.stringify(value)
  let result = 2166136261
  for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619)
  return (result >>> 0).toString(16)
}
function stablePartId(prefix: string, value: unknown, part: number, multipart: boolean): string {
  const source = String(value)
  const safe = /^[A-Za-z0-9_.:-]{1,75}$/.test(source) ? source : hash(source)
  return `${prefix}${safe}${multipart ? `-part-${part + 1}` : ''}`
}
function polygon(raw: unknown): GeoJSON.Polygon {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw Error('Cutblock polygons require 1–100 rings.')
  const coordinates = raw.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 10_000)
      throw Error('Cutblock polygon rings require 4–10,000 vertices.')
    const points = ring.map((point) => {
      if (
        !Array.isArray(point) ||
        point.length < 2 ||
        point.length > 3 ||
        !point.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) >= 85
      )
        throw Error('Cutblock coordinates must be finite WGS84 longitude/latitude values.')
      return [point[0] as number, point[1] as number]
    })
    if (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1])
      throw Error('Cutblock polygon rings must be closed.')
    return points
  })
  return { type: 'Polygon', coordinates }
}
/** Imports explicit PGMaps evidence or official consolidated-cutblock fields; arbitrary year/age columns are not harvest dates. */
export function importHarvestHistory(
  raw: unknown,
  options: { retrievedAt?: string; requireBcSource?: boolean } = {},
): ContextFeature[] {
  if (typeof raw === 'string') {
    if (raw.length > MAX_HARVEST_RESPONSE_BYTES) throw Error('Import at most 10 MB of cutblock GeoJSON.')
    try {
      raw = JSON.parse(raw)
    } catch {
      throw Error('Cutblock GeoJSON is not valid JSON.')
    }
  }
  const root = record(raw, 'Cutblock GeoJSON')
  if (root.error)
    throw Error(String(record(root.error, 'BC harvest error').message ?? 'The BC harvest service rejected the query.'))
  if (
    root.exceededTransferLimit === true ||
    (root.properties && record(root.properties, 'Collection properties').exceededTransferLimit === true)
  )
    throw Error('The harvest query reached its record limit; narrow the extent.')
  if (root.crs !== undefined) {
    const crs = record(root.crs, 'GeoJSON CRS'),
      props = record(crs.properties, 'CRS properties')
    if (
      crs.type !== 'name' ||
      !['urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326', 'EPSG:4326'].includes(String(props.name))
    )
      throw Error('Reproject cutblock GeoJSON to WGS84 longitude/latitude first.')
  }
  const input = root.type === 'FeatureCollection' ? root.features : [root]
  if (!Array.isArray(input) || input.length > MAX_HARVEST_FEATURES)
    throw Error('Import at most 500 cutblock polygons; narrow the extent.')
  const result: ContextFeature[] = []
  let vertices = 0
  for (const rawFeature of input) {
    const f = record(rawFeature, 'Cutblock feature')
    if (f !== root && f.crs !== undefined)
      throw Error('Per-feature CRS is not supported; reproject all cutblocks to WGS84.')
    const geometry = f.type === 'Feature' ? record(f.geometry, 'Cutblock geometry') : f
    if (geometry.crs !== undefined && geometry !== root)
      throw Error('Geometry-level CRS is not supported; reproject all cutblocks to WGS84.')
    if (!['Polygon', 'MultiPolygon'].includes(String(geometry.type)))
      throw Error('Cutblock imports require Polygon or MultiPolygon geometry.')
    const properties = f.type === 'Feature' && f.properties != null ? record(f.properties, 'Cutblock properties') : {}
    if (properties.kind !== undefined && properties.kind !== 'harvest')
      throw Error('Import only harvest polygons in the cutblock history panel.')
    const isBc =
      options.requireBcSource ||
      properties.VCCB_SYSID != null ||
      'HARVEST_START_YEAR_CALENDAR' in properties ||
      'HARVEST_MID_YEAR_CALENDAR' in properties
    const evidence = options.requireBcSource
      ? sourceEvidence(properties, options.retrievedAt)
      : properties.harvestEvidence !== undefined
        ? parseHarvestEvidence(properties.harvestEvidence)
        : isBc
          ? sourceEvidence(properties, options.retrievedAt)
          : ({ source: 'user', yearMethod: 'unknown' } as HarvestEvidence)
    const multipart = geometry.type === 'MultiPolygon'
    const parts = multipart ? geometry.coordinates : [geometry.coordinates]
    if (!Array.isArray(parts) || !parts.length) throw Error('Cutblock geometry has no polygon parts.')
    const identity = evidence.sourceId ?? f.id ?? hash([properties.name, geometry])
    // Multipart imports remain one source opening even after being split into project polygons.
    evidence.sourceId ??= String(identity)
    for (const [part, coordinates] of parts.entries()) {
      const shape = polygon(coordinates)
      vertices += shape.coordinates.reduce((count, ring) => count + ring.length, 0)
      if (vertices > MAX_HARVEST_VERTICES) throw Error('Crop cutblocks to at most 50,000 vertices.')
      const explicitId = typeof f.id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(f.id) ? f.id : undefined
      result.push({
        id:
          explicitId && !multipart && !isBc
            ? explicitId
            : stablePartId(
                evidence.source === 'bc-consolidated' ? 'bc-harvest-' : 'harvest-',
                identity,
                part,
                multipart,
              ),
        name:
          optionalText(properties.name, 'Cutblock name', 200) ??
          `Cutblock ${evidence.openingId ?? evidence.sourceId ?? result.length + 1}`,
        kind: 'harvest',
        geometry: shape,
        harvestEvidence: evidence,
      })
      if (result.length > MAX_HARVEST_FEATURES) throw Error('Import at most 500 cutblock polygons; narrow the extent.')
    }
  }
  if (new Set(result.map((feature) => feature.id)).size !== result.length)
    throw Error('Cutblock source IDs must be unique; split or correct duplicate records.')
  return result
}
export async function loadBcHarvestHistory(bounds: Bounds, signal?: AbortSignal): Promise<ContextFeature[]> {
  const response = await fetch(buildHarvestHistoryQueryUrl(bounds), { signal })
  if (!response.ok) throw Error(`BC harvest service returned ${response.status} ${response.statusText}.`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_HARVEST_RESPONSE_BYTES)
    throw Error('BC cutblock response exceeds 10 MB; narrow the extent.')
  const reader = response.body?.getReader()
  let text = ''
  if (reader) {
    const decoder = new TextDecoder()
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_HARVEST_RESPONSE_BYTES) {
          await reader.cancel()
          throw Error('BC cutblock response exceeds 10 MB; narrow the extent.')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
  } else text = await response.text()
  if (signal?.aborted) throw signal.reason ?? new DOMException('Harvest loading cancelled', 'AbortError')
  return importHarvestHistory(text, { requireBcSource: true, retrievedAt: new Date().toISOString() })
}

type Point = [number, number]
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}
function inRing(point: Point, ring: Point[], check: () => void): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    check()
    const a = ring[i],
      b = ring[j]
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}
export interface NearbyRoadCandidate {
  road: ContextFeature
  distanceM: number
}
/** All loaded candidates in range, sorted by footprint-to-line separation. A nearby line is not a connected or usable route. */
export function nearbyRoadCandidates(
  block: ContextFeature,
  context: readonly ContextFeature[],
  { maxDistanceM = 1000 }: { maxDistanceM?: number } = {},
): NearbyRoadCandidate[] {
  if (
    block.kind !== 'harvest' ||
    block.geometry.type !== 'Polygon' ||
    !Number.isFinite(maxDistanceM) ||
    maxDistanceM < 0
  )
    return []
  const siblings = block.harvestEvidence?.sourceId
    ? context.filter(
        (feature) =>
          feature.kind === 'harvest' &&
          feature.geometry.type === 'Polygon' &&
          feature.harvestEvidence?.source === block.harvestEvidence?.source &&
          feature.harvestEvidence?.sourceId === block.harvestEvidence?.sourceId,
      )
    : [block]
  const blocks = siblings.some((feature) => feature.id === block.id) ? siblings : [block, ...siblings]
  const origin = block.geometry.coordinates[0][0]
  const scaleX = (Math.cos((origin[1] * Math.PI) / 180) * 6371008.8 * Math.PI) / 180,
    scaleY = (6371008.8 * Math.PI) / 180
  const metric = (point: number[]): Point => [(point[0] - origin[0]) * scaleX, (point[1] - origin[1]) * scaleY]
  const polygons = blocks.flatMap((feature) =>
    feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates.map((ring) => ring.map(metric))] : [],
  )
  const candidates: NearbyRoadCandidate[] = []
  let checks = 0
  const check = () => {
    if (++checks > MAX_NEARBY_ROAD_CHECKS)
      throw Error(
        'Crop or simplify cutblocks and nearby roads before measuring proximity; the geometry exceeds the browser comparison budget.',
      )
  }
  for (const road of context) {
    if (road.kind !== 'existing-road' || road.geometry.type !== 'LineString') continue
    const line = road.geometry.coordinates.map(metric)
    let distanceM = Infinity
    for (const rings of polygons) {
      // A later entry into the footprint crosses a boundary, handled by segment intersections below.
      if (line[0] && inRing(line[0], rings[0], check) && !rings.slice(1).some((hole) => inRing(line[0], hole, check))) {
        distanceM = 0
        break
      }
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++)
          for (let j = 1; j < line.length; j++) {
            check()
            const a = ring[i - 1],
              b = ring[i],
              c = line[j - 1],
              d = line[j]
            const dx = Math.max(
              0,
              Math.min(a[0], b[0]) - Math.max(c[0], d[0]),
              Math.min(c[0], d[0]) - Math.max(a[0], b[0]),
            )
            const dy = Math.max(
              0,
              Math.min(a[1], b[1]) - Math.max(c[1], d[1]),
              Math.min(c[1], d[1]) - Math.max(a[1], b[1]),
            )
            if (Math.hypot(dx, dy) > Math.min(distanceM, maxDistanceM)) continue
            distanceM = Math.min(distanceM, segmentDistance(a, b, c, d))
            if (distanceM === 0) break
          }
    }
    if (distanceM <= maxDistanceM) candidates.push({ road, distanceM })
  }
  return candidates.sort((a, b) => a.distanceM - b.distanceM || a.road.id.localeCompare(b.road.id))
}
