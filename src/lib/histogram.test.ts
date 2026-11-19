import { describe, expect, it } from 'vitest'
import { finiteExtent, histogram, histogramPeak } from './histogram'

describe('histogram', () => {
  it('bins equal widths over the domain, a value on a break going to the bin above', () => {
    const h = histogram([0, 0.25, 0.5, 0.5, 0.75, 1], { domain: [0, 1], bins: 4 })
    expect(h.bins.map((bin) => [bin.from, bin.to, bin.count])).toEqual([
      [0, 0.25, 1],
      [0.25, 0.5, 1],
      [0.5, 0.75, 2],
      // The top edge belongs to the last bin.
      [0.75, 1, 2],
    ])
    expect(h.binned).toBe(6)
    expect(h.mean).toBeCloseTo(0.5, 10)
    expect(histogramPeak(h)).toBe(2)
  })

  it('counts values outside the domain and missing values apart, never in the end bins', () => {
    const h = histogram([-2, 0.1, NaN, Infinity, 3, 0.9], { domain: [0, 1], bins: 2 })
    expect(h.bins.map((bin) => bin.count)).toEqual([1, 1])
    expect(h).toMatchObject({ binned: 2, below: 1, above: 1, missing: 2 })
    expect(h.mean).toBeCloseTo(0.5, 10)
  })

  it('takes the domain from the finite values when none is given, and widens a single value', () => {
    expect(finiteExtent([NaN, 3, -1, 2])).toEqual([-1, 3])
    expect(finiteExtent([NaN])).toBeNull()
    const h = histogram([2, 2, 2], { bins: 3 })
    expect(h.domain).toEqual([1.5, 2.5])
    expect(h.bins[1].count).toBe(3)
  })

  it('leaves values out of a mask as missing', () => {
    const h = histogram([0.1, 0.2, 0.3, 0.4], { domain: [0, 1], bins: 1, include: (i) => i % 2 === 0 })
    expect(h).toMatchObject({ binned: 2, missing: 2 })
  })

  it('has no mean and an empty peak when nothing is binned', () => {
    const h = histogram([], { domain: [0, 1], bins: 5 })
    expect(Number.isNaN(h.mean)).toBe(true)
    expect(histogramPeak(h)).toBe(0)
    expect(h.bins).toHaveLength(5)
  })
})
