import { describe, expect, it } from 'vitest'
import { gridContours, MAX_SHEET_CONTOUR_SEGMENTS } from './contours'

const ramp = (width: number, height: number, step: number) => ({
  width,
  height,
  values: Float64Array.from({ length: width * height }, (_, i) => (i % width) * step),
})

describe('fixed-interval contours', () => {
  it('draws every level at the interval and flags every second one as index', () => {
    const result = gridContours(ramp(10, 5, 5), 10)
    expect(result.interval).toBe(10)
    expect(result.levels.map((level) => level.level)).toEqual([10, 20, 30, 40])
    expect(result.levels.map((level) => level.index)).toEqual([false, true, false, true])
    // One joined line per level, top to bottom.
    for (const level of result.levels) {
      expect(level.lines).toHaveLength(1)
      expect(level.lines[0]).toHaveLength(5)
    }
  })

  it('draws nothing across missing cells', () => {
    const grid = ramp(11, 5, 5)
    for (let row = 0; row < 5; row++) grid.values[row * 11 + 4] = Number.NaN
    const level20 = gridContours(grid, 10).levels.find((level) => level.level === 20)
    expect(level20).toBeUndefined()
  })

  it('widens the interval and says so when the lines exceed the budget', () => {
    const size = 600
    const result = gridContours(ramp(size, size, 10), 1)
    expect(result.widened).toBe(true)
    expect(result.interval).toBeGreaterThan(1)
    const segments = result.levels.reduce(
      (sum, level) => sum + level.lines.reduce((n, line) => n + line.length - 1, 0),
      0,
    )
    expect(segments).toBeLessThanOrEqual(MAX_SHEET_CONTOUR_SEGMENTS)
  })
})
