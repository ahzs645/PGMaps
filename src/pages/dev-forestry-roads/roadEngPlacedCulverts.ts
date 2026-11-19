/**
 * Culverts placed in a RoadEng design (`LocationN.ds1`), read onto the road and written back.
 *
 * **The file.** A `.ds1` is three chunks, each a 24-byte header (`u16` 12, `u16` section 1–3,
 * `u32` record count, `u32` payload bytes, `u32` 0, then 8 bytes RoadEng leaves uninitialised) and
 * its payload. Section 2 holds the placed culverts, each a `u16` length and that many Latin-1
 * characters: the culvert's description, `%#%|`, then 20 comma-separated fields. Sections 1 and 3
 * are kept as read (section 3 holds label positions in Location 18_3). Section 1 holds the
 * design's floating labels, laid out as a terrain's map notes (`roadEngMapNotes.ts`: a `u16`
 * length, the text, `%#%`, a newline and `X,Y,2,-1`, then a 60-byte label format); its header's
 * byte count is not its length (124 for 125 bytes in Softree's Road 6 stage 15–18 designs, 134 for
 * 144 in V11 Location 18_4 onward, 117 for 120 in a knowledge-base bridge design), so its records
 * are walked to find section 2. An alignment with no culverts has three empty headers.
 *
 * **The fields**, read from Softree's samples (Widening only, Align stage 8, Hart Rd, Location
 * 18_1–3) against the `[Culvert] DefDrainCulvert`/`DefStreamCulvert` keys, which use the same layout,
 * and Softree's Culvert Editor help:
 *
 * | # | Read as | Evidence |
 * | - | - | - |
 * | 0 | 0 cross drain, 1 stream (natural channel) | the two defaults; stage 8's creek culvert |
 * | 1 | L-line station, project units | stage 8 at 1391.181 ft, the tutorial's creek crossing |
 * | 2 | P-line station; `3.40282346639e+38` (FLT_MAX) when there is none | every sample |
 * | 3 | diameter, thousandths of a project unit | stage 8's "60\" pipe" is 5000 in a feet design (1.524 m) |
 * | 4 | skew, degrees clockwise from the L-line ahead, 90 square | Location 18's culvert at 573.2 m reads 132.64°; the drawn stream crosses the road 129.3° clockwise from it there (3.4° apart; anticlockwise would be 50.7°) |
 * | 5 | gradient, % | signed values; the help's Gradient (%) |
 * | 6, 7 | length left and right of the L-line, project units | the help's Left and Right lengths |
 * | 8 | vertical position depth, project units | stage 8's 8 ft |
 * | 9 | option bits: see below | |
 * | 10–12 | 2, 0, 0 in every sample (shape and its box or arch sizes, no sample has another shape): kept as read | |
 * | 13 | template override on (1) or off (0) | V11 tutorial, chapter 17: the culvert at 338 m, Override ticked |
 * | 14, 15 | override ditch width and depth, project units | the same culvert: width 1, depth 0.6, as the tutorial types them |
 * | 16, 17 | override template offset and taper, project units | the Culvert Properties help's order (width, depth, offset, taper); defaults 3 and 2 m, 10 and 6 ft |
 * | 18, 19 | 0 and FLT_MAX, or 1 and a station near the culvert's (one knowledge-base design): kept as read | |
 *
 * **Field 9's bits**, read from Softree's V11 RoadEng Resource tutorial (chapter 17), which builds
 * Location 18's two culverts from the design's stream default (`[Culvert] DefStreamCulvert`, 414):
 * unticking Auto under Gradient at 573.2 m leaves 410 (bit 2 cleared), and ticking Override and
 * unticking Auto under Skew at 338 m leaves 4508 (bit 12 set, bit 1 cleared).
 *
 * | Bit | Read as | Further evidence |
 * | - | - | - |
 * | 1 (2) | Skew Auto | set on every culvert whose skew is unrounded (132.637…° from the stream, 93.047…°, 87.403…° = 90 − (grade − 3) × 3, the help's cross-drain formula), clear on typed skews (75°, 91°, 92°) |
 * | 2 (4) | Gradient Auto | set on unrounded gradients (−2.8298…%, 3.2531…%), clear on typed ones (5 %, 0.447 %, −5 %) |
 * | 7 (128) | Length Auto | set on every culvert whose left and right lengths are unrounded (51.0658… ft), clear on typed ones (10.53 m, 6/4 m) |
 * | 12 (4096) | Template override | set exactly where field 13 is 1: the 338 m culvert and two designs' defaults, of 150 designs |
 *
 * Bits 3, 4, 5, 6 and 8 are not decoded: bit 3 is set on every culvert the tutorials put at
 * Attach to upper ditch/catch point (Align stage 8, Road 6 stage 14) and clear on the typed-depth
 * cross drains of two knowledge-base designs (272), so the vertical-position option is among them,
 * but no sample separates the other three positions. The depth is therefore shown, never applied:
 * PGMaps' inverts stay unset.
 *
 * Softree's help says skew is measured anticlockwise; the one sample with a drawn stream at its
 * culvert says clockwise, which is what PGMaps reads (`skewDegrees` = field 4 − 90).
 *
 * **Read.** A record whose station lies on the road (between the design's first and last station)
 * and whose fields parse becomes a road culvert, up to {@link MAX_PLACED_CULVERTS}; the rest stay
 * in the file unread. The culvert keeps its record (`Culvert.roadEngDesign`).
 *
 * **Write.** Each record goes back in its place: one no culvert reads is kept as it was, one whose
 * culvert was deleted is dropped, and one whose culvert is unchanged is the same bytes. An edited
 * culvert changes only the fields it holds a value for (station, class, diameter, skew, lengths,
 * gradient, description), each with its own leading space. Where an edit sets a skew, lengths or a
 * gradient that RoadEng computes (its Auto bit set), that bit is cleared, so RoadEng keeps the value
 * written rather than computing its own. A culvert with no record of this design becomes a new
 * record, from the design's default culvert of its kind (else RoadEng's), placed in station order;
 * it keeps the default's Auto lengths and gradient, and its skew Auto only where its skew is the
 * default's. Written in other units, every length converts, the override's four included. An
 * unedited `.ds1` is written byte for byte.
 *
 * Checked by `roadEngPlacedCulverts.test.ts`. Pure: no DOM or network access.
 */
