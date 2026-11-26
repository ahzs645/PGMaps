import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import { checkedSheetSymbol } from '@/lib/styleExchange/checkedSymbol'
import { documentWithoutOrganicHatches, straightenedOrganicHatch } from '@/lib/styleExchange/organicFallback'
import { STYLE_EXCHANGE_SCHEMA, type StyleDocument } from '@/lib/styleExchange/model'
import { rectRing, type DrawOp } from './drawOps'
import { areaPatternId, symbolImages } from './mapSymbols'
import { createSheetPdf, drawSheetPdf, pdfText, pdfTextUnfolded } from './renderPdf'
import { sheetSvg, standaloneSheetSvg } from './renderSvg'
import {
  ORGANIC_HATCH_SHEET,
  parseSymbolStyle,
  styledAreaSymbol,
  symbolStyleForShape,
  type SymbolStyleDefaults,
} from './symbolStyle'
import { MAX_ORGANIC_HATCH_STROKES, areaSymbolOps, organicHatchOps, organicHatchSpacing } from './symbols'
import { textWidth } from './textMetrics'

const DEFAULTS: SymbolStyleDefaults = {
  label: 'Old growth',
  color: '#4d7c0f',
  pattern: 'solid',
  dash: 'solid',
  width: 1,
  opacity: 0.2,
}

const curves = (ops: DrawOp[]) => ops.filter((op): op is DrawOp & { op: 'curves' } => op.op === 'curves')
const strokeKeys = (ops: DrawOp[]) =>
  curves(ops).flatMap((op) => op.parts.map((part) => JSON.stringify([part, op.stroke?.width])))

describe('organic hatch on a sheet', () => {
  it('is a pattern a layer style can choose and save', () => {
    const style = parseSymbolStyle({ pattern: 'organic', organic: { seed: 12, curvature: 3 } })
    expect(style).toEqual({ pattern: 'organic', organic: { seed: 12, curvature: 3 } })
    expect(() => parseSymbolStyle({ pattern: 'organic', organic: { spacing: 40 } })).toThrow(/spacing/)
    expect(() => parseSymbolStyle({ organic: { seed: 1.5 } })).toThrow(/whole number/)
    expect(() => parseSymbolStyle({ organic: { wobble: 1 } })).toThrow(/unknown setting/)
    expect(symbolStyleForShape(style, 'area')).toEqual(style)
    expect(symbolStyleForShape(style, 'line')).toEqual({})
    const symbol = styledAreaSymbol(DEFAULTS, { ...style, patternColor: '#365314' })
    expect(symbol.organicHatch).toEqual({
      ...ORGANIC_HATCH_SHEET,
      seed: 12,
      curvature: 3,
      color: '#365314',
      opacity: 0.85,
    })
    expect(symbol.hatches).toBeUndefined()
  })

  it('draws true curves clipped to the area, from the page origin', () => {
    const symbol = styledAreaSymbol(DEFAULTS, { pattern: 'organic' })
    const left = areaSymbolOps([rectRing(100, 100, 120, 90)], symbol, 1)
    expect(left.map((op) => op.op)).toEqual(expect.arrayContaining(['path', 'clip', 'curves', 'restore']))
    expect(left.findIndex((op) => op.op === 'clip')).toBeLessThan(left.findIndex((op) => op.op === 'curves'))
    // Neighbouring areas draw the same strokes along their shared edge: no seam.
    const right = areaSymbolOps([rectRing(220, 100, 120, 90)], symbol, 1)
    const shared = strokeKeys(left).filter((key) => strokeKeys(right).includes(key))
    expect(shared.length).toBeGreaterThan(5)
    // On a larger paper (k = 2) the strokes are twice as long and wide.
    const widths = (ops: DrawOp[]) => curves(ops).map((op) => op.stroke!.width)
    const big = organicHatchOps({ x: 200, y: 200, w: 240, h: 180 }, symbol.organicHatch!, 2)
    expect(Math.max(...widths(big))).toBeGreaterThan(Math.max(...widths(left)) * 1.6)
  })

  it('widens its spacing past the stroke budget, and says so', () => {
    const fill = styledAreaSymbol(DEFAULTS, { pattern: 'organic' }).organicHatch!
    expect(organicHatchSpacing({ x: 0, y: 0, w: 200, h: 200 }, fill, 1)).toEqual({ spacing: 2.5, limited: false })
    const wide = organicHatchSpacing({ x: 0, y: 0, w: 2400, h: 3400 }, fill, 1)
    expect(wide.limited).toBe(true)
    expect(wide.spacing).toBeGreaterThan(2.5)
    expect(MAX_ORGANIC_HATCH_STROKES).toBeGreaterThan(10_000)
  })

  it('writes the curves as SVG cubic paths and PDF curve operators', () => {
    const ops = areaSymbolOps([rectRing(10, 10, 80, 60)], styledAreaSymbol(DEFAULTS, { pattern: 'organic' }), 1)
    const svg = standaloneSheetSvg(ops, 100, 80)
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+C[\d. ]+/)
    expect(sheetSvg(ops, 100, 80)).toContain('stroke-linecap="round"')
    const pdf = createSheetPdf({ jsPDF, GState }, 100, 80)
    const curveTo = vi.spyOn(pdf, 'curveTo')
    drawSheetPdf(pdf, { jsPDF, GState }, ops)
    expect(curveTo.mock.calls.length).toBe(curves(ops).reduce((sum, op) => sum + op.parts.length, 0))
  })

  it('becomes a seamless MapLibre tile with the fill baked in', () => {
    const symbol = styledAreaSymbol(DEFAULTS, { pattern: 'organic' })
    const [image] = symbolImages(symbol, 1)
    expect(image.id).toBe(areaPatternId(symbol))
    expect(image.image.width).toBe(512)
    expect(image.image.data[3]).toBeGreaterThan(0)
    expect(areaPatternId(styledAreaSymbol(DEFAULTS, { pattern: 'organic', organic: { seed: 2 } }))).not.toBe(image.id)
  })
})

