import { DOMParser } from '@xmldom/xmldom'
import { GState, jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { DrawOp } from './drawOps'
import { encodeSheetImages } from './png'
import { sheetSvg, standaloneSheetSvg, SVG_MIDDLE_BASELINE_EM } from './renderSvg'
import {
  SHEET_FORMAT_INFO,
  SHEET_FORMATS,
  SHEET_PNG_DPI,
  SHEET_PNG_PIXELS_PER_POINT,
  sheetFile,
  withSheetExtension,
} from './sheetFormats'

const raster = {
  kind: 'rgba' as const,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]),
  width: 2,
  height: 1,
}
const ops: DrawOp[] = [
  {
    op: 'clip',
    parts: [
      [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
      ],
    ],
  },
  { op: 'image', x: 0, y: 0, w: 200, h: 100, image: raster },
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
  { op: 'restore' },
  { op: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#ffd37f', fillOpacity: 0.5, stroke: { color: '#000000', width: 1 } },
  {
    op: 'text',
    x: 10,
    y: 50,
    text: 'Block <A> & "B"\u0007',
    size: 8,
    color: '#000000',
    halo: { color: '#ffffff', width: 1 },
  },
  {
    op: 'text',
    x: 30,
    y: 60,
    text: "54°03'N",
    size: 6,
    family: 'times',
    style: 'italic',
    color: '#000000',
    baseline: 'middle',
    angle: 90,
  },
]
const sheet = { width: 200, height: 100, ops }

function parse(svg: string) {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw Error(message)
    },
  }).parseFromString(svg, 'image/svg+xml')
}

describe('sheet formats', () => {
  it('lists each format with its label, extension and MIME type', () => {
    expect(SHEET_FORMATS).toEqual(['pdf', 'svg', 'png'])
    expect(SHEET_FORMAT_INFO.pdf).toMatchObject({ extension: 'pdf', mime: 'application/pdf' })
    expect(SHEET_FORMAT_INFO.svg).toMatchObject({ extension: 'svg', mime: 'image/svg+xml' })
    expect(SHEET_FORMAT_INFO.png).toMatchObject({ extension: 'png', mime: 'image/png' })
    expect(SHEET_FORMAT_INFO.png.description).toContain(`${SHEET_PNG_DPI} dpi`)
    expect(SHEET_PNG_PIXELS_PER_POINT).toBeCloseTo(150 / 72)
    expect(withSheetExtension('block-7.pdf', 'svg')).toBe('block-7.svg')
    expect(withSheetExtension('series', 'zip')).toBe('series.zip')
  })

  it('writes a standalone SVG that parses, keeps text as text and embeds its rasters', async () => {
    const encoded = await encodeSheetImages(ops)
    const svg = standaloneSheetSvg(encoded, 200, 100, { title: 'Block 7' })
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true)
    const doc = parse(svg)
    const root = doc.documentElement!
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(root.getAttribute('width')).toBe('200pt')
    expect(root.getAttribute('height')).toBe('100pt')
    expect(root.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(root.getAttribute('xml:space')).toBe('preserve')
    expect(doc.getElementsByTagName('title')[0].textContent).toBe('Block 7')
    const texts = Array.from(doc.getElementsByTagName('text'))
    // Two for the haloed label (halo, then glyphs), one for the graticule label.
    expect(texts.map((node) => node.textContent)).toEqual(['Block <A> & "B"', 'Block <A> & "B"', "54°03'N"])
    const times = texts[2]
    expect(times.getAttribute('font-family')).toBe("'Times New Roman', Times, serif")
    expect(times.getAttribute('dominant-baseline')).toBeNull()
    expect(Number(times.getAttribute('y'))).toBeCloseTo(60 + 6 * SVG_MIDDLE_BASELINE_EM, 1)
    expect(times.getAttribute('transform')).toBe('rotate(-90 30 60)')
    const images = Array.from(doc.getElementsByTagName('image'))
    expect(images).toHaveLength(1)
    expect(images[0].getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toMatch(/^data:image\/png;base64,/)
    expect(doc.getElementsByTagName('path').length).toBeGreaterThan(0)
    expect(svg).not.toMatch(/var\(--|url\((?!#)|href="(?!data:)/)
  })

  it('refuses a raster that is not embedded', () => {
    expect(() => standaloneSheetSvg(ops, 200, 100)).toThrow(/not embedded/)
    const linked: DrawOp[] = [
      {
        op: 'image',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        image: { kind: 'url', url: 'https://example.com/a.png', format: 'PNG', width: 1, height: 1 },
      },
    ]
    expect(() => standaloneSheetSvg(linked, 1, 1)).toThrow(/not embedded/)
  })

  it('leaves the in-app preview as it was', () => {
    const svg = sheetSvg(ops, 200, 100)
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">'),
    ).toBe(true)
    expect(svg).toContain('dominant-baseline="central"')
    expect(svg).toContain('font-family="Times New Roman,Times,serif"')
    // An unencoded raster still shows as a grey box.
    expect(svg).toContain('fill="#e5e7eb"')
  })

  it('writes a PDF of the sheet size', async () => {
    const blob = await sheetFile(sheet, 'pdf', { jspdf: { jsPDF, GState } })
    expect(blob.type).toBe('application/pdf')
    const pdf = await PDFDocument.load(await blob.arrayBuffer())
    expect(pdf.getPageCount()).toBe(1)
    const { width, height } = pdf.getPage(0).getSize()
    expect([Math.round(width), Math.round(height)]).toEqual([200, 100])
  })

  it('lets a tool set the PDF up once, for brand fonts', async () => {
    const configurePdf = vi.fn(() => undefined)
    await sheetFile(sheet, 'pdf', { jspdf: { jsPDF, GState }, configurePdf })
    expect(configurePdf).toHaveBeenCalledTimes(1)
  })

  it('writes the SVG without jsPDF and the PNG through the rasteriser', async () => {
    const svg = await sheetFile(sheet, 'svg', {})
    expect(svg.type).toBe('image/svg+xml')
    parse(await svg.text())
    const rasterise = vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])]))
    const png = await sheetFile(sheet, 'png', { rasterise })
    expect(png.type).toBe('image/png')
    const [drawn, width, height, scale] = rasterise.mock.calls[0] as unknown as [string, number, number, number]
    expect(drawn).toContain('<?xml')
    expect([width, height, scale]).toEqual([200, 100, SHEET_PNG_PIXELS_PER_POINT])
    await expect(sheetFile(sheet, 'png', {})).rejects.toThrow(/rasteriser/)
    await expect(sheetFile(sheet, 'pdf', {})).rejects.toThrow(/jsPDF/)
  })
})
