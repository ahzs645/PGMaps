import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import { blockFacts } from './blockFacts'
import {
  chainageRange,
  composeSheet,
  MASK_NOTE,
  sheetFocus,
  sheetFrame,
  type ComposeInput,
  type SheetLayers,
} from './composeSheet'
import { sampleLayers } from './blockSheetFixtures'
import { OUTSIDE_BLOCK_MASK } from './styles'

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

  it('draws a feature with the symbol a tool gives it, on the map and in the legend', () => {
    const stream = sampleLayers.streams!.find((entry) => !entry.ncd) ?? sampleLayers.streams![0]
    const layers: SheetLayers = { block, streams: [{ line: stream.line }] }
    const mine = { kind: 'line' as const, label: 'My creek', layers: [{ color: '#123456', width: 1.7 }] }
    const own = compose(layers).legend.find((item) => item.key === 'streams')!
    expect(own.symbol.label).not.toBe('My creek')
    const sheet = compose(layers, { symbols: { stream: mine } })
    expect(sheet.legend.find((item) => item.key === 'streams')!.symbol).toEqual(mine)
    const strokes = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'path' && op.stroke ? [op.stroke.color] : []))
    expect(strokes(sheet.ops)).toContain('#123456')
    expect(strokes(compose(layers).ops)).not.toContain('#123456')
    // A symbol of the wrong kind for its feature is left out, not drawn as something else.
    const wrong = { kind: 'point' as const, label: 'Dot', icon: 'dot' as const, size: 3, color: '#123456' }
    expect(compose(layers, { symbols: { stream: wrong } }).legend).toEqual(compose(layers).legend)
  })

  it('draws a deactivated road with its own symbol alone when a tool gives one', () => {
    const line = sampleLayers.roads![0].line
    const layers: SheetLayers = { block, existingRoads: [{ line, forestService: false, deactivated: true }] }
    expect(compose(layers).legend.map((item) => item.key)).toEqual(['block', 'existingRoads', 'deactivated'])
    const whole = { kind: 'line' as const, label: 'Closed road', layers: [{ color: '#654321', width: 2 }] }
    const sheet = compose(layers, { symbols: { deactivated: whole } })
    expect(sheet.legend.map((item) => item.key)).toEqual(['block', 'deactivated'])
    expect(sheet.legend[1].symbol).toEqual(whole)
  })

  it('lists a symbol two layers share once', () => {
    const other = { geometry: sampleLayers.otherBlocks![0].geometry }
    const layers: SheetLayers = { block, otherBlocks: [other] }
    expect(compose(layers).legend.map((item) => item.key)).toEqual(['block', 'otherBlocks'])
    const shared = {
      kind: 'area' as const,
      label: 'Proposed Block',
      outline: [{ color: '#00a000', width: 1.2 }],
    }
    const sheet = compose(layers, { symbols: { block: shared, otherBlock: shared } })
    expect(sheet.legend.map((item) => item.symbol.label)).toEqual(['Proposed Block'])
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

  it('prints a typed field left empty blank when asked, and missing facts still as "not recorded"', () => {
    const lines = (patch: Partial<ComposeInput>, kind: Parameters<typeof sheetFrame>[0]) =>
      texts(compose({ block }, patch, kind).ops)
        .map((op) => op.text)
        .filter((text) => /not recorded|Prepared by|Summary By/.test(text))
    // Absent is blank, so a tool that offers no choice prints no stand-in wording; `stated` is the earlier sheet.
    expect(lines({}, 'lidar-slope')).toEqual(lines({ emptyFields: 'blank' }, 'lidar-slope'))
    expect(lines({ emptyFields: 'stated' }, 'lidar-slope')).toContain('Prepared by: not recorded')
    // Blank: the label stays with nothing after it, and only the elevations, facts this sheet could
    // not work out without terrain, still say "not recorded".
    expect(lines({ emptyFields: 'blank' }, 'lidar-slope')).toEqual(['not recorded', 'not recorded', 'Prepared by: '])
    expect(lines({ emptyFields: 'blank' }, 'field-layout')).toEqual([
      'not recorded',
      'not recorded',
      'Summary By: ',
      'Prepared by: ',
    ])
    expect(lines({ emptyFields: 'stated' }, 'operating-plan')).toContain('Forest district not recorded')
    expect(lines({}, 'operating-plan')).not.toContain('Forest district not recorded')
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

  it('dims the map outside the block only when asked, under the outline, and says so once', () => {
    const layers: SheetLayers = { block, roads: sampleLayers.roads }
    const note = new RegExp(MASK_NOTE)
    for (const kind of ['field-layout', 'lidar-slope', 'general-access', 'field-imagery', 'operating-plan'] as const) {
      const plain = compose(layers, {}, kind)
      const masked = compose(layers, { maskOutsideBlock: true, sourceLine: 'Slope % from LiDAR' }, kind)
      const mask = masked.ops.findIndex(
        (op) =>
          op.op === 'path' && op.fill === OUTSIDE_BLOCK_MASK.color && op.fillOpacity === OUTSIDE_BLOCK_MASK.opacity,
      )
      expect(mask, kind).toBeGreaterThan(0)
      // Everything up to the mask is the same sheet.
      expect(masked.ops.slice(0, mask)).toEqual(plain.ops.slice(0, mask))
      const op = masked.ops[mask]
      // The frame's ring and then the block's rings, filled even-odd so the block stays clear.
      expect(op.op === 'path' && op.parts.length).toBe(
        1 +
          (block.geometry.type === 'Polygon'
            ? block.geometry.coordinates.length
            : block.geometry.coordinates.flat().length),
      )
      // The block's outline, its label and the furniture draw after it; the legend gains nothing.
      const firstRoad = masked.ops.findIndex((o) => o.op === 'text' && o.text === sampleLayers.roads![0].name)
      expect(firstRoad).toBeLessThan(mask)
      expect(masked.legend).toEqual(plain.legend)
      expect(
        texts(masked.ops).filter((t) => note.test(t.text)),
        kind,
      ).toHaveLength(1)
      expect(texts(plain.ops).some((t) => note.test(t.text))).toBe(false)
    }
    // Nothing to dim around without a block.
    const roadsOnly = compose({ roads: sampleLayers.roads }, { maskOutsideBlock: true })
    expect(texts(roadsOnly.ops).some((t) => note.test(t.text))).toBe(false)
  })
})
