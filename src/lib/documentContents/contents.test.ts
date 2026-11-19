import { describe, expect, it } from 'vitest'

import {
  ON_OFF,
  canMove,
  contentsCounts,
  contentsStates,
  contentsSummary,
  dragTargetIndex,
  moveAnnouncement,
  moveRange,
  moveTargets,
  movedOrder,
  onOffValues,
  orderedKeys,
  partPrints,
  type ContentsChoice,
  type ContentsPart,
} from './contents'

const part = (key: string, extra: Partial<ContentsPart> = {}): ContentsPart => ({
  key,
  label: key.toUpperCase(),
  state: 'on',
  ...extra,
})

const PLACEMENTS: ContentsChoice[] = [
  { value: 'package', label: 'In package', included: true },
  { value: 'appendix', label: 'Appendix (separate PDF)', included: true },
  { value: 'omit', label: 'Leave out', included: false },
]

describe('moveTargets and movedOrder', () => {
  const parts = [part('a'), part('b'), part('c'), part('d')]

  it('offers up, down, top and bottom inside the list', () => {
    expect(moveTargets(parts, 'a')).toEqual({ up: null, down: 1, top: null, bottom: 3 })
    expect(moveTargets(parts, 'c')).toEqual({ up: 1, down: 3, top: 0, bottom: 3 })
    expect(moveTargets(parts, 'd')).toEqual({ up: 2, down: null, top: 0, bottom: null })
    expect(moveTargets(parts, 'missing')).toEqual({ up: null, down: null, top: null, bottom: null })
  })

  it('returns the key order after a move, and null for a move that does nothing', () => {
    expect(movedOrder(parts, 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(movedOrder(parts, 'a', 3)).toEqual(['b', 'c', 'd', 'a'])
    expect(movedOrder(parts, 'b', 2)).toEqual(['a', 'c', 'b', 'd'])
    expect(movedOrder(parts, 'b', 1)).toBeNull()
    expect(movedOrder(parts, 'b', 4)).toBeNull()
    expect(movedOrder(parts, 'b', 1.5)).toBeNull()
  })

  it('never moves a pinned part, nor another across it', () => {
    const pinned = [part('cover', { pinned: true }), part('a'), part('b'), part('end', { pinned: true }), part('c')]
    expect(moveTargets(pinned, 'cover')).toEqual({ up: null, down: null, top: null, bottom: null })
    expect(canMove(pinned, 'cover')).toBe(false)
    expect(moveTargets(pinned, 'a')).toEqual({ up: null, down: 2, top: null, bottom: 2 })
    expect(movedOrder(pinned, 'a', 0)).toBeNull()
    expect(movedOrder(pinned, 'b', 4)).toBeNull()
    expect(moveRange(pinned, 'b')).toEqual({ from: 1, to: 2 })
    // Alone between pinned parts, a part has nowhere to go.
    expect(canMove(pinned, 'c')).toBe(false)
  })

  it('keeps a part inside its own group', () => {
    const grouped = [
      part('r1', { group: 'report' }),
      part('r2', { group: 'report' }),
      part('p1', { group: 'plotbook' }),
      part('p2', { group: 'plotbook' }),
      part('p3', { group: 'plotbook' }),
    ]
    expect(moveTargets(grouped, 'p1')).toEqual({ up: null, down: 3, top: null, bottom: 4 })
    expect(moveTargets(grouped, 'r2')).toEqual({ up: 0, down: null, top: 0, bottom: null })
    expect(movedOrder(grouped, 'p1', 1)).toBeNull()
    expect(movedOrder(grouped, 'p3', 2)).toEqual(['r1', 'r2', 'p3', 'p1', 'p2'])
  })
})

describe('dragTargetIndex', () => {
  // Rows 20 px high: middles at 10, 30, 50, 70, 90.
  const mids = [10, 30, 50, 70, 90]
  const range = { from: 0, to: 4 }

  it('lands the dragged part after every other row whose middle is above the pointer', () => {
    expect(dragTargetIndex(mids, 5, 2, range)).toBe(0)
    expect(dragTargetIndex(mids, 25, 2, range)).toBe(1)
    expect(dragTargetIndex(mids, 45, 2, range)).toBe(2)
    expect(dragTargetIndex(mids, 55, 2, range)).toBe(2)
    expect(dragTargetIndex(mids, 75, 2, range)).toBe(3)
    expect(dragTargetIndex(mids, 200, 2, range)).toBe(4)
  })

  it('stays inside the part’s span however far the pointer goes', () => {
    const span = { from: 1, to: 3 }
    expect(dragTargetIndex(mids, -100, 2, span)).toBe(1)
    expect(dragTargetIndex(mids, 500, 2, span)).toBe(3)
  })

  it('agrees with movedOrder: the landing index is the part’s final place', () => {
    const parts = ['a', 'b', 'c', 'd', 'e'].map((key) => part(key))
    const to = dragTargetIndex(mids, 85, 1, range)
    expect(movedOrder(parts, 'b', to)).toEqual(['a', 'c', 'd', 'b', 'e'])
  })
})

describe('counts and sentences', () => {
  it('counts locked parts as printing and unavailable ones as not', () => {
    const parts = [
      part('a'),
      part('b', { state: 'off' }),
      part('c', { locked: 'Always printed', state: 'off' }),
      part('d', { unavailable: 'No culverts', state: 'on' }),
    ]
    expect(partPrints(parts[2], ON_OFF)).toBe(true)
    expect(partPrints(parts[3], ON_OFF)).toBe(false)
    const counts = contentsCounts(parts, ON_OFF)
    expect(counts).toEqual({
      total: 4,
      printing: 2,
      leftOut: 2,
      locked: 1,
      unavailable: 1,
      byState: { on: 1, off: 1 },
    })
    expect(contentsSummary(counts)).toBe('2 of 4 print')
  })

  it('says when every part prints and when nothing does', () => {
    expect(contentsSummary(contentsCounts([part('a'), part('b')], ON_OFF))).toBe('Every part prints')
    expect(contentsSummary(contentsCounts([part('a', { state: 'off' })], ON_OFF))).toBe('Nothing prints')
    expect(contentsSummary(contentsCounts([], ON_OFF))).toBe('Nothing prints')
  })

  it('counts a three-choice list by state', () => {
    const parts = [part('a', { state: 'package' }), part('b', { state: 'appendix' }), part('c', { state: 'omit' })]
    const counts = contentsCounts(parts, PLACEMENTS)
    expect(counts.byState).toEqual({ package: 1, appendix: 1, omit: 1 })
    expect(counts.printing).toBe(2)
    expect(onOffValues(PLACEMENTS)).toBeNull()
    expect(onOffValues(ON_OFF)).toEqual({ on: 'on', off: 'off' })
  })

  it('announces a move counting from 1', () => {
    expect(moveAnnouncement('Culvert schedule', 3, 1, 18)).toBe('Culvert schedule, moved from 4 to 2 of 18')
  })

  it('reads each part’s state by key', () => {
    expect(contentsStates([part('a'), part('b', { state: 'off' })])).toEqual({ a: 'on', b: 'off' })
  })
})

describe('orderedKeys', () => {
  it('applies a stored order', () => {
    expect(orderedKeys(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ keys: ['c', 'a', 'b'], unknown: [] })
  })

  it('keeps the default order when nothing is stored', () => {
    expect(orderedKeys(['a', 'b'], undefined)).toEqual({ keys: ['a', 'b'], unknown: [] })
  })

  it('drops ids no longer present and names them, never mapping them to another part', () => {
    expect(orderedKeys(['a', 'b', 'c'], ['c', 'gone', 'b', 'a', 'gone'])).toEqual({
      keys: ['c', 'b', 'a'],
      unknown: ['gone'],
    })
  })

  it('puts a new part after its nearest earlier default neighbour', () => {
    // Default a, b, new, c; stored c, a, b: the new part follows b wherever b went.
    expect(orderedKeys(['a', 'b', 'new', 'c'], ['c', 'a', 'b']).keys).toEqual(['c', 'a', 'b', 'new'])
    expect(orderedKeys(['a', 'b', 'new', 'c'], ['b', 'c', 'a']).keys).toEqual(['b', 'new', 'c', 'a'])
    // Two new parts in a row keep their default order.
    expect(orderedKeys(['a', 'n1', 'n2', 'b'], ['b', 'a']).keys).toEqual(['b', 'a', 'n1', 'n2'])
    // A new first part goes first.
    expect(orderedKeys(['new', 'a', 'b'], ['b', 'a']).keys).toEqual(['new', 'b', 'a'])
  })

  it('places a repeated stored id once', () => {
    expect(orderedKeys(['a', 'b'], ['b', 'b', 'a']).keys).toEqual(['b', 'a'])
  })
})
