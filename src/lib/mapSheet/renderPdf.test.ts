import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import type { DrawOp } from './drawOps'
import { createSheetPdf, drawSheetPdf, pdfText } from './renderPdf'
import { sheetSvg } from './renderSvg'

const ops: DrawOp[] = [
  {
    op: 'clip',
    parts: [
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    ],
  },
  { op: 'rect', x: 0, y: 0, w: 100, h: 20, fill: '#ffd37f', stroke: { color: '#000000', width: 1 } },
  {
    op: 'path',
    parts: [
      [
        [0, 0],
        [50, 50],
      ],
    ],
    closed: false,
    stroke: { color: '#ff0000', width: 2.5, dash: [5, 5] },
  },
  { op: 'text', x: 10, y: 10, text: 'Label', size: 8, color: '#000000', halo: { color: '#ffffff', width: 1.2 } },
  { op: 'restore' },
]

describe('sheet renderers', () => {
  it('draws the halo before the text and balances graphics states', () => {
    const pdf = createSheetPdf({ jsPDF, GState }, 1224, 792)
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(1224)
    const text = vi.spyOn(pdf, 'text')
    const save = vi.spyOn(pdf, 'saveGraphicsState')
    const restore = vi.spyOn(pdf, 'restoreGraphicsState')
    drawSheetPdf(pdf, { jsPDF, GState }, ops)
    expect(text).toHaveBeenCalledTimes(2)
    expect(text.mock.calls[0][3]).toMatchObject({ renderingMode: 'fillThenStroke' })
    expect(text.mock.calls[1][3]).not.toHaveProperty('renderingMode')
    expect(save.mock.calls.length).toBe(restore.mock.calls.length)
    expect(new TextDecoder().decode(pdf.output('arraybuffer').slice(0, 5))).toBe('%PDF-')
  })

  it('folds text into WinAnsi', () => {
    expect(pdfText('1 − 2 · 3 – 4 ≥ 95 m³')).toBe('1 - 2 - 3  -  4 >= 95 m3')
    expect(pdfText('54°4\'0"N')).toBe('54°4\'0"N')
  })

  it('shows the same operations as SVG, clipped and escaped', () => {
    const svg = sheetSvg([...ops, { op: 'text', x: 0, y: 0, text: 'A & B', size: 6, color: '#000' }], 100, 100)
    expect(svg).toContain('clip-path="url(#sheet-clip-1)"')
    expect(svg).toContain('stroke-dasharray="5 5"')
    expect(svg).toContain('A &amp; B')
    expect(svg.match(/<g /g)?.length).toBe(svg.match(/<\/g>/g)?.length)
  })
})
