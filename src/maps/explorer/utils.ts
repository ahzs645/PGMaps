import type { GeometryBounds, SpatialFilter } from './types'

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

export function createPointBounds(longitude: number, latitude: number): GeometryBounds {
  const pad = 0.008
  return { minLng: longitude - pad, minLat: latitude - pad, maxLng: longitude + pad, maxLat: latitude + pad }
}

function expandBounds(bounds: GeometryBounds, lng: number, lat: number) {
  if (lng < bounds.minLng) bounds.minLng = lng
  if (lng > bounds.maxLng) bounds.maxLng = lng
  if (lat < bounds.minLat) bounds.minLat = lat
  if (lat > bounds.maxLat) bounds.maxLat = lat
}

export function geometryBounds(geometry: GeoJSON.Geometry): GeometryBounds | null {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates
    return createPointBounds(lng, lat)
  }
  const bounds: GeometryBounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity }
  const scanRing = (ring: number[][]) => {
    ring.forEach(([lng, lat]) => expandBounds(bounds, lng, lat))
  }
  if (geometry.type === 'LineString') geometry.coordinates.forEach(([lng, lat]) => expandBounds(bounds, lng, lat))
  else if (geometry.type === 'MultiLineString')
    geometry.coordinates.forEach((line) => line.forEach(([lng, lat]) => expandBounds(bounds, lng, lat)))
  else if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => scanRing(ring))
  else if (geometry.type === 'MultiPolygon')
    geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => scanRing(ring)))
  else return null
  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) return null
  if (bounds.minLng === bounds.maxLng && bounds.minLat === bounds.maxLat)
    return createPointBounds(bounds.minLng, bounds.minLat)
  return bounds
}

export function formatNullableText(value: string | number | null | undefined, fallback = 'N/A'): string {
  if (value == null) return fallback
  const text = String(value).trim()
  return text || fallback
}

export function boundsIntersect(a: GeometryBounds, b: SpatialFilter): boolean {
  return a.maxLng >= b.minLng && a.minLng <= b.maxLng && a.maxLat >= b.minLat && a.minLat <= b.maxLat
}

export function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
