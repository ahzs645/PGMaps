import { describe, expect, it } from 'vitest'
import type { Model3d } from './model'
import { writeStl } from './stl'

const model: Model3d = {
  name: 'Spur 7 — subgrade',
  parts: [
    {
      name: 'Pad',
      positions: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5],
      indices: [0, 1, 2, 0, 2, 3],
      color: [1, 0, 0],
    },
    { name: 'Wall', positions: [0, 0, 0, 1, 0, 0, 1, 0, 1], indices: [0, 1, 2], color: [0, 0, 1] },
    { name: 'Empty', positions: [], indices: [], color: [0, 0, 0] },
  ],
  origin: { kind: 'grid', epsg: 3005, easting: 1200000.25, northing: 950000, elevation: 700 },
  notes: [],
}

describe('writeStl', () => {
  it('writes the binary layout: header, count, 50 bytes a facet', () => {
    const bytes = writeStl(model)
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(80, true)).toBe(3)
    expect(bytes.byteLength).toBe(84 + 3 * 50)
    const header = new TextDecoder().decode(bytes.subarray(0, 80))
    // A header starting "solid" makes readers take the file for ASCII STL.
    expect(header.startsWith('solid')).toBe(false)
    expect(header).toMatch(/^PGMaps Spur 7 _ subgrade; metres, Z up; origin EPSG:3005 E1200000.3 N950000.0/)
    expect([...bytes.subarray(0, 80)].every((b) => b >= 0x20 && b < 0x7f)).toBe(true)
  })

  it('stays Z up, with each facet normal worked out from its counter-clockwise corners', () => {
    const view = new DataView(writeStl(model).buffer)
    const facet = (i: number) => Array.from({ length: 12 }, (_, k) => view.getFloat32(84 + i * 50 + k * 4, true))
    const first = facet(0)
    expect(first.slice(0, 3)).toEqual([0, 0, 1])
    expect(first.slice(3, 12)).toEqual([0, 0, 5, 10, 0, 5, 10, 10, 5])
    // The wall stands along x and faces −y (south).
    expect(facet(2).slice(0, 3)).toEqual([0, -1, 0])
  })
})
