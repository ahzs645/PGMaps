import { describe, expect, it } from 'vitest'
import { type Grid } from './model'
import { PEM_STRUCTURE_METHOD, pemStructureAccumulator } from './pemStructure'

const grid: Grid = { west: 0, north: 10, cellM: 5, width: 2, height: 2 }
const valueAtFirst = (heights: number[]) => {
  const accumulator = pemStructureAccumulator(grid)
  for (const height of heights) accumulator.add(1, 9, height, 1)
  return accumulator.finish()
}

describe('bounded PEM-style structure metrics', () => {
  it('computes mean, RMS, sample deviation and additional CV from hand-calculated moments', () => {
    const values = valueAtFirst([3, 4, 5])
    expect(values.pemEligible.values[0]).toBe(3)
    expect(values.pemAbove2.values[0]).toBe(3)
    expect(values.pemMean.values[0]).toBe(4)
    expect(values.pemRms.values[0]).toBeCloseTo(Math.sqrt(50 / 3), 6)
    expect(values.pemStd.values[0]).toBe(1)
    expect(values.pemCv.values[0]).toBe(0.25)
  })

  it('counts negative and cutoff-equal heights in all, and uses a strict cutoff and inclusive ceiling', () => {
    const values = valueAtFirst([-5, 0, 2, 2.01, 100, 100.01])
    expect(values.pemEligible.values[0]).toBe(5)
    expect(values.pemAbove2.values[0]).toBe(2)
    expect(values.pemMean.values[0]).toBeCloseTo((2.01 + 100) / 2, 5)
  })

  it('excludes ground, both noise classes and outside coordinates', () => {
    const accumulator = pemStructureAccumulator(grid)
    accumulator.add(1, 9, 3, 1)
    for (const classification of [2, 7, 18]) accumulator.add(1, 9, 90, classification)
    accumulator.add(-1, 9, 90, 1)
    const result = accumulator.finish()
    expect(result.pemEligible.values[0]).toBe(1)
    expect(result.pemMean.values[0]).toBe(3)
    expect(Number.isNaN(result.pemEligible.values[1])).toBe(true)
  })

  it('keeps observed no-above-cutoff counts at zero and unobserved cells missing', () => {
    const values = valueAtFirst([-1, 1, 2])
    expect(values.pemEligible.values[0]).toBe(3)
    expect(values.pemAbove2.values[0]).toBe(0)
    expect(Number.isNaN(values.pemMean.values[0])).toBe(true)
    expect(Number.isNaN(values.pemRms.values[0])).toBe(true)
    expect(Number.isNaN(values.pemEligible.values[1])).toBe(true)
    expect(Number.isNaN(values.pemAbove2.values[1])).toBe(true)
  })

  it('uses eligible first returns for canopy cover rather than all returns or CV', () => {
    const accumulator = pemStructureAccumulator(grid)
    accumulator.add(1, 9, 0, 1, true)
    accumulator.add(1, 9, 2, 1, true)
    accumulator.add(1, 9, 4, 1, true)
    accumulator.add(1, 9, 8, 1, false)
    accumulator.add(1, 9, 0, 2, true)
    accumulator.add(1, 9, 90, 7, true)
    accumulator.add(1, 9, 110, 1, true)
    const result = accumulator.finish()
    expect(result.pemEligible.values[0]).toBe(4)
    expect(result.pemAbove2.values[0]).toBe(2)
    expect(result.pemCover.values[0]).toBeCloseTo(100 / 3, 5)
    expect(result.pemCv.values[0]).toBeCloseTo(Math.sqrt(8) / 6, 6)
  })

  it('leaves first-return cover missing if the cell contains only later returns', () => {
    const result = valueAtFirst([3, 4])
    expect(Number.isNaN(result.pemCover.values[0])).toBe(true)
  })

  it('leaves sample deviation and CV missing for a single height, but permits RMS and mean', () => {
    const values = valueAtFirst([6])
    expect(values.pemMean.values[0]).toBe(6)
    expect(values.pemRms.values[0]).toBe(6)
    expect(Number.isNaN(values.pemStd.values[0])).toBe(true)
    expect(Number.isNaN(values.pemCv.values[0])).toBe(true)
  })

  it('marks every product missing when a non-ground return lacks terrain support', () => {
    const accumulator = pemStructureAccumulator(grid)
    accumulator.add(1, 9, 6, 1)
    accumulator.add(1, 9, NaN, 1)
    const values = accumulator.finish()
    for (const product of Object.values(values)) expect(Number.isNaN(product.values[0])).toBe(true)
  })

  it('does not let a missing excluded-class return erase supported structural metrics', () => {
    const accumulator = pemStructureAccumulator(grid)
    accumulator.add(1, 9, 6, 1)
    accumulator.add(1, 9, NaN, 2)
    accumulator.add(1, 9, NaN, 7)
    expect(accumulator.finish().pemEligible.values[0]).toBe(1)
  })

  it('accumulates in separate cells using the shared projected grid convention', () => {
    const accumulator = pemStructureAccumulator(grid)
    accumulator.add(1, 9, 3, 1)
    accumulator.add(6, 9, 5, 1)
    accumulator.add(1, 4, 7, 1)
    accumulator.add(6, 4, 9, 1)
    expect([...accumulator.finish().pemMean.values]).toEqual([3, 5, 7, 9])
  })

  it('bounds grid allocation and documents CV independently from LAStools canopy cover', () => {
    expect(() => pemStructureAccumulator({ ...grid, width: 100000, height: 100000 })).toThrow(/grid/)
    expect(() => pemStructureAccumulator({ ...grid, width: 0 })).toThrow(/grid/)
    expect(PEM_STRUCTURE_METHOD.coefficientOfVariation).toContain('additional browser metric')
    expect(PEM_STRUCTURE_METHOD.differences).toContain(
      'LAStools cov is first-return canopy cover, not coefficient of variation.',
    )
  })
})
