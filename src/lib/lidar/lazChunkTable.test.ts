import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chunkTableOffset, parseLaszipVlr, readChunkTable, VARIABLE_CHUNK_SIZE } from './lazChunkTable'

/**
 * The chunk table of a real LidarBC tile, bc_092b051_1_3_1_xyes_8_utm10_20230930: 161,695,775 points in 3,234
 * chunks of 50,000, points from byte 1,859 and the table at byte 982,595,237. LidarBC data is published under
 * the Open Government Licence – British Columbia.
 */
const table = new Uint8Array(readFileSync('tests/fixtures/lidarbc-chunk-table.bin'))
const tile = { pointOffset: 1859, tableOffset: 982_595_237, chunkSize: 50_000, totalPoints: 161_695_775 }

describe('LAZ chunk table', () => {
  it('decodes a LidarBC tile table whose chunks fill the file exactly', () => {
    const chunks = readChunkTable(table, tile)
    expect(chunks).toHaveLength(3234)
    expect(chunks[0]).toEqual({ start: 1867, bytes: 306_583, points: 50_000, firstPoint: 0 })
    // Sizes of chunks fetched from the tile by byte range and decoded with laz-perf.
    expect(chunks[1617].bytes).toBe(264_203)
    expect(chunks.at(-1)).toMatchObject({ bytes: 301_084, points: 45_775, firstPoint: 161_650_000 })
    const last = chunks.at(-1)!
    expect(last.start + last.bytes).toBe(tile.tableOffset)
  })

  it('refuses a table that does not add up to the file', () => {
    expect(() => readChunkTable(table, { ...tile, tableOffset: tile.tableOffset + 1 })).toThrow(/does not/)
    expect(() => readChunkTable(table, { ...tile, totalPoints: tile.totalPoints - 50_000 })).toThrow(/does not/)
    expect(() => readChunkTable(table.subarray(0, 200), tile)).toThrow(/ended early/)
  })

  it('finds the table pointer, or the copy at the end of the file when the writer left -1', () => {
    const at = (n: number) => new Uint8Array(new BigInt64Array([BigInt(n)]).buffer)
    expect(chunkTableOffset(at(982_595_237))).toBe(982_595_237)
    expect(chunkTableOffset(at(-1), new Uint8Array([9, 9, ...at(5000)]))).toBe(5000)
    expect(chunkTableOffset(at(-1))).toBeNull()
  })

  it('reads the LASzip record', () => {
    const vlr = new Uint8Array(40)
    new DataView(vlr.buffer).setUint16(0, 3, true)
    new DataView(vlr.buffer).setUint32(12, VARIABLE_CHUNK_SIZE, true)
    expect(parseLaszipVlr(vlr)).toEqual({ compressor: 3, chunkSize: VARIABLE_CHUNK_SIZE })
    expect(() => parseLaszipVlr(vlr.subarray(0, 10))).toThrow(/truncated/)
  })
})