import type { Culvert } from './engineeringTypes'
import { parseCulvertCostDefault } from './culvertCostDefaults'

/** Culverts a road holds (`parseEngineering`); records past it stay in the file unread. */
export const MAX_PLACED_CULVERTS = 100
/** A written station within this of the record's keeps the record's, m: rebuilding the plan moves a station by well under it. */
export const ROADENG_CULVERT_STATION_TOLERANCE_M = 0.002
/** Field 9 bit: RoadEng computes the skew (the Culvert Editor's Auto under Skew). */
export const ROADENG_CULVERT_SKEW_AUTO = 2
/** Field 9 bit: RoadEng computes the gradient (Auto under Gradient). */
export const ROADENG_CULVERT_GRADIENT_AUTO = 4
/** Field 9 bit: RoadEng computes the lengths left and right (Auto under Length). */
export const ROADENG_CULVERT_LENGTH_AUTO = 128
/** Field 9 bit: the template override is on (field 13). */
export const ROADENG_CULVERT_OVERRIDE = 4096
/** RoadEng's "no value" (FLT_MAX); a field at or past it is never a dimension or a station. */
export const ROADENG_NO_VALUE = 3.4e38
/** The P-line station RoadEng writes for a culvert with none. */
const NO_VALUE_TEXT = '3.40282346639e+38'
/** The `.ds1` header size and its first word. */
const HEADER_BYTES = 24
const HEADER_WORD = 12
const DELIMITER = '%#%|'
/** PGMaps' skew limit, degrees from square. */
const MAX_SKEW_DEG = 80
/** RoadEng 11's own default culverts (`[Culvert]` in a new design), used when a design gives none. */
const ROADENG_DEFAULT_CULVERT = {
  'cross-drain':
    '%#%|0,3.40282346639e+38,3.40282346639e+38,500,90,2,3,3,0,440,2,0, 0, 0, 0, 0, 3, 2, 0, 3.40282346639e+38',
  stream: '%#%|1,3.40282346639e+38,3.40282346639e+38,1000,90,0,3,3,0,412,2,0, 0, 0, 0, 0, 3, 2, 0, 3.40282346639e+38',
} as const

