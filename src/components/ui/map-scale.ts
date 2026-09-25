/**
 * A scale bar's length: the longest round distance (1, 2 or 5 × 10ⁿ metres)
 * that fits in `maxPixels` at the map's current metres per pixel.
 *
 * Measured the way MapLibre's own scale control is: across the map's vertical
 * middle, great-circle, so Web Mercator's stretch at high latitude (1.7× at
 * Prince George) is accounted for rather than read off the zoom level.
 */
export type ScaleBar = { meters: number; pixels: number; label: string }

const EARTH_RADIUS_METERS = 6371008.8

export function greatCircleMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function scaleBarFor(metersPerPixel: number, maxPixels = 100): ScaleBar | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0 || maxPixels <= 0) return null
  const maxMeters = metersPerPixel * maxPixels
  const exponent = Math.floor(Math.log10(maxMeters))
  const base = 10 ** exponent
  const step = [5, 2, 1].find((n) => n * base <= maxMeters) ?? 1
  const meters = step * base
  const label = meters >= 1000 ? `${meters / 1000} km` : meters >= 1 ? `${meters} m` : `${Math.round(meters * 100)} cm`
  return { meters, pixels: meters / metersPerPixel, label }
}
