import { describe, expect, it } from 'vitest'
import { controlSlots, foldControls, steadySlots, type FoldableControl } from './mapControlOverflow'

const TOOLS: FoldableControl[] = [
  { id: 'zoom', priority: 1, slots: 2 },
  { id: 'measure', priority: 3 },
  { id: 'look', priority: 6 },
  { id: 'view', priority: 9 },
  { id: 'road', priority: 8 },
  { id: 'block', priority: 7 },
  { id: 'layers', priority: 10, pinned: true },
  { id: 'masks', priority: 5 },
]

describe('controlSlots', () => {
  it('counts the squares that fit with a gap between each', () => {
    expect(controlSlots(44, 44, 6)).toBe(1)
    expect(controlSlots(94, 44, 6)).toBe(2)
    expect(controlSlots(93, 44, 6)).toBe(1)
  })

  it('never answers fewer than one, even with no room', () => {
    expect(controlSlots(-200, 44, 6)).toBe(1)
  })
})

describe('foldControls', () => {
  it('folds nothing when every control fits', () => {
    const fold = foldControls(TOOLS, 9)
    expect(fold.folded).toEqual([])
    expect(fold.inline).toEqual(TOOLS.map((tool) => tool.id))
    expect(fold.columns).toBe(1)
  })

  it('keeps the highest priorities in their own order and leaves a square for More', () => {
    const fold = foldControls(TOOLS, 5)
    // Layers is pinned (1) and More takes one: three squares for the rest, by priority.
    expect(fold.inline).toEqual(['view', 'road', 'block', 'layers'])
    expect(fold.folded).toEqual(['zoom', 'measure', 'look', 'masks'])
    expect(fold.columns).toBe(1)
  })

  it('folds a two-square pair whole, and fills its room with smaller controls', () => {
    const fold = foldControls(
      [
        { id: 'zoom', priority: 11, slots: 2 },
        { id: 'a', priority: 5 },
        { id: 'b', priority: 4 },
      ],
      2,
    )
    // Zoom alone (2) and More (1) do not fit 2: it folds, and one tool keeps its square.
    expect(fold.inline).toEqual(['a'])
    expect(fold.folded).toEqual(['zoom', 'b'])
  })

  it('takes a second column rather than hide a pinned control or More', () => {
    const fold = foldControls(TOOLS, 1)
    expect(fold.inline).toEqual(['layers'])
    expect(fold.columns).toBe(2)
  })

  it('folds every other control first, keeping pinned controls and More past the allowed columns', () => {
    const fold = foldControls(
      [
        { id: 'a', priority: 1, pinned: true },
        { id: 'b', priority: 1, pinned: true },
        { id: 'c', priority: 1 },
      ],
      1,
      2,
    )
    expect(fold.folded).toEqual(['c'])
    expect(fold.columns).toBe(3)
  })
})

describe('steadySlots', () => {
  it('shrinks at once', () => {
    expect(steadySlots(93, 44, 6, 2)).toBe(1)
  })

  it('grows only once the room clears the larger count by the margin', () => {
    expect(steadySlots(95, 44, 6, 1)).toBe(1)
    expect(steadySlots(98, 44, 6, 1)).toBe(2)
  })
})
