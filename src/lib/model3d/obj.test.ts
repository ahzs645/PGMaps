import { describe, expect, it } from 'vitest'
import type { MeshPart, Model3d } from './model'
import { objName, writeObj } from './obj'

const square: MeshPart = {
  name: 'Finished surface',
  positions: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5],
  indices: [0, 1, 2, 0, 2, 3],
  color: [0.5, 0.25, 1],
  attributes: { surface: 'finished', from: '0+000.0' },
}
const smooth: MeshPart = {
  name: 'Crown',
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
  indices: [0, 1, 2],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  color: [0, 1, 0],
}
const model: Model3d = {
  name: 'Spur 7\nroad',
  parts: [square, smooth, { ...square, name: 'Same colour' }],
  origin: { kind: 'grid', epsg: 3005, easting: 1200000, northing: 950000, elevation: 700 },
  notes: ['Planning geometry.'],
}

/** Reads the statements back as an OBJ reader would. */
function parseObj(text: string) {
  const v: number[][] = [],
    vn: number[][] = [],
    f: string[][] = [],
    objects: string[] = [],
    uses: string[] = []
  let mtllib = ''
  for (const line of text.split('\n')) {
    const [op, ...rest] = line.trim().split(/\s+/)
    if (op === 'v') v.push(rest.map(Number))
    else if (op === 'vn') vn.push(rest.map(Number))
    else if (op === 'f') f.push(rest)
    else if (op === 'o') objects.push(rest.join(' '))
    else if (op === 'usemtl') uses.push(rest[0])
    else if (op === 'mtllib') mtllib = rest[0]
  }
  return { v, vn, f, objects, uses, mtllib }
}

describe('writeObj', () => {
  it('writes every vertex and face, 1-based, with normals where the part has them', () => {
    const { obj } = writeObj(model, 'spur-7.mtl')
    const { v, vn, f, objects, mtllib } = parseObj(obj)
    expect(v).toHaveLength(4 + 3 + 4)
    expect(vn).toHaveLength(3)
    expect(f).toHaveLength(2 + 1 + 2)
    expect(objects).toEqual(['Finished_surface', 'Crown', 'Same_colour'])
    expect(mtllib).toBe('spur-7.mtl')
    const corners = f.flat().map((c) => Number(c.split('/')[0]))
    expect(Math.min(...corners)).toBe(1)
    expect(Math.max(...corners)).toBe(v.length)
    // The smooth part's corners name their normal: "a//a".
    expect(f[2]).toEqual(['5//5', '6//6', '7//7'])
    // The third part's indices start after the first two parts' vertices.
    expect(f[3]).toEqual(['8', '9', '10'])
  })

  it('writes Y up with faces still facing up', () => {
    const { obj } = writeObj(model, 'm.mtl')
    const { v, f } = parseObj(obj)
    expect(v[2]).toEqual([10, 5, -10])
    for (const face of f.slice(0, 2)) {
      const [a, b, c] = face.map((x) => v[Number(x) - 1])
      const u = [0, 1, 2].map((k) => b[k] - a[k]),
        w = [0, 1, 2].map((k) => c[k] - a[k])
      expect(u[2] * w[0] - u[0] * w[2]).toBeGreaterThan(0)
    }
  })

  it('puts colours in the material library, one material per colour, and notes in comments', () => {
    const { obj, mtl } = writeObj(model, 'm.mtl')
    const { uses } = parseObj(obj)
    expect(uses).toEqual(['colour_1', 'colour_2', 'colour_1'])
    expect(mtl).toMatch(/newmtl colour_1\nKa 0 0 0\nKd 0.5000 0.2500 1.0000/)
    expect(mtl).toMatch(/newmtl colour_2/)
    expect(obj).toMatch(/^# Spur 7 road\n/)
    expect(obj).toMatch(/# Local \(0, 0, 0\) is EPSG:3005 easting 1200000/)
    expect(obj).toMatch(/# Planning geometry\./)
    expect(obj).toMatch(/o Finished_surface\n# surface: finished\n# from: 0\+000\.0\nusemtl colour_1/)
    expect(obj).toMatch(/s off/)
  })

  it('makes names safe and refuses an empty model', () => {
    expect(objName('a b#c\td')).toBe('a_b_c_d')
    expect(() => writeObj({ ...model, parts: [] }, 'm.mtl')).toThrow(/no triangles/)
  })
})
