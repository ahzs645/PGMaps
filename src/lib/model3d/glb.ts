/**
 * Binary glTF 2.0 (`.glb`) from a `Model3d`: one node per part (named, its attributes in `extras`)
 * under a root node named after the model, which carries the origin, the frame and the notes in
 * `extras`, as does the glTF root. One material per colour and sidedness, colours in linear light
 * as glTF requires. Positions are written Y up (glTF's frame), in metres.
 *
 * Adapted from GeoLibre's `encodeGlb` (`apps/geolibre-desktop/src/lib/extrusion-model.ts`, MIT):
 * the chunk layout and padding, Y-up rotation, linear colours and origin in the root's `extras`.
 * Written here: a buffer view per accessor (so parts with and without normals mix), 16-bit indices
 * where a part's vertices allow, optional normals, double-sided materials, and the checks.
 *
 * No DOM or network access.
 */
import { checkPart, drawableParts, originExtras, srgbToLinear, yUp, type MeshPart, type Model3d } from './model'

const GLB_MAGIC = 0x46546c67 // "glTF"
const CHUNK_JSON = 0x4e4f534a // "JSON"
const CHUNK_BIN = 0x004e4942 // "BIN\0"
const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const UNSIGNED_INT = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
/**
 * glTF forbids an index equal to its type's largest value (primitive restart), so 16-bit indices
 * serve a part of at most 65,535 vertices (indices 0–65,534).
 */
const MAX_SHORT_INDEXED_VERTICES = 0xffff

const align4 = (n: number) => Math.ceil(n / 4) * 4

/** Attribute values that survive JSON: a non-finite number becomes null. */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? {}, (_key, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)))
}

interface EncodedPart {
  part: MeshPart
  positions: Float32Array
  normals: Float32Array | null
  indices: Uint16Array | Uint32Array
  min: [number, number, number]
  max: [number, number, number]
}

function encodePart(part: MeshPart): EncodedPart {
  checkPart(part)
  const count = part.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = part.normals ? new Float32Array(count * 3) : null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i++) {
    const p = yUp(part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2])
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = p[k]
      // Bounds of the stored float32 values, as validators compare them.
      const stored = positions[i * 3 + k]
      if (stored < min[k]) min[k] = stored
      if (stored > max[k]) max[k] = stored
    }
    if (normals && part.normals) {
      const n = yUp(part.normals[i * 3], part.normals[i * 3 + 1], part.normals[i * 3 + 2])
      const length = Math.hypot(n[0], n[1], n[2])
      // glTF requires unit normals; a zero normal (a degenerate vertex) points up rather than fail validation.
      const unit = length > 0 ? n.map((v) => v / length) : [0, 1, 0]
      for (let k = 0; k < 3; k++) normals[i * 3 + k] = unit[k]
    }
  }
  const indices = count <= MAX_SHORT_INDEXED_VERTICES ? Uint16Array.from(part.indices) : Uint32Array.from(part.indices)
  return { part, positions, normals, indices, min, max }
}

/** The `.glb` bytes of a model. Throws when no part has a triangle. */
export function writeGlb(model: Model3d): Uint8Array {
  const { parts, empty } = drawableParts(model)
  if (!parts.length) throw Error(`${model.name} has no triangles to write.`)
  const encoded = parts.map(encodePart)

  const bufferViews: Record<string, unknown>[] = []
  const accessors: Record<string, unknown>[] = []
  const chunks: { bytes: Uint8Array; offset: number }[] = []
  let binLength = 0
  /** Adds a buffer view (each starting on a 4-byte boundary) and an accessor over all of it. */
  const add = (
    array: Float32Array | Uint16Array | Uint32Array,
    target: number,
    accessor: Record<string, unknown>,
  ): number => {
    binLength = align4(binLength)
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    chunks.push({ bytes, offset: binLength })
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, target })
    binLength += bytes.byteLength
    accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, ...accessor })
    return accessors.length - 1
  }

  const materials: Record<string, unknown>[] = []
  const materialIndex = new Map<string, number>()
  const meshes: Record<string, unknown>[] = []
  const nodes: Record<string, unknown>[] = []
  for (const { part, positions, normals, indices, min, max } of encoded) {
    const count = positions.length / 3
    const position = add(positions, ARRAY_BUFFER, { componentType: FLOAT, count, type: 'VEC3', min, max })
    const normal = normals ? add(normals, ARRAY_BUFFER, { componentType: FLOAT, count, type: 'VEC3' }) : null
    const index = add(indices, ELEMENT_ARRAY_BUFFER, {
      componentType: indices instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: indices.length,
      type: 'SCALAR',
    })
    const linear = part.color.map(srgbToLinear)
    const key = `${linear.map((c) => c.toFixed(4)).join(',')}|${part.doubleSided ? 2 : 1}`
    let material = materialIndex.get(key)
    if (material === undefined) {
      material = materials.length
      materialIndex.set(key, material)
      materials.push({
        name: `colour_${material + 1}`,
        pbrMetallicRoughness: { baseColorFactor: [...linear, 1], metallicFactor: 0, roughnessFactor: 0.9 },
        ...(part.doubleSided ? { doubleSided: true } : {}),
      })
    }
    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes: { POSITION: position, ...(normal !== null ? { NORMAL: normal } : {}) },
          indices: index,
          material,
          mode: 4,
        },
      ],
    })
    nodes.push({
      name: part.name,
      mesh: meshes.length - 1,
      ...(part.attributes ? { extras: jsonSafe(part.attributes) } : {}),
    })
  }
  const rootExtras = jsonSafe({
    ...originExtras(model),
    notes: [...model.notes, ...(empty.length ? [`Left out with no triangles: ${empty.join(', ')}.`] : [])],
    ...model.extras,
  })
  nodes.push({ name: model.name, children: nodes.map((_, i) => i), extras: rootExtras })
  binLength = align4(binLength)

  const gltf = {
    asset: { version: '2.0', generator: 'PGMaps' },
    extras: rootExtras,
    scene: 0,
    scenes: [{ name: model.name, nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  }

  // Both chunks are 4-byte aligned: JSON padded with spaces, BIN with zeros.
  const json = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonLength = align4(json.length)
  const total = 12 + 8 + jsonLength + 8 + binLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, CHUNK_JSON, true)
  out.set(json, 20)
  out.fill(0x20, 20 + json.length, 20 + jsonLength)
  const bin = 20 + jsonLength
  view.setUint32(bin, binLength, true)
  view.setUint32(bin + 4, CHUNK_BIN, true)
  for (const { bytes, offset } of chunks) out.set(bytes, bin + 8 + offset)
  return out
}
