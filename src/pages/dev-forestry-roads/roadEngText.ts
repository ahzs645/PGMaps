/**
 * Byte and text helpers shared by the RoadEng terrain reader and writer: base64 for parts kept in a
 * project file, Latin-1 C strings in fixed-width fields, `%.12g` numbers as RoadEng prints them,
 * and RoadEng's INI files (`.tlt`, `.ilt`, and the D-line settings text inside a `.ter`) read in
 * order and edited key by key, leaving every other line, its order and its line endings as they
 * were.
 *
 * Checked by `roadEngText.test.ts` and by the terrain round-trip tests, which compare the kept
 * parts byte for byte. Pure: no DOM or network access.
 */
import { strFromU8, strToU8 } from 'fflate'

// ---- Base64 ------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Int16Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i

/** Standard base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = []
  let line = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = i + 1 < bytes.length ? bytes[i + 1] : 0,
      c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    line +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? B64[n & 63] : '=')
    if (line.length >= 8192) {
      out.push(line)
      line = ''
    }
  }
  out.push(line)
  return out.join('')
}

/** Reads standard base64; anything else (wrong length, foreign characters) is refused. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4) throw Error('The base64 text is not a whole number of groups.')
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    let n = 0
    for (let k = 0; k < 4; k++) {
      const ch = text.charCodeAt(i + k)
      const v = ch === 61 && i + k >= text.length - pad ? 0 : ch < 128 ? B64_INDEX[ch] : -1
      if (v < 0) throw Error('The base64 text holds a character outside base64.')
      n = (n << 6) | v
    }
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

// ---- Fixed-width Latin-1 fields -----------------------------------------------------------------------

/** The NUL-terminated Latin-1 text of a fixed field (bytes after the NUL are ignored). */
export function cString(bytes: Uint8Array, start: number, width: number): string {
  const slice = bytes.subarray(start, start + width)
  const end = slice.indexOf(0)
  return strFromU8(end < 0 ? slice : slice.subarray(0, end), true)
}

/**
 * Writes text into a fixed field of `width` bytes: at most `width − 1` characters, a NUL, and zeros
 * after it. Characters outside Latin-1 become "?".
 */
export function putCString(bytes: Uint8Array, start: number, width: number, text: string) {
  const encoded = strToU8(latin1Text(text), true)
  bytes.fill(0, start, start + width)
  bytes.set(encoded.subarray(0, Math.max(0, width - 1)), start)
}

/** Text RoadEng's Latin-1 fields can hold: characters past U+00FF become "?". */
export const latin1Text = (text: string) =>
  Array.from(text, (ch) => (ch.length > 1 || ch.charCodeAt(0) > 0xff ? '?' : ch)).join('')

// ---- Numbers ------------------------------------------------------------------------------------------

/**
 * A number as C's `%.12g` prints it, which is how RoadEng writes coordinates into text
 * (`570371.48732`, `5623705.13539`): 12 significant digits, trailing zeros dropped, exponent form
 * below 1e−4 and from 1e12.
 */
export function formatG12(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return Object.is(value, -0) ? '-0' : '0'
  const [mantissa, exp] = value.toExponential(11).split('e')
  const e = Number(exp)
  if (e < -4 || e >= 12) {
    const m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa
    return `${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  const fixed = value.toFixed(11 - e)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

// ---- INI ----------------------------------------------------------------------------------------------

export interface RoadEngIniSection {
  name: string
  /** key, value pairs in file order; values trimmed */
  entries: [string, string][]
}

/** An INI text's sections and keys, in file order. Lines before the first section are skipped. */
export function readRoadEngIni(text: string): RoadEngIniSection[] {
  const sections: RoadEngIniSection[] = []
  let current: RoadEngIniSection | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = { name: header[1], entries: [] }
      sections.push(current)
    } else if (current) {
      const eq = line.indexOf('=')
      if (eq > 0) current.entries.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()])
    }
  }
  return sections
}

/** The value of one key (section and key ignore case, as Windows profile files do), or null. */
export function roadEngIniValue(text: string, section: string, key: string): string | null {
  const s = readRoadEngIni(text).find((x) => sameName(x.name, section))
  return s?.entries.find(([k]) => sameName(k, key))?.[1] ?? null
}

/** One edit to an INI text: set keys in a section, or replace the section's whole body. */
export type RoadEngIniEdit =
  | { section: string; set: [string, string][] }
  | { section: string; replace: string[] }
  | { section: string; remove: true }

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Applies edits to an INI text and changes nothing else: every other line keeps its text, its
 * place and its line ending. A key set in place keeps its line's position; a key or section the
 * text lacks is added at the end of its section, or as a new section at the end of the text.
 */
export function editRoadEngIni(text: string, edits: readonly RoadEngIniEdit[]): string {
  const eol = text.includes('\r\n') || !text.includes('\n') ? '\r\n' : '\n'
  // Lines with their own endings, so an unedited line comes back byte for byte.
  const lines: string[] = [...(text.match(/[^\r\n]*(\r\n|\n|\r)|[^\r\n]+$/g) ?? [])]
  const ending = (line: string) => /(\r\n|\n|\r)$/.exec(line)?.[0] ?? ''
  const body = (line: string) => line.slice(0, line.length - ending(line).length)
  for (const edit of edits) {
    // Section spans: [header line, first line after the section).
    let start = -1,
      end = lines.length
    for (let i = 0; i < lines.length; i++) {
      const header = /^\s*\[(.+)\]\s*$/.exec(body(lines[i]))
      if (!header) continue
      if (start >= 0) {
        end = i
        break
      }
      if (sameName(header[1], edit.section)) start = i
    }
    if ('remove' in edit) {
      if (start >= 0) lines.splice(start, end - start)
      continue
    }
    const newLines = (texts: string[]) => texts.map((t) => t + eol)
    if (start < 0) {
      if (lines.length && !ending(lines[lines.length - 1])) lines[lines.length - 1] += eol
      const content = 'replace' in edit ? edit.replace : edit.set.map(([k, v]) => `${k}=${v}`)
      lines.push(...newLines([`[${edit.section}]`, ...content]))
      continue
    }
    if ('replace' in edit) {
      // Blank lines and comments at the end of the section stay where they were.
      let last = end
      while (last > start + 1 && !/=/.test(body(lines[last - 1]))) last--
      lines.splice(start + 1, last - start - 1, ...newLines(edit.replace))
      continue
    }
    let insertAt = end
    while (insertAt > start + 1 && !body(lines[insertAt - 1]).trim()) insertAt--
    for (const [key, value] of edit.set) {
      let found = false
      for (let i = start + 1; i < end; i++) {
        const line = body(lines[i])
        const eq = line.indexOf('=')
        if (eq > 0 && sameName(line.slice(0, eq), key)) {
          const leading = /^\s*/.exec(line)![0]
          const next = `${leading}${line.slice(leading.length, eq)}=${value}`
          if (next !== line) lines[i] = next + ending(lines[i])
          found = true
          break
        }
      }
      if (!found) {
        if (insertAt > 0 && !ending(lines[insertAt - 1])) lines[insertAt - 1] += eol
        lines.splice(insertAt, 0, `${key}=${value}${eol}`)
        insertAt++
        end++
      }
    }
  }
  return lines.join('')
}
