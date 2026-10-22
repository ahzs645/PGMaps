import { describe, expect, it } from 'vitest'
import { normalizeFractions, resizeFractions, resizeStacked } from './pane-sizes'

describe('pane sizes', () => {
  it('normalizes weights and falls back to equal panes', () => {
    expect(normalizeFractions([2, 1, 1], 3)).toEqual([0.5, 0.25, 0.25])
    expect(normalizeFractions([1, 0], 2)).toEqual([0.5, 0.5])
    expect(normalizeFractions([1], 2)).toEqual([0.5, 0.5])
  })

  it('moves one boundary and leaves the other panes alone', () => {
    const next = resizeFractions([0.25, 0.25, 0.5], 0, 100, 1000, [{ min: 0 }, { min: 0 }, { min: 0 }])
    expect(next[0]).toBeCloseTo(0.35)
    expect(next[1]).toBeCloseTo(0.15)
    expect(next[2]).toBe(0.5)
    expect(next.reduce((a, b) => a + b)).toBeCloseTo(1)
  })

  it('stops each pane at its pixel minimum and maximum', () => {
    const limits = [{ min: 200, max: 600 }, { min: 300 }]
    expect(resizeFractions([0.5, 0.5], 0, 400, 1000, limits)[0]).toBeCloseTo(0.6)
    expect(resizeFractions([0.5, 0.5], 0, -400, 1000, limits)[0]).toBeCloseTo(0.2)
    expect(resizeFractions([0.5, 0.5], 0, 250, 1000, [{ min: 0 }, { min: 300 }])[1]).toBeCloseTo(0.3)
  })

  it('shares a pair that cannot hold both minimums in proportion', () => {
    const next = resizeFractions([0.5, 0.5], 0, 50, 300, [{ min: 200 }, { min: 200 }])
    expect(next[0]).toBeCloseTo(0.5)
  })

  it('ignores an invalid boundary or measurement', () => {
    expect(resizeFractions([0.5, 0.5], 1, 10, 100, [])).toEqual([0.5, 0.5])
    expect(resizeFractions([0.5, 0.5], 0, 10, 0, [])).toEqual([0.5, 0.5])
  })

  it('changes only the stacked pane above a boundary', () => {
    expect(resizeStacked([300, 400], 0, 55, [{ min: 160 }, { min: 160 }])).toEqual([355, 400])
    expect(resizeStacked([300, 400], 1, -500, [{ min: 160 }, { min: 160 }])).toEqual([300, 160])
  })
})
