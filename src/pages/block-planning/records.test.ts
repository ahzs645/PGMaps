import { describe, expect, it } from 'vitest'
import { addDisturbance, setArea, setCheck, setOldForest } from './edits'
import { samplePlan } from './plan'
import { pathways } from './review/pathways'
import {
  boardCheckCurrent,
  boardCheckKey,
  firstShortfall,
  oldForestCurrent,
  oldForestKey,
  type OldForestYear,
} from './records'

const year = (y: number, over: Partial<OldForestYear> = {}): OldForestYear => ({
  year: y,
  cflbHa: 1000,
  requiredOldHa: 170,
  oldHa: 300,
  countedNotOldHa: 0,
  requiredNonPineHa: 140,
  nonPineOldHa: 200,
  unknownAgeHa: 0,
  requiredInteriorHa: 42.5,
  interiorHa: 100,
  ...over,
})

describe('kept checks', () => {
  it('stay current until an input they read changes, and say so after', () => {
    let plan = setCheck(samplePlan(), 'board', { ranOn: '2026-11-24', key: boardCheckKey(samplePlan()), years: [] })
    expect(boardCheckCurrent(plan)).toBe(true)
    plan = { ...plan, landscape: { rationale: 'edited' } }
    expect(boardCheckCurrent(plan)).toBe(true)
    plan = addDisturbance(plan, {
      name: 'New fire',
      kind: 'fire',
      year: 2010,
      yearBasis: 'plan-entry',
      geometry: plan.baseline[0].geometry,
    }).plan
    expect(boardCheckCurrent(plan)).toBe(false)
  })

  it('key old forest to its choices as well as the plan', () => {
    let plan = setOldForest(setArea(samplePlan(), { district: 'Prince George' }), { unit: 'A10' })
    plan = setCheck(plan, 'oldForest', {
      ranOn: '2026-11-24',
      readOn: '2026-11-24',
      key: oldForestKey(plan),
      district: 'Prince George',
      unit: 'A10',
      source: 'test',
      cflbProxyHa: 1000,
      gisFraction: 0.12,
      projectedYear: 2025,
      counts: { stands: 1, ogmas: 0, parks: 0, retention: 0, corridors: 0 },
      schedules: [{ schedule: plan.reviewSchedule, years: [year(2026), year(2031, { oldHa: 150 })] }],
      calibration2019: null,
    })
    expect(oldForestCurrent(plan)).toBe(true)
    const recruitment = pathways(plan, undefined, undefined).find((p) => p.id === 'D.5(a)')!
    expect(recruitment.steps.find((s) => s.id === 'analysis')!.detail).toMatch(/A10.*short of old from 2031/)
    expect(recruitment.steps.find((s) => s.id === 'analysis')!.state).toBe('open')
    expect(oldForestCurrent(setOldForest(plan, { countParks: true }))).toBe(false)
  })

  it('name the first year anything falls short', () => {
    expect(firstShortfall([year(2026), year(2031)])).toBeNull()
    expect(firstShortfall([year(2026), year(2031, { interiorHa: 10, nonPineOldHa: 100 })])).toEqual({
      year: 2031,
      what: ['old non-pine', 'old interior'],
    })
  })
})
