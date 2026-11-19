/**
 * An assembled VIA report as a Word file, through document-kit (`vendor/document-kit`): the same `AssembledReport` the
 * PDF (`pdf.ts`) and the printable HTML (`html.ts`) draw, on the same pages by the same rules, read from their own
 * helpers (`bodyParts`, `completeAt`, `pageSpec`, `isWide`, `isSheet`, `imageLabel`, `scaleGeometry`, `untitled`) so
 * a rule changed there changes here. Each page kind is a Word section: the paper portrait with the running header and
 * "Page n of N", wide tables on landscape pages, analysis sheets on 11 × 17 landscape pages, map sheets full size,
 * figure pages on letter landscape, a cover centred on its own page and a table of contents Word fills.
 *
 * What Word cannot draw is given its nearest honest form, never left out: a scale is a table of its bands with the
 * reading marked in its own column (the bands' widths are `scaleGeometry`'s); the alteration guide's X is printed in
 * the cell nearest its point and its place stated under the grid; tick boxes and the marked cell's tick are small
 * pictures made here (`encodePng`); a map's north arrow is a line in its key; block marks and a panorama's band are
 * named under the picture, which prints whole; an inset label prints over its picture. A value nobody gave prints as
 * a blank rule. The reviewer's hand edits are already in the report: their values carry the reviewer as their source
 * and the report's last line counts them, as the PDF prints it.
 *
 * The kit is passed in (`WordKit`) and its types imported alone, so this module stays cheap until a Word file is
 * asked for. No DOM or network access.
 */
import type {
  Block,
  Border,
  CellInput,
  Document,
  ImageData,
  Inline,
  PageSetup,
  ParagraphBlock,
  RichText,
  Section,
  TableBlock,
  TableCell,
  TableRow,
  TextRun,
  TextStyle,
  ThemeInput,
} from 'document-kit'
import type { WriteDocxOptions } from 'document-kit/docx'

import { encodePng } from '@/lib/mapSheet/png'
import { textWidth } from '@/lib/mapSheet/textMetrics'

import { UNSEEN_STATUS } from './blockMarks'
import { imageLabel, isPortraitSheet, isSheet, isWide, untitled, type ReportLogo } from './html'
import { scaleGeometry } from './htmlScales'
import type { AssembledReport, FieldRow, FigureSlot, FormCell, Provenance, ReportBlock, ReportFigure } from './model'
import {
  bodyParts,
  completeAt,
  cssColor,
  mix,
  pageSpec,
  runningHeader,
  unreadable,
  type PageKind,
  type Part,
} from './pdf'

/** What this module takes from document-kit: its picture header reader and its Word writer. */
export interface WordKit {
  imageInfo(bytes: Uint8Array): { format: 'png' | 'jpeg'; width: number; height: number } | null
  writeDocx(document: Document, options?: WriteDocxOptions): Promise<Uint8Array>
}

export interface WordReportOptions {
  /** ISO 8601: the file's creation time. With it the same report always writes the same bytes. */
  created?: string
}

type Kind<K extends ReportBlock['kind']> = Extract<ReportBlock, { kind: K }>
type RGB = readonly [number, number, number]

// The PDF's colours (`pdf.ts`), as Word takes them.
const INK = '1a2530'
const MARK = 'b91c1c'
const GREY = '64748b'
const MUTED = '475569'
const RULE = 'cbd5e1'
const DASH = '94a3b8'
const BAR = '167aca'
const PANEL = 'e6e7e8'
const BLACK = '000000'
const WHITE = 'ffffff'

const PX = 0.75
const IN = 72

/** Type sizes and spacing of a flow, as the PDF's `Style`s set them. */
interface Look {
  body: number
  table: number
  note: number
  h4: number
  pad: number
  compact: boolean
}
const NORMAL: Look = { body: 9.5, table: 9, note: 8, h4: 10, pad: 3, compact: false }
/** Inside a form's sections. */
const COMPACT: Look = { body: 7.9, table: 7.5, note: 6.8, h4: 7.9, pad: 1.5, compact: true }
/** A table on a landscape page. */
const WIDE: Look = { ...NORMAL, table: 6.75, pad: 2 }

/** Where a block is drawn: its look, the width it has and the height a page gives. */
interface Flow {
  look: Look
  width: number
  height: number
}

const hexOf = (rgb: RGB) => rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
/** A CSS colour as six hex digits, ink when it cannot be read. */
const colour = (value: string | null | undefined, fallback: RGB = [0x1f, 0x29, 0x37]) =>
  hexOf(cssColor(value, fallback))
const tint = (value: string | null | undefined, alpha: number, fallback?: RGB) =>
  hexOf(mix(cssColor(value, fallback), alpha))

const run = (text: string, style: TextStyle & { source?: Provenance } = {}): TextRun => ({
  ...style,
  type: 'text',
  text,
})
const line = (width = 0.75, color = RULE, style: 'single' | 'dashed' = 'single'): Border => ({ style, width, color })
const NONE: Border = { style: 'none' }
const box = (border: Border) => ({ top: border, bottom: border, left: border, right: border })
const ALL_NONE = { ...box(NONE), insideHorizontal: NONE, insideVertical: NONE }

function paragraph(content: RichText, o: Omit<ParagraphBlock, 'type' | 'content'> = {}): ParagraphBlock {
  return { type: 'paragraph', content, ...o }
}

/** Small lines under a picture: a note, a label, a caption. */
const small = (text: string, size: number, o: { bold?: boolean; color?: string; align?: 'left' | 'center' } = {}) =>
  paragraph(run(text, { size, bold: o.bold, color: o.color ?? MUTED }), {
    align: o.align,
    spacing: { before: 2, after: 2, line: 1 },
  })

// ---------------------------------------------------------------------------------------------------------------------
// Pictures

/** The pictures of a report decoded once each from their data URLs, and the drawn tick boxes. */
class Pictures {
  private cache = new Map<string, ImageData | null>()
  constructor(
    private kit: Pick<WordKit, 'imageInfo'>,
    readonly ticks: { empty: ImageData; crossed: ImageData; marked: ImageData },
  ) {}

  /** A PNG or JPEG data URL as the kit takes it; null for anything else, or bytes that do not read. */
  get(url: string): ImageData | null {
    if (this.cache.has(url)) return this.cache.get(url) ?? null
    let image: ImageData | null = null
    const m = /^data:image\/(png|jpe?g);base64,/i.exec(url)
    if (m) {
      try {
        const bytes = base64Bytes(url.slice(m[0].length))
        const info = this.kit.imageInfo(bytes)
        if (info) image = { bytes, format: info.format, width: info.width, height: info.height }
      } catch {
        image = null
      }
    }
    this.cache.set(url, image)
    return image
  }
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * A tick box, crossed when chosen (the PDF's `tickBox`), or the marked cell's red box with its check (`check`), drawn
 * at `px` pixels: the bundled fonts have no ballot box or check glyph, so Word and its layout both draw these.
 */
async function tickPicture(kind: 'empty' | 'crossed' | 'marked', px = 36): Promise<ImageData> {
  const rgba = new Uint8ClampedArray(px * px * 4)
  const [r, g, b] = kind === 'marked' ? [0xb9, 0x1c, 0x1c] : [0x1a, 0x25, 0x30]
  const s = px / 10
  const segments: Array<[number, number, number, number, number]> = []
  const edge = 0.6 * s
  // The box: four sides.
  const lo = edge,
    hi = px - edge
  const w = kind === 'marked' ? 1.1 * s * 0.9 : 0.8 * s
  segments.push([lo, lo, hi, lo, w], [hi, lo, hi, hi, w], [hi, hi, lo, hi, w], [lo, hi, lo, lo, w])
  if (kind === 'crossed') {
    const i = px * 0.25
    segments.push([i, i, px - i, px - i, 1.1 * s], [px - i, i, i, px - i, 1.1 * s])
  } else if (kind === 'marked') {
    const p = (x: number, y: number): [number, number] => [px * (0.08 + x * 0.84), px * (0.08 + y * 0.84)]
    const [a, bb, c] = [p(0.18, 0.52), p(0.42, 0.76), p(0.84, 0.24)]
    segments.push([...a, ...bb, 1.4 * s], [...bb, ...c, 1.4 * s])
  }
  for (let y = 0; y < px; y++)
    for (let x = 0; x < px; x++) {
      const cx = x + 0.5,
        cy = y + 0.5
      let cover = 0
      for (const [x1, y1, x2, y2, width] of segments) {
        const dx = x2 - x1,
          dy = y2 - y1
        const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / (dx * dx + dy * dy || 1)))
        const d = Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy))
        cover = Math.max(cover, Math.min(1, Math.max(0, width / 2 + 0.5 - d)))
      }
      const at = (y * px + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = Math.round(cover * 255)
    }
  return { bytes: await encodePng(rgba, px, px), format: 'png', width: px, height: px }
}

const tickRun = (image: ImageData, size: number): Inline => ({
  type: 'image',
  image,
  width: size * 0.8,
  height: size * 0.8,
  alt: 'tick box',
})

/**
 * A dashed box saying what goes where a picture is missing (a place only a draft's report holds; the Word file is never
 * the draft), or why a picture that is there could not be printed.
 */
