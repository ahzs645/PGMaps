/** Historical harvest evidence and geographic access candidates. No road-use or connectivity inference. */
import { readBoundedText } from '@/lib/boundedText'
import type { Bounds } from '@/lib/forestry/terrain/terrain'
import {
  BC_HARVEST_FIELDS,
  bcHarvestEvidence,
  BC_HARVEST_SERVICE,
  parseHarvestEvidence,
  type HarvestEvidence,
} from '@/lib/forestry/bcHarvest'
import type { ContextFeature } from './types'

export const MAX_HARVEST_FEATURES = 500
export const MAX_HARVEST_VERTICES = 50_000
export const MAX_HARVEST_QUERY_SPAN = 0.3
export const MAX_HARVEST_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_NEARBY_ROAD_CHECKS = 2_000_000

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
  return `${BC_HARVEST_SERVICE}/query?${new URLSearchParams({ geometry: bounds.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: BC_HARVEST_FIELDS.join(','), returnGeometry: 'true', resultRecordCount: String(MAX_HARVEST_FEATURES + 1), orderByFields: 'OBJECTID ASC', f: 'geojson' })}`
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
      ? bcHarvestEvidence(properties, options.retrievedAt)
      : properties.harvestEvidence !== undefined
        ? parseHarvestEvidence(properties.harvestEvidence)
        : isBc
          ? bcHarvestEvidence(properties, options.retrievedAt)
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
  const text = await readBoundedText(response, {
    maxBytes: MAX_HARVEST_RESPONSE_BYTES,
    tooLarge: 'BC cutblock response exceeds 10 MB; narrow the extent.',
    signal,
  })
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
function ringBox(ring: readonly Point[]): [number, number, number, number] {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const [x, y] of ring) {
    west = Math.min(west, x)
    east = Math.max(east, x)
    south = Math.min(south, y)
    north = Math.max(north, y)
  }
  return [west, south, east, north]
}

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
      // Only segments whose box comes within the search distance of the block's box can be near it; skipping the
      // rest is exact and keeps a long road from spending the comparison budget kilometres away.
      const box = ringBox(rings[0])
      const near: number[] = []
      for (let j = 1; j < line.length; j++) {
        const c = line[j - 1],
          d = line[j]
        const gapX = Math.max(0, box[0] - Math.max(c[0], d[0]), Math.min(c[0], d[0]) - box[2])
        const gapY = Math.max(0, box[1] - Math.max(c[1], d[1]), Math.min(c[1], d[1]) - box[3])
        if (Math.hypot(gapX, gapY) <= maxDistanceM) near.push(j)
      }
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++)
          for (const j of near) {
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
