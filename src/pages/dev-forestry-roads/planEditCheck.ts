/**
 * Whether a plan edit (a point drag, a bend, a typed coordinate, pegs) leaves a road that can be
 * built. An edit is refused when it makes the road cross itself, or leaves a corner whose curve
 * would not fit even at the project's minimum radius. Only what the edit makes worse is refused:
 * a crossing or a corner the road already had never blocks another edit. Crossings are read on the
 * control line, not the fitted curves: each fillet stays inside the triangle of its corner, so the
 * fitted road can differ only where another leg passes inside that triangle. Free of DOM access.
 * Guide: docs/forestry-road-design/plan-edit-limits.md.
 */
import { horizontalCurveFits, type HorizontalCurveFit } from './engine'
import type { Alignment, Coordinate } from './types'

export interface PlanEditRefusal {
  kind: 'crossing' | 'curve'
  /** One sentence for the notice line: what was refused and why, with the remedy. */
  message: string
  /** A short form for the label beside the dragged handle. */
  label: string
  /** Where to mark it on the plan: the crossing, or the corner. */
  at: Coordinate
}

/** Fits the engine cannot round. `sharp` and `straight` have no curve to fit. */
const UNFITTED = new Set<HorizontalCurveFit['status']>(['tangent', 'overlap', 'reversal'])

const metres = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/** Proper crossings of two segments, endpoints included, in longitude/latitude (an affine frame). */
function segmentsCross(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): Coordinate | null {
  const rx = b[0] - a[0],
    ry = b[1] - a[1],
    sx = d[0] - c[0],
    sy = d[1] - c[1]
  const denom = rx * sy - ry * sx
  const qx = c[0] - a[0],
    qy = c[1] - a[1]
  const scale = Math.max(Math.hypot(rx, ry), Math.hypot(sx, sy))
  if (scale === 0) return null
  if (Math.abs(denom) <= 1e-12 * scale * scale) {
    // Parallel: a crossing only when collinear and overlapping, which is the road running back
    // along itself.
    if (Math.abs(qx * ry - qy * rx) > 1e-12 * scale * scale) return null
    const len = rx * rx + ry * ry
    if (len === 0) return null
    const t0 = (qx * rx + qy * ry) / len,
      t1 = t0 + (sx * rx + sy * ry) / len
    const lo = Math.max(0, Math.min(t0, t1)),
      hi = Math.min(1, Math.max(t0, t1))
    if (hi < lo) return null
    const t = (lo + hi) / 2
    return [a[0] + rx * t, a[1] + ry * t]
  }
  const t = (qx * sy - qy * sx) / denom,
    u = (qx * ry - qy * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return [a[0] + rx * t, a[1] + ry * t]
}

export interface SelfCrossing {
  /** 1-based point numbers of each crossing leg's start, the way points are numbered on the plan. */
  legs: [number, number]
  at: Coordinate
  /** The ids at each leg's ends, so the same crossing can be recognised before and after an edit. */
  key: string
}

/**
 * Every place the road's control line crosses itself. Neighbouring legs share a point and never
 * count. A sweep along longitude keeps it near-linear for the 2,000-point limit.
 */
export function selfCrossings(points: Alignment['points']): SelfCrossing[] {
  type Leg = { i: number; minX: number; maxX: number; minY: number; maxY: number }
  const legs: Leg[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i].coordinate, points[i + 1].coordinate]
    legs.push({
      i,
      minX: Math.min(a[0], b[0]),
      maxX: Math.max(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxY: Math.max(a[1], b[1]),
    })
  }
  legs.sort((p, q) => p.minX - q.minX)
  const found: SelfCrossing[] = []
  for (let m = 0; m < legs.length; m++) {
    const p = legs[m]
    for (let n = m + 1; n < legs.length && legs[n].minX <= p.maxX; n++) {
      const q = legs[n]
      if (Math.abs(p.i - q.i) < 2 || q.minY > p.maxY || q.maxY < p.minY) continue
      const [i, j] = p.i < q.i ? [p.i, q.i] : [q.i, p.i]
      const at = segmentsCross(
        points[i].coordinate,
        points[i + 1].coordinate,
        points[j].coordinate,
        points[j + 1].coordinate,
      )
      if (at)
        found.push({
          legs: [i + 1, j + 1],
          at,
          key: [points[i].id, points[i + 1].id, points[j].id, points[j + 1].id].join('|'),
        })
    }
  }
  return found.sort((p, q) => p.legs[0] - q.legs[0] || p.legs[1] - q.legs[1])
}

