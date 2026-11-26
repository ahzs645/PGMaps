/** Lettering composed from the supplied fonts' glyphs, never from the raster map's outlines. */
import fontData from './fontGlyphs.generated.json'

export type LetteringFace = 'smallcaps' | 'regular'
type Glyph = { d: string; advance: number; bounds: number[] | null }

/** Bake the font's absolute outline commands into drawing coordinates.
 * A halo can then use one map-unit width in both axes, including fitted lettering.
 * The supplied font subset uses M/L/H/V/Q/Z; rejecting other commands prevents a
 * future font change from silently shifting or distorting its contours.
 */
function fittedOutline(d: string, sx: number, sy: number, tx: number, ty: number): string {
  const round = (value: number) => Number(value.toFixed(3))
  return [...d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)]
    .map(([, command, coordinates]) => {
      if (!['M', 'L', 'H', 'V', 'Q', 'Z'].includes(command))
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

/** Fit live source text to an authored ink box. Each letter remains an independent outline. */
export function lettering(
  text: string,
  box: readonly [number, number, number, number],
  face: LetteringFace = 'smallcaps',
  tracking = 100,
  outlineWidth = 0,
): string {
  const glyphs = fontData[face].glyphs as Record<string, Glyph>
  let cursor = 0
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const outlines: { glyph: Glyph; offset: number }[] = []
  for (const char of text.toUpperCase()) {
    const glyph = glyphs[char]
    if (!glyph) throw new Error(`The illustrated-map font subset has no glyph for ${char}`)
    if (glyph.d && glyph.bounds) {
      outlines.push({ glyph, offset: cursor })
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
    ({ glyph, offset }) => `<path d="${fittedOutline(glyph.d, sx, sy, x + (offset - minX) * sx, y + h - minY * sy)}"/>`,
  )
  const halo = Number.isFinite(outlineWidth) ? Math.max(0, Math.min(5, outlineWidth)) : 0
  // Stroke first and then fill: the white outline grows outside each glyph;
  // it does not consume the coloured letter or blank a rectangular label box.
  const outline =
    halo > 0 ? ` stroke="#FFFFFF" stroke-width="${halo * 2}" stroke-linejoin="round" paint-order="stroke fill"` : ''
  return `<g aria-label="${escapeXml(text)}" data-text="${escapeXml(text)}" data-font="${escapeXml(fontData[face].name)}" data-outline-width="${halo}"${outline}>${paths.join('')}</g>`
}