/** What a culvert placed in a RoadEng design held, kept on the road's culvert (`Culvert.roadEngDesign`). */
export interface RoadEngPlacedCulvertRecord {
  /** Its position among the design's placed culverts (`.ds1` section 2), from 0. */
  index: number
  /** The record as read: description, `%#%|`, then its fields, Latin-1. */
  raw: string
  /** Metres per project unit of the design it was read from. */
  unitM: number
  /** A RoadEng gradient (%) typed in this workspace; absent keeps the record's. */
  gradientPercent?: number
}

/** One `.ds1` chunk: its header as read and its payload. */
interface Ds1Chunk {
  header: Uint8Array
  section: number
  count: number
  payload: Uint8Array
}

/** A placed culvert's record, its fields read (`null` where a field is FLT_MAX or not a number). */
export interface PlacedCulvertFields {
  description: string
  /** The fields as written, leading spaces included. */
  fields: string[]
  kind: 'stream' | 'cross-drain' | null
  stationM: number | null
  pStationM: number | null
  diameterM: number | null
  /** Degrees clockwise from the L-line ahead, 90 square. */
  skewFromLineDeg: number | null
  gradientPercent: number | null
  leftM: number | null
  rightM: number | null
  depthM: number | null
  /** Field 9 as written: option bits, partly decoded (`auto`, `override`). */
  flags: number | null
  /** What RoadEng computes itself (field 9's Auto bits); null without a readable flag word. */
  auto: { skew: boolean; gradient: boolean; length: boolean } | null
  /** The template override (fields 13–17), m; null where the record has none of those fields. */
  override: {
    on: boolean
    ditchWidthM: number | null
    ditchDepthM: number | null
    offsetM: number | null
    taperM: number | null
  } | null
}

const value = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === '') return null
  const v = Number(text.trim())
  return Number.isFinite(v) && Math.abs(v) < ROADENG_NO_VALUE ? v : null
}

/** A record's fields; null when it has no `%#%|` or fewer than nine fields. */
export function readPlacedCulvert(raw: string, unitM: number): PlacedCulvertFields | null {
  const at = raw.indexOf(DELIMITER)
  if (at < 0) return null
  const fields = raw.slice(at + DELIMITER.length).split(',')
  if (fields.length < 9) return null
  const n = (i: number) => value(fields[i])
  const m = (i: number) => (n(i) === null ? null : n(i)! * unitM)
  const cls = n(0)
  return {
    description: raw.slice(0, at),
    fields,
    kind: cls === 1 ? 'stream' : cls === 0 ? 'cross-drain' : null,
    stationM: m(1),
    pStationM: m(2),
    diameterM: n(3) === null ? null : (n(3)! / 1000) * unitM,
    skewFromLineDeg: n(4),
    gradientPercent: n(5),
    leftM: m(6),
    rightM: m(7),
    depthM: m(8),
    flags: n(9),
    auto: culvertAuto(n(9)),
    override:
      fields.length > 17 && n(13) !== null
        ? { on: n(13) === 1, ditchWidthM: m(14), ditchDepthM: m(15), offsetM: m(16), taperM: m(17) }
        : null,
  }
}

/** A flag word's Auto bits; null where it is not a non-negative whole number. */
function culvertAuto(flags: number | null): PlacedCulvertFields['auto'] {
  if (flags === null || !Number.isInteger(flags) || flags < 0) return null
  return {
    skew: (flags & ROADENG_CULVERT_SKEW_AUTO) !== 0,
    gradient: (flags & ROADENG_CULVERT_GRADIENT_AUTO) !== 0,
    length: (flags & ROADENG_CULVERT_LENGTH_AUTO) !== 0,
  }
}

/** The `.ds1` chunks; null when the bytes are not three chunks laid out as RoadEng writes them. */
function readChunks(bytes: Uint8Array): Ds1Chunk[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: Ds1Chunk[] = []
  let at = 0
  while (at < bytes.length) {
    if (at + HEADER_BYTES > bytes.length) return null
    const section = view.getUint16(at + 2, true)
    let size = view.getUint32(at + 8, true)
    if (section === 1) size = labelSectionBytes(view, at, size) ?? size
    if (
      view.getUint16(at, true) !== HEADER_WORD ||
      section !== chunks.length + 1 ||
      at + HEADER_BYTES + size > bytes.length
    )
      return null
    chunks.push({
      header: bytes.slice(at, at + HEADER_BYTES),
      section,
      count: view.getUint32(at + 4, true),
      payload: bytes.slice(at + HEADER_BYTES, at + HEADER_BYTES + size),
    })
    at += HEADER_BYTES + size
  }
  return chunks.length === 3 ? chunks : null
}