function fitsOf(alignment: Alignment): HorizontalCurveFit[] | null {
  try {
    return horizontalCurveFits(alignment)
  } catch {
    // An alignment the engine cannot compile is reported by the workspace's own validation.
    return null
  }
}

function curveRefusal(fit: HorizontalCurveFit, after: Alignment, minRadiusM: number): PlanEditRefusal {
  const point = after.points[fit.point - 1]
  const hairpin = ' For a hairpin, use Design → Add a switchback.'
  if (fit.status === 'reversal')
    return {
      kind: 'curve',
      at: point.coordinate,
      label: 'Turns back on itself',
      message: `Not applied: the road would turn back on itself at point ${fit.point}, where no curve can join the legs.${hairpin}`,
    }
  const radius = Math.min(fit.radiusM, minRadiusM)
  const room = Math.min(fit.backM, fit.aheadM)
  if (fit.status === 'overlap')
    return {
      kind: 'curve',
      at: point.coordinate,
      label: `Curves at ${fit.point} and ${fit.neighbourPoint} overlap`,
      message: `Not applied: at R ${metres(radius)} m the curves at points ${fit.point} and ${fit.neighbourPoint} would overlap on the ${metres(room)} m left between them. Keep the points farther apart or the angle smaller.${fit.deflectionDegrees > 90 ? hairpin : ''}`,
    }
  return {
    kind: 'curve',
    at: point.coordinate,
    label: `Curve at ${fit.point} needs ${metres(fit.tangentM)} m`,
    message: `Not applied: at point ${fit.point} an R ${metres(radius)} m curve needs ${metres(fit.tangentM)} m of straight each side, and the shorter leg has ${metres(room)} m. Keep the points farther apart or the angle smaller.${fit.deflectionDegrees > 90 ? hairpin : ''}`,
  }
}

/**
 * Null when `after` may replace `before`. `minRadiusM` is the project's minimum radius: a corner
 * whose entered radius no longer fits but the minimum would is allowed, and the point's own note
 * then gives the largest radius that fits.
 */
export function checkPlanEdit(before: Alignment, after: Alignment, minRadiusM: number): PlanEditRefusal | null {
  // Counted, not matched: a bend added to a leg that already crosses splits it, which renames the
  // crossing without adding one.
  const beforeCrossings = selfCrossings(before.points)
  const afterCrossings = selfCrossings(after.points)
  const known = new Set(beforeCrossings.map((c) => c.key))
  const crossing =
    afterCrossings.length > beforeCrossings.length
      ? (afterCrossings.find((c) => !known.has(c.key)) ?? afterCrossings[0])
      : undefined
  if (crossing)
    return {
      kind: 'crossing',
      at: crossing.at,
      label: 'Crosses the road',
      message: `Not applied: the road would cross itself between points ${crossing.legs[0]}–${crossing.legs[0] + 1} and ${crossing.legs[1]}–${crossing.legs[1] + 1}. A road that meets itself is two roads joined at a junction.`,
    }

  const afterFits = fitsOf(after)
  if (!afterFits) return null
  const beforeStatus = new Map((fitsOf(before) ?? []).map((fit) => [fit.pointId, fit.status]))
  const worse = afterFits.filter((fit) => UNFITTED.has(fit.status) && !UNFITTED.has(beforeStatus.get(fit.pointId)!))
  if (!worse.length) return null
  // Would those corners fit at the minimum radius? Only what still fails is refused.
  const ids = new Set(worse.map((fit) => fit.pointId))
  const trial: Alignment = {
    ...after,
    points: after.points.map((point) =>
      ids.has(point.id) ? { ...point, radiusM: Math.min(point.radiusM, Math.max(0, minRadiusM)) } : point,
    ),
  }
  const failing = (fitsOf(trial) ?? []).find((fit) => ids.has(fit.pointId) && UNFITTED.has(fit.status))
  return failing ? curveRefusal(failing, trial, minRadiusM) : null
}
