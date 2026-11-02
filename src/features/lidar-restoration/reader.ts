/** Sequential LAS/LAZ reader. Only the compressed input and one decoded point live in WASM. */
import type { LazPerf } from 'laz-perf'
import { readPointCloudHeader } from '@/lib/lidar/lasHeader'
import type { ReturnPoint } from './model'

export async function openPointReader(bytes: Uint8Array, createLaz: () => Promise<LazPerf>) {
  const header = readPointCloudHeader(bytes)
  const module = header.compressed ? await createLaz() : null
  const input = module ? module._malloc(bytes.length) : 0
  const output = module ? module._malloc(header.pointLength) : 0
  if (module && (!input || !output)) {
    if (input) module._free(input)
    if (output) module._free(output)
    throw Error('Not enough browser memory to decode this file. Crop it in GIS and retry.')
  }
  if (module) module.HEAPU8.set(bytes, input)
  let disposed = false
  return {
    header,
    scan(visit: (p: ReturnPoint) => void, progress?: (done: number, total: number) => void) {
      if (disposed) throw Error('The point reader has been closed.')
      const decoder = module ? new module.LASZip() : null
      try {
        if (decoder) {
          decoder.open(input, bytes.length)
          if (
            decoder.getCount() !== header.points ||
            decoder.getPointLength() !== header.pointLength ||
            decoder.getPointFormat() !== header.pointFormat
          )
            throw Error('LAZ decoder metadata does not match the file header.')
        }
        const modern = header.pointFormat >= 6
        const point: ReturnPoint = { x: 0, y: 0, z: 0, classification: 0, first: false, withheld: false }
        let view = module
          ? new DataView(module.HEAPU8.buffer)
          : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        for (let i = 0; i < header.points; i++) {
          decoder?.getPoint(output)
          // Emscripten can grow the heap; never retain a detached view.
          if (module && view.buffer !== module.HEAPU8.buffer) view = new DataView(module.HEAPU8.buffer)
          const at = decoder ? output : header.pointOffset + i * header.pointLength
          point.x = view.getInt32(at, true) * header.scale[0] + header.offset[0]
          point.y = view.getInt32(at + 4, true) * header.scale[1] + header.offset[1]
          point.z = view.getInt32(at + 8, true) * header.scale[2] + header.offset[2]
          point.classification = view.getUint8(at + (modern ? 16 : 15)) & (modern ? 255 : 31)
          point.first = (view.getUint8(at + 14) & (modern ? 15 : 7)) === 1
          point.withheld = Boolean(view.getUint8(at + 15) & (modern ? 4 : 128))
          visit(point)
          if (i % 250_000 === 0) progress?.(i, header.points)
        }
        progress?.(header.points, header.points)
      } finally {
        decoder?.delete()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (module) {
        module._free(output)
        module._free(input)
      }
    },
  }
}
