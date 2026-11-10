import { describe, expect, it } from 'vitest'
import {
  heldSectionDomain,
  holdSectionFrame,
  pinnedSectionOutline,
  pinnedShiftLabel,
  pinnedShiftText,
  sectionExceedsFrame,
  sectionReferenceLevel,
} from './sectionFrame'

describe('a held section frame', () => {
  it('keeps the spans and follows the formation from station to station', () => {
    const held = holdSectionFrame([-20, 20, 795, 805], { designElevation: 801, groundElevation: 803 })!
    expect(held).toEqual({ halfWidthM: 20, spanM: 10, centreAboveReferenceM: -1 })
    // Twelve metres higher up the road: same spans, same place for the formation on screen.
    expect(heldSectionDomain(held, { designElevation: 813, groundElevation: 820 })).toEqual([-20, 20, 807, 817])
  })

  it('follows the ground on a terrain transect or where the formation is missing', () => {
    expect(sectionReferenceLevel({ designElevation: null, groundElevation: 640 })).toBe(640)
    const held = holdSectionFrame([-15, 15, 630, 650], { designElevation: null, groundElevation: 640 })!
    expect(heldSectionDomain(held, { designElevation: null, groundElevation: 655 })).toEqual([-15, 15, 645, 665])
  })

  it('cannot hold or place a frame on a section with no level', () => {
    const none = { designElevation: null, groundElevation: null }
    expect(holdSectionFrame([-15, 15, 0, 4], none)).toBeNull()
    expect(heldSectionDomain({ halfWidthM: 15, spanM: 4, centreAboveReferenceM: 0 }, none)).toBeNull()
    expect(holdSectionFrame([-15, 15, 0, 4], undefined)).toBeNull()
  })

  it('says when part of a section falls outside the held frame', () => {
    const domain: [number, number, number, number] = [-10, 10, 100, 110]
    expect(sectionExceedsFrame([{ x: -5, ground: 104, design: 105 }], domain)).toBe(false)
    expect(sectionExceedsFrame([{ x: -5, ground: 99, design: 105 }], domain)).toBe(true)
    expect(sectionExceedsFrame([{ x: 12, ground: 104, design: null }], domain)).toBe(true)
    // Missing ground is not drawn, so it cannot be cut off.
    expect(sectionExceedsFrame([{ x: 12, ground: null, design: null }], domain)).toBe(false)
  })
})

describe('a pinned section', () => {
  const pinned = {
    chainage: 120,
    designElevation: 500,
    groundElevation: 502,
    section: [
      { offset: -8, ground: 504, design: 503 },
      { offset: 0, ground: 502, design: 500 },
      { offset: 8, ground: null, design: null },
    ],
  }

  it('is moved to share the current formation level, offsets unchanged', () => {
    const outline = pinnedSectionOutline(pinned, { designElevation: 530, groundElevation: 529 })
    expect(outline.alignedOn).toBe('formation')
    expect(outline.shiftM).toBe(30)
    expect(outline.points).toEqual([
      { x: -8, ground: 534, design: 533 },
      { x: 0, ground: 532, design: 530 },
      { x: 8, ground: null, design: null },
    ])
  })

  it('aligns on the ground on a terrain transect, without a design line', () => {
    const outline = pinnedSectionOutline(pinned, { designElevation: 530, groundElevation: 512 }, true)
    expect(outline.alignedOn).toBe('ground')
    expect(outline.shiftM).toBe(10)
    expect(outline.points.map((p) => p.design)).toEqual([null, null, null])
  })

  it('states its shift with a minus sign, short beside Unpin and in full in the tip', () => {
    const down = pinnedSectionOutline(pinned, { designElevation: 497.79, groundElevation: 499 })
    expect(pinnedShiftLabel(down)).toBe('moved −2.21 m')
    expect(pinnedShiftText(down)).toBe(
      "Moved −2.21 m to share this station's formation level at the centreline; offsets unchanged.",
    )
    const none = pinnedSectionOutline(pinned, { designElevation: null, groundElevation: null })
    expect(pinnedShiftLabel(none)).toBe('own levels')
  })

  it('stays where it was when either section has no level', () => {
    const outline = pinnedSectionOutline(pinned, { designElevation: null, groundElevation: null })
    expect(outline.alignedOn).toBe('none')
    expect(outline.shiftM).toBe(0)
    expect(outline.points[0]).toEqual({ x: -8, ground: 504, design: 503 })
  })
})
