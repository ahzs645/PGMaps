import { offsetCoordinate } from './engine'
import type { RoadStation } from './types'

/** Actual sampled removal extent, never an inferred buffer around incomplete ground. */
export function preparationExtent(station: RoadStation, sign: -1 | 1): number | null {
  if (!station.complete) return null
  const daylight = sign < 0 ? station.leftDaylightM : station.rightDaylightM
  if (daylight === null) return null
  let extent = Math.abs(daylight)
  for (const point of station.section)
    if (point.preparedGround != null && point.ground != null && point.preparedGround < point.ground - 1e-7)
      extent = Math.max(extent, sign * point.offset)
  return extent
}

export function preparationMarginFeatures(a: RoadStation, b: RoadStation): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return ([-1, 1] as const).flatMap((sign) => {
    const outerA = preparationExtent(a, sign),
      outerB = preparationExtent(b, sign)
    const innerA = sign < 0 ? a.leftDaylightM : a.rightDaylightM,
      innerB = sign < 0 ? b.leftDaylightM : b.rightDaylightM
    if (
      outerA === null ||
      outerB === null ||
      innerA === null ||
      innerB === null ||
      (outerA < innerA + 1e-6 && outerB < innerB + 1e-6)
    )
      return []
    const p = (s: RoadStation, distance: number) => offsetCoordinate(s.coordinate, s.bearing + 90, sign * distance)
    const ring = [p(a, innerA), p(b, innerB), p(b, outerB), p(a, outerA), p(a, innerA)]
    return [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          role: 'site-preparation',
          chainage: (a.chainage + b.chainage) / 2,
          beyond: false,
          color: '#a16207',
        },
      },
    ]
  })
}
