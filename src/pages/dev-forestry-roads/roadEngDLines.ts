/**
 * RoadEng D-lines: the cable-analysis settings RoadEng keeps on a terrain feature, read and written
 * back, and what they give a PGMaps D-line (`CableLine`); and RoadEng's cable layout files (`.ilt`).
 *
 * A D-line is an ordinary `.ter` feature, a straight line from the yarder outward draped on the
 * ground (Softree's cable tutorial: "DL_Explore", "Proposed_Multispan_DLine"). What makes it a
 * D-line is four chunks in its attribute group (`.ter` section 3), worked out from Softree's cable
 * tutorial terrains, not from a specification:
 *
 * - **63, settings**: INI text, NUL-terminated: `[DLINE0]` with `Comment`, `Deflection` (percent),
 *   `Display`, `Segments`, `SetupID` (the logging system's number, `roadEngLoggingSystems.ts`),
 *   `Spar0…SparN−1` = `station,height,kind,name` and `SparCount`, then `[DLINES] DLineCount=1`.
 *   Stations run along the feature from its first point; stations and heights are in the file's
 *   units (15.24 = the LC550's 50 ft spar in a metre project). The first spar is kind 1 and the
 *   last kind 4 in every sample: yarder and tailhold (inferred).
 * - **12, spar values**: `f64` × 4 × spar count: the stations, the stations again, the heights, the
 *   heights again (from two-spar samples; inferred).
 * - **6, system**: `char[10]`, the logging system's number again.
 * - **69, analysis**: 72 bytes: `u32` method (1, 2 or 4 in the samples), `u32` 0, then `f64`s:
 *   0.75, the payload in lb (20,000; inferred), the clearance in ft (40, and 6.56168 = 2 m;
 *   inferred), a deflection fraction (0.1, 0.08), `u32` 10 or 0, and three more values.
 *
 * A D-line read from a file keeps those chunks as read (`chunks`); writing it back rewrites only
 * what was edited, so an unedited D-line goes back byte for byte. A D-line made in PG Maps gets all
 * four, its analysis chunk from Softree's "DL_Explore" D-lines with the payload and clearance given.
 *
 * `.ilt` files are RoadEng screen and multi-plot layouts (Softree's "Training Single DLine MP.ilt"):
 * window sizes, the D-line chart windows' scales (`[dlinedefl]`, `[dlineload]`, `[dlineslen]`,
 * `[dlinetension]`, numbered for several D-lines) and multi-plot panels whose titles name D-lines.
 * They hold no D-line geometry or rigging: {@link readRoadEngLayout} lists what they show and keeps
 * the text for writing back unchanged.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, strToU8 } from 'fflate'
import { fromSi } from './roadEngLoggingSystems'
import {
  base64ToBytes,
  bytesToBase64,
  cString,
  editRoadEngIni,
  latin1Text,
  putCString,
  readRoadEngIni,
  roadEngIniValue,
  type RoadEngIniEdit,
} from './roadEngText'

export const ROADENG_DLINE_SETTINGS_CHUNK = 63
export const ROADENG_DLINE_SPARS_CHUNK = 12
export const ROADENG_DLINE_SYSTEM_CHUNK = 6
export const ROADENG_DLINE_ANALYSIS_CHUNK = 69
/** The chunk types that carry a D-line, in the order RoadEng writes them. */
export const ROADENG_DLINE_CHUNKS: readonly number[] = [
  ROADENG_DLINE_SETTINGS_CHUNK,
  ROADENG_DLINE_SPARS_CHUNK,
  ROADENG_DLINE_SYSTEM_CHUNK,
  ROADENG_DLINE_ANALYSIS_CHUNK,
]
/** Spars read or written at most on one D-line. */
export const MAX_ROADENG_DLINE_SPARS = 50
/** Longest D-line settings text read, bytes. */
export const MAX_ROADENG_DLINE_TEXT = 64_000

