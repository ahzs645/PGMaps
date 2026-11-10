/**
 * Polyline to alignment: turns a line of many vertices (a found route, an imported or sketched
 * polyline) into a few intersection points with a circular curve at each, staying within a stated
 * distance of the source line and never fitting a curve tighter than a stated radius.
 *
 * It tries several point reductions, from the fewest points the deviation allows to nearly all of
 * them, and keeps the one that leaves the fewest corners without a curve, then the fewest points.
 * Fewer points give longer tangents and room for larger curves; more points follow the line more
 * closely where a corner is too sharp to round inside the deviation. Neighbouring corners that turn
 * the same way are then merged into one intersection point where their tangents meet, when a single
 * curve there still follows the line: that is how a bend drawn as a run of short chords becomes one
 * curve. A corner that cannot take the minimum radius either way stays sharp and is counted, never
 * given a smaller curve. A corner is any point the road engine would flag without a curve, however
 * slight its turn, so the count is the number of sharp PIs the engine reports on the result.
 *
 * The reported deviation is measured on the fitted centreline, both ways, not assumed from the
 * tolerances. Pure: no DOM, network or terrain access.
 */
import { corridorFrame, MIN_SEARCH_RADIUS_M } from './corridorOptimizer'
import type { Coordinate } from './types'

export interface PolylineFitOptions {
  /** Farthest the fitted centreline may sit from the source line, and the source from it, m. */
  maxDeviationM: number
  /** Smallest radius a fitted curve may take, m. 0 means no minimum was entered: see `fittedMinimumRadius`. */
  minRadiusM: number
  /** Largest radius fitted; beyond it a curve changes nothing a plan shows. */
  maxRadiusM?: number
}
export interface PolylineFitResult {
  points: { coordinate: Coordinate; radiusM: number }[]
  sourcePoints: number
  fittedPoints: number
  curves: number
  /** Corners left sharp: no curve of the minimum radius fits there inside the deviation. */
  sharpCorners: number
  smallestRadiusM: number | null
  /** Largest measured distance between the source line and the fitted centreline, m. */
  maxDeviationM: number
  sourceLengthM: number
  fittedLengthM: number
}

type XY = [number, number]
export const MIN_FIT_DEVIATION_M = 0.1
export const MAX_FIT_DEVIATION_M = 500
export const MAX_FIT_SOURCE_POINTS = 5000
/** A curve tighter than this is not worth having over a sharp corner; it is the least the corridor search takes. */
export const SMALLEST_CURVE_M = MIN_SEARCH_RADIUS_M
/**
 * The radius curves are fitted down to. A minimum radius of 0 means none was entered, and a fit then
 * goes no tighter than `SMALLEST_CURVE_M`: a smaller curve is a sharp corner in all but name.
 */
export const fittedMinimumRadius = (minRadiusM: number) => (minRadiusM > 0 ? minRadiusM : SMALLEST_CURVE_M)
/** Tangents may use this share of a leg, as in `horizontalTools.ts`, so the engine's own fit accepts them. */
const FIT = 0.98
/**
 * The turn at which the road engine reads a point as a corner, and flags it sharp when it has no
 * curve: `compile` in `engine.ts` compares the legs' unit vectors, cos Δ < 1 − 1e-8, about 0.008°.
 * A larger figure here left slight bends without a curve and uncounted, and the engine then flagged
 * each one as a sharp PI on a road reported to have none.
 */
const STRAIGHT = Math.acos(1 - 1e-8)
/** Shares of the deviation spent on dropping points, fewest points first; the rest goes to the curves. */
const REDUCTIONS = [1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.1, 0.04, 0]
const SAMPLE_M = 1
/** Two corners are merged into one curve only up to this much turn between them. */
const MAX_MERGED_TURN = (120 * Math.PI) / 180

const length = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])
function toSegment(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    size = dx * dx + dy * dy
  const t = size ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / size)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
/** Largest distance from the points of `from` to the line `to`, both sampled closely enough to trust. */
function farthest(from: XY[], to: XY[]) {
  let worst = 0
  for (const p of from) {
    let near = Infinity
    for (let i = 1; i < to.length && near > 0; i++) near = Math.min(near, toSegment(p, to[i - 1], to[i]))
    worst = Math.max(worst, near)
  }
  return worst
}
const densify = (line: XY[], step: number) =>
  line.flatMap((p, i) => {
    if (!i) return [p]
    const a = line[i - 1],
      n = Math.max(1, Math.ceil(length(a, p) / step))
    return Array.from(
      { length: n },
      (_, k): XY => [a[0] + ((p[0] - a[0]) * (k + 1)) / n, a[1] + ((p[1] - a[1]) * (k + 1)) / n],
    )
  })

