import { describe, expect, it } from 'vitest'
import { crossedStation, HOVER_CAPTURE_PX, HOVER_RELEASE_PX, nearestScreenStation, planHover } from './planHover'

// A straight road along y = 100, one station every 50 px, 10 m apart.
const road = Array.from({ length: 11 }, (_, i) => ({ x: i * 50, y: 100, chainage: i * 10 }))

describe('planHover', () => {
  it('picks up the road near the line, not only on it', () => {
    expect(planHover(road, { x: 102, y: 100 + HOVER_CAPTURE_PX - 1 }, null, false)).toEqual({
      engaged: true,
      chainage: 20,
    })
  })

  it('leaves the station alone when the pointer is away from the road', () => {
    expect(planHover(road, { x: 102, y: 100 + HOVER_CAPTURE_PX + 5 }, null, false)).toEqual({
      engaged: false,
      chainage: null,
    })
  })

  it('keeps following a hover that wanders off the line, until the release distance', () => {
    const wandering = { x: 260, y: 100 + HOVER_RELEASE_PX - 1 }
    expect(planHover(road, wandering, { x: 250, y: 100 }, true)).toEqual({ engaged: true, chainage: 50 })
    expect(planHover(road, { x: 260, y: 100 + HOVER_RELEASE_PX + 1 }, wandering, true)).toEqual({
      engaged: false,
      chainage: null,
    })
  })

  it('selects where a swipe crossed the road, even with no move near it', () => {
    // From 150 px above to 150 px below, crossing at x = 310, by station 60 (x = 300).
    expect(planHover(road, { x: 320, y: 250 }, { x: 300, y: -50 }, false)).toEqual({
      engaged: false,
      chainage: 60,
    })
  })

  it('snaps to the calculated station nearer the pointer', () => {
    expect(nearestScreenStation(road, { x: 124, y: 100 })?.chainage).toBe(20)
    expect(nearestScreenStation(road, { x: 126, y: 100 })?.chainage).toBe(30)
  })

  it('takes the last crossing of a swipe over a winding road', () => {
    const hairpin = [
      { x: 0, y: 0, chainage: 0 },
      { x: 100, y: 0, chainage: 10 },
      { x: 100, y: 50, chainage: 20 },
      { x: 0, y: 50, chainage: 30 },
    ]
    expect(crossedStation(hairpin, { x: 20, y: -10 }, { x: 20, y: 60 })).toBe(30)
    expect(crossedStation(hairpin, { x: 20, y: 60 }, { x: 20, y: -10 })).toBe(0)
  })

  it('ignores a road with no stations on screen', () => {
    expect(planHover([], { x: 0, y: 0 }, { x: 10, y: 10 }, true)).toEqual({ engaged: false, chainage: null })
  })
})