/** Bytes of a label format after each floating label's text in section 1. */
const LABEL_FORMAT_BYTES = 60

/**
 * Section 1's length, its floating labels walked (`u16` length, text, 60-byte format), where that
 * lands on section 2's header and the stated byte count does not; null to keep the stated count.
 */
function labelSectionBytes(view: DataView, at: number, stated: number): number | null {
  const count = view.getUint32(at + 4, true)
  const isNext = (p: number) =>
    p + HEADER_BYTES <= view.byteLength && view.getUint16(p, true) === HEADER_WORD && view.getUint16(p + 2, true) === 2
  if (!count || isNext(at + HEADER_BYTES + stated)) return null
  let p = at + HEADER_BYTES
  for (let k = 0; k < count; k++) {
    if (p + 2 > view.byteLength) return null
    p += 2 + view.getUint16(p, true) + LABEL_FORMAT_BYTES
  }
  return isNext(p) ? p - at - HEADER_BYTES : null
}

const latin1 = (bytes: Uint8Array) => {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return text
}

/** Section 2's records as text; null when its lengths do not add up to its payload and count. */
function readRecords(chunk: Ds1Chunk): string[] | null {
  const records: string[] = []
  let at = 0
  while (at < chunk.payload.length) {
    if (at + 2 > chunk.payload.length) return null
    const length = chunk.payload[at] | (chunk.payload[at + 1] << 8)
    if (at + 2 + length > chunk.payload.length) return null
    records.push(latin1(chunk.payload.subarray(at + 2, at + 2 + length)))
    at += 2 + length
  }
  return records.length === chunk.count ? records : null
}

/** The placed-culvert records of a `.ds1`; null when it is not laid out as RoadEng writes it. */
export function readRoadEngCulvertRecords(bytes: Uint8Array): string[] | null {
  const chunks = readChunks(bytes)
  return chunks ? readRecords(chunks[1]) : null
}

/** The station frame a design's records are placed in: its stations as read, m, and road chainage over them. */
export interface PlacedCulvertFrame {
  startStation: number
  endStation: number
  stationScale: number
}

/** Which records a road reads: parsed, on the road, within {@link MAX_PLACED_CULVERTS}. */
function readable(
  records: readonly string[],
  unitM: number,
  frame: Pick<PlacedCulvertFrame, 'startStation' | 'endStation'>,
) {
  const out: boolean[] = []
  let taken = 0
  for (const raw of records) {
    const f = readPlacedCulvert(raw, unitM)
    const ok =
      !!f &&
      f.stationM !== null &&
      f.diameterM !== null &&
      f.diameterM > 0 &&
      f.stationM >= frame.startStation - ROADENG_CULVERT_STATION_TOLERANCE_M &&
      f.stationM <= frame.endStation + ROADENG_CULVERT_STATION_TOLERANCE_M &&
      taken < MAX_PLACED_CULVERTS
    if (ok) taken++
    out.push(ok)
  }
  return out
}

/** The PGMaps values a record gives, as read: what an edit is told apart from. */
export function placedCulvertValues(
  record: Pick<RoadEngPlacedCulvertRecord, 'raw' | 'unitM' | 'index'>,
): Pick<Culvert, 'name' | 'kind' | 'diameterM' | 'skewDegrees' | 'lengthM'> | null {
  const f = readPlacedCulvert(record.raw, record.unitM)
  if (!f || f.diameterM === null) return null
  const kind = f.kind ?? 'cross-drain'
  const skew = f.skewFromLineDeg === null ? 0 : f.skewFromLineDeg - 90
  const length = (f.leftM ?? 0) + (f.rightM ?? 0)
  const firstLine = f.description.split(/\r?\n/)[0].trim().slice(0, 200)
  return {
    name: firstLine || `${kind === 'stream' ? 'Stream culvert' : 'Cross-drain'} ${record.index + 1}`,
    kind,
    diameterM: round(Math.min(20, Math.max(0.1, f.diameterM)), 6),
    skewDegrees: round(Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, skew)), 6),
    lengthM: round(Math.min(500, Math.max(0.2, length)), 3),
  }
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

