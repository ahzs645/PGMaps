import { describe, expect, it } from 'vitest'
import type { FactSet } from '../../../../packages/legal-rules/src/contract'
import { samplePlan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import { alternativesCompared, defaultTrendYear, measuredTrend, pathways } from './pathways'

const facts = (entries: FactSet['facts']): FactSet => ({
  format: 'pgmaps-legal-facts/v1',
  pack: 'bc.pgtsa.biodiversity',
  version: '1.2.0',
  source: 'test',
  facts: entries,
})

describe('D.5 pathways', () => {
  const plan = samplePlan()
  const result = analyzePlan(plan, { schedule: 'proposed', year: 2026 })

  it('measures the trend over the period after the proposal first cuts', () => {
    expect(defaultTrendYear(plan)).toBe(2031)
    const run = result.runs.find((r) => r.schedule === 'proposed')!
    expect(measuredTrend(plan, result)).toEqual({ year: 2031, movedAway: run.movedAway[1] })
    expect(typeof run.movedAway[1]).toBe('boolean')
  })

  it('counts the sample’s schedules as a comparison with no further harvest', () => {
    expect(alternativesCompared(plan)).toEqual({ cutsNothing: true, others: 1, total: 3 })
  })

  it('needs a person’s determination before a rationale step is done, and names no approval for D.5(b)', () => {
    const [b, a] = pathways(plan, facts([{ id: 'applicable', value: true }]), result)
    expect(b.steps.find((s) => s.id === 'trend')!.state).toBe('done')
    expect(b.steps.find((s) => s.id === 'determination')!.state).toBe('open')
    expect(b.steps.some((s) => /approv/i.test(s.label))).toBe(false)
    expect(a.steps.some((s) => s.id === 'approved')).toBe(true)
  })

  it('says a pathway is not needed or does not apply rather than passed', () => {
    expect(pathways(plan, facts([{ id: 'applicable', value: false }]), result)[0].status).toBe('Does not apply')
    const answered = facts([
      { id: 'applicable', value: true },
      { id: 'patch-unachievable', value: false },
    ])
    expect(pathways(plan, answered, result)[0].status).toBe('Not needed')
  })
})
