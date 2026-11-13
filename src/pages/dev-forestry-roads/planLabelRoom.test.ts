import { describe, expect, it } from 'vitest'
import { labelsWithRoom, planLabelWidthPx, type LabelBox } from './planLabelRoom'

const box = (id: string, x: number, y: number, priority = 0): LabelBox => ({
  id,
  x,
  y,
  width: 100,
  height: 17,
  priority,
})

describe('labelsWithRoom', () => {
  it('keeps every label that does not overlap another', () => {
    expect([...labelsWithRoom([box('a', 0, 0), box('b', 0, 40), box('c', 200, 0)])]).toEqual(['a', 'b', 'c'])
  })

  it('folds a label that would land on one placed before it, in input order', () => {
    // A pile like 28 culverts on a road seen at network zoom: 10 px apart down the screen.
    const pile = Array.from({ length: 6 }, (_, i) => box(`c${i}`, i * 4, i * 10))
    expect([...labelsWithRoom(pile)]).toEqual(['c0', 'c2', 'c4'])
  })

  it('places higher priority first, so a selected or flagged structure keeps its label', () => {
    const room = labelsWithRoom([box('first', 0, 0), box('selected', 5, 5, 2)])
    expect([...room]).toEqual(['selected'])
  })

  it('skips boxes with no screen position', () => {
    expect([...labelsWithRoom([box('nowhere', Number.NaN, 0), box('here', 0, 0)])]).toEqual(['here'])
  })

  it('sizes a label from its text', () => {
    expect(planLabelWidthPx('Ø 900 mm · Culvert 12')).toBeGreaterThan(planLabelWidthPx('Ø 600 mm · Culvert 1'))
  })
})

describe('labelsWithRoom obstacles', () => {
  it('never covers a fixed label, and lets a box cover its own mark', () => {
    const station = { ...box('station', 0, 0), fixed: true }
    const ownMark = { ...box('mark:a', 0, 40), width: 18, fixed: true, owner: 'a' }
    const otherMark = { ...box('mark:b', 60, 80), width: 18, fixed: true, owner: 'b' }
    const room = labelsWithRoom([
      { ...box('a', 0, 40), owner: 'a' },
      { ...box('b', 0, 10), owner: 'b' },
      { ...box('c', 20, 80), owner: 'c' },
      station,
      ownMark,
      otherMark,
    ])
    expect(room.has('a')).toBe(true)
    expect(room.has('b')).toBe(false)
    expect(room.has('c')).toBe(false)
  })
})
