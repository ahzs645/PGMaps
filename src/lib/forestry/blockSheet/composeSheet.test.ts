import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import { blockFacts } from './blockFacts'
import {
  chainageRange,
  composeSheet,
  sheetFocus,
  sheetFrame,
  type ComposeInput,
  type SheetLayers,
} from './composeSheet'
import { sampleLayers } from './blockSheetFixtures'

const issue = { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' }
const block = sampleLayers.block!

function compose(
  layers: SheetLayers,
  patch: Partial<ComposeInput> = {},
  kind: Parameters<typeof sheetFrame>[0] = 'field-layout',
) {
  const frame = sheetFrame(kind, 'tabloid', 10000, { bounds: sheetFocus(layers)! })
  return composeSheet({
    frame,
    layers,
    facts: layers.block ? blockFacts(layers.block.geometry) : null,
    fields: {},
    issue,
    ...patch,
  })
}
const texts = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'text' ? [op] : []))

describe('composeSheet', () => {
  it('lists only the layers that drew something in the frame', () => {
    const sheet = compose({ block })
    expect(sheet.legend.map((item) => item.key)).toEqual(['block'])
    const far: SheetLayers = {
      block,
      streams: [
        {
          line: [
            [-125, 50],
            [-125.01, 50.01],
          ],
        },
      ],
      roads: [{ name: 'Spur A', color: '#2563eb', line: sampleLayers.roads![0].line, lengthM: 100 }],
    }
    expect(compose(far).legend.map((item) => item.key)).toEqual(['block', 'roads'])
  })

  it('names each designed road in the legend and the road table', () => {
    const sheet = compose(sampleLayers)
    expect(sheet.legend.filter((item) => item.key === 'roads').map((item) => item.symbol.label)).toEqual([
      'Proposed: Spur A',
      'Proposed: Spur B',
    ])
    const values = texts(sheet.ops).map((op) => op.text)
    expect(values).toContain('0+000 - 1+080')
    expect(chainageRange(12345.4)).toBe('0+000 - 12+345')
  })

  it('lays the header fields out left to right without overlap', () => {
    const sheet = compose(block ? { block } : {}, {
      fields: {
        forestLicence: 'A very long forest licence name',
        cuttingPermit: 'Permit 1234567',
        blockId: 'BLOCK-LONG-ID-0001',
      },
    })
    const bar = texts(sheet.ops).filter((op) => op.style === 'bold' && op.y < 50 && op.size >= 7)
    const fields = bar.slice(1)
    expect(fields.map((op) => op.text.split(':')[0])).toEqual(['Lat', 'Long', 'F.L.', 'CP', 'Block ID'])
    for (let i = 1; i < fields.length; i++)
      expect(fields[i].x).toBeGreaterThanOrEqual(
        fields[i - 1].x + textWidth(fields[i - 1].text, fields[i - 1].size, 'bold'),
      )
    const last = fields.at(-1)!
    expect(last.x + textWidth(last.text, last.size, 'bold')).toBeLessThanOrEqual(1224 * 0.9765)
  })

  it('prints black title text on the #ffd37f bar', () => {
    const sheet = compose({ block })
    const bar = sheet.ops.find((op) => op.op === 'rect' && op.fill === '#ffd37f')
    expect(bar).toBeDefined()
    expect(texts(sheet.ops).find((op) => op.text === 'Field Layout')?.color).toBe('#000000')
  })

  it('prints "not recorded" for missing values and the computed ones otherwise', () => {
    const sheet = compose({ block })
    const values = texts(sheet.ops).map((op) => op.text)
    expect(values).toContain('not recorded')
    expect(values).toContain('093I003')
  })

  it('draws a logo only when one is given', () => {
    expect(compose({ block }).ops.some((op) => op.op === 'image')).toBe(false)
    const logo = {
      kind: 'url' as const,
      url: 'data:image/png;base64,AA',
      format: 'PNG' as const,
      width: 200,
      height: 80,
    }
    const image = compose({ block }, { logo }).ops.find((op) => op.op === 'image')
    expect(image).toMatchObject({ op: 'image' })
    if (image?.op === 'image') expect(image.w / image.h).toBeCloseTo(2.5)
  })

  it('prints a stamp over the map and the imagery credit', () => {
    const sheet = compose(
      { block },
      {
        stamp: 'NOT CURRENT: section width is invalid',
        base: {
          image: { kind: 'rgba', data: new Uint8ClampedArray(4), width: 1, height: 1 },
          attribution: 'Imagery: test',
        },
      },
    )
    const values = texts(sheet.ops).map((op) => op.text)
    expect(values.join(' ')).toContain('NOT CURRENT')
    expect(values).toContain('Imagery: test')
  })

  it('keeps the map inside its clip and the frame on the page at every paper size', () => {
    for (const paper of ['tabloid', 'letter', 'a3', 'a4'] as const)
      for (const kind of ['field-layout', 'general-access', 'field-imagery'] as const) {
        const frame = sheetFrame(kind, paper, 'fit', { bounds: sheetFocus({ block })! })
        const sheet = composeSheet({ frame, layers: { block }, facts: null, fields: {}, issue })
        const clips = sheet.ops.filter((op) => op.op === 'clip').length
        const restores = sheet.ops.filter((op) => op.op === 'restore').length
        expect(clips).toBe(restores)
        for (const op of texts(sheet.ops)) {
          expect(op.x).toBeGreaterThanOrEqual(0)
          expect(op.x).toBeLessThanOrEqual(sheet.width)
          expect(op.size).toBeGreaterThanOrEqual(4.5)
        }
      }
  })

  it('fits the block at the smallest listed scale that shows it', () => {
    const frame = sheetFrame('field-layout', 'tabloid', 'fit', { bounds: sheetFocus({ block })! })
    expect(frame.projection.scale).toBe(10000)
    expect(() => sheetFrame('field-layout', 'tabloid', 500000, { bounds: sheetFocus({ block })! })).toThrow(/1:250,000/)
  })
})
