import { describe, expect, it } from 'vitest'
import { writeGlb } from './glb'
import { srgbToLinear, type MeshPart, type Model3d } from './model'

/** A 10 m square 5 m up, two triangles counter-clockwise from above (so facing up), no normals. */
const square: MeshPart = {
  name: 'Pad',
  positions: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5],
  indices: [0, 1, 2, 0, 2, 3],
  color: [0.5, 0.25, 1],
  doubleSided: true,
  attributes: { surface: 'subgrade', faces: 2, bad: NaN },
}
/** A smooth-shaded tetrahedron-ish cap with its own normals. */
const cap: MeshPart = {
  name: 'Cap with spaces',
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  normals: [0, 0, 2, 0, 0, 1, 0, 0, 1],
  color: [0, 1, 0],
}
const model = (parts: MeshPart[]): Model3d => ({
  name: 'Test model',
  parts,
  origin: { kind: 'grid', epsg: 3005, easting: 1200000, northing: 950000, elevation: 700, verticalDatum: 'CGVD2013' },
  notes: ['Display only.'],
  extras: { camera: { position: [0, 0, 2] } },
})

interface Gltf {
  asset: { version: string }
  extras: Record<string, unknown>
  scenes: { nodes: number[] }[]
  nodes: { name: string; mesh?: number; children?: number[]; extras?: Record<string, unknown> }[]
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[]
  materials: { pbrMetallicRoughness: { baseColorFactor: number[] }; doubleSided?: boolean }[]
  accessors: {
    bufferView: number
    byteOffset: number
    componentType: number
    count: number
    type: string
    min?: number[]
    max?: number[]
  }[]
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[]
  buffers: { byteLength: number }[]
}

/** Reads a GLB back by the spec: header, JSON chunk, BIN chunk. */
function readGlb(bytes: Uint8Array): { gltf: Gltf; bin: DataView; read: (accessor: number) => number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x46546c67)
  expect(view.getUint32(4, true)).toBe(2)
  expect(view.getUint32(8, true)).toBe(bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  expect(jsonLength % 4).toBe(0)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf
  const binAt = 20 + jsonLength
  const binLength = view.getUint32(binAt, true)
  expect(binLength % 4).toBe(0)
  expect(view.getUint32(binAt + 4, true)).toBe(0x004e4942)
  expect(binAt + 8 + binLength).toBe(bytes.byteLength)
  expect(gltf.buffers).toEqual([{ byteLength: binLength }])
  const bin = new DataView(bytes.buffer, bytes.byteOffset + binAt + 8, binLength)
  const size = { 5126: 4, 5125: 4, 5123: 2 } as Record<number, number>
  const width = { VEC3: 3, SCALAR: 1 } as Record<string, number>
  const read = (index: number) => {
    const a = gltf.accessors[index]
    const bv = gltf.bufferViews[a.bufferView]
    const n = a.count * width[a.type]
    expect(a.byteOffset + n * size[a.componentType]).toBeLessThanOrEqual(bv.byteLength)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const at = bv.byteOffset + a.byteOffset + i * size[a.componentType]
      out.push(
        a.componentType === 5126
          ? bin.getFloat32(at, true)
          : a.componentType === 5125
            ? bin.getUint32(at, true)
            : bin.getUint16(at, true),
      )
    }
    return out
  }
  for (const bv of gltf.bufferViews) {
    expect(bv.byteOffset % 4).toBe(0)
    expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(binLength)
  }
  return { gltf, bin, read }
}

const cross = (p: number[], a: number, b: number, c: number) => {
  const u = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k])
  const v = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k])
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
}