const ANALYSIS_BYTES = 72
const SYSTEM_BYTES = 10
const LB_TO_KG = 0.45359237
const FT_TO_M = 0.3048
const YARDER = 1
const TAILHOLD = 4

export interface RoadEngDLineSpar {
  /** Along the feature from its first point, file units. */
  station: number
  /** Height above ground, file units. */
  height: number
  /** 1 at the yarder and 4 at the tailhold in the samples. */
  kind: number
  name: string
}

export interface RoadEngDLineAnalysis {
  /** RoadEng's analysis method number (1, 2 or 4 in the samples). */
  method: number
  /** Payload, kg (stored in lb; inferred). */
  payloadKg: number
  /** Clearance, m (stored in ft; inferred). */
  clearanceM: number
}

export interface RoadEngDLine {
  comment: string
  deflectionPercent: number
  display: number
  segments: number
  /** The logging system's number (`RoadEngLoggingSystem.id`), or null. */
  systemId: string | null
  /** In station order. */
  spars: RoadEngDLineSpar[]
  analysis: RoadEngDLineAnalysis | null
  /** The D-line chunks as read, in file order, payloads base64: written back from these. */
  chunks?: { type: number; tag: number; payload: string }[]
}

/** The chunk bytes one stored D-line may keep, base64 characters. */
export const MAX_ROADENG_DLINE_CHUNK_CHARS = 200_000

/**
 * A stored D-line (`CableLine.roadEng`) checked for shape and size, for the project parser; anything
 * malformed is refused, never repaired. Its chunks are not interpreted here: they are written back.
 */
