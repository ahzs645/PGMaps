import { deflateSync } from 'node:zlib'

import * as kit from 'document-kit'
import { writeDocx } from 'document-kit/docx'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { isWide } from './html'
import { flatBlocks, type AssembledReport, type ReportBlock, type ReportFigure } from './model'
import type { ReportContext, ReportImages } from './parts'
import { assembleReport, assembleReportParts, REPORT_RECIPES } from './recipes'
import { reportDocument, reportDocx } from './word'

// Made-up cases only: no real VIA's case, block, licensee, place or figure.

/** A real RGB PNG, `w` × `h`: a sky over a green hill. */
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
    for (let x = 0; x < w; x++) {
      const hill = h * (0.55 + 0.15 * Math.sin((x + seed * 13) / (w / 6)))
      const px = y < hill ? [150 + ((x + seed) % 40), 190, 230] : [40 + ((x * 3) % 30), 110 + ((y * 5) % 40), 50]
      raw.set(px, y * (w * 3 + 1) + 1 + x * 3)
    }
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${file.toString('base64')}`
}

const SHEET_PNG = png(612, 396, 1)
const PHOTO_PNG = png(300, 200, 2)

const figure = (view: string, over: Partial<ReportFigure> = {}): ReportFigure => ({
  view,
  caption: `${view}: analysis`,
  dataUrl: PHOTO_PNG,
  width: 600,
  height: 450,
  ...over,
})
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
    map: {
      legend: [
        { label: 'Proposed block', color: '#ff0000' },
        { label: 'Road', color: '#333', kind: 'line' },
      ],
      scale: '1:50,000',
      northUp: true,
    },
  },
  regionalMap: figure('regional'),
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
  } as ReportContext
}

const recipe = (id: string) => REPORT_RECIPES.find((entry) => entry.id === id)!
const assembled = (id: string, over: Partial<ReportContext> = {}): AssembledReport =>
  assembleReport(recipe(id), context(recipe(id).format, over))

const SCALE: Extract<ReportBlock, { kind: 'scale' }> = {
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

const GRID: ReportBlock = {
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

const MATRIX: ReportBlock = {
  kind: 'matrix',
  title: 'Visual impact rating',
  rowHeader: 'Visibility',
  columnHeader: 'Scale',
  rows: ['Not visible', 'Partly visible', 'Fully visible'],
  columns: ['Small', 'Medium', 'Large'],
  cells: [
    ['Low', 'Low', 'Low'],
    ['Low', 'Moderate', 'High'],
    ['Moderate', 'High', 'High'],
  ],
  tint: [
    ['#0F783D', '#0F783D', '#0F783D'],
    ['#0F783D', '#BB892C', '#b91c1c'],
    ['#BB892C', '#b91c1c', '#b91c1c'],
  ],
  rowColors: ['#0F783D', '#BB892C', '#b91c1c'],
  marks: [{ row: 1, column: 1 }],
  markSource: 'reviewer',
  note: 'The marked cell is the reviewer’s reading.',
}

/** One of every block kind, in the order a report might print them. */
function everyKind(): ReportBlock[] {
  const slots = (a: string, b: string) => [
    {
      label: 'Before',
      figure: figure(a, {
        marks: [
          { x: 0.3, y: 0.6, label: 'X1', status: 'visible' },
          { x: 0.7, y: 0.6, label: 'X2', status: 'not visible' },
        ],
      }),
      placeholder: 'Before picture',
      markBlocks: 'all' as const,
    },
    { label: 'After', figure: figure(b), placeholder: 'After picture' },
  ]
  return [
    { kind: 'heading', level: 1, text: 'Made-up visual impact report' },
    {
      kind: 'fields',
      rows: [
        { label: 'Licence', value: 'A00000', source: 'scene' },
        { label: 'Prepared by', value: null, source: 'reviewer' },
      ],
    },
    { kind: 'heading', level: 2, text: 'Introduction' },
    {
      kind: 'paragraph',
      sentences: [
        { id: 'a', text: 'The block is seen from the lake.', source: 'run', missing: [], template: '' },
        { id: 'b', text: null, source: 'reviewer', missing: ['visibility'], template: 'It is {visibility}.' },
        { id: 'c', text: 'Its edges follow the terrain.', source: 'reviewer', missing: [], template: '' },
      ],
    },
    { kind: 'text', text: 'Fixed method text from the handbook.', source: 'fixed' },
    { kind: 'list', items: ['First item', 'Second item'], source: 'run' },
    { kind: 'list', items: ['Ordered one', 'Ordered two'], ordered: true, source: 'run' },
    {
      kind: 'table',
      title: 'Blocks',
      columns: ['Block', 'Area (ha)', 'System'],
      rows: [
        ['X1', '12.4', 'Clearcut'],
        ['X2', '', 'Partial cut'],
      ],
      note: 'Areas are planimetric.',
      source: 'run',
    },
    { kind: 'heading', level: 2, text: 'Ratings' },
    MATRIX,
    SCALE,
    { ...SCALE, title: 'Bar scale', style: 'bar', axisLabel: undefined },
    {
      ...SCALE,
      title: 'Guide',
      style: 'guide',
      bands: SCALE.bands.map((b, i) => ({
        ...b,
        name: ['Preservation', 'Retention', 'Partial retention'][i],
        range: ['0-1.5%', '1.5-7%', '7-30%'][i],
      })),
    },
    GRID,
    { kind: 'choices', label: 'Is the block visible?', options: ['Yes', 'No'], chosen: 'Yes', source: 'reviewer' },
    {
      kind: 'choices',
      label: 'Does it meet the objective?',
      options: ['Met', 'Not met'],
      chosen: null,
      source: 'reviewer',
      answer: null,
      boxed: true,
    },
    { kind: 'heading', level: 2, text: 'Form' },
    {
      kind: 'form',
      rows: [
        [
          {
            title: '3.2.1 Viewpoint',
            blocks: [
              {
                kind: 'fields',
                rows: [
                  { label: 'Name', value: 'Lakeshore', source: 'scene' },
                  { label: 'Distance', value: null, source: 'run' },
                ],
              },
            ],
          },
          { title: '3.2.2 Visual impact rating', blocks: [MATRIX] },
        ],
        [
          {
            title: '3.3 Rating',
            blocks: [
              {
                kind: 'choices',
                label: 'Rating',
                options: ['Good', 'Moderate', 'Poor'],
                chosen: 'Moderate',
                source: 'reviewer',
              },
              SCALE,
            ],
          },
        ],
      ],
    },
    { kind: 'heading', level: 2, text: 'Wide table' },
    {
      kind: 'table',
      title: 'Viewpoints',
      columns: ['Viewpoint', 'Landform', 'VQO', 'VAC', 'EVC', 'Distance', 'Sightline %', 'Pixel %', 'Rating'],
      rows: [
        ['Lakeshore', 'Landform 1', 'PR', 'M', 'R', '2.6 km', '3.1', '2.8', 'Met'],
        ['Ridge road', 'Landform 1', 'PR', 'M', 'R', '4.0 km', '', '1.2', ''],
      ],
      source: 'run',
    },
    { kind: 'text', text: 'Short text closing the wide table’s section.', source: 'run' },
    { kind: 'heading', level: 2, text: 'Figures' },
    { kind: 'figure', figure: figure('Lakeshore'), caption: 'Figure 1. View from Lakeshore' },
    { kind: 'figure', figure: null, caption: 'Figure 2', placeholder: 'Photograph from Ridge road to come' },
    { kind: 'figure', figure: figure('Odd', { dataUrl: 'data:image/webp;base64,AAAA' }), caption: 'Odd picture' },
    {
      kind: 'mapFigure',
      caption: 'Figure 3. Overview map',
      slot: {
        label: 'Map',
        placeholder: 'Map',
        figure: figure('overview', {
          map: {
            legend: [
              { label: 'Proposed block', color: '#ff0000' },
              { label: 'Road', color: '#333333', kind: 'line' },
              { label: 'Viewpoint', color: '#1d4ed8', kind: 'point' },
            ],
            scale: '1:50,000',
            northUp: true,
          },
        }),
      },
    },
    {
      kind: 'figureGrid',
      columns: 2,
      caption: 'Figure 4. Obliques',
      slots: [
        { label: 'Oblique 1', figure: figure('o1'), placeholder: '' },
        { label: 'Oblique 2', figure: null, placeholder: 'Oblique 2 to come' },
      ],
    },
    { kind: 'signature', lines: ['Signature', 'Name', 'Date'] },
    { kind: 'pageBreak' },
    {
      kind: 'figurePair',
      title: 'Lakeshore: existing and proposed',
      placement: 'inset',
      slots: slots('existing', 'proposed'),
    },
    {
      kind: 'figurePage',
      number: 'Figure 5',
      title: 'Visualization from Lakeshore',
      facts: [
        { label: 'Project', value: 'X1', source: 'scene' },
        { label: 'Date', value: null, source: 'reviewer' },
      ],
      side: [
        { label: 'Location map', figure: figure('location'), placeholder: 'Location map' },
        { label: 'Regional map', figure: null, placeholder: 'Regional map to come' },
      ],
      main: slots('before', 'after'),
    },
    {
      kind: 'figurePair',
      title: 'Perspective Viewpoint',
      placement: 'caption',
      sheet: true,
      slots: slots('sheet before', 'sheet after'),
    },
    {
      kind: 'figureGrid',
      columns: 2,
      caption: 'Figure 6. Landscape obliques',
      landscape: true,
      slots: [
        { label: 'A', figure: figure('a'), placeholder: '' },
        { label: 'B', figure: figure('b'), placeholder: '' },
      ],
    },
    { kind: 'heading', level: 3, text: 'Calculations' },
    { kind: 'figure', figure: sheet('Lakeshore'), caption: 'Analysis sheet: Lakeshore' },
    {
      kind: 'fields',
      rows: [
        { label: 'Landform (ha)', value: '1.00', source: 'run' },
        { label: 'Proposed (ha)', value: '0.03', source: 'run' },
        { label: 'Alteration', value: null, source: 'run' },
      ],
    },
    {
      kind: 'figure',
      figure: figure('Map sheet', {
        dataUrl: SHEET_PNG,
        width: 1224,
        height: 792,
        map: { northUp: true, inPicture: true },
      }),
      caption: 'Map sheet',
    },
  ]
}

const KIT = { imageInfo: kit.imageInfo, writeDocx }
const CREATED = '2026-11-16T00:00:00Z'

/** The Word file's parts, unzipped, as text. */
async function parts(report: AssembledReport, logo: { name: string; dataUrl: string } | null = null) {
  const bytes = await reportDocx(report, logo, KIT, { created: CREATED })
  const files = unzipSync(bytes)
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '')
  const footers = Object.keys(files)
    .filter((name) => /^word\/footer\d+\.xml$/.test(name))
    .map(text)
  const headers = Object.keys(files)
    .filter((name) => /^word\/header\d+\.xml$/.test(name))
    .map(text)
  const document = text('word/document.xml')
  return { bytes, files, document, footers, headers, words: words(document) }
}

const unescape = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
/** A part's printed text, its paragraphs one per line. */
const words = (xml: string) =>
  unescape(
    xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, '')
      .replace(/<[^>]+>/g, ''),
  )
/** Each section's page size and orientation, in reading order. */
const pageSizes = (xml: string) =>
  [...xml.matchAll(/<w:pgSz w:w="(\d+)" w:h="(\d+)"(?: w:orient="(\w+)")?/g)].map((m) => [
    Number(m[1]) / 20,
    Number(m[2]) / 20,
  ])

const reportOf = (blocks: ReportBlock[]): AssembledReport => ({ ...assembled('consultant-net-private'), blocks })

describe('the VIA report as a Word file', () => {
  it('writes every block kind', async () => {
    const report = reportOf(everyKind())
    const { document, words: all, files } = await parts(report, { name: 'Made-up logo', dataUrl: PHOTO_PNG })
    // Headings are Word's own, so the contents and the navigation pane read them; a form's stay out of them.
    expect(document).toMatch(/<w:pStyle w:val="Heading1"\/>[^]*?Introduction/)
    expect(document).not.toMatch(/<w:pStyle w:val="Heading\d"\/>(?:(?!<\/w:p>).)*3\.2\.1 Viewpoint/)
    // A paragraph prints its filled sentences; the unfilled one is left out, never printed with braces.
    expect(all).toContain('The block is seen from the lake. Its edges follow the terrain.')
    expect(all).not.toContain('{visibility}')
    for (const text of [
      'Fixed method text from the handbook.',
      'First item',
      'Ordered two',
      'Areas are planimetric.',
      'Licence',
      'A00000',
      'Prepared by',
      // The matrix, the scales and the grid.
      'Visual impact rating',
      'Moderate',
      '▼',
      '3.1%',
      '30+',
      '%alt:',
      'Preservation',
      '0-1.5%',
      'RETENTION',
      'X: the reading, at % removed 10 and residual height (m) between 25 and 30 (printed in the nearest cell).',
      // Choices, the form, the figures and their furniture.
      'Is the block visible?',
      'Does it meet the objective?',
      '3.2.1 Viewpoint',
      '3.3 Rating',
      'Figure 1. View from Lakeshore',
      'Photograph from Ridge road to come',
      'Odd: analysis: the picture is not a PNG or JPEG and is not embedded.',
      '1:50,000',
      'North up',
      'Figure 4. Obliques',
      'Oblique 2 to come',
      'Signature',
      'Lakeshore: existing and proposed',
      'Blocks in this view, left to right: X1 (seen); X2 (not visible).',
      'Figure 5',
      'Visualization from Lakeshore',
      'BEFORE',
      'Regional map to come',
      'Figure 6. Landscape obliques',
      'Analysis sheet: Lakeshore',
      'Landform (ha)',
    ])
      expect(all, text).toContain(text)
    // The pictures, the logo and the three tick boxes are embedded once each.
    const media = Object.keys(files).filter((name) => name.startsWith('word/media/'))
    expect(media).toHaveLength(5)
    expect((document.match(/<w:drawing>/g) ?? []).length).toBeGreaterThan(15)
    // A page break and the pages its kinds take.
    expect(document).toContain('<w:pageBreakBefore/>')
  })

  it('marks the matrix’s marked cell, the scale’s reading and the blank values', async () => {
    const { document } = await parts(reportOf([{ kind: 'heading', level: 1, text: 'T' }, MATRIX, SCALE]))
    // The marked cell: shaded, ruled in red, its value bold, its tick drawn before it.
    const cell = /<w:tc>(?:(?!<\/w:tc>).)*Moderate(?:(?!<\/w:tc>).)*<\/w:tc>/s.exec(document)?.[0] ?? ''
    expect(cell).toContain('w:fill="FDF2F2"')
    expect(cell).toMatch(/<w:top w:val="single" w:color="B91C1C"/)
    expect(cell).toContain('<w:b/>')
    expect(cell).toContain('<w:drawing>')
    // Exactly one marked cell.
    expect(document.match(/w:fill="FDF2F2"/g)).toHaveLength(1)
    // The reading: ▼ in its own column, its label in the mark's red.
    expect(document).toMatch(/<w:color w:val="B91C1C"\/>(?:(?!<\/w:r>).)*<w:t[^>]*>▼<\/w:t>/s)
    const blanks = await parts(reportOf([{ kind: 'heading', level: 1, text: 'T' }, ...everyKind().slice(1, 2)]))
    // A value nobody gave prints as a rule to fill by hand.
    expect(blanks.document).toMatch(/<w:u w:val="single"\/>(?:(?!<\/w:r>).)*<w:t xml:space="preserve">\u00a0{4,}/s)
  })

  it('puts wide tables on landscape pages and analysis sheets on 11 x 17 landscape pages', async () => {
    const report = reportOf(everyKind())
    const { document } = await parts(report)
    const sizes = pageSizes(document)
    expect(sizes[0]).toEqual([612, 792])
    // A wide table on letter landscape, a figure page on letter landscape, sheets on 11 x 17 landscape.
    expect(everyKind().some(isWide)).toBe(true)
    expect(sizes).toContainEqual([792, 612])
    expect(sizes).toContainEqual([1224, 792])
    expect(document).toMatch(/<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/)
    expect(document).toMatch(/<w:pgSz w:w="24480" w:h="15840" w:orient="landscape"\/>/)
    // The legal paper of Appendix 1's recipe.
    const legal = await parts(assembled('appendix-1-report'))
    expect(legal.document).toMatch(/<w:pgSz w:w="12240" w:h="20160" w:orient="portrait"\/>/)
    expect(legal.document).toMatch(/<w:pgSz w:w="24480" w:h="15840" w:orient="landscape"\/>/)
  })

  it('opens with a cover and contents when the recipe asks, and ends on the to-complete list and the last line', async () => {
    const report = assembled('consultant-net-private')
    expect(report.layout).toMatchObject({ cover: true, contents: true })
    const { document, words: all, footers, headers } = await parts(report)
    // The cover is centred on its own page, with no header or footer.
    expect(document).toMatch(/<w:vAlign w:val="center"\/>/)
    expect(all.indexOf('Logo (your own)')).toBeLessThan(all.indexOf('Contents'))
    // Word's table of contents over the sections, and the pictures listed under it.
    expect(document).toContain('TOC \\h \\o &quot;1-1&quot;')
    expect(all).toMatch(/Images\n/)
    // The reviewer's list, by part, and the report's last line after it.
    expect(all).toContain('To complete before signing')
    for (const item of report.toComplete.slice(0, 3)) expect(all).toContain(item.what)
    expect(all.indexOf('To complete before signing', all.indexOf('Contents') + 40)).toBeLessThan(
      all.indexOf(report.footer),
    )
    // Page n of N in the footers, the running header in the headers.
    expect(footers.some((xml) => /PAGE/.test(xml) && /NUMPAGES/.test(xml))).toBe(true)
    expect(headers.some((xml) => words(xml).includes('Visual Impact Assessment · A00000 CP 1'))).toBe(true)
  })

  it('writes every recipe, every heading in it', async () => {
    for (const entry of REPORT_RECIPES) {
      const report = assembled(entry.id)
      const { words: all } = await parts(report)
      for (const block of flatBlocks(report.blocks))
        if (block.kind === 'heading' && block.level > 1 && block.text.trim())
          expect(all, `${entry.id}: ${block.text}`).toContain(block.text)
      expect(all, entry.id).toContain(report.footer)
    }
  })

  it('prints the reviewer’s hand edits as the reviewer’s and counts them in the last line', async () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'consultant-net-private')!
    const ctx = context(recipe.format)
    const first = assembleReportParts(recipe, ctx)
    const target = first.edits.targets.find((t) => t.kind === 'field' && t.original === null)!
    const text = first.edits.targets.find((t) => t.kind === 'paragraph' && t.original)!
    const edits = { [target.key]: 'Made-up reviewer value', [text.key]: 'A made-up paragraph the reviewer wrote.' }
    const { report } = assembleReportParts(recipe, ctx, edits)
    expect(report.footer).toContain('2 values changed by hand by the reviewer')
    const document = await reportDocument(report, null, KIT)
    // The edited values carry the reviewer as their source.
    const runs: Array<{ text?: string; source?: string }> = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        const v = value as { type?: string; text?: string; source?: string }
        if (v.type === 'text') runs.push(v)
        Object.values(value).forEach(walk)
      }
    }
    walk(document.sections)
    expect(runs.find((r) => r.text === 'Made-up reviewer value')?.source).toBe('reviewer')
    expect(runs.find((r) => r.text === 'A made-up paragraph the reviewer wrote.')?.source).toBe('reviewer')
    const { words: all } = await parts(report)
    expect(all).toContain('Made-up reviewer value')
    expect(all).toContain('A made-up paragraph the reviewer wrote.')
    expect(all).not.toContain(text.original!)
    expect(all).toContain('2 values changed by hand by the reviewer')
    // An edit marks nothing in the file beyond its source: no draft tint reaches it.
    expect(all).not.toContain('data-edit')
  })

  it('writes the same bytes for the same report', async () => {
    const report = reportOf(everyKind())
    const a = await reportDocx(report, null, KIT, { created: CREATED })
    const b = await reportDocx(report, null, KIT, { created: CREATED })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})
