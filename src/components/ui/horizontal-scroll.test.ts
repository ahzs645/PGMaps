import { describe, expect, it } from 'vitest'
import { horizontalWheelTarget } from './horizontal-scroll'

const strip = { scrollLeft: 100, scrollWidth: 1000, clientWidth: 400 }

describe('a vertical wheel over a horizontal strip', () => {
  it('scrolls the strip sideways by the wheel, in pixels, lines or pages', () => {
    expect(horizontalWheelTarget(strip, { deltaX: 0, deltaY: 40 })).toBe(140)
    expect(horizontalWheelTarget(strip, { deltaX: 0, deltaY: -3, deltaMode: 1 })).toBe(52)
    expect(horizontalWheelTarget({ ...strip, scrollLeft: 0 }, { deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(400)
  })

  it('stops at either end and gives the wheel back to the page there', () => {
    expect(horizontalWheelTarget({ ...strip, scrollLeft: 590 }, { deltaX: 0, deltaY: 40 })).toBe(600)
    expect(horizontalWheelTarget({ ...strip, scrollLeft: 600 }, { deltaX: 0, deltaY: 40 })).toBeNull()
    expect(horizontalWheelTarget({ ...strip, scrollLeft: 0 }, { deltaX: 0, deltaY: -40 })).toBeNull()
  })

  it('leaves a sideways swipe, pinch zoom and a strip that fits to the browser', () => {
    expect(horizontalWheelTarget(strip, { deltaX: 30, deltaY: 10 })).toBeNull()
    expect(horizontalWheelTarget(strip, { deltaX: 0, deltaY: 40, ctrlKey: true })).toBeNull()
    expect(horizontalWheelTarget({ ...strip, scrollWidth: 400 }, { deltaX: 0, deltaY: 40 })).toBeNull()
  })

  it('scrolls a right-to-left strip toward its end', () => {
    expect(horizontalWheelTarget({ ...strip, scrollLeft: -100, rtl: true }, { deltaX: 0, deltaY: 40 })).toBe(-140)
    expect(horizontalWheelTarget({ ...strip, scrollLeft: -600, rtl: true }, { deltaX: 0, deltaY: 40 })).toBeNull()
  })
})
