/**
 * How far off the skyline stands, bearing by bearing, from an eye: the ground point of greatest apparent elevation
 * angle along each bearing, with the earth's curvature and standard refraction taken off the ground's height. Every
 * ground point an eye can see along a bearing lies no farther than that bearing's skyline point, so terrain out to
 * the farthest one (plus a margin) is all a picture of those bearings can show. A capture sizes its far terrain from
 * it (`captureTerrain`, `skylineTerrain.ts`).
 *
 * DOM-free and network-free.
 */

import type { ElevationSource } from './terrain'

/** Mean earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_000
/** Standard terrestrial refraction coefficient: the sightline bends with about 1/7.7 of the earth's curvature. */
export const STANDARD_REFRACTION = 0.13

/** Farthest a capture's terrain reaches for its skyline, metres. */
export const SKYLINE_MAX_RADIUS_METERS = 60_000
/** Posts across half a skyline grid: its spacing is the radius over this (240 m at 60 km, about 250 000 posts). */
export const SKYLINE_GRID_HALF_POSTS = 250

/**
 * The terrain radius that holds a skyline `farthestMeters` off: past it by a tenth or 2 km, whichever is more, so
 * bearings between the scanned ones and a ridge's far slope are in, rounded up to the kilometre and capped at
 * `SKYLINE_MAX_RADIUS_METERS`. `clipped` when the cap cut it (or the scan itself hit its limit).
 */
export function skylineTerrainRadius(reach: Pick<SkylineReach, 'farthestMeters' | 'reachesLimit'>): {
  radiusMeters: number
  spacingMeters: number
  clipped: boolean
} {
  const wanted = Math.ceil((reach.farthestMeters + Math.max(2000, reach.farthestMeters * 0.1)) / 1000) * 1000
  const radiusMeters = Math.min(SKYLINE_MAX_RADIUS_METERS, wanted)
  return {
    radiusMeters,
    spacingMeters: Math.ceil(radiusMeters / SKYLINE_GRID_HALF_POSTS),
    clipped: reach.reachesLimit || wanted > SKYLINE_MAX_RADIUS_METERS,
  }
}

/** How far ground at `distanceMeters` sits below the eye's level plane: d² / 2R × (1 − k). */
export function curvatureDrop(distanceMeters: number, refraction = STANDARD_REFRACTION): number {
  return ((distanceMeters * distanceMeters) / (2 * EARTH_RADIUS_M)) * (1 - refraction)
}

export type SkylineRay = {
  /** Clockwise from north, degrees, 0–360. */
  bearingDegrees: number
  /** Ground distance to the skyline point, metres; null when the ray read no ground. */
  distanceMeters: number | null
  /** Its apparent elevation angle above level, degrees (curvature and refraction applied). */
  elevationAngleDegrees: number | null
  /** Its ground height, metres above sea level. */
  groundElevationMeters: number | null
  /** Ray length over ground the source had no value for, metres. */
  unknownMeters: number
}

export type SkylineReach = {
  rays: SkylineRay[]
  /** The farthest skyline point over every bearing, metres (0 when no ray read ground). */
  farthestMeters: number
  farthestBearingDegrees: number | null
  maxDistanceMeters: number
  /** A skyline point stands within 5% of `maxDistanceMeters`: the real skyline may lie past the scan. */
  reachesLimit: boolean
}

