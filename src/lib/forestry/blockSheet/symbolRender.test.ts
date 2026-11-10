/**
 * Sheet symbols through the whole path: composed into a sheet, then printed by the PDF and SVG
 * renderers. With `BLOCK_SHEET_SAMPLE_DIR` set, a few gallery sheets are written there as PDF and SVG.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { createSheetPdf, drawSheetPdf } from '@/lib/mapSheet/renderPdf'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { swatchOps } from '@/lib/mapSheet/symbols'
import { blockFacts } from './blockFacts'
import { galleryLayers } from './blockSheetFixtures'
import { composeSheet, sheetFocus, sheetFrame, type SheetLayers } from './composeSheet'
import { ALL_GALLERY_VARIANTS, galleryFileName, gallerySheet } from './gallerySheets'
import { RIPARIAN_SCREEN, ROAD_DEACTIVATION } from './styles'
import { catalogueEntry } from './symbolCatalogue'

const issue = { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' }
function compose(layers: SheetLayers) {
  const frame = sheetFrame('field-layout', 'tabloid', 10000, { bounds: sheetFocus(layers)! })
  return composeSheet({ frame, layers, facts: blockFacts(layers.block!.geometry), fields: {}, issue })
}
const strokes = (ops: DrawOp[], color: string) =>
  ops.filter((op) => op.op === 'path' && op.stroke?.color === color) as Extract<DrawOp, { op: 'path' }>[]

describe('symbols on a sheet', () => {
  const sheet = compose(galleryLayers)

  it('draws hatches inside a clip of their area, and marker fills and line markers as icons', () => {
    // Riparian reserve: green 45° hatch lines, after a clip and before its restore.
    const hatch = strokes(sheet.ops, '#38a800').find((op) => !op.closed && op.parts.length > 3)!
    const index = sheet.ops.indexOf(hatch)
    const clip = sheet.ops
      .slice(0, index)
      .map((op) => op.op)
      .lastIndexOf('clip')
    expect(clip).toBeGreaterThan(0)
    expect(sheet.ops.slice(clip, index).some((op) => op.op === 'restore')).toBe(false)
    // Wetland marsh marks and the rail line's ticks.
    expect(strokes(sheet.ops, '#005ce6').length).toBeGreaterThan(10)
    const rail = catalogueEntry('rail').symbol
    expect(rail.kind === 'line' && rail.markers![0].spacing).toBe(9)
    // Deactivation crosses: two strokes each, at least a few along the road.
    expect(strokes(sheet.ops, '#000000').filter((op) => op.stroke!.width === 0.14 * 7).length).toBeGreaterThan(4)
  })

  it('lists only drawn features, each with the same symbol the map used', () => {
    const keys = sheet.legend.map((item) => item.key)
    expect(keys).toContain('riparian')
    expect(keys).toContain('deactivated')
    expect(sheet.legend.filter((item) => item.key === 'riparian').map((item) => item.symbol)).toEqual([
      RIPARIAN_SCREEN.management,
      RIPARIAN_SCREEN.reserve,
    ])
    expect(sheet.legend.find((item) => item.key === 'deactivated')!.symbol).toBe(ROAD_DEACTIVATION)
    const extras = sheet.legend.filter((item) => item.key === 'extras').map((item) => item.symbol.label)
    expect(extras).toEqual(
      expect.arrayContaining(['Wetland', 'Old growth management area', 'Rail line', 'Existing culvert']),
    )
    // Each legend swatch is the swatch function's own drawing of that symbol, just before its label.
    const reserve = RIPARIAN_SCREEN.reserve
    const label = sheet.ops.findIndex((op) => op.op === 'text' && op.text.startsWith('Riparian reserve'))
    const swatch = swatchOps(reserve, { x: 0, y: 0, w: 17.4, h: 8.7 }, 1)
    const before = sheet.ops.slice(label - swatch.length, label)
    const look = (op: DrawOp) => [op.op, op.op === 'path' ? op.stroke : null]
    expect(before.map(look)).toEqual(swatch.map(look))
    // Nothing outside the frame reaches the legend.
    const far = compose({
      ...galleryLayers,
      extras: [
        {
          geometry: { type: 'Point', coordinates: [-125, 50] },
          symbol: catalogueEntry('wellsite').symbol,
        },
      ],
    })
    expect(far.legend.some((item) => item.symbol.label === 'Wellsite')).toBe(false)
  })

  it('prints the hatches and markers in the SVG and the PDF', async () => {
    const ops = await encodeSheetImages(sheet.ops)
    const svg = sheetSvg(ops, sheet.width, sheet.height)
    expect(svg).toContain('stroke="#38a800"')
    expect(svg).toContain('stroke="#005ce6"')
    expect(svg.match(/<clipPath /g)!.length).toBeGreaterThan(5)
    const pdf = createSheetPdf({ jsPDF, GState }, sheet.width, sheet.height)
    const clip = vi.spyOn(pdf, 'clipEvenOdd')
    const color = vi.spyOn(pdf, 'setDrawColor')
    drawSheetPdf(pdf, { jsPDF, GState }, ops)
    expect(clip.mock.calls.length).toBe(ops.filter((op) => op.op === 'clip').length)
    const drawn = color.mock.calls.map((call) => String(call[0]))
    expect(drawn).toContain('#38a800')
    expect(drawn).toContain('#005ce6')
    expect(drawn).toContain('#4065eb')
  })

  it('draws every gallery variant', { timeout: 120_000 }, async () => {
    const out = process.env.BLOCK_SHEET_SAMPLE_DIR
    if (out) mkdirSync(out, { recursive: true })
    for (const variant of ALL_GALLERY_VARIANTS) {
      const composed = gallerySheet(variant, 8)
      expect(composed.legend.length, galleryFileName(variant, '')).toBeGreaterThan(3)
      expect(composed.scale).toBe(variant.scale)
    }
    if (!out) return
    for (const variant of ALL_GALLERY_VARIANTS.filter(
      (v) => v.paper === 'tabloid' && (v.scale === 10000 || (v.kind === 'general-access' && v.scale === 50000)),
    )) {
      const composed = gallerySheet(variant, 150)
      const ops = await encodeSheetImages(composed.ops)
      const pdf = createSheetPdf({ jsPDF, GState }, composed.width, composed.height)
      drawSheetPdf(pdf, { jsPDF, GState }, ops)
      writeFileSync(path.join(out, galleryFileName(variant, 'pdf')), Buffer.from(pdf.output('arraybuffer')))
      writeFileSync(path.join(out, galleryFileName(variant, 'svg')), sheetSvg(ops, composed.width, composed.height))
    }
  })
})
