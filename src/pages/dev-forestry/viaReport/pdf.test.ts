import { deflateSync } from 'node:zlib'

import * as jspdf from 'jspdf'
import { describe, expect, it } from 'vitest'

import { pdfText, pdfTextUnfolded } from '@/lib/mapSheet/renderPdf'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { flatBlocks, type AssembledReport, type ReportBlock, type ReportFigure } from './model'
import type { ReportContext, ReportImages } from './parts'
import { cssColor, reportPdf } from './pdf'
import { assembleReport, REPORT_RECIPES, withViewsLeftOut } from './recipes'

/** A real RGB PNG, `w` × `h`, so jsPDF decodes and embeds it. */
function png(w: number, h: number, seed = 0): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set([(x * 9 + seed) & 255, (y * 7) & 255, 120], y * (w * 3 + 1) + 1 + x * 3)
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${file.toString('base64')}`
}

/** A 1 × 1 baseline JPEG. */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

const SHEET_PNG = png(153, 99, 1)
const PHOTO_PNG = png(60, 40, 2)

const figure = (view: string, over: Partial<ReportFigure> = {}): ReportFigure => ({
  view,
  caption: `${view}: analysis`,
  dataUrl: PHOTO_PNG,
  width: 600,
  height: 400,
  ...over,
})
/** An 11 × 17 analysis sheet's shape (`isSheet`). */
const sheet = (view: string) => figure(view, { dataUrl: SHEET_PNG, width: 1224, height: 792 })

const viewpoint = (name: string): DocumentFacts['viewpoints'][number] => ({
  name,
  landform: 'Landform 1',
  objective: 'PR',
  inventory: { vsu: '12', vsc: '2', vac: 'M', evc: 'R', vqo: 'PR' },
  areas: { landform: 10000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 500 },
  sightlinePercent: 3.1,
  distanceKm: 2.6,
  hfovDeg: 39.6,
  lensMm: 50,
  lngLat: [-122.5, 53.9],
  blocks: [
    { id: 'X1', status: 'visible', visiblePercent: 40 },
    { id: 'X2', status: 'not visible', visiblePercent: 0 },
  ],
})

const images = (names: string[]): ReportImages => ({
  overviewMap: {
    ...figure('overview'),
    map: { legend: [{ label: 'Proposed block', color: '#ff0000' }], scale: '1:50,000', northUp: true },
  },
  regionalMap: figure('regional', { dataUrl: JPEG, width: 300, height: 300 }),
  locationMaps: Object.fromEntries(names.map((name) => [name, figure(`location ${name}`)])),
  before: Object.fromEntries(
    names.map((name, i) => [name, { ...figure(`before ${name}`), source: i ? 'render' : 'photo' }]),
  ),
  overhead: [figure('overhead'), figure('oblique 1'), figure('oblique 2')],
})

function context(formatId: string, over: Partial<ReportContext> = {}): ReportContext {
  const names = ['Lakeshore', 'Ridge road']
  const facts: DocumentFacts = { project: 'Block X1', viewpoints: names.map(viewpoint) }
  return {
    date: new Date('2026-11-16T12:00:00Z'),
    office: { licence: 'A00000', cuttingPermit: '1' },
    blocks: [
      { name: 'X1', areaHa: 12.4, system: 'Clearcut', retentionPercent: null, partialCut: null },
      {
        name: 'X2',
        areaHa: 8,
        system: 'Partial cut',
        retentionPercent: null,
        partialCut: { removedPercent: 40, residualHeightM: 25 },
      },
    ],
    landform: { name: 'Landform 1', objective: 'PR', vac: 'M', areaHa: 410, source: 'drawn in step 1' },
    inventory: facts.viewpoints[0].inventory ?? null,
    inventoryRead: true,
    facts,
    document: resolveViaDocument(findDocumentFormat(formatId)!, facts),
    assessment: null,
    review: null,
    breakdown: null,
    method: { terrain: 'AWS Open Data terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
    measures: [],
    figures: names.map((name) => sheet(name)),
    images: images(names),
    ...over,
  }
}

const recipe = (id: string) => REPORT_RECIPES.find((entry) => entry.id === id)!
const assembled = (id: string, over: Partial<ReportContext> = {}) =>
  assembleReport(recipe(id), context(recipe(id).format, over))

/** The file's bytes as text: jsPDF writes uncompressed streams when asked, Latin-1 strings in `( ) Tj`. */
const raw = (report: AssembledReport, logo: Parameters<typeof reportPdf>[1] = null) =>
  new TextDecoder('latin1').decode(new Uint8Array(reportPdf(report, logo, jspdf, { compress: false })))

/** Each page's size, points, in page order. */
const pageSizes = (text: string) =>
  [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])])

/** Every string drawn, in drawing order. */
const drawn = (text: string) =>
  [...text.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1'))

/** Drawn text with its spacing removed, for finding a wrapped string. */
const squeezed = (text: string) => drawn(text).join('').replace(/\s+/g, '')
const squeeze = (value: string) => pdfText(value).replace(/\s+/g, '')

/** Every string a report holds, for the fold check. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (!value.startsWith('data:')) out.push(value)
  } else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

const headings = (report: AssembledReport) =>
  flatBlocks(report.blocks).flatMap((b) => (b.kind === 'heading' && b.level > 1 ? [b.text] : []))

describe('the VIA report as a PDF', () => {
  it('writes every recipe, every heading in it, with "Page n of N" on its pages', () => {
    for (const entry of REPORT_RECIPES) {
      const report = withViewsLeftOut(assembled(entry.id), [{ name: 'Viewpoint 3', reason: 'not captured' }])
      const text = raw(report)
      expect(text.startsWith('%PDF'), entry.id).toBe(true)
      const pages = pageSizes(text)
      expect(pages.length, entry.id).toBeGreaterThan(1)
      const all = squeezed(text)
      for (const h of headings(report)) expect(all, `${entry.id}: ${h}`).toContain(squeeze(h))
      // A cover prints no page number; the page after it is page 2.
      expect(drawn(text), entry.id).toContain(`Page ${report.layout.cover ? 2 : 1} of ${pages.length}`)
      const numbers = drawn(text).filter((w) => /^Page \d+ of \d+$/.test(w))
      expect(
        numbers.every((w) => w.endsWith(` of ${pages.length}`)),
        entry.id,
      ).toBe(true)
      // The views left out are named, and the reviewer's list is printed.
      expect(all, entry.id).toContain(squeeze('Viewpoint 3: not captured.'))
      expect(all, entry.id).toContain(squeeze('To complete before signing'))
      // The report says nothing of itself on its face: no credit or disclaimer line, and no logo stand-in.
      expect(report.footer, entry.id).toBe('')
      expect(all, entry.id).not.toContain(squeeze('not a field-verified simulation'))
      expect(all, entry.id).not.toContain(squeeze('Logo (your own)'))
    }
  })

  it('holds no character the standard fonts cannot print', () => {
    for (const entry of REPORT_RECIPES) {
      const report = assembled(entry.id)
      expect(strings(report).flatMap(pdfTextUnfolded), entry.id).toEqual([])
      // And nothing drawn is outside WinAnsi's printable range.
      expect(
        drawn(raw(report))
          .join('')
          .match(/[^\x20-\x7e°±×é]/g) ?? [],
        entry.id,
      ).toEqual([])
    }
  })

  it('prints on legal paper with each analysis sheet on its own 11 x 17 landscape page', () => {
    const report = assembled('appendix-1-report')
    expect(report.layout.paper).toBe('legal')
    const pages = pageSizes(raw(report))
    expect(pages[0]).toEqual([612, 1008])
    expect(pages).toContainEqual([1224, 792])
    expect(pages.filter(([w, h]) => w === 612 && h === 1008).length).toBeGreaterThan(1)
  })

  it('puts a wide table on a landscape page, and draws its matrices and scales', () => {
    const report = assembled('consultant-net-private')
    const blocks = flatBlocks(report.blocks)
    const wide = blocks.find((b) => b.kind === 'table' && b.columns.length > 7)
    expect(wide).toBeDefined()
    const text = raw(report)
    expect(pageSizes(text)).toContainEqual([792, 612])
    const all = squeezed(text)
    // The wide table's header row, and its title.
    if (wide?.kind === 'table') for (const column of wide.columns) expect(all).toContain(squeeze(column))
    const matrices = REPORT_RECIPES.flatMap((entry) =>
      flatBlocks(assembled(entry.id).blocks).filter((b) => b.kind === 'matrix' || b.kind === 'scale'),
    )
    expect(matrices.some((b) => b.kind === 'matrix')).toBe(true)
    expect(matrices.some((b) => b.kind === 'scale')).toBe(true)
    // A scale and a class grid drawn on their own, with their readings: labels, ticks, the X.
    const scale: ReportBlock = {
      kind: 'scale',
      title: 'Existing visual condition',
      style: 'arrow-axis',
      bands: [
        { from: 0, to: 1.5, label: 'P', color: '#0F783D' },
        { from: 1.5, to: 7, label: 'R', color: '#699E3B' },
        { from: 7, to: 30, label: 'PR', color: '#BB892C' },
      ],
      ticks: [
        { at: 0, label: '0' },
        { at: 1.5, label: '1.5' },
        { at: 7, label: '7' },
        { at: 30, label: '30+' },
      ],
      mark: 3.1,
      markLabel: '3.1%',
      markBand: 1,
      axisLabel: '%alt:',
    }
    const grid: ReportBlock = {
      kind: 'matrix',
      title: 'Partial cut guide',
      style: 'class-grid',
      rowHeader: '% removed',
      columnHeader: 'Residual height (m)',
      rows: ['10', '20'],
      columns: ['20', '25', '30'],
      cells: [
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
      letters: [
        ['R', 'R', 'PR'],
        ['PR', 'PR', 'M'],
      ],
      tint: [
        ['#699E3B', '#699E3B', '#BB892C'],
        ['#BB892C', '#BB892C', '#908B2E'],
      ],
      marks: [{ row: 0, column: 1 }],
      point: { row: 0, column: 1.5 },
      legend: { title: 'Harvest type', items: [{ label: 'Retention', color: '#699E3B' }] },
    }
    const own = raw({ ...report, blocks: [report.blocks[0], scale, grid, { ...scale, style: 'guide' }] })
    const words = drawn(own)
    for (const word of ['P', 'R', 'PR', '1.5', '30+', '%alt:', '3.1%', 'X', 'M', 'HARVEST TYPE', 'RETENTION'])
      expect(words.map((w) => w.toUpperCase())).toContain(word.toUpperCase())
  })

  it('prints a missing picture’s placeholder, and says when a picture is not one it can embed', () => {
    const report = assembled('form-2001-sheets')
    const blocks: ReportBlock[] = [
      report.blocks[0],
      { kind: 'heading', level: 2, text: 'Figures' },
      { kind: 'figure', figure: null, caption: 'Figure 1', placeholder: 'Photograph from Lakeshore to come' },
      { kind: 'figure', figure: figure('Odd', { dataUrl: 'data:image/webp;base64,AAAA' }), caption: 'Odd picture' },
      {
        kind: 'figurePair',
        placement: 'inset',
        slots: [
          { label: 'Existing', figure: null, placeholder: 'The field photograph goes here' },
          { label: 'Proposed', figure: figure('Lakeshore'), placeholder: 'Simulation' },
        ],
      },
    ]
    const all = squeezed(raw({ ...report, blocks }))
    expect(all).toContain(squeeze('Photograph from Lakeshore to come'))
    expect(all).toContain(squeeze('The field photograph goes here'))
    expect(all).toContain(squeeze('Odd: analysis: the picture is not a PNG or JPEG and is not embedded.'))
  })

  it('lays out the figure layouts on their own pages: figure pages, sheets, map sheets and landscape grids', () => {
    const report = assembled('ea-visual-memo')
    const blocks = flatBlocks(report.blocks)
    expect(blocks.some((b) => b.kind === 'figurePage')).toBe(true)
    const pages = pageSizes(raw(report))
    // Figure pages are letter landscape whatever the paper.
    expect(pages).toContainEqual([792, 612])
    const slots = [
      { label: 'Before', figure: figure('before'), placeholder: '' },
      { label: 'After', figure: figure('after', { dataUrl: JPEG }), placeholder: '' },
    ]
    const own = (extra: ReportBlock[]) => pageSizes(raw({ ...report, blocks: [report.blocks[0], ...extra] }))
    expect(own([{ kind: 'figurePair', placement: 'caption', slots, sheet: true }])).toContainEqual([1224, 792])
    expect(own([{ kind: 'figureGrid', slots, columns: 2, caption: 'Obliques', landscape: true }])).toContainEqual([
      792, 612,
    ])
    const map = { legend: [{ label: 'Block', color: '#f00' }], northUp: true }
    // A map at the sheet's shape prints full-size on 11 x 17; the portrait end map on 11 x 17 portrait.
    expect(
      own([{ kind: 'figure', caption: 'Map', figure: figure('map', { width: 1224, height: 792, map }) }]),
    ).toContainEqual([1224, 792])
    expect(
      own([{ kind: 'figure', caption: 'End map', figure: figure('end', { width: 792, height: 1224, map }) }]),
    ).toContainEqual([792, 1224])
  })

  it('embeds a picture once however often it prints, and keeps the file small', () => {
    const report = assembled('form-2001-photos')
    const twice: ReportBlock[] = [
      report.blocks[0],
      { kind: 'figure', figure: figure('A'), caption: 'A' },
      { kind: 'figure', figure: figure('B'), caption: 'B' },
      { kind: 'mapFigure', caption: 'Overview', slot: { label: 'Map', figure: figure('C'), placeholder: '' } },
    ]
    const text = raw({ ...report, blocks: twice })
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(1)
    const compressed = reportPdf(report, null, jspdf)
    expect(compressed.byteLength).toBeLessThan(raw(report).length)
    expect(compressed.byteLength).toBeLessThan(400_000)
  })

  it('opens with a cover and a contents page that gives each section’s page', () => {
    const report = assembled('consultant-net-private')
    expect(report.layout).toMatchObject({ cover: true, contents: true })
    const text = raw(report, { name: 'Our logo', dataUrl: PHOTO_PNG })
    const words = drawn(text)
    const at = words.indexOf('Contents')
    expect(at).toBeGreaterThan(0)
    const sections = report.blocks.flatMap((b) => (b.kind === 'heading' && b.level === 2 ? [b.text] : []))
    expect(words.slice(at).join('').replace(/\s+/g, '')).toContain(squeeze(sections[0]))
    // Page numbers are written into the contents and linked to their pages.
    expect(text).toMatch(/\/Subtype \/Link/)
    const numbers = words
      .slice(at)
      .filter((w) => /^\d+$/.test(w))
      .map(Number)
    expect(numbers.length).toBeGreaterThan(2)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(pageSizes(text).length)
    // The cover prints no header or page number; the logo is embedded.
    expect(text).toMatch(/\/Subtype \/Image/)
  })

  it('reads CSS colours the matrices use', () => {
    expect(cssColor('#BB892C')).toEqual([187, 137, 44])
    expect(cssColor('#f00')).toEqual([255, 0, 0])
    expect(cssColor('rgba(0, 0, 0, 0.5)')).toEqual([128, 128, 128])
    expect(cssColor('#00000080')).toEqual([127, 127, 127])
  })
})
