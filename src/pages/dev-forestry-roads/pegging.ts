/** Survey-style peg measurements and ground-grade searches on the native sampler. */
import { distance, offsetCoordinate } from './engine'
import type { Coordinate, TerrainSource } from './types'

export function pegBearing(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180
  const delta = (b[0] - a[0]) * rad
  const y = Math.sin(delta) * Math.cos(b[1] * rad)
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(delta)
  return (Math.atan2(y, x) / rad + 360) % 360
}

export interface PegMeasurement {
  length: number
  bearing: number
  startElevation: number | null
  endElevation: number | null
  grade: number | null
  maxGroundGrade: number | null
  coveragePercent: number
}

const finite = (value: number | null): number | null => (value !== null && Number.isFinite(value) ? value : null)
export function measurePeg(a: Coordinate, b: Coordinate, terrain: TerrainSource): PegMeasurement {
  const length = distance(a, b)
  const bearing = pegBearing(a, b)
  const count = Math.max(1, Math.min(2000, Math.ceil(length)))
  const startElevation = finite(terrain.elevationAt(...a))
  const endElevation = finite(terrain.elevationAt(...b))
  let covered = 0
  let maximum: number | null = null
  let previous = startElevation
  for (let i = 1; i <= count; i++) {
    const coordinate = i === count ? b : offsetCoordinate(a, bearing, (length * i) / count)
    const elevation = finite(terrain.elevationAt(...coordinate))
    if (previous !== null && elevation !== null && length > 0) {
      covered += length / count
      maximum = Math.max(maximum ?? 0, Math.abs((100 * (elevation - previous)) / (length / count)))
    }
    previous = elevation
  }
  return {
    length,
    bearing,
    startElevation,
    endElevation,
    grade:
      startElevation !== null && endElevation !== null && length >= 0.001
        ? (100 * (endElevation - startElevation)) / length
        : null,
    maxGroundGrade: maximum,
    coveragePercent: length > 0 ? (100 * covered) / length : 0,
  }
}

/** Find the closest heading to a requested bearing at a fixed horizontal leg length.
 * The target is endpoint ground grade, not a designed vertical profile. Missing
 * samples never form a bracket, and candidate legs with terrain gaps are rejected.
 */
export function findGradePeg(
  origin: Coordinate,
  preferredBearing: number,
  length: number,
  targetGrade: number,
  terrain: TerrainSource,
): { coordinate: Coordinate; measurement: PegMeasurement } | null {
  if (![preferredBearing, length, targetGrade].every(Number.isFinite) || length < 0.2 || length > 1000) return null
  const base = finite(terrain.elevationAt(...origin))
  if (base === null) return null
  const at = (offset: number) => {
    const coordinate = offsetCoordinate(origin, preferredBearing + offset, length)
    const ground = finite(terrain.elevationAt(...coordinate))
    return { coordinate, error: ground === null ? null : (100 * (ground - base)) / length - targetGrade }
  }
  const roots: number[] = []
  for (let lo = -90; lo < 90; lo += 2) {
    let left = lo,
      right = lo + 2
    let low = at(left).error,
      high = at(right).error
    if (low === null || high === null) continue
    if (Math.abs(low) < 0.005) roots.push(left)
    if (Math.abs(high) < 0.005) roots.push(right)
    if (low * high >= 0) continue
    let valid = true
    for (let j = 0; j < 24; j++) {
      const mid = (left + right) / 2
      const error = at(mid).error
      if (error === null) {
        valid = false
        break
      }
      if (error * low > 0) {
        left = mid
        low = error
      } else {
        right = mid
        high = error
      }
    }
    if (valid) roots.push((left + right) / 2)
  }
  for (const heading of roots.sort((a, b) => Math.abs(a) - Math.abs(b))) {
    const coordinate = at(heading).coordinate
    const measurement = measurePeg(origin, coordinate, terrain)
    if (
      measurement.grade !== null &&
      Math.abs(measurement.grade - targetGrade) <= 0.01 &&
      measurement.coveragePercent > 99.999
    ) {
      return { coordinate, measurement }
    }
  }
  return null
}