/** Signed turn from the leg a→b to the leg b→c, radians; positive to the left. */
const turnAt = (a: XY, b: XY, c: XY) => {
  const inward = Math.atan2(b[1] - a[1], b[0] - a[0]),
    outward = Math.atan2(c[1] - b[1], c[0] - b[0])
  return Math.atan2(Math.sin(outward - inward), Math.cos(outward - inward))
}
/** Where the line from a through b meets the line from d back through c, when that is past both b and c. */
function tangentsMeet(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = [b[0] - a[0], b[1] - a[1]],
    q = [c[0] - d[0], c[1] - d[1]],
    w = [d[0] - a[0], d[1] - a[1]]
  const cross = r[0] * q[1] - r[1] * q[0]
  if (Math.abs(cross) < 1e-9) return null
  const s = (w[0] * q[1] - w[1] * q[0]) / cross,
    u = (w[0] * r[1] - w[1] * r[0]) / cross
  return s < 1 - 1e-9 || u < 1 - 1e-9 ? null : [a[0] + s * r[0], a[1] + s * r[1]]
}

/** Douglas–Peucker: the indexes kept so every dropped vertex is within `tolerance` of the kept line. */
function reduce(xy: XY[], tolerance: number) {
  const keep = new Uint8Array(xy.length)
  keep[0] = keep[xy.length - 1] = 1
  const stack: [number, number][] = [[0, xy.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1,
      far = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = toSegment(xy[i], xy[a], xy[b])
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (worst < 0) continue
    keep[worst] = 1
    stack.push([a, worst], [worst, b])
  }
  return [...keep.keys()].filter((i) => keep[i])
}

/** The fitted centreline as a closely sampled line: tangents, and an arc at each curved corner. */
function centreline(ips: XY[], radii: number[]) {
  const line: XY[] = [ips[0]]
  for (let i = 1; i < ips.length - 1; i++) {
    const before = ips[i - 1],
      at = ips[i],
      after = ips[i + 1]
    const inward = Math.atan2(at[1] - before[1], at[0] - before[0]),
      outward = Math.atan2(after[1] - at[1], after[0] - at[0])
    const turn = Math.atan2(Math.sin(outward - inward), Math.cos(outward - inward))
    const radius = radii[i]
    if (!(radius > 0) || Math.abs(turn) < 1e-9) {
      line.push(at)
      continue
    }
    const trim = radius * Math.tan(Math.abs(turn) / 2),
      side = Math.sign(turn)
    const start: XY = [at[0] - Math.cos(inward) * trim, at[1] - Math.sin(inward) * trim]
    const centre: XY = [start[0] - Math.sin(inward) * radius * side, start[1] + Math.cos(inward) * radius * side]
    const from = Math.atan2(start[1] - centre[1], start[0] - centre[0])
    const steps = Math.max(2, Math.ceil((radius * Math.abs(turn)) / SAMPLE_M))
    for (let k = 0; k <= steps; k++) {
      const angle = from + (turn * k) / steps
      line.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius])
    }
  }
  line.push(ips[ips.length - 1])
  return line
}

