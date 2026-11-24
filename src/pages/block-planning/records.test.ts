import { describe, expect, it } from 'vitest'
import { addDisturbance, setArea, setCheck, setOldForest } from './edits'
import { samplePlan } from './plan'
import { pathways } from './review/pathways'
import {
  boardCheckCurrent,
  boardCheckKey,
  firstShortfall,
  metOnlyWithD4,
  oldForestCurrent,
  oldForestKey,
  shortfallText,
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

describe('D.4 and D.2 in the kept record', () => {
  const d4 = { d4OldSupplyHa: 400, d4OldHa: 34, d4InteriorSupplyHa: 50, d4InteriorHa: 8.5 }

  it('counts D.4 toward old and interior, and says where it made the difference', () => {
    // 150 old against 170 is short; with 34 ha of younger stands it is met.
    const years = [year(2026, { oldHa: 150, ...d4 }), year(2031, { oldHa: 100, ...d4 })]
    expect(firstShortfall(years)).toEqual({ year: 2031, what: ['old'] })
    expect(metOnlyWithD4(years)).toEqual({ year: 2026, what: ['old'] })
    expect(shortfallText(years)).toBe('short of old from 2031; old met only with D.4 from 2026')
    expect(metOnlyWithD4([year(2026, { interiorHa: 40, ...d4 })])).toEqual({ year: 2026, what: ['old interior'] })
    expect(shortfallText([year(2026)])).toBe('no shortfall over the projection')
  })

  it('key old forest to the D.4 statement and the pooled units', () => {
    const plan = setOldForest(setArea(samplePlan(), { district: 'Prince George' }), { unit: 'A5' })
    const key = oldForestKey(plan)
    const on = setOldForest(plan, { younger: { benefit: '' } })
    expect(oldForestKey(on)).not.toBe(key)
    const aged = setOldForest(on, { younger: { fromAge: 100, benefit: '' } })
    expect(oldForestKey(aged)).not.toBe(oldForestKey(on))
    expect(oldForestKey(setOldForest(aged, { younger: { fromAge: 100, benefit: 'Connectivity.' } }))).not.toBe(
      oldForestKey(aged),
    )
    expect(oldForestKey(setOldForest(aged, { younger: undefined }))).toBe(key)
    const pooled = setOldForest(plan, { pooledWith: [{ district: 'Prince George', unit: 'A6' }] })
    expect(oldForestKey(pooled)).not.toBe(key)
    // The chosen unit is never pooled with itself, and an empty pool is no pool.
    const self = setOldForest(plan, { pooledWith: [{ district: 'Prince George', unit: 'A5' }] })
    expect(self.oldForest).not.toHaveProperty('pooledWith')
    expect(oldForestKey(setOldForest(pooled, { pooledWith: [] }))).toBe(key)
  })

  it('say in D.5(a)’s evidence when a result leans on D.4, and name the pooled units', () => {
    let plan = setOldForest(setArea(samplePlan(), { district: 'Prince George' }), {
      unit: 'A5',
      younger: { fromAge: 100, benefit: 'Connectivity.' },
      pooledWith: [{ district: 'Prince George', unit: 'A6' }],
    })
    const years = [year(2026, { oldHa: 150, ...d4 })]
    const unitRow = (unit: string) => ({
      district: 'Prince George',
      unit,
      source: 'test',
      cflbProxyHa: 500,
      gisFraction: null,
      projectedYear: 2025,
      counts: { stands: 1, ogmas: 0, parks: 0, retention: 0, corridors: 0 },
      schedules: [{ schedule: plan.reviewSchedule, years }],
      calibration2019: null,
    })
    plan = setCheck(plan, 'oldForest', {
      ...unitRow('A5'),
      ranOn: '2026-11-24',
      readOn: '2026-11-24',
      key: oldForestKey(plan),
      younger: { fromAge: 100, benefit: 'Connectivity.' },
      pool: [unitRow('A5'), unitRow('A6')],
    })
    const analysis = pathways(plan, undefined, undefined)
      .find((p) => p.id === 'D.5(a)')!
      .steps.find((s) => s.id === 'analysis')!
    expect(analysis.detail).toMatch(/A5 \+ A6 pooled under D\.2/)
    expect(analysis.detail).toMatch(/leans on D\.4: old is met only with younger stands from 100 years, from 2026/)
  })
})
