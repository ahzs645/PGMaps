/**
 * The selection loop `largeLaz.worker.ts` runs: decode a batch of chunks and keep the records a selection asks
 * for. No DOM access; chunks arrive through `read`, so the unit tests run it on laz-perf's Node build.
 */
import type { LazPerf } from 'laz-perf'
import type { LazChunk } from '@/lib/lidar/lazChunkTable'
import type { Selection } from './largeLaz'

export interface DecodeBatch {
  compressed: boolean
  format: number
  length: number
  scale: [number, number, number]
  offset: [number, number, number]
  chunks: LazChunk[]
  selection: Selection
}

/** WASM buffers reused across batches: one chunk's compressed bytes and one decoded point. */
export interface DecodeScratch {
  input: number
  inputSize: number
  output: number
}
export const newScratch = (): DecodeScratch => ({ input: 0, inputSize: 0, output: 0 })

export async function decodeBatch(
  module: LazPerf | null,
  batch: DecodeBatch,
  read: (chunk: LazChunk) => Promise<Uint8Array>,
  scratch: DecodeScratch = newScratch(),
) {
  const { selection, scale, offset, length } = batch
  const expected = batch.chunks.reduce((n, c) => n + c.points, 0)
  const room = selection.kind === 'overview' ? Math.ceil(expected / selection.stride) + batch.chunks.length : expected
  let records = new Uint8Array(Math.max(1, Math.min(room, 4_000_000)) * length)
  let count = 0
  const keep = (bytes: Uint8Array, at: number) => {
    if ((count + 1) * length > records.byteLength) {
      const grown = new Uint8Array(records.byteLength * 2)
      grown.set(records)
      records = grown
    }
    records.set(bytes.subarray(at, at + length), count * length)
    count++
  }
  const box = selection.kind === 'area' ? selection.box : null
  // The box in the file's integer units, edges included, so the per-point test needs no floating-point maths.
  const ib = box && [
    Math.ceil((box[0] - offset[0]) / scale[0] - 1e-9),
    Math.ceil((box[1] - offset[1]) / scale[1] - 1e-9),
    Math.floor((box[2] - offset[0]) / scale[0] + 1e-9),
    Math.floor((box[3] - offset[1]) / scale[1] + 1e-9),
  ]
  const stride = selection.kind === 'overview' ? selection.stride : 1
  for (const chunk of batch.chunks) {
    const bytes = await read(chunk)
    if (bytes.byteLength !== chunk.bytes) throw Error('The file ended early. It may be truncated; download it again.')
    if (!batch.compressed || !module) {
      if (batch.compressed) throw Error('A LAZ decoder is needed for this file.')
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let i = 0, p = 0; i < chunk.points; i++, p += length) {
        if (ib) {
          const x = view.getInt32(p, true),
            y = view.getInt32(p + 4, true)
          if (x < ib[0] || x > ib[2] || y < ib[1] || y > ib[3]) continue
        } else if ((chunk.firstPoint + i) % stride) continue
        keep(bytes, p)
      }
      continue
    }
    if (bytes.byteLength > scratch.inputSize) {
      if (scratch.input) module._free(scratch.input)
      scratch.inputSize = Math.max(bytes.byteLength, scratch.inputSize * 2, 1 << 20)
      scratch.input = module._malloc(scratch.inputSize)
      if (!scratch.input) throw Error('Not enough browser memory to decode this file.')
    }
    // 64 bytes covers every LAS point format's record; the decoder writes one record here per point.
    if (!scratch.output) scratch.output = module._malloc(Math.max(64, length))
    const output = scratch.output
    module.HEAPU8.set(bytes, scratch.input)
    const decoder = new module.ChunkDecoder()
    try {
      decoder.open(batch.format, length, scratch.input)
      let heap = module.HEAPU8,
        ints = new Int32Array(heap.buffer)
      const slot = output >> 2
      for (let i = 0; i < chunk.points; i++) {
        decoder.getPoint(output)
        // Emscripten can grow the heap; never keep a view of the old buffer.
        if (heap.buffer !== module.HEAPU8.buffer) {
          heap = module.HEAPU8
          ints = new Int32Array(heap.buffer)
        }
        if (ib) {
          const x = ints[slot],
            y = ints[slot + 1]
          if (x < ib[0] || x > ib[2] || y < ib[1] || y > ib[3]) continue
        } else if ((chunk.firstPoint + i) % stride) continue
        keep(heap, output)
      }
    } finally {
      decoder.delete()
    }
  }
  return { records: records.slice(0, count * length), count, read: expected }
}
