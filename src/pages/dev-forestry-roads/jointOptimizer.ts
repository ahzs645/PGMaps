/** Bounded coordinate descent over fitted horizontal controls and their designed profile. */
import { alignmentLength, analyzeRoad, distance, offsetCoordinate } from './engine'
import { hasCompleteCoverage } from './analysisResult'
import { optimizeVerticalProfileAsync, type VerticalOptimizationOptions } from './verticalOptimizer'
import type { Alignment, ContextFeature, Coordinate, RoadAnalysis, RoadSettings, TerrainSource } from './types'

export const MAX_JOINT_EVALUATIONS = 32
export const MAX_JOINT_MOVABLE_POINTS = 12
/** Largest movement box half-extent, across or along the road (m). */
export const MAX_JOINT_BOX_M = 500
/** Longest time limit a run may be given (s). */
export const MAX_JOINT_SECONDS = 3600
/** A move shortened to its box edge with less than this left is not tried (m). */
const MIN_BOXED_MOVE_M = 0.05
const BOX_TOLERANCE_M = 1e-3

/**
 * Where each interior point may go, as RoadEng's Horizontal Optimization limits it. Every field is
 * optional, and left out the search runs exactly as it did before these limits existed.
 */
export interface JointMovementLimits {
  /** Interior points that stay where they are, by id. Endpoints never move. */
  fixedPointIds?: readonly string[]
  /**
   * The farthest a point may end up across the road from where it started (m), measured square to
   * the chord between its neighbours as they were at the start. Absent or null: no limit.
   */
  acrossM?: number | null
  /** The same along the road (m). Absent or null: no limit. */
  alongM?: number | null
  /** True (the default) moves points across the road only; false also tries moves along it. */
  perpendicularOnly?: boolean
}
export interface JointEvaluation {
  score: number | null
  blockers?: string[]
}
export interface JointOptimizationOptions {
  stepM: number
  rounds: number
  maxEvaluations: number
  /** Which points may move and how far; see `JointMovementLimits`. */
  limits?: JointMovementLimits
  /**
   * Stops the descent once this many seconds have passed, with the best trial checked so far. The
   * start and its profile-only redesign are always checked. Absent or null: no time limit.
   */
  maxSeconds?: number | null
  /** Clock in milliseconds, for tests; defaults to `performance.now`. */
  now?: () => number
  profile: Partial<VerticalOptimizationOptions>
  /** Optional complete-access objective; null means infeasible/unpriced, never zero. */
  evaluate?: (alignment: Alignment, analysis: RoadAnalysis) => Promise<JointEvaluation> | JointEvaluation
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}
export interface JointOptimizationResult {
  alignment: Alignment
  initialScore: number | null
  score: number
  evaluations: { points: Alignment['points']; score: number | null; blockers: string[] }[]
  /** The evaluation budget or the time limit ended the search. */
  budgetLimited: boolean
  /** The time limit ended the search. */
  timeLimited: boolean
  objective: 'engineering' | 'complete-access'
}

const RAD = Math.PI / 180
const EARTH_M = 6371008.8
const limitSet = (value: number | null | undefined): value is number => value !== null && value !== undefined

