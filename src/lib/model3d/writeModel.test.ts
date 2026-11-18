import { describe, expect, it } from 'vitest'
import { fileBaseName, hexColor, originDescription, type Model3d } from './model'
import { MODEL_FORMATS, writeModel } from './writeModel'

const model: Model3d = {
  name: 'Spur 7: design surfaces',
  parts: [
    { name: 'Pad', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], color: hexColor('#a07845') },
    { name: 'Empty', positions: [], indices: [], color: [0, 0, 0] },
  ],
  origin: { kind: 'lonlat', longitude: -122.8, latitude: 53.9, elevation: 701.5 },
  notes: ['Display only.'],
}

describe('writeModel', () => {
  it('returns one file for glb and stl and the obj with its mtl', () => {
    const glb = writeModel(model, 'glb')
    expect(glb.files.map((f) => [f.name, f.mime])).toEqual([['Spur-7-design-surfaces.glb', 'model/gltf-binary']])
    expect(glb.extension).toBe('.glb')
    expect(glb.mime).toBe(MODEL_FORMATS.glb.mime)
    const stl = writeModel(model, 'stl', 'road')
    expect(stl.files.map((f) => f.name)).toEqual(['road.stl'])
    expect(stl.files[0].bytes.byteLength).toBe(84 + 50)
    const obj = writeModel(model, 'obj', 'road')
    expect(obj.files.map((f) => [f.name, f.mime])).toEqual([
      ['road.obj', 'model/obj'],
      ['road.mtl', 'model/mtl'],
    ])
    expect(new TextDecoder().decode(obj.files[0].bytes)).toMatch(/^mtllib road\.mtl$/m)
  })

  it("carries the model's notes, the origin, what the format leaves out and empty parts", () => {
    const { notes } = writeModel(model, 'stl')
    expect(notes[0]).toBe('Display only.')
    expect(notes).toContain(originDescription(model.origin))
    expect(notes.join(' ')).toMatch(/no colours, names or attributes/)
    expect(notes).toContain('Left out with no triangles: Empty.')
  })

  it('reads colours and names', () => {
    expect(hexColor('#ff0000')).toEqual([1, 0, 0])
    expect(hexColor('0f0')).toEqual([0, 1, 0])
    expect(() => hexColor('red')).toThrow()
    expect(fileBaseName(' a/b: c ')).toBe('a-b-c')
    expect(originDescription(model.origin)).toMatch(/longitude -122.8000000, latitude 53.9000000, elevation 701.500 m/)
  })
})
