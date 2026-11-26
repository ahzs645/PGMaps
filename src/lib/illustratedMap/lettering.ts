/** Lettering composed from the supplied fonts' glyphs, never from the raster map's outlines. */
import fontData from './fontGlyphs.generated.json'

export type LetteringFace = 'smallcaps' | 'regular'
type Glyph = { d: string; advance: number; bounds: number[] | null }

export const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Fit live source text to an authored ink box. Each letter remains an independent outline. */
export function lettering(
  text: string,
  box: readonly [number, number, number, number],
  face: LetteringFace = 'smallcaps',
  tracking = 100,
): string {
  const glyphs = fontData[face].glyphs as Record<string, Glyph>
  let cursor = 0
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const paths: string[] = []
  for (const char of text.toUpperCase()) {
    const glyph = glyphs[char]
    if (!glyph) throw new Error(`The illustrated-map font subset has no glyph for ${char}`)
    if (glyph.d && glyph.bounds) {
      paths.push(`<path transform="translate(${cursor} 0)" d="${glyph.d}"/>`)
      minX = Math.min(minX, cursor + glyph.bounds[0])
      minY = Math.min(minY, glyph.bounds[1])
      maxX = Math.max(maxX, cursor + glyph.bounds[2])
      maxY = Math.max(maxY, glyph.bounds[3])
    }
    cursor += glyph.advance + tracking
  }
  if (!paths.length) return ''
  const [x, y, w, h] = box
  return `<g aria-label="${escapeXml(text)}" data-text="${escapeXml(text)}" data-font="${escapeXml(fontData[face].name)}" transform="translate(${x} ${y + h}) scale(${w / (maxX - minX)} ${-h / (maxY - minY)}) translate(${-minX} ${-minY})">${paths.join('')}</g>`
}
