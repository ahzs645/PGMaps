/** Bounded coordinate descent over fitted horizontal controls and their designed profile. */
import { alignmentLength, analyzeRoad, distance, offsetCoordinate } from './engine'
import { hasCompleteCoverage } from './analysisResult'
import { optimizeVerticalProfile, type VerticalOptimizationOptions } from './verticalOptimizer'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'

export const MAX_JOINT_EVALUATIONS = 32
export const MAX_JOINT_MOVABLE_POINTS = 12
export interface JointEvaluation {
  score: number | null
  blockers?: string[]
}
export interface JointOptimizationOptions {
  stepM: number
  rounds: number
  maxEvaluations: number
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
  budgetLimited: boolean
  objective: 'engineering' | 'complete-access'
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
  if (alignment.points.length < 3) throw Error('Add an interior horizontal control before joint refinement.')
  if (alignment.points.length - 2 > MAX_JOINT_MOVABLE_POINTS)
    throw Error('Joint refinement supports at most 12 interior controls; simplify or split the road.')
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
    if (evaluations.length >= o.maxEvaluations) return false
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
      if (refit)
        candidate.vertical = optimizeVerticalProfile(candidate, length, terrain, settings, {
          ...o.profile,
          context,
        }).vertical
      const analysis = analyzeRoad(candidate, terrain, settings, context, {
        referenceSurfaces: o.profile.referenceSurfaces,
        verticalReference: o.profile.verticalReference,
      })
      if (!hasCompleteCoverage(analysis)) blockers.push('Incomplete terrain/daylight coverage.')
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
  let centre = best ?? alignment
  for (let round = 0; round < o.rounds; round++) {
    let improved = false
    const step = o.stepM / 2 ** round
    for (let index = 1; index < alignment.points.length - 1; index++) {
      if (evaluations.length >= o.maxEvaluations) break
      const before = centre.points[index - 1].coordinate,
        after = centre.points[index + 1].coordinate
      const dy = after[1] - before[1],
        dx = (after[0] - before[0]) * Math.cos((before[1] * Math.PI) / 180)
      if (distance(before, after) < 0.01) continue
      const perpendicular = (Math.atan2(dx, dy) * 180) / Math.PI + 90
      for (const sign of [-1, 1]) {
        const trial = structuredClone(centre)
        trial.points[index].coordinate = offsetCoordinate(centre.points[index].coordinate, perpendicular, sign * step)
        if (await evaluate(trial, true)) {
          centre = best!
          improved = true
        }
      }
    }
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
    budgetLimited: evaluations.length >= o.maxEvaluations,
    objective: o.evaluate ? 'complete-access' : 'engineering',
  }
}
