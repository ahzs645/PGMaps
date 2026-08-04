import { describe, expect, it } from 'vitest'
import {
  createLingerState,
  dropLingering,
  foldLingerState,
  setLingerPhase,
  toLingerList,
  type LingerState,
} from './lingering'

interface Item {
  id: string
}

const keyOf = (item: Item) => item.id
const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }))
const phases = (state: LingerState<Item>) =>
  Object.fromEntries(toLingerList(state, keyOf).map((entry) => [entry.key, entry.phase]))

describe('foldLingerState', () => {
  it('holds an item that drops out of the set', () => {
    const first = createLingerState(items('a', 'b'))
    const second = foldLingerState(first, items('a'), keyOf)

    expect(phases(second)).toEqual({ a: 'present', b: 'held' })
  })

  it('stops holding an item that comes back', () => {
    const first = createLingerState(items('a', 'b'))
    const dropped = foldLingerState(first, items('a'), keyOf)
    const restored = foldLingerState(dropped, items('a', 'b'), keyOf)

    expect(phases(restored)).toEqual({ a: 'present', b: 'present' })
    expect(restored.held.size).toBe(0)
  })

  it('keeps a fading item held rather than restarting it', () => {
    const first = createLingerState(items('a', 'b'))
    const dropped = foldLingerState(first, items('a'), keyOf)
    const fading = setLingerPhase(dropped, 'b', 'leaving')
    // An unrelated update should not reset b's phase back to 'held'.
    const later = foldLingerState(fading, items('a', 'c'), keyOf)

    expect(later.held.get('b')?.phase).toBe('leaving')
  })

  it('holds an item across several folds until it is dropped', () => {
    let state = createLingerState(items('a', 'b'))
    state = foldLingerState(state, items('a'), keyOf)
    state = foldLingerState(state, items('a'), keyOf)

    expect(phases(state)).toEqual({ a: 'present', b: 'held' })

    state = dropLingering(state, 'b')
    expect(phases(state)).toEqual({ a: 'present' })
  })

  it('does not resurrect an item that was already dropped', () => {
    let state = createLingerState(items('a', 'b'))
    state = foldLingerState(state, items('a'), keyOf)
    state = dropLingering(state, 'b')
    state = foldLingerState(state, items('a'), keyOf)

    expect(phases(state)).toEqual({ a: 'present' })
  })

  it('holds an entire set that empties at once', () => {
    const first = createLingerState(items('a', 'b', 'c'))
    const emptied = foldLingerState(first, [], keyOf)

    expect(phases(emptied)).toEqual({ a: 'held', b: 'held', c: 'held' })
  })

  it('leaves identity alone when nothing changes phase', () => {
    const first = createLingerState(items('a', 'b'))
    const dropped = foldLingerState(first, items('a'), keyOf)

    expect(setLingerPhase(dropped, 'b', 'held')).toBe(dropped)
    expect(setLingerPhase(dropped, 'missing', 'leaving')).toBe(dropped)
    expect(dropLingering(dropped, 'missing')).toBe(dropped)
  })
})
