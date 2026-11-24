/**
 * RoadEng's own `Terrain1.ter`, kept so a terrain written back from PG Maps is RoadEng's terrain
 * again: its TIN, its points and every feature with its codes and attribute chunks, rewritten only
 * where the project changed them.
 *
 * A `.ter` is up to about 26 MB (Softree's cable tutorial terrains), too large for the autosaved
 * project, so the bytes live in this browser's content-addressed store (`roadEngTerrainStore.ts`,
 * keyed by {@link roadEngOriginalKey}) and the project holds only a reference,
 * {@link RoadEngOriginalTer}, in `TerrainMetadata.roadEngSource.original`: the bytes' SHA-256 and
 * size, a fingerprint of the terrain grid made from them, and a fingerprint of each project object
 * made from one of their features. The project file (`.json`) carries the same reference and not the
 * bytes; in another browser the reference finds nothing until the same `.terx` is opened or chosen
 * again, and until then the export writes the grid and says why.
 *
 * - **The ground stays RoadEng's** while the project's grid is still the one read from the file:
 *   {@link roadEngGridFingerprint} over its size, cells, origin in the file's own grid and every
 *   level. Replacing, re-gridding, editing or moving the terrain changes it.
 * - **A feature stays as read** unless the project object made from it was edited (its
 *   {@link roadEngObjectFingerprint} changed) or removed. Features that never became objects
 *   (contours, point sets, the TIN boundary, a road line lying on a design, features past the
 *   project's layer limits) always stay as read.
 *
 * Checked by `roadEngTerrainOriginal.test.ts` (and, with `ROADENG_SAMPLES`, against Softree's
 * samples byte for byte). Leaves out: the bytes themselves, which never enter a project.
 *
 * Pure: no DOM or network access (Web Crypto's digest only, which Node and browsers both give).
 */
import { unzipSync } from 'fflate'
import { LOCAL_PLANE_EPSG } from '@/lib/geo/projectedCrs'
import { sourceAttributes } from './sourceMetadata'
import { readRoadEngMapNotes } from './roadEngMapNotes'
import { base64ToBytes } from './roadEngText'
import type { RoadEngFeatureClass, RoadEngTerrainSource } from './roadEngTerrain'
import type { ReferenceFeature } from './referenceFeatures'
import type { CableLine, ContextFeature } from './types'
import { screenColour } from '@/lib/screenPage'

/** Largest `Terrain1.ter` kept in the browser, bytes. Softree's largest sample is 26.3 MB. */
export const MAX_ROADENG_ORIGINAL_TER_BYTES = 200_000_000
/** Project objects one terrain's reference tracks: the import's 500 context, 500 reference and 100 D-lines, with room. */
export const MAX_ROADENG_ORIGINAL_OBJECTS = 2_000
/** A stored terrain this recent is never pruned: the project that names it may not be saved yet. */
export const ROADENG_ORIGINAL_PRUNE_GRACE_MS = 24 * 60 * 60 * 1000
const KEY_PREFIX = 'roadeng-ter:'

/** The project's reference to RoadEng's own `Terrain1.ter` (`TerrainMetadata.roadEngSource.original`). */
export interface RoadEngOriginalTer {
  /** SHA-256 of `Terrain1.ter` as read, lower-case hex. */
  sha256: string
  /** Its size, bytes. */
  size: number
  /** {@link roadEngGridFingerprint} of the terrain grid made from it, in the file's own grid. */
  grid: string
  /** Metres per file unit; only a terrain in metres goes back as read. */
  unitM: number
  /** Features the file holds. */
  features: number
  /** Triangles in its TIN; 0 when it holds none. */
  triangles: number
  /** Its features by class, as read. */
  classes: Partial<Record<RoadEngFeatureClass, number>>
  /**
   * Project objects made from its features, by object id: the feature's index in the file, the
   * object's {@link roadEngObjectFingerprint} when made, 1 when the TIN is built on the feature's
   * points, and the feature's class.
   */
  objects: Record<string, [index: number, fingerprint: string, inTin: 0 | 1, cls: RoadEngFeatureClass]>
}

/** What the import knows before the page has hashed the bytes. */
export type RoadEngOriginalRecord = Omit<RoadEngOriginalTer, 'sha256'>

export const roadEngOriginalKey = (sha256: string) => `${KEY_PREFIX}${sha256}`
export const roadEngOriginalSha = (key: string) => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null)

const CLASSES: readonly RoadEngFeatureClass[] = [
  'contour',
  'source-contour',
  'mass-points',
  'tin-boundary',
  'stream',
  'road',
  'd-line',
  'landing',
  'boundary',
  'rock-bluff',
  'breakline',
  'other',
]

