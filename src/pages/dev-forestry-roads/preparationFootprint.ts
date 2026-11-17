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

/** The plan's clearing limits: a dashed line on each side, the same colour in the legend. */
export const CLEARING_LINE_COLOR = '#15803d'

/**
 * Each side's clearing limit as a line through the complete stations, broken where a section is
 * incomplete: the clearing distance the clearing schedule prints (`stationExtras.ts`), else the catch.
 */
export function clearingLineFeatures(stations: readonly RoadStation[]): GeoJSON.Feature<GeoJSON.LineString>[] {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (const sign of [-1, 1] as const) {
    let run: [number, number][] = []
    const flush = () => {
      if (run.length > 1)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: run },
          properties: {
            role: 'clearing',
            side: sign < 0 ? 'left' : 'right',
            beyond: false,
            color: CLEARING_LINE_COLOR,
          },
        })
      run = []
    }
    for (const s of stations) {
      const clearing = sign < 0 ? s.leftClearingM : s.rightClearingM
      const daylight = sign < 0 ? s.leftDaylightM : s.rightDaylightM
      const distance =
        clearing != null && Number.isFinite(clearing)
          ? Math.abs(clearing)
          : daylight != null
            ? Math.abs(daylight)
            : null
      if (!s.complete || distance === null) {
        flush()
        continue
      }
      run.push(offsetCoordinate(s.coordinate, s.bearing + 90, sign * distance) as [number, number])
    }
    flush()
  }
  return features
}
