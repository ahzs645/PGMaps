/**
 * Advance widths of the PDF standard Helvetica faces, so a sheet can be laid out without a browser
 * or a PDF library: header fields placed side by side, table cells and legend labels fitted. The
 * numbers are the per-1000-em widths jsPDF itself uses for characters 32–126; anything else is
 * measured as an average glyph. No DOM or network access.
 */

/* prettier-ignore */
const HELVETICA = [
  280,280,350,550,550,890,660,190,330,330,390,580,280,330,280,280,550,550,550,550,550,550,550,550,550,550,280,280,
  580,580,580,550,1010,660,660,720,720,660,610,780,720,280,500,660,550,830,720,780,660,780,720,660,610,720,660,940,
  660,660,610,280,280,280,470,550,330,550,550,500,550,550,280,550,550,220,220,500,220,830,550,550,550,550,330,500,
  280,550,500,720,500,500,500,330,260,330,580,
]
/* prettier-ignore */
const HELVETICA_BOLD = [
  280,330,470,550,550,890,720,240,330,330,390,580,280,330,280,280,550,550,550,550,550,550,550,550,550,550,330,330,
  580,580,580,610,970,720,720,720,720,660,610,780,720,280,550,720,610,830,720,780,660,780,720,660,610,720,660,940,
  660,660,610,330,280,330,580,550,330,550,610,550,610,550,330,610,610,280,280,550,280,890,610,610,610,610,390,550,
  330,610,550,780,550,550,500,390,280,390,580,
]
const DEGREE = 400
const OTHER = 556

export type SheetFontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'

/** Width of `text` in points at `size` points. Italic is measured as the upright face. */
export function textWidth(text: string, size: number, style: SheetFontStyle = 'normal'): number {
  const table = style === 'bold' || style === 'bolditalic' ? HELVETICA_BOLD : HELVETICA
  let units = 0
  for (const character of text) {
    const code = character.charCodeAt(0)
    units += code >= 32 && code < 127 ? table[code - 32] : character === '°' ? DEGREE : OTHER
  }
  return (units * size) / 1000
}

/** `text` cut to fit `maxWidth`, ending in "..." when it was shortened. */
export function fitText(text: string, size: number, maxWidth: number, style: SheetFontStyle = 'normal'): string {
  if (textWidth(text, size, style) <= maxWidth) return text
  const ellipsis = '...'
  let end = text.length
  while (end > 0 && textWidth(text.slice(0, end) + ellipsis, size, style) > maxWidth) end--
  return end > 0 ? text.slice(0, end).trimEnd() + ellipsis : ''
}

/** Greedy word wrap to `maxWidth`; a word longer than a line is cut to fit it. */
export function wrapText(text: string, size: number, maxWidth: number, style: SheetFontStyle = 'normal'): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, size, style) <= maxWidth) line = candidate
      else {
        if (line) lines.push(line)
        line = textWidth(word, size, style) <= maxWidth ? word : fitText(word, size, maxWidth, style)
      }
    }
    lines.push(line)
  }
  return lines
}