/**
 * The culverts a design alignment's `.ds1` places on its road, each at the road chainage of its
 * L-line station. `make` gives a new culvert's PGMaps fields (cover, costs); `newId` its id.
 */
export function culvertsFromDesign(
  ds1: Uint8Array | null,
  options: {
    unitM: number
    frame: PlacedCulvertFrame
    newId: () => string
    make?: () => Pick<Culvert, 'minCoverM' | 'unitCost' | 'fixedCost'>
  },
): { culverts: Culvert[]; notes: string[] } {
  if (!ds1) return { culverts: [], notes: [] }
  const records = readRoadEngCulvertRecords(ds1)
  if (!records)
    return {
      culverts: [],
      notes: ["The design's placed culverts (.ds1) could not be read; the file goes back to RoadEng as it was."],
    }
  const { frame, unitM } = options
  const read = readable(records, unitM, frame)
  const culverts: Culvert[] = []
  const notes: string[] = []
  const clamped: string[] = []
  records.forEach((raw, index) => {
    if (!read[index]) return
    const record: RoadEngPlacedCulvertRecord = { index, raw, unitM }
    const f = readPlacedCulvert(raw, unitM)!
    const values = placedCulvertValues(record)!
    if (f.skewFromLineDeg !== null && Math.abs(f.skewFromLineDeg - 90) > MAX_SKEW_DEG + 1e-9)
      clamped.push(`${values.name} (skew ${f.skewFromLineDeg}°, placed at ${MAX_SKEW_DEG}° from square)`)
    const made = options.make?.() ?? { minCoverM: 0.6, unitCost: 0, fixedCost: 0 }
    culverts.push({
      id: options.newId(),
      ...values,
      chainage: round(Math.max(0, (f.stationM! - frame.startStation) * frame.stationScale), 3),
      inletInvertM: null,
      outletInvertM: null,
      ...made,
      roadEngDesign: record,
    })
  })
  const unread = read.filter((r) => !r).length
  if (unread)
    notes.push(
      `${unread} of the design's ${records.length} placed culverts ${unread === 1 ? 'is' : 'are'} off the road or could not be read; ${unread === 1 ? 'it goes' : 'they go'} back to RoadEng as written.`,
    )
  if (clamped.length) notes.push(`Skewed past PGMaps' limit: ${clamped.join('; ')}.`)
  return { culverts, notes }
}

/**
 * Culverts read from a design added to the road's own (from `[PGMaps]`), leaving out each one a
 * culvert of the road already holds (same record, same place): a design written by an earlier
 * version of this workspace kept its culverts only in the `.ds1`.
 */
export function withDesignCulverts(existing: readonly Culvert[], read: readonly Culvert[]): Culvert[] {
  const held = (c: Culvert) =>
    existing.some(
      (e) => e.roadEngDesign?.index === c.roadEngDesign?.index && e.roadEngDesign?.raw === c.roadEngDesign?.raw,
    )
  const added = read.filter((c) => !held(c))
  return added.length ? [...existing, ...added].sort((a, b) => a.chainage - b.chainage) : [...existing]
}

/**
 * What a design's culverts that RoadEng saved since keep from the culverts this workspace wrote
 * into it (`[PGMaps]` engineering, unchecked): its id, cover, costs and their provisional source,
 * inverts and ditch dip, by
 * record. A record RoadEng rewrote matches nothing and keeps the defaults.
 */
