import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GState, jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { GREAT_FOREST_DIRECTORY, GREAT_FOREST_FILES, registerGreatForestPdf, woffDataUrl } from './greatForest'
import { drawSheetPdf } from './renderPdf'
import { standaloneSheetSvg } from './renderSvg'
import { textWidth } from './textMetrics'

const font = (file: string) => new Uint8Array(readFileSync(join('public', GREAT_FOREST_DIRECTORY, file)))

describe('Great Forest lettering', () => {
  it('measures with the font’s own advances, not Helvetica’s', () => {
    const helvetica = textWidth('KAMLOOPS', 12)
    const greatForest = textWidth('KAMLOOPS', 12, 'normal', 'great-forest')
    expect(greatForest).toBeGreaterThan(0)
    expect(greatForest).not.toBeCloseTo(helvetica, 3)
    // A letter the font lacks takes its base letter's advance.
    expect(textWidth('Ŵ', 12, 'normal', 'great-forest')).toBeCloseTo(textWidth('W', 12, 'normal', 'great-forest'), 9)
  })

  it('embeds the WOFF in a standalone SVG and names the face on the text', () => {
    const svg = standaloneSheetSvg(
      [{ op: 'text', x: 10, y: 20, text: 'PRINCE GEORGE', size: 12, family: 'great-forest', color: '#00392f' }],
      200,
      40,
      { fonts: { 'great-forest': woffDataUrl(font(GREAT_FOREST_FILES['great-forest'].woff)) } },
    )
    expect(svg).toContain('@font-face')
    expect(svg).toContain('data:font/woff;base64,')
    expect(svg).toContain('Great Forest Small Caps')
  })

  it('embeds the TTF in the PDF as a Unicode font', () => {
    const pdf = new jsPDF({ unit: 'pt', format: [200, 40], compress: false })
    const families = registerGreatForestPdf(pdf, { 'great-forest': font(GREAT_FOREST_FILES['great-forest'].ttf) })
    expect(families).toEqual({ 'great-forest': 'GreatForestSmallCaps' })
    drawSheetPdf(
      pdf,
      { jsPDF, GState },
      [{ op: 'text', x: 10, y: 20, text: 'PRINCE GEORGE', size: 12, family: 'great-forest', color: '#00392f' }],
      { body: 'helvetica', heading: 'helvetica', custom: false, families },
    )
    const output = pdf.output()
    expect(output).toContain('/BaseFont /GreatForestSmallCaps')
    expect(output).toContain('/Encoding /Identity-H')
    expect(output).toContain('/FontFile2')
  })
})
