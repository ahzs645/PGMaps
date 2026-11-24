import { describe, expect, it } from 'vitest'
import { gisDisagrees, OLD_FOREST_UNITS, oldForestUnit, unitsOf } from './units'

describe('the order’s old forest units', () => {
  it('holds every unit of the three districts, each with the Board’s 2019 row', () => {
    expect(unitsOf('Prince George')).toHaveLength(25)
    expect(unitsOf('Vanderhoof')).toHaveLength(7)
    expect(unitsOf('Fort St. James')).toHaveLength(17)
    expect(OLD_FOREST_UNITS.every((u) => u.board2019 !== null)).toBe(true)
  })

  it('agrees with the Board on every target and the policy’s old age on every unit', () => {
    const differ = OLD_FOREST_UNITS.filter(
      (u) =>
        u.board2019!.minimumAge !== u.oldFromAge ||
        Math.abs(u.board2019!.requiredOldHa - (u.board2019!.cflbHa * u.oldPercent) / 100) > 1 ||
        Math.abs(u.board2019!.requiredInteriorHa - (u.board2019!.requiredOldHa * u.interiorPercent) / 100) > 1,
    ).map((u) => u.unit)
    expect(differ).toEqual([])
  })

  it('keeps the order’s 17% for A10 and names the GIS layer’s 12%', () => {
    const a10 = oldForestUnit('Prince George', 'A10')!
    expect(a10.oldPercent).toBe(17)
    expect(gisDisagrees(a10, 0.12)).toMatch(/12%.*17%/)
    expect(gisDisagrees(a10, 0.17)).toBeNull()
  })
})