export function carryWrittenCulvertFields(read: readonly Culvert[], written: unknown): Culvert[] {
  const list =
    written && typeof written === 'object' && Array.isArray((written as { culverts?: unknown }).culverts)
      ? ((written as { culverts: unknown[] }).culverts as unknown[])
      : []
  return read.map((c) => {
    const match = list.find(
      (w): w is Record<string, unknown> =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as { roadEngDesign?: { raw?: unknown } }).roadEngDesign?.raw === 'string' &&
        (w as { roadEngDesign: { raw: string } }).roadEngDesign.raw === c.roadEngDesign?.raw,
    )
    if (!match) return c
    const num = (key: string) =>
      typeof match[key] === 'number' && Number.isFinite(match[key]) ? (match[key] as number) : undefined
    const invert = (key: string) => (match[key] === null ? null : num(key))
    const inlet = invert('inletInvertM'),
      outlet = invert('outletInvertM')
    return {
      ...c,
      ...(typeof match.id === 'string' && match.id ? { id: match.id } : {}),
      ...(num('minCoverM') !== undefined ? { minCoverM: num('minCoverM')! } : {}),
      ...(num('unitCost') !== undefined ? { unitCost: num('unitCost')! } : {}),
      ...(num('fixedCost') !== undefined ? { fixedCost: num('fixedCost')! } : {}),
      ...(match.costDefault === undefined ? {} : { costDefault: parseCulvertCostDefault(match.costDefault) }),
      ...(inlet !== undefined && outlet !== undefined ? { inletInvertM: inlet, outletInvertM: outlet } : {}),
      ...(num('ditchDipPercent') !== undefined ? { ditchDipPercent: num('ditchDipPercent')! } : {}),
    }
  })
}

// ---- Writing --------------------------------------------------------------------------------------

/** A number as RoadEng writes one: up to 12 significant digits, no trailing zeros or exponent. */
export function roadEngNumber(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '0'
  let text = v.toPrecision(12)
  if (/e/i.test(text)) text = v.toFixed(9)
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

/** Field `i` replaced by `text`, keeping the field's leading spaces. */
function setField(fields: string[], i: number, text: string) {
  while (fields.length <= i) fields.push('0')
  fields[i] = `${/^\s*/.exec(fields[i])![0]}${text}`
}

/** A description as a record holds it: Latin-1, one line, without the delimiter. */
function descriptionText(name: string): string {
  return name
    .split(DELIMITER)
    .join(' ')
    .replace(/[\r\n]+/g, ' ')
    .split('')
    .map((c) => (c.charCodeAt(0) > 255 ? '?' : c))
    .join('')
}

export interface PlacedCulvertTarget {
  /** Metres per project unit of the design written. */
  unitM: number
  /** The written frame (`roadEngWrittenFrame`): its first station, m, and road chainage over stations. */
  startStation: number
  stationScale: number
  /** The design's `[Culvert]` defaults as written (`DefDrainCulvert`, `DefStreamCulvert`), for a new record. */
  defaults?: Partial<Record<'cross-drain' | 'stream', string>>
}

/** A culvert's record written: its base record with every field the culvert changed. */
function writtenRecord(
  c: Culvert,
  base: RoadEngPlacedCulvertRecord,
  target: PlacedCulvertTarget,
  fresh: boolean,
): string {
  const f = readPlacedCulvert(base.raw, base.unitM)
  if (!f) throw Error(`${c.name}'s RoadEng record could not be read.`)
  const read = placedCulvertValues(base)
  const fields = [...f.fields]
  const units = Math.abs(base.unitM - target.unitM) > 1e-12
  const u = (metres: number) => roadEngNumber(metres / target.unitM)
  // The station: the culvert's chainage in the written frame, unless that is the record's.
  const station = target.startStation + c.chainage / target.stationScale
  if (fresh || units || f.stationM === null || Math.abs(station - f.stationM) > ROADENG_CULVERT_STATION_TOLERANCE_M)
    setField(fields, 1, u(station))
  if (fresh && value(fields[2]) !== null) setField(fields, 2, NO_VALUE_TEXT)
  const kind = c.kind ?? 'cross-drain'
  if (fresh || !read || kind !== read.kind) setField(fields, 0, kind === 'stream' ? '1' : '0')
  if (fresh || units || !read || Math.abs(c.diameterM - read.diameterM) > 1e-6)
    setField(fields, 3, roadEngNumber((c.diameterM / target.unitM) * 1000))
  // RoadEng computes a value whose Auto bit is set: one this workspace sets is written with it cleared.
  let clear = 0
  const skewChanged = !read || Math.abs(c.skewDegrees - read.skewDegrees) > 1e-6
  if (fresh || skewChanged) setField(fields, 4, roadEngNumber(90 + c.skewDegrees))
  if (skewChanged) clear |= ROADENG_CULVERT_SKEW_AUTO
  if (base.gradientPercent !== undefined && base.gradientPercent !== f.gradientPercent) {
    setField(fields, 5, roadEngNumber(base.gradientPercent))
    clear |= ROADENG_CULVERT_GRADIENT_AUTO
  }
  const lengthChanged = !read || Math.abs(c.lengthM - read.lengthM) > 1e-6
  if (fresh || units || lengthChanged) {
    const left = f.leftM ?? 0,
      right = f.rightM ?? 0
    // The culvert's span split as the record split it; a new one centred.
    const share = fresh || left + right <= 0 ? 0.5 : left / (left + right)
    const span = lengthChanged || fresh ? c.lengthM : left + right
    setField(fields, 6, u(span * share))
    setField(fields, 7, u(span * (1 - share)))
  }
  // A new culvert's lengths stay RoadEng's to compute where its default's are.
  if (lengthChanged && !fresh) clear |= ROADENG_CULVERT_LENGTH_AUTO
  if (units) {
    if (f.depthM !== null) setField(fields, 8, u(f.depthM))
    // The template override's ditch width and depth, offset and taper.
    for (const k of [14, 15, 16, 17]) {
      const v = value(fields[k])
      if (v !== null && fields.length > 17) setField(fields, k, u(v * base.unitM))
    }
  }
  const flags = f.flags
  if (clear && f.auto && flags !== null && (flags & clear) !== 0) setField(fields, 9, String(flags & ~clear))
  const description = fresh || !read || c.name !== read.name ? descriptionText(c.name) : f.description
  return `${description}${DELIMITER}${fields.join(',')}`
}

const latin1Bytes = (text: string) => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[i] = code > 255 ? 0x3f : code
  }
  return out
}

