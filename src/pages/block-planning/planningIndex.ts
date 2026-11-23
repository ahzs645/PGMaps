/**
 * A planning index over the schedules, in Index Lab's manner: a few measured indicators per
 * schedule, each scaled across the schedules from worst (0) to best (1), weighted and averaged
 * to 0–100. It ranks options for a planner's discussion of trade-offs between the patch
 * objective and timber; it is **not a legal test**. The order sets a trend toward each class's
 * target and no score, and nothing here feeds a review, a pathway or a finding.
 *
 * DOM- and network-free.
 */
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { periodYears, scheduleHarvests, type Plan } from './plan'
import type { PlanAnalysis } from './planAnalysis'

export const INDEX_INDICATORS = [
  {
    id: 'targetDistance',
    label: 'Distance from the Table 7 targets',
    unit: 'points',
    better: 'lower',
    explain: 'The four classes’ distances from their targets added, averaged over the periods with young forest.',
  },
  {
    id: 'movedAway',
    label: 'Periods with a class moving away',
    unit: 'periods',
    better: 'lower',
    explain: 'Five-year periods in which any class moved farther from its target.',
  },
  {
    id: 'earlyArea',
    label: 'Area cut in the first ten years',
    unit: 'ha',
    better: 'higher',
    explain: 'Gross area of the blocks the schedule cuts in its first ten years: a stand-in for timely harvest.',
  },
  {
    id: 'totalArea',
    label: 'Area cut over the horizon',
    unit: 'ha',
    better: 'higher',
    explain: 'Gross area the schedule cuts over the fifty years.',
  },
] as const
export type IndicatorId = (typeof INDEX_INDICATORS)[number]['id']
export type IndexWeights = Record<IndicatorId, number>
export const DEFAULT_INDEX_WEIGHTS: IndexWeights = { targetDistance: 1, movedAway: 1, earlyArea: 1, totalArea: 1 }
export const MAX_INDEX_WEIGHT = 5

/** Each schedule's raw indicators. Null where the calculation gives no value. */
export function indicatorValues(plan: Plan, result: PlanAnalysis): Record<string, Record<IndicatorId, number | null>> {
  const start = plan.area.startYear
  const last = periodYears(start).at(-1)!
  return Object.fromEntries(
    result.runs.map((run) => {
      const distances = run.periods
        .filter((p) => p.totalHa > 0 && p.classes.every((c) => c.percent !== null))
        .map((p) => p.classes.reduce((sum, c) => sum + Math.abs(c.percent! - c.target), 0))
      const harvests = scheduleHarvests(plan, run.schedule)
      const area = (until: number) =>
        harvests
          .filter((h) => h.year >= start && h.year < until)
          .reduce((sum, h) => sum + blockAreaHa(h.shape.geometry), 0)
      return [
        run.schedule,
        {
          targetDistance: distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : null,
          movedAway: run.movedAway.filter((v) => v === true).length,
          earlyArea: area(start + 10),
          totalArea: area(last + 1),
        },
      ]
    }),
  )
}

export interface IndexPart {
  indicator: IndicatorId
  raw: number | null
  /** 0 worst to 1 best among the schedules; 0.5 where every schedule is the same. */
  scaled: number | null
  weight: number
}

export interface IndexRow {
  schedule: string
  score: number | null
  parts: IndexPart[]
}

/**
 * Every schedule's index, best first. An indicator any schedule lacks is left out for all, so the
 * schedules are always scored on the same terms.
 */
export function planningIndex(plan: Plan, result: PlanAnalysis, weights: IndexWeights = DEFAULT_INDEX_WEIGHTS) {
  const values = indicatorValues(plan, result)
  const schedules = Object.keys(values)
  const usable = INDEX_INDICATORS.filter((ind) => schedules.every((s) => values[s][ind.id] !== null))
  const left = INDEX_INDICATORS.filter((ind) => !usable.includes(ind)).map((ind) => ind.id)
  const scaled = (ind: (typeof INDEX_INDICATORS)[number], v: number | null) => {
    if (v === null || !usable.includes(ind)) return null
    const all = schedules.map((s) => values[s][ind.id]!)
    const min = Math.min(...all),
      max = Math.max(...all)
    if (max - min < 1e-9) return 0.5
    return ind.better === 'lower' ? (max - v) / (max - min) : (v - min) / (max - min)
  }
  const rows: IndexRow[] = schedules.map((schedule) => {
    const parts = INDEX_INDICATORS.map((ind) => ({
      indicator: ind.id,
      raw: values[schedule][ind.id],
      scaled: scaled(ind, values[schedule][ind.id]),
      weight: weights[ind.id] ?? 0,
    }))
    const counted = parts.filter((p) => p.scaled !== null && p.weight > 0)
    const total = counted.reduce((sum, p) => sum + p.weight, 0)
    return {
      schedule,
      score: total > 0 ? (100 * counted.reduce((sum, p) => sum + p.weight * p.scaled!, 0)) / total : null,
      parts,
    }
  })
  rows.sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || schedules.indexOf(a.schedule) - schedules.indexOf(b.schedule),
  )
  return { rows, leftOut: left }
}

/** The formula as the planner reads it, with the weights in use. */
export function indexFormula(weights: IndexWeights) {
  const terms = INDEX_INDICATORS.filter((ind) => (weights[ind.id] ?? 0) > 0).map(
    (ind) => `${weights[ind.id]}·${ind.id}`,
  )
  const sum = INDEX_INDICATORS.reduce((s, ind) => s + (weights[ind.id] ?? 0), 0)
  return terms.length
    ? `index = 100 × (${terms.join(' + ')}) ÷ ${sum}, each indicator scaled 0 (worst schedule) to 1 (best)`
    : 'index = none: every weight is 0'
}
