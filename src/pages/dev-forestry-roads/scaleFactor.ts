/**
 * Grid and ground distances: the combined scale factor of a UTM grid at a place and height.
 *
 * Implements:
 * - the Transverse Mercator point scale factor k from latitude and longitude (Snyder, _Map
 *   Projections — A Working Manual_, USGS Professional Paper 1395, 1987, §8, eq. 8-11), with
 *   k₀ = 0.9996 on the GRS 80 ellipsoid (NAD83(CSRS), NAD83; WGS84 differs by under 1e-9 here);
 * - the elevation (sea-level) factor EF = R_G / (R_G + h), with R_G = √(ρν) the Gaussian mean
 *   radius at the latitude and h the ellipsoidal height (orthometric height plus geoid height);
 * - the combined scale factor CSF = k × EF, so that grid distance = ground horizontal distance × CSF.
 *
 * One convention throughout: CSF multiplies ground to give grid. An equal-area grid such as BC
 * Albers (EPSG:3005) has a scale that depends on direction, so it has no single combined factor and
 * is refused; reduce in the UTM zone instead.
 *
 * Pure: no DOM or network access.
 *
 * Written from a functional specification (RFLTools §7); no code from RFLTools (GPL-3.0) was used.
 */
import { csrsUtmZone } from '@/lib/geo/projectedCrs'

/** GRS 80. */
const A = 6378137
const F = 1 / 298.257222101
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
export const UTM_K0 = 0.9996
const RAD = Math.PI / 180
/** A factor outside this range is not a scale factor of a UTM grid on the ground. */
export const SCALE_FACTOR_LIMITS = [0.999, 1.001] as const

/** The UTM zone (and hemisphere) of an EPSG code this workspace reads, or null for any other grid. */
export function utmZoneOfEpsg(epsg: number): { zone: number; south: boolean } | null {
  const csrs = csrsUtmZone(epsg)
  if (csrs !== null) return { zone: csrs, south: false }
  if (epsg >= 26901 && epsg <= 26923) return { zone: epsg - 26900, south: false }
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false }
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true }
  return null
}

/** Gaussian mean radius of curvature √(ρν) at a latitude, m. */
export function gaussianRadius(latitudeDeg: number): number {
  const s = Math.sin(latitudeDeg * RAD)
  return (A * Math.sqrt(1 - E2)) / (1 - E2 * s * s)
}

/** Transverse Mercator point scale factor at a place, for a central meridian (Snyder eq. 8-11). */
export function transverseMercatorScale(
  latitudeDeg: number,
  longitudeDeg: number,
  centralMeridianDeg: number,
  k0 = UTM_K0,
) {
  const phi = latitudeDeg * RAD
  const T = Math.tan(phi) ** 2
  const C = EP2 * Math.cos(phi) ** 2
  const a = (longitudeDeg - centralMeridianDeg) * RAD * Math.cos(phi)
  return (
    k0 *
    (1 +
      ((1 + C) * a ** 2) / 2 +
      ((5 - 4 * T + 42 * C + 13 * C ** 2 - 28 * EP2) * a ** 4) / 24 +
      ((61 - 148 * T + 16 * T ** 2) * a ** 6) / 720)
  )
}

/** Elevation factor R_G / (R_G + h) for an ellipsoidal height h, m. */
export const elevationFactor = (latitudeDeg: number, ellipsoidalHeightM: number) => {
  const r = gaussianRadius(latitudeDeg)
  return r / (r + ellipsoidalHeightM)
}

export type CombinedScale =
  | { ok: true; zone: number; pointScale: number; elevationFactor: number; combined: number }
  | { ok: false; reason: string }

/**
 * The combined scale factor of a UTM grid at a place: grid distance = ground distance × combined.
 * Refused for a grid that is not UTM.
 */
export function combinedScaleFactor(
  epsg: number,
  place: { latitudeDeg: number; longitudeDeg: number },
  ellipsoidalHeightM: number,
): CombinedScale {
  if (epsg === 3005)
    return {
      ok: false,
      reason:
        'BC Albers is an equal-area grid: its scale differs by direction (about 1.0027 north–south and 0.9973 east–west at Prince George), so no single factor turns ground distances into grid ones. Reduce the survey in its UTM zone.',
    }
  const utm = utmZoneOfEpsg(epsg)
  if (!utm) return { ok: false, reason: `EPSG:${epsg} is not a UTM grid; no combined scale factor is computed for it.` }
  if (![place.latitudeDeg, place.longitudeDeg, ellipsoidalHeightM].every(Number.isFinite))
    return { ok: false, reason: 'The place or height is not a number.' }
  const pointScale = transverseMercatorScale(place.latitudeDeg, place.longitudeDeg, -183 + 6 * utm.zone)
  const ef = elevationFactor(place.latitudeDeg, ellipsoidalHeightM)
  const combined = pointScale * ef
  if (!(combined >= SCALE_FACTOR_LIMITS[0] && combined <= SCALE_FACTOR_LIMITS[1]))
    return {
      ok: false,
      reason: `The place is outside UTM zone ${utm.zone}'s band or the height is not a ground height: the factor would be ${combined.toFixed(6)}.`,
    }
  return { ok: true, zone: utm.zone, pointScale, elevationFactor: ef, combined }
}

/** "k 0.99960331 · EF 0.99989037 · CSF 0.99949373; 1,000 m on the ground is 999.494 m on the grid". */
export function scaleFactorText(scale: CombinedScale): string {
  if (!scale.ok) return scale.reason
  const f = (value: number) => value.toFixed(8)
  return `k ${f(scale.pointScale)} · EF ${f(scale.elevationFactor)} · CSF ${f(scale.combined)}; 1,000 m on the ground is ${(1000 * scale.combined).toFixed(3)} m on the grid, and 1,000 grid m is ${(1000 / scale.combined).toFixed(3)} m on the ground`
}

/**
 * A local (ground) coordinate to grid about a shared origin, with no rotation between them:
 * grid = grid₀ + (local − local₀) × CSF. Scaling about the project origin, not 0,0, keeps the
 * points where they are.
 */
export const localToGrid = (
  local: [number, number],
  localOrigin: [number, number],
  gridOrigin: [number, number],
  csf: number,
): [number, number] => [
  gridOrigin[0] + (local[0] - localOrigin[0]) * csf,
  gridOrigin[1] + (local[1] - localOrigin[1]) * csf,
]
export const gridToLocal = (
  grid: [number, number],
  localOrigin: [number, number],
  gridOrigin: [number, number],
  csf: number,
): [number, number] => [
  localOrigin[0] + (grid[0] - gridOrigin[0]) / csf,
  localOrigin[1] + (grid[1] - gridOrigin[1]) / csf,
]
