import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import { sampleLayers } from './blockSheetFixtures'
import { composeSheet, sheetFocus, sheetFrame, type ComposeInput } from './composeSheet'
import { galleryVariants } from './gallerySheets'
import { SHEET_CHROME } from './styles'

function input(paper: PaperId = '36x29'): ComposeInput {
  return {
    frame: sheetFrame('operating-plan', paper, 20000, { bounds: sheetFocus(sampleLayers)! }),
    layers: sampleLayers,
    facts: null,
    fields: { forestDistrict: 'Sample District', forestLicence: 'A00000', cuttingPermit: '101', blockId: 'BLK-001' },
    issue: { date: '2026-11-17', organisation: 'Example Forest Co.', preparedBy: 'Sample planner', revision: 'A' },
    caveat: 'Preliminary planning',
  }
}
const texts = (ops: DrawOp[]) => ops.filter((op) => op.op === 'text')

describe('operating plan export', () => {
  it('prints the project metadata on white furniture and retains the scale caveat', () => {
    const sheet = composeSheet(input())
    const labels = texts(sheet.ops).map((op) => op.text)
    expect(labels).toContain('Operating Plan')
    expect(labels).toContain('Sample District')
    expect(labels).toContain('BLK-001')
    expect(labels).toContain('F.L. A00000 / CP 101')
    expect(labels.join(' ')).toContain('North up, Web Mercator. Scale true at')
    expect(sheet.ops.some((op) => op.op === 'rect' && op.fill === SHEET_CHROME.barFill)).toBe(false)
    expect(sheet.ops.some((op) => op.op === 'image')).toBe(false)
  })

  it('uses only features drawn in the main frame for the legend', () => {
    const data = input()
    data.layers = {
      block: sampleLayers.block,
      streams: [
        {
          line: [
            [-125, 50],
            [-125.01, 50.01],
          ],
        },
      ],
    }
    const sheet = composeSheet(data)
    expect(sheet.legend.map((item) => item.key)).toEqual(['block'])
    const locator = data.frame.sheet.panels.find((panel) => panel.id === 'locator')!.rect
    const extent = sheet.ops.find((op) => op.op === 'path' && op.stroke?.color === SHEET_CHROME.locatorExtent)
    expect(extent?.op).toBe('path')
    if (extent?.op === 'path') {
      expect(extent.parts[0]).toHaveLength(5)
      for (const [x, y] of extent.parts[0]) {
        expect(x).toBeGreaterThan(locator.x)
        expect(x).toBeLessThan(locator.x + locator.w)
        expect(y).toBeGreaterThan(locator.y)
        expect(y).toBeLessThan(locator.y + locator.h)
      }
    }
  })

  it('fits long titles and balances map and locator clips on every offered paper', () => {
    for (const paper of Object.keys(PAPER_SIZES) as PaperId[]) {
      const data = input(paper)
      data.fields.forestDistrict = 'A long district title repeated for a constrained side panel '.repeat(3)
      data.fields.blockId = 'BLOCK-WITH-A-LONG-IDENTIFIER-00001'
      const sheet = composeSheet(data)
      expect(sheet.ops.filter((op) => op.op === 'clip')).toHaveLength(
        sheet.ops.filter((op) => op.op === 'restore').length,
      )
      const title = data.frame.sheet.title
      for (const op of texts(sheet.ops).filter(
        (op) => op.y >= title.y && op.y <= title.y + title.h && op.x > title.x,
      )) {
        const width = textWidth(op.text, op.size, op.style)
        expect(op.x - width / 2).toBeGreaterThanOrEqual(title.x)
        expect(op.x + width / 2).toBeLessThanOrEqual(title.x + title.w)
        expect(op.y - op.size / 2).toBeGreaterThanOrEqual(title.y)
        expect(op.y + op.size / 2).toBeLessThanOrEqual(title.y + title.h)
      }
    }
  })

  it('uses only the supplied user logo, with its aspect ratio intact', () => {
    const data = input()
    data.logo = { kind: 'url', url: 'data:image/png;base64,AA', format: 'PNG', width: 300, height: 100 }
    const images = composeSheet(data).ops.filter((op) => op.op === 'image')
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      expect(image.image).toBe(data.logo)
      expect(image.w / image.h).toBeCloseTo(3)
    }
  })

  it('escapes typed metadata in SVG and includes native-size gallery variants', () => {
    const data = input()
    data.fields.forestDistrict = '<script> & District'
    const sheet = composeSheet(data)
    const svg = sheetSvg(sheet.ops, sheet.width, sheet.height)
    expect(svg).toContain('&lt;script&gt; &amp; District')
    expect(svg).not.toContain('<script>')
    expect(galleryVariants('operating-plan').filter((variant) => variant.paper === '36x29')).toHaveLength(4)
    expect(galleryVariants('field-layout').filter((variant) => variant.paper === 'tabloid')).toHaveLength(4)
  })
})
