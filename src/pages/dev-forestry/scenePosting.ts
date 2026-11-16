/**
 * How a scene package crosses to an engine's frame.
 *
 * A package is a few megabytes of structure and tens of megabytes of numbers (three terrain grids of four layers,
 * the stems, the models). Posted as it is, the browser copies every number one by one on this page's main thread
 * and again in the engine's: about a second each for a capture's package. `packScene` puts each long array of
 * numbers into a `Float64Array` (the same doubles, `null` as NaN), whose buffer is handed over, not copied, and
 * the engine turns them back into the arrays it reads (`unpackScene` is that step, kept here for the test and as
 * the reference). Nothing is rounded, so an engine builds exactly the scene it built from the plain package.
 *
 * The same pass gives the package a content key (everything but `createdAt`). An engine that still holds the
 * package with that key is sent the key alone; it answers `pgmaps-engine-scene-needed` when it does not.
 *
 * An engine says what it takes in its hello (`accepts`); one that names neither is sent the plain package.
 */
import type { ScenePackage } from './scenePackage'

/** In an engine's hello `accepts`: long numeric arrays may arrive as `Float64Array`s, NaN for null. */
export const ACCEPTS_PACKED_ARRAYS = 'packed-arrays'
/** In an engine's hello `accepts`: `{ type: 'pgmaps-scene', key }` alone means the package it holds under that key. */
export const ACCEPTS_SCENE_KEYS = 'scene-keys'

/** Arrays shorter than this stay as they are: rings, species lists and the like cost nothing to copy. */
export const PACK_MIN_LENGTH = 1024

export interface PackedScene {
  /** The package with its long numeric arrays as `Float64Array`s. */
  scene: unknown
  /** Their buffers, for the post's transfer list: after the post they are empty here. */
  transfer: ArrayBuffer[]
  /** What the package holds, `createdAt` apart: equal for equal content, whenever it was written. */
  key: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)

/** The array as doubles with NaN for null, or null when it holds anything but finite numbers and nulls. */
function packedNumbers(values: readonly unknown[]): Float64Array | null {
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value === null) out[i] = Number.NaN
    else if (typeof value === 'number' && Number.isFinite(value)) out[i] = value
    else return null
  }
  return out
}

function pack(value: unknown, transfer: ArrayBuffer[]): unknown {
  if (Array.isArray(value)) {
    if (value.length >= PACK_MIN_LENGTH) {
      const packed = packedNumbers(value)
      if (packed) {
        transfer.push(packed.buffer as ArrayBuffer)
        return packed
      }
    }
    return value.length && isRecord(value[0]) ? value.map((entry) => pack(entry, transfer)) : value
  }
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(value)) out[name] = pack(entry, transfer)
  return out
}

/** Two 32-bit hashes of a run of 32-bit words in one pass (murmur3's mixing, two seeds). */
function hashWords(words: Uint32Array): [number, number] {
  let a = 0x9747b28c
  let b = 0x85ebca6b
  for (let i = 0; i < words.length; i += 1) {
    let k = Math.imul(words[i], 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    a ^= k
    a = (a << 13) | (a >>> 19)
    a = (Math.imul(a, 5) + 0xe6546b64) | 0
    b = Math.imul(b ^ k, 0x27d4eb2f)
    b = (b << 11) | (b >>> 21)
  }
  const finish = (h: number) => {
    h ^= words.length
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    return (h ^ (h >>> 16)) >>> 0
  }
  return [finish(a), finish(b)]
}

const hex = (pair: [number, number]) => pair.map((h) => h.toString(16).padStart(8, '0')).join('')

function hashText(text: string): string {
  const words = new Uint32Array(text.length)
  for (let i = 0; i < text.length; i += 1) words[i] = text.charCodeAt(i)
  return hex(hashWords(words))
}

/**
 * The package ready to post: long numeric arrays packed, their buffers listed for transfer, and its content key.
 * The package itself is left as it was.
 */
export function packScene(scene: ScenePackage): PackedScene {
  const transfer: ArrayBuffer[] = []
  const packed = pack(scene, transfer) as Record<string, unknown>
  // The key: the structure as text, each packed array standing in it as its length and hash.
  const outline = JSON.stringify({ ...packed, createdAt: undefined }, (_name, value: unknown) =>
    value instanceof Float64Array
      ? `f64:${value.length}:${hex(hashWords(new Uint32Array(value.buffer, value.byteOffset, value.length * 2)))}`
      : value,
  )
  return { scene: packed, transfer, key: `${outline.length.toString(16)}-${hashText(outline)}` }
}

/**
 * What an engine does with a packed package, in place: every `Float64Array` back to a plain array, NaN to null.
 * The result equals the package that was packed, value for value.
 */
export function unpackScene(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length && isRecord(value[0])) value.forEach(unpackScene)
    return value
  }
  if (!isRecord(value)) return value
  for (const name of Object.keys(value)) {
    const entry = value[name]
    if (entry instanceof Float64Array) {
      const plain = new Array<number | null>(entry.length)
      for (let i = 0; i < entry.length; i += 1) {
        const v = entry[i]
        plain[i] = Number.isNaN(v) ? null : v
      }
      value[name] = plain
    } else unpackScene(entry)
  }
  return value
}

/** Whether an engine's hello names a capability. */
export function engineAccepts(accepts: unknown, capability: string): boolean {
  return Array.isArray(accepts) && accepts.includes(capability)
}
