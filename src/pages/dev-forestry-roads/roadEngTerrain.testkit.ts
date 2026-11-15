/**
 * Test support, never imported by the app: a synthetic RoadEng `Terrain1.ter` laid out as RoadEng
 * writes format version 12, for tests of `roadEngTerrain.ts` and what reads its output.
 */
import { strToU8 } from 'fflate'
// ---- A synthetic Terrain1.ter, laid out byte for byte as RoadEng writes version 12 ----------------

export type XYZ = [number, number, number]
export interface SynthFeature {
  name: string
  points: XYZ[]
  flags?: number
  colorRef?: number
  subId?: number
  origin?: number
  kind?: number
}
export interface SynthTin {
  /** (feature, point) pairs, without the three (-1, -1) placeholders, which are added. */
  vertices: [number, number][]
  /** Clockwise, as stored, indices into `vertices` (the placeholders are added to them). */
  triangles: [number, number, number][]
}

export class Writer {
  bytes: number[] = []
  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff)
  }
  u32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0, true)
    this.bytes.push(...b)
  }
  i32(v: number) {
    this.u32(v >>> 0)
  }
  f64(v: number) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    this.bytes.push(...b)
  }
  str(s: string, width: number) {
    const b = strToU8(s, true)
    for (let k = 0; k < width; k++) this.bytes.push(k < b.length ? b[k] : 0)
  }
  raw(b: Uint8Array | number[]) {
    this.bytes.push(...b)
  }
}

const box = (pts: XYZ[]) => [
  Math.min(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[0])),
  Math.min(...pts.map((p) => p[1])),
  Math.max(...pts.map((p) => p[1])),
  Math.min(...pts.map((p) => p[2])),
  Math.max(...pts.map((p) => p[2])),
]
export const planLength = (pts: XYZ[]) =>
  pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0)

export function chunk(type: number, tag: number, payload: Uint8Array | number[]) {
  const w = new Writer()
  w.u32(16 + payload.length)
  w.u32(2)
  w.u32(type)
  w.i32(tag)
  w.raw(payload)
  return w.bytes
}

export function buildTer({
  features,
  tin,
  codes = ['Sml Stream', 'Road CL', 'Landing'],
  attributes = [],
  version = 12,
}: {
  features: SynthFeature[]
  tin?: SynthTin
  codes?: string[]
  attributes?: number[]
  version?: number
}): Uint8Array {
  const all = features.flatMap((f) => f.points)
  const s0 = new Writer()
  s0.u32(features.length)
  s0.i32(-1)
  s0.i32(-1)
  s0.u32(0)
  s0.u32(codes.length)
  for (let k = 0; k < 32; k++) {
    s0.u16(k < codes.length ? 1 : 0)
    s0.str(codes[k] ?? '', 256)
  }
  s0.u32(0)
  for (const v of box(all)) s0.f64(v)
  s0.raw(new Array(8).fill(0))
  const s1 = new Writer()
  const s2 = new Writer()
  for (const f of features) {
    s1.u32(f.points.length)
    s1.u32(f.subId ?? 0)
    s1.u32(0)
    s1.u32(f.colorRef ?? 0)
    s1.f64(f.origin ?? 0)
    s1.f64((f.origin ?? 0) + planLength(f.points))
    for (const v of box(f.points)) s1.f64(v)
    s1.u16(f.flags ?? 0)
    s1.u16(0)
    s1.u16(f.kind ?? 1)
    s1.str(f.name, 18)
    for (const [x, y, z] of f.points) {
      s2.f64(x)
      s2.f64(y)
      s2.f64(z)
      s2.u32(0)
      s2.u32(0xcdcdcdcd) // uninitialised padding, as in the samples
      s2.raw(new Array(8).fill(0))
    }
  }
  const s3 = attributes
  const s4 = new Writer()
  const s5 = new Writer()
  const s6 = new Writer()
  const s7 = new Writer()
  s4.raw(new Array(64).fill(0))
  if (tin) {
    const head = new DataView(new Uint8Array(s4.bytes).buffer)
    head.setUint16(0, 1, true)
    head.setUint32(4, tin.vertices.length + 3, true)
    head.setUint32(16, tin.triangles.length, true)
    head.setFloat64(56, 150, true)
    s4.bytes = [...new Uint8Array(head.buffer)]
    for (let k = 0; k < 3; k++) {
      s5.i32(-1)
      s5.i32(-1)
    }
    for (const [f, p] of tin.vertices) {
      s5.i32(f)
      s5.i32(p)
    }
    for (const t of tin.triangles) {
      for (const v of t) s6.i32(v + 3)
      s6.u32(0)
      s7.raw(new Array(16).fill(0xff))
    }
  }
  const s8 = new Array(1248).fill(0)
  const sections = [s0.bytes, s1.bytes, s2.bytes, s3, s4.bytes, s5.bytes, s6.bytes, s7.bytes, s8]
  const out = new Writer()
  out.u16(version)
  for (const s of sections) out.u32(s.length)
  for (const s of sections) out.raw(s)
  out.raw(new Array(24).fill(0))
  return new Uint8Array(out.bytes)
}

// Four corners of a 10 m square on a 2 % slope, a contour along it, a LiDAR point set, a closed
// boundary ring, and a C-Line that came from a design starting at station -25.
