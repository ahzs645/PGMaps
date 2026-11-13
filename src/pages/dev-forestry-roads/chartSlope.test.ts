import { describe, expect, it } from 'vitest'
import { averageSlopePercent } from './chartSlope'

const points = [
  { x: 0, ground: 100, design: 110 },
  { x: 10, ground: 110, design: 109 },
  { x: 100, ground: 120, design: 100 },
]

describe('average slope of a graph selection', () => {
  it('weights by distance rather than averaging uneven sample grades', () => {
    expect(averageSlopePercent(points, 'ground', 0, 100)).toBe(20)
    expect(averageSlopePercent(points, 'design', 0, 100)).toBe(-10)
  })

  it('interpolates both endpoints and reports the slope in increasing distance order', () => {
    expect(averageSlopePercent(points, 'ground', 5, 55)).toBe(20)
    expect(averageSlopePercent(points, 'ground', 55, 5)).toBe(20)
  })

  it('does not extrapolate, divide by zero or bridge unknown elevations', () => {
    expect(averageSlopePercent(points, 'ground', -5, 55)).toBeNull()
    expect(averageSlopePercent(points, 'ground', 5, 105)).toBeNull()
    expect(averageSlopePercent(points, 'ground', 5, 5)).toBeNull()
    const gap = points.map((p, i) => ({ ...p, ground: i === 1 ? null : p.ground }))
    expect(averageSlopePercent(gap, 'ground', 5, 55)).toBeNull()
    expect(averageSlopePercent(gap, 'ground', 0, 100)).toBeNull()
    expect(averageSlopePercent(gap, 'design', 0, 100)).toBe(-10)
  })
})
