import { describe, expect, it } from 'vitest'
import { samplePlan } from './plan'
import { analyzePlan } from './planAnalysis'
import { indexFormula, indicatorValues, planningIndex } from './planningIndex'

describe('planning index', () => {
  const plan = samplePlan()
  const result = analyzePlan(plan, { schedule: 'proposed', year: 2026 })

  it('measures each schedule’s indicators from the runs and the blocks', () => {
    const values = indicatorValues(plan, result)
    expect(values.none.earlyArea).toBe(0)
    expect(values.proposed.earlyArea).toBeGreaterThan(0)
    // Deferred ten years cuts in 2036, outside the first ten years from 2026.
    expect(values.deferred.earlyArea).toBe(0)
    expect(values.deferred.totalArea).toBeCloseTo(values.proposed.totalArea!, 6)
  })

  it('scales each indicator across the schedules and weights them to 0–100', () => {
    const { rows } = planningIndex(plan, result, { targetDistance: 0, movedAway: 0, earlyArea: 1, totalArea: 0 })
    // On early area alone, the proposal is best and the others tie at worst.
    expect(rows[0]).toMatchObject({ schedule: 'proposed', score: 100 })
    expect(rows.slice(1).map((r) => r.score)).toEqual([0, 0])
  })

  it('has no score when every weight is zero', () => {
    const weights = { targetDistance: 0, movedAway: 0, earlyArea: 0, totalArea: 0 }
    expect(planningIndex(plan, result, weights).rows.every((r) => r.score === null)).toBe(true)
    expect(indexFormula(weights)).toMatch(/none/)
  })
})
