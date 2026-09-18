/**
 * Bringing outside geometry onto the page: zipped shapefiles, GeoJSON, and
 * anything already parsed into feature collections.
 *
 * Polygons become assessable blocks and lines become candidate road
 * centrelines, so one drop of a planning package can supply both sides of a
 * visibility run.
 */

import { polygonAreaMeters, type PolygonGeometry } from './visibility'

export type ImportedPolygon = {
  name: string
  geometry: PolygonGeometry
  areaMeters: number
}

export type ImportedLine = {
  name: string
  coordinates: Array<[number, number]>
}

export type ImportedGeometry = {
  polygons: ImportedPolygon[]
  lines: ImportedLine[]
  /** Features that carried no polygon or line geometry. */
  skippedCount: number
}

/**
 * Attribute names worth showing as a block label, most specific first. Forestry
 * exports rarely use `name`; they use the opening or cut block identifier.
 */
const NAME_KEYS = [
  'CUT_BLOCK_ID',
  'CUTBLOCK_ID',
  'BLOCK_ID',
  'BLOCK',
  'OPENING_ID',
  'HARVEST_AREA_ID',
  'LICENCE_ID',
  'FEATURE_ID',
  'NAME',
  'Name',
  'name',
  'LABEL',
  'label',
  'TITLE',
  'title',
  'ID',
  'id',
]

/** The most useful label a feature's attributes offer, falling back to its index. */
export function featureName(
  properties: Record<string, unknown> | null | undefined,
  fallbackIndex: number,
  prefix = 'Polygon',
): string {
  if (properties) {
    for (const key of NAME_KEYS) {
      const value = properties[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }
  return `${prefix} ${fallbackIndex + 1}`
}

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  )
}

/** Accepts a Feature, FeatureCollection, geometry, or an array of any of those. */
export function toFeatures(input: unknown): GeoJSON.Feature[] {
  if (Array.isArray(input)) return input.flatMap(toFeatures)
  if (!input || typeof input !== 'object') return []

  const node = input as { type?: string; features?: unknown; geometry?: unknown; geometries?: unknown }
  if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
    return node.features.flatMap(toFeatures)
  }
  if (node.type === 'Feature') return [input as GeoJSON.Feature]
  if (node.type === 'GeometryCollection' && Array.isArray(node.geometries)) {
    return node.geometries.flatMap((geometry) => toFeatures({ type: 'Feature', geometry, properties: {} }))
  }
  if (typeof node.type === 'string') {
    return [{ type: 'Feature', geometry: input as GeoJSON.Geometry, properties: {} }]
  }
  return []
}

/** Splits features into polygons and lines, dropping anything else. */
export function collectImportedGeometry(input: unknown, namePrefix = 'Polygon'): ImportedGeometry {
  const features = toFeatures(input)
  const polygons: ImportedPolygon[] = []
  const lines: ImportedLine[] = []
  let skippedCount = 0

  features.forEach((feature, index) => {
    const geometry = feature.geometry
    const properties = (feature.properties ?? {}) as Record<string, unknown>

    if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
      polygons.push({
        name: featureName(properties, polygons.length, namePrefix),
        geometry,
        areaMeters: polygonAreaMeters(geometry),
      })
      return
    }

    if (geometry?.type === 'LineString' || geometry?.type === 'MultiLineString') {
      const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
      let added = false
      for (const part of parts) {
        const coordinates = part.filter(isPosition).map(([lng, lat]) => [lng, lat] as [number, number])
        if (coordinates.length < 2) continue
        lines.push({ name: featureName(properties, lines.length, 'Road'), coordinates })
        added = true
      }
      if (!added) skippedCount += 1
      return
    }

    skippedCount += index >= 0 ? 1 : 0
  })

  return { polygons, lines, skippedCount }
}

/**
 * Reads a dropped file. A `.zip` goes through shpjs, which also reprojects via
 * the shapefile's `.prj` — BC planning data usually arrives in BC Albers, and
 * without the projection file its coordinates land in the ocean off Africa.
 */
export async function readShapeFile(file: File): Promise<ImportedGeometry> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.zip') || lowerName.endsWith('.shp')) {
    // Loaded on demand so the shapefile parser stays out of the page bundle.
    const shp = (await import('shpjs')).default
    const parsed = await shp(await file.arrayBuffer())
    return collectImportedGeometry(parsed)
  }

  if (lowerName.endsWith('.json') || lowerName.endsWith('.geojson')) {
    return collectImportedGeometry(JSON.parse(await file.text()))
  }

  throw new Error('Drop a zipped shapefile (.zip) or a GeoJSON file (.geojson)')
}
