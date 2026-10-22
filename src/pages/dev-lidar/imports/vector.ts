import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { geographic } from './coordinates'
import { LIMITS, type Bounds } from './types'
export function vectorData(
  input: unknown,
  override = 'auto',
): { data: FeatureCollection; bounds: Bounds; crs: string } {
  if (!input || typeof input !== 'object') throw Error('Expected GeoJSON')
  const raw = input as Record<string, any>
  if (raw.schema_version && raw.crowns && raw.support) input = raw.crowns
  const object = input as Record<string, any>
  const declared = raw.crs?.properties?.name as string | undefined
  const match = declared?.match(/EPSG(?::|::|\/0\/)(\d+)$/i)
  if (override === 'auto' && declared && !match && !/CRS84$/i.test(declared))
    throw Error('Unrecognized GeoJSON CRS; select its source CRS')
  const crs = override === 'auto' ? (match ? 'EPSG:' + match[1] : 'EPSG:4326') : override
  const rows =
    object.type === 'FeatureCollection'
      ? object.features
      : object.type === 'Feature'
        ? [object]
        : [{ type: 'Feature', geometry: object, properties: {} }]
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMITS.features)
    throw Error('Import 1–200,000 GeoJSON features at a time')
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  let vertices = 0
  const point = (p: unknown) => {
    if (!Array.isArray(p) || ++vertices > LIMITS.vertices)
      throw Error('Invalid coordinate or more than 2 million vertices')
    const q = geographic(p, crs)
    bounds[0] = Math.min(bounds[0], q[0])
    bounds[1] = Math.min(bounds[1], q[1])
    bounds[2] = Math.max(bounds[2], q[0])
    bounds[3] = Math.max(bounds[3], q[1])
    return q
  }
  const line = (coordinates: unknown, min: number) => {
    if (!Array.isArray(coordinates) || coordinates.length < min) throw Error('Invalid GeoJSON line or ring')
    return coordinates.map(point)
  }
  const polygon = (coordinates: unknown) => {
    if (!Array.isArray(coordinates) || !coordinates.length) throw Error('Polygon has no rings')
    return coordinates.map((r) => {
      const ring = line(r, 4)
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) throw Error('Polygon rings must be closed')
      return ring
    })
  }
  const geometry = (g: any, depth = 0): Geometry => {
    if (!g || depth > 6) throw Error('Missing or nested geometry')
    switch (g.type) {
      case 'Point':
        return { type: 'Point', coordinates: point(g.coordinates) }
      case 'MultiPoint':
        return { type: 'MultiPoint', coordinates: line(g.coordinates, 1) }
      case 'LineString':
        return { type: 'LineString', coordinates: line(g.coordinates, 2) }
      case 'MultiLineString':
        if (!Array.isArray(g.coordinates) || !g.coordinates.length) throw Error('Invalid multi-line geometry')
        return { type: 'MultiLineString', coordinates: g.coordinates.map((c: unknown) => line(c, 2)) }
      case 'Polygon':
        return { type: 'Polygon', coordinates: polygon(g.coordinates) }
      case 'MultiPolygon':
        if (!Array.isArray(g.coordinates) || !g.coordinates.length) throw Error('Invalid multi-polygon geometry')
        return { type: 'MultiPolygon', coordinates: g.coordinates.map(polygon) }
      case 'GeometryCollection':
        if (!Array.isArray(g.geometries) || !g.geometries.length) throw Error('Empty geometry collection')
        return { type: 'GeometryCollection', geometries: g.geometries.map((v: any) => geometry(v, depth + 1)) }
      default:
        throw Error('Unsupported GeoJSON geometry')
    }
  }
  const features: Feature[] = rows.map((f: any) => {
    if (
      f.type !== 'Feature' ||
      (f.properties !== null && (typeof f.properties !== 'object' || Array.isArray(f.properties)))
    )
      throw Error('Invalid GeoJSON feature attributes')
    return {
      type: 'Feature',
      ...(typeof f.id === 'string' || typeof f.id === 'number' ? { id: f.id } : {}),
      properties: f.properties ?? {},
      geometry: geometry(f.geometry),
    }
  })
  if (!bounds.every(Number.isFinite) || bounds[2] - bounds[0] > 180)
    throw Error('Invalid or antimeridian-spanning extent; split the dataset before importing')
  return { data: { type: 'FeatureCollection', features }, bounds, crs }
}
export const featureName = (f: Feature, i: number) =>
  String(
    f.properties?.id ??
      f.properties?.tree_id ??
      f.properties?.instance_id ??
      f.properties?.candidate_id ??
      f.properties?.global_id ??
      f.id ??
      i + 1,
  )
