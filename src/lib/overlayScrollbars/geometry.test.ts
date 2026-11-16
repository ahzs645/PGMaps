import { describe, expect, it } from 'vitest'

import { dragOffset, MIN_THUMB_PX, thumbGeometry } from './geometry'

describe('overlay scrollbar geometry', () => {
  it('has no thumb when the content fits', () => {
    expect(thumbGeometry({ port: 600, content: 600, offset: 0 })).toBeNull()
    expect(thumbGeometry({ port: 600, content: 600.5, offset: 0 })).toBeNull()
    expect(thumbGeometry({ port: 0, content: 900, offset: 0 })).toBeNull()
  })

  it('sizes the thumb by the share of the content in view and places it by the share scrolled', () => {
    const top = thumbGeometry({ port: 600, content: 1200, offset: 0 })!
    expect(top).toEqual({ size: 300, travel: 300, position: 0, range: 600 })
    expect(thumbGeometry({ port: 600, content: 1200, offset: 300 })!.position).toBe(150)
    expect(thumbGeometry({ port: 600, content: 1200, offset: 600 })!.position).toBe(300)
    // Past either end (a rubber-band scroll) the thumb stays on its track.
    expect(thumbGeometry({ port: 600, content: 1200, offset: -40 })!.position).toBe(0)
    expect(thumbGeometry({ port: 600, content: 1200, offset: 900 })!.position).toBe(300)
  })

  it('keeps a grabbable thumb on a very long list, and a shorter track beside a second bar', () => {
    const long = thumbGeometry({ port: 600, content: 44_000, offset: 21_700 })!
    expect(long.size).toBe(MIN_THUMB_PX)
    expect(long.position).toBeCloseTo((600 - MIN_THUMB_PX) / 2, 5)
    expect(thumbGeometry({ port: 600, content: 1200, offset: 600, track: 588 })!.position).toBe(294)
  })

  it('turns a drag of the thumb into the scroll it stands for, within the range', () => {
    const g = thumbGeometry({ port: 600, content: 1200, offset: 0 })!
    expect(dragOffset(g, 0, 150)).toBe(300)
    expect(dragOffset(g, 300, -1000)).toBe(0)
    expect(dragOffset(g, 300, 1000)).toBe(600)
    expect(dragOffset({ travel: 0, range: 600 }, 120, 50)).toBe(120)
  })
})
