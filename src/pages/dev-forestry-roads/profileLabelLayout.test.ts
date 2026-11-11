import { describe, expect, it } from 'vitest'
import {
  clusterByPixels,
  GROUND_GRADE_MAX_PIECES,
  groundGradeBreaks,
  groundGradePieceCount,
  junctionDifferenceShown,
  junctionLabelNames,
  placeLabels,
  rotatedTextBox,
  textBox,
} from './profileLabelLayout'

const stations = (length: number, ground: (chainage: number) => number | null, step = 10) =>
  Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => ({
    chainage: i * step,
    groundElevation: ground(i * step),
  }))

describe('ground-grade pieces', () => {
  it('scale with the plot width and the zoom, within the cap', () => {
    expect(groundGradePieceCount(3000, 3000, 330)).toBe(3)
    expect(groundGradePieceCount(3000, 3000, 1100)).toBe(10)
    // Zoomed to a tenth of the road, the whole road holds ten times the pieces.
    expect(groundGradePieceCount(3000, 300, 330)).toBe(30)
    expect(groundGradePieceCount(30000, 300, 1100)).toBe(GROUND_GRADE_MAX_PIECES)
    expect(groundGradePieceCount(0, 0, 0)).toBe(1)
  })

  it('keep straight ground as one piece rather than cutting it into equal lengths', () => {
    expect(
      groundGradeBreaks(
        stations(1000, (c) => 900 + c * 0.03),
        1000,
        8,
        50,
      ),
    ).toEqual([0, 1000])
  })

  it('break where the ground bends, the largest bend first', () => {
    // Down 5 % to 400 m, then up 3 %: one bend, at the valley floor.
    const valley = stations(1000, (c) => (c <= 400 ? 900 - c * 0.05 : 880 + (c - 400) * 0.03))
    expect(groundGradeBreaks(valley, 1000, 8, 50)).toEqual([0, 400, 1000])
    expect(groundGradeBreaks(valley, 1000, 1, 50)).toEqual([0, 1000])
  })

  it('never make a piece shorter than the minimum', () => {
    const bumpy = stations(1000, (c) => 900 + 3 * Math.sin(c / 15))
    const cuts = groundGradeBreaks(bumpy, 1000, 40, 80)
    expect(cuts.length - 1).toBeLessThanOrEqual(40)
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeGreaterThanOrEqual(80 - 1e-9)
  })

  it('read the road end a hair past its last stored station', () => {
    const valley = stations(1000, (c) => (c <= 400 ? 900 - c * 0.05 : 880 + (c - 400) * 0.03))
    expect(groundGradeBreaks(valley, 1000 + 2e-7, 8, 50)).toEqual([0, 400, 1000 + 2e-7])
  })

  it('split a terrain gap away from known ground', () => {
    const gapped = stations(1000, (c) => (c > 300 && c < 500 ? null : 900 + c * 0.02))
    const cuts = groundGradeBreaks(gapped, 1000, 8, 50)
    expect(cuts).toContain(300)
    expect(cuts).toContain(500)
  })
})

describe('placing labels', () => {
  const bounds = { left: 0, top: 0, right: 200, bottom: 100 }

  it('places the higher priority first and moves a lower one to its next option', () => {
    const box = textBox(50, 50, 'abcdef', 9)
    const placed = placeLabels(
      [
        {
          id: 'low',
          priority: 1,
          options: [
            { box, value: 'low-right' },
            { box: textBox(45, 50, 'abcdef', 9, 'end'), value: 'low-left' },
          ],
        },
        { id: 'high', priority: 2, options: [{ box, value: 'high' }] },
      ],
      { bounds },
    )
    expect(placed.get('high')).toBe('high')
    expect(placed.get('low')).toBe('low-left')
  })

  it('leaves out a label with no free option, or one outside the plot', () => {
    const box = textBox(50, 50, 'abcdef', 9)
    const placed = placeLabels(
      [
        { id: 'a', priority: 2, options: [{ box, value: 1 }] },
        { id: 'b', priority: 1, options: [{ box, value: 2 }] },
        { id: 'edge', priority: 3, options: [{ box: textBox(195, 50, 'abcdef', 9), value: 3 }] },
      ],
      { bounds },
    )
    expect([...placed.keys()]).toEqual(['a'])
  })

  it('keeps clear of obstacles', () => {
    const box = textBox(50, 50, 'abc', 9)
    expect(
      placeLabels([{ id: 'a', priority: 1, options: [{ box, value: 1 }] }], { bounds, obstacles: [box] }).size,
    ).toBe(0)
  })

  it('boxes rotated text by its rotated extent', () => {
    const flat = rotatedTextBox(100, 50, 'abcdefghij', 9, 0),
      steep = rotatedTextBox(100, 50, 'abcdefghij', 9, 60)
    expect(steep.bottom - steep.top).toBeGreaterThan(flat.bottom - flat.top)
    expect(steep.right - steep.left).toBeLessThan(flat.right - flat.left)
  })
})

describe('crossing ticks', () => {
  it('group items within the pixel distance of the group start', () => {
    const groups = clusterByPixels([0, 2, 5, 7, 30, 31], (x) => x, 6)
    expect(groups).toEqual([[0, 2, 5], [7], [30, 31]])
  })
})

describe('junction labels', () => {
  it('drop "as mapped" and fall back to the last name part', () => {
    expect(junctionLabelNames('R01860 · B4 · as mapped')).toEqual(['R01860 · B4', 'B4'])
    expect(junctionLabelNames('Spur 2')).toEqual(['Spur 2'])
  })

  it('print a level difference only when it is worth reading', () => {
    expect(junctionDifferenceShown(0)).toBe(false)
    expect(junctionDifferenceShown(-0.01)).toBe(false)
    expect(junctionDifferenceShown(0.05)).toBe(true)
    expect(junctionDifferenceShown(null)).toBe(false)
  })
})
