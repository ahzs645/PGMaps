import { useMemo } from 'react'
import { useJsonManifest } from './shared'

/**
 * Legal Ungulate Winter Range (UWR) polygons, synced from bcdatamapper's BC
 * boundaries output. The snapshot is a regional subset centred on the Prince
 * George area, not the full WARS extent, so anything derived from it has to be
 * reported against the polygons' own footprint rather than the whole region.
 */
export const WARS_WINTER_RANGE_PATH = '/data/boundaries/BCUWR/ungulate_winter_range.geojson'

interface WinterRangeSourceProperties {
  boundaryName?: string
  UWR_NUMBER?: string
  UWR_UNIT_NUMBER?: string
  SPECIES_1?: string
  TIMBER_HARVEST_CODE?: string
  HECTARES?: number
}

export interface WinterRangeProperties {
  key: string
  label: string
  speciesCode: string
  speciesLabel: string
  color: string
  hectares: number
  harvestCode: string
}

type WinterRangeSource = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, WinterRangeSourceProperties>
export type WinterRangeCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, WinterRangeProperties>

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
  return { speciesCode: code || 'UNKNOWN', speciesLabel: WINTER_RANGE_FALLBACK.label, color: WINTER_RANGE_FALLBACK.color }
}

type Ring = GeoJSON.Position[]
type PolygonRings = Ring[]

function toPolygons(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): PolygonRings[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/** A ring needs at least three distinct corners plus the closing vertex. */
function isUsableRing(ring: Ring | undefined): ring is Ring {
  return Array.isArray(ring) && ring.length >= 4
}

interface IndexedPolygon {
  rings: PolygonRings
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

function indexPolygon(rings: PolygonRings): IndexedPolygon | null {
  const outer = rings[0]
  if (!isUsableRing(outer)) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of outer) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null
  return { rings, minLon, minLat, maxLon, maxLat }
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
  if (lon < polygon.minLon || lon > polygon.maxLon || lat < polygon.minLat || lat > polygon.maxLat) return false
  if (!isInsideRing(lon, lat, polygon.rings[0])) return false
  // Holes: a point inside any inner ring is outside the polygon.
  for (let i = 1; i < polygon.rings.length; i++) {
    const hole = polygon.rings[i]
    if (isUsableRing(hole) && isInsideRing(lon, lat, hole)) return false
  }
  return true
}

export interface WinterRangeFootprint {
  polygons: IndexedPolygon[]
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

function buildFootprint(features: WinterRangeCollection['features'], speciesCode: string | null): WinterRangeFootprint | null {
  const polygons: IndexedPolygon[] = []
  for (const feature of features) {
    if (speciesCode && feature.properties.speciesCode !== speciesCode) continue
    for (const rings of toPolygons(feature.geometry)) {
      const indexed = indexPolygon(rings)
      if (indexed) polygons.push(indexed)
    }
  }
  if (polygons.length === 0) return null
  return {
    polygons,
    minLon: Math.min(...polygons.map((polygon) => polygon.minLon)),
    minLat: Math.min(...polygons.map((polygon) => polygon.minLat)),
    maxLon: Math.max(...polygons.map((polygon) => polygon.maxLon)),
    maxLat: Math.max(...polygons.map((polygon) => polygon.maxLat)),
  }
}

export function isInsideFootprint(lon: number, lat: number, footprint: WinterRangeFootprint): boolean {
  if (lon < footprint.minLon || lon > footprint.maxLon || lat < footprint.minLat || lat > footprint.maxLat) return false
  return footprint.polygons.some((polygon) => isInsidePolygon(lon, lat, polygon))
}

/** True when the point sits inside the bounding envelope the polygons occupy. */
export function isWithinFootprintExtent(lon: number, lat: number, footprint: WinterRangeFootprint): boolean {
  return lon >= footprint.minLon && lon <= footprint.maxLon && lat >= footprint.minLat && lat <= footprint.maxLat
}

export interface WinterRangeLegendEntry {
  label: string
  color: string
  count: number
}

export function useWarsWinterRange(enabled: boolean) {
  const source = useJsonManifest<WinterRangeSource>(enabled ? WARS_WINTER_RANGE_PATH : null)

  const data = useMemo<WinterRangeCollection>(() => {
    const features = source.data?.features ?? []
    return {
      type: 'FeatureCollection',
      features: features.map((feature, index) => {
        const properties = feature.properties ?? {}
        const species = resolveSpecies(String(properties.SPECIES_1 ?? ''))
        const unit = [properties.UWR_NUMBER, properties.UWR_UNIT_NUMBER].filter(Boolean).join(' · ')
        return {
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            key: `${properties.UWR_NUMBER ?? 'uwr'}-${properties.UWR_UNIT_NUMBER ?? index}-${index}`,
            label: unit || properties.boundaryName || 'Ungulate winter range',
            hectares: Number(properties.HECTARES) || 0,
            harvestCode: String(properties.TIMBER_HARVEST_CODE ?? '').trim(),
            ...species,
          },
        }
      }),
    }
  }, [source.data])

  const legend = useMemo<WinterRangeLegendEntry[]>(() => {
    const counts = new Map<string, WinterRangeLegendEntry>()
    for (const feature of data.features) {
      const { speciesLabel, color } = feature.properties
      const entry = counts.get(speciesLabel)
      if (entry) entry.count += 1
      else counts.set(speciesLabel, { label: speciesLabel, color, count: 1 })
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count)
  }, [data])

  const mooseFootprint = useMemo(() => buildFootprint(data.features, WARS_WINTER_RANGE_MOOSE_CODE), [data])

  return { source, data, legend, mooseFootprint }
}

export type WarsWinterRangeState = ReturnType<typeof useWarsWinterRange>
