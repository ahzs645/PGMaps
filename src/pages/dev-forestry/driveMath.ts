import { bearingDegrees, haversineMeters } from './visibility'
export type DriveStation = { lng: number; lat: number; groundElevationMeters: number; distanceAlongMeters: number }
export type DriveLookAt = { lng: number; lat: number; elevationMeters: number }
export type RoadVertex = { lng: number; lat: number; distanceAlongMeters: number }
export function roadPath(coordinates: ReadonlyArray<readonly [number, number]>): RoadVertex[] {
  const result: RoadVertex[] = []
  for (const [lng, lat] of coordinates) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) throw new Error('Invalid road coordinate.')
    const previous = result[result.length - 1], distance = previous ? haversineMeters(previous, { lng, lat }) : 0
    if (previous && distance < 0.001) continue
    result.push({ lng, lat, distanceAlongMeters: (previous?.distanceAlongMeters ?? 0) + distance })
  }
  return result
}
/** Uses the actual road vertices. Analysis stations are NOT a substitute for the centreline. */
export function roadPlacement(path: readonly RoadVertex[], distance: number) {
  if (!path.length) return null
  const end = path[path.length - 1].distanceAlongMeters, d = Math.max(0, Math.min(end, distance))
  if (path.length === 1) return { ...path[0], travelBearing: 0 }
  let lo = 1, hi = path.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path[mid].distanceAlongMeters < d) lo = mid + 1; else hi = mid }
  const a = path[lo - 1], b = path[lo], fraction = (d - a.distanceAlongMeters) / (b.distanceAlongMeters - a.distanceAlongMeters)
  return { lng: a.lng + fraction * (b.lng - a.lng), lat: a.lat + fraction * (b.lat - a.lat), distanceAlongMeters: d, travelBearing: bearingDegrees(a, b) }
}
export function nearestStation(stations: readonly DriveStation[], distance: number): number {
  if (stations.length < 2) return 0
  let lo = 0, hi = stations.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (stations[mid].distanceAlongMeters < distance) lo = mid + 1; else hi = mid }
  return lo > 0 && distance - stations[lo - 1].distanceAlongMeters <= stations[lo].distanceAlongMeters - distance ? lo - 1 : lo
}
export function viewRotation(position: { lng: number; lat: number; travelBearing: number }, altitude: number, target: DriveLookAt | null, fallback: number, yaw: number, tilt: number) {
  const bearing = target ? bearingDegrees(position, target) : fallback
  const rise = target ? Math.atan2(target.elevationMeters - altitude, Math.max(1, haversineMeters(position, target))) * 180 / Math.PI : 0
  return { bearing: ((bearing + yaw) % 360 + 360) % 360, pitch: Math.max(40, Math.min(110, 90 + rise + tilt)) }
}
