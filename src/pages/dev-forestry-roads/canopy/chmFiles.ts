/**
 * The Meta CHM v2 files on Source Cooperative, as the plan reads them: one cache of opened headers
 * shared by the map tiles and the corridor read, a missing file remembered as missing, and a bound on
 * how many block reads go to the public host at once. Browser only; the maths is
 * `src/lib/forestry/canopy/chmTiles.ts` and `metaChm.ts`.
 */
import { fromCustomClient, getDecoder, type BaseClient, type GeoTIFF } from 'geotiff'
import type { ChmTileDeps } from '@/lib/forestry/canopy/chmTiles'
import type { ChmTiff } from '@/lib/forestry/canopy/metaChm'

/** Files whose headers stay open: a view straddles up to four, and a pan reaches their neighbours. */
export const CHM_OPEN_FILES = 12
/** Block reads in flight to Source Cooperative at once; the rest wait their turn. */
export const CHM_TILE_MAX_REQUESTS = 8

/** No file exists at this address: outside the source's coverage (the bucket answers 404). */
export class ChmFileMissing extends Error {
  constructor(url: string) {
    super(`No canopy height file covers ${url.split('/').pop()}.`)
    this.name = 'ChmFileMissing'
  }
}

/** geotiff's response facade (`BaseResponse`) over a fetch `Response`. */
function chmResponse(response: Response) {
  return {
    get ok() {
      return response.ok
    },
    get status() {
      return response.status
    },
    getHeader: (name: string) => response.headers.get(name) ?? '',
    getData: () => response.arrayBuffer(),
  }
}

/** geotiff's fetch client (`BaseClient`), but one that notes when the file is not there. */
function chmClient(url: string) {
  const client = {
    url,
    missing: false,
    async request({ headers, signal }: { headers?: HeadersInit; signal?: AbortSignal } = {}) {
      const response = await fetch(url, { headers, credentials: 'omit', signal })
      if (response.status === 404 || response.status === 403) client.missing = true
      return chmResponse(response)
    },
  }
  return client
}

const files = new Map<string, Promise<GeoTIFF>>()
const missing = new Set<string>()

function openFile(url: string): Promise<GeoTIFF> {
  let file = files.get(url)
  if (file) {
    // Most recently used last, so the oldest is let go first.
    files.delete(url)
    files.set(url, file)
    return file
  }
  const client = chmClient(url)
  file = fromCustomClient(client as unknown as BaseClient, {
    allowFullFile: false,
    blockSize: 65536,
    cacheSize: 64,
  }).catch((error) => {
    if (files.get(url) === file) files.delete(url)
    if (client.missing) {
      missing.add(url)
      throw new ChmFileMissing(url)
    }
    throw error
  })
  files.set(url, file)
  while (files.size > CHM_OPEN_FILES) files.delete(files.keys().next().value!)
  return file
}

/** Waits for `promise`, or rejects at once when `signal` aborts (the shared work carries on). */
function until<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('The canopy tile was cancelled.', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The canopy tile was cancelled.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** For the corridor read: a file outside coverage is an error that names it. */
export function openChmTiff(url: string): Promise<ChmTiff> {
  if (missing.has(url)) return Promise.reject(new ChmFileMissing(url))
  return openFile(url) as unknown as Promise<ChmTiff>
}

/** For a map tile: a file outside coverage is no file, asked for once per session. */
async function openTileFile(url: string, signal?: AbortSignal): Promise<ChmTiff | null> {
  if (missing.has(url)) return null
  try {
    return (await until(openFile(url), signal)) as unknown as ChmTiff
  } catch (error) {
    if (error instanceof ChmFileMissing) return null
    throw error
  }
}

let running = 0
const waiting: (() => void)[] = []
/** Takes one of the `CHM_TILE_MAX_REQUESTS` turns; a cancelled wait leaves the queue at once. */
function slot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('The canopy tile was cancelled.', 'AbortError'))
  if (running < CHM_TILE_MAX_REQUESTS) {
    running++
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const turn = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = () => {
      const index = waiting.indexOf(turn)
      if (index >= 0) waiting.splice(index, 1)
      reject(new DOMException('The canopy tile was cancelled.', 'AbortError'))
    }
    waiting.push(turn)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
/** Hands the turn straight to the next in the queue, or gives it back. */
function release() {
  const next = waiting.shift()
  if (next) next()
  else running--
}

async function readBytes(url: string, offset: number, length: number, signal?: AbortSignal) {
  await slot(signal)
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      credentials: 'omit',
      signal,
    })
    if (response.status !== 206) {
      void response.body?.cancel()
      throw Error(`Source Cooperative answered ${response.status} for a canopy block of ${url.split('/').pop()}.`)
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== length) throw Error(`A canopy block of ${url.split('/').pop()} came back short.`)
    return bytes
  } finally {
    release()
  }
}

type Decoder = { decode(fileDirectory: unknown, buffer: ArrayBuffer): Promise<ArrayBuffer> }
const decoders = new WeakMap<object, Promise<Decoder>>()
function decode(fileDirectory: object, bytes: ArrayBuffer) {
  let decoder = decoders.get(fileDirectory)
  if (!decoder) decoders.set(fileDirectory, (decoder = getDecoder(fileDirectory) as Promise<Decoder>))
  return decoder.then(async (d) => {
    const start = performance.now()
    const values = await d.decode(fileDirectory, bytes)
    performance.measure('pgmaps-chm-decode', { start, end: performance.now() })
    return values
  })
}

/** What `readChmTile` needs, bound to this session's files. */
export function chmTileDeps(signal: AbortSignal): ChmTileDeps {
  return { openTiff: openTileFile, readBytes, decode, signal }
}
