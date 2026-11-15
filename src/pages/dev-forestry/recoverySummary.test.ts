import { describe, expect, it } from 'vitest'
import type { ToolRun } from './assessmentTools'
import { greenUpNotMonotonic, greenUpSensitiveSentence, recoveryRows, recoveryVerdict } from './recoverySummary'
import type { HeadlineScale } from './runRevision'

const scale = (basis: HeadlineScale['basis'], percent: number | null, max: number): HeadlineScale => ({
  basis,
  percent,
  classId: null,
  met: percent === null ? null : percent <= max,
  floorPercent: 0,
  maxPercent: max,
})
const run = (year: number, perspective: number | null, planimetric: number | null, ready = true): ToolRun =>
  ({
    id: `run-${year}`,
    name: `Assessment ${year}`,
    kind: 'timeline',
    year,
    scene: {} as ToolRun['scene'],
    summary: {
      quality: { numericalReady: ready, warnings: [] },
      scales: [scale('perspective', perspective, 7), scale('planimetric', planimetric, 15)],
    } as unknown as ToolRun['summary'],
    error: null,
    generatedAt: '2026-11-15T00:00:00Z',
  }) as ToolRun

describe('the recovery timeline read back', () => {
  it('orders rows by year and says from which year the landform is back within', () => {
    const rows = recoveryRows([run(2045, 4, 9), run(2026, 12, 22), run(2035, 9, 14)], 'timeline')
    expect(rows.map((r) => r.key)).toEqual([2026, 2035, 2045])
    expect(recoveryVerdict(rows, 'perspective', 'timeline')).toBe(
      'Perspective: over the objective in 2026, 2035; within from 2045.',
    )
    expect(recoveryVerdict(rows, 'planimetric', 'timeline')).toBe(
      'Planimetric: over the objective in 2026; within from 2035.',
    )
  })
  it('lists both when a later harvest takes it over again, and withholds provisional runs', () => {
    const rows = recoveryRows([run(2026, 3, 5), run(2030, 9, 20), run(2040, null, null, false)], 'timeline')
    expect(rows[2].provisional).toBe(true)
    expect(recoveryVerdict(rows, 'perspective', 'timeline')).toBe(
      'Perspective: within at 2026; over at 2030 (1 withheld).',
    )
  })
  it('gives a partial cut in view its own Table 6 figure, and says when its inputs are missing', () => {
    const withCuts = (year: number, cuts: Array<{ visible: boolean; equivalentPercent: number | null }>) => {
      const r = run(year, 1, 1)
      return { ...r, summary: { ...r.summary!, via: { partialCuts: cuts } } } as unknown as ToolRun
    }
    const rows = recoveryRows(
      [
        withCuts(2030, [
          { visible: true, equivalentPercent: 2.4 },
          { visible: false, equivalentPercent: 5 },
        ]),
        withCuts(2040, [{ visible: true, equivalentPercent: null }]),
        withCuts(2050, []),
      ],
      'timeline',
    )
    expect(rows.map((r) => r.partialCuts)).toEqual([{ count: 1, percent: 2.4 }, { count: 1, percent: 'missing' }, null])
  })
  it('reads a green-up sensitivity by age, and a failed run as its error', () => {
    const ages = [10, 20, 30].map((age, i) => ({
      ...run(2026, [3, 5, 9][i], 10),
      id: `g${age}`,
      kind: 'greenup' as const,
      year: undefined,
      greenUpAgeYears: age,
    }))
    const failed = { ...ages[0], id: 'g40', greenUpAgeYears: 40, summary: null, error: 'Terrain did not load.' }
    const rows = recoveryRows([...ages, failed], 'greenup')
    expect(rows.map((r) => r.key)).toEqual([10, 20, 30, 40])
    expect(rows[3].error).toBe('Terrain did not load.')
    expect(recoveryVerdict(rows, 'perspective', 'greenup')).toBe(
      'Perspective: within at 10, 20 years; over at 30 years (1 failed).',
    )
    expect(recoveryVerdict(rows, 'planimetric', 'greenup')).toBe(
      'Planimetric: within the objective in every age run (1 failed).',
    )
    expect(recoveryRows(ages, 'timeline')).toEqual([])
    expect(greenUpNotMonotonic(rows, 'perspective')).toBe(false)
    // As measured at Tabor Mountain: an opening greened up at 10 years kept its canopy and screened the landform.
    const measured = [
      { ...ages[0], summary: { ...ages[0].summary!, scales: [scale('perspective', 4.9, 7)] } },
      { ...ages[1], summary: { ...ages[1].summary!, scales: [scale('perspective', 4.2, 7)] } },
    ]
    expect(greenUpNotMonotonic(recoveryRows(measured, 'greenup'), 'perspective')).toBe(true)
  })
  it('groups the openings the green-up ages move by harvest year', () => {
    const openings = [
      ...Array.from({ length: 27 }, () => ({ harvestYear: 2003, ageYears: 23 })),
      ...Array.from({ length: 5 }, () => ({ harvestYear: 2005, ageYears: 21 })),
      { harvestYear: 2010, ageYears: 16 },
    ]
    expect(greenUpSensitiveSentence(openings, [10, 15, 20, 25, 30])).toBe(
      '33 existing openings count at some ages between 10 and 30 years and not at others: 27 harvested in 2003 (23 years old) · 5 in 2005 (21) · 1 in 2010 (16).',
    )
    expect(greenUpSensitiveSentence([], [10, 30])).toMatch(/^No existing opening/)
  })
})