/** The chord bearing from a point's neighbours (clockwise from north), or null where they coincide. */
function chordBearing(points: Alignment['points'], index: number): number | null {
  const before = points[index - 1].coordinate,
    after = points[index + 1].coordinate
  if (distance(before, after) < 0.01) return null
  // Written as the search always computed it, so its moves stay bit for bit what they were.
  const dy = after[1] - before[1],
    dx = (after[0] - before[0]) * Math.cos((before[1] * Math.PI) / 180)
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

/** A point's offset from `origin` across (right of `alongBearing` positive) and along the road (m). */
function boxOffset(origin: Coordinate, alongBearing: number, p: Coordinate) {
  const east = (p[0] - origin[0]) * RAD * EARTH_M * Math.cos(origin[1] * RAD),
    north = (p[1] - origin[1]) * RAD * EARTH_M,
    b = alongBearing * RAD
  return { across: east * Math.cos(b) - north * Math.sin(b), along: east * Math.sin(b) + north * Math.cos(b) }
}

/** The farthest the step schedule can carry a point in one direction: step × (1 + ½ + ¼ …). */
export function scheduleReachM(stepM: number, rounds: number): number {
  return stepM * (2 - 2 ** (1 - rounds))
}

function checkLimits(limits: JointMovementLimits | undefined) {
  for (const value of [limits?.acrossM, limits?.alongM])
    if (limitSet(value) && (!Number.isFinite(value) || value < 0 || value > MAX_JOINT_BOX_M))
      throw Error(`Joint refinement movement limits must be 0–${MAX_JOINT_BOX_M} m, or blank for no limit.`)
}

export interface JointMovementBox {
  pointId: string
  /** The point's place in the road (1 is the first interior point). */
  index: number
  movable: boolean
  /** Box centre: where the point starts. */
  centre: Coordinate
  /** Bearing of the box's along axis (the neighbours' chord), clockwise from north; null where they coincide. */
  alongBearing: number | null
  /** Half-extents (m): the set limit, else the step schedule's reach (along is 0 while moves are across only). */
  acrossM: number
  alongM: number
  /** Whether each half-extent is a set limit rather than the schedule's reach. */
  limited: { across: boolean; along: boolean }
  /** Closed ring oriented with the road; null for a fixed point or one whose neighbours coincide. */
  ring: Coordinate[] | null
}

/**
 * The box each interior point may move within, as the plan draws it. A side with no set limit is
 * drawn at the step schedule's reach, which is the farthest those moves can carry the point.
 */
export function movementBoxes(
  alignment: Alignment,
  options: { stepM: number; rounds: number; limits?: JointMovementLimits },
): JointMovementBox[] {
  const limits = options.limits ?? {}
  const fixed = new Set(limits.fixedPointIds ?? [])
  const reach =
    Number.isFinite(options.stepM) && options.rounds >= 1 ? scheduleReachM(options.stepM, options.rounds) : 0
  const perpendicularOnly = limits.perpendicularOnly !== false
  const acrossLimited = limitSet(limits.acrossM),
    alongLimited = limitSet(limits.alongM)
  const acrossM = acrossLimited ? Math.min(limits.acrossM!, reach) : reach
  const alongM = perpendicularOnly ? 0 : alongLimited ? Math.min(limits.alongM!, reach) : reach
  const boxes: JointMovementBox[] = []
  for (let index = 1; index < alignment.points.length - 1; index++) {
    const point = alignment.points[index]
    const movable = !fixed.has(point.id)
    const alongBearing = chordBearing(alignment.points, index)
    let ring: Coordinate[] | null = null
    if (movable && alongBearing !== null) {
      const corner = (a: number, l: number) =>
        offsetCoordinate(offsetCoordinate(point.coordinate, alongBearing + 90, a), alongBearing, l)
      ring = [corner(-acrossM, -alongM), corner(acrossM, -alongM), corner(acrossM, alongM), corner(-acrossM, alongM)]
      ring.push(ring[0])
    }
    boxes.push({
      pointId: point.id,
      index,
      movable,
      centre: point.coordinate,
      alongBearing,
      acrossM,
      alongM,
      limited: { across: acrossLimited, along: !perpendicularOnly && alongLimited },
      ring,
    })
  }
  return boxes
}

/**
 * The boxes as plan lines: `role` is `box` where a limit is set on either side, `reach` where the
 * schedule alone bounds it, and `fixed` for a small cross on a point that stays put.
 */
export function movementBoxFeatures(boxes: JointMovementBox[], crossM: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const box of boxes) {
    if (box.ring)
      features.push({
        type: 'Feature',
        properties: { role: box.limited.across || box.limited.along ? 'box' : 'reach', pointId: box.pointId },
        geometry: { type: 'LineString', coordinates: box.ring },
      })
    else if (!box.movable) {
      const at = box.centre,
        turn = box.alongBearing ?? 0
      features.push({
        type: 'Feature',
        properties: { role: 'fixed', pointId: box.pointId },
        geometry: {
          type: 'MultiLineString',
          coordinates: [45, 135].map((angle) => [
            offsetCoordinate(at, turn + angle, crossM),
            offsetCoordinate(at, turn + angle + 180, crossM),
          ]),
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Endpoints stay fixed. Each trial keeps templates, station assumptions, rates and controls,
 * recomputes the profile and full engineering analysis, then asks the optional network ledger.
 * This local search makes no global-optimality claim and never substitutes a base estimate for
 * an unpriced complete-access candidate.
 */
export async function refinePlanAndProfile(
  alignment: Alignment,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  options: Partial<JointOptimizationOptions> = {},
): Promise<JointOptimizationResult> {
  const o = { stepM: 10, rounds: 2, maxEvaluations: 20, profile: { objective: 'total' as const }, ...options }
  if (
    !Number.isFinite(o.stepM) ||
    o.stepM < 0.1 ||
    o.stepM > 100 ||
    !Number.isInteger(o.rounds) ||
    o.rounds < 1 ||
    o.rounds > 5 ||
    !Number.isInteger(o.maxEvaluations) ||
    o.maxEvaluations < 1 ||
    o.maxEvaluations > MAX_JOINT_EVALUATIONS
  )
    throw Error('Joint refinement needs a 0.1–100 m step, 1–5 rounds and 1–32 evaluations.')
  checkLimits(o.limits)
  if (
    limitSet(o.maxSeconds) &&
    (!Number.isFinite(o.maxSeconds) || o.maxSeconds < 1 || o.maxSeconds > MAX_JOINT_SECONDS)
  )
    throw Error(`Joint refinement's time limit must be 1–${MAX_JOINT_SECONDS} s, or blank for none.`)
  if (alignment.points.length < 3) throw Error('Add an interior horizontal control before joint refinement.')
  const fixed = new Set(o.limits?.fixedPointIds ?? [])
  const movable = alignment.points.slice(1, -1).filter((p) => !fixed.has(p.id)).length
  if (!movable) throw Error('Tick at least one interior control to move before joint refinement.')
  if (movable > MAX_JOINT_MOVABLE_POINTS)
    throw Error('Joint refinement supports at most 12 interior controls; simplify or split the road.')
  const perpendicularOnly = o.limits?.perpendicularOnly !== false
  const acrossLimit = limitSet(o.limits?.acrossM) ? o.limits.acrossM : null,
    alongLimit = !perpendicularOnly && limitSet(o.limits?.alongM) ? o.limits.alongM : null
  // Each box is fixed where the search starts: the point's own place, square to its neighbours' chord.
  const frames = alignment.points.map((_, index) =>
    index === 0 || index === alignment.points.length - 1 ? null : chordBearing(alignment.points, index),
  )
  const now = o.now ?? (() => performance.now())
  const deadline = limitSet(o.maxSeconds) ? now() + o.maxSeconds * 1000 : null
  let timeLimited = false
  const evaluations: JointOptimizationResult['evaluations'] = []
  const visited = new Set<string>()
  let best: Alignment | null = null,
    bestScore = Infinity,
    initialScore: number | null = null
  const aborted = () => {
    if (o.signal?.aborted) throw new DOMException('Joint refinement cancelled', 'AbortError')
  }
  const evaluate = async (raw: Alignment, refit: boolean) => {
    aborted()
    if (evaluations.length >= o.maxEvaluations || timeLimited) return false
    // The start and its profile-only redesign are always checked; the descent stops at the time limit.
    if (deadline !== null && evaluations.length >= 2 && now() >= deadline) {
      timeLimited = true
      return false
    }
    const signature = JSON.stringify(raw.points.map((p) => [...p.coordinate, p.radiusM, p.spiralM]))
    if (visited.has(signature)) return false
    visited.add(signature)
    await o.yieldControl?.()
    aborted()
    const candidate = structuredClone(raw)
    delete candidate.fullCostRecord
    const blockers: string[] = []
    let score: number | null = null
    try {
      const length = alignmentLength(candidate)
      // In slices, so a trial on a long road cannot hold up Cancel for the whole of its profile search.
      if (refit)
        candidate.vertical = (
          await optimizeVerticalProfileAsync(
            candidate,
            length,
            terrain,
            settings,
            { ...o.profile, context },
            { signal: o.signal },
          )
        ).vertical
      const analysis = analyzeRoad(candidate, terrain, settings, context, {
        referenceSurfaces: o.profile.referenceSurfaces,
        verticalReference: o.profile.verticalReference,
        sharedCrossingCosts: o.profile.sharedCrossingCosts,
        gradeStandards: o.profile.gradeStandards,
      })
      if (!hasCompleteCoverage(analysis)) blockers.push('Incomplete terrain/daylight coverage.')
      if (analysis.crossingEstimate?.complete === false)
        blockers.push('Stream crossing estimates need review or prices.')
      if (analysis.engineering && !analysis.engineering.complete)
        blockers.push('The engineering material, haul or structure prescription is incomplete or infeasible.')
      if (analysis.maxGradePercent > settings.maxGradePercent + 1e-6)
        blockers.push('Formation exceeds the entered maximum grade.')
      blockers.push(...(analysis.verticalChecks ?? []).map((c) => c.message))
      const flags = [...new Set(analysis.stations.flatMap((s) => s.flags))]
      blockers.push(
        ...flags.filter((f) =>
          /Sharp horizontal PI|Radius below|requires .*superelevation|Avoidance area|outside the widening table/i.test(
            f,
          ),
        ),
      )
      if (analysis.warnings.some((w) => /does not fit|overlaps an adjacent curve|longer than its deflection/i.test(w)))
        blockers.push('Requested fitted geometry does not fit its controls.')
      if (!blockers.length) {
        const external = o.evaluate ? await o.evaluate(candidate, analysis) : { score: analysis.estimatedCost }
        aborted()
        score = external.score
        blockers.push(...(external.blockers ?? []))
        if (score === null) blockers.push('The complete objective is infeasible or unpriced.')
        else if (!Number.isFinite(score) || score < 0) throw Error('Refinement evaluator returned an invalid cost.')
        if (blockers.length) score = null
      }
    } catch (cause) {
      if (o.signal?.aborted) throw cause
      score = null
      blockers.push(cause instanceof Error ? cause.message : String(cause))
    }
    evaluations.push({ points: structuredClone(candidate.points), score, blockers })
    if (evaluations.length === 1) initialScore = score
    if (score !== null && score < bestScore - 1e-6) {
      best = candidate
      bestScore = score
      return true
    }
    return false
  }
  await evaluate(alignment, false)
  // Evaluate a profile-only improvement first, even though the plan signature is the same.
  visited.clear()
  await evaluate(alignment, true)
  /**
   * Where a move of `distanceM` on `bearing` takes point `index`, shortened to its box edge when it
   * would leave the box; null when nothing is left of it. With no limits set, the plain move.
   */
  const boxedMove = (from: Coordinate, index: number, bearing: number, distanceM: number): Coordinate | null => {
    const moved = offsetCoordinate(from, bearing, distanceM)
    const frame = frames[index]
    if (acrossLimit === null && alongLimit === null) return moved
    // A control whose neighbours met where the run started has no box to keep it in: it stays.
    if (frame === null) return null
    const origin = alignment.points[index].coordinate
    const start = boxOffset(origin, frame, from),
      end = boxOffset(origin, frame, moved)
    let share = 1
    for (const [limit, a, b] of [
      [acrossLimit, start.across, end.across],
      [alongLimit, start.along, end.along],
    ] as const) {
      if (limit === null || Math.abs(b) <= limit) continue
      share = Math.min(share, ((b > 0 ? limit : -limit) - a) / (b - a))
    }
    if (share >= 1) return moved
    if (share * Math.abs(distanceM) < MIN_BOXED_MOVE_M) return null
    const shortened = offsetCoordinate(from, bearing, distanceM * share)
    const at = boxOffset(origin, frame, shortened)
    const inside = (limit: number | null, value: number) => limit === null || Math.abs(value) <= limit + BOX_TOLERANCE_M
    return inside(acrossLimit, at.across) && inside(alongLimit, at.along) ? shortened : null
  }
  const stopped = () => evaluations.length >= o.maxEvaluations || timeLimited
  let centre = best ?? alignment
  for (let round = 0; round < o.rounds; round++) {
    let improved = false
    const step = o.stepM / 2 ** round
    for (let index = 1; index < alignment.points.length - 1; index++) {
      if (stopped()) break
      if (fixed.has(alignment.points[index].id)) continue
      const chord = chordBearing(centre.points, index)
      if (chord === null) continue
      const perpendicular = chord + 90
      // Across the road first, as before; then along it when that is allowed.
      const moves = perpendicularOnly ? [perpendicular] : [perpendicular, chord]
      for (const bearing of moves)
        for (const sign of [-1, 1]) {
          const to = boxedMove(centre.points[index].coordinate, index, bearing, sign * step)
          if (!to) continue
          const trial = structuredClone(centre)
          trial.points[index].coordinate = to
          if (await evaluate(trial, true)) {
            centre = best!
            improved = true
          }
        }
    }
    if (stopped()) break
    if (!improved && step <= 0.1) break
  }
  if (!best)
    throw Error(
      `No complete candidate passed joint refinement: ${evaluations
        .flatMap((e) => e.blockers)
        .slice(0, 3)
        .join(' ')}`,
    )
  return {
    alignment: best,
    initialScore,
    score: bestScore,
    evaluations,
    budgetLimited: evaluations.length >= o.maxEvaluations || timeLimited,
    timeLimited,
    objective: o.evaluate ? 'complete-access' : 'engineering',
  }
}
