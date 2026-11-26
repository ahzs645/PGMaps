import { DOMParser } from '@xmldom/xmldom'
import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import { translateOps } from '@/lib/forestry/viaFigure/composeFigure'
import { glyphsAlongPath, readingPath, smoothedPath, type DrawOp, type Point } from './drawOps'
import { drawSheetPdf } from './renderPdf'
import { sheetSvg, standaloneSheetSvg } from './renderSvg'
import { textWidth } from './textMetrics'

const arrow: DrawOp[] = [
  {
    op: 'path',
    parts: [
      [
        [-10, 0],
        [10, 0],
      ],
    ],
    closed: false,
    stroke: { color: '#1d4ed8', width: 3 },
  },
]
const ops: DrawOp[] = [
  { op: 'group', id: 'symbols', label: 'Symbols & marks', layer: true },
  { op: 'symbol', id: 'arrow', label: 'Arrow', ops: arrow, bounds: { x: -12, y: -8, w: 24, h: 16 } },
  { op: 'use', id: 'arrow', x: 60, y: 60 },
  { op: 'use', id: 'arrow', x: 120, y: 60, rotation: 90, scale: 2 },
  { op: 'endGroup' },
  {
    op: 'textPath',
    path: [
      [300, 200],
      [40, 200],
    ],
    text: 'Sea to Sky',
    size: 12,
    color: '#00392f',
    halo: { color: '#ffffff', width: 2 },
  },
]
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')

describe('text along a line', () => {
  it('runs left to right and centres the text with the PDF widths', () => {
    const line: Point[] = [
      [100, 50],
      [0, 50],
    ]
    expect(readingPath(line)[0]).toEqual([0, 50])
    const glyphs = glyphsAlongPath(line, 'ABC', 10)
    const width = textWidth('ABC', 10)
    expect(glyphs.map((g) => g.char)).toEqual(['A', 'B', 'C'])
    expect(glyphs[0].x).toBeCloseTo((100 - width) / 2, 9)
    expect(glyphs[1].x).toBeCloseTo(glyphs[0].x + textWidth('A', 10), 9)
    expect(glyphs.every((g) => g.angle === 0 && g.y === 50)).toBe(true)
    // Rising to the right on paper (y down) is a positive, counter-clockwise angle.
    const [rising] = glyphsAlongPath(
      [
        [0, 100],
        [100, 0],
      ],
      'A',
      10,
      undefined,
      'start',
    )
    expect(rising.angle).toBeCloseTo(45, 9)
  })
})

describe('labels on winding roads', () => {
  it('centres letters on the line and smooths a zigzag under them', () => {
    const flat: Point[] = [
      [0, 50],
      [100, 50],
    ]
    const [onLine] = glyphsAlongPath(flat, 'A', 10, undefined, 'start')
    const [centred] = glyphsAlongPath(flat, 'A', 10, undefined, 'start', 0, 3.58)
    expect(centred.y - onLine.y).toBeCloseTo(3.58, 9)
    const zigzag: Point[] = Array.from({ length: 21 }, (_, i) => [i * 5, i % 2 ? 4 : -4])
    const smooth = smoothedPath(zigzag, 12)
    const swing = (line: Point[]) => Math.max(...line.slice(5, -5).map(([, y]) => Math.abs(y)))
    expect(swing(smooth)).toBeLessThan(swing(zigzag) / 3)
  })
})

describe('named layers, symbols and curved labels in SVG', () => {
  it('writes layers, one symbol definition placed twice, and an editable text path', () => {
    const svg = standaloneSheetSvg(ops, 400, 300)
    const document = parse(svg)
    expect(document.getElementsByTagName('parsererror').length).toBe(0)
    expect(svg).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')
    expect(svg).toContain(
      '<g id="symbols" data-name="Symbols &amp; marks" inkscape:groupmode="layer" inkscape:label="Symbols &amp; marks">',
    )
    expect((svg.match(/<g id="symbol-arrow"/g) ?? []).length).toBe(1)
    expect(svg).toContain('<use xlink:href="#symbol-arrow" transform="translate(60 60)"/>')
    expect(svg).toContain('<use xlink:href="#symbol-arrow" transform="translate(120 60) rotate(-90) scale(2)"/>')
    // The text path runs left to right; text stays text, halo first.
    expect(svg).toContain('<path id="sheet-text-path-1" d="M40 200L300 200" fill="none"/>')
    expect(
      svg.match(/<textPath xlink:href="#sheet-text-path-1" startOffset="[\d.]+">Sea to Sky<\/textPath>/g),
    ).toHaveLength(2)
    // The in-app preview parses too, with plain href.
    const preview = sheetSvg(ops, 400, 300)
    expect(parse(preview).getElementsByTagName('parsererror').length).toBe(0)
    expect(preview).toContain('<use href="#symbol-arrow"')
  })
})

describe('symbols and curved labels in PDF', () => {
  it('defines a form once, places it twice, and sets the label glyph by glyph', () => {
    const pdf = new jsPDF({ unit: 'pt', format: [400, 300], compress: false })
    const place = vi.spyOn(pdf, 'doFormObject')
    const text = vi.spyOn(pdf, 'text')
    drawSheetPdf(pdf, { jsPDF, GState }, ops)
    expect(place).toHaveBeenCalledTimes(2)
    // Halo pass and fill pass, one call per glyph each, with the halo drawn as its own call too.
    const glyphs = 'Sea to Sky'.length
    expect(text.mock.calls.length).toBeGreaterThanOrEqual(glyphs * 2)
    const output = pdf.output()
    expect((output.match(/\/Subtype \/Form/g) ?? []).length).toBe(1)
    expect((output.match(/ Do\n/g) ?? []).length).toBe(2)
    expect(() => drawSheetPdf(pdf, { jsPDF, GState }, [{ op: 'use', id: 'missing', x: 0, y: 0 }])).toThrow(
      /before defining/,
    )
  })

  it('moves placements and label lines with a figure, not symbol definitions', () => {
    const moved = translateOps(ops, 10, 5)
    expect(moved[1]).toBe(ops[1])
    expect(moved[2]).toMatchObject({ x: 70, y: 65 })
    expect((moved[5] as { path: Point[] }).path[0]).toEqual([310, 205])
  })
})
