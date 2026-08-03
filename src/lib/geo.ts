export const EARTH_RADIUS_KM = 6371

/** Great-circle distance in km between two points given as (lat, lng) pairs. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Great-circle distance in km between two [lng, lat] positions (GeoJSON coordinate order). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  return haversineKm(a[1], a[0], b[1], b[0])
}

/** `[minLng, minLat, maxLng, maxLat]` — the order @turf/bbox and MapLibre both use. */
export type BBox = [number, number, number, number]

/**
 * Bounding box of any GeoJSON geometry, or null when it carries no usable
 * coordinates. A Point yields a zero-area box; callers that need a clickable
 * area around it should pad the result themselves.
 *
 * Prefer this to @turf/bbox for plain bounds: it walks the coordinates
 * directly, handles every geometry type including GeometryCollection, and
 * needs no dependency.
 */
export function geometryBounds(geometry: GeoJSON.Geometry | null | undefined): BBox | null {
  if (!geometry) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const expand = ([lng, lat]: GeoJSON.Position) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  const walk = (node: GeoJSON.Geometry) => {
    switch (node.type) {
      case 'Point':
        expand(node.coordinates)
        break
      case 'MultiPoint':
      case 'LineString':
        node.coordinates.forEach(expand)
        break
      case 'MultiLineString':
      case 'Polygon':
        node.coordinates.forEach((line) => line.forEach(expand))
        break
      case 'MultiPolygon':
        node.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach(expand)))
        break
      case 'GeometryCollection':
        node.geometries.forEach(walk)
        break
    }
  }

  walk(geometry)

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return [minLng, minLat, maxLng, maxLat]
}

/** Centre of a geometry's bounding box, or null when it has no coordinates. */
export function boundsCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const bounds = geometryBounds(geometry)
  if (!bounds) return null
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
}
