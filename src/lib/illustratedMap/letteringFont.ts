/**
 * A font file read at run time as a `LetteringFont`, so the map can letter in a theme's font with
 * the same outlined glyphs as the committed Great Forest subsets (`build-font-glyphs.py` reads the
 * same outlines, advances and bounds). TrueType, OpenType (CFF) and WOFF; WOFF2 is not read.
 * No DOM or network access.
 */
import { parse, type PathCommand } from 'opentype.js'
import type { Glyph, LetteringFont } from './lettering'

/** What kind of font file the bytes are, by their signature. */
export function fontFormat(bytes: Uint8Array): 'truetype' | 'opentype' | 'woff' | 'woff2' | null {
  if (bytes.length < 4) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === '\0\x01\0\0' || tag === 'true') return 'truetype'
  if (tag === 'OTTO') return 'opentype'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  return null
}

const round = (value: number) => Number(value.toFixed(3))
/**
 * Outline commands as path data. opentype.js adds a line to the point the pen is already at where
 * a contour starts and between some curves; those are left out, so a font gives the outlines
 * `build-font-glyphs.py` writes for it.
 */
function outline(commands: PathCommand[]) {
  let at: [number, number] | null = null
  let start: [number, number] | null = null
  const parts: string[] = []
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        parts.push(`M${round(command.x)} ${round(command.y)}`)
        at = start = [command.x, command.y]
        break
      case 'L':
        if (at && at[0] === command.x && at[1] === command.y) break
        parts.push(`L${round(command.x)} ${round(command.y)}`)
        at = [command.x, command.y]
        break
      case 'Q':
        parts.push(`Q${round(command.x1)} ${round(command.y1)} ${round(command.x)} ${round(command.y)}`)
        at = [command.x, command.y]
        break
      case 'C':
        parts.push(
          `C${round(command.x1)} ${round(command.y1)} ${round(command.x2)} ${round(command.y2)} ${round(command.x)} ${round(command.y)}`,
        )
        at = [command.x, command.y]
        break
      case 'Z':
        parts.push('Z')
        at = start
        break
    }
  }
  return parts.join('')
}

/** The font's own name, as its name table gives it. */
const nameOf = (names: Record<string, Record<string, string> | undefined>) =>
  names.fullName?.en ?? names.postScriptName?.en ?? names.fontFamily?.en

/**
 * A `LetteringFont` from a font file's bytes. Glyphs are read on first use and kept. A character
 * the font has no glyph for is `undefined`, so lettering names it instead of drawing a box.
 */
export function letteringFontFromBytes(
  bytes: Uint8Array,
  options: { name?: string; capitalAlternates?: boolean } = {},
): LetteringFont {
  const format = fontFormat(bytes)
  if (!format) throw new Error('This is not a TrueType, OpenType or WOFF font.')
  if (format === 'woff2') throw new Error('WOFF2 fonts cannot be read here; use the TTF, OTF or WOFF.')
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const glyphs = new Map<string, Glyph | undefined>()
  return {
    name: options.name ?? nameOf(font.names) ?? 'Theme font',
    unitsPerEm: font.unitsPerEm,
    capitalAlternates: options.capitalAlternates,
    glyph(character) {
      if (glyphs.has(character)) return glyphs.get(character)
      let glyph: Glyph | undefined
      if (font.hasChar(character)) {
        const source = font.charToGlyph(character)
        const commands = source.path.commands
        const box = source.getBoundingBox()
        glyph = {
          d: outline(commands),
          advance: source.advanceWidth ?? 0,
          bounds: commands.length ? [box.x1, box.y1, box.x2, box.y2] : null,
        }
      }
      glyphs.set(character, glyph)
      return glyph
    },
  }
}
