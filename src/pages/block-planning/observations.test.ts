import { describe, expect, it } from 'vitest'
import { bins, table } from '../forest-patches/project'
import { publishedUnit } from './observations'

describe('published observations', () => {
  it('reads the Board’s Fort St. James, Moist Interior – Mountain distributions and their movement', () => {
    const unit = publishedUnit('Fort St. James', 'Moist Interior - Mountain')!
    expect(unit.observations.map((o) => [o.year, o.shares[0]])).toEqual([
      [2015, 22.7],
      [2018, 17.9],
    ])
    // The Board's Table 2 case: under 50 ha moved 0.6 points closer to its 20% target.
    expect(unit.movement![0]).toBeCloseTo(0.6, 6)
    expect(unit.observations[1].method).toMatch(/2017/)
  })

  it('agrees with the order’s Table 7 targets', () => {
    const unit = publishedUnit('Prince George', 'McGregor Plateau')!
    const target = table.targets.find((t) => t.ndu === 'McGregor Plateau')!.percent
    expect(unit.target).toEqual(bins.map((b) => target[b]))
  })

  it('has nothing for a unit the Board did not report', () => {
    expect(publishedUnit('Fort St. James', 'Northern Boreal Mountains')).toBeNull()
    expect(publishedUnit('', '')).toBeNull()
  })
})
