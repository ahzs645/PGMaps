import { describe, expect, it } from 'vitest'
import { axisTicks, niceStep } from './chartScale'

describe('road chart axis ticks', () => {
  it('picks 1–2–2.5–5 steps', () => {
    expect(niceStep(1050, 8)).toBe(200)
    expect(niceStep(1050, 12)).toBe(100)
    expect(niceStep(120, 5)).toBe(25)
    expect(niceStep(3.2, 4)).toBe(1)
    expect(niceStep(0.9, 5)).toBe(0.2)
  })

  it('places majors on round values inside the domain', () => {
    const ticks = axisTicks(-36.4, 36.4, 8)
    expect(ticks.step).toBe(10)
    expect(ticks.major).toEqual([-30, -20, -10, 0, 10, 20, 30])
    expect(ticks.minor).toContain(-36)
    expect(ticks.minor).toContain(32)
    expect(ticks.minor).not.toContain(0)
  })

  it('keeps enough decimals to tell majors apart', () => {
    expect(axisTicks(796.1, 801.3, 4).decimals).toBe(0)
    expect(axisTicks(797.2, 798.4, 6).decimals).toBe(1)
    expect(axisTicks(0, 1, 4).major).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(axisTicks(0, 1, 4).decimals).toBe(2)
  })

  it('handles an empty or reversed domain', () => {
    expect(axisTicks(5, 5, 4).major).toEqual([5])
    expect(axisTicks(10, 0, 2).major).toEqual([0, 5, 10])
  })
})