/** Three empty chunks, as RoadEng 11 writes an alignment with no culverts. */
export function emptyRoadEngIndex(): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES * 3)
  for (let k = 0; k < 3; k++) {
    bytes[k * HEADER_BYTES] = HEADER_WORD
    bytes[k * HEADER_BYTES + 2] = k + 1
  }
  return bytes
}

/** The `.ds1` with section 2 holding `records`, the other chunks and every header byte kept. */
function withRecords(chunks: Ds1Chunk[], records: readonly string[]): Uint8Array {
  const encoded = records.map(latin1Bytes)
  for (const r of encoded) if (r.length > 0xffff) throw Error('A RoadEng culvert record is over 65,535 characters.')
  const size = encoded.reduce((sum, r) => sum + 2 + r.length, 0)
  const total = chunks.reduce((sum, c) => sum + HEADER_BYTES + (c.section === 2 ? size : c.payload.length), 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk.header, at)
    if (chunk.section !== 2) {
      out.set(chunk.payload, at + HEADER_BYTES)
      at += HEADER_BYTES + chunk.payload.length
      continue
    }
    view.setUint32(at + 4, records.length, true)
    view.setUint32(at + 8, size, true)
    at += HEADER_BYTES
    for (const r of encoded) {
      view.setUint16(at, r.length, true)
      out.set(r, at + 2)
      at += 2 + r.length
    }
  }
  return out
}

/**
 * A design alignment's `.ds1` with the road's culverts written into it, and the culverts with the
 * records written (what `[PGMaps]` keeps, so the design opens back onto them). `source` is the
 * `.ds1` the road was read with and the frame it was read in; null for a road not read from RoadEng.
 */
