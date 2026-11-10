/**
 * A D-line's own frame: where its yarder is, which way the skyline runs, and the conversions
 * between a station from the yarder (what support layouts, stake-out tables and field shots use)
 * and a map position. Positions follow the great circle from the yarder, as `layoutRun` samples
 * the ground. Pure: no DOM or network access.
 */
import { resolvedCableLine } from '../cableGeometry'
import { distance, offsetCoordinate } from '../engine'
import type { CableLine, Coordinate } from '../types'

const RAD = Math.PI / 180
const EARTH_RADIUS_M = 6371008.8

export interface DLineFrame {
  /** The yarder end, after insets. */
  yarder: Coordinate
  /** The far (tailhold) end, after insets. */
  far: Coordinate
  /** Horizontal length between them, m. */
  lengthM: number
  /** Bearing from the yarder to the far end, degrees clockwise from north. */
  headingDeg: number
  /** True when the yarder is the D-line's physical end: chart distance = length − station. */
  yarderAtEnd: boolean
  /** Map position `stationM` along the line from the yarder (negative: behind it). */
  at: (stationM: number) => Coordinate
  /** Station from the yarder of a position, and its offset from the line (negative left looking out). */
  stationOf: (coordinate: Coordinate) => { stationM: number; offsetM: number }
  /** Profile distance on the D-line chart (from the physical start) for a station from the yarder. */
  chartDistance: (stationM: number) => number
}

export function bearingDeg(a: Coordinate, b: Coordinate) {
  const d = (b[0] - a[0]) * RAD,
    p = a[1] * RAD,
    q = b[1] * RAD
  const h = Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d))
  return (((h / RAD + 360) % 360) + 360) % 360
}

/** The D-line's frame, or null when its geometry is invalid. */
export function dLineFrame(line: CableLine): DLineFrame | null {
  let resolved: CableLine
  try {
    resolved = resolvedCableLine(line)
  } catch {
    return null
  }
  const yarderAtEnd = (line.yarderAt ?? 'start') === 'end'
  const yarder = yarderAtEnd ? resolved.end : resolved.start
  const far = yarderAtEnd ? resolved.start : resolved.end
  const lengthM = distance(yarder, far)
  const headingDeg = bearingDeg(yarder, far)
  // A local tangent plane at the yarder: on a line of a few kilometres it departs from the great
  // circle by millimetres, far inside any tolerance it is used with.
  const cosLat = Math.cos(yarder[1] * RAD)
  const ux = Math.sin(headingDeg * RAD),
    uy = Math.cos(headingDeg * RAD)
  return {
    yarder,
    far,
    lengthM,
    headingDeg,
    yarderAtEnd,
    at: (stationM) => offsetCoordinate(yarder, headingDeg, stationM),
    stationOf: ([lng, lat]) => {
      const x = (lng - yarder[0]) * RAD * EARTH_RADIUS_M * cosLat,
        y = (lat - yarder[1]) * RAD * EARTH_RADIUS_M
      // Right of the line looking out from the yarder is positive; offsets are negative to the left.
      return { stationM: x * ux + y * uy, offsetM: x * uy - y * ux }
    },
    chartDistance: (stationM) => (yarderAtEnd ? lengthM - stationM : stationM),
  }
}
