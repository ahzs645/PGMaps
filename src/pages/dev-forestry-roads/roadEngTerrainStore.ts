/**
 * RoadEng's own `Terrain1.ter` files kept in this browser, by content: each lives under its SHA-256
 * (`roadEngOriginalKey`) in its own IndexedDB database beside the project library
 * (`projectLibrary.ts`), so a 26 MB terrain never enters the autosaved project, and two projects
 * opened from the same file share one copy. A project names its file by checksum and size
 * (`TerrainMetadata.roadEngSource.original`, `roadEngTerrainOriginal.ts`); a read checks both, so a
 * stored file that is not the one named is never written back.
 *
 * Files no saved project names are removed when a project is deleted (`pruneRoadEngOriginals`),
 * except those stored within `ROADENG_ORIGINAL_PRUNE_GRACE_MS`, whose project may not be saved yet.
 * Browser-only: the pure parts are in `roadEngTerrainOriginal.ts`.
 */
import {
  MAX_ROADENG_ORIGINAL_TER_BYTES,
  roadEngOriginalKey,
  roadEngOriginalsToPrune,
  roadEngOriginalSha,
  sha256Hex,
  type RoadEngOriginalTer,
} from './roadEngTerrainOriginal'

const DATABASE = 'pgmaps-forestry-roads-files-v1'
const STORE = 'files'
/** Each file's size and when it was stored, under `meta:<key>`, so pruning never loads the bytes. */
const meta = (key: string) => `meta:${key}`

interface Meta {
  size: number
  storedAt: number
}

function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      let transaction: IDBTransaction, result: () => T
      try {
        transaction = db.transaction(STORE, mode)
        result = work(transaction.objectStore(STORE))
      } catch (error) {
        db.close()
        reject(error)
        return
      }
      transaction.oncomplete = () => {
        db.close()
        resolve(result())
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
      transaction.onabort = () => {
        db.close()
        reject(transaction.error ?? Error('The browser did not keep the terrain file.'))
      }
    }
  })
}

/** Keeps a `Terrain1.ter` under its SHA-256 (already computed by the caller). */
export function storeRoadEngOriginal(sha256: string, bytes: Uint8Array): Promise<void> {
  if (bytes.length > MAX_ROADENG_ORIGINAL_TER_BYTES)
    return Promise.reject(Error(`The terrain file is over ${MAX_ROADENG_ORIGINAL_TER_BYTES / 1e6} MB.`))
  const key = roadEngOriginalKey(sha256)
  const copy = bytes.slice().buffer
  return withStore('readwrite', (store) => {
    store.put(copy, key)
    store.put({ size: bytes.length, storedAt: Date.now() } satisfies Meta, meta(key))
    return () => undefined
  })
}

/** Whether this browser holds the file a reference names (by key and size, without reading it). */
export async function hasRoadEngOriginal(ref: Pick<RoadEngOriginalTer, 'sha256' | 'size'>): Promise<boolean> {
  try {
    const stored = await withStore('readonly', (store) => {
      const request = store.get(meta(roadEngOriginalKey(ref.sha256)))
      return () => request.result as Meta | undefined
    })
    return stored?.size === ref.size
  } catch {
    return false
  }
}

/** The file a reference names, or null when this browser does not hold it or holds other bytes. */
export async function readRoadEngOriginal(
  ref: Pick<RoadEngOriginalTer, 'sha256' | 'size'>,
): Promise<Uint8Array | null> {
  let buffer: ArrayBuffer | undefined
  try {
    buffer = await withStore('readonly', (store) => {
      const request = store.get(roadEngOriginalKey(ref.sha256))
      return () => request.result as ArrayBuffer | undefined
    })
  } catch {
    return null
  }
  if (!buffer || buffer.byteLength !== ref.size) return null
  const bytes = new Uint8Array(buffer)
  return (await sha256Hex(bytes)) === ref.sha256 ? bytes : null
}

/** Removes stored files none of `referenced` (SHA-256s) names, past the grace period. Returns how many. */
export async function pruneRoadEngOriginals(referenced: Iterable<string>, now = Date.now()): Promise<number> {
  const stored = await withStore('readonly', (store) => {
    // Only the small meta records are read, each by its key, never the files' bytes.
    const found: { sha256: string; storedAt: number }[] = []
    const keys = store.getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) {
        if (typeof key !== 'string' || !key.startsWith('meta:')) continue
        const sha256 = roadEngOriginalSha(key.slice('meta:'.length))
        if (!sha256) continue
        const record = store.get(key)
        record.onsuccess = () => found.push({ sha256, storedAt: (record.result as Meta | undefined)?.storedAt ?? 0 })
      }
    }
    return () => found
  })
  const prune = roadEngOriginalsToPrune(stored, referenced, now)
  if (!prune.length) return 0
  await withStore('readwrite', (store) => {
    for (const sha256 of prune) {
      store.delete(roadEngOriginalKey(sha256))
      store.delete(meta(roadEngOriginalKey(sha256)))
    }
    return () => undefined
  })
  return prune.length
}