export function writeDesignCulverts(
  source: {
    ds1: Uint8Array
    unitM: number
    frame: Pick<PlacedCulvertFrame, 'startStation' | 'endStation'>
    /** Whether its culverts were read onto the road (`RoadEngSource.culvertsRead`); else every record is kept. */
    read: boolean
  } | null,
  culverts: readonly Culvert[],
  target: PlacedCulvertTarget,
): { ds1: Uint8Array; culverts: Culvert[]; notes: string[] } {
  const notes: string[] = []
  const chunks = readChunks(source?.ds1 ?? emptyRoadEngIndex())
  const records = chunks ? readRecords(chunks[1]) : null
  if (!chunks || !records) {
    if (culverts.length)
      notes.push(
        "The design's placed culverts (.ds1) could not be read, so it goes back as it was, without this road's culverts.",
      )
    return { ds1: source!.ds1, culverts: [...culverts], notes }
  }
  const read = source?.read ? readable(records, source.unitM, source.frame) : records.map(() => false)
  // Each culvert's record of this design, matched once.
  const owner = new Map<number, Culvert>()
  const fresh: Culvert[] = []
  for (const c of culverts) {
    const r = c.roadEngDesign
    if (r && read[r.index] && records[r.index] === r.raw && !owner.has(r.index)) owner.set(r.index, c)
    else fresh.push(c)
  }
  type Out = { raw: string; culvert: Culvert | null; stationM: number | null }
  const out: Out[] = []
  let changed = 0,
    removed = 0
  records.forEach((raw, index) => {
    if (!read[index])
      return out.push({ raw, culvert: null, stationM: readPlacedCulvert(raw, target.unitM)?.stationM ?? null })
    const c = owner.get(index)
    if (!c) return removed++
    const written = writtenRecord(c, c.roadEngDesign!, target, false)
    if (written !== raw) changed++
    out.push({ raw: written, culvert: c, stationM: readPlacedCulvert(written, target.unitM)?.stationM ?? null })
  })
  for (const c of [...fresh].sort((a, b) => a.chainage - b.chainage)) {
    const kind = c.kind ?? 'cross-drain'
    const base: RoadEngPlacedCulvertRecord = c.roadEngDesign
      ? { ...c.roadEngDesign }
      : { index: 0, raw: target.defaults?.[kind] ?? ROADENG_DEFAULT_CULVERT[kind], unitM: target.unitM }
    const raw = writtenRecord(
      c,
      readPlacedCulvert(base.raw, base.unitM)
        ? base
        : { ...base, raw: ROADENG_DEFAULT_CULVERT[kind], unitM: target.unitM },
      target,
      true,
    )
    const stationM = readPlacedCulvert(raw, target.unitM)?.stationM ?? null
    // In station order among the records whose station is known.
    let at = out.findIndex((o) => o.stationM !== null && stationM !== null && o.stationM > stationM)
    if (at < 0) at = out.length
    out.splice(at, 0, { raw, culvert: c, stationM })
  }
  if (fresh.length || changed || removed)
    notes.push(
      `Culverts written to the design: ${[
        fresh.length ? `${fresh.length} new` : '',
        changed ? `${changed} changed` : '',
        removed ? `${removed} removed` : '',
        `${out.filter((o) => o.culvert && o.culvert.roadEngDesign && records[o.culvert.roadEngDesign.index] === o.raw).length} as read`,
      ]
        .filter(Boolean)
        .join(', ')}.`,
    )
  const ds1 = withRecords(
    chunks,
    out.map((o) => o.raw),
  )
  const placed = new Map<string, RoadEngPlacedCulvertRecord>()
  out.forEach((o, index) => {
    if (o.culvert) placed.set(o.culvert.id, { index, raw: o.raw, unitM: target.unitM })
  })
  return {
    ds1: source && ds1.length === source.ds1.length && ds1.every((b, i) => b === source.ds1[i]) ? source.ds1 : ds1,
    culverts: culverts.map((c) => (placed.has(c.id) ? { ...c, roadEngDesign: placed.get(c.id)! } : c)),
    notes,
  }
}

/** A culvert's kept RoadEng design record from a project file: refused, never repaired, when malformed. */
export function parseRoadEngPlacedCulvertRecord(raw: unknown): RoadEngPlacedCulvertRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('A culvert’s RoadEng design record must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.index !== 'number' || !Number.isInteger(r.index) || r.index < 0 || r.index > 65535)
    throw Error('A culvert’s RoadEng design record needs its place in the design.')
  if (
    typeof r.raw !== 'string' ||
    !r.raw.includes(DELIMITER) ||
    r.raw.length > 65535 ||
    [...r.raw].some((c) => c.charCodeAt(0) > 255)
  )
    throw Error('A culvert’s RoadEng design record must be the record as read.')
  if (typeof r.unitM !== 'number' || !(r.unitM > 0) || r.unitM > 10)
    throw Error('A culvert’s RoadEng design record needs its design’s unit.')
  if (
    r.gradientPercent !== undefined &&
    (typeof r.gradientPercent !== 'number' || !Number.isFinite(r.gradientPercent) || Math.abs(r.gradientPercent) > 100)
  )
    throw Error('A culvert’s RoadEng gradient must be a number between −100 and 100 %.')
  return {
    index: r.index,
    raw: r.raw,
    unitM: r.unitM,
    ...(r.gradientPercent === undefined ? {} : { gradientPercent: r.gradientPercent as number }),
  }
}