/** Validates a reference read from a project file; anything malformed is refused, never repaired. */
export function parseRoadEngOriginalTer(value: unknown): RoadEngOriginalTer {
  const fail = (why: string): never => {
    throw Error(`The RoadEng terrain file reference is not valid: ${why}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object.')
  const v = value as Record<string, unknown>
  if (typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)) fail('sha256 must be a SHA-256 digest.')
  const whole = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max
  if (!whole(v.size, MAX_ROADENG_ORIGINAL_TER_BYTES) || (v.size as number) < 1) fail('size must be a byte count.')
  if (typeof v.grid !== 'string' || !/^[a-f0-9]{16}$/.test(v.grid)) fail('grid must be a fingerprint.')
  if (typeof v.unitM !== 'number' || !(v.unitM > 0 && v.unitM <= 1)) fail('unitM must be a unit in metres.')
  if (!whole(v.features, 100_000_000)) fail('features must be a count.')
  if (!whole(v.triangles, 1_000_000_000)) fail('triangles must be a count.')
  if (!v.classes || typeof v.classes !== 'object' || Array.isArray(v.classes)) fail('classes must be an object.')
  const classes: Partial<Record<RoadEngFeatureClass, number>> = {}
  for (const [key, n] of Object.entries(v.classes as Record<string, unknown>)) {
    if (!CLASSES.includes(key as RoadEngFeatureClass) || !whole(n, 100_000_000)) fail(`class ${key} is not valid.`)
    classes[key as RoadEngFeatureClass] = n as number
  }
  if (!v.objects || typeof v.objects !== 'object' || Array.isArray(v.objects)) fail('objects must be an object.')
  const entries = Object.entries(v.objects as Record<string, unknown>)
  if (entries.length > MAX_ROADENG_ORIGINAL_OBJECTS) fail(`it tracks over ${MAX_ROADENG_ORIGINAL_OBJECTS} objects.`)
  const objects: RoadEngOriginalTer['objects'] = {}
  for (const [id, raw] of entries) {
    const entry = raw as unknown[]
    if (
      id.length > 100 ||
      ['__proto__', 'constructor', 'prototype'].includes(id) ||
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      !CLASSES.includes(entry[3] as RoadEngFeatureClass) ||
      !whole(entry[0], (v.features as number) - 1) ||
      typeof entry[1] !== 'string' ||
      !/^[a-f0-9]{16}$/.test(entry[1]) ||
      (entry[2] !== 0 && entry[2] !== 1)
    )
      fail(`object ${id.slice(0, 40)} is not valid.`)
    objects[id] = [entry[0] as number, entry[1] as string, entry[2] as 0 | 1, entry[3] as RoadEngFeatureClass]
  }
  return {
    sha256: v.sha256 as string,
    size: v.size as number,
    grid: v.grid as string,
    unitM: v.unitM as number,
    features: v.features as number,
    triangles: v.triangles as number,
    classes,
    objects,
  }
}

/** SHA-256 of some bytes, lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- Fingerprints -------------------------------------------------------------------------------------

/** Two 32-bit lanes of a MurmurHash3-style mix, printed as 16 hex digits. Not cryptographic. */
class Mix {
  private a = 0x9747b28c
  private b = 0x5bd1e995
  private n = 0
  private static step(h: number, k: number) {
    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    return (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  word(k: number) {
    this.a = Mix.step(this.a, k)
    this.b = Mix.step(this.b, k ^ 0x85ebca6b)
    this.n++
  }
  private static finish(h: number, n: number) {
    h ^= n
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  hex() {
    return Mix.finish(this.a, this.n) + Mix.finish(this.b ^ 0x27d4eb2f, this.n)
  }
}

const scratch = new DataView(new ArrayBuffer(8))
const addNumber = (mix: Mix, value: number | null) => {
  if (value === null) {
    // Distinct from every level, NaN included.
    mix.word(0x7ff80001)
    mix.word(0x6e756c6c)
    return
  }
  scratch.setFloat64(0, value, true)
  mix.word(scratch.getUint32(0, true))
  mix.word(scratch.getUint32(4, true))
}

/**
 * A terrain grid's fingerprint: its size, cells and origin and every level, bit for bit. Pass the
 * origin in the file's own grid (a project on the flat plane adds its offset), as the export sees it.
 */
export function roadEngGridFingerprint(raster: {
  origin: readonly [number, number] | readonly number[]
  pixelSize: readonly [number, number] | readonly number[]
  width: number
  height: number
  values: ArrayLike<number | null>
}): string {
  const mix = new Mix()
  for (const v of [raster.width, raster.height, raster.origin[0], raster.origin[1], ...raster.pixelSize.slice(0, 2)])
    addNumber(mix, v)
  for (let i = 0; i < raster.values.length; i++) addNumber(mix, raster.values[i] ?? null)
  return mix.hex()
}

const textHash = (text: string) => {
  const mix = new Mix()
  for (let i = 0; i < text.length; i += 2) mix.word(text.charCodeAt(i) | ((text.charCodeAt(i + 1) || 0) << 16))
  return mix.hex()
}

/** Attributes a reference feature from RoadEng carries for its class and look (`roadEngProject.ts`). */
const LOOK_ATTRIBUTES = ['roadEngClass', 'roadEngFormat', 'roadEngColor'] as const

/**
 * What a project object made from a RoadEng feature holds that the feature gives back: 8 hex digits
 * for its place (kind and geometry; a reference feature's RoadEng class and look; a D-line's ends and
 * yarder side), then 8 for its name, so a renamed feature keeps its points as read. A D-line's cable
 * settings are compared by the export itself. Values pass the project file's own checks first, so
 * the fingerprint is the same before and after a project is saved and opened.
 */
export function roadEngObjectFingerprint(
  object:
    | { type: 'context'; feature: ContextFeature }
    | { type: 'reference'; feature: ReferenceFeature }
    | { type: 'cable'; feature: CableLine },
): string {
  let parts: unknown[]
  if (object.type === 'context') {
    const f = object.feature
    parts = ['context', f.kind, f.geometry.type, f.geometry.coordinates]
  } else if (object.type === 'reference') {
    const f = object.feature
    const attributes = sourceAttributes(f.attributes) ?? {}
    parts = ['reference', f.geometry, ...LOOK_ATTRIBUTES.map((key) => attributes[key] ?? null)]
  } else {
    const f = object.feature
    parts = ['cable', f.start, f.end, f.yarderAt ?? 'start']
  }
  return textHash(JSON.stringify(parts)).slice(0, 8) + textHash(object.feature.name).slice(0, 8)
}

/** Whether two {@link roadEngObjectFingerprint}s give the same place, whatever the names. */
export const roadEngSamePlace = (a: string, b: string) => a.slice(0, 8) === b.slice(0, 8)

// ---- Files --------------------------------------------------------------------------------------------

/**
 * The `Terrain1.ter` files a chosen file holds: the file itself when it is one (version 12), the
 * one in a `.terx`, or those in the `.terx` files of a zipped RoadEng project.
 */
export function roadEngTerCandidates(bytes: Uint8Array): Uint8Array[] {
  const isTer = (b: Uint8Array) => b.length > 38 && b[0] === 12 && b[1] === 0
  if (isTer(bytes)) return [bytes]
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return []
  const out: Uint8Array[] = []
  const unpack = (zip: Uint8Array, depth: number) => {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(zip, {
        filter: (f) =>
          f.originalSize <= MAX_ROADENG_ORIGINAL_TER_BYTES &&
          (/\.ter$/i.test(f.name) || (depth === 0 && /\.terx$/i.test(f.name))),
      })
    } catch {
      return
    }
    for (const [name, data] of Object.entries(entries)) {
      if (/\.ter$/i.test(name) && isTer(data)) out.push(data)
      else if (/\.terx$/i.test(name)) unpack(data, depth + 1)
    }
  }
  unpack(bytes, 0)
  return out
}

/** Stored terrains no project names any more, past the grace period: their keys, to delete. */
export function roadEngOriginalsToPrune(
  stored: readonly { sha256: string; storedAt: number }[],
  referenced: Iterable<string>,
  now: number,
): string[] {
  const keep = new Set(referenced)
  return stored
    .filter((s) => !keep.has(s.sha256) && now - s.storedAt > ROADENG_ORIGINAL_PRUNE_GRACE_MS)
    .map((s) => s.sha256)
}

// ---- What goes back -----------------------------------------------------------------------------------

export interface RoadEngCarryOverItem {
  label: string
  /** How many, where it counts things. */
  count?: number
  /** Why, for something left out or rewritten for a reason. */
  why?: string
}

/** What a RoadEng project export writes back unchanged, rewrites from the project and leaves out. */
export interface RoadEngCarryOver {
  /** The ground: RoadEng's own TIN and points, the project's grid, or none. */
  ground: 'roadeng' | 'grid' | 'none'
  /** Why the grid is written though the terrain came from RoadEng; null otherwise. */
  why: string | null
  unchanged: RoadEngCarryOverItem[]
  rewritten: RoadEngCarryOverItem[]
  leftOut: RoadEngCarryOverItem[]
}

const CLASS_LABEL: Record<RoadEngFeatureClass, [string, string]> = {
  contour: ['contour from the model', 'contours from the model'],
  'source-contour': ['contour', 'contours'],
  'mass-points': ['point set', 'point sets'],
  'tin-boundary': ['TIN boundary', 'TIN boundaries'],
  stream: ['stream', 'streams'],
  road: ['road line', 'road lines'],
  'd-line': ['D-line', 'D-lines'],
  landing: ['landing', 'landings'],
  boundary: ['boundary', 'boundaries'],
  'rock-bluff': ['rock bluff', 'rock bluffs'],
  breakline: ['breakline', 'breaklines'],
  other: ['other feature', 'other features'],
}
export const roadEngClassLabel = (cls: RoadEngFeatureClass, n: number) => CLASS_LABEL[cls][n === 1 ? 0 : 1]
export const ROADENG_FEATURE_CLASSES = CLASSES

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
body{font:13px/1.45 system-ui,sans-serif;margin:16px;color:${screenColour('fg')};background:${screenColour('bg')}}
h2{font-size:15px;margin:0 0 4px}h3{font-size:13px;margin:14px 0 4px}
ul{margin:0;padding-left:18px}li{margin:2px 0}.n{font-variant-numeric:tabular-nums;font-weight:600}
.why{color:${screenColour('muted', '#57534e')}}.muted{color:${screenColour('muted')}}.ground{margin:6px 0 0}
</style>`

const itemHtml = (item: RoadEngCarryOverItem) =>
  `<li>${item.count !== undefined ? `<span class="n">${item.count.toLocaleString('en-CA')}</span> ` : ''}${escape(item.label)}${
    item.why ? ` <span class="why">— ${escape(item.why)}</span>` : ''
  }</li>`

/** The Save & export preview of a RoadEng project: what goes back to RoadEng, then the export's notes. */
export function roadEngCarryOverHtml(carry: RoadEngCarryOver, notes: readonly string[]): string {
  const list = (title: string, items: readonly RoadEngCarryOverItem[], empty: string, id: string) =>
    `<section data-carry="${id}"><h3>${escape(title)}</h3>${
      items.length ? `<ul>${items.map(itemHtml).join('')}</ul>` : `<p class="muted">${escape(empty)}</p>`
    }</section>`
  const ground =
    carry.ground === 'roadeng'
      ? "The ground is RoadEng's own TIN and points, as read."
      : carry.ground === 'grid'
        ? `The ground is the project's terrain grid.${carry.why ? ` ${carry.why}` : ''}`
        : 'The project has no ground to write.'
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
<h2>What goes back to RoadEng</h2><p class="ground" data-carry="ground">${escape(ground)}</p>
${list('Written back unchanged', carry.unchanged, 'Nothing is written back as read.', 'unchanged')}
${list('Rewritten from the project', carry.rewritten, 'Nothing is rewritten.', 'rewritten')}
${list('Left out', carry.leftOut, 'Nothing is left out.', 'left-out')}
${notes.length ? `<h3>Notes</h3><ul>${notes.map((n) => `<li>${escape(n)}</li>`).join('')}</ul>` : ''}
</body></html>`
}

/**
 * {@link roadEngGridFingerprint} of a project's terrain grid with its origin in the file's own grid:
 * a terrain on the flat plane adds the plane's offset, as `roadEngExportGrid` does. A terrain with
 * no grid fingerprints as an empty one.
 */
export function roadEngTerrainGridFingerprint(terrain: {
  raster?: {
    origin: [number, number]
    pixelSize: [number, number]
    width: number
    height: number
    values: ArrayLike<number | null>
  }
  epsg?: number
  localPlane?: { offsetM: [number, number] }
}): string {
  const raster = terrain.raster
  if (!raster) return roadEngGridFingerprint({ origin: [0, 0], pixelSize: [0, 0], width: 0, height: 0, values: [] })
  const offset = terrain.epsg === LOCAL_PLANE_EPSG ? terrain.localPlane?.offsetM : undefined
  return roadEngGridFingerprint({
    ...raster,
    origin: offset ? [raster.origin[0] + offset[0], raster.origin[1] + offset[1]] : raster.origin,
  })
}

/** Section 8's logging systems: its 312-byte records that are not all zero. */
export function roadEngLoggingSystemCount(bytes: Uint8Array): number {
  let n = 0
  for (let o = 0; o + LOGGING_SYSTEM_BYTES <= bytes.length; o += LOGGING_SYSTEM_BYTES)
    if (bytes.subarray(o, o + LOGGING_SYSTEM_BYTES).some((b) => b !== 0)) n++
  return n
}
const LOGGING_SYSTEM_BYTES = 312

/** What a terrain's kept parts hold, counted: logging systems, map notes and window layouts. */
export function roadEngKeptCounts(source: RoadEngTerrainSource): {
  loggingSystems: number
  mapNotes: number
  layouts: number
} {
  let mapNotes = 0
  try {
    mapNotes = source.tail ? readRoadEngMapNotes(base64ToBytes(source.tail)).notes.length : 0
  } catch {
    mapNotes = 0
  }
  return {
    loggingSystems: source.loggingSystems ? roadEngLoggingSystemCount(base64ToBytes(source.loggingSystems)) : 0,
    mapNotes,
    layouts: source.layouts?.length ?? 0,
  }
}
