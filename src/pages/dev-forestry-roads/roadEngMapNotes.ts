/**
 * Map notes in a RoadEng terrain: the tail after `.ter` section 8, read and written back. RoadEng
 * calls them floating labels (label type 23, "Floating (not attached to a feature)" in a `.tlt`'s
 * `[TerLabels]`); Softree's cable tutorial terrains hold two, "Access Road" and "Potential
 * Deflection". Terrains without notes end in the bare 24-byte header.
 *
 * Worked out from those five terrains, not from a specification:
 *
 * - Header, 24 bytes: `u16` 12, `u16` 1, `u32` note count, `u32` payload bytes, `u32` 0, then 8
 *   bytes that hold a stale pointer. The tail is exactly 24 + the payload bytes.
 * - Each note: `u16` text length, the text (Latin-1, no NUL), then a 60-byte label format.
 * - The text is the label, `%#%`, a newline, and `X,Y,2,-1`: the position in the file's grid, as
 *   C's `%.12g` prints it, then two integers (2 and −1 in every sample; −1 reads as "attached to no
 *   feature", inferred).
 * - The format: `u32` 1, 12 zero bytes, `u16` label type (23), `u16` 2, `f64` text size as RoadEng
 *   stores label sizes (−42, −30), 8 zero bytes, two `i16` that change when a label is dragged
 *   (its offset, inferred), 4 zero bytes, an `f64` about 65 × the text size (−2,728.74, −1,949.1:
 *   the size in another unit, inferred), `u32` 0x6254C (flags, as in the `.tlt` label formats) and
 *   4 zero bytes.
 *
 * A note read from a file keeps its 60-byte format (`format`, base64) and writing it back changes
 * only what was edited; a new note takes the format of Softree's "Potential Deflection" note.
 * The header's last 12 bytes come from the original tail when there is one.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, strToU8 } from 'fflate'
import { base64ToBytes, bytesToBase64, formatG12, latin1Text } from './roadEngText'

/** The tail's fixed header, which is the whole tail when there are no notes. */
export const ROADENG_NOTES_HEADER_BYTES = 24
/** Bytes of the label format after each note's text. */
export const ROADENG_NOTE_FORMAT_BYTES = 60
/** Notes read or written at most. */
export const MAX_ROADENG_MAP_NOTES = 2000
/** Longest note text written, characters (the length is a `u16`; RoadEng's own are a few words). */
export const MAX_ROADENG_NOTE_TEXT = 4000
/** RoadEng's label type for a floating label. */
export const ROADENG_FLOATING_LABEL = 23

const SEPARATOR = '%#%\n'

export interface RoadEngMapNote {
  text: string
  /** Position in the file's grid and units. */
  x: number
  y: number
  /** The integers after the position (`[2, -1]` in every sample). */
  anchor: number[]
  /** RoadEng's label type: 23, a floating label, in every sample. */
  labelType: number
  /** Text size as RoadEng stores it (negative in the samples: −42, −30). */
  textSize: number
  /** The second size stored with the label, about 65 × the text size in the samples. */
  scaledSize: number
  /** Two 16-bit integers that change when the label is dragged: its offset (inferred). */
  offset: [number, number]
  /** The 60-byte label format as read, base64. */
  format?: string
}

/** Softree's "Potential Deflection" note's format, for notes made in PG Maps. */
const DEFAULT_FORMAT = (() => {
  const b = new Uint8Array(ROADENG_NOTE_FORMAT_BYTES)
  const v = new DataView(b.buffer)
  v.setUint32(0, 1, true)
  v.setUint16(16, ROADENG_FLOATING_LABEL, true)
  v.setUint16(18, 2, true)
  v.setFloat64(20, -30, true)
  v.setFloat64(44, -1949.1000000000004, true)
  v.setUint32(52, 0x6254c, true)
  return b
})()

/**
 * Reads the tail after section 8: the notes, or a reason they were not read. The framing
 * (24 bytes + payload) has already been checked by the `.ter` reader.
 */
