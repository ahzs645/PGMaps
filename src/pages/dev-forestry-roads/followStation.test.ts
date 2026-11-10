import { describe, expect, it } from 'vitest'
import { followDelay, FOLLOW_HOLD_AFTER_USER_MS, FOLLOW_THROTTLE_MS, outsideFollowBox } from './followStation'

describe('following the selected station', () => {
  const size = { width: 800, height: 600 }
  it('pans only when the station nears an edge or leaves the view', () => {
    expect(outsideFollowBox({ x: 400, y: 300 }, size)).toBe(false)
    expect(outsideFollowBox({ x: 100, y: 300 }, size)).toBe(true)
    expect(outsideFollowBox({ x: 400, y: 590 }, size)).toBe(true)
    expect(outsideFollowBox({ x: -50, y: 300 }, size)).toBe(true)
    expect(outsideFollowBox({ x: Number.NaN, y: 300 }, size)).toBe(true)
    expect(outsideFollowBox({ x: 10, y: 10 }, { width: 0, height: 0 })).toBe(false)
  })
  it('never pans while the reader moves the plan or points at it, and throttles otherwise', () => {
    const base = { now: 10_000, lastPanAt: 0, holdUntil: 0, userMoving: false, pointerInPlan: false }
    expect(followDelay(base)).toBe(0)
    expect(followDelay({ ...base, userMoving: true })).toBeNull()
    expect(followDelay({ ...base, pointerInPlan: true })).toBeNull()
    expect(followDelay({ ...base, lastPanAt: 9_900 })).toBe(FOLLOW_THROTTLE_MS - 100)
    expect(followDelay({ ...base, holdUntil: 10_000 + FOLLOW_HOLD_AFTER_USER_MS })).toBe(FOLLOW_HOLD_AFTER_USER_MS)
  })
})
