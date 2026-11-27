import { describe, expect, it } from 'vitest'

import { keepOnlyPatchPlacement, patchCacheFor, releasePatchPlacements } from './forestPatches'

describe('the placed patches kept for a stand placement', () => {
  it('hands back the same map when a placement comes back, and a new one for a new placement', () => {
    const kept: Array<{ placement: readonly unknown[]; patches: Map<string, number[]> }> = []
    const after = { openings: [1] }
    const before = { openings: [] }
    const first = patchCacheFor(kept, [53.9, after])
    first.set('p1', [1, 2])
    const other = patchCacheFor(kept, [53.9, before])
    expect(other).not.toBe(first)
    // Back to the after phase: its patches are found again, not grown a third time.
    expect(patchCacheFor(kept, [53.9, after])).toBe(first)
    expect(first.get('p1')).toEqual([1, 2])
    // Equal contents in another array are another placement: identity decides.
    expect(patchCacheFor(kept, [53.9, { openings: [1] }])).not.toBe(first)
  })

  it('keeps only the last two placements', () => {
    const kept: Array<{ placement: readonly unknown[]; patches: Map<string, number[]> }> = []
    const a = patchCacheFor(kept, ['a'])
    patchCacheFor(kept, ['b'])
    patchCacheFor(kept, ['c'])
    expect(kept).toHaveLength(2)
    expect(patchCacheFor(kept, ['a'])).not.toBe(a)
  })

  it('lets go of every placement but the one drawn now, then keeps two again', () => {
    const kept: Array<{ placement: readonly unknown[]; patches: Map<string, number[]> }> = []
    const after = ['after']
    const before = ['before']
    const drawn = patchCacheFor(kept, after)
    drawn.set('p1', [1])
    const beforePatches = patchCacheFor(kept, before)
    // The before-harvest render is taken and the road view is back on the after phase.
    expect(patchCacheFor(kept, after)).toBe(drawn)
    expect(keepOnlyPatchPlacement(kept, drawn)).toBe(1)
    expect(kept.map((entry) => entry.placement)).toEqual([after])
    // The after stand is still the one found; the before phase is grown again only if asked for.
    expect(patchCacheFor(kept, after)).toBe(drawn)
    expect(patchCacheFor(kept, before)).not.toBe(beforePatches)
    expect(patchCacheFor(kept, after)).toBe(drawn)
    expect(kept).toHaveLength(2)
    // Nothing kept is the one drawn: all go.
    expect(keepOnlyPatchPlacement(kept, new Map())).toBe(2)
    expect(kept).toHaveLength(0)
  })

  it('empties every placement for an engine render, keeping the drawn map to grow again', () => {
    const kept: Array<{ placement: readonly unknown[]; patches: Map<string, number[]> }> = []
    const after = ['after']
    const before = ['before']
    const drawn = patchCacheFor(kept, after)
    drawn.set('p1', [1]).set('p2', [2])
    patchCacheFor(kept, before).set('p1', [3])
    expect(patchCacheFor(kept, after)).toBe(drawn)
    const stems = drawn.get('p1')
    expect(releasePatchPlacements(kept, drawn)).toBe(3)
    expect(drawn.size).toBe(0)
    expect(kept.map((entry) => entry.placement)).toEqual([after])
    // The same placement hands back the same (now empty) map, which the stand fills again.
    expect(patchCacheFor(kept, after)).toBe(drawn)
    drawn.set('p1', [1])
    // The arrays let go were not touched: a stem regrown is placed as it was.
    expect(stems).toEqual([1])
    expect(releasePatchPlacements(kept, null)).toBe(1)
    expect(kept).toHaveLength(0)
  })
})