describe('writeGlb', () => {
  it('writes a valid GLB: aligned chunks, accessors with bounds, indices in range', () => {
    const { gltf, read } = readGlb(writeGlb(model([square, cap])))
    expect(gltf.asset.version).toBe('2.0')
    expect(gltf.meshes.map((m) => m.name)).toEqual(['Pad', 'Cap with spaces'])
    for (const mesh of gltf.meshes) {
      const [primitive] = mesh.primitives
      const positions = read(primitive.attributes.POSITION)
      const accessor = gltf.accessors[primitive.attributes.POSITION]
      expect(accessor.count).toBe(positions.length / 3)
      for (let k = 0; k < 3; k++) {
        const values = positions.filter((_, i) => i % 3 === k)
        expect(accessor.min![k]).toBe(Math.min(...values))
        expect(accessor.max![k]).toBe(Math.max(...values))
      }
      const indices = read(primitive.indices)
      expect(gltf.accessors[primitive.indices].componentType).toBe(5123)
      expect(indices.length % 3).toBe(0)
      for (const i of indices) expect(i).toBeLessThan(accessor.count)
    }
  })

  it('turns Z up into Y up and keeps faces facing up', () => {
    const { gltf, read } = readGlb(writeGlb(model([square])))
    const [primitive] = gltf.meshes[0].primitives
    const p = read(primitive.attributes.POSITION)
    // (10, 10, 5) east, north, up → (10, 5, −10) in glTF.
    expect(p.slice(6, 9)).toEqual([10, 5, -10])
    const indices = read(primitive.indices)
    for (let t = 0; t < indices.length; t += 3) {
      const n = cross(p, indices[t], indices[t + 1], indices[t + 2])
      expect(n[1]).toBeGreaterThan(0)
      expect(Math.abs(n[0]) + Math.abs(n[2])).toBe(0)
    }
    // Flat-shaded: no normals written, so readers must shade it flat.
    expect(primitive.attributes.NORMAL).toBeUndefined()
  })

  it('writes unit normals, linear colours, sidedness, names, attributes and the origin', () => {
    const { gltf, read } = readGlb(writeGlb(model([square, cap])))
    const normals = read(gltf.meshes[1].primitives[0].attributes.NORMAL)
    for (let i = 0; i < normals.length; i += 3)
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 6)
    // Up (z) in the source is +y in glTF.
    expect(normals.slice(0, 3).map((v) => v + 0)).toEqual([0, 1, 0])
    const [pad, capMaterial] = gltf.meshes.map((m) => gltf.materials[m.primitives[0].material])
    expect(pad.doubleSided).toBe(true)
    expect(capMaterial.doubleSided).toBeUndefined()
    expect(pad.pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(srgbToLinear(0.5), 6)
    expect(pad.pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(0.214, 3)
    expect(gltf.nodes[0]).toMatchObject({ name: 'Pad', mesh: 0, extras: { surface: 'subgrade', faces: 2, bad: null } })
    const root = gltf.nodes[gltf.scenes[0].nodes[0]]
    expect(root.children).toEqual([0, 1])
    expect(root.extras).toMatchObject({
      origin: { kind: 'grid', epsg: 3005, easting: 1200000, northing: 950000, elevation: 700 },
      units: 'metres',
      notes: ['Display only.'],
      camera: { position: [0, 0, 2] },
    })
    expect(gltf.extras).toEqual(root.extras)
  })

  it('switches to 32-bit indices past 65,535 vertices', () => {
    const count = 70_000
    const positions: number[] = [],
      indices: number[] = []
    for (let i = 0; i < count; i++) positions.push(i % 2, Math.floor(i / 2), 0)
    for (let i = 0; i + 2 < count; i += 2) indices.push(i, i + 1, i + 2)
    const { gltf, read } = readGlb(writeGlb(model([{ name: 'Strip', positions, indices, color: [1, 1, 1] }])))
    const accessor = gltf.accessors[gltf.meshes[0].primitives[0].indices]
    expect(accessor.componentType).toBe(5125)
    expect(Math.max(...read(gltf.meshes[0].primitives[0].indices))).toBe(count - 2)
  })

  it('leaves out an empty part, says so, and refuses a broken one or an empty model', () => {
    const { gltf } = readGlb(
      writeGlb(model([square, { name: 'Nothing', positions: [], indices: [], color: [0, 0, 0] }])),
    )
    expect(gltf.meshes).toHaveLength(1)
    expect(gltf.extras.notes).toContain('Left out with no triangles: Nothing.')
    expect(() => writeGlb(model([]))).toThrow(/no triangles/)
    expect(() => writeGlb(model([{ ...square, indices: [0, 1, 9] }]))).toThrow(/outside its 4 vertices/)
    expect(() => writeGlb(model([{ ...square, positions: [0, 0, NaN, 1, 0, 0, 0, 1, 0] }]))).toThrow(/not a number/)
  })
})
