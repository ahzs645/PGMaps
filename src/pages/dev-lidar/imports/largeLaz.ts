/**
 * Large LAS/LAZ files, read a chunk at a time. No DOM or network access: the file is any `ImportFile`, and the
 * point decoding happens in `largeLaz.worker.ts`.
 *
 * A file too large to load whole (a BC 1:2,500 point cloud tile is 0.5–1 GB and 100–160 million points) is
 * read once and reduced to either an even overview of the whole tile or every point inside one area. The
 * result is written as an ordinary uncompressed LAS with the source's header, CRS records and point format,
 * small enough for the map's whole-file loader.
 */
import { readPointCloudHeader, type PointCloudHeader, type Vlr } from '@/lib/lidar/lasHeader'
import {
  LASZIP_RECORD,
  LASZIP_USER,
  chunkTableOffset,
  parseLaszipVlr,
  readChunkTable,
  type LazChunk,
} from '@/lib/lidar/lazChunkTable'
import { checkAborted, type ImportFile } from './types'

/** Points kept for the whole-tile overview. The map's whole-file loader handles this many comfortably. */
export const OVERVIEW_POINTS = 2_000_000
/** Points kept for a full-detail area. A hectare of a BC 8 pts/m² tile is roughly 0.5–1 million points. */
export const DETAIL_POINTS = 3_000_000
/** Points per synthetic chunk when an uncompressed LAS is read in slices. */
const PLAIN_CHUNK_POINTS = 50_000
const MAX_METADATA = 16 * 1024 * 1024
const MAX_CHUNK_TABLE = 64 * 1024 * 1024

export interface LargeLazPlan {
  name: string
  header: PointCloudHeader
  /** The source's header and VLRs, bytes 0 to the point data. */
  metadata: Uint8Array
  /** CRS records found only in LAS 1.4 extended VLRs; they become ordinary VLRs in the written file. */
  extraCrs: Vlr[]
  chunks: LazChunk[]
  epsg: number | null
}

/** Native-CRS box: [minX, minY, maxX, maxY]. */
export type NativeBox = [number, number, number, number]

export type Selection = { kind: 'overview'; stride: number } | { kind: 'area'; box: NativeBox; limit: number }

/** Read the header, VLRs and chunk table. Only metadata is read here, never point data. */
export async function planLargeLaz(
  file: ImportFile,
  { epsg, crsRecords }: { epsg: number | null; crsRecords: Vlr[] },
  signal?: AbortSignal,
): Promise<LargeLazPlan> {
  checkAborted(signal)
  const prefix = new Uint8Array(await file.slice(0, 375).arrayBuffer())
  const pointOffset = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(96, true)
  if (pointOffset > MAX_METADATA || pointOffset > file.size) throw Error('Invalid LAS header or truncated point data')
  const metadata = new Uint8Array(await file.slice(0, pointOffset).arrayBuffer())
  const header = readPointCloudHeader(metadata, { headerOnly: true })
  const records = rawVlrs(metadata)
  const extraCrs = records.some((r) => r.user === 'LASF_Projection') ? [] : crsRecords
  let chunks: LazChunk[]
  if (!header.compressed) {
    if (pointOffset + header.points * header.pointLength > file.size) throw Error('Truncated LAS point records')
    chunks = []
    for (let first = 0; first < header.points; first += PLAIN_CHUNK_POINTS) {
      const points = Math.min(PLAIN_CHUNK_POINTS, header.points - first)
      chunks.push({
        start: pointOffset + first * header.pointLength,
        bytes: points * header.pointLength,
        points,
        firstPoint: first,
      })
    }
  } else {
    const laszip = records.find((r) => r.user === LASZIP_USER && r.record === LASZIP_RECORD)
    if (!laszip) throw Error('This LAZ file has no LASzip record, so it cannot be read in chunks.')
    const { compressor, chunkSize } = parseLaszipVlr(laszip.data)
    if (compressor !== 2 && compressor !== 3)
      throw Error(
        'This LAZ file was compressed without chunks, so a browser cannot read it a piece at a time. Convert it to COPC (pdal translate in.laz out.copc.laz --writers.copc) and import that.',
      )
    checkAborted(signal)
    const pointer = new Uint8Array(await file.slice(pointOffset, pointOffset + 8).arrayBuffer())
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 8)).arrayBuffer())
    const tableOffset = chunkTableOffset(pointer, tail)
    if (tableOffset === null || tableOffset <= pointOffset || tableOffset >= file.size)
      throw Error('This LAZ file has no chunk table. It may be truncated; download it again.')
    const end = Math.min(file.size, tableOffset + MAX_CHUNK_TABLE)
    const table = new Uint8Array(await file.slice(tableOffset, end).arrayBuffer())
    chunks = readChunkTable(table, { pointOffset, tableOffset, chunkSize, totalPoints: header.points })
  }
  checkAborted(signal)
  return { name: file.name, header, metadata, extraCrs, chunks, epsg }
}

/** Keep one point in `stride` so about `target` points spread over the whole file. */
export const overviewStride = (points: number, target = OVERVIEW_POINTS) => Math.max(1, Math.ceil(points / target))

/** The file's horizontal extent in its own CRS. */
export const planBox = ({ header }: LargeLazPlan): NativeBox => [
  header.min[0],
  header.min[1],
  header.max[0],
  header.max[1],
]