export function fitPolylineAlignment(coordinates: Coordinate[], options: PolylineFitOptions): PolylineFitResult {
  const { maxDeviationM } = options
  if (!Number.isFinite(maxDeviationM) || maxDeviationM < MIN_FIT_DEVIATION_M || maxDeviationM > MAX_FIT_DEVIATION_M)
    throw Error(`Use a maximum deviation of ${MIN_FIT_DEVIATION_M}–${MAX_FIT_DEVIATION_M} m.`)
  if (!Number.isFinite(options.minRadiusM) || options.minRadiusM < 0)
    throw Error('Use a minimum radius of 0 m or more; 0 sets no minimum.')
  const minRadiusM = fittedMinimumRadius(options.minRadiusM)
  // A minimum above the usual ceiling is still a minimum: fit at it rather than refuse the line.
  const maxRadiusM = options.maxRadiusM ?? Math.max(1000, minRadiusM)
  if (!Number.isFinite(maxRadiusM) || maxRadiusM < minRadiusM)
    throw Error('The largest radius to fit must be at least the minimum radius.')
  if (coordinates.length < 2) throw Error('A line needs at least two points.')
  if (coordinates.length > MAX_FIT_SOURCE_POINTS)
    throw Error(
      `Lines of more than ${MAX_FIT_SOURCE_POINTS.toLocaleString('en-CA')} points are not fitted; thin the line first.`,
    )
  if (!coordinates.every((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])))
    throw Error('Every point needs a longitude and a latitude.')
  const frame = corridorFrame(coordinates[0])
  const all = coordinates.map((p) => frame.toXY([p[0], p[1]]) as XY)
  // Repeated points have no direction; the ends are kept whatever lies beside them.
  const source = all.filter((p, i) => i === 0 || i === all.length - 1 || length(p, all[i - 1]) > 0.01)
  const sourceLengthM = source.slice(1).reduce((sum, p, i) => sum + length(source[i], p), 0)
  const sourceSamples = densify(source, SAMPLE_M)

  const candidate = (share: number) => {
    const kept = reduce(source, maxDeviationM * share)
    const ips = kept.map((i) => source[i])
    const legs = ips.slice(1).map((p, i) => length(ips[i], p))
    // How far the source strays from each kept leg: what the points already dropped have used up.
    const strayed = kept.slice(1).map((end, k) => {
      let far = 0
      for (let i = kept[k] + 1; i < end; i++) far = Math.max(far, toSegment(source[i], ips[k], ips[k + 1]))
      return far
    })
    const turns = ips.map((at, i) => {
      if (i === 0 || i === ips.length - 1) return 0
      const a = Math.atan2(at[1] - ips[i - 1][1], at[0] - ips[i - 1][0]),
        b = Math.atan2(ips[i + 1][1] - at[1], ips[i + 1][0] - at[0])
      return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))
    })
    const corner = turns.map((turn) => turn >= STRAIGHT && turn < Math.PI - 1e-3)
    const half = turns.map((turn) => Math.tan(turn / 2))
    // The arc's midpoint sits E = R (sec(Δ/2) − 1) inside the corner.
    const wanted = turns.map((turn, i) => {
      if (!corner[i]) return 0
      const room = maxDeviationM - Math.max(strayed[i - 1], strayed[i])
      const external = 1 / Math.cos(turn / 2) - 1
      return Math.min(maxRadiusM, room > 0 ? room / external : 0)
    })
    const least = turns.map((_, i) => (corner[i] ? minRadiusM * half[i] : 0))
    const trims = wanted.map((radius, i) => radius * half[i])
    // Two corners share the leg between them. Each keeps the tangent its minimum radius needs, and
    // what is left of the leg is split by how much more each asked for.
    for (let pass = 0; pass < 4; pass++)
      for (let i = 0; i < legs.length; i++) {
        const room = legs[i] * FIT,
          used = trims[i] + trims[i + 1]
        if (used <= room) continue
        const a = Math.min(trims[i], least[i]),
          b = Math.min(trims[i + 1], least[i + 1])
        if (a + b >= room) {
          trims[i] *= room / used
          trims[i + 1] *= room / used
          continue
        }
        const spare = (room - a - b) / (used - a - b)
        trims[i] = a + (trims[i] - a) * spare
        trims[i + 1] = b + (trims[i + 1] - b) * spare
      }
    // Radii are whole tenths of a metre, rounded down, but never below a minimum that is not one.
    const radii = trims.map((trim, i) => {
      if (!corner[i]) return 0
      const radius = trim / half[i]
      return radius >= minRadiusM - 1e-6 ? Math.max(minRadiusM, Math.floor(radius * 10 + 1e-6) / 10) : 0
    })
    // Each point stands for a stretch of the source line; a merged point stands for two.
    return { ips, radii, spans: kept.map((i): [number, number] => [i, i]) }
  }
  type Fit = ReturnType<typeof candidate>
  /** One curve where two neighbouring corners turn the same way, for as long as it still follows the line. */
  const merged = (fit: Fit): Fit => {
    const ips = [...fit.ips],
      radii = [...fit.radii],
      spans = [...fit.spans]
    const trim = (i: number) =>
      i > 0 && i < ips.length - 1 && radii[i] > 0
        ? radii[i] * Math.tan(Math.abs(turnAt(ips[i - 1], ips[i], ips[i + 1])) / 2)
        : 0
    for (let i = 1; i + 2 < ips.length; ) {
      const a = ips[i - 1],
        b = ips[i],
        c = ips[i + 1],
        d = ips[i + 2]
      const first = turnAt(a, b, c),
        second = turnAt(b, c, d),
        turn = Math.abs(first + second)
      const meet =
        Math.abs(first) >= STRAIGHT && Math.abs(second) >= STRAIGHT && first * second > 0 && turn <= MAX_MERGED_TURN
          ? tangentsMeet(a, b, c, d)
          : null
      if (!meet) {
        i++
        continue
      }
      // The curve that passes where the source line comes nearest the new corner, held to the limits.
      const from = spans[i][0],
        to = spans[i + 1][1]
      let gap = Infinity
      for (let k = from; k < to; k++) gap = Math.min(gap, toSegment(meet, source[k], source[k + 1]))
      const radius = Math.max(
        minRadiusM,
        Math.floor(Math.min(maxRadiusM, gap / (1 / Math.cos(turn / 2) - 1)) * 10) / 10,
      )
      const tangent = radius * Math.tan(turn / 2)
      const piece = centreline([a, meet, d], [0, radius, 0])
      const around = source.slice(spans[i - 1][1], spans[i + 2][0] + 1)
      const fits =
        tangent + trim(i - 1) <= length(a, meet) * FIT &&
        tangent + trim(i + 2) <= length(meet, d) * FIT &&
        farthest(piece.slice(1, -1), around) <= maxDeviationM &&
        farthest(densify(source.slice(from, to + 1), SAMPLE_M), piece) <= maxDeviationM
      if (!fits) {
        i++
        continue
      }
      ips.splice(i, 2, meet)
      radii.splice(i, 2, radius)
      spans.splice(i, 2, [from, to])
      // The merged corner may now merge with the one before it.
      i = Math.max(1, i - 1)
    }
    return { ips, radii, spans }
  }
  const sharpIn = (fit: Fit) =>
    fit.ips.filter(
      (at, i) =>
        i > 0 &&
        i < fit.ips.length - 1 &&
        !fit.radii[i] &&
        Math.abs(turnAt(fit.ips[i - 1], at, fit.ips[i + 1])) >= STRAIGHT,
    ).length
  const tried = REDUCTIONS.map(candidate)
    .flatMap((fit) => [merged(fit), fit])
    .map((fit, order) => ({ ...fit, sharp: sharpIn(fit), order }))
    .sort((a, b) => a.sharp - b.sharp || a.ips.length - b.ips.length || a.order - b.order)
  let chosen: ((typeof tried)[number] & { fitted: XY[]; deviation: number }) | null = null
  for (const fit of tried) {
    const fitted = centreline(fit.ips, fit.radii)
    const deviation = Math.max(farthest(fitted, source), farthest(sourceSamples, fitted))
    // Sampling leaves both lines a fraction of a step short of their true distance.
    if (deviation > maxDeviationM + 0.05) continue
    chosen = { ...fit, fitted, deviation }
    break
  }
  // Keeping every point with no curves is the source line itself.
  if (!chosen) {
    const fit = candidate(0)
    const sharp = { ...fit, radii: fit.radii.map(() => 0) }
    chosen = { ...sharp, sharp: sharpIn(sharp), order: 0, fitted: fit.ips, deviation: 0 }
  }
  const curved = chosen.radii.filter((radius) => radius > 0)
  return {
    points: chosen.ips.map((p, i) => ({
      coordinate:
        i === 0
          ? [...coordinates[0]]
          : i === chosen.ips.length - 1
            ? [...coordinates[coordinates.length - 1]]
            : frame.fromXY(p),
      radiusM: chosen.radii[i],
    })) as PolylineFitResult['points'],
    sourcePoints: coordinates.length,
    fittedPoints: chosen.ips.length,
    curves: curved.length,
    sharpCorners: chosen.sharp,
    smallestRadiusM: curved.length ? Math.min(...curved) : null,
    maxDeviationM: chosen.deviation,
    sourceLengthM,
    fittedLengthM: chosen.fitted.slice(1).reduce((sum, p, i) => sum + length(chosen.fitted[i], p), 0),
  }
}

