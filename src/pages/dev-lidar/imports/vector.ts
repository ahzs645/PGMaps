import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { geographic } from './coordinates'
import { LIMITS, type Bounds } from './types'
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
const crsName = (value: unknown) => {
  const crs = isObject(value) ? value.crs : undefined
  const properties = isObject(crs) ? crs.properties : undefined
  return isObject(properties) && typeof properties.name === 'string' ? properties.name : undefined
}
export function vectorData(
  input: unknown,
  override = 'auto',
): { data: FeatureCollection; bounds: Bounds; crs: string; note?: string } {
  if (!isObject(input)) throw Error('Expected GeoJSON')
  const raw = input
  const object = raw.schema_version && isObject(raw.crowns) && raw.support ? raw.crowns : raw
  // A declared EPSG code wins over the picker; the picker applies to files without one.
  const declared = crsName(raw) ?? crsName(object)
  const match = declared?.match(/EPSG(?::|::|\/0\/)(\d+)$/i)
  const embedded = match ? 'EPSG:' + match[1] : declared && /CRS84$/i.test(declared) ? 'EPSG:4326' : undefined
  if (override === 'auto' && declared && !embedded) throw Error('Unrecognized GeoJSON CRS; select its source CRS')
  const crs = embedded ?? (override === 'auto' ? 'EPSG:4326' : override)
  const note =
    embedded && override !== 'auto' && override !== embedded
      ? `Used the declared ${embedded}; the selected ${override} was ignored.`
      : undefined
  const rows: unknown =
    object.type === 'FeatureCollection'
      ? object.features
      : object.type === 'Feature'
        ? [object]
        : [{ type: 'Feature', geometry: object, properties: {} }]
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMITS.features)
    throw Error('Import 1–200,000 GeoJSON features at a time')
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  let vertices = 0
  const point = (p: unknown): Position => {
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
  const geometry = (g: unknown, depth = 0): Geometry => {
    if (!isObject(g) || depth > 6) throw Error('Missing or nested geometry')
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
        return { type: 'GeometryCollection', geometries: g.geometries.map((v: unknown) => geometry(v, depth + 1)) }
      default:
        throw Error('Unsupported GeoJSON geometry')
    }
  }
  const features: Feature[] = rows.map((f: unknown) => {
    if (!isObject(f) || f.type !== 'Feature' || (f.properties !== null && !isObject(f.properties)))
      throw Error('Invalid GeoJSON feature attributes')
    return {
      type: 'Feature',
      ...(typeof f.id === 'string' || typeof f.id === 'number' ? { id: f.id } : {}),
      properties: (f.properties as Json | null) ?? {},
      geometry: geometry(f.geometry),
    }
  })
  if (!bounds.every(Number.isFinite) || bounds[2] - bounds[0] > 180)
    throw Error('Invalid or antimeridian-spanning extent; split the dataset before importing')
  return { data: { type: 'FeatureCollection', features }, bounds, crs, note }
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
