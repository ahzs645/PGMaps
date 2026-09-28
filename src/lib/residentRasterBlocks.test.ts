import { describe, expect, it } from 'vitest'
import { ResidentRasterBlocks } from './residentRasterBlocks'

describe('resident raster GPU blocks', () => {
  it('retains stable geometry for a round trip between levels, hiding the inactive level', () => {
    const cache = new ResidentRasterBlocks<object>()
    const overview = { id: 'overview/a', data: {} },
      full = { id: 'full/a', data: {} }
    cache.update([overview])
    expect(cache.update([full])).toEqual([
      { ...overview, visible: false },
      { ...full, visible: true },
    ])
    expect(cache.hasAll([overview])).toBe(true)
    expect(cache.get(overview.id)).toBe(overview.data)
    const back = cache.update([overview])
    expect(back.filter((block) => block.visible)).toEqual([{ ...overview, visible: true }])
    expect(back.find((block) => block.id === overview.id)!.data).toBe(overview.data)
  })
  it('bounds hidden blocks, pins visible blocks, and rejects changed or missing geometry', () => {
    const cache = new ResidentRasterBlocks<object>(1)
    const blocks = ['a', 'b', 'c'].map((id) => ({ id, data: {} }))
    expect(cache.update(blocks)).toHaveLength(3)
    cache.update([blocks[2]])
    expect(cache.hasAll([blocks[0]])).toBe(false)
    expect(cache.hasAll([blocks[1]])).toBe(true)
    expect(cache.hasAll([{ id: 'c', data: {} }])).toBe(false)
    cache.clear()
    expect(cache.hasAll([blocks[2]])).toBe(false)
  })
})