/** The part of `box` inside the file's extent, or null when they do not overlap. */
export function clipBox(plan: LargeLazPlan, box: NativeBox): NativeBox | null {
  const [x0, y0, x1, y1] = planBox(plan)
  const clipped: NativeBox = [Math.max(x0, box[0]), Math.max(y0, box[1]), Math.min(x1, box[2]), Math.min(y1, box[3])]
  return clipped[0] < clipped[2] && clipped[1] < clipped[3] ? clipped : null
}

/** Points expected inside `box`, assuming the file's points spread evenly over its extent. */
export function estimateArea(plan: LargeLazPlan, box: NativeBox): number {
  const clipped = clipBox(plan, box)
  if (!clipped) return 0
  const [x0, y0, x1, y1] = planBox(plan)
  const whole = (x1 - x0) * (y1 - y0)
  return whole > 0
    ? Math.round((plan.header.points * (clipped[2] - clipped[0]) * (clipped[3] - clipped[1])) / whole)
    : 0
}

/**
 * Write the kept records as an uncompressed LAS: the source header with its counts, extent and compression
 * flag updated, every VLR except LASzip's and COPC's, and the source's own point format and record length.
 */
export function writeLas(plan: LargeLazPlan, records: Uint8Array, count: number): Uint8Array {
  const { header, metadata } = plan
  const length = header.pointLength
  if (records.byteLength !== count * length) throw Error('Point records do not match their count.')
  const source = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength)
  const headerSize = source.getUint16(94, true)
  const kept = rawVlrs(metadata).filter(
    (v) => !(v.user === LASZIP_USER && v.record === LASZIP_RECORD) && v.user !== 'copc',
  )
  const extra = plan.extraCrs.filter((v) => v.data.byteLength <= 0xffff).map(vlrBytes)
  const vlrs = [...kept.map((v) => v.raw), ...extra]
  const vlrLength = vlrs.reduce((n, v) => n + v.byteLength, 0)
  const pointOffset = headerSize + vlrLength
  const out = new Uint8Array(pointOffset + records.byteLength)
  out.set(metadata.subarray(0, headerSize))
  let at = headerSize
  for (const v of vlrs) {
    out.set(v, at)
    at += v.byteLength
  }
  out.set(records, pointOffset)
  const view = new DataView(out.buffer)
  out[104] = header.pointFormat
  view.setUint32(96, pointOffset, true)
  view.setUint32(100, vlrs.length, true)
  const software = new TextEncoder().encode('PGMaps chunked LAS reader')
  out.fill(0, 58, 90)
  out.set(software.subarray(0, 32), 58)
  // Extent and returns from the kept points.
  const modern = header.pointFormat >= 6
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  const returns = new Array<number>(15).fill(0)
  const points = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let i = 0, p = 0; i < count; i++, p += length) {
    for (let a = 0; a < 3; a++) {
      const v = points.getInt32(p + a * 4, true) * header.scale[a] + header.offset[a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
    const r = modern ? points.getUint8(p + 14) & 15 : points.getUint8(p + 14) & 7
    if (r >= 1 && r <= 15) returns[r - 1]++
  }
  if (!count) {
    min.fill(0)
    max.fill(0)
  }
  for (let a = 0; a < 3; a++) {
    view.setFloat64(179 + a * 16, max[a], true)
    view.setFloat64(187 + a * 16, min[a], true)
  }
  const legacy = !modern && count <= 0xffffffff
  view.setUint32(107, legacy ? count : 0, true)
  for (let r = 0; r < 5; r++) view.setUint32(111 + r * 4, legacy ? returns[r] : 0, true)
  if (headerSize >= 375) {
    view.setBigUint64(227, 0n, true) // waveform data
    view.setBigUint64(235, 0n, true) // first extended VLR
    view.setUint32(243, 0, true)
    view.setBigUint64(247, BigInt(count), true)
    for (let r = 0; r < 15; r++) view.setBigUint64(255 + r * 8, BigInt(returns[r]), true)
  }
  return out
}

interface RawVlr extends Vlr {
  raw: Uint8Array
}

function rawVlrs(metadata: Uint8Array): RawVlr[] {
  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength)
  const decoder = new TextDecoder()
  const out: RawVlr[] = []
  let at = view.getUint16(94, true)
  const count = view.getUint32(100, true)
  for (let i = 0; i < count && at + 54 <= metadata.byteLength; i++) {
    const length = view.getUint16(at + 20, true)
    if (at + 54 + length > metadata.byteLength) break
    out.push({
      user: decoder.decode(metadata.subarray(at + 2, at + 18)).replace(/\0.*$/s, ''),
      record: view.getUint16(at + 18, true),
      data: metadata.subarray(at + 54, at + 54 + length),
      raw: metadata.subarray(at, at + 54 + length),
    })
    at += 54 + length
  }
  return out
}

function vlrBytes(v: Vlr): Uint8Array {
  const out = new Uint8Array(54 + v.data.byteLength)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode(v.user).subarray(0, 16), 2)
  view.setUint16(18, v.record, true)
  view.setUint16(20, v.data.byteLength, true)
  out.set(v.data, 54)
  return out
}