describe('organic hatch in style exchange', () => {
  it('survives a saved symbol and is straightened for other programs', () => {
    const symbol = styledAreaSymbol(DEFAULTS, { pattern: 'organic' })
    expect(checkedSheetSymbol(JSON.parse(JSON.stringify(symbol)))).toEqual(symbol)
    expect(() => checkedSheetSymbol({ ...symbol, organicHatch: { ...symbol.organicHatch, curvature: 99 } })).toThrow(
      /curvature/,
    )
    const straight = straightenedOrganicHatch(symbol)
    expect(straight.kind === 'area' && straight.organicHatch).toBeFalsy()
    expect(straight.kind === 'area' && straight.hatches?.[0]).toMatchObject({ angleDeg: 80, spacing: 2.5 })
    const document = {
      schema: STYLE_EXCHANGE_SCHEMA,
      name: 'Test',
      layers: [
        { id: 'a', name: 'Areas', geometry: 'polygon', fields: [], rules: [{ label: 'Old', filter: null, symbol }] },
      ],
    } as unknown as StyleDocument
    expect(documentWithoutOrganicHatches(document).replaced).toEqual(['Areas: Old'])
  })
})

describe('place names in PDF text', () => {
  it('prints Latin-1 and WinAnsi letters, and folds only what the font lacks', () => {
    expect(pdfText('Québec, Nuñez, Ålesund, Œuvre, Šibenik')).toBe('Québec, Nuñez, Ålesund, Œuvre, Šibenik')
    expect(pdfText('Sḵwx̱wú7mesh Úxwumixw')).toBe('Skwxwú7mesh Úxwumixw')
    expect(pdfText('Łódź')).toBe('Lódz')
    expect(pdfTextUnfolded('Québec Sḵwx̱wú7mesh')).toEqual([])
    expect(pdfTextUnfolded('ʔaq̓am')).toEqual(['ʔ'])
    // A brand font carries its own glyphs: letters stay as written, symbols still fold.
    expect(pdfText('Sḵwx̱wú7mesh − ʔaq̓am', { unicodeLetters: true })).toBe('Sḵwx̱wú7mesh - ʔaq̓am')
  })

  it('measures an accented letter as wide as its letter', () => {
    expect(textWidth('Québec', 10)).toBeCloseTo(textWidth('Quebec', 10), 9)
  })
})

describe('patch hatch (page 8) on a sheet', () => {
  it('draws the page 8 patch field as curves, saves and reads back, and makes a map tile', () => {
    const symbol = styledAreaSymbol(DEFAULTS, { pattern: 'patch', organic: { seed: 3 } })
    expect(symbol.organicHatch).toMatchObject({ style: 'patch', seed: 3, patch: { patchSize: 240 } })
    const ops = areaSymbolOps([rectRing(20, 20, 160, 100)], symbol, 1)
    expect(curves(ops).length).toBeGreaterThan(0)
    expect(checkedSheetSymbol(JSON.parse(JSON.stringify(symbol)))).toEqual(symbol)
    expect(() =>
      checkedSheetSymbol({ ...symbol, organicHatch: { ...symbol.organicHatch, patch: { patchSize: 2 } } }),
    ).toThrow(/patch size|lean/i)
    const [image] = symbolImages(symbol, 1)
    expect(image.image.width).toBe(image.image.height * 2)
    expect(areaPatternId(symbol)).not.toBe(areaPatternId(styledAreaSymbol(DEFAULTS, { pattern: 'organic' })))
  })
})