export function readRoadEngMapNotes(tail: Uint8Array): { notes: RoadEngMapNote[]; problem: string | null } {
  if (tail.length < ROADENG_NOTES_HEADER_BYTES) return { notes: [], problem: 'the notes block is too short' }
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const count = view.getUint32(4, true)
  const payload = view.getUint32(8, true)
  if (ROADENG_NOTES_HEADER_BYTES + payload !== tail.length) return { notes: [], problem: 'its size does not add up' }
  if (count > MAX_ROADENG_MAP_NOTES) return { notes: [], problem: `it lists ${count} notes` }
  const notes: RoadEngMapNote[] = []
  let o = ROADENG_NOTES_HEADER_BYTES
  for (let i = 0; i < count; i++) {
    if (o + 2 > tail.length) return { notes: [], problem: `note ${i + 1} runs past the end` }
    const length = view.getUint16(o, true)
    const end = o + 2 + length + ROADENG_NOTE_FORMAT_BYTES
    if (end > tail.length) return { notes: [], problem: `note ${i + 1} runs past the end` }
    const text = strFromU8(tail.subarray(o + 2, o + 2 + length), true)
    const cut = text.lastIndexOf(SEPARATOR)
    const fields = cut < 0 ? [] : text.slice(cut + SEPARATOR.length).split(',')
    const x = Number(fields[0]),
      y = Number(fields[1])
    if (cut < 0 || fields.length < 2 || !Number.isFinite(x) || !Number.isFinite(y))
      return { notes: [], problem: `note ${i + 1} has no position` }
    const format = tail.slice(o + 2 + length, end)
    const f = new DataView(format.buffer)
    notes.push({
      text: text.slice(0, cut),
      x,
      y,
      anchor: fields.slice(2).map(Number),
      labelType: f.getUint16(16, true),
      textSize: f.getFloat64(20, true),
      scaledSize: f.getFloat64(44, true),
      offset: [f.getInt16(36, true), f.getInt16(38, true)],
      format: bytesToBase64(format),
    })
    o = end
  }
  if (o !== tail.length) return { notes: [], problem: 'it holds bytes after its last note' }
  return { notes, problem: null }
}

/**
 * The tail for these notes. `original` is the tail read from the file, whose header bytes 12–23
 * are kept; without it they are zero.
 */
export function encodeRoadEngMapNotes(notes: readonly RoadEngMapNote[], original?: Uint8Array | null): Uint8Array {
  if (notes.length > MAX_ROADENG_MAP_NOTES) throw Error(`At most ${MAX_ROADENG_MAP_NOTES} map notes can be written.`)
  const parts = notes.map((note) => {
    if (!Number.isFinite(note.x) || !Number.isFinite(note.y)) throw Error('A map note has no position.')
    const text = strToU8(
      `${latin1Text(note.text).slice(0, MAX_ROADENG_NOTE_TEXT)}${SEPARATOR}${formatG12(note.x)},${formatG12(note.y)}` +
        (note.anchor.length ? `,${note.anchor.map((n) => (Number.isFinite(n) ? String(n) : '0')).join(',')}` : ''),
      true,
    )
    let format = DEFAULT_FORMAT.slice()
    if (note.format) {
      const kept = base64ToBytes(note.format)
      if (kept.length === ROADENG_NOTE_FORMAT_BYTES) format = kept
    }
    const f = new DataView(format.buffer)
    if (f.getUint16(16, true) !== note.labelType) f.setUint16(16, note.labelType, true)
    if (!Object.is(f.getFloat64(20, true), note.textSize)) f.setFloat64(20, note.textSize, true)
    if (!Object.is(f.getFloat64(44, true), note.scaledSize)) f.setFloat64(44, note.scaledSize, true)
    if (f.getInt16(36, true) !== note.offset[0]) f.setInt16(36, note.offset[0], true)
    if (f.getInt16(38, true) !== note.offset[1]) f.setInt16(38, note.offset[1], true)
    const out = new Uint8Array(2 + text.length + ROADENG_NOTE_FORMAT_BYTES)
    new DataView(out.buffer).setUint16(0, text.length, true)
    out.set(text, 2)
    out.set(format, 2 + text.length)
    return out
  })
  const payload = parts.reduce((s, p) => s + p.length, 0)
  const tail = new Uint8Array(ROADENG_NOTES_HEADER_BYTES + payload)
  const view = new DataView(tail.buffer)
  view.setUint16(0, 12, true)
  view.setUint16(2, 1, true)
  view.setUint32(4, notes.length, true)
  view.setUint32(8, payload, true)
  if (original && original.length >= ROADENG_NOTES_HEADER_BYTES) tail.set(original.subarray(12, 24), 12)
  let o = ROADENG_NOTES_HEADER_BYTES
  for (const p of parts) {
    tail.set(p, o)
    o += p.length
  }
  return tail
}

/**
 * A new note for PG Maps text at a grid position, sized as Softree's "Potential Deflection" note.
 * The `.tlt` sets how RoadEng draws floating labels.
 */
export function newRoadEngMapNote(text: string, x: number, y: number): RoadEngMapNote {
  const f = new DataView(DEFAULT_FORMAT.buffer)
  return {
    text,
    x,
    y,
    anchor: [2, -1],
    labelType: ROADENG_FLOATING_LABEL,
    textSize: f.getFloat64(20, true),
    scaledSize: f.getFloat64(44, true),
    offset: [0, 0],
  }
}