function emptyBox(text: string, width: number, height: number, flow: Flow, size = 8.25): TableBlock {
  return {
    type: 'table',
    width: Math.min(100, (width / flow.width) * 100),
    align: 'center',
    borders: { ...box(line(0.75, DASH, 'dashed')), insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      {
        height: Math.max(18, height),
        cantSplit: true,
        cells: [
          {
            content: run(text, { size, color: GREY }),
            align: 'center',
            verticalAlign: 'center',
          },
        ],
      },
    ],
  }
}

/**
 * A picture fitted into `w` × `h` points, or the box saying why it is not printed. The panorama band and the block
 * marks the PDF draws over a picture are not drawn: the picture prints whole and the blocks are named under it.
 */
function picture(
  figure: ReportFigure,
  w: number,
  h: number,
  flow: Flow,
  pics: Pictures,
  align: 'left' | 'center' = 'center',
): Block {
  const image = pics.get(figure.dataUrl)
  if (!image) return emptyBox(unreadable(figure), w, h, flow)
  return {
    type: 'figure',
    image,
    fit: { width: Math.min(w, flow.width), height: h, upscale: true },
    align,
    alt: figure.caption || figure.view,
  }
}

/** The blocks a slot's marks name, left to right, under its picture (the PDF rings or arrows them in the picture). */
function markNames(slot: FigureSlot): string | null {
  const figure = slot.figure
  if (!figure?.marks?.length || !slot.markBlocks) return null
  const shown = figure.marks
    .filter((m) => slot.markBlocks === 'all' || UNSEEN_STATUS[m.status])
    .sort((a, b) => a.x - b.x)
    .map((m) => `${m.label} (${UNSEEN_STATUS[m.status] ?? 'seen'})`)
  return shown.length ? `Blocks in this view, left to right: ${shown.join('; ')}.` : null
}

const aspectOf = (figure: ReportFigure) =>
  figure.width > 0 && figure.height > 0 ? figure.width / figure.height : 4 / 3

/** A slot's picture size when fitted (`fitted` in the PDF): `maxW` wide at most, its picture's shape. */
function fitted(slot: FigureSlot, maxW: number, emptyH: number, availW: number) {
  if (!slot.figure) return { w: availW, h: emptyH }
  const ar = aspectOf(slot.figure)
  const w = Math.min(availW, maxW * ar)
  return { w, h: w / ar }
}

