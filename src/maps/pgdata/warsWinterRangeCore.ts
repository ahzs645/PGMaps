import RBush, { type BBox } from 'rbush'

export interface WinterRangeSourceProperties extends Record<string, unknown> {
  boundaryName?: string
  UWR_NUMBER?: string
  UWR_UNIT_NUMBER?: string
  SPECIES_1?: string
  TIMBER_HARVEST_CODE?: string
  HECTARES?: number
}

/**
 * Extent the upstream snapshot covers, carried on the FeatureCollection.
 * `bbox`/`clippedTo` are null for a province-wide extract, which is how the
 * map tells "the whole layer" apart from "a window into it".
 */
export interface WinterRangeSourceMetadata {
  bbox?: [number, number, number, number] | null
  clippedTo?: string | null
  extent?: string
  sourceLayer?: string
}

export type WinterRangeSource = GeoJSON.FeatureCollection<
  GeoJSON.Geometry | null,
  WinterRangeSourceProperties
> & { metadata?: WinterRangeSourceMetadata }

export interface WinterRangeProperties {
  key: string
  label: string
  speciesCode: string
  speciesLabel: string
  color: string
  hectares: number
  harvestCode: string
}

export type WinterRangeCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  WinterRangeProperties
>

export interface WinterRangeLegendEntry {
  label: string
  color: string
  count: number
}

export interface WinterRangeCoverage {
  clippedTo: string | null
  window: string | null
  isProvinceWide: boolean
}

export type WinterRangePoint = readonly [longitude: number, latitude: number]

export interface WinterRangeOverlap {
  withinExtent: number
  insideRange: number
}

type Ring = GeoJSON.Position[]
type PolygonRings = Ring[]

interface IndexedPolygon extends BBox {
  rings: PolygonRings
}

export interface WinterRangeFootprint {
  index: RBush<IndexedPolygon>
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export interface ProcessedWinterRange {
  data: WinterRangeCollection
  legend: WinterRangeLegendEntry[]
  coverage: WinterRangeCoverage
  mooseFootprint: WinterRangeFootprint | null
}

/**
 * UWR `SPECIES_1` values are scientific-name codes, sometimes with a herd
 * suffix (`M-RATA-01`), so lookups match on the leading genus/species code.
 */
const WINTER_RANGE_SPECIES: Array<{ code: string; label: string; color: string }> = [
  { code: 'M-ALAM', label: 'Moose', color: '#92400e' },
  { code: 'M-ODHE', label: 'Mule Deer', color: '#d97706' },
  { code: 'M-RATA', label: 'Caribou', color: '#0d9488' },
  { code: 'M-ORAM', label: 'Mountain Goat', color: '#0369a1' },
  { code: 'M-OVCA', label: 'Bighorn Sheep', color: '#7c3aed' },
  { code: 'M-CEEL', label: 'Elk', color: '#dc2626' },
]

const WINTER_RANGE_FALLBACK = { label: 'Other ungulate', color: '#64748b' }

export const WARS_WINTER_RANGE_MOOSE_CODE = 'M-ALAM'

function resolveSpecies(rawCode: string) {
  const code = rawCode.trim().toUpperCase()
  const match = WINTER_RANGE_SPECIES.find((entry) => code.startsWith(entry.code))
  if (match) return { speciesCode: match.code, speciesLabel: match.label, color: match.color }
  return {
    speciesCode: code || 'UNKNOWN',
    speciesLabel: WINTER_RANGE_FALLBACK.label,
    color: WINTER_RANGE_FALLBACK.color,
  }
}

export function winterRangePropertiesFromSource(
  properties: Record<string, unknown>,
  key: string,
): WinterRangeProperties {
  const species = resolveSpecies(String(properties.SPECIES_1 ?? ''))
  const unit = [properties.UWR_NUMBER, properties.UWR_UNIT_NUMBER].filter(Boolean).join(' · ')
  return {
    key,
    label: unit || String(properties.boundaryName ?? 'Ungulate winter range'),
    hectares: Number(properties.HECTARES) || 0,
    harvestCode: String(properties.TIMBER_HARVEST_CODE ?? '').trim(),
    ...species,
  }
}

function isFinitePosition(position: GeoJSON.Position | undefined): position is GeoJSON.Position {
  return Array.isArray(position) && position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1])
}

/** A ring needs at least three distinct corners plus the closing vertex. */
function isUsableRing(ring: Ring | undefined): ring is Ring {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isFinitePosition)) return false

  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) return false

  return new Set(ring.slice(0, -1).map(([lon, lat]) => `${lon},${lat}`)).size >= 3
}

/** MapLibre requires non-empty polygons made from valid, closed linear rings. */
export function isUsableWinterRangeGeometry(
  geometry: GeoJSON.Geometry | null | undefined,
): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const isUsablePolygon = (coordinates: GeoJSON.Position[][] | undefined) =>
    Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isUsableRing)

  if (geometry?.type === 'Polygon') return isUsablePolygon(geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      geometry.coordinates.every(isUsablePolygon)
    )
  }
  return false
}

function toPolygons(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): PolygonRings[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  return geometry.coordinates
}

function indexPolygon(rings: PolygonRings): IndexedPolygon | null {
  const outer = rings[0]
  if (!isUsableRing(outer)) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lon, lat] of outer) {
    if (lon < minX) minX = lon
    if (lon > maxX) maxX = lon
    if (lat < minY) minY = lat
    if (lat > maxY) maxY = lat
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { rings, minX, minY, maxX, maxY }
}

/** Even-odd ray cast against a single ring. */
function isInsideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lonI, latI] = ring[i]
    const [lonJ, latJ] = ring[j]
    if (latI > lat !== latJ > lat) {
      const denominator = latJ - latI
      if (denominator === 0) continue
      if (lon < ((lonJ - lonI) * (lat - latI)) / denominator + lonI) inside = !inside
    }
  }
  return inside
}

