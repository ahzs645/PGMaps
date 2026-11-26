import { describe, expect, it } from 'vitest'
import { forestPatchBatch } from './forestPatchBatches'

describe('forest patch batches', () => {
  it('keeps joined tree data when another layer or the placement priority changed', () => {
    const nearA = [1, 2]
    const nearB = [3]
    const near = forestPatchBatch(
      undefined,
      new Map([
        ['a', nearA],
        ['b', nearB],
      ]),
    )
    const far = forestPatchBatch(undefined, new Map([['c', [4]]]))
    expect(
      forestPatchBatch(
        near,
        new Map([
          ['b', nearB],
          ['a', nearA],
        ]),
      ),
    ).toBe(near)
    expect(forestPatchBatch(far, new Map([['c', [5]]]))).not.toBe(far)
  })

  it('uploads same-size replacements and clears departed bands', () => {
    const a = [1, 2]
    const b = [3, 4]
    const before = forestPatchBatch(
      undefined,
      new Map([
        ['a', a],
        ['b', b],
      ]),
    )
    expect(
      forestPatchBatch(
        before,
        new Map([
          ['a', a],
          ['b', [5, 6]],
        ]),
      ).items,
    ).toEqual([1, 2, 5, 6])
    expect(
      forestPatchBatch(
        before,
        new Map([
          ['a', a],
          ['c', b],
        ]),
      ),
    ).not.toBe(before)
    const empty = new Map<string, number[]>()
    const cleared = forestPatchBatch(before, empty)
    expect(cleared.items).toEqual([])
    expect(forestPatchBatch(cleared, empty)).toBe(cleared)
  })
})
