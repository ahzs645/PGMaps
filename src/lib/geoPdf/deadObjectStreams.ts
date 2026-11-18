/**
 * A PDF re-saved by a program that copies every object of the file it opened (macOS Preview does,
 * when a sheet is marked up and saved) keeps the original's object streams as ordinary streams that
 * nothing refers to. Their contents still carry the original's object numbers. pdf-lib reads a file
 * front to back and unpacks every object stream it meets, so those stale numbers replace the real
 * objects: an image tile turns into a layer dictionary, its JPEG filter is lost, and the tile is
 * read as if it were stored losslessly.
 *
 * A file whose cross-reference chain is made of classic tables only cannot address a compressed
 * object (ISO 32000-1, 7.5.8), so none of its object streams is in use. Those are renamed in a copy
 * so pdf-lib leaves them packed. A file with a cross-reference stream anywhere in its chain is
 * returned as it is. No DOM or network access.
 */
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))
const STARTXREF = ascii('startxref')
const XREF = ascii('xref')
const TRAILER = ascii('trailer')
const OBJ_STM = ascii('/ObjStm')
const TYPE = ascii('/Type')
const OBJ = ascii('obj')
const STREAM = ascii('stream')
const isSpace = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0
/** A cross-reference chain longer than this is not followed; the file is left alone. */
const MAX_XREF_SECTIONS = 64
/** How far back from an object stream's type its `N G obj` header is looked for. */
const DICTIONARY_REACH = 2048

function matches(bytes: Uint8Array, at: number, text: Uint8Array) {
  if (at < 0 || at + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text[i]) return false
  return true
}
function indexOf(bytes: Uint8Array, text: Uint8Array, from: number, to = bytes.length) {
  const last = Math.min(to, bytes.length) - text.length
  for (let i = Math.max(0, from); i <= last; i++) if (bytes[i] === text[0] && matches(bytes, i, text)) return i
  return -1
}
function lastIndexOf(bytes: Uint8Array, text: Uint8Array, from: number, to = 0) {
  for (let i = Math.min(from, bytes.length - text.length); i >= to; i--)
    if (bytes[i] === text[0] && matches(bytes, i, text)) return i
  return -1
}
function numberAfter(bytes: Uint8Array, at: number): number | null {
  let i = at
  while (i < bytes.length && isSpace(bytes[i])) i++
  let value = 0,
    digits = 0
  while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39 && digits < 15) {
    value = value * 10 + bytes[i] - 0x30
    i++
    digits++
  }
  return digits ? value : null
}
function entry(bytes: Uint8Array, name: string, from: number, to: number): number | null {
  const key = ascii(name)
  const at = indexOf(bytes, key, from, to)
  // `/Prev` must not match `/PrevX`: the next byte ends the name.
  return at < 0 || !isSpace(bytes[at + key.length]) ? null : numberAfter(bytes, at + key.length)
}

/** True when every section of the file's cross-reference chain is a classic table. */
export function classicCrossReferenceOnly(bytes: Uint8Array): boolean {
  const start = lastIndexOf(bytes, STARTXREF, bytes.length)
  if (start < 0) return false
  let offset = numberAfter(bytes, start + STARTXREF.length)
  const seen = new Set<number>()
  while (offset !== null) {
    if (seen.has(offset) || seen.size >= MAX_XREF_SECTIONS || offset >= bytes.length) return false
    seen.add(offset)
    let at = offset
    while (at < bytes.length && isSpace(bytes[at])) at++
    // Anything but a table here is a cross-reference stream: compressed objects can be in use.
    if (!matches(bytes, at, XREF)) return false
    const trailer = indexOf(bytes, TRAILER, at)
    if (trailer < 0) return false
    const nextStart = indexOf(bytes, STARTXREF, trailer)
    const end = nextStart < 0 ? bytes.length : nextStart
    // A hybrid file's table points at a stream that lists its compressed objects.
    if (entry(bytes, '/XRefStm', trailer, end) !== null) return false
    offset = entry(bytes, '/Prev', trailer, end)
  }
  return seen.size > 0
}

/**
 * The file with its unreachable object streams renamed, and how many there were. The same array
 * comes back when there is nothing to rename.
 */
export function withoutDeadObjectStreams(bytes: Uint8Array): { bytes: Uint8Array; dead: number } {
  if (indexOf(bytes, OBJ_STM, 0) < 0 || !classicCrossReferenceOnly(bytes)) return { bytes, dead: 0 }
  let out = bytes,
    dead = 0
  for (let at = indexOf(bytes, OBJ_STM, 0); at >= 0; at = indexOf(bytes, OBJ_STM, at + OBJ_STM.length)) {
    // `/Type /ObjStm`, in the dictionary that opens an object: not text inside a stream's data.
    let before = at - 1
    while (before >= 0 && isSpace(bytes[before])) before--
    if (!matches(bytes, before - TYPE.length + 1, TYPE)) continue
    const header = lastIndexOf(bytes, OBJ, at, Math.max(0, at - DICTIONARY_REACH))
    if (header < 0 || indexOf(bytes, STREAM, header, at) >= 0) continue
    if (out === bytes) out = bytes.slice()
    out[at + 1] = 0x58 // "/XbjStm": an unknown type, kept as an opaque stream
    dead++
  }
  return { bytes: out, dead }
}
