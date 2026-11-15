import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { ROADENG_ORIGINAL_PRUNE_GRACE_MS, sha256Hex } from './roadEngTerrainOriginal'
import {
  hasRoadEngOriginal,
  pruneRoadEngOriginals,
  readRoadEngOriginal,
  storeRoadEngOriginal,
} from './roadEngTerrainStore'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe("this browser's RoadEng terrain files", () => {
  it('keeps a file by checksum and gives it back only to the reference that names it', async () => {
    const bytes = new Uint8Array(1000).map((_, k) => k & 0xff)
    const sha256 = await sha256Hex(bytes)
    expect(await hasRoadEngOriginal({ sha256, size: bytes.length })).toBe(false)
    await storeRoadEngOriginal(sha256, bytes)
    expect(await hasRoadEngOriginal({ sha256, size: bytes.length })).toBe(true)
    expect(await hasRoadEngOriginal({ sha256, size: 999 })).toBe(false)
    expect([...(await readRoadEngOriginal({ sha256, size: bytes.length }))!]).toEqual([...bytes])
    // Bytes stored under another file's checksum are never handed back as that file.
    const other = 'f'.repeat(64)
    await storeRoadEngOriginal(other, bytes)
    expect(await readRoadEngOriginal({ sha256: other, size: bytes.length })).toBeNull()
  })

  it('prunes files no project names, once past the grace period', async () => {
    const a = new Uint8Array([1, 2, 3]),
      b = new Uint8Array([4, 5, 6])
    const [sa, sb] = await Promise.all([sha256Hex(a), sha256Hex(b)])
    await storeRoadEngOriginal(sa, a)
    await storeRoadEngOriginal(sb, b)
    expect(await pruneRoadEngOriginals([sb])).toBe(0)
    expect(await pruneRoadEngOriginals([sb], Date.now() + ROADENG_ORIGINAL_PRUNE_GRACE_MS + 1)).toBe(1)
    expect(await hasRoadEngOriginal({ sha256: sa, size: 3 })).toBe(false)
    expect(await hasRoadEngOriginal({ sha256: sb, size: 3 })).toBe(true)
  })
})
