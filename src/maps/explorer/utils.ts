import { geometryBounds as sharedGeometryBounds } from '@/lib/geo'
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

/**
 * Explorer's named-field bounds, padded so a point (or a degenerate geometry
 * that collapses to one) still has a clickable area to hit-test against.
 */
export function geometryBounds(geometry: GeoJSON.Geometry): GeometryBounds | null {
  const bounds = sharedGeometryBounds(geometry)
  if (!bounds) return null
  const [minLng, minLat, maxLng, maxLat] = bounds
  if (minLng === maxLng && minLat === maxLat) return createPointBounds(minLng, minLat)
  return { minLng, minLat, maxLng, maxLat }
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