export function parseRoadEngDLineRecord(value: unknown): RoadEngDLine {
  const fail = (why: string): never => {
    throw Error(`The kept RoadEng D-line settings are not valid: ${why}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object.')
  const v = value as Record<string, unknown>
  const finite = (x: unknown, what: string) =>
    typeof x === 'number' && Number.isFinite(x) ? x : fail(`${what} must be a number.`)
  const text = (x: unknown, what: string, max = 1000) =>
    typeof x === 'string' && x.length <= max ? x : fail(`${what} must be text of at most ${max} characters.`)
  if (!Array.isArray(v.spars) || v.spars.length < 2 || v.spars.length > MAX_ROADENG_DLINE_SPARS)
    fail(`it needs between 2 and ${MAX_ROADENG_DLINE_SPARS} spars.`)
  const spars = (v.spars as unknown[]).map((raw): RoadEngDLineSpar => {
    if (!raw || typeof raw !== 'object') fail('a spar must be an object.')
    const r = raw as Record<string, unknown>
    return {
      station: finite(r.station, 'A spar station'),
      height: finite(r.height, 'A spar height'),
      kind: finite(r.kind, 'A spar kind'),
      name: text(r.name, 'A spar name', 200),
    }
  })
  let analysis: RoadEngDLineAnalysis | null = null
  if (v.analysis !== null && v.analysis !== undefined) {
    if (typeof v.analysis !== 'object') fail('the analysis settings must be an object.')
    const a = v.analysis as Record<string, unknown>
    analysis = {
      method: finite(a.method, 'The analysis method'),
      payloadKg: finite(a.payloadKg, 'The payload'),
      clearanceM: finite(a.clearanceM, 'The clearance'),
    }
  }
  let chunks: RoadEngDLine['chunks']
  if (v.chunks !== undefined) {
    if (!Array.isArray(v.chunks) || v.chunks.length > 50) fail('its chunks must be a list of at most 50.')
    let total = 0
    chunks = (v.chunks as unknown[]).map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>
      const payload = text(r.payload, 'A chunk', MAX_ROADENG_DLINE_CHUNK_CHARS)
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) fail('a chunk is not base64.')
      total += payload.length
      return { type: finite(r.type, 'A chunk type'), tag: finite(r.tag, 'A chunk tag'), payload }
    })
    if (total > MAX_ROADENG_DLINE_CHUNK_CHARS) fail('its chunks are too large.')
  }
  const systemId = v.systemId === null || v.systemId === undefined ? null : text(v.systemId, 'The system number', 50)
  return {
    comment: text(v.comment ?? '', 'The comment', MAX_ROADENG_DLINE_TEXT),
    deflectionPercent: finite(v.deflectionPercent, 'The deflection'),
    display: finite(v.display, 'The display setting'),
    segments: finite(v.segments, 'The segment count'),
    systemId,
    spars,
    analysis,
    ...(chunks ? { chunks } : {}),
  }
}

export interface RoadEngChunk {
  type: number
  tag: number
  payload: Uint8Array
}

const num = (v: string | null | undefined, fallback: number) => {
  const n = Number(v)
  return v != null && v.trim() !== '' && Number.isFinite(n) ? n : fallback
}

/**
 * The D-line a feature's chunks carry, or null when it has no settings chunk. A settings text that
 * cannot be read is reported, never guessed at.
 */
export function readRoadEngDLine(chunks: readonly RoadEngChunk[]): {
  dLine: RoadEngDLine | null
  problem: string | null
} {
  const settings = chunks.find((c) => c.type === ROADENG_DLINE_SETTINGS_CHUNK)
  if (!settings) return { dLine: null, problem: null }
  if (settings.payload.length > MAX_ROADENG_DLINE_TEXT) return { dLine: null, problem: 'its settings are too long' }
  const text = cString(settings.payload, 0, settings.payload.length)
  const sections = readRoadEngIni(text)
  const line = sections.find((s) => /^dline0$/i.test(s.name))
  if (!line) return { dLine: null, problem: 'its settings name no D-line' }
  const get = (key: string) => line.entries.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? null
  const sparCount = num(get('SparCount'), 0)
  if (!Number.isInteger(sparCount) || sparCount < 2 || sparCount > MAX_ROADENG_DLINE_SPARS)
    return { dLine: null, problem: `its settings list ${get('SparCount') ?? 'no'} spars` }
  const spars: RoadEngDLineSpar[] = []
  for (let k = 0; k < sparCount; k++) {
    const value = get(`Spar${k}`)
    const parts = value?.split(',') ?? []
    const station = Number(parts[0]),
      height = Number(parts[1])
    if (parts.length < 3 || !Number.isFinite(station) || !Number.isFinite(height))
      return { dLine: null, problem: `its spar ${k + 1} cannot be read` }
    spars.push({ station, height, kind: num(parts[2], 0), name: parts.slice(3).join(',') })
  }
  const setup = get('SetupID')
  const analysisChunk = chunks.find((c) => c.type === ROADENG_DLINE_ANALYSIS_CHUNK)
  let analysis: RoadEngDLineAnalysis | null = null
  if (analysisChunk && analysisChunk.payload.length >= ANALYSIS_BYTES) {
    const v = new DataView(analysisChunk.payload.buffer, analysisChunk.payload.byteOffset, ANALYSIS_BYTES)
    analysis = {
      method: v.getUint32(0, true),
      payloadKg: v.getFloat64(16, true) * LB_TO_KG,
      clearanceM: v.getFloat64(24, true) * FT_TO_M,
    }
  }
  const lines = num(roadEngIniValue(text, 'DLINES', 'DLineCount'), 1)
  return {
    dLine: {
      comment: get('Comment') ?? '',
      deflectionPercent: num(get('Deflection'), 0),
      display: num(get('Display'), 1),
      segments: num(get('Segments'), 3),
      systemId: setup && setup.trim() ? setup.trim() : null,
      spars,
      analysis,
      chunks: chunks
        .filter((c) => ROADENG_DLINE_CHUNKS.includes(c.type))
        .map((c) => ({ type: c.type, tag: c.tag, payload: bytesToBase64(c.payload) })),
    },
    problem: lines > 1 ? `it holds ${lines} D-lines; the first is read and the others are kept as they are` : null,
  }
}

const chunk = (type: number, tag: number, payload: Uint8Array) => {
  const out = new Uint8Array(16 + payload.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, out.length, true)
  v.setUint32(4, 2, true)
  v.setUint32(8, type, true)
  v.setInt32(12, tag, true)
  out.set(payload, 16)
  return out
}

/** A number as text that reads back to the same number ("15.24", "172.4", as RoadEng prints them). */
const exact = (v: number) => (Number.isFinite(v) ? String(v) : '0')

const sameNumber = (text: string | undefined, value: number) => text !== undefined && Number(text) === value

/** The settings text for a D-line, edited key by key from the one read when there is one. */
function settingsText(d: RoadEngDLine, original: string | null): string {
  const spar = (s: RoadEngDLineSpar) =>
    `${exact(s.station)},${exact(s.height)},${Math.round(s.kind)},${latin1Text(s.name).replace(/[\r\n]/g, ' ')}`
  const values: [string, string][] = [
    ['Comment', latin1Text(d.comment).replace(/[\r\n]/g, ' ')],
    ['Deflection', exact(d.deflectionPercent)],
    ['Display', String(Math.round(d.display))],
    ['Segments', String(Math.round(d.segments))],
    ...(d.systemId !== null ? ([['SetupID', d.systemId]] as [string, string][]) : []),
    ...d.spars.map((s, k) => [`Spar${k}`, spar(s)] as [string, string]),
    ['SparCount', String(d.spars.length)],
  ]
  if (original === null)
    return ['[DLINE0]', ...values.map(([k, v]) => `${k}=${v}`), '[DLINES]', 'DLineCount=1', ''].join('\r\n')
  const old = readRoadEngIni(original).find((s) => /^dline0$/i.test(s.name))?.entries ?? []
  const oldValue = (key: string) => old.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
  // Only keys whose value changed are rewritten, so "15.24" stays as RoadEng printed it.
  const changed = values.filter(([key, value]) => {
    const was = oldValue(key)
    if (was === undefined) return true
    if (/^spar\d+$/i.test(key)) {
      const [a, b] = [was.split(','), value.split(',')]
      return !(
        sameNumber(a[0], Number(b[0])) &&
        sameNumber(a[1], Number(b[1])) &&
        sameNumber(a[2], Number(b[2])) &&
        a.slice(3).join(',') === b.slice(3).join(',')
      )
    }
    if (key === 'Comment' || key === 'SetupID') return was !== value
    return !sameNumber(was, Number(value))
  })
  const edits: RoadEngIniEdit[] = changed.length ? [{ section: 'DLINE0', set: changed }] : []
  // Spars past the new count are dropped.
  const extra = old.filter(([k]) => {
    const m = /^spar(\d+)$/i.exec(k)
    return m !== null && Number(m[1]) >= d.spars.length
  })
  let text = editRoadEngIni(original, edits)
  if (extra.length || (d.systemId === null && oldValue('SetupID') !== undefined)) {
    const section = readRoadEngIni(text).find((s) => /^dline0$/i.test(s.name))!
    const keep = section.entries.filter(
      ([k]) => !extra.some(([e]) => e === k) && !(d.systemId === null && /^setupid$/i.test(k)),
    )
    text = editRoadEngIni(text, [{ section: section.name, replace: keep.map(([k, v]) => `${k}=${v}`) }])
  }
  return text
}

/** Softree's "DL_Explore" analysis settings, for D-lines made in PG Maps. */
function defaultAnalysis(): Uint8Array {
  const b = new Uint8Array(ANALYSIS_BYTES)
  const v = new DataView(b.buffer)
  v.setUint32(0, 2, true)
  v.setFloat64(8, 0.75, true)
  v.setFloat64(16, 20000, true)
  v.setFloat64(24, 40, true)
  v.setFloat64(32, 0.1, true)
  v.setUint32(40, 10, true)
  v.setFloat64(56, 1, true)
  return b
}

/**
 * The attribute chunks for a D-line, back to back with their 16-byte headers, ready to follow its
 * feature's group chunk (type 52) in `.ter` section 3.
 */
export function encodeRoadEngDLineChunks(d: RoadEngDLine): Uint8Array {
  if (d.spars.length < 2 || d.spars.length > MAX_ROADENG_DLINE_SPARS)
    throw Error(`A D-line needs between 2 and ${MAX_ROADENG_DLINE_SPARS} spars.`)
  const read = (d.chunks ?? []).map((c) => ({ type: c.type, tag: c.tag, payload: base64ToBytes(c.payload) }))
  const original = read.find((c) => c.type === ROADENG_DLINE_SETTINGS_CHUNK)
  const was = original ? readRoadEngDLine(read).dLine : null
  const spars = (s: readonly RoadEngDLineSpar[]) => [
    ...s.map((x) => x.station),
    ...s.map((x) => x.station),
    ...s.map((x) => x.height),
    ...s.map((x) => x.height),
  ]
  const sparsChanged =
    !was ||
    was.spars.length !== d.spars.length ||
    was.spars.some((s, k) => s.station !== d.spars[k].station || s.height !== d.spars[k].height)

  const payloadFor = (type: number, kept: Uint8Array | null): Uint8Array | null => {
    if (type === ROADENG_DLINE_SETTINGS_CHUNK) {
      const text = settingsText(d, kept ? cString(kept, 0, kept.length) : null)
      if (kept && text === cString(kept, 0, kept.length)) return kept
      const bytes = strToU8(text, true)
      const out = new Uint8Array(bytes.length + 1)
      out.set(bytes)
      return out
    }
    if (type === ROADENG_DLINE_SPARS_CHUNK) {
      if (kept && !sparsChanged) return kept
      const values = spars(d.spars)
      const out = new Uint8Array(8 * values.length)
      const v = new DataView(out.buffer)
      values.forEach((x, k) => v.setFloat64(8 * k, x, true))
      return out
    }
    if (type === ROADENG_DLINE_SYSTEM_CHUNK) {
      if (d.systemId === null) return null
      if (kept && kept.length >= SYSTEM_BYTES && cString(kept, 0, kept.length) === d.systemId) return kept
      const out = kept && kept.length >= SYSTEM_BYTES ? kept.slice() : new Uint8Array(SYSTEM_BYTES)
      putCString(out, 0, out.length, d.systemId)
      return out
    }
    if (type === ROADENG_DLINE_ANALYSIS_CHUNK) {
      const out = kept && kept.length >= ANALYSIS_BYTES ? kept.slice() : defaultAnalysis()
      const a = d.analysis
      if (a) {
        const v = new DataView(out.buffer, out.byteOffset, out.byteLength)
        if (v.getUint32(0, true) !== a.method) v.setUint32(0, a.method >>> 0, true)
        const payload = fromSi(a.payloadKg, LB_TO_KG, v.getFloat64(16, true))
        if (!Object.is(payload, v.getFloat64(16, true))) v.setFloat64(16, payload, true)
        const clearance = fromSi(a.clearanceM, FT_TO_M, v.getFloat64(24, true))
        if (!Object.is(clearance, v.getFloat64(24, true))) v.setFloat64(24, clearance, true)
      }
      return out
    }
    return kept
  }

  const out: Uint8Array[] = []
  const done = new Set<number>()
  for (const c of read) {
    const payload = payloadFor(c.type, c.payload)
    done.add(c.type)
    if (payload) out.push(chunk(c.type, c.tag, payload))
  }
  for (const type of ROADENG_DLINE_CHUNKS) {
    if (done.has(type)) continue
    const payload = payloadFor(type, null)
    if (payload) out.push(chunk(type, -1, payload))
  }
  const total = out.reduce((s, c) => s + c.length, 0)
  const bytes = new Uint8Array(total)
  let o = 0
  for (const c of out) {
    bytes.set(c, o)
    o += c.length
  }
  return bytes
}

/** How many chunks {@link encodeRoadEngDLineChunks} writes (for the `.ter` header's chunk count). */
export function roadEngDLineChunkCount(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let n = 0
  for (let o = 0; o + 16 <= bytes.length; o += v.getUint32(o, true)) n++
  return n
}

// ---- PGMaps D-lines --------------------------------------------------------------------------------

/** A RoadEng D-line as a PGMaps D-line would hold it, in the file's grid and units. */
export interface RoadEngCableCandidate {
  name: string
  /** The first and last spars' positions on the feature, x, y in the file's grid. */
  start: [number, number]
  end: [number, number]
  startHeight: number
  endHeight: number
  deflectionPercent: number
  /** Which end the yarder (spar kind 1) stands at; `start` when neither or both say. */
  yarderAt: 'start' | 'end'
  /** Spars between the first and last, with their positions. */
  intermediate: (RoadEngDLineSpar & { x: number; y: number })[]
  /** The logging system it is rigged with (`RoadEngLoggingSystem.id`). */
  systemId: string | null
  /** Payload and clearance from the analysis settings, when the D-line has them. */
  payloadKg: number | null
  clearanceM: number | null
}

/** The point at a plan distance along x, y, z triples; past the ends, the end itself. */
function along(points: Float64Array, distance: number): [number, number] {
  const n = points.length / 3
  if (!n) return [NaN, NaN]
  let walked = 0
  for (let k = 1; k < n; k++) {
    const dx = points[3 * k] - points[3 * k - 3],
      dy = points[3 * k + 1] - points[3 * k - 2]
    const step = Math.hypot(dx, dy)
    if (walked + step >= distance && step > 0) {
      const t = Math.max(0, (distance - walked) / step)
      return [points[3 * k - 3] + t * dx, points[3 * k - 2] + t * dy]
    }
    walked += step
  }
  return distance <= 0 ? [points[0], points[1]] : [points[3 * n - 3], points[3 * n - 2]]
}

/**
 * What a terrain feature's D-line gives a PGMaps D-line (`CableLine`): ends at the first and last
 * spars, their heights, the deflection, where the yarder is, and the rigging links. Null when the
 * feature carries no D-line. Positions and heights stay in the file's grid and units.
 */
export function roadEngDLineCable(feature: {
  name: string
  points: Float64Array
  stationOrigin: number
  dLine?: RoadEngDLine
}): RoadEngCableCandidate | null {
  const d = feature.dLine
  if (!d || d.spars.length < 2 || feature.points.length < 6) return null
  const spars = [...d.spars].sort((a, b) => a.station - b.station)
  const at = (s: RoadEngDLineSpar) => along(feature.points, s.station - feature.stationOrigin)
  const first = spars[0],
    last = spars[spars.length - 1]
  return {
    name: feature.name,
    start: at(first),
    end: at(last),
    startHeight: first.height,
    endHeight: last.height,
    deflectionPercent: d.deflectionPercent,
    yarderAt: last.kind === YARDER && first.kind !== YARDER ? 'end' : 'start',
    intermediate: spars.slice(1, -1).map((s) => {
      const [x, y] = at(s)
      return { ...s, x, y }
    }),
    systemId: d.systemId,
    payloadKg: d.analysis?.payloadKg ?? null,
    clearanceM: d.analysis?.clearanceM ?? null,
  }
}

/**
 * A D-line to write on a feature that runs from the yarder (station 0) to the tailhold (`lengthM`,
 * file units). `base` is the D-line read from the file, whose settings, intermediate spars within
 * the new length and chunks are kept; without it the D-line is new.
 */
export function roadEngDLineFor(
  line: {
    lengthM: number
    yarderHeight: number
    tailholdHeight: number
    deflectionPercent: number
    comment?: string
    systemId?: string | null
    payloadKg?: number
    clearanceM?: number
  },
  base?: RoadEngDLine | null,
): RoadEngDLine {
  const old = base ? [...base.spars].sort((a, b) => a.station - b.station) : []
  const first = old[0],
    last = old[old.length - 1]
  const inner = old.slice(1, -1).filter((s) => s.station > 0 && s.station < line.lengthM)
  const analysis =
    line.payloadKg !== undefined || line.clearanceM !== undefined || base?.analysis
      ? {
          method: base?.analysis?.method ?? 2,
          payloadKg: line.payloadKg ?? base?.analysis?.payloadKg ?? 20000 * LB_TO_KG,
          clearanceM: line.clearanceM ?? base?.analysis?.clearanceM ?? 40 * FT_TO_M,
        }
      : null
  return {
    comment: line.comment ?? base?.comment ?? 'DLine1',
    deflectionPercent: line.deflectionPercent,
    display: base?.display ?? 1,
    segments: base?.segments ?? 3,
    systemId: line.systemId !== undefined ? line.systemId : (base?.systemId ?? null),
    spars: [
      { station: 0, height: line.yarderHeight, kind: first?.kind ?? YARDER, name: first?.name ?? 'MidSpar1' },
      ...inner,
      {
        station: line.lengthM,
        height: line.tailholdHeight,
        kind: last?.kind ?? TAILHOLD,
        name: last?.name ?? `MidSpar${inner.length + 2}`,
      },
    ],
    analysis,
    ...(base?.chunks ? { chunks: base.chunks } : {}),
  }
}

// ---- .ilt layouts ----------------------------------------------------------------------------------

export interface RoadEngLayout {
  /** The file's text as read, written back unchanged. */
  text: string
  /** D-line chart windows: deflection (`defl`), load, `slen` and tension, numbered per D-line. */
  dLineCharts: { section: string; chart: string; index: number | null; parameters: number[]; scale: number | null }[]
  /** Multi-plot panels: their view code and, for text panels, their title. */
  panels: { key: string; view: number; title: string | null }[]
  /** `[Plan] CableDisplay`: how the plan draws cable lines, as RoadEng stores it. */
  planCableDisplay: number[] | null
}

/** Reads a RoadEng `.ilt` (or the window part of a `.tlt`); the text is kept for writing back. */
export function readRoadEngLayout(bytes: Uint8Array | string): RoadEngLayout {
  const text = typeof bytes === 'string' ? bytes : strFromU8(bytes, true)
  const sections = readRoadEngIni(text)
  const numbers = (v: string | undefined) => (v ?? '').split(',').map(Number).filter(Number.isFinite)
  const dLineCharts: RoadEngLayout['dLineCharts'] = []
  for (const s of sections) {
    const m = /^dline([a-z]+?)(\d*)$/i.exec(s.name)
    if (!m) continue
    const get = (k: string) => s.entries.find(([key]) => key.toLowerCase() === k)?.[1]
    const scale = Number(get('scale'))
    dLineCharts.push({
      section: s.name,
      chart: m[1].toLowerCase(),
      index: m[2] ? Number(m[2]) : null,
      parameters: numbers(get('parameters')),
      scale: Number.isFinite(scale) ? scale : null,
    })
  }
  const multi = sections.find((s) => s.name.toLowerCase() === 'multi')?.entries ?? []
  const panels = multi
    .filter(([k]) => /^SubView\d+$/i.test(k))
    .map(([key, value]) => ({
      key,
      view: Number(value.split(',')[0]),
      title: multi.find(([k]) => k.toLowerCase() === `${key.toLowerCase()}extra1`)?.[1] ?? null,
    }))
  const plan = sections.find((s) => s.name.toLowerCase() === 'plan')?.entries ?? []
  const cable = plan.find(([k]) => k.toLowerCase() === 'cabledisplay')?.[1]
  return { text, dLineCharts, panels, planCableDisplay: cable === undefined ? null : numbers(cable) }
}

/** The bytes of a layout for writing back: its text as read, Latin-1. */
export const encodeRoadEngLayout = (layout: Pick<RoadEngLayout, 'text'>): Uint8Array => strToU8(layout.text, true)
