import { describe, expect, it } from 'vitest'
import { emptyPlan, parsePlan, type Plan } from '../plan'
import type { MackenzieRowYear } from './mackenzie'
import { evidenceYear, interiorMargin, mackenzieEvidence, oldMargin, youngerShare } from './mackenzieEvidence'
import { mackenzieOldForestCurrent, mackenzieOldForestKey, type MackenzieOldForestRecord } from './mackenzieRecord'

const row = (r: Partial<MackenzieRowYear>): MackenzieRowYear => ({
  row: 'g4+5',
  cflbHa: 1000,
  requiredOldHa: 160,
  oldHa: 200,
  deadOldHa: 50,
  nfaHa: 50,
  unknownAgeHa: 0,
  requiredInteriorHa: 40,
  interiorHa: 30,
  ...r,
})

function planWithRecord(change: (p: Plan) => Plan = (p) => p): Plan {
  const base: Plan = {
    ...emptyPlan(2026),
    blocks: [
      {
        id: 'b1',
        name: 'Block 1',
        shapes: [
          {
            id: 's1',
            name: 'Proposed',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-123.9, 55.6],
                  [-123.89, 55.6],
                  [-123.89, 55.61],
                  [-123.9, 55.6],
                ],
              ],
            },
          },
        ],
      },
    ],
    mackenzieOldForest: { unit: 'nation', countPark: false },
  }
  base.schedules = base.schedules.map((s) => (s.id === 'proposed' ? { ...s, entries: { b1: { year: 2033 } } } : s))
  const plan = change(base)
  const record: MackenzieOldForestRecord = {
    ranOn: '2026-11-27',
    readOn: '2026-11-27',
    key: mackenzieOldForestKey(plan),
    unit: 'nation',
    source: 'Landscape units Nation',
    park: null,
    cflbProxyHa: 1000,
    projectedYear: 2025,
    counts: { stands: 10, corridors: 0, lakes: 1 },
    excluded: [],
    keptCommunityForests: [],
    outsideRows: [],
    schedules: plan.schedules.map((s) => ({
      schedule: s.id,
      years: [2026, 2031, 2036].map((year) => ({
        year,
        rows: [row({ oldHa: year === 2036 ? 120 : 200 }), row({ row: 'g6&7', cflbHa: 0, requiredOldHa: 0 })],
      })),
    })),
  }
  return { ...plan, checks: { mackenzieOldForest: record } }
}

describe('the Mackenzie calculation as evidence', () => {
  it('measures each margin in the fact’s own unit', () => {
    // 150 ha held (200 old, 50 of it dead, all 50 counted) of 1,000 ha CFLB = 20% against 16%.
    expect(oldMargin(row({}), 16)).toBeCloseTo(4)
    // 30 ha interior of 160 ha required = 18.75% against 25%.
    expect(interiorMargin(row({}), 25)).toBeCloseTo(-6.25)
    expect(interiorMargin(row({}), null)).toBeNull()
    expect(interiorMargin(row({ interiorHa: null }), 25)).toBeNull()
    expect(youngerShare(row({}))).toBeNull()
    expect(youngerShare(row({ youngerHa: 11 }))).toBeCloseTo(10) // of the 110 ha live part
  })

  it('reads at the first period from the block’s harvest in the schedule under review', () => {
    const plan = planWithRecord()
    expect(evidenceYear(plan, 'b1').year).toBe(2036)
    expect(evidenceYear(plan, 'nowhere').year).toBe(2026)
  })

  it('says it is evidence, gives every row with CFLB, and never a row with none', () => {
    const hints = mackenzieEvidence(planWithRecord(), 'b1')
    expect(hints['old-margin']).toMatch(/evidence only, the answer is yours/)
    expect(hints['old-margin']).toMatch(/group 4, 5: 12% old against 16% \(-4 points\)/)
    expect(hints['old-margin']).not.toMatch(/deciduous/)
    expect(hints['interior-margin']).toMatch(/18\.8% of the required old forest interior against 25% \(-6\.3 points\)/)
    expect(hints['younger-share']).toBeUndefined()
    expect(hints['old-margin']).not.toMatch(/Out of date/)
  })

  it('says when the record is out of date', () => {
    const plan = planWithRecord()
    const changed = { ...plan, mackenzieOldForest: { unit: 'nation', countPark: false, affectedPercent: 30 } }
    expect(mackenzieOldForestCurrent(changed)).toBe(false)
    expect(mackenzieEvidence(changed, 'b1')['old-margin']).toMatch(/Out of date/)
  })

  it('keeps the choices and the record through a saved plan', () => {
    const plan = planWithRecord((p) => ({
      ...p,
      mackenzieOldForest: {
        unit: 'nation',
        countPark: false,
        affectedPercent: 40,
        affectedSource: 'District estimate',
        younger: { fromAge: 100, benefit: 'Connects two old patches.' },
      },
    }))
    const back = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(back.mackenzieOldForest).toEqual(plan.mackenzieOldForest)
    expect(back.checks?.mackenzieOldForest).toEqual(plan.checks?.mackenzieOldForest)
    expect(mackenzieOldForestCurrent(back)).toBe(true)
  })

  it('adds nothing to a plan without a Mackenzie calculation', () => {
    const plan = emptyPlan(2026)
    expect(mackenzieEvidence(plan, 'b1')).toEqual({})
    const back = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(back.mackenzieOldForest).toBeUndefined()
    expect(back.checks).toBeUndefined()
  })
})