/** "43 points → 9, 7 curves of 35 m or more, at most 4.2 m from the line": the result in one sentence. */
export function describePolylineFit(fit: PolylineFitResult, limits: PolylineFitOptions) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const curves = fit.curves
    ? `${plural(fit.curves, 'curve')}, the tightest ${fit.smallestRadiusM!.toFixed(1)} m`
    : 'no curves'
  // With no minimum entered there is no radius to lower: the fit already went to the smallest curve it draws.
  const sharp = fit.sharpCorners
    ? ` ${plural(fit.sharpCorners, 'corner')} could not take a ${fittedMinimumRadius(limits.minRadiusM)} m curve within ${limits.maxDeviationM} m and ${fit.sharpCorners === 1 ? 'stays' : 'stay'} sharp: allow more deviation${limits.minRadiusM > 0 ? ' or a smaller radius' : ''}.`
    : ''
  return (
    `${plural(fit.sourcePoints, 'point')} reduced to ${fit.fittedPoints} with ${curves}. ` +
    `The line moved at most ${fit.maxDeviationM.toFixed(1)} m (limit ${limits.maxDeviationM} m); ` +
    `length ${Math.round(fit.sourceLengthM).toLocaleString('en-CA')} → ${Math.round(fit.fittedLengthM).toLocaleString('en-CA')} m.` +
    sharp
  )
}
