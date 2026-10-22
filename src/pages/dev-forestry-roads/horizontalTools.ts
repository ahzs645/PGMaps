/**
 * Bulk horizontal-curve tools: give every corner a default radius, or the largest radius whose arc
 * stays within a tolerance of the pegged corner. Radii are then reduced where tangents are too short
 * to hold them, the way the engine needs them to fit (each trim inside its legs, adjacent trims
 * sharing a leg). Pure: no DOM or network access.
 */
import type { RoadPoint } from './types'

export type RadiusFitMode = { kind: 'radius'; radiusM: number } | { kind: 'tolerance'; toleranceM: number }
export interface RadiusFitReport {
  index: number
  /** Deflection angle at the corner, degrees. */
  deflectionDegrees: number
  requestedM: number
  radiusM: number
  limitedBy: 'requested' | 'tangents'
  belowMinimum: boolean
}

const R = 6371008.8
const RAD = Math.PI / 180
const FIT = 0.98

export function fitHorizontalRadii(
  points: RoadPoint[],
  mode: RadiusFitMode,
  { minRadiusM = 0, onlySharp = false }: { minRadiusM?: number; onlySharp?: boolean } = {},
): { points: RoadPoint[]; report: RadiusFitReport[] } {
  if (points.length < 3) return { points, report: [] }
  const [lng0, lat0] = points[0].coordinate
  const xy = points.map(({ coordinate: [lng, lat] }) => [
    (lng - lng0) * RAD * R * Math.cos(lat0 * RAD),
    (lat - lat0) * RAD * R,
  ])
  const legs = xy.slice(1).map((p, i) => Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]))
  const theta = points.map((_, i) => {
    if (i === 0 || i === points.length - 1) return 0
    const a = [xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]],
      b = [xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]]
    const cos = (a[0] * b[0] + a[1] * b[1]) / Math.max(1e-12, Math.hypot(...a) * Math.hypot(...b))
    return Math.acos(Math.max(-1, Math.min(1, cos)))
  })
  const touched = points.map((p, i) => i > 0 && i < points.length - 1 && theta[i] > 1e-5 && (!onlySharp || !p.radiusM))
  const requested = points.map((p, i) => {
    if (!touched[i]) return p.radiusM
    if (mode.kind === 'radius') return mode.radiusM
    // External distance E = R (sec(Δ/2) − 1): the arc's midpoint gap to the pegged corner.
    const external = 1 / Math.cos(theta[i] / 2) - 1
    return Math.min(10000, external > 1e-9 ? mode.toleranceM / external : 10000)
  })
  const trims = points.map((_, i) =>
    theta[i] > 1e-5 && theta[i] < Math.PI - 1e-4 ? requested[i] * Math.tan(theta[i] / 2) : 0,
  )
  // Each leg holds at most the two trims that meet on it.
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < legs.length; i++) {
      const used = trims[i] + trims[i + 1]
      if (used > legs[i] * FIT) {
        const scale = (legs[i] * FIT) / used
        if (touched[i]) trims[i] *= scale
        if (touched[i + 1]) trims[i + 1] *= scale
        // An untouched neighbour keeps its radius; the touched corner takes the whole squeeze.
        if (!touched[i] && touched[i + 1]) trims[i + 1] = Math.max(0, legs[i] * FIT - trims[i])
        if (touched[i] && !touched[i + 1]) trims[i] = Math.max(0, legs[i] * FIT - trims[i + 1])
      }
    }
  const report: RadiusFitReport[] = []
  const next = points.map((p, i) => {
    if (!touched[i]) return p
    const radius = Math.floor((trims[i] / Math.tan(theta[i] / 2)) * 10) / 10
    report.push({
      index: i,
      deflectionDegrees: theta[i] / RAD,
      requestedM: requested[i],
      radiusM: radius,
      limitedBy: radius < requested[i] - 0.1 ? 'tangents' : 'requested',
      belowMinimum: radius < minRadiusM - 1e-9,
    })
    return { ...p, radiusM: Math.max(0, radius) }
  })
  return { points: next, report }
}