/** A slot's picture (its inset label printed over it), the blocks it names and its note. */
function slotBlocks(
  slot: FigureSlot,
  w: number,
  h: number,
  flow: Flow,
  pics: Pictures,
  o: { inset?: boolean; align?: 'left' | 'center' } = {},
): Block[] {
  const align = o.align ?? 'center'
  if (!slot.figure) return [emptyBox(slot.placeholder, w, h, flow)]
  const marks = markNames(slot)
  return [
    ...(o.inset ? [small(slot.label, 9.75, { color: BLACK, align })] : []),
    picture(slot.figure, w, h, flow, pics, align),
    ...(marks ? [small(marks, 6.75, { align })] : []),
    ...(slot.note ? [small(slot.note, 6.75, { align })] : []),
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables

/** Column widths by their text, as the PDF's `columnWidths` sizes them (content measured in Helvetica's advances). */
function columnShares(rows: ReadonlyArray<readonly string[]>, n: number, avail: number, size: number, pad: number) {
  const max = new Array<number>(n).fill(0)
  const min = new Array<number>(n).fill(0)
  for (const row of rows)
    for (let c = 0; c < n; c++) {
      const text = row[c] ?? ''
      const longest = Math.max(0, ...text.split('\n').map((l) => textWidth(l, size)))
      const word = Math.max(0, ...text.split(/\s+/).map((w) => textWidth(w, size)))
      max[c] = Math.max(max[c], Math.min(avail, longest + pad * 2), text ? 0 : 30)
      min[c] = Math.max(min[c], Math.min(avail / n, word + pad * 2))
    }
  const sumMax = max.reduce((a, b) => a + b, 0)
  const sumMin = min.reduce((a, b) => a + b, 0)
  if (sumMax <= 0) return new Array<number>(n).fill(1)
  if (sumMax <= avail) return max.map((m) => Math.max(1, m))
  if (sumMin >= avail) return min.map((m) => Math.max(1, m))
  return max.map((m, c) => Math.max(1, min[c] + ((m - min[c]) * (avail - sumMin)) / (sumMax - sumMin)))
}

/** A table title (`h4`): bold, kept with the table. */
const title = (text: string, flow: Flow): ParagraphBlock =>
  paragraph(run(text, { bold: true, size: flow.look.h4 }), {
    keepWithNext: true,
    spacing: { before: flow.look.compact ? 2 : 6, after: flow.look.compact ? 1 : 3 },
  })

/** A note under a table, a scale or a matrix (`.note`). */
const note = (text: string, flow: Flow): ParagraphBlock =>
  paragraph(run(text, { size: flow.look.note, color: GREY }), {
    spacing: { before: 1, after: flow.look.compact ? 1 : 5 },
  })

const ruled = (color = RULE, width = 0.75) => ({
  ...box(line(width, color)),
  ...{ insideHorizontal: line(width, color), insideVertical: line(width, color) },
})

function fieldsTable(block: Kind<'fields'>, flow: Flow): Block[] {
  const th = flow.look.compact ? 46 : 32
  return [
    ...(block.title ? [title(block.title, flow)] : []),
    {
      type: 'table',
      columnWidths: [th, 100 - th],
      size: flow.look.table,
      cellPadding: { top: flow.look.pad, bottom: flow.look.pad, left: flow.look.pad, right: flow.look.pad },
      borders: ruled(),
      cantSplit: true,
      rows: block.rows.map(
        (row: FieldRow): TableRow => ({
          cells: [
            { content: run(row.label), shading: 'f8fafc', text: { bold: true } },
            row.value === null
              ? { content: null, source: row.source, what: row.label }
              : { content: run(row.value, { source: row.source }), source: row.source },
          ],
        }),
      ),
    },
  ]
}

function gridTable(block: Kind<'table'>, flow: Flow): Block[] {
  const n = Math.max(1, block.columns.length)
  const shares = columnShares([block.columns, ...block.rows], n, flow.width, flow.look.table, flow.look.pad)
  const body: TableRow[] = block.rows.length
    ? block.rows.map((row) => ({
        cells: Array.from({ length: n }, (_, c): CellInput => {
          const value = row[c]
          return value ? { content: run(value, { source: block.source }), source: block.source } : null
        }),
      }))
    : [{ cells: [{ content: run('None', { color: DASH }), colSpan: n }] }]
  return [
    ...(block.title ? [title(block.title, flow)] : []),
    {
      type: 'table',
      columnWidths: shares,
      size: flow.look.table,
      cellPadding: { top: flow.look.pad, bottom: flow.look.pad, left: flow.look.pad, right: flow.look.pad },
      borders: ruled(),
      rows: [
        {
          role: 'header',
          cells: block.columns.map((c) => ({
            content: run(c),
            shading: 'f1f5f9',
            text: { bold: true },
            align: 'left',
          })),
        },
        ...body,
      ],
    },
    ...(block.note ? [note(block.note, flow)] : []),
  ]
}

function signatureTable(block: Kind<'signature'>, flow: Flow): Block {
  return {
    type: 'table',
    columnWidths: [32, 68],
    size: flow.look.table,
    borders: ruled(),
    cantSplit: true,
    rows: block.lines.map((label) => ({
      height: flow.look.compact ? 13.5 : 21,
      cells: [
        { content: run(label), shading: 'f8fafc', text: { bold: true } },
        { content: null, what: label },
      ],
    })),
  }
}

/** The calculation fields under an analysis sheet as one strip, a column per field (`sheetFields`). */
function sheetFieldsTable(block: Kind<'fields'>, flow: Flow): Block[] {
  return [
    ...(block.title ? [title(block.title, flow)] : []),
    {
      type: 'table',
      size: 7.5,
      borders: ruled(),
      cantSplit: true,
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
      rows: [
        { cells: block.rows.map((row) => ({ content: run(row.label), shading: 'f8fafc', text: { bold: true } })) },
        {
          cells: block.rows.map((row) =>
            row.value === null
              ? { content: null, what: row.label }
              : { content: run(row.value, { source: row.source }), source: row.source },
          ),
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Matrices and scales

function matrixBlocks(block: Kind<'matrix'>, flow: Flow, pics: Pictures): Block[] {
  const out: Block[] = []
  if (block.title) out.push(title(block.title, flow))
  out.push(...(block.style === 'class-grid' ? classGrid(block, flow, pics) : matrixForm(block, flow, pics)))
  if (!block.marks.length && !block.point && !flow.look.compact) out.push(note('Nothing marked yet.', flow))
  if (block.note) out.push(note(block.note, flow))
  return out
}

/**
 * The sides a cell shares with a marked cell, in the mark's red, so the outline shows whole whichever cell Word takes
 * a shared side from.
 */
function besideMark(marked: ReadonlySet<string>, r: number, c: number, border: Border): TableCell['borders'] {
  const sides = {
    ...(marked.has(`${r}:${c - 1}`) ? { left: border } : {}),
    ...(marked.has(`${r}:${c + 1}`) ? { right: border } : {}),
    ...(marked.has(`${r - 1}:${c}`) ? { top: border } : {}),
    ...(marked.has(`${r + 1}:${c}`) ? { bottom: border } : {}),
  }
  return Object.keys(sides).length ? sides : undefined
}

/** A rating table as a form: thin rules, a shaded header, the marked cell outlined in red and ticked. */
function matrixForm(block: Kind<'matrix'>, flow: Flow, pics: Pictures): Block[] {
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const size = flow.look.table
  const strip = (color: string | null | undefined) => (color ? line(3.75, colour(color)) : undefined)
  const rows: TableRow[] = []
  if (block.columns.length > 1 && block.columnHeader)
    rows.push({
      role: 'header',
      cells: [
        { content: '', shading: 'e2e8f0' },
        {
          content: run(block.columnHeader, { italic: true }),
          colSpan: block.columns.length,
          align: 'center',
          shading: 'eef2f6',
        },
      ],
    })
  rows.push({
    role: 'header',
    cells: [
      { content: run(block.rowHeader, { bold: true }), shading: 'e2e8f0', align: 'left' },
      ...block.columns.map(
        (c, i): TableCell => ({
          content: run(c, { bold: true }),
          shading: 'e2e8f0',
          align: 'left',
          ...(strip(block.columnColors?.[i]) ? { borders: { top: strip(block.columnColors?.[i]) } } : {}),
        }),
      ),
    ],
  })
  block.rows.forEach((label, r) =>
    rows.push({
      cells: [
        {
          content: run(label, { bold: true }),
          shading: 'f8fafc',
          ...(strip(block.rowColors?.[r]) ? { borders: { left: strip(block.rowColors?.[r]) } } : {}),
        },
        ...block.columns.map((_, c): TableCell => {
          const text = block.cells[r]?.[c] ?? ''
          if (marked.has(`${r}:${c}`))
            return {
              content: [tickRun(pics.ticks.marked, size), ' ', run(text, { bold: true, source: block.markSource })],
              shading: 'fdf2f2',
              borders: box(line(1.5, MARK)),
              source: block.markSource,
            }
          const fill = block.tint?.[r]?.[c]
          const beside = besideMark(marked, r, c, line(1.5, MARK))
          return {
            content: run(text),
            ...(fill ? { shading: tint(fill, 0x26 / 255) } : {}),
            ...(beside ? { borders: beside } : {}),
          }
        }),
      ],
    }),
  )
  // A table of short factors stays as narrow as a form prints it rather than stretching its one column.
  const compact = block.columns.length <= 2 && block.cells.every((row) => row.every((cell) => cell.length <= 6))
  const n = block.columns.length
  return [
    {
      type: 'table',
      size,
      width: compact && !flow.look.compact ? 55 : 100,
      columnWidths:
        compact && flow.look.compact
          ? [72, ...block.columns.map(() => 28 / Math.max(1, n))]
          : [28, ...block.columns.map(() => 72 / Math.max(1, n))],
      borders: ruled(DASH, 0.5),
      cantSplit: true,
      cellPadding: { top: flow.look.pad, bottom: flow.look.pad, left: flow.look.pad, right: flow.look.pad },
      rows,
    },
  ]
}

/**
 * The alteration guide's grid: solid class colours with each cell's letter, a white rule where the class changes, the
 * marked cell outlined in red and ticked, and the key under it. The row axis names its labels in the corner (Word
 * turns no text upright), and the reading's X, which the PDF draws between cells, prints in the cell nearest its point
 * with its place stated under the grid.
 */
function classGrid(block: Kind<'matrix'>, flow: Flow, pics: Pictures): Block[] {
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const letter = (r: number, c: number) => block.letters?.[r]?.[c] ?? null
  const nr = block.rows.length
  const nc = Math.max(1, block.columns.length)
  const k = flow.look.compact ? 0.75 : 1
  const p = block.point
  const xAt = p
    ? {
        row: Math.min(nr - 1, Math.max(0, Math.round(p.row))),
        column: Math.min(nc - 1, Math.max(0, Math.round(p.column))),
      }
    : null
  const panel = { shading: PANEL }
  const rows: TableRow[] = [
    {
      cells: [
        { content: '', ...panel },
        { content: run(block.columnHeader, { bold: true, size: 7.1 * k }), colSpan: nc, align: 'center', ...panel },
      ],
    },
    {
      cells: [
        {
          content: run(block.rowHeader, { bold: true, size: 7.1 * k }),
          align: 'right',
          verticalAlign: 'bottom',
          ...panel,
        },
        ...block.columns.map((c): TableCell => ({ content: run(c, { size: 8.25 * k }), align: 'center', ...panel })),
      ],
    },
  ]
  const white = line(3, WHITE)
  const thin = line(1.5, PANEL)
  block.rows.forEach((label, r) =>
    rows.push({
      height: 22.5 * k,
      cells: [
        { content: run(label, { size: 8.25 * k }), align: 'right', verticalAlign: 'center', ...panel },
        ...block.columns.map((_, c): TableCell => {
          const own = letter(r, c)
          const on = marked.has(`${r}:${c}`)
          const edge = (rr: number, cc: number, inside: boolean) => (inside && letter(rr, cc) !== own ? white : thin)
          const borders = on
            ? box(line(2.25, MARK))
            : {
                top: edge(r - 1, c, r > 0),
                bottom: edge(r + 1, c, r + 1 < nr),
                left: edge(r, c - 1, c > 0),
                right: edge(r, c + 1, c + 1 < nc),
                ...besideMark(marked, r, c, line(2.25, MARK)),
              }
          const value = block.cells[r]?.[c] ?? ''
          const content: Inline[] = []
          if (on) content.push(tickRun(pics.ticks.marked, 9 * k), ' ')
          content.push(run(own ?? value, { bold: true, color: WHITE, size: 10 * k }))
          if (own && block.cellValues !== false)
            content.push({ type: 'break' }, run(value, { color: WHITE, size: 6.75 * k }))
          if (xAt && xAt.row === r && xAt.column === c)
            content.push(' ', run('X', { bold: true, color: '111111', size: 14 * k }))
          const fill = block.tint?.[r]?.[c]
          return {
            content,
            align: 'center',
            verticalAlign: 'center',
            borders,
            ...(fill ? { shading: colour(fill) } : panel),
            ...(on ? { source: block.markSource } : {}),
          }
        }),
      ],
    }),
  )
  const labelW = Math.min(
    (flow.width * 0.3) / k,
    Math.max(0, ...[block.rowHeader, ...block.rows].map((r) => textWidth(r, 8.25))) + 8,
  )
  if (p) {
    const between = (value: number, names: readonly string[]) => {
      const lo = Math.max(0, Math.min(names.length - 1, Math.floor(value)))
      const hi = Math.max(0, Math.min(names.length - 1, Math.ceil(value)))
      return lo === hi ? names[lo] : `between ${names[lo]} and ${names[hi]}`
    }
    rows.push({
      cells: [
        {
          colSpan: nc + 1,
          ...panel,
          content: run(
            `X: the reading, at ${block.rowHeader.toLowerCase()} ${between(p.row, block.rows)} and ${block.columnHeader.toLowerCase()} ${between(p.column, block.columns)} (printed in the nearest cell).`,
            { size: flow.look.note, color: GREY },
          ),
        },
      ],
    })
  }
  if (block.legend)
    rows.push({
      cells: [
        {
          colSpan: nc + 1,
          ...panel,
          content: [
            run(`${block.legend.title.toUpperCase()}    `, { bold: true, size: 7.9 * k }),
            ...block.legend.items.flatMap((item) => [
              run('■ ', { color: colour(item.color), size: 11 * k }),
              run(`${item.label.toUpperCase()}    `, { size: 7.9 * k }),
            ]),
          ],
        },
      ],
    })
  const out: Block[] = [
    {
      type: 'table',
      columnWidths: [labelW, ...block.columns.map(() => (flow.width - labelW) / nc)],
      borders: ALL_NONE,
      cantSplit: true,
      cellPadding: { top: 1, bottom: 1, left: 2, right: 2 },
      rows,
    },
  ]
  return out
}

/** A scale's points along its axis, in `scaleGeometry`'s units, merged where they nearly meet. */
class Axis {
  readonly points: number[]
  constructor(values: number[]) {
    const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b)
    const out: number[] = []
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > 0.6) out.push(v)
    this.points = out
  }
  index(x: number): number {
    let best = 0
    for (let i = 1; i < this.points.length; i++)
      if (Math.abs(this.points[i] - x) < Math.abs(this.points[best] - x)) best = i
    return best
  }
  get shares() {
    return this.points.slice(1).map((x, i) => Math.max(0.01, x - this.points[i]))
  }
  /** One row of cells: each item over its stretch, empty cells between them. */
  row(items: ReadonlyArray<{ from: number; to: number; cell: TableCell }>, extra: Partial<TableRow> = {}): TableRow {
    const cells: TableCell[] = []
    let at = 0
    const end = this.points.length - 1
    for (const item of [...items].sort((a, b) => a.from - b.from)) {
      const from = this.index(item.from)
      const to = this.index(item.to)
      if (to <= from || from < at) continue
      if (from > at) cells.push({ content: '', colSpan: from - at })
      cells.push({ ...item.cell, colSpan: to - from })
      at = to
    }
    if (at < end) cells.push({ content: '', colSpan: end - at })
    return { cells, ...extra }
  }
}

/**
 * A scale as a table: its bands across their own stretches of the axis (`scaleGeometry`'s), its ticks centred on
 * their places, and the reading as ▼ in a column of its own at the mark, its label beside it; on the guide a red
 * column through the class bars is the reading's line. Word draws no vector arrow, so the form's arrowhead is ►.
 */
function scaleBlocks(block: Kind<'scale'>, flow: Flow): Block[] {
  const style = block.style ?? 'bar'
  const g = scaleGeometry(block)
  const k = flow.look.compact ? 0.85 : 1
  const pts: number[] = [0, g.width, g.start, style === 'bar' ? g.end : g.tip, g.end]
  const nameEnd = style === 'guide' ? g.start * 0.55 : 0
  if (nameEnd) pts.push(nameEnd)
  for (const b of g.bands) pts.push(b.x0, b.x1)
  const markX = g.markX
  const D = 5
  const d = 1.6
  if (markX !== null) pts.push(markX - D, markX + D, markX - d, markX + d)
  // Tick labels sit in a stretch centred on their tick, out to halfway to their neighbours.
  const tickXs = g.ticks.map((t) => t.x)
  const lowest = style === 'bar' ? 0 : g.start
  const spans = g.ticks.map((t, i) => {
    const prev = i ? tickXs[i - 1] : null
    const next = i + 1 < tickXs.length ? tickXs[i + 1] : null
    const half = Math.min(prev === null ? Infinity : (t.x - prev) / 2, next === null ? Infinity : (next - t.x) / 2, 40)
    const from = Math.max(lowest, t.x - half)
    const to = Math.min(g.width, t.x + half)
    return { label: t.label, x: t.x, from, to }
  })
  for (const s of spans) pts.push(s.from, s.to)
  const axis = new Axis(pts)
  const size = 7 * k
  const rows: TableRow[] = []
  const lo = style === 'bar' ? g.start : g.start
  const hi = style === 'bar' ? g.end : g.tip
  if (markX !== null) {
    const label = run(block.markLabel ?? '', { bold: true, color: MARK, size, source: block.markSource })
    const right = markX <= (lo + hi) / 2
    rows.push(
      axis.row([
        {
          from: markX - D,
          to: markX + D,
          cell: { content: run('▼', { color: MARK, size: 9 * k }), align: 'center', verticalAlign: 'bottom' },
        },
        right
          ? { from: markX + D, to: g.width, cell: { content: label, align: 'left', verticalAlign: 'bottom' } }
          : { from: 0, to: markX - D, cell: { content: label, align: 'right', verticalAlign: 'bottom' } },
      ]),
    )
  }
  const tickRow = (o: { first?: TableCell } = {}) =>
    axis.row([
      ...(o.first ? [{ from: 0, to: g.start, cell: o.first }] : []),
      ...spans
        .filter((s) => s.label)
        .map((s) => {
          const centre = (s.from + s.to) / 2
          const align: 'left' | 'center' | 'right' =
            Math.abs(centre - s.x) < 2 ? 'center' : centre > s.x ? 'left' : 'right'
          return { from: s.from, to: s.to, cell: { content: run(s.label, { size: 6.75 * k }), align } }
        }),
    ])
  if (style === 'guide') {
    if (g.ticks.some((t) => t.label)) rows.push(tickRow())
    const rule = line(0.9, INK)
    block.bands.forEach((b, i) => {
      const { x0, x1 } = g.bands[i]
      const chosen = block.markBand === i
      const color = colour(b.color)
      const shade = chosen ? { shading: tint(b.color, 0.14) } : {}
      const items: Array<{ from: number; to: number; cell: TableCell }> = [
        { from: 0, to: nameEnd, cell: { content: run(b.name ?? b.label, { bold: chosen, size: 8 * k }), ...shade } },
        {
          from: nameEnd,
          to: g.start,
          cell: { content: run(b.range ?? '', { bold: chosen, size: 8 * k }), align: 'right', ...shade },
        },
      ]
      const bar = (from: number, to: number) => ({ from, to, cell: { content: '', shading: color } })
      if (x1 - x0 > 0.5) {
        if (markX !== null && markX - d > x0 && markX + d < x1) items.push(bar(x0, markX - d), bar(markX + d, x1))
        else items.push(bar(x0, x1))
        if (i === block.bands.length - 1 && g.tip > x1 + 1)
          items.push({
            from: x1,
            to: g.tip,
            cell: { content: run('+', { bold: true, color: WHITE, size: 7 * k }), shading: color, align: 'left' },
          })
      }
      if (markX !== null) items.push({ from: markX - d, to: markX + d, cell: { content: '', shading: MARK } })
      const row = axis.row(items, { height: 13 * k, cantSplit: true })
      rows.push({
        ...row,
        cells: row.cells.map((cell) => ({ ...(cell as TableCell), borders: { top: rule, bottom: rule } })),
      })
    })
  } else if (style === 'arrow-axis') {
    rows.push(
      axis.row(
        block.bands
          .map((b, i): { from: number; to: number; cell: TableCell } => ({
            from: g.bands[i].x0,
            to: g.bands[i].x1,
            cell: {
              content: run(b.label, { bold: true, color: colour(b.color), size: 9 * k }),
              align: 'center',
              verticalAlign: 'bottom',
            },
          }))
          .concat([
            // The arrowhead over the axis' end.
            {
              from: g.end,
              to: g.tip,
              cell: { content: run('►', { size: 8 * k }), align: 'right', verticalAlign: 'bottom' },
            },
          ]),
      ),
    )
    const axisLine = line(1.6, INK)
    const tick = line(1.3, INK)
    const row = axis.row(
      [
        ...block.bands
          .map((b, i) => ({ b, ...g.bands[i] }))
          .filter((b) => b.x1 - b.x0 > 0.5)
          .map((b) => ({
            from: b.x0,
            to: b.x1,
            cell: {
              content: '',
              ...(b.b.color ? { shading: tint(b.b.color, 0.4) } : {}),
              borders: { left: tick, right: tick, top: axisLine },
            },
          })),
        { from: g.end, to: g.tip, cell: { content: '', borders: { top: axisLine } } },
      ],
      { height: 7 * k },
    )
    rows.push(row)
    if (g.ticks.some((t) => t.label))
      rows.push(
        tickRow(
          block.axisLabel ? { first: { content: run(`${block.axisLabel} `, { size: 6.75 * k }), align: 'right' } } : {},
        ),
      )
  } else {
    rows.push(
      axis.row(
        block.bands.map((b, i) => ({
          from: g.bands[i].x0,
          to: Math.max(g.bands[i].x1, g.bands[i].x0 + 1),
          cell: {
            content: run(b.label, { size: 7.5 * k }),
            align: 'center',
            verticalAlign: 'center',
            shading: tint(b.color, 0.35, [0xe5, 0xe7, 0xeb]),
            borders: box(line(0.6, '555555')),
          },
        })),
        { height: 16 * k },
      ),
    )
    if (g.ticks.some((t) => t.label)) rows.push(tickRow())
  }
  const max = flow.look.compact ? 470 * PX : style === 'arrow-axis' ? flow.width : 640 * PX
  return [
    {
      type: 'table',
      width: Math.min(100, (Math.min(flow.width, max) / flow.width) * 100),
      columnWidths: axis.shares,
      borders: ALL_NONE,
      cantSplit: true,
      cellPadding: { top: 0.5, bottom: 0.5, left: 0, right: 0 },
      rows,
    },
  ]
}

function scaleBlockList(block: Kind<'scale'>, flow: Flow): Block[] {
  return [
    ...(block.title ? [title(block.title, flow)] : []),
    ...scaleBlocks(block, flow),
    ...(block.mark === null && !flow.look.compact ? [note('Nothing marked yet.', flow)] : []),
    ...(block.note ? [note(block.note, flow)] : []),
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Choices and forms

function choicesBlocks(block: Kind<'choices'>, flow: Flow, pics: Pictures): Block[] {
  const size = flow.look.body
  const tick = (option: string): Inline[] => [
    tickRun(option === block.chosen ? pics.ticks.crossed : pics.ticks.empty, size),
    run(` ${option}`, option === block.chosen ? { source: block.source } : {}),
  ]
  if (!block.boxed)
    return [
      paragraph(
        [
          run(block.label, { bold: true }),
          ...block.options.flatMap((option) => [run('   '), ...tick(option)]),
          ...(block.answer ? [run(`   ${block.answer}`, { bold: true, source: block.source })] : []),
        ],
        { text: { size }, keepLinesTogether: true },
      ),
    ]
  // A ruled box: the question and its answer on the left, the tick boxes on the right (`table.answer-box`).
  const ticksW = Math.min(flow.width * 0.4, 90)
  const answer: Block[] =
    block.answer === undefined
      ? []
      : [
          paragraph(
            block.answer
              ? run(block.answer, { bold: true, source: block.source })
              : [{ type: 'blank', what: block.label, width: 120 }],
            {
              text: { size },
              spacing: { before: 0, after: 0 },
            },
          ),
        ]
  return [
    {
      type: 'table',
      columnWidths: [flow.width - ticksW, ticksW],
      borders: ruled(INK),
      cantSplit: true,
      cellPadding: { top: flow.look.compact ? 2 : 4.5, bottom: flow.look.compact ? 2 : 4.5, left: 4.5, right: 4.5 },
      rows: [
        {
          cells: [
            { blocks: [paragraph(run(block.label), { text: { size }, spacing: { before: 0, after: 0 } }), ...answer] },
            {
              blocks: block.options.map((option) =>
                paragraph(tick(option), { text: { size }, spacing: { before: 0, after: 0 } }),
              ),
            },
          ],
        },
      ],
    },
    { type: 'spacer', height: flow.look.compact ? 1 : 4 },
  ]
}

/** A form's sections as one ruled table, a section or two side by side per row, each title bar kept with its section. */
function formTable(block: Kind<'form'>, flow: Flow, pics: Pictures): Block[] {
  const rows: TableRow[] = []
  const half = flow.width / 2 - 9
  for (const row of block.rows.filter((r) => r.length)) {
    const cells = row.slice(0, 2)
    const span = cells.length === 1 ? 2 : 1
    const inner: Flow = { look: COMPACT, width: span === 2 ? flow.width - 9 : half, height: flow.height }
    rows.push({
      cells: cells.map((cell) => ({
        blocks: [
          paragraph(run(cell.title, { bold: true, size: 7.9 }), {
            keepWithNext: true,
            spacing: { before: 0, after: 0 },
          }),
        ],
        colSpan: span,
        shading: 'd9dee4',
      })),
    })
    rows.push({
      cells: cells.map((cell: FormCell) => {
        const blocks = cell.blocks.flatMap((b, i) => blocksOf(i ? b : untitled(b, cell.title), inner, pics))
        return { blocks: blocks.length ? blocks : [paragraph('')], colSpan: span }
      }),
    })
  }
  return [
    {
      type: 'table',
      columnWidths: [1, 1],
      borders: ruled(INK),
      cellPadding: { top: 1.5, bottom: 2.25, left: 4.5, right: 4.5 },
      rows,
    },
    { type: 'spacer', height: 4 },
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Figures

const CAPTION = 8.25

function figureBlocks(block: Kind<'figure'>, flow: Flow, pics: Pictures): Block[] {
  const caption = (color: string) => (block.caption ? [small(block.caption, CAPTION, { color })] : [])
  if (!block.figure)
    return [
      { type: 'spacer', height: 6 },
      emptyBox(block.placeholder ?? 'Figure to come', flow.width, 36 + 13, flow, flow.look.body),
      ...caption(DASH),
      { type: 'spacer', height: 6 },
    ]
  const figure = block.figure
  const ar = aspectOf(figure)
  let w = Math.min(flow.width, figure.width > 0 ? figure.width * PX : flow.width)
  let h = w / ar
  const room = flow.height - (block.caption ? 24 : 0) - 16
  if (h > room) {
    h = room
    w = h * ar
  }
  return [picture(figure, w, h, flow, pics, 'left'), ...caption(MUTED), { type: 'spacer', height: 6 }]
}

/** A map's key under it: its legend as swatches, its scale, and north stated (`mapKey`); nothing when it prints its own. */
function mapKey(figure: ReportFigure | null): Block[] {
  const map = figure?.map
  if (!map || map.inPicture) return []
  const runs: Inline[] = []
  for (const row of map.legend ?? []) {
    const glyph = row.kind === 'line' ? '▬' : row.kind === 'point' ? '●' : '■'
    runs.push(run(`${glyph} `, { color: colour(row.color), size: 9 }), run(`${row.label}    `, { size: 7.5 }))
  }
  if (map.scale) runs.push(run(`${map.scale}    `, { bold: true, size: 7.5 }))
  if (map.northUp) runs.push(run('↑ N  North up', { bold: true, size: 7.5 }))
  return runs.length ? [paragraph(runs, { spacing: { before: 3, after: 3 } })] : []
}

function mapFigureBlocks(block: Kind<'mapFigure'>, flow: Flow, pics: Pictures): Block[] {
  const slot = block.slot
  let { w, h } = fitted(slot, (block.compact ? 4.2 : 7.2) * IN, 3.5 * IN, flow.width)
  const room = flow.height - 70
  if (h > room) {
    w *= room / h
    h = room
  }
  return [
    { type: 'spacer', height: 6 },
    ...slotBlocks(slot, w, h, flow, pics),
    ...mapKey(slot.figure),
    small(block.caption, CAPTION, { bold: true, color: INK }),
    { type: 'spacer', height: 6 },
  ]
}

function figureGridBlocks(block: Kind<'figureGrid'>, flow: Flow, pics: Pictures): Block[] {
  const cols = block.columns
  const gap = 9
  const cw = (flow.width - gap * (cols - 1)) / cols
  const cells = block.slots.map((slot) => ({
    slot,
    ...(block.landscape ? fitted(slot, 5.6 * IN, 1.8 * IN, cw) : fitted(slot, Infinity, 1.8 * IN, cw)),
  }))
  const rowsOf: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += cols) rowsOf.push(cells.slice(i, i + cols))
  // Shrink the pictures so the grid keeps to its page.
  const pics_h = rowsOf.reduce((s, row) => s + Math.max(...row.map((c) => c.h)), 0)
  const room = flow.height - rowsOf.length * 34 - 30
  if (pics_h > room && pics_h > 0) {
    const k = Math.max(0.2, room / pics_h)
    for (const c of cells) {
      c.w *= k
      c.h *= k
    }
  }
  const inner: Flow = { ...flow, width: cw }
  return [
    {
      type: 'table',
      borders: ALL_NONE,
      cellPadding: { top: 0, bottom: gap / 2, left: gap / 2, right: gap / 2 },
      rows: rowsOf.map((row) => ({
        cantSplit: true,
        cells: Array.from({ length: cols }, (_, i): CellInput => {
          const c = row[i]
          if (!c) return ''
          return {
            verticalAlign: 'top',
            blocks: [
              ...slotBlocks(c.slot, c.w, c.h, inner, pics),
              ...(c.slot.figure ? [small(c.slot.label, 7.5, { align: 'center' })] : []),
            ],
          }
        }),
      })),
    },
    small(block.caption, CAPTION, { bold: true, color: INK }),
    { type: 'spacer', height: 6 },
  ]
}

/** Pictures of one view stacked (`figurePair`), as wide as their page allows, the pair's caption last. */
function figurePairBlocks(block: Kind<'figurePair'>, flow: Flow, pics: Pictures): Block[] {
  const named = (s: FigureSlot) => !!block.title && block.title.includes(s.label)
  const maxW = (block.sheet ? 9.4 : block.landscape ? 6.3 : 3.9) * IN
  const emptyH = (block.sheet ? 6 : 2.4) * IN
  const items = block.slots.map((slot) => ({ slot, ...fitted(slot, maxW, emptyH, flow.width) }))
  const extra = (block.title ? 22 : 0) + (block.caption ? 22 : 0) + items.length * 34
  const room = flow.height - extra
  if (block.sheet) {
    const each = room / Math.max(1, items.length)
    for (const item of items)
      if (item.h > each) {
        item.w *= each / item.h
        item.h = each
      }
  } else {
    const total = items.reduce((s, i) => s + i.h, 0)
    if (total > room && total > 0) {
      const k = Math.max(0.2, room / total)
      for (const item of items) {
        item.w *= k
        item.h *= k
      }
    }
  }
  const out: Block[] = []
  if (block.title) out.push(title(block.title, { ...flow, look: NORMAL }))
  for (const item of items) {
    out.push(
      ...slotBlocks(item.slot, item.w, item.h, flow, pics, { inset: block.placement === 'inset', align: 'center' }),
    )
    if (block.placement === 'caption' && !named(item.slot))
      out.push(small(item.slot.label, CAPTION, { bold: true, color: INK, align: block.sheet ? 'center' : 'left' }))
    out.push({ type: 'spacer', height: block.sheet ? 4 : 8 })
  }
  if (block.caption) out.push(small(block.caption, 8.25, { color: INK }))
  return out
}

/** One place on a figure page: its blue header bar, its picture or what goes there, and its note. */
function barSlot(slot: FigureSlot, w: number, h: number, cellWidth: number, pics: Pictures): Block {
  const barH = 8.25 * 1.3 + 3
  const inner: Flow = { look: NORMAL, width: w - 2, height: h }
  const picH = Math.max(10, h - barH - (slot.figure && slot.note ? 10 : 0))
  return {
    type: 'table',
    width: Math.min(100, (w / cellWidth) * 100),
    align: 'center',
    borders: ruled(BLACK),
    cellPadding: { top: 0, bottom: 0, left: 0, right: 0 },
    cantSplit: true,
    rows: [
      {
        cells: [
          {
            content: run(slot.label.toUpperCase(), { bold: true, color: WHITE, size: 8.25 }),
            shading: BAR,
            align: 'center',
          },
        ],
      },
      {
        cells: [
          {
            blocks: slot.figure
              ? slotBlocks(slot, w - 2, picH, inner, pics)
              : [emptyBox(slot.placeholder, w - 2, picH, inner)],
            verticalAlign: 'center',
          },
        ],
      },
    ],
  }
}

/**
 * The figure page on its own letter landscape page (`figurePage`): a title box and the project facts over the maps in a
 * 2.3 in column, the before and after pictures stacked on the right, each place under its header bar.
 */
function figurePageBlocks(block: Kind<'figurePage'>, flow: Flow, pics: Pictures): Block[] {
  const H = Math.min(7.3 * IN, flow.height) - 8
  const sideW = 2.3 * IN
  const gapW = 0.1 * IN
  const mainW = flow.width - sideW - gapW
  const size = 8.25
  const boxed = (blocks: Block[]): TableBlock => ({
    type: 'table',
    borders: ruled(BLACK),
    cantSplit: true,
    cellPadding: { top: 2.25, bottom: 2.25, left: 4.5, right: 4.5 },
    rows: [{ cells: [{ blocks, align: 'center' }] }],
  })
  const centred = (content: RichText) =>
    paragraph(content, { align: 'center', text: { bold: true, size }, spacing: { before: 0, after: 0 } })
  const side: Block[] = [boxed([centred(block.number), centred(block.title)])]
  const factsH = block.facts.length ? block.facts.length * size * 1.3 + 4.5 : 0
  if (block.facts.length) {
    side.push({ type: 'spacer', height: 0.08 * IN })
    side.push(
      boxed(
        block.facts.map((row) =>
          centred(
            row.value === null
              ? [run(`${row.label}: `), { type: 'blank', what: row.label, width: 52.5 }]
              : run(`${row.label}: ${row.value}`, { source: row.source }),
          ),
        ),
      ),
    )
  }
  const titleH = 2 * size * 1.3 + 4.5
  const sideRoom = H - titleH - factsH - 0.16 * IN
  const sideEach = block.side.length ? (sideRoom - 0.08 * IN * (block.side.length - 1)) / block.side.length : 0
  for (const slot of block.side) {
    side.push({ type: 'spacer', height: 0.08 * IN })
    side.push(barSlot(slot, sideW - 2, sideEach, sideW, pics))
  }
  // The main column: each picture's box its picture's shape, as wide as the column allows; a missing picture's box
  // takes what height is left.
  const barH = size * 1.3 + 3
  const sized = block.main.map((slot) => {
    if (!slot.figure) return { slot, w: mainW, h: 0, sized: false }
    const ar = aspectOf(slot.figure)
    const w = Math.min(mainW, 3.05 * IN * ar)
    return { slot, w, h: w / ar, sized: true }
  })
  const gapMain = 0.3 * IN
  const gaps = gapMain * Math.max(0, sized.length - 1)
  const loose = sized.filter((c) => !c.sized).length
  const fixed = sized.reduce((s, c) => s + (c.sized ? c.h + barH + 12 : 0), 0)
  if (fixed + gaps > H) {
    const pictures = sized.reduce((s, c) => s + (c.sized ? c.h : 0), 0)
    const k = Math.max(
      0.2,
      (H - gaps - sized.filter((c) => c.sized).length * (barH + 12) - loose * 60) / Math.max(1, pictures),
    )
    for (const c of sized)
      if (c.sized) {
        c.w *= k
        c.h *= k
      }
  }
  const used = sized.reduce((s, c) => s + (c.sized ? c.h + barH + 12 : 0), 0)
  const looseH = loose ? Math.max(60, (H - used - gaps) / loose) : 0
  const main: Block[] = []
  sized.forEach((c, i) => {
    if (i) main.push({ type: 'spacer', height: gapMain })
    main.push(barSlot(c.slot, c.w, c.sized ? c.h + barH + 2 : looseH, mainW, pics))
  })
  return [
    {
      type: 'table',
      columnWidths: [sideW, gapW, mainW],
      borders: ALL_NONE,
      cellPadding: { top: 0, bottom: 0, left: 0, right: 0 },
      cantSplit: true,
      rows: [{ cells: [{ blocks: side, verticalAlign: 'top' }, '', { blocks: main, verticalAlign: 'top' }] }],
    },
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks

const GAP: Block = { type: 'spacer', height: 6 }

const wordLevel = (level: number) => Math.min(6, Math.max(1, level - 1)) as 1 | 2 | 3 | 4 | 5 | 6

/** Any block in a flow, as the kit's blocks. Kinds that take pages of their own are placed by `ReportPages`. */
function blocksOf(block: ReportBlock, flow: Flow, pics: Pictures): Block[] {
  const { look } = flow
  switch (block.kind) {
    case 'heading':
      if (!block.text.trim()) return []
      // A form's headings and a table's title stay out of the contents; the report's sections are Word headings.
      if (look.compact) return [title(block.text, flow)]
      return [{ type: 'heading', level: wordLevel(block.level), content: block.text }]
    case 'paragraph': {
      const said = block.sentences.filter((s) => s.text)
      if (!said.length) return []
      return [
        paragraph(
          said.flatMap((s, i) => [...(i ? [' '] : []), run(s.text ?? '', { source: s.source })]),
          { text: { size: look.body }, spacing: look.compact ? { before: 0, after: 2 } : undefined },
        ),
      ]
    }
    case 'text':
      return block.text.trim()
        ? [
            paragraph(run(block.text, { source: block.source }), {
              source: block.source,
              text: { size: look.body },
              spacing: look.compact ? { before: 0, after: 2 } : undefined,
            }),
          ]
        : []
    case 'list':
      return [
        {
          type: 'list',
          ordered: !!block.ordered,
          source: block.source,
          items: block.items.map((item) => run(item, { source: block.source, size: look.body })),
        },
      ]
    // A table is followed by the gap the PDF leaves under it.
    case 'fields':
      return [...fieldsTable(block, flow), ...(look.compact ? [] : [GAP])]
    case 'table':
      return [...gridTable(block, flow), ...(look.compact ? [] : [GAP])]
    case 'matrix':
      return matrixBlocks(block, flow, pics)
    case 'scale':
      return scaleBlockList(block, flow)
    case 'choices':
      return choicesBlocks(block, flow, pics)
    case 'figure':
      return figureBlocks(block, flow, pics)
    case 'signature':
      return [signatureTable(block, flow), { type: 'spacer', height: 4 }]
    case 'form':
      return formTable(block, flow, pics)
    case 'pageBreak':
      return [{ type: 'pageBreak' }]
    case 'mapFigure':
      return mapFigureBlocks(block, flow, pics)
    case 'figureGrid':
      return figureGridBlocks(block, flow, pics)
    case 'figurePair':
      return figurePairBlocks(block, flow, pics)
    case 'figurePage':
      // Only on a page of its own; anywhere else its words.
      return [
        title(`${block.number}: ${block.title}`, flow),
        ...block.facts.map((row) =>
          paragraph(
            row.value === null
              ? [run(`${row.label}: `), { type: 'blank', what: row.label }]
              : run(`${row.label}: ${row.value}`),
          ),
        ),
        ...[...block.side, ...block.main].map((slot) =>
          paragraph(run(`${slot.label}: ${slot.figure ? slot.figure.caption || slot.figure.view : slot.placeholder}`)),
        ),
      ]
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages

type Paper = AssembledReport['layout']['paper']

/** Every page kind a report prints on, in `pageSpec`'s order. */
export const PAGE_KINDS: readonly PageKind[] = [
  'portrait',
  'landscape',
  'cover',
  'sheet',
  'sheetFull',
  'sheetPortrait',
  'figure',
]

/** A page kind's Word page set-up from `pageSpec`: its paper given portrait, its turn, margins and header room. */
export function pageSetup(kind: PageKind, paper: Paper): PageSetup {
  const spec = pageSpec(kind, paper)
  const [w, h] = spec.size
  const [t, r, b, l] = spec.margin
  return {
    paper: { width: Math.min(w, h), height: Math.max(w, h) },
    orientation: w > h ? 'landscape' : 'portrait',
    margins: {
      top: t,
      right: r,
      bottom: b,
      left: l,
      header: spec.header ? Math.max(4, t / 2 - 6) : 0,
      footer: spec.number ? Math.max(4, b / 2 - 6) : 0,
    },
  }
}

/**
 * What frames a report's pages beyond its own blocks: each page kind's set-up, header and footer; the title block or
 * the cover's head; the contents; and the closing (the to-complete box and the last line). The direct route builds
 * them here (`codeFurniture`); the recipe route takes them from the recipe's JSON (`recipeRoute.ts`). Either way the
 * same `layoutReport` places them and the report's blocks on the same pages.
 */
export interface WordFurniture {
  /** A page kind's page set-up, header and footer. */
  section(kind: PageKind): Pick<Section, 'page' | 'header' | 'footer'>
  /** The first page's head when the report has no cover: the title, the project and the logo. */
  title: readonly Block[]
  /** The cover's head (logo, title, project), when the report has a cover; its cover blocks follow on the page. */
  cover: readonly Block[]
  /** The contents page, or nothing when the report prints none. */
  contents: readonly Block[]
  /** After the body: the to-complete box when anything is left, then the report's last line. */
  closing: readonly Block[]
}

/** The report's Word sections, one per run of pages of one kind, opened as the PDF opens its pages. */
class ReportPages {
  readonly sections: Section[] = []
  private current: { kind: PageKind; body: Block[]; closed: boolean } | null = null
  /** The next block in the flow starts a new page. */
  breakNext = false

  constructor(
    private paper: Paper,
    private furniture: Pick<WordFurniture, 'section'>,
  ) {}

  /** The flow box of a page kind: its text width and height, points. */
  box(kind: PageKind): { width: number; height: number } {
    const spec = pageSpec(kind, this.paper)
    const [t, r, b, l] = spec.margin
    return { width: spec.size[0] - l - r, height: spec.size[1] - t - b }
  }

  private open(kind: PageKind, align?: PageSetup['verticalAlign']) {
    const frame = this.furniture.section(kind)
    const body: Block[] = []
    this.sections.push({
      page: { ...frame.page, ...(align ? { verticalAlign: align } : {}) },
      header: [...(frame.header ?? [])],
      footer: [...(frame.footer ?? [])],
      body,
    })
    this.current = { kind, body, closed: false }
    this.breakNext = false
  }

  /** Before flow content: the page it goes on, opening one when the kind changes or a page of its own came before. */
  flow(kind: PageKind = 'portrait') {
    if (!this.current || this.current.kind !== kind || this.current.closed) this.open(kind)
  }

  /** Nothing has been drawn on the page yet. */
  fresh(): boolean {
    const body = this.current?.body
    return !body || !body.length || body[body.length - 1].type === 'pageBreak' || this.breakNext
  }

  add(blocks: readonly Block[]) {
    if (!blocks.length) return
    if (!this.current) this.flow()
    const list = [...blocks]
    if (this.breakNext) {
      list[0] = { ...list[0], pageBreakBefore: true }
      this.breakNext = false
    }
    this.current!.body.push(...list)
  }

  /** A page (or pages) of its own: the flow after it starts on a new page. */
  own(kind: PageKind, blocks: readonly Block[], align?: PageSetup['verticalAlign']) {
    this.open(kind, align)
    this.add(blocks)
    this.current!.closed = true
  }
}

/** The report's theme: Arial (Arimo in the kit's layout), the PDF's sizes and colours. */
const THEME: ThemeInput = {
  body: { font: 'Arial', size: 9.5, color: INK, after: 6, line: 1.15 },
  title: { size: 18, bold: true, align: 'left', after: 3 },
  subtitle: { size: 9.75, color: MUTED, align: 'left' },
  headings: [
    { size: 11.5, bold: true, color: INK, before: 9, after: 3 },
    { size: 10, bold: true, color: INK, before: 5, after: 3 },
    { size: 10, bold: true, color: INK, before: 5, after: 3 },
  ],
  caption: { size: CAPTION, color: MUTED, bold: false, before: 3, after: 3 },
  note: { size: 8, color: GREY, after: 5 },
  small: { size: 8, color: GREY },
  header: { size: 8, color: GREY },
  footer: { size: 8, color: GREY },
  table: {
    size: 9,
    headerFill: 'f1f5f9',
    headerText: { bold: true },
    headerAlign: 'left',
    groupFill: 'd9dee4',
    labelFill: 'f8fafc',
    outerBorder: line(0.75),
    innerBorder: line(0.75),
    cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
    placeholderFill: WHITE,
    placeholderBorder: line(0.75, DASH, 'dashed'),
    placeholderText: { size: 8.25, color: GREY },
  },
  blankWidth: 120,
}

/**
 * The logo in its box: the user's own picture (`logoBox`). With none, or one that is not a PNG or JPEG that reads, the
 * box keeps its place with no border and no words.
 */
function logoBlocks(
  logo: ReportLogo | null,
  w: number,
  h: number,
  flow: Flow,
  pics: Pictures,
  align: 'left' | 'right',
): Block[] {
  const image = logo ? pics.get(logo.dataUrl) : null
  if (image)
    return [{ type: 'figure', image, fit: { width: w, height: h, upscale: true }, align, alt: logo?.name ?? 'Logo' }]
  return [{ ...emptySlot(w, h, flow), align }]
}

/** The room a missing picture keeps, drawn as nothing: `emptyBox`'s table with no border and no words. */
function emptySlot(width: number, height: number, flow: Flow): TableBlock {
  const slot = emptyBox('', width, height, flow)
  return { ...slot, borders: { ...box(NONE), insideHorizontal: NONE, insideVertical: NONE } }
}

/** The to-complete list by part, in the report's order: each part once, its items run on. */
export function toCompleteByPart(items: AssembledReport['toComplete']): Array<{ part: string; what: string }> {
  const byPart = new Map<string, string[]>()
  for (const item of items) byPart.set(item.part, [...(byPart.get(item.part) ?? []), item.what])
  return [...byPart].map(([part, what]) => ({ part, what: what.join('; ') }))
}

/** "To complete before signing": a bullet per part, its items run on, in a ruled box. */
function toCompleteBox(items: AssembledReport['toComplete']): Block {
  return {
    type: 'table',
    borders: box(line(0.75, 'b7791f')),
    cellPadding: { top: 6, bottom: 6, left: 6, right: 6 },
    rows: [
      {
        cantSplit: true,
        cells: [
          {
            shading: 'fffaf0',
            blocks: [
              { type: 'heading', level: 1, content: 'To complete before signing' },
              {
                type: 'list',
                items: toCompleteByPart(items).map(({ part, what }) => [
                  run(`${part}:`, { bold: true, size: 7.5 }),
                  run(` ${what}`, { size: 7.5 }),
                ]),
              },
            ],
          },
        ],
      },
    ],
  }
}

/** The pictures of a report, read once each, and the tick boxes the Word file draws. */
export async function reportPictures(kit: Pick<WordKit, 'imageInfo'>): Promise<Pictures> {
  const [empty, crossed, marked] = await Promise.all([
    tickPicture('empty'),
    tickPicture('crossed'),
    tickPicture('marked'),
  ])
  return new Pictures(kit, { empty, crossed, marked })
}
export type { Pictures as ReportPictures }

/** The report's title (its first heading) and its blocks after it; the cover's blocks and the body after them. */
function reportParts(report: AssembledReport) {
  const [first, ...rest] = report.blocks
  const title = first?.kind === 'heading' ? first.text : report.title
  const blocks = first?.kind === 'heading' ? rest : report.blocks
  // The cover takes the fields that come before the first section heading (the cover part's).
  const coverEnd = report.layout.cover ? blocks.findIndex((block) => block.kind === 'heading') : 0
  const coverBlocks = report.layout.cover ? blocks.slice(0, Math.max(0, coverEnd)) : []
  const body = blocks.slice(coverBlocks.length)
  // The contents: the sections (and the to-complete list) Word lists, then the pictures by their labels.
  const sections = body.filter((b) => b.kind === 'heading' && b.level === 2)
  const images = body.flatMap((b) => {
    const label = imageLabel(b)
    return label ? [label] : []
  })
  return { title, coverBlocks, body, contents: report.layout.contents && sections.length > 0, images }
}

/** The text box of a page kind on the report's paper, points. */
function textBox(kind: PageKind, paper: Paper) {
  const spec = pageSpec(kind, paper)
  const [t, r, b, l] = spec.margin
  return { width: spec.size[0] - l - r, height: spec.size[1] - t - b }
}

/** The title block's logo box and the cover's, points. */
const TITLE_LOGO = { w: 180 * PX, h: 64 * PX, gutter: 18 }
const COVER_LOGO = { w: 260 * PX, h: 110 * PX }

/**
 * The values the recipe route's JSON furniture prints (`recipeJson/components/via-*.json`), computed here by the
 * rules the direct route draws by: the report's title and lines, the logo as the Word file takes it, the boxes'
 * widths, the contents' pictures, the to-complete list by part and each page kind's set-up.
 */
export function wordFacts(report: AssembledReport, logo: ReportLogo | null, pics: Pictures) {
  const paper = report.layout.paper
  const parts = reportParts(report)
  const portrait = textBox('portrait', paper)
  return {
    report: {
      title: parts.title,
      subtitle: report.subtitle,
      footer: report.footer,
      about: report.about ?? '',
      runningHeader: runningHeader(report),
    },
    logo: {
      name: logo?.name ?? null,
      image: logo ? pics.get(logo.dataUrl) : null,
      // The empty logo slot's width as a share of what holds it (`emptySlot`).
      coverBoxWidth: Math.min(100, (COVER_LOGO.w / textBox('cover', paper).width) * 100),
      titleBoxWidth: Math.min(100, (TITLE_LOGO.w / (TITLE_LOGO.w + TITLE_LOGO.gutter)) * 100),
    },
    titleBlock: {
      columnWidths: [portrait.width - TITLE_LOGO.w - TITLE_LOGO.gutter, TITLE_LOGO.w + TITLE_LOGO.gutter],
    },
    contents: { show: parts.contents, images: parts.images },
    closing: { toComplete: toCompleteByPart(report.toComplete) },
    pages: Object.fromEntries(PAGE_KINDS.map((kind) => [kind, pageSetup(kind, paper)])) as Record<PageKind, PageSetup>,
  }
}

/**
 * The direct route's furniture, drawn here: the running header and "Page n of N" by `pageSpec`, the title block or
 * the cover's head with the logo, Word's own contents and the pictures' list, the to-complete box and the last line.
 * It is the test oracle for the recipe route's JSON furniture, which must give the very same blocks.
 */
export function codeFurniture(report: AssembledReport, logo: ReportLogo | null, pics: Pictures): WordFurniture {
  const paper = report.layout.paper
  const header = runningHeader(report)
  const parts = reportParts(report)
  const flowOf = (kind: PageKind): Flow => ({ look: NORMAL, ...textBox(kind, paper) })
  const flow = flowOf('portrait')
  const logoW = TITLE_LOGO.w
  return {
    section: (kind) => {
      const spec = pageSpec(kind, paper)
      return {
        page: pageSetup(kind, paper),
        header: spec.header ? [paragraph(run(header, { size: 8, color: GREY }))] : [],
        footer: spec.number
          ? [
              paragraph(
                [
                  run('Page ', { size: 8, color: GREY }),
                  { type: 'field', field: 'page', size: 8, color: GREY },
                  run(' of ', { size: 8, color: GREY }),
                  { type: 'field', field: 'pages', size: 8, color: GREY },
                ],
                { align: 'right' },
              ),
            ]
          : [],
      }
    },
    cover: [
      ...logoBlocks(logo, COVER_LOGO.w, COVER_LOGO.h, flowOf('cover'), pics, 'left'),
      paragraph(run(parts.title, { bold: true, size: 25.5 }), { spacing: { before: 13.5, after: 13.5, line: 1 } }),
      paragraph(run(report.subtitle, { size: 13.5, color: '334155' }), { spacing: { before: 0, after: 13.5 } }),
    ],
    title: [
      {
        type: 'table',
        columnWidths: [flow.width - logoW - TITLE_LOGO.gutter, logoW + TITLE_LOGO.gutter],
        borders: { ...ALL_NONE, bottom: line(1.5, INK) },
        cellPadding: { top: 0, bottom: 9, left: 0, right: 0 },
        rows: [
          {
            cells: [
              {
                blocks: [
                  paragraph(run(parts.title), { style: 'title' }),
                  paragraph(run(report.subtitle), { style: 'subtitle', spacing: { before: 0, after: 0 } }),
                ],
                verticalAlign: 'top',
              },
              {
                blocks: logoBlocks(
                  logo,
                  logoW,
                  TITLE_LOGO.h,
                  { ...flow, width: logoW + TITLE_LOGO.gutter },
                  pics,
                  'right',
                ),
                verticalAlign: 'top',
              },
            ],
          },
        ],
      },
      { type: 'spacer', height: 12 },
    ],
    contents: parts.contents
      ? [
          { type: 'toc', title: 'Contents', levels: 1 },
          ...(parts.images.length
            ? [
                paragraph(run('Images', { bold: true, size: 10 }), {
                  keepWithNext: true,
                  spacing: { before: 9, after: 3 },
                }),
                ...parts.images.map((text) => paragraph(run(text), { spacing: { before: 0, after: 2 } })),
              ]
            : []),
        ]
      : [],
    closing: [
      ...(report.toComplete.length ? [{ type: 'spacer', height: 10 } as Block, toCompleteBox(report.toComplete)] : []),
      // The last line, when the report has one: how many values the reviewer changed by hand.
      ...(report.footer
        ? [
            paragraph(run(report.footer, { size: 8.25, color: GREY }), {
              borders: { top: line(0.75) },
              spacing: { before: 12, after: 0 },
            }),
          ]
        : []),
    ],
  }
}

/**
 * The report's pages as Word sections: its blocks placed by the PDF's page rules (`bodyParts`, `completeAt`) and
 * written by the block writers above, framed by `furniture`. Both routes draw through this.
 */
export function layoutReport(report: AssembledReport, pics: Pictures, furniture: WordFurniture): Section[] {
  const paper = report.layout.paper
  const pages = new ReportPages(paper, furniture)
  const flowOf = (kind: PageKind, look: Look = NORMAL): Flow => ({ look, ...pages.box(kind) })
  const { coverBlocks, body } = reportParts(report)

  if (report.layout.cover) {
    const flow = flowOf('cover')
    pages.own('cover', [...furniture.cover, ...coverBlocks.flatMap((b) => blocksOf(b, flow, pics))], 'center')
  } else {
    pages.flow('portrait')
    pages.add(furniture.title)
  }

  // The contents: Word's own table of contents over the sections (and the to-complete list), then the pictures.
  if (furniture.contents.length) {
    pages.flow('portrait')
    pages.add(furniture.contents)
    pages.breakNext = true
  }

  const drawTop = (block: ReportBlock) => {
    const figure = block.kind === 'figure' ? block.figure : null
    if (block.kind === 'figure' && figure && isPortraitSheet(figure)) {
      // The portrait 11 × 17 end map, full size so the scale it states is true on paper.
      const flow = flowOf('sheetPortrait')
      pages.own('sheetPortrait', [picture(figure, flow.width, flow.height - 2, flow, pics)], 'center')
      return
    }
    if (block.kind === 'figure' && figure && isSheet(figure)) {
      if (figure.map) {
        const flow = flowOf('sheetFull')
        pages.own('sheetFull', [picture(figure, flow.width, flow.height - 2, flow, pics)], 'center')
      } else sheetPage([], block, null)
      return
    }
    switch (block.kind) {
      case 'pageBreak':
        if (!pages.fresh()) pages.breakNext = true
        return
      case 'figurePage':
        pages.own('figure', figurePageBlocks(block, flowOf('figure'), pics))
        return
      case 'figurePair':
        if (block.sheet || block.landscape) {
          const kind = block.sheet ? 'sheet' : 'figure'
          pages.own(kind, figurePairBlocks(block, flowOf(kind), pics))
        } else {
          // `break-before: page`; what follows continues on its page.
          pages.flow('portrait')
          if (!pages.fresh()) pages.breakNext = true
          pages.add(figurePairBlocks(block, flowOf('portrait'), pics))
        }
        return
      case 'figureGrid':
        if (block.landscape) {
          pages.own('figure', figureGridBlocks(block, flowOf('figure'), pics))
          return
        }
    }
    pages.flow('portrait')
    pages.add(blocksOf(block, flowOf('portrait'), pics))
  }

  /** An analysis sheet on its own 11 × 17 landscape page, its headings over it and its calculation strip under it. */
  const sheetPage = (headings: readonly ReportBlock[], block: Kind<'figure'>, calc: Kind<'fields'> | null) => {
    const flow = flowOf('sheet')
    const out: Block[] = headings.flatMap((h) => blocksOf(h, flow, pics))
    const calcH = calc ? 2 * 9.4 + 8 + (calc.title ? 16 : 0) : 0
    const capH = block.caption ? 14 : 0
    const area = Math.max(40, flow.height - headings.length * 22 - calcH - capH - 14)
    if (block.figure) out.push(picture(block.figure, flow.width, area, flow, pics))
    if (block.caption) out.push(small(block.caption, CAPTION, { align: 'center' }))
    if (calc) out.push(...sheetFieldsTable(calc, flow))
    pages.own('sheet', out)
  }

  const drawPart = (part: Part) => {
    if (part.type === 'block') return drawTop(part.block)
    if (part.type === 'sheet') return sheetPage(part.headings, part.figure, part.calc)
    // A landscape page: the wide table at the small size, the headings before it and the text closing its section.
    const blocks = part.blocks.flatMap((b) => blocksOf(b, flowOf('landscape', isWide(b) ? WIDE : NORMAL), pics))
    pages.own('landscape', blocks)
  }

  const parts = bodyParts(body)
  const at = completeAt(parts)
  for (let i = 0; i < at; i++) drawPart(parts[i])

  // The reviewer's list, then the report's last line: what it is and is not.
  pages.flow('portrait')
  pages.add(furniture.closing)

  for (let i = at; i < parts.length; i++) drawPart(parts[i])

  return pages.sections.filter((section) => section.body.length)
}

/** The report's title and lines as the file's properties. */
export function reportMetadata(report: AssembledReport, options: WordReportOptions = {}): Document['metadata'] {
  return {
    title: `${reportParts(report).title} - ${report.subtitle}`,
    subject: report.about ?? '',
    ...(options.created ? { created: options.created } : {}),
  }
}

/**
 * The report as a kit document by the direct route: the PDF's pages as Word sections, every block as the kit's
 * blocks, framed by `codeFurniture`. Async only for the tick boxes it draws. The Word file itself is built through
 * the recipe engine (`recipeRoute.ts`); this is its oracle, and the two are pinned equal (`recipeRoute.test.ts`).
 */
export async function reportDocument(
  report: AssembledReport,
  logo: ReportLogo | null,
  kit: Pick<WordKit, 'imageInfo'>,
  options: WordReportOptions = {},
): Promise<Document> {
  const pics = await reportPictures(kit)
  return {
    metadata: reportMetadata(report, options),
    theme: THEME,
    sections: layoutReport(report, pics, codeFurniture(report, logo, pics)),
  }
}

/** The Word file's bytes: `reportDocument` written by the kit's Word writer, a blank value printed as a rule. */
export async function reportDocx(
  report: AssembledReport,
  logo: ReportLogo | null,
  kit: WordKit,
  options: WordReportOptions = {},
): Promise<Uint8Array> {
  const document = await reportDocument(report, logo, kit, options)
  return kit.writeDocx(document, { nullCells: 'rule', creator: 'PGMaps' })
}