function isInsidePolygon(lon: number, lat: number, polygon: IndexedPolygon): boolean {
  if (lon < polygon.minX || lon > polygon.maxX || lat < polygon.minY || lat > polygon.maxY) return false
  if (!isInsideRing(lon, lat, polygon.rings[0])) return false
  // Holes: a point inside any inner ring is outside the polygon.
  for (let i = 1; i < polygon.rings.length; i++) {
    const hole = polygon.rings[i]
    if (isUsableRing(hole) && isInsideRing(lon, lat, hole)) return false
  }
  return true
}

export function buildFootprint(
  features: WinterRangeCollection['features'],
  speciesCode: string | null,
): WinterRangeFootprint | null {
  const polygons: IndexedPolygon[] = []
  for (const feature of features) {
    if (speciesCode && feature.properties.speciesCode !== speciesCode) continue
    for (const rings of toPolygons(feature.geometry)) {
      const indexed = indexPolygon(rings)
      if (indexed) polygons.push(indexed)
    }
  }
  if (polygons.length === 0) return null

  // Accumulated in a loop rather than `Math.min(...polygons.map(...))`: the
  // province-wide extract carries ~96k moose polygons and spreading an array
  // that size throws RangeError once it crosses V8's argument limit.
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const polygon of polygons) {
    if (polygon.minX < minLon) minLon = polygon.minX
    if (polygon.minY < minLat) minLat = polygon.minY
    if (polygon.maxX > maxLon) maxLon = polygon.maxX
    if (polygon.maxY > maxLat) maxLat = polygon.maxY
  }
  return {
    index: new RBush<IndexedPolygon>().load(polygons),
    minLon,
    minLat,
    maxLon,
    maxLat,
  }
}

export function isInsideFootprint(lon: number, lat: number, footprint: WinterRangeFootprint): boolean {
  if (!isWithinFootprintExtent(lon, lat, footprint)) return false
  const point = { minX: lon, minY: lat, maxX: lon, maxY: lat }
  return footprint.index.search(point).some((polygon) => isInsidePolygon(lon, lat, polygon))
}

/** True when the point sits inside the bounding envelope the polygons occupy. */
export function isWithinFootprintExtent(lon: number, lat: number, footprint: WinterRangeFootprint): boolean {
  return lon >= footprint.minLon && lon <= footprint.maxLon && lat >= footprint.minLat && lat <= footprint.maxLat
}

export function computeWinterRangeOverlap(
  points: readonly WinterRangePoint[],
  footprint: WinterRangeFootprint | null,
): WinterRangeOverlap | null {
  if (!footprint) return null
  let withinExtent = 0
  let insideRange = 0
  for (const [longitude, latitude] of points) {
    if (!isWithinFootprintExtent(longitude, latitude, footprint)) continue
    withinExtent += 1
    if (isInsideFootprint(longitude, latitude, footprint)) insideRange += 1
  }
  return { withinExtent, insideRange }
}

function formatDegrees(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1)}°${value < 0 ? negative : positive}`
}

/**
 * Human-readable clip window, so the map can say where the snapshot actually
 * stops instead of asserting a coverage area the file may no longer match.
 */
function formatCoverageWindow(metadata: WinterRangeSourceMetadata | undefined): string | null {
  const bbox = metadata?.bbox
  if (!Array.isArray(bbox) || bbox.length < 4 || !bbox.every((value) => Number.isFinite(value))) return null
  const [west, south, east, north] = bbox
  const lonSpan = `${formatDegrees(west, 'E', 'W')} to ${formatDegrees(east, 'E', 'W')}`
  const latSpan = `${formatDegrees(south, 'N', 'S')} to ${formatDegrees(north, 'N', 'S')}`
  return `${lonSpan}, ${latSpan}`
}

export function processWinterRangeSource(source: WinterRangeSource): ProcessedWinterRange {
  const features: WinterRangeCollection['features'] = []
  const counts = new Map<string, WinterRangeLegendEntry>()

  for (const [index, feature] of source.features.entries()) {
    const geometry = feature.geometry
    if (!isUsableWinterRangeGeometry(geometry)) continue
    const properties = feature.properties ?? {}
    const normalizedProperties = winterRangePropertiesFromSource(
      properties,
      `${properties.UWR_NUMBER ?? 'uwr'}-${properties.UWR_UNIT_NUMBER ?? index}-${index}`,
    )
    features.push({
      type: 'Feature',
      geometry,
      properties: normalizedProperties,
    })
    const entry = counts.get(normalizedProperties.speciesLabel)
    if (entry) entry.count += 1
    else {
      counts.set(normalizedProperties.speciesLabel, {
        label: normalizedProperties.speciesLabel,
        color: normalizedProperties.color,
        count: 1,
      })
    }
  }

  const data: WinterRangeCollection = { type: 'FeatureCollection', features }
  const metadata = source.metadata
  const window = formatCoverageWindow(metadata)
  return {
    data,
    legend: Array.from(counts.values()).sort((a, b) => b.count - a.count),
    mooseFootprint: buildFootprint(features, WARS_WINTER_RANGE_MOOSE_CODE),
    coverage: {
      clippedTo: metadata?.clippedTo ?? null,
      window,
      /** No clip window means the snapshot carries the whole provincial layer. */
      isProvinceWide: !window && !metadata?.clippedTo,
    },
  }
}

/** `[[west, south], [east, north]]` for `map.fitBounds`, or null for empty geometry. */
export function getWinterRangeBounds(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [[number, number], [number, number]] | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const rings of toPolygons(geometry)) {
    for (const [lon, lat] of rings[0] ?? []) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}
