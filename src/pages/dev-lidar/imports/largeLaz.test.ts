import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createLazPerf } from 'laz-perf'
import { readPointCloudHeader } from '@/lib/lidar/lasHeader'
import { inspectLas, needsChunkedRead } from './las'
import {
  clipBox,
  estimateArea,
  overviewStride,
  planLargeLaz,
  writeLas,
  type LargeLazPlan,
  type Selection,
} from './largeLaz'
import { decodeBatch, newScratch } from './largeLazDecode'
import { thinRecords } from './largeLazRead'

const fixture = () =>
  new File([new Uint8Array(readFileSync('tests/fixtures/restoration-synthetic.laz'))], 'restoration-synthetic.laz')

async function plan(file: File) {
  return planLargeLaz(file, await inspectLas(file))
}
const reader = (file: File) => async (c: { start: number; bytes: number }) =>
  new Uint8Array(await file.slice(c.start, c.start + c.bytes).arrayBuffer())

async function select(file: File, p: LargeLazPlan, selection: Selection) {
  const laz = p.header.compressed ? await createLazPerf() : null
  const { header } = p
  const batch = {
    compressed: header.compressed,
    format: header.pointFormat,
    length: header.pointLength,
    scale: header.scale,
    offset: header.offset,
    chunks: p.chunks,
    selection,
  }
  return decodeBatch(laz, batch, reader(file), newScratch())
}

/** Every record of a LAZ file through laz-perf's whole-file decoder, the reference for the chunk reader. */
async function wholeFile(bytes: Uint8Array) {
  const laz = await createLazPerf()
  const header = readPointCloudHeader(bytes)
  const input = laz._malloc(bytes.length),
    output = laz._malloc(header.pointLength)
  laz.HEAPU8.set(bytes, input)
  const decoder = new laz.LASZip()
  decoder.open(input, bytes.length)
  const out = new Uint8Array(header.points * header.pointLength)
  for (let i = 0; i < header.points; i++) {
    decoder.getPoint(output)
    out.set(laz.HEAPU8.subarray(output, output + header.pointLength), i * header.pointLength)
  }
  decoder.delete()
  laz._free(input)
  laz._free(output)
  return out
}

describe('large LAS/LAZ reading', () => {
  it('decodes chunk by chunk to the same records as the whole-file decoder', async () => {
    const file = fixture()
    const p = await plan(file)
    expect(p.chunks).toEqual([{ start: 555, bytes: 408, points: p.header.points, firstPoint: 0 }])
    const all = await select(file, p, { kind: 'overview', stride: 1 })
    expect(all.count).toBe(p.header.points)
    expect(all.records).toEqual(await wholeFile(new Uint8Array(await file.arrayBuffer())))
  })

  it('keeps one point in a stride, or every point in an area', async () => {
    const file = fixture()
    const p = await plan(file)
    const n = p.header.points
    expect((await select(file, p, { kind: 'overview', stride: 3 })).count).toBe(Math.ceil(n / 3))
    const [x0, y0, x1, y1] = [p.header.min[0], p.header.min[1], p.header.max[0], p.header.max[1]]
    expect((await select(file, p, { kind: 'area', box: [x0, y0, x1, y1], limit: 10 })).count).toBe(n)
    const west = await select(file, p, { kind: 'area', box: [x0, y0, (x0 + x1) / 2, y1], limit: 10 })
    expect(west.count).toBeGreaterThan(0)
    expect(west.count).toBeLessThan(n)
    expect((await select(file, p, { kind: 'area', box: [x1 + 10, y0, x1 + 20, y1], limit: 10 })).count).toBe(0)
  })

  it('writes an uncompressed LAS with the CRS, counts and extent of what it kept', async () => {
    const file = fixture()
    const p = await plan(file)
    const { records, count } = await select(file, p, { kind: 'overview', stride: 2 })
    const out = writeLas(p, records, count)
    const header = readPointCloudHeader(out)
    expect(header).toMatchObject({ compressed: false, points: count, pointFormat: p.header.pointFormat, epsg: p.epsg })
    expect(out.subarray(header.pointOffset)).toEqual(records)
    expect(header.min[0]).toBeGreaterThanOrEqual(p.header.min[0])
    expect(header.max[2]).toBeLessThanOrEqual(p.header.max[2])
    expect(new TextDecoder().decode(out.subarray(58, 83))).toBe('PGMaps chunked LAS reader')
    // The rewritten file is small enough to load whole and reads back through the ordinary path.
    const again = await inspectLas(new File([out as BlobPart], 'out.las'))
    expect(again).toMatchObject({ compressed: false, points: count, copc: false, hasCRS: true })
    expect(needsChunkedRead(again, out.byteLength)).toBe(false)
  })

  it('reads an uncompressed LAS in slices', async () => {
    const file = fixture()
    const p = await plan(file)
    const { records, count } = await select(file, p, { kind: 'overview', stride: 1 })
    const las = new File([writeLas(p, records, count) as BlobPart], 'plain.las')
    const plain = await plan(las)
    expect(plain.header.compressed).toBe(false)
    expect((await select(las, plain, { kind: 'overview', stride: 1 })).records).toEqual(records)
  })

  it('estimates and clips areas, and thins evenly', async () => {
    const p = await plan(fixture())
    const [x0, y0, x1, y1] = [p.header.min[0], p.header.min[1], p.header.max[0], p.header.max[1]]
    expect(clipBox(p, [x1 + 1, y0, x1 + 2, y1])).toBeNull()
    expect(clipBox(p, [x0 - 100, y0 - 100, x1 + 100, y1 + 100])).toEqual([x0, y0, x1, y1])
    expect(estimateArea(p, [x0, y0, x1, y1])).toBe(p.header.points)
    expect(estimateArea(p, [x0, y0, (x0 + x1) / 2, y1])).toBe(Math.round(p.header.points / 2))
    expect(overviewStride(161_695_775)).toBe(81)
    const records = Uint8Array.from({ length: 10 }, (_, i) => i)
    expect(thinRecords(records, 10, 1, 4)).toEqual({ records: Uint8Array.from([0, 3, 6, 9]), count: 4 })
    expect(thinRecords(records, 10, 1, 20).count).toBe(10)
  })

  // A real LidarBC tile when one is on disk: LIDARBC_LAZ=/path/to/bc_….laz
  const tile = process.env.LIDARBC_LAZ
  it.runIf(!!tile && existsSync(tile))(
    'reads a LidarBC tile into an overview and a full-detail hectare',
    async () => {
      const bytes = readFileSync(tile!)
      const file = new File([new Uint8Array(bytes)], 'tile.laz')
      const p = await plan(file)
      const stride = overviewStride(p.header.points)
      const overview = await select(file, p, { kind: 'overview', stride })
      expect(overview.count).toBe(Math.ceil(p.header.points / stride))
      const cx = (p.header.min[0] + p.header.max[0]) / 2,
        cy = (p.header.min[1] + p.header.max[1]) / 2
      const detail = await select(file, p, { kind: 'area', box: [cx - 50, cy - 50, cx + 50, cy + 50], limit: 3e6 })
      expect(detail.count).toBeGreaterThan(0)
      const out = readPointCloudHeader(writeLas(p, detail.records, detail.count))
      expect(out.min[0]).toBeGreaterThanOrEqual(cx - 50)
      expect(out.max[1]).toBeLessThanOrEqual(cy + 50)
    },
    600_000,
  )
})
