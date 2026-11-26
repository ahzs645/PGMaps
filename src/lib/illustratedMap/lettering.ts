/** Lettering composed from the supplied fonts' glyphs, never from the raster map's outlines. */
import fontData from './fontGlyphs.generated.json'

export type LetteringFace = 'smallcaps' | 'regular'
/** A glyph in font units, y up: outline (M/L/H/V/Q/C/Z), advance width and ink bounds. */
export type Glyph = { d: string; advance: number; bounds: number[] | null }
/**
 * Any font the map can letter in: the committed Great Forest subsets (`LetteringFace`), or a font
 * read at run time (`letteringFont.ts`, a map theme's). `capitalAlternates`: its lowercase are
 * capital-shaped alternates (Great Forest Simplified), so a label's mixed-case glyph text is kept.
 */
export interface LetteringFont {
  name: string
  unitsPerEm: number
  glyph: (character: string) => Glyph | undefined
  capitalAlternates?: boolean
}
export type LetteringSource = LetteringFace | LetteringFont

const builtIn = (face: LetteringFace): LetteringFont => {
  const font = fontData[face]
  const glyphs = font.glyphs as Record<string, Glyph>
  return { name: font.name, unitsPerEm: font.unitsPerEm, glyph: (character) => glyphs[character] }
}
const BUILT_IN = { smallcaps: builtIn('smallcaps'), regular: builtIn('regular') }
const resolve = (face: LetteringSource): LetteringFont => (typeof face === 'string' ? BUILT_IN[face] : face)

/** Bake the font's absolute outline commands into drawing coordinates.
 * A halo can then use one map-unit width in both axes, including fitted lettering.
 * The supplied font subset uses M/L/H/V/Q/Z, a CFF font C; rejecting other commands prevents a
 * future font change from silently shifting or distorting its contours.
 */
function fittedOutline(d: string, sx: number, sy: number, tx: number, ty: number): string {
  const round = (value: number) => Number(value.toFixed(3))
  return [...d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)]
    .map(([, command, coordinates]) => {
      if (!['M', 'L', 'H', 'V', 'Q', 'C', 'Z'].includes(command))
        throw new Error(`Unsupported font outline command: ${command}`)
      const values = (coordinates.match(/-?\d*\.?\d+/g) ?? []).map(Number)
      return (
        command +
        values
          .map((value, index) =>
            round(command === 'V' || (command !== 'H' && index % 2 === 1) ? value * sy + ty : value * sx + tx),
          )
          .join(' ')
      )
    })
    .join('')
}

export const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Measure genuine glyphs at one uniform em size for geographic label placement. */
export function letteringSize(
  text: string,
  emSize = 23.923,
  face: LetteringSource = 'smallcaps',
  glyphText = text.toUpperCase(),
): { width: number; height: number } {
  if (glyphText.toUpperCase() !== text.toUpperCase())
    throw new Error('The glyph sequence must preserve the lettering text')
  const font = resolve(face)
  let cursor = 0
  let left = Infinity,
    right = -Infinity,
    bottom = Infinity,
    top = -Infinity
  for (const character of glyphText) {
    const glyph = font.glyph(character)
    if (!glyph) throw new Error(`${font.name} has no glyph for ${character}`)
    if (glyph.bounds) {
      left = Math.min(left, cursor + glyph.bounds[0])
      right = Math.max(right, cursor + glyph.bounds[2])
      bottom = Math.min(bottom, glyph.bounds[1])
      top = Math.max(top, glyph.bounds[3])
    }
    cursor += glyph.advance
  }
  const scale = emSize / font.unitsPerEm
  return Number.isFinite(left)
    ? { width: (right - left) * scale, height: (top - bottom) * scale }
    : { width: 0, height: 0 }
}

/**
 * Fit live source text to an authored ink box. Each letter remains a genuine font outline.
 * `glyphText` selects the regular font's capital-shaped lowercase alternates while
 * `text` retains the readable wording. Omitting it preserves the original API.
 * Tracking is in the selected font's design units, before the box is fitted.
 */
export function lettering(
  text: string,
  box: readonly [number, number, number, number],
  face: LetteringSource = 'smallcaps',
  tracking = 100,
  outlineWidth = 0,
  glyphText = text.toUpperCase(),
): string {
  if (glyphText.toUpperCase() !== text.toUpperCase())
    throw new Error('The glyph sequence must preserve the lettering text')
  const font = resolve(face)
  let cursor = 0
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const outlines: { glyph: Glyph; offset: number; character: string; index: number }[] = []
  for (const [index, char] of [...glyphText].entries()) {
    const glyph = font.glyph(char)
    if (!glyph) throw new Error(`${font.name} has no glyph for ${char}`)
    if (glyph.d && glyph.bounds) {
      outlines.push({ glyph, offset: cursor, character: char, index })
      minX = Math.min(minX, cursor + glyph.bounds[0])
      minY = Math.min(minY, glyph.bounds[1])
      maxX = Math.max(maxX, cursor + glyph.bounds[2])
      maxY = Math.max(maxY, glyph.bounds[3])
    }
    cursor += glyph.advance + tracking
  }
  if (!outlines.length) return ''
  const [x, y, w, h] = box
  const sx = w / (maxX - minX)
  const sy = -h / (maxY - minY)
  const paths = outlines.map(
    ({ glyph, offset, character, index }) =>
      `<path data-character="${escapeXml(character)}" data-glyph-index="${index}" d="${fittedOutline(glyph.d, sx, sy, x + (offset - minX) * sx, y + h - minY * sy)}"/>`,
  )
  const halo = Number.isFinite(outlineWidth) ? Math.max(0, Math.min(5, outlineWidth)) : 0
  // Stroke first and then fill: the white outline grows outside each glyph;
  // it does not consume the coloured letter or blank a rectangular label box.
  const outline =
    halo > 0 ? ` stroke="#FFFFFF" stroke-width="${halo * 2}" stroke-linejoin="round" paint-order="stroke fill"` : ''
  const metric = (value: number) => Number(value.toFixed(6))
  const metadata = `data-glyph-text="${escapeXml(glyphText)}" data-ink-box="${box.map(metric).join(' ')}" data-tracking-units="${metric(tracking)}" data-tracking-px="${metric(tracking * sx)}" data-font-units-per-em="${font.unitsPerEm}" data-font-scale="${metric(sx)} ${metric(-sy)}" data-font-size-px="${metric(sx * font.unitsPerEm)} ${metric(-sy * font.unitsPerEm)}"`
  return `<g aria-label="${escapeXml(text)}" data-text="${escapeXml(text)}" data-font="${escapeXml(font.name)}" ${metadata} data-outline-width="${halo}"${outline}>${paths.join('')}</g>`
}
