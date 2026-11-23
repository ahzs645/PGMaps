import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { boardCheck } from './boardCheck'
import { replaceBaseline, setArea } from './edits'
import { emptyPlan, type Disturbance } from './plan'

/** A square of about `ha` hectares at 54° N. */
function block(west: number, south: number, ha: number): Polygon {
  const side = Math.sqrt(ha * 10_000)
  const dy = side / 111_320
  const dx = side / (111_320 * Math.cos((54 * Math.PI) / 180))
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [west + dx, south],
        [west + dx, south + dy],
        [west, south + dy],
        [west, south],
      ],
    ],
  }
}
const cut = (name: string, year: number, geometry: Polygon): Omit<Disturbance, 'id'> => ({
  name,
  kind: 'harvest',
  year,
  yearBasis: 'source-attribute',
  source: 'test',
  geometry,
})

describe('boardCheck', () => {
  const area = { district: 'Prince George', ndu: 'Moist Interior - Mountain', startYear: 2026, source: 'test' }
  const plan = replaceBaseline(setArea(emptyPlan(2026), area), () => false, [
    cut('small', 2000, block(-123, 54, 30)),
    cut('large', 2010, block(-122.5, 54, 300)),
  ])

  it('sets the modelled classes of 2015 and 2018 beside the Board’s', () => {
    const check = boardCheck(plan)!
    expect(check.years.map((y) => y.year)).toEqual([2015, 2018])
    const [y2015, y2018] = check.years
    expect(y2015.modelled.totalHa).toBeCloseTo(330, -1)
    // 2000's cut has left the young window by 2021, not by 2018.
    expect(y2018.modelled.totalHa).toBeCloseTo(330, -1)
    for (const y of check.years)
      y.difference.forEach((d, i) => {
        const m = y.modelled.classes[i].percent
        expect(d).toBeCloseTo((m ?? NaN) - y.published.shares[i], 6)
      })
    expect(check.largestDifference).toBe(Math.max(...check.years.flatMap((y) => y.difference.map((d) => Math.abs(d!)))))
  })

  it('says when the baseline may miss 2015’s young forest', () => {
    expect(boardCheck(plan)!.coverageGap).toMatch(/not read from DataBC/)
    const late = setArea(plan, { baselineRead: { fromYear: 2006, marginMetres: 0, readOn: '2026-11-23' } })
    expect(boardCheck(late)!.coverageGap).toMatch(/from 2006.*from 1995/)
    const full = setArea(plan, { baselineRead: { fromYear: 1995, marginMetres: 5000, readOn: '2026-11-23' } })
    expect(boardCheck(full)!.coverageGap).toBeNull()
  })

  it('answers nothing where the Board published nothing or the baseline is empty', () => {
    expect(boardCheck(setArea(plan, { ndu: 'No such sub-unit' }))).toBeNull()
    expect(boardCheck(setArea(emptyPlan(2026), area))).toBeNull()
  })
})
