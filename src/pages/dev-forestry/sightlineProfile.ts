import type { CanopySource } from './canopy'
import { lngLatToMercator, mercatorToLngLat, type ElevationSource } from './terrain'
import {
  earthCurvatureDropMeters,
  haversineMeters,
  testSightline,
  type GroundPoint,
  type SightlineOptions,
} from './visibility'

export type SightlineProfile = {
  status: 'visible' | 'occluded' | 'unknown' | 'out-of-range'
  distanceMeters: number
  blockedAtMeters: number | null
  points: Array<{ distance: number; ray: number; ground: number | null; canopy: number | null }>
}
/** Uses exactly the sightline model's locations, curvature, offsets and clearance. */
export function traceSightlineProfile(
  source: ElevationSource,
  observer: GroundPoint,
  target: GroundPoint,
  options: SightlineOptions,
  canopy?: CanopySource,
): SightlineProfile {
  const sight = testSightline(source, observer, target, options, canopy)
  const distance = haversineMeters(observer, target),
    start = lngLatToMercator(observer.lng, observer.lat),
    end = lngLatToMercator(target.lng, target.lat)
  const eye = observer.groundElevationMeters + options.observerHeightMeters
  const slope = distance
    ? (target.groundElevationMeters +
        options.targetOffsetMeters -
        earthCurvatureDropMeters(distance, options.refractionCoefficient) -
        eye) /
      distance
    : 0
  const steps = Math.min(1200, Math.max(2, Math.ceil(distance / options.stepMeters)))
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps,
      d = distance * f,
      x = start[0] + (end[0] - start[0]) * f,
      y = start[1] + (end[1] - start[1]) * f
    const [lng, lat] = mercatorToLngLat(x, y),
      ground = source.elevationAtMercator ? source.elevationAtMercator(x, y) : source.elevationAt(lng, lat),
      height = canopy?.heightAtMercator(x, y) ?? 0
    return {
      distance: d,
      ray: eye + slope * d + earthCurvatureDropMeters(d, options.refractionCoefficient) + options.clearanceMeters,
      ground: Number.isFinite(ground) ? ground : null,
      canopy: Number.isFinite(height) && Number.isFinite(ground) ? ground + height : null,
    }
  })
  return { status: sight.status, distanceMeters: distance, blockedAtMeters: sight.blockedAtMeters, points }
}