/** A bearing range, clockwise from `fromDegrees` to `toDegrees` (may cross north). */
export type BearingRange = { fromDegrees: number; toDegrees: number }

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * The bearings a pinhole frame shows: its centre bearing ± the widest horizontal offset any of its corners reaches
 * (a pitched frame's corners turn wider than half its field), plus `padDegrees`.
 */
export function frameBearingRange(
  frame: { bearingDeg: number; pitchDeg: number; hfovDeg: number; vfovDeg: number },
  padDegrees = 1,
): BearingRange {
  const tanH = Math.tan((frame.hfovDeg * Math.PI) / 360)
  const tanV = Math.tan((frame.vfovDeg * Math.PI) / 360)
  const pitch = (frame.pitchDeg * Math.PI) / 180
  let half = frame.hfovDeg / 2
  for (const v of [-tanV, tanV]) {
    // Horizontal component of the corner ray along the frame's bearing; the lateral one is tanH.
    const forward = Math.cos(pitch) - v * Math.sin(pitch)
    half = Math.max(half, forward > 0 ? (Math.atan2(tanH, forward) * 180) / Math.PI : 90)
  }
  half = Math.min(90, half) + padDegrees
  return { fromDegrees: wrap(frame.bearingDeg - half), toDegrees: wrap(frame.bearingDeg + half) }
}

/** The point `distance` metres from `start` along `bearing` (radians) on the sphere. */
function destination(start: { lng: number; lat: number }, bearing: number, distance: number): [number, number] {
  const angular = distance / EARTH_RADIUS_M
  const lat1 = (start.lat * Math.PI) / 180
  const lng1 = (start.lng * Math.PI) / 180
  const sinLat = Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  const lat2 = Math.asin(sinLat)
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * sinLat)
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

/** Bearings every `stepDegrees` over the ranges, each range's ends included, without repeats. */
function bearingsOver(ranges: readonly BearingRange[], stepDegrees: number): number[] {
  const out = new Set<number>()
  for (const range of ranges) {
    const span = wrap(range.toDegrees - range.fromDegrees)
    const count = Math.max(1, Math.ceil(span / stepDegrees))
    for (let i = 0; i <= count; i++) out.add(Math.round(wrap(range.fromDegrees + (span * i) / count) * 1000) / 1000)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Per-bearing skyline distance from `eye` (absolute eye height, metres) over the bearing ranges, out to
 * `maxDistanceMeters`. Samples step `minStepMeters` near the eye and `stepFraction` of the distance farther out
 * (20 m to 5 km, then 0.4%: about 870 samples a ray to 60 km). Ground the source has no value for is skipped and
 * counted, never read as sea level.
 */
export function skylineReach(
  source: ElevationSource,
  eye: { lng: number; lat: number; elevation: number },
  ranges: readonly BearingRange[],
  options: {
    maxDistanceMeters?: number
    stepDegrees?: number
    minStepMeters?: number
    stepFraction?: number
    refraction?: number
  } = {},
): SkylineReach {
  const maxDistance = options.maxDistanceMeters ?? 60_000
  const minStep = options.minStepMeters ?? 20
  const fraction = options.stepFraction ?? 0.004
  const refraction = options.refraction ?? STANDARD_REFRACTION
  const rays = bearingsOver(ranges, options.stepDegrees ?? 0.5).map((bearingDegrees): SkylineRay => {
    const bearing = (bearingDegrees * Math.PI) / 180
    let best = -Infinity
    let bestDistance: number | null = null
    let bestGround: number | null = null
    let unknown = 0
    for (let d = minStep; d <= maxDistance; ) {
      const step = Math.max(minStep, d * fraction)
      const [lng, lat] = destination(eye, bearing, d)
      const ground = source.elevationAt(lng, lat)
      if (Number.isFinite(ground)) {
        const slope = (ground - curvatureDrop(d, refraction) - eye.elevation) / d
        if (slope > best) {
          best = slope
          bestDistance = d
          bestGround = ground
        }
      } else unknown += step
      if (d === maxDistance) break
      d = Math.min(maxDistance, d + step)
    }
    return {
      bearingDegrees,
      distanceMeters: bestDistance === null ? null : Math.round(bestDistance),
      elevationAngleDegrees: bestDistance === null ? null : Math.round(Math.atan(best) * (180 / Math.PI) * 1000) / 1000,
      groundElevationMeters: bestGround === null ? null : Math.round(bestGround),
      unknownMeters: Math.round(unknown),
    }
  })
  let farthest = 0
  let farthestBearing: number | null = null
  for (const ray of rays)
    if (ray.distanceMeters !== null && ray.distanceMeters > farthest) {
      farthest = ray.distanceMeters
      farthestBearing = ray.bearingDegrees
    }
  return {
    rays,
    farthestMeters: farthest,
    farthestBearingDegrees: farthestBearing,
    maxDistanceMeters: maxDistance,
    reachesLimit: farthest >= maxDistance * 0.95,
  }
}
