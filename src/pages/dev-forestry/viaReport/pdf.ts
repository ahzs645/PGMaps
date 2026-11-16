/**
 * An assembled VIA report as a PDF file: the same `AssembledReport` the printable HTML (`html.ts`) draws, laid out on
 * the same pages by the same rules, drawn with the jsPDF module passed in (as the block note and the field brief take
 * theirs) so the tests write a real file in Node. The paper is the recipe's, with a cover and a contents page listing
 * each section's page when the recipe asks; normal pages carry the running header and "Page n of N"; tables break
 * across pages with their header row repeated; tables wider than `WIDE_COLUMNS` print on landscape pages; analysis
 * sheets fill 11 × 17 landscape pages, map sheets print full-size; figure layouts follow `htmlFigures.ts`. Scales and
 * matrices are drawn as vectors from the block's own data (`scaleGeometry`), never rasterised. Every string goes
 * through `pdfText`, because jsPDF's standard fonts are WinAnsi; tick boxes and ticks are drawn, not typed. A picture
 * is embedded once (an alias) however many times it prints, and one that is not a PNG or JPEG prints a box saying so.
 * No DOM or network access.
 */
import { pdfText } from '@/lib/mapSheet/renderPdf'

import { layoutBlockMarks, MARK_LINE_HEIGHT } from './blockMarks'
import { closingText, imageLabel, isPortraitSheet, isSheet, isWide, type ReportLogo } from './html'
import { bandOf } from './htmlFigures'
import { scaleGeometry } from './htmlScales'
import type { AssembledReport, FieldRow, FigureSlot, FormCell, ReportBlock, ReportFigure } from './model'

type PdfModule = typeof import('jspdf')
type Pdf = InstanceType<PdfModule['jsPDF']>
type Block<K extends ReportBlock['kind']> = Extract<ReportBlock, { kind: K }>
type RGB = readonly [number, number, number]
type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'
type Align = 'left' | 'center' | 'right'
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** `pdfText`, with the double spaces its dash folding leaves closed up. */
const fold = (value: string) => pdfText(value).replace(/ {2,}/g, ' ')

const IN = 72
const MM = 72 / 25.4
/** CSS pixels to points. */
const PX = 0.75

const hex = (value: string): RGB => {
  const h = value.replace('#', '')
  const full = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as RGB
}
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
const INK = hex('#1a2530')
const SVG_INK = hex('#1f2937')
const MARK = hex('#b91c1c')
const GREY = hex('#64748b')
const MUTED = hex('#475569')
const RULE = hex('#cbd5e1')
const DASH = hex('#94a3b8')
const BAR = hex('#167aca')
const PANEL = hex('#e6e7e8')

/** A colour over white at `alpha`. */
const mix = (color: RGB, alpha: number, under: RGB = WHITE): RGB =>
  color.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha))) as unknown as RGB

/** A CSS colour as RGB over white: `#rgb`, `#rrggbb`, with alpha, or `rgb()`/`rgba()`; anything else prints as ink. */
export function cssColor(value: string | null | undefined, fallback: RGB = SVG_INK): RGB {
  if (!value) return fallback
  const v = value.trim()
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
    const h = v.slice(1)
    const alpha = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1
    return alpha < 1 ? mix(hex(v), alpha) : hex(v)
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v)
  if (m) {
    const color: RGB = [Number(m[1]), Number(m[2]), Number(m[3])]
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4])
    return a < 1 ? mix(color, a) : color
  }
  return fallback
}

interface Style {
  body: number
  lh: number
  note: number
  noteLh: number
  table: number
  tableLh: number
  pad: number
  h4: number
  gap: number
}
const NORMAL: Style = { body: 9.5, lh: 13, note: 8, noteLh: 10.5, table: 9, tableLh: 11.5, pad: 3, h4: 10, gap: 6 }
/** Inside a form's sections (`table.form-grid`, 10.5 px). */
const COMPACT: Style = {
  body: 7.9,
  lh: 10,
  note: 6.8,
  noteLh: 8.5,
  table: 7.5,
  tableLh: 9.2,
  pad: 1.5,
  h4: 7.9,
  gap: 2,
}
/** A table on a landscape page (`.wide table`, 9 px). */
const WIDE: Style = { ...NORMAL, table: 6.75, tableLh: 8.4, pad: 2 }

// ---------------------------------------------------------------------------------------------------------------------
// Pages

type PageKind = 'portrait' | 'landscape' | 'cover' | 'sheet' | 'sheetFull' | 'sheetPortrait' | 'figure'
type Paper = AssembledReport['layout']['paper']
const PAPER: Record<Paper, [number, number]> = { letter: [612, 792], legal: [612, 1008] }

interface PageSpec {
  size: [number, number]
  /** Top, right, bottom, left. */
  margin: [number, number, number, number]
  header: boolean
  number: boolean
}

/** Each page kind as `pageCss` and `FIGURES_CSS` print it. */
function pageSpec(kind: PageKind, paper: Paper): PageSpec {
  const [w, h] = PAPER[paper]
  const normal: PageSpec['margin'] = [16 * MM, 16 * MM, 18 * MM, 16 * MM]
  switch (kind) {
    case 'portrait':
      return { size: [w, h], margin: normal, header: true, number: true }
    case 'landscape':
      return { size: [h, w], margin: normal, header: true, number: true }
    case 'cover':
      return { size: [w, h], margin: normal, header: false, number: false }
    case 'sheet':
      return { size: [17 * IN, 11 * IN], margin: [8 * MM, 8 * MM, 8 * MM, 8 * MM], header: false, number: true }
    case 'sheetFull':
      return { size: [17 * IN, 11 * IN], margin: [0, 0, 0, 0], header: false, number: false }
    case 'sheetPortrait':
      return { size: [11 * IN, 17 * IN], margin: [0, 0, 0, 0], header: false, number: false }
    case 'figure':
      // `@page via-figure`: letter landscape whatever the report's paper, no running header.
      return {
        size: [11 * IN, 8.5 * IN],
        margin: [0.45 * IN, 0.5 * IN, 0.5 * IN, 0.5 * IN],
        header: false,
        number: true,
      }
  }
}

interface Ctx {
  pdf: Pdf
  mod: PdfModule
  /** Each embedded picture's alias by its data URL; null when it could not be embedded. */
  images: Map<string, string | null>
  gstates: Map<number, InstanceType<PdfModule['GState']>>
}

/**
 * Where drawing goes: a column (`x`, `w`) and a cursor (`y`) on the page. The report's own flow breaks onto new pages;
 * a flow inside a form's section or a measurement never breaks. A dry flow draws nothing and only advances, which is
 * how a block is measured before it is placed.
 */
interface Flow {
  ctx: Ctx
  x: number
  w: number
  y: number
  dry: boolean
  compact: boolean
  style: Style
  bottom(): number
  /** The height a fresh page gives. */
  pageHeight(): number
  fresh(): boolean
  breakPage(): void
  /** Something is drawn on the page (for the contents' page numbers). */
  touch(): void
}

class Pages implements Flow {
  kinds: PageKind[] = []
  /** The kind a page break continues on. */
  flowKind: PageKind = 'portrait'
  /** The next flow content starts a new page (after a page of its own, or a page break). */
  pending = false
  x = 0
  w = 0
  y = 0
  top = 0
  dry = false
  compact = false
  style = NORMAL
  private bottomY = 0
  /** The block being drawn, until it first draws something: then its page is kept in `anchors`. */
  anchor: ReportBlock | 'complete' | null = null
  anchors = new Map<ReportBlock | 'complete', number>()

  constructor(
    public ctx: Ctx,
    private paper: Paper,
  ) {}

  start(kind: PageKind) {
    const spec = pageSpec(kind, this.paper)
    // jsPDF opens with one page of the report's paper, portrait: the first page is always that (cover or title).
    if (this.kinds.length) this.ctx.pdf.addPage(spec.size, spec.size[0] > spec.size[1] ? 'landscape' : 'portrait')
    this.kinds.push(kind)
    const [t, r, b, l] = spec.margin
    this.x = l
    this.w = spec.size[0] - l - r
    this.top = t
    this.y = t
    this.bottomY = spec.size[1] - b
    this.pending = false
  }
  /** Before flow content: open the page it goes on. */
  ready() {
    if (!this.kinds.length || this.pending) this.start(this.flowKind)
  }
  bottom() {
    return this.bottomY
  }
  pageHeight() {
    return this.bottomY - this.top
  }
  fresh() {
    return this.y <= this.top + 0.01
  }
  breakPage() {
    this.start(this.flowKind)
  }
  touch() {
    if (this.anchor === null) return
    if (!this.anchors.has(this.anchor)) this.anchors.set(this.anchor, this.kinds.length)
    this.anchor = null
  }
  get page() {
    return this.kinds.length
  }
}

/** A flow inside another (a form's section, a cover's fields, a measurement): one column that never breaks. */
function inner(parent: Flow, x: number, w: number, y: number, dry: boolean, compact = parent.compact): Flow {
  return {
    ctx: parent.ctx,
    x,
    w,
    y,
    dry,
    compact,
    style: compact ? COMPACT : parent.style,
    bottom: () => Infinity,
    pageHeight: () => Infinity,
    fresh: () => false,
    breakPage: () => {},
    touch: () => {
      if (!dry) parent.touch()
    },
  }
}

/** How tall `draw` is in a `w` wide column. */
function measure(f: Flow, w: number, draw: (g: Flow) => void, compact = f.compact): number {
  const g = inner(f, 0, w, 0, true, compact)
  draw(g)
  return g.y
}

/** Moves to a new page when `h` does not fit here but fits a fresh page (or little of this page is left). */
function ensure(f: Flow, h: number) {
  if (f.y + h <= f.bottom() + 0.01 || f.fresh()) return
  if (h <= f.pageHeight() || f.bottom() - f.y < f.pageHeight() * 0.25) f.breakPage()
}

/** Takes `h` from the flow, on a new page when it does not fit; returns its top. */
function advance(f: Flow, h: number): number {
  if (f.y + h > f.bottom() + 0.01 && !f.fresh()) f.breakPage()
  const top = f.y
  f.y += h
  return top
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawing primitives (nothing drawn in a dry flow)

function font(pdf: Pdf, size: number, style: FontStyle = 'normal') {
  pdf.setFont('helvetica', style)
  pdf.setFontSize(size)
}

function wrap(pdf: Pdf, text: string, width: number, size: number, style: FontStyle = 'normal'): string[] {
  const folded = fold(text)
  if (!folded.trim()) return []
  font(pdf, size, style)
  return (pdf.splitTextToSize(folded, Math.max(4, width)) as string[]).map((line) => line.replace(/\s+$/, ''))
}

function textWidth(pdf: Pdf, text: string, size: number, style: FontStyle = 'normal'): number {
  font(pdf, size, style)
  return pdf.getTextWidth(fold(text))
}

/** The baseline of `size` type centred in a line `lh` tall starting at `top`. */
const baseline = (top: number, lh: number, size: number) => top + (lh - size) / 2 + size * 0.8

interface TextOptions {
  size: number
  style?: FontStyle
  color?: RGB
  align?: Align
  angle?: number
  stroke?: { color: RGB; width: number }
}

function put(f: Flow, text: string, x: number, y: number, o: TextOptions) {
  if (f.dry) return
  const value = fold(text)
  if (!value) return
  f.touch()
  const pdf = f.ctx.pdf
  font(pdf, o.size, o.style)
  if (o.stroke) {
    // A halo: the stroke first, the fill over it (SVG's `paint-order: stroke`).
    pdf.setDrawColor(...o.stroke.color)
    pdf.setLineWidth(o.stroke.width)
    pdf.setLineJoin('round')
    pdf.text(value, x, y, { align: o.align ?? 'left', renderingMode: 'stroke', ...(o.angle ? { angle: o.angle } : {}) })
    pdf.setLineJoin('miter')
  }
  pdf.setTextColor(...(o.color ?? INK))
  pdf.text(value, x, y, { align: o.align ?? 'left', renderingMode: 'fill', ...(o.angle ? { angle: o.angle } : {}) })
}

interface PaintOptions {
  fill?: RGB | null
  stroke?: RGB | null
  width?: number
  dash?: number[]
}

function paint(f: Flow, o: PaintOptions): 'F' | 'S' | 'FD' | null {
  const pdf = f.ctx.pdf
  if (o.fill) pdf.setFillColor(...o.fill)
  if (o.stroke) {
    pdf.setDrawColor(...o.stroke)
    pdf.setLineWidth(o.width ?? 0.75)
    pdf.setLineDashPattern(o.dash ?? [], 0)
  }
  return o.fill && o.stroke ? 'FD' : o.fill ? 'F' : o.stroke ? 'S' : null
}

function rect(f: Flow, r: Rect, o: PaintOptions) {
  if (f.dry || r.w <= 0 || r.h <= 0) return
  f.touch()
  const mode = paint(f, o)
  if (mode) f.ctx.pdf.rect(r.x, r.y, r.w, r.h, mode)
  if (o.dash) f.ctx.pdf.setLineDashPattern([], 0)
}

function line(f: Flow, x1: number, y1: number, x2: number, y2: number, color: RGB, width: number, dash?: number[]) {
  if (f.dry) return
  f.touch()
  paint(f, { stroke: color, width, dash })
  f.ctx.pdf.line(x1, y1, x2, y2)
  if (dash) f.ctx.pdf.setLineDashPattern([], 0)
}

function circle(f: Flow, x: number, y: number, r: number, o: PaintOptions) {
  if (f.dry) return
  f.touch()
  const mode = paint(f, o)
  if (mode) f.ctx.pdf.circle(x, y, r, mode)
  if (o.dash) f.ctx.pdf.setLineDashPattern([], 0)
}

function polygon(f: Flow, points: ReadonlyArray<readonly [number, number]>, o: PaintOptions, closed = true) {
  if (f.dry || points.length < 2) return
  f.touch()
  const pdf = f.ctx.pdf
  const mode = paint(f, o)
  if (!mode) return
  pdf.moveTo(points[0][0], points[0][1])
  for (const [x, y] of points.slice(1)) pdf.lineTo(x, y)
  if (closed) pdf.close()
  if (mode === 'FD') pdf.fillStroke()
  else if (mode === 'F') pdf.fill()
  else pdf.stroke()
}

/** Opacity for what follows, until `opacity(f, 1)`. */
function opacity(f: Flow, value: number) {
  if (f.dry) return
  const { ctx } = f
  let state = ctx.gstates.get(value)
  if (!state) {
    state = new ctx.mod.GState({ opacity: value, 'stroke-opacity': value })
    ctx.gstates.set(value, state)
  }
  ctx.pdf.setGState(state)
}

/** A tick box, ticked or crossed when chosen (☒ / ☐ in the HTML). */
function tickBox(f: Flow, x: number, y: number, size: number, chosen: boolean, color: RGB = INK) {
  rect(f, { x, y, w: size, h: size }, { stroke: color, width: Math.max(0.5, size * 0.08) })
  if (!chosen) return
  const i = size * 0.2
  line(f, x + i, y + i, x + size - i, y + size - i, color, size * 0.11)
  line(f, x + size - i, y + i, x + i, y + size - i, color, size * 0.11)
}

/** A check mark (✓) in a `size` square at (x, y). */
function check(f: Flow, x: number, y: number, size: number, color: RGB, width = size * 0.16) {
  if (f.dry) return
  f.touch()
  const pdf = f.ctx.pdf
  pdf.setLineCap('round')
  pdf.setLineJoin('round')
  polygon(
    f,
    [
      [x + size * 0.18, y + size * 0.52],
      [x + size * 0.42, y + size * 0.76],
      [x + size * 0.84, y + size * 0.24],
    ],
    { stroke: color, width },
    false,
  )
  pdf.setLineCap('butt')
  pdf.setLineJoin('miter')
}

// ---------------------------------------------------------------------------------------------------------------------
// Pictures

function imageFormat(url: string): 'PNG' | 'JPEG' | null {
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(url)
  return m ? (m[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG') : null
}

/**
 * Embeds a picture, once: a data URL already in the file is drawn again from its alias. False when it is not a PNG or
 * a JPEG, or does not decode.
 */
function embed(f: Flow, url: string, r: Rect): boolean {
  const { ctx } = f
  const known = ctx.images.get(url)
  if (known === null) return false
  const format = imageFormat(url)
  if (!format) {
    ctx.images.set(url, null)
    return false
  }
  if (f.dry) return true
  const alias = known ?? `img${ctx.images.size + 1}`
  try {
    f.touch()
    ctx.pdf.addImage(url, format, r.x, r.y, r.w, r.h, alias, 'FAST')
    ctx.images.set(url, alias)
    return true
  } catch {
    ctx.images.set(url, null)
    return false
  }
}

/** A dashed box with what goes there, or why the picture is missing. */
function emptyBox(f: Flow, r: Rect, text: string, size = 8.25) {
  rect(f, r, { stroke: DASH, width: 0.75, dash: [3, 2] })
  const lines = wrap(f.ctx.pdf, text, r.w - 12, size)
  const lh = size * 1.3
  let y = r.y + r.h / 2 - (lines.length * lh) / 2
  for (const l of lines) {
    put(f, l, r.x + r.w / 2, baseline(y, lh, size), { size, color: GREY, align: 'center' })
    y += lh
  }
}

const unreadable = (figure: ReportFigure) =>
  imageFormat(figure.dataUrl)
    ? `${figure.caption || figure.view}: the picture could not be read.`
    : `${figure.caption || figure.view}: the picture is not a PNG or JPEG and is not embedded.`

const aspectOf = (figure: ReportFigure, band?: { height: number } | null) =>
  figure.width > 0 && figure.height > 0 ? figure.width / (band ? band.height : figure.height) : 4 / 3

const NORTH_W = 16 * PX

/** The north arrow (`NORTH_ARROW` in `htmlFigures.ts`) with its top right corner at (right, top). */
function northArrow(f: Flow, right: number, top: number) {
  const k = NORTH_W / 16
  const x = right - NORTH_W
  const p = (px: number, py: number): [number, number] => [x + px * k, top + py * k]
  polygon(f, [p(8, 1), p(14, 15), p(8, 12), p(2, 15)], { fill: BLACK, stroke: WHITE, width: 0.8 * k })
  put(f, 'N', x + 8 * k, top + 24.5 * k, {
    size: 9 * k,
    style: 'bold',
    color: BLACK,
    align: 'center',
    stroke: { color: WHITE, width: 0.3 * k },
  })
}

/** A slot's block marks over its picture (`blockMarks` in `htmlFigures.ts`), mapped from picture pixels by `k`. */
function drawMarks(
  f: Flow,
  slot: FigureSlot,
  figure: ReportFigure,
  band: { y: number; height: number } | null,
  origin: { x: number; y: number },
  k: number,
) {
  if (!figure.marks?.length || !slot.markBlocks || f.dry) return
  const placed = layoutBlockMarks(figure.marks, figure.width, figure.height, { all: slot.markBlocks === 'all', band })
  const X = (px: number) => origin.x + px * k
  const Y = (py: number) => origin.y + py * k
  for (const mark of placed) {
    const [ax, ay] = mark.anchor
    const size = mark.size
    if (mark.unseen) {
      circle(f, X(ax), Y(ay), mark.ring * k, { stroke: WHITE, width: size * 0.28 * k })
      circle(f, X(ax), Y(ay), mark.ring * k, {
        stroke: hex('#dd0000'),
        width: size * 0.16 * k,
        dash: [size * 0.5 * k, size * 0.3 * k],
      })
    }
    if (mark.leader) {
      const [[x1, y1], [x2, y2]] = mark.leader
      const halo = (fromX: number, fromY: number, toX: number, toY: number) => {
        opacity(f, 0.55)
        line(f, X(fromX), Y(fromY), X(toX), Y(toY), BLACK, size * 0.34 * k)
        opacity(f, 1)
      }
      if (mark.unseen) {
        halo(x1, y1, x2, y2)
        line(f, X(x1), Y(y1), X(x2), Y(y2), WHITE, size * 0.14 * k)
      } else {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1
        const ux = (x2 - x1) / len,
          uy = (y2 - y1) / len
        const head = size * 0.9,
          half = size * 0.45
        const bx = x2 - ux * head,
          by = y2 - uy * head
        halo(x1, y1, x2, y2)
        line(f, X(x1), Y(y1), X(bx), Y(by), WHITE, size * 0.22 * k)
        const tip: Array<[number, number]> = [
          [X(bx - uy * half), Y(by + ux * half)],
          [X(x2), Y(y2)],
          [X(bx + uy * half), Y(by - ux * half)],
        ]
        polygon(f, tip, { fill: WHITE })
        opacity(f, 0.55)
        polygon(f, tip, { stroke: BLACK, width: size * 0.08 * k })
        opacity(f, 1)
      }
    }
    const box = mark.box
    if (box)
      mark.lines.forEach((text, i) =>
        put(f, text, X(box.x + box.w / 2), Y(box.y + size * 0.92 + i * size * MARK_LINE_HEIGHT), {
          size: size * k,
          style: 'bold',
          color: WHITE,
          align: 'center',
          stroke: { color: BLACK, width: size * 0.18 * k },
        }),
      )
  }
}

interface PictureOptions {
  /** The slot it fills, for its block marks, its panorama band and its map's north arrow. */
  slot?: FigureSlot
  /** A label in the top-left corner (`placement: 'inset'`). */
  inset?: string
  border?: RGB | null
}

/**
 * A picture in `box`: contained in it (centred), or, for a panorama slot, the band round its landform covering it; its
 * block marks, north arrow and inset label over it. A picture that cannot be embedded prints a box saying so.
 */
function picture(f: Flow, figure: ReportFigure, box: Rect, o: PictureOptions = {}) {
  const band = o.slot ? bandOf(o.slot) : null
  let drawn: Rect
  if (band) {
    const k = box.w / Math.max(1, figure.width)
    drawn = { x: box.x, y: box.y - band.y * k, w: box.w, h: figure.height * k }
  } else {
    const ar = aspectOf(figure)
    const w = Math.min(box.w, box.h * ar)
    const h = w / ar
    drawn = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
  }
  const pdf = f.ctx.pdf
  if (band && !f.dry) {
    pdf.saveGraphicsState()
    pdf.rect(box.x, box.y, box.w, box.h, null)
    pdf.clip()
    pdf.discardPath()
  }
  const ok = embed(f, figure.dataUrl, drawn)
  if (ok && o.slot) drawMarks(f, o.slot, figure, band, drawn, drawn.w / Math.max(1, figure.width))
  if (band && !f.dry) pdf.restoreGraphicsState()
  if (!ok) emptyBox(f, box, unreadable(figure))
  const map = figure.map
  if (ok && map?.northUp && !map.inPicture) northArrow(f, box.x + box.w - 3, box.y + 3)
  if (o.inset) {
    const size = 13 * PX
    const w = textWidth(pdf, o.inset, size) + 4.5
    opacity(f, 0.75)
    rect(f, { x: box.x + 4.5, y: box.y + 3, w, h: size * 1.3 }, { fill: WHITE })
    opacity(f, 1)
    put(f, o.inset, box.x + 6.75, baseline(box.y + 3, size * 1.3, size), { size, color: BLACK })
  }
  if (o.border) rect(f, box, { stroke: o.border, width: 0.75 })
}

/** Lines of small text under a picture (a note, a label, a caption), centred or not; returns the height used. */
function smallLines(
  f: Flow,
  text: string | undefined,
  x: number,
  w: number,
  o: { size: number; style?: FontStyle; color?: RGB; align?: Align; gap?: number },
): number {
  if (!text) return 0
  const lines = wrap(f.ctx.pdf, text, w, o.size, o.style)
  const lh = o.size * 1.3
  const gap = o.gap ?? 2
  let y = f.y + gap
  const at = o.align === 'center' ? x + w / 2 : x
  for (const l of lines) {
    put(f, l, at, baseline(y, lh, o.size), { size: o.size, style: o.style, color: o.color, align: o.align })
    y += lh
  }
  const h = gap + lines.length * lh
  f.y += h
  return h
}

const smallHeight = (f: Flow, text: string | undefined, w: number, size: number, style?: FontStyle, gap = 2) =>
  text ? gap + wrap(f.ctx.pdf, text, w, size, style).length * size * 1.3 : 0

// ---------------------------------------------------------------------------------------------------------------------
// Text blocks

function paragraph(
  f: Flow,
  text: string,
  o: { size?: number; style?: FontStyle; color?: RGB; lh?: number; indent?: number; gap?: number } = {},
) {
  const size = o.size ?? f.style.body
  const lh = o.lh ?? f.style.lh
  const indent = o.indent ?? 0
  const lines = wrap(f.ctx.pdf, text, f.w - indent, size, o.style)
  if (!lines.length) return
  for (const l of lines) {
    const top = advance(f, lh)
    put(f, l, f.x + indent, baseline(top, lh, size), { size, style: o.style, color: o.color })
  }
  f.y += o.gap ?? f.style.gap
}

function heading(f: Flow, text: string, level: 1 | 2 | 3 | 4) {
  if (!text.trim()) return
  const size = f.compact ? f.style.h4 : level === 1 ? 13.5 : level === 2 ? 11.5 : level === 3 ? 10 : f.style.h4
  const lh = size * 1.25
  const lines = wrap(f.ctx.pdf, text, f.w, size, 'bold')
  if (!f.fresh()) f.y += f.compact ? 1.5 : level <= 2 ? 9 : 5
  // A heading never stays behind at the foot of a page: it keeps a few lines of what follows with it.
  ensure(f, lines.length * lh + (f.compact ? 0 : 3 * f.style.lh))
  for (const l of lines) {
    const top = advance(f, lh)
    put(f, l, f.x, baseline(top, lh, size), { size, style: 'bold', color: INK })
  }
  f.y += f.compact ? 0.5 : 3
}

/** A note under a table, a scale or a matrix (`.note`). */
const note = (f: Flow, text: string | undefined) =>
  text && paragraph(f, text, { size: f.style.note, lh: f.style.noteLh, color: GREY, gap: f.compact ? 1 : 5 })

function list(f: Flow, items: readonly string[], ordered: boolean) {
  const size = f.style.body
  const lh = f.style.lh
  const indent = f.compact ? 9 : 16
  items.forEach((item, i) => {
    const lines = wrap(f.ctx.pdf, item, f.w - indent, size)
    lines.forEach((text, j) => {
      const top = advance(f, lh)
      const y = baseline(top, lh, size)
      if (j === 0) {
        if (ordered) put(f, `${i + 1}.`, f.x + indent - 3, y, { size, align: 'right' })
        else circle(f, f.x + indent - 7, y - size * 0.3, size * 0.15, { fill: INK })
      }
      put(f, text, f.x + indent, y, { size })
    })
  })
  f.y += f.style.gap
}

/** A run of text in a line that mixes weights and tick boxes. */
type Run = { text: string; bold?: boolean } | { box: boolean }
interface Seg {
  x: number
  text?: string
  bold?: boolean
  box?: boolean
}

/** Wraps runs of text and tick boxes to `width`: lines of placed segments. */
function wrapRuns(pdf: Pdf, runs: readonly Run[], width: number, size: number): Seg[][] {
  const boxW = size * 0.8
  const tokens: Array<{ text?: string; bold?: boolean; box?: boolean; w: number; space: boolean }> = []
  for (const run of runs) {
    if ('box' in run) {
      tokens.push({ box: run.box, w: boxW + size * 0.3, space: false })
      continue
    }
    const style: FontStyle = run.bold ? 'bold' : 'normal'
    if (/^\s+$/.test(run.text)) {
      // A gap of its own keeps its width (folding would close it up to one space).
      tokens.push({ text: ' ', w: textWidth(pdf, ' ', size) * run.text.length, space: true })
      continue
    }
    for (const part of fold(run.text).split(/(\s+)/)) {
      if (!part) continue
      const space = /^\s+$/.test(part)
      const text = space ? ' ' : part
      tokens.push({ text, bold: run.bold, w: textWidth(pdf, text, size, style), space })
    }
  }
  const lines: Seg[][] = [[]]
  let x = 0
  for (const token of tokens) {
    let current = lines[lines.length - 1]
    if (token.space && x === 0) continue
    if (!token.space && x > 0 && x + token.w > width) {
      // Drop the space that ended the line.
      while (current.length && current[current.length - 1].text === ' ') current.pop()
      current = []
      lines.push(current)
      x = 0
    }
    if (token.text !== undefined && token.w > width && !token.space) {
      // A word longer than the line: cut it where it fills a line.
      for (const piece of wrap(pdf, token.text, width, size, token.bold ? 'bold' : 'normal')) {
        if (x > 0) {
          current = []
          lines.push(current)
          x = 0
        }
        current.push({ x, text: piece, bold: token.bold })
        x += textWidth(pdf, piece, size, token.bold ? 'bold' : 'normal')
      }
      continue
    }
    current.push(token.box !== undefined ? { x, box: token.box } : { x, text: token.text, bold: token.bold })
    x += token.w
  }
  return lines.filter((l) => l.length)
}

function drawRuns(f: Flow, segs: readonly Seg[], x: number, top: number, lh: number, size: number) {
  const y = baseline(top, lh, size)
  for (const seg of segs) {
    if (seg.box !== undefined) tickBox(f, x + seg.x, y - size * 0.72, size * 0.8, seg.box)
    else if (seg.text) put(f, seg.text, x + seg.x, y, { size, style: seg.bold ? 'bold' : 'normal' })
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables

interface Cell {
  text: string
  style?: FontStyle
  align?: Align
  fill?: RGB | null
  color?: RGB
  /** Prints a line to fill by hand (`.blank`). */
  blank?: boolean
  /** The marked cell: ticked, outlined and bold (`td.marked`). */
  marked?: boolean
  strip?: { color: RGB; side: 'left' | 'top' }
  span?: number
}

interface Table {
  head: Cell[][]
  body: Cell[][]
  widths: number[]
  size: number
  lh: number
  pad: number
  rule: RGB
  ruleWidth: number
  /** Kept on one page when it fits one (`break-inside: avoid`). */
  avoid?: boolean
  minRowHeight?: number
}

const STRIP = 5 * PX

interface LaidCell {
  cell: Cell
  x: number
  w: number
  lines: string[]
}

const tickSize = (size: number) => size * 1.05

function layRow(f: Flow, t: Table, row: readonly Cell[]): LaidCell[] {
  let col = 0
  let x = f.x
  return row.map((cell) => {
    const span = Math.max(1, cell.span ?? 1)
    const w = t.widths.slice(col, col + span).reduce((a, b) => a + b, 0)
    col += span
    const cx = x
    x += w
    const inset = t.pad * 2 + (cell.strip?.side === 'left' ? STRIP : 0) + (cell.marked ? tickSize(t.size) + 3 : 0)
    const style = cell.marked ? 'bold' : (cell.style ?? 'normal')
    return { cell, x: cx, w, lines: cell.blank ? [] : wrap(f.ctx.pdf, cell.text, w - inset, t.size, style) }
  })
}

function rowHeight(t: Table, laid: readonly LaidCell[]): number {
  const lines = Math.max(1, ...laid.map((c) => c.lines.length))
  const strip = laid.some((c) => c.cell.strip?.side === 'top') ? STRIP : 0
  return Math.max(t.minRowHeight ?? 0, lines * t.lh + t.pad * 2 + strip)
}

function drawRow(f: Flow, t: Table, laid: readonly LaidCell[], top: number, h: number, firstLines = true) {
  const strip = laid.some((c) => c.cell.strip?.side === 'top') ? STRIP : 0
  for (const { cell, x, w, lines } of laid) {
    const r = { x, y: top, w, h }
    const fill = cell.marked ? hex('#fdf2f2') : cell.fill
    if (fill) rect(f, r, { fill })
    if (cell.strip && firstLines)
      rect(f, cell.strip.side === 'left' ? { x, y: top, w: STRIP, h } : { x, y: top, w, h: STRIP }, {
        fill: cell.strip.color,
      })
    rect(f, r, { stroke: t.rule, width: t.ruleWidth })
    if (cell.marked) rect(f, { x: x + 0.6, y: top + 0.6, w: w - 1.2, h: h - 1.2 }, { stroke: MARK, width: 1.1 })
    let tx = x + t.pad + (cell.strip?.side === 'left' ? STRIP : 0)
    const textTop = top + t.pad + strip
    if (cell.marked && firstLines) {
      const s = tickSize(t.size)
      const y = baseline(textTop, t.lh, t.size) - s * 0.85
      rect(f, { x: tx, y, w: s, h: s }, { stroke: MARK, width: 1.1 })
      check(f, tx + s * 0.08, y + s * 0.08, s * 0.84, MARK)
    }
    if (cell.marked) tx += tickSize(t.size) + 3
    if (cell.blank && firstLines) {
      const y = textTop + t.lh - 2
      line(f, tx, y, x + w - t.pad, y, GREY, 0.6)
      continue
    }
    const style = cell.marked ? 'bold' : (cell.style ?? 'normal')
    const inner = w - (tx - x) - t.pad
    lines.forEach((text, i) => {
      const at = cell.align === 'center' ? tx + inner / 2 : cell.align === 'right' ? tx + inner : tx
      put(f, text, at, baseline(textTop + i * t.lh, t.lh, t.size), {
        size: t.size,
        style,
        color: cell.color ?? INK,
        align: cell.align,
      })
    })
  }
}

/** A table that breaks across pages between rows (a row taller than a page, between its lines), its head repeated. */
function drawTable(f: Flow, t: Table) {
  const head = t.head.map((row) => layRow(f, t, row))
  const headH = head.reduce((sum, row) => sum + rowHeight(t, row), 0)
  const rows = t.body.map((row) => layRow(f, t, row))
  const heights = rows.map((row) => rowHeight(t, row))
  const total = headH + heights.reduce((a, b) => a + b, 0)
  ensure(f, t.avoid ? total : headH + (heights[0] ?? 0))
  const drawHead = () => {
    for (const row of head) {
      const h = rowHeight(t, row)
      drawRow(f, t, row, f.y, h)
      f.y += h
    }
  }
  drawHead()
  for (let r = 0; r < rows.length; r++) {
    let laid = rows[r]
    let h = heights[r]
    let first = true
    for (let guard = 0; guard < 1000; guard++) {
      if (f.y + h <= f.bottom() + 0.01) {
        drawRow(f, t, laid, f.y, h, first)
        f.y += h
        break
      }
      if (h <= f.pageHeight() - headH && f.y > f.bottom() - f.pageHeight() + headH + 0.01) {
        f.breakPage()
        drawHead()
        continue
      }
      // Taller than a page: the lines that fit here, the rest on the next page.
      const n = Math.floor((f.bottom() - f.y - t.pad * 2 - STRIP) / t.lh)
      if (n < 1) {
        f.breakPage()
        drawHead()
        continue
      }
      const part = laid.map((c) => ({ ...c, lines: c.lines.slice(0, n) }))
      const ph = rowHeight(t, part)
      drawRow(f, t, part, f.y, ph, first)
      f.y += ph
      first = false
      laid = laid.map((c) => ({ ...c, lines: c.lines.slice(n) }))
      h = Math.max(t.lh + t.pad * 2, rowHeight({ ...t, minRowHeight: 0 }, laid))
      f.breakPage()
      drawHead()
    }
  }
  f.y += f.compact ? 1.5 : 4
}

/**
 * Column widths as a browser's automatic table layout gives them: each column between its longest word and its
 * longest line, `fixed` shares first; `fill` stretches the columns to the whole width.
 */
function columnWidths(
  f: Flow,
  rows: ReadonlyArray<readonly Cell[]>,
  n: number,
  avail: number,
  size: number,
  pad: number,
  o: { fixed?: ReadonlyArray<number | null>; fill: boolean; min?: number },
): number[] {
  const pdf = f.ctx.pdf
  const max = new Array<number>(n).fill(0)
  const min = new Array<number>(n).fill(0)
  for (const row of rows) {
    let col = 0
    for (const cell of row) {
      const span = Math.max(1, cell.span ?? 1)
      if (span === 1 && col < n) {
        const style = cell.marked ? 'bold' : (cell.style ?? 'normal')
        const extra = pad * 2 + (cell.marked ? tickSize(size) + 3 : 0) + (cell.strip?.side === 'left' ? STRIP : 0)
        const text = fold(cell.text)
        const longest = Math.max(0, ...text.split('\n').map((l) => textWidth(pdf, l, size, style)))
        const word = Math.max(0, ...text.split(/\s+/).map((w) => textWidth(pdf, w, size, style)))
        max[col] = Math.max(max[col], Math.min(avail, longest + extra), cell.blank ? 30 : 0)
        min[col] = Math.max(min[col], Math.min(avail / n, word + extra))
      }
      col += span
    }
  }
  const widths = new Array<number>(n).fill(0)
  const free: number[] = []
  let rest = avail
  for (let c = 0; c < n; c++) {
    const share = o.fixed?.[c]
    if (share !== null && share !== undefined) {
      widths[c] = share * avail
      rest -= widths[c]
    } else free.push(c)
  }
  if (!free.length) return widths
  const sum = (values: number[]) => free.reduce((s, c) => s + values[c], 0)
  const sumMax = sum(max),
    sumMin = sum(min)
  if (sumMax <= 0) {
    for (const c of free) widths[c] = rest / free.length
  } else if (sumMax <= rest) {
    const target = o.fill ? rest : Math.max(sumMax, (o.min ?? 0) * avail - (avail - rest))
    for (const c of free) widths[c] = (max[c] / sumMax) * Math.min(rest, target)
  } else if (sumMin >= rest) {
    for (const c of free) widths[c] = sumMin > 0 ? (min[c] / sumMin) * rest : rest / free.length
  } else {
    for (const c of free) widths[c] = min[c] + ((max[c] - min[c]) * (rest - sumMin)) / (sumMax - sumMin)
  }
  return widths
}

const tableOf = (f: Flow, over: Partial<Table> & Pick<Table, 'head' | 'body' | 'widths'>): Table => ({
  size: f.style.table,
  lh: f.style.tableLh,
  pad: f.style.pad,
  rule: RULE,
  ruleWidth: 0.75,
  ...over,
})

function fieldsBlock(f: Flow, block: Block<'fields'>) {
  if (block.title) heading(f, block.title, 4)
  const th = f.compact ? 0.46 : 0.32
  drawTable(
    f,
    tableOf(f, {
      head: [],
      body: block.rows.map((row) => [
        { text: row.label, style: 'bold', fill: hex('#f8fafc') },
        row.value === null ? { text: '', blank: true } : { text: row.value },
      ]),
      widths: [f.w * th, f.w * (1 - th)],
      avoid: true,
    }),
  )
}

function tableBlock(f: Flow, block: Block<'table'>) {
  if (block.title) heading(f, block.title, 4)
  const n = Math.max(1, block.columns.length)
  const head: Cell[][] = [block.columns.map((c) => ({ text: c, style: 'bold', fill: hex('#f1f5f9') }))]
  const body: Cell[][] = block.rows.length
    ? block.rows.map((row) =>
        Array.from({ length: n }, (_, i) => (row[i] ? { text: row[i] } : { text: '', blank: true })),
      )
    : [[{ text: 'None', color: DASH, span: n }]]
  const widths = columnWidths(f, [...head, ...body], n, f.w, f.style.table, f.style.pad, { fill: true })
  drawTable(f, tableOf(f, { head, body, widths }))
  note(f, block.note)
}

function signature(f: Flow, block: Block<'signature'>) {
  drawTable(
    f,
    tableOf(f, {
      head: [],
      body: block.lines.map((l) => [
        { text: l, style: 'bold', fill: hex('#f8fafc') },
        { text: '', blank: true },
      ]),
      widths: [f.w * 0.32, f.w * 0.68],
      avoid: true,
      minRowHeight: f.compact ? 13.5 : 21,
    }),
  )
}

/** The calculation fields under an analysis sheet as one strip, a column per field (`sheetFieldsHtml`). */
function sheetFields(f: Flow, block: Block<'fields'>) {
  if (block.title) heading(f, block.title, 4)
  const n = Math.max(1, block.rows.length)
  drawTable(
    f,
    tableOf(f, {
      head: [block.rows.map((row) => ({ text: row.label, style: 'bold' as const, fill: hex('#f8fafc') }))],
      body: [block.rows.map((row) => (row.value === null ? { text: '', blank: true } : { text: row.value }))],
      widths: new Array<number>(n).fill(f.w / n),
      size: 7.5,
      lh: 9.4,
      pad: 2,
      avoid: true,
    }),
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Matrices and scales (`htmlScales.ts`)

function matrixBlock(f: Flow, block: Block<'matrix'>) {
  if (block.title) heading(f, block.title, 4)
  if (block.style === 'class-grid') classGrid(f, block)
  else matrixForm(f, block)
  if (!block.marks.length && !block.point && !f.compact) note(f, 'Nothing marked yet.')
  note(f, block.note)
}

function matrixForm(f: Flow, block: Block<'matrix'>) {
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const n = block.columns.length + 1
  const headFill = hex('#e2e8f0')
  const head: Cell[][] = []
  if (block.columns.length > 1 && block.columnHeader)
    head.push([
      { text: '', fill: headFill },
      { text: block.columnHeader, style: 'italic', align: 'center', fill: hex('#eef2f6'), span: block.columns.length },
    ])
  head.push([
    { text: block.rowHeader, style: 'bold', fill: headFill },
    ...block.columns.map(
      (c, i): Cell => ({
        text: c,
        style: 'bold',
        fill: headFill,
        strip: block.columnColors?.[i] ? { color: cssColor(block.columnColors[i]), side: 'top' } : undefined,
      }),
    ),
  ])
  const body: Cell[][] = block.rows.map((row, r) => [
    {
      text: row,
      style: 'bold',
      fill: hex('#f8fafc'),
      strip: block.rowColors?.[r] ? { color: cssColor(block.rowColors[r]), side: 'left' } : undefined,
    },
    ...block.columns.map((_, c): Cell => {
      const on = marked.has(`${r}:${c}`)
      const tint = block.tint?.[r]?.[c]
      return { text: block.cells[r]?.[c] ?? '', marked: on, fill: tint && !on ? mix(cssColor(tint), 0x26 / 255) : null }
    }),
  ])
  // A table of short factors stays as narrow as a form prints it rather than stretching its one column.
  const compact = block.columns.length <= 2 && block.cells.every((row) => row.every((cell) => cell.length <= 6))
  const size = f.style.table
  const widths =
    compact && f.compact
      ? [f.w * 0.72, ...block.columns.map(() => (f.w * 0.28) / Math.max(1, block.columns.length))]
      : columnWidths(f, [...head, ...body], n, f.w, size, f.style.pad, {
          fixed: compact ? undefined : [0.28],
          fill: !compact,
          min: 0.55,
        })
  drawTable(f, tableOf(f, { head, body, widths, rule: DASH, ruleWidth: 0.5, avoid: true, size, lh: f.style.tableLh }))
}

/**
 * The poster's partial-cut guide (`classGridHtml`): solid class colours with each cell's letter, a white rule where
 * the class changes, the axes named along the top and up the side, the marked cell outlined and badged, the reading's
 * X between cells, and the key under the grid.
 */
function classGrid(f: Flow, block: Block<'matrix'>) {
  const pdf = f.ctx.pdf
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const letter = (row: number, column: number) => block.letters?.[row]?.[column] ?? null
  const k = f.compact ? 0.75 : 1
  const pad = { t: 7.5 * k, r: 10.5 * k, b: 9 * k, l: 10.5 * k }
  const W = f.w - pad.l - pad.r
  const axisW = 16 * k
  const labelSize = 8.25 * k
  const labelW = Math.min(W * 0.3, Math.max(0, ...block.rows.map((r) => textWidth(pdf, r, labelSize))) + 6 * k)
  const nc = Math.max(1, block.columns.length)
  const cw = (W - axisW - labelW) / nc
  const ch = 22.5 * k
  const axisSize = 7.1 * k
  const axisH = axisSize * 1.5
  const colLines = block.columns.map((c) => wrap(pdf, c, cw - 2, labelSize))
  const colH = Math.max(1, ...colLines.map((l) => l.length)) * labelSize * 1.15 + 3 * k
  // The key: its title on a line, the items wrapped in rows.
  const keySize = 7.9 * k
  const items = (block.legend?.items ?? []).map((item) => ({
    ...item,
    w: 19.5 * k + 6 * k + textWidth(pdf, item.label.toUpperCase(), keySize) + 13.5 * k,
  }))
  const keyRows: (typeof items)[] = []
  for (const item of items) {
    const row = keyRows[keyRows.length - 1]
    if (row && row.reduce((s, i) => s + i.w, 0) + item.w <= W) row.push(item)
    else keyRows.push([item])
  }
  const keyTitleH = block.legend ? 9.4 * k * 1.4 : 0
  const keyH = block.legend ? 6 * k + keyTitleH + keyRows.length * 19.5 * k : 0
  const total = pad.t + axisH + colH + block.rows.length * ch + keyH + pad.b
  ensure(f, total)
  const top = f.y
  rect(f, { x: f.x, y: top, w: f.w, h: total }, { fill: PANEL })
  const cellsX = f.x + pad.l + axisW + labelW
  let y = top + pad.t
  put(f, block.columnHeader, cellsX + (cw * nc) / 2, baseline(y, axisH, axisSize), {
    size: axisSize,
    style: 'bold',
    color: SVG_INK,
    align: 'center',
  })
  y += axisH
  colLines.forEach((lines, c) =>
    lines.forEach((l, i) =>
      put(f, l, cellsX + c * cw + cw / 2, y + labelSize * (0.95 + i * 1.15), {
        size: labelSize,
        color: SVG_INK,
        align: 'center',
      }),
    ),
  )
  y += colH
  const rowsY = y
  // The row axis, read upwards beside the rows.
  if (block.rows.length)
    // jsPDF aligns rotated text in its own frame: start it half its length below the rows' middle.
    put(
      f,
      block.rowHeader,
      f.x + pad.l + 7.1 * k,
      rowsY + (block.rows.length * ch) / 2 + textWidth(pdf, block.rowHeader, axisSize, 'bold') / 2,
      { size: axisSize, style: 'bold', color: SVG_INK, angle: 90 },
    )
  block.rows.forEach((row, r) => {
    const cy = rowsY + r * ch
    put(f, row, cellsX - 4.5 * k, baseline(cy, ch, labelSize), { size: labelSize, color: SVG_INK, align: 'right' })
    block.columns.forEach((_, c) => {
      const x = cellsX + c * cw
      const own = letter(r, c)
      const fill = block.tint?.[r]?.[c]
      const b = 1.5 * k
      if (fill) rect(f, { x: x + b, y: cy + b, w: cw - 2 * b, h: ch - 2 * b }, { fill: cssColor(fill) })
      // A change of class: a white rule on that side.
      const edge = 3 * k
      if (c + 1 < nc && letter(r, c + 1) !== own) rect(f, { x: x + cw - edge, y: cy, w: edge, h: ch }, { fill: WHITE })
      if (c > 0 && letter(r, c - 1) !== own) rect(f, { x, y: cy, w: edge, h: ch }, { fill: WHITE })
      if (r + 1 < block.rows.length && letter(r + 1, c) !== own)
        rect(f, { x, y: cy + ch - edge, w: cw, h: edge }, { fill: WHITE })
      if (r > 0 && letter(r - 1, c) !== own) rect(f, { x, y: cy, w: cw, h: edge }, { fill: WHITE })
      const value = block.cells[r]?.[c] ?? ''
      const showValue = !!own && block.cellValues !== false && !!value
      const big = 9.75 * k,
        small = 6.75 * k
      const textH = showValue ? big + small * 1.1 : big
      const ty = cy + (ch - textH) / 2
      put(f, own ?? value, x + cw / 2, ty + big * 0.8, { size: big, style: 'bold', color: WHITE, align: 'center' })
      if (showValue) put(f, value, x + cw / 2, ty + big + small * 0.85, { size: small, color: WHITE, align: 'center' })
      if (marked.has(`${r}:${c}`)) {
        const o = 2.25 * k
        rect(f, { x: x + o / 2, y: cy + o / 2, w: cw - o, h: ch - o }, { stroke: MARK, width: o })
        const radius = 5.6 * k
        const bx = x + cw + 4.5 * k - radius,
          by = cy - 5.25 * k + radius
        circle(f, bx, by, radius, { fill: MARK })
        check(f, bx - radius * 0.6, by - radius * 0.6, radius * 1.2, WHITE, radius * 0.28)
      }
    })
  })
  // The reading's X, offset by its fractions so it can land on a rule.
  const p = block.point
  if (p && block.rows.length) {
    const r0 = Math.min(block.rows.length - 1, Math.max(0, Math.floor(p.row + 0.5)))
    const c0 = Math.min(nc - 1, Math.max(0, Math.floor(p.column)))
    const cx = cellsX + c0 * cw + (p.column - c0 + 0.5) * cw
    const cy = rowsY + r0 * ch + (p.row - r0 + 0.5) * ch
    const size = 22.5 * k
    put(f, 'X', cx, cy + size * 0.36, { size, style: 'bold', color: hex('#111111'), align: 'center' })
  }
  y = rowsY + block.rows.length * ch
  if (block.legend) {
    y += 6 * k
    put(f, block.legend.title, f.x + pad.l, baseline(y, keyTitleH, 9.4 * k), {
      size: 9.4 * k,
      style: 'bold',
      color: SVG_INK,
    })
    y += keyTitleH
    for (const row of keyRows) {
      let x = f.x + pad.l
      for (const item of row) {
        rect(f, { x, y: y + 1.5 * k, w: 19.5 * k, h: 15 * k }, { fill: cssColor(item.color) })
        put(f, item.label.toUpperCase(), x + 25.5 * k, baseline(y + 1.5 * k, 15 * k, keySize), {
          size: keySize,
          color: SVG_INK,
        })
        x += item.w
      }
      y += 19.5 * k
    }
  }
  f.y = top + total + (f.compact ? 2 : 5)
}

/** The scale drawn from SVG units (`scaleSvg`) at (x0, y0), `s` points a unit. */
interface ScalePen {
  f: Flow
  x0: number
  y0: number
  s: number
}
const sx = (p: ScalePen, v: number) => p.x0 + v * p.s
const sy = (p: ScalePen, v: number) => p.y0 + v * p.s

function svgText(
  p: ScalePen,
  text: string,
  x: number,
  y: number,
  size: number,
  o: { color?: RGB; bold?: boolean; align?: Align; halo?: boolean } = {},
) {
  put(p.f, text, sx(p, x), sy(p, y), {
    size: size * p.s,
    style: o.bold ? 'bold' : 'normal',
    color: o.color ?? SVG_INK,
    align: o.align,
    stroke: o.halo ? { color: WHITE, width: 3.5 * p.s } : undefined,
  })
}

function svgLine(p: ScalePen, x1: number, y1: number, x2: number, y2: number, color: RGB, width: number) {
  line(p.f, sx(p, x1), sy(p, y1), sx(p, x2), sy(p, y2), color, width * p.s)
}

function svgRect(p: ScalePen, x: number, y: number, w: number, h: number, o: PaintOptions) {
  rect(p.f, { x: sx(p, x), y: sy(p, y), w: w * p.s, h: h * p.s }, { ...o, width: (o.width ?? 1) * p.s })
}

function svgPoly(p: ScalePen, points: ReadonlyArray<readonly [number, number]>, fill: RGB) {
  polygon(
    p.f,
    points.map(([x, y]) => [sx(p, x), sy(p, y)] as const),
    { fill },
  )
}

/** A downward arrow with its tip at (x, y): the reading. */
function downArrow(p: ScalePen, x: number, top: number, y: number) {
  svgLine(p, x, top, x, y - 7, MARK, 2.4)
  svgPoly(
    p,
    [
      [x - 5.5, y - 9],
      [x + 5.5, y - 9],
      [x, y],
    ],
    MARK,
  )
}

function markText(p: ScalePen, x: number, y: number, text: string, width: number) {
  if (!text) return
  const right = x > width - 150
  svgText(p, text, right ? x - 8 : x + 8, y, 11, { color: MARK, bold: true, align: right ? 'right' : 'left' })
}

function scaleHeight(block: Block<'scale'>): number {
  switch (block.style) {
    case 'arrow-axis':
      return block.ticks.some((tick) => tick.label) ? 74 : 58
    case 'guide':
      return (block.mark === null ? 34 : 50) + 26 * block.bands.length + 8
    default:
      return 22 + 22 + 24
  }
}

function arrowAxis(p: ScalePen, block: Block<'scale'>) {
  const g = scaleGeometry(block)
  const yLabel = 30,
    yAxis = 44,
    band = 8
  const tickLabels = block.ticks.some((tick) => tick.label)
  block.bands.forEach((b, i) => {
    const { x0, x1 } = g.bands[i]
    if (x1 - x0 > 0.5 && b.color) svgRect(p, x0, yAxis, x1 - x0, band, { fill: mix(cssColor(b.color), 0.4) })
  })
  const edges = new Set<number>()
  for (const b of g.bands) edges.add(b.x0).add(b.x1)
  for (const t of g.ticks) if (t.x <= g.end) edges.add(t.x)
  for (const x of edges) svgLine(p, x, yAxis - 7, x, yAxis + band, SVG_INK, 1.3)
  svgLine(p, g.start, yAxis, g.tip - 7, yAxis, SVG_INK, 1.6)
  svgPoly(
    p,
    [
      [g.tip - 9, yAxis - 4.5],
      [g.tip, yAxis],
      [g.tip - 9, yAxis + 4.5],
    ],
    SVG_INK,
  )
  block.bands.forEach((b, i) => {
    const x = g.bands[i].centre
    svgLine(p, x, yAxis - 6, x, yAxis + band, cssColor(b.color), 1.6)
  })
  if (g.markX !== null) {
    downArrow(p, g.markX, 4, yAxis - 1)
    markText(p, g.markX, 12, block.markLabel ?? '', g.width)
  }
  // The labels over the reading's arrow, their halo keeping them legible where it crosses them.
  block.bands.forEach((b, i) =>
    svgText(p, b.label, g.bands[i].centre, yLabel, 13, {
      color: cssColor(b.color),
      bold: true,
      align: 'center',
      halo: true,
    }),
  )
  if (tickLabels) {
    if (block.axisLabel) svgText(p, block.axisLabel, g.start - 10, yAxis + 25, 11, { align: 'right' })
    for (const t of g.ticks) if (t.label) svgText(p, t.label, t.x, yAxis + 25, 11, { align: 'center' })
  }
}

function guide(p: ScalePen, block: Block<'scale'>) {
  const g = scaleGeometry(block)
  const top = block.mark === null ? 34 : 50,
    row = 26,
    bottom = top + row * block.bands.length
  block.bands.forEach((b, i) => {
    const y = top + i * row
    const { x0, x1 } = g.bands[i]
    const chosen = block.markBand === i
    const last = i === block.bands.length - 1
    const color = cssColor(b.color)
    if (chosen) svgRect(p, 0, y, g.end, row, { fill: mix(color, 0.14) })
    svgText(p, b.name ?? b.label, 4, y + 17, 12.5, { bold: chosen })
    svgText(p, b.range ?? '', g.start - 14, y + 17, 12.5, { bold: chosen, align: 'right' })
    if (x1 - x0 > 0.5) {
      svgRect(p, x0, y + 3, x1 - x0, row - 6, { fill: color })
      if (last) {
        svgPoly(
          p,
          [
            [x1, y + 3],
            [g.tip, y + row / 2],
            [x1, y + row - 3],
          ],
          color,
        )
        svgText(p, '+', x1 + 5, y + row / 2 + 4, 11, { color: WHITE, bold: true, align: 'center' })
      }
    }
  })
  for (const x of [g.start, g.end]) svgLine(p, x, top, x, bottom, RULE, 1)
  for (let i = 0; i <= block.bands.length; i++) svgLine(p, 0, top + i * row, g.end, top + i * row, SVG_INK, 0.9)
  if (g.markX !== null) {
    line(p.f, sx(p, g.markX), sy(p, top), sx(p, g.markX), sy(p, bottom + 4), MARK, 1.6 * p.s, [4 * p.s, 3 * p.s])
    downArrow(p, g.markX, 6, top)
    markText(p, g.markX, 15, block.markLabel ?? '', g.width)
  }
  for (const t of g.ticks) {
    svgText(p, t.label, t.x, top - 12, 11.5, { align: 'center', halo: true })
    svgLine(p, t.x, top - 7, t.x, top - 3, SVG_INK, 1)
  }
}

function bar(p: ScalePen, block: Block<'scale'>) {
  const g = scaleGeometry(block)
  const top = 22,
    h = 22
  block.bands.forEach((band, i) => {
    const { x0, x1 } = g.bands[i]
    svgRect(p, x0, top, Math.max(1, x1 - x0), h, {
      fill: mix(cssColor(band.color, hex('#e5e7eb')), 0.35),
      stroke: hex('#555555'),
      width: 0.6,
    })
    svgText(p, band.label, (x0 + x1) / 2, top + h / 2 + 4, 11, { align: 'center' })
  })
  for (const t of g.ticks) {
    svgLine(p, t.x, top + h, t.x, top + h + 5, hex('#333333'), 1)
    svgText(p, t.label, t.x, top + h + 17, 10, { align: 'center' })
  }
  if (g.markX !== null) {
    svgPoly(
      p,
      [
        [g.markX - 6, 4],
        [g.markX + 6, 4],
        [g.markX, top - 2],
      ],
      MARK,
    )
    markText(p, g.markX, 13, block.markLabel ?? '', g.width)
  }
}

function scaleBlock(f: Flow, block: Block<'scale'>) {
  if (block.title) heading(f, block.title, 4)
  // `svg.scale{max-width:640px}`, the arrow axis the whole width, 470 px inside a form.
  const max = f.compact ? 470 * PX : block.style === 'arrow-axis' ? f.w : 640 * PX
  const w = Math.min(f.w, max)
  const s = w / 640
  const h = scaleHeight(block) * s
  ensure(f, h + 4)
  const p: ScalePen = { f, x0: f.x, y0: f.y, s }
  if (block.style === 'arrow-axis') arrowAxis(p, block)
  else if (block.style === 'guide') guide(p, block)
  else bar(p, block)
  f.y += h + (f.compact ? 2 : 6)
  if (block.mark === null && !f.compact) note(f, 'Nothing marked yet.')
  note(f, block.note)
}

// ---------------------------------------------------------------------------------------------------------------------
// Choices and forms

function choices(f: Flow, block: Block<'choices'>) {
  const pdf = f.ctx.pdf
  const size = f.style.body
  const lh = f.style.lh
  if (!block.boxed) {
    const runs: Run[] = [{ text: block.label, bold: true }]
    for (const option of block.options)
      runs.push({ text: '   ' }, { box: option === block.chosen }, { text: ' ' }, { text: option })
    if (block.answer) runs.push({ text: '   ' }, { text: block.answer, bold: true })
    const lines = wrapRuns(pdf, runs, f.w, size)
    ensure(f, lines.length * lh)
    for (const segs of lines) drawRuns(f, segs, f.x, advance(f, lh), lh, size)
    f.y += f.style.gap
    return
  }
  // A ruled box: the question and its answer on the left, the tick boxes on the right (`table.answer-box`).
  const pad = f.compact ? 2 : 4.5
  const ticksW = Math.min(f.w * 0.4, 90)
  const leftW = f.w - ticksW
  const label = wrap(pdf, block.label, leftW - pad * 2, size)
  const answer =
    block.answer === undefined ? null : block.answer ? wrap(pdf, block.answer, leftW - pad * 2, size, 'bold') : []
  const leftH = (label.length + (answer === null ? 0 : Math.max(1, answer.length))) * lh
  const options = block.options.map((o) =>
    wrapRuns(pdf, [{ box: o === block.chosen }, { text: ' ' }, { text: o }], ticksW - 2 * pad, size),
  )
  const rightH = options.reduce((s, o) => s + o.length, 0) * lh
  const h = Math.max(leftH, rightH, lh) + pad * 2
  if (!f.fresh()) f.y += f.compact ? 1 : 5
  ensure(f, h)
  const top = f.y
  let y = top + pad
  for (const l of label) {
    put(f, l, f.x + pad, baseline(y, lh, size), { size })
    y += lh
  }
  if (answer !== null) {
    if (!answer.length) line(f, f.x + pad, y + lh - 2, f.x + Math.min(leftW - pad, 120 + pad), y + lh - 2, GREY, 0.6)
    for (const l of answer) {
      put(f, l, f.x + pad, baseline(y, lh, size), { size, style: 'bold' })
      y += lh
    }
  }
  y = top + pad
  for (const o of options)
    for (const segs of o) {
      drawRuns(f, segs, f.x + leftW + pad, y, lh, size)
      y += lh
    }
  rect(f, { x: f.x, y: top, w: leftW, h }, { stroke: INK, width: 0.75 })
  rect(f, { x: f.x + leftW, y: top, w: ticksW, h }, { stroke: INK, width: 0.75 })
  f.y = top + h + (f.compact ? 1 : 5)
}

/** A section's first table or scale without its own title when the section's title bar already prints it. */
function untitled(block: ReportBlock, sectionTitle: string): ReportBlock {
  return (block.kind === 'matrix' || block.kind === 'scale') &&
    sectionTitle.toLowerCase().includes(block.title.toLowerCase())
    ? { ...block, title: '' }
    : block
}

/**
 * A form's sections as one ruled table, a section or two side by side per row, each row kept on a page; a row taller
 * than a page prints its sections one under the other.
 */
function form(f: Flow, block: Block<'form'>) {
  const pdf = f.ctx.pdf
  const titleSize = 7.9
  const titleLh = titleSize * 1.3
  const pad = { x: 4.5, t: 1.5, b: 2.25 }
  const content = (g: Flow, cell: FormCell) =>
    cell.blocks.forEach((b, i) => drawBlock(g, i ? b : untitled(b, cell.title)))
  for (const row of block.rows.filter((r) => r.length)) {
    const cells = row.slice(0, 2).map((cell, i) => {
      const w = row.length === 1 ? f.w : f.w / 2
      return { cell, x: f.x + i * (f.w / 2), w, title: wrap(pdf, cell.title, w - 9, titleSize, 'bold') }
    })
    const barH = Math.max(...cells.map((c) => c.title.length)) * titleLh + 3
    const heights = cells.map((c) => measure(f, c.w - pad.x * 2, (g) => content(g, c.cell), true))
    const h = barH + Math.max(...heights) + pad.t + pad.b
    if (h <= f.pageHeight()) {
      ensure(f, h)
      const top = f.y
      for (const c of cells) {
        rect(f, { x: c.x, y: top, w: c.w, h: barH }, { fill: hex('#d9dee4'), stroke: INK, width: 0.75 })
        c.title.forEach((l, i) =>
          put(f, l, c.x + 4.5, baseline(top + 1.5 + i * titleLh, titleLh, titleSize), {
            size: titleSize,
            style: 'bold',
          }),
        )
        rect(f, { x: c.x, y: top + barH, w: c.w, h: h - barH }, { stroke: INK, width: 0.75 })
        const g = inner(f, c.x + pad.x, c.w - pad.x * 2, top + barH + pad.t, f.dry, true)
        content(g, c.cell)
      }
      f.y = top + h
    } else {
      // Too tall to keep together: each section under its title bar, one after the other.
      const was = { compact: f.compact, style: f.style }
      f.compact = true
      f.style = COMPACT
      for (const c of cells) {
        const lines = wrap(pdf, c.cell.title, f.w - 9, titleSize, 'bold')
        const bh = lines.length * titleLh + 3
        ensure(f, bh + 30)
        rect(f, { x: f.x, y: f.y, w: f.w, h: bh }, { fill: hex('#d9dee4'), stroke: INK, width: 0.75 })
        lines.forEach((l, i) =>
          put(f, l, f.x + 4.5, baseline(f.y + 1.5 + i * titleLh, titleLh, titleSize), {
            size: titleSize,
            style: 'bold',
          }),
        )
        f.y += bh + pad.t
        content(f, c.cell)
        f.y += pad.b
      }
      f.compact = was.compact
      f.style = was.style
    }
  }
  f.y += f.compact ? 2 : 4
}

// ---------------------------------------------------------------------------------------------------------------------
// Figures (`html.ts` `figure`, `htmlFigures.ts`)

const CAPTION = 8.25
const BOLD_CAPTION = 8.25

/** A figure in the flow: as wide as the text (no wider than its pixels), its caption under it, kept together. */
function figureBlock(f: Flow, block: Block<'figure'>) {
  const pdf = f.ctx.pdf
  const capH = smallHeight(f, block.caption, f.w, CAPTION, 'normal', 3)
  if (!block.figure) {
    const lines = wrap(pdf, block.placeholder ?? 'Figure to come', f.w - 36, f.style.body)
    const h = 18 * 2 + lines.length * f.style.lh + capH
    if (!f.fresh()) f.y += 9
    ensure(f, h)
    const top = f.y
    rect(f, { x: f.x, y: top, w: f.w, h }, { stroke: DASH, width: 0.75, dash: [3, 2] })
    lines.forEach((l, i) =>
      put(f, l, f.x + f.w / 2, baseline(top + 18 + i * f.style.lh, f.style.lh, f.style.body), {
        size: f.style.body,
        color: DASH,
        align: 'center',
      }),
    )
    f.y = top + 18 + lines.length * f.style.lh
    smallLines(f, block.caption, f.x, f.w, { size: CAPTION, color: DASH, align: 'center', gap: 3 })
    f.y = top + h + 9
    return
  }
  const figure = block.figure
  const ar = aspectOf(figure)
  let w = Math.min(f.w, figure.width > 0 ? figure.width * PX : f.w)
  let h = w / ar
  const room = f.pageHeight() - capH - 4
  if (h > room) {
    h = room
    w = h * ar
  }
  if (!f.fresh()) f.y += 9
  ensure(f, h + capH)
  picture(f, figure, { x: f.x, y: f.y, w, h }, { border: RULE })
  f.y += h
  smallLines(f, block.caption, f.x, f.w, { size: CAPTION, color: MUTED, gap: 3 })
  f.y += 9
}

/** The legend and scale under a map (`mapKey`), unless the picture prints its own; returns its height. */
function mapKey(f: Flow, figure: ReportFigure | null, x: number, w: number): number {
  const map = figure?.map
  if (!map || map.inPicture) return 0
  const pdf = f.ctx.pdf
  const size = 7.5
  const items = [
    ...(map.legend ?? []).map((row) => ({ ...row, bold: false, swatch: true })),
    ...(map.scale ? [{ label: map.scale, color: '', kind: undefined, bold: true, swatch: false }] : []),
  ].map((item) => ({
    ...item,
    w: (item.swatch ? 16.5 : 0) + textWidth(pdf, item.label, size, item.bold ? 'bold' : 'normal') + 10.5,
  }))
  if (!items.length) return 0
  const lh = 12
  const rows: (typeof items)[] = []
  for (const item of items) {
    const row = rows[rows.length - 1]
    if (row && row.reduce((s, i) => s + i.w, 0) + item.w <= w) row.push(item)
    else rows.push([item])
  }
  const top = f.y + 3
  rows.forEach((row, r) => {
    let cx = x
    const y = top + r * lh
    for (const item of row) {
      if (item.swatch) {
        const color = cssColor(item.color)
        if (item.kind === 'line') line(f, cx, y + lh / 2, cx + 13.5, y + lh / 2, color, 2.25)
        else if (item.kind === 'point')
          circle(f, cx + 3.4, y + lh / 2, 3.4, { fill: color, stroke: MUTED, width: 0.75 })
        else rect(f, { x: cx, y: y + lh / 2 - 3.75, w: 13.5, h: 7.5 }, { fill: color, stroke: MUTED, width: 0.75 })
        cx += 16.5
      }
      put(f, item.label, cx, baseline(y, lh, size), { size, style: item.bold ? 'bold' : 'normal' })
      cx += item.w - (item.swatch ? 16.5 : 0)
    }
  })
  const h = 3 + rows.length * lh
  f.y += h
  return h
}

const mapKeyHeight = (f: Flow, figure: ReportFigure | null, w: number) => measure(f, w, (g) => mapKey(g, figure, 0, w))

/** A slot's picture box and size when fitted (`.vf-fit`): `maxW` points wide at most, its picture's shape. */
function fitted(slot: FigureSlot, maxW: number, emptyH: number, availW: number): { w: number; h: number } {
  if (!slot.figure) return { w: availW, h: emptyH }
  const ar = aspectOf(slot.figure, bandOf(slot))
  const w = Math.min(availW, maxW * ar)
  return { w, h: w / ar }
}

function slotPicture(f: Flow, slot: FigureSlot, box: Rect, inset?: string) {
  if (slot.figure) picture(f, slot.figure, box, { slot, inset, border: BLACK })
  else emptyBox(f, box, slot.placeholder)
}

/** A map across the page with its legend, scale and north arrow, and its caption (`mapFigureHtml`). */
function mapFigure(f: Flow, block: Block<'mapFigure'>) {
  const slot = block.slot
  let { w, h } = fitted(slot, (block.compact ? 4.2 : 7.2) * IN, 3.5 * IN, f.w)
  const keyH = mapKeyHeight(f, slot.figure, f.w)
  const noteH = slot.figure ? smallHeight(f, slot.note, f.w, 6.75) : 0
  const capH = smallHeight(f, block.caption, f.w, BOLD_CAPTION, 'bold', 3)
  const room = f.pageHeight() - keyH - noteH - capH
  if (h > room) {
    w *= room / h
    h = room
  }
  if (!f.fresh()) f.y += 9
  ensure(f, h + keyH + noteH + capH)
  slotPicture(f, slot, { x: f.x + (f.w - w) / 2, y: f.y, w, h })
  f.y += h
  mapKey(f, slot.figure, f.x, f.w)
  if (slot.figure) smallLines(f, slot.note, f.x, f.w, { size: 6.75, color: MUTED })
  smallLines(f, block.caption, f.x, f.w, { size: BOLD_CAPTION, style: 'bold', color: INK, gap: 3 })
  f.y += 9
}

/** Pictures side by side, each labelled, one caption for all (`figureGridHtml`). */
function figureGrid(f: Flow, block: Block<'figureGrid'>) {
  const cols = block.columns
  const gap = 9
  const cw = (f.w - gap * (cols - 1)) / cols
  const cells = block.slots.map((slot) => {
    const size = block.landscape ? fitted(slot, 5.6 * IN, 1.8 * IN, cw) : fitted(slot, Infinity, 1.8 * IN, cw)
    const label = slot.figure ? slot.label : undefined
    const extra = smallHeight(f, label, cw, 7.5) + (slot.figure ? smallHeight(f, slot.note, cw, 6.75) : 0)
    return { slot, ...size, label, extra }
  })
  const rows: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols))
  const capH = smallHeight(f, block.caption, f.w, BOLD_CAPTION, 'bold', 3)
  const rowHeights = () => rows.map((row) => Math.max(...row.map((c) => c.h + c.extra)) + gap)
  let total = rowHeights().reduce((a, b) => a + b, 0) + capH
  if (total > f.pageHeight()) {
    // Shrink the pictures so the grid keeps to its page.
    const pics = rows.reduce((s, row) => s + Math.max(...row.map((c) => c.h)), 0)
    const k = Math.max(0.2, (f.pageHeight() - (total - pics)) / pics)
    for (const c of cells) {
      c.w *= k
      c.h *= k
    }
    total = rowHeights().reduce((a, b) => a + b, 0) + capH
  }
  if (!f.fresh()) f.y += 9
  ensure(f, total)
  const heights = rowHeights()
  rows.forEach((row, r) => {
    ensure(f, heights[r])
    const top = f.y
    row.forEach((c, i) => {
      const x = f.x + i * (cw + gap)
      slotPicture(f, c.slot, { x: x + (cw - c.w) / 2, y: top, w: c.w, h: c.h })
      f.y = top + c.h
      smallLines(f, c.label, x, cw, { size: 7.5, color: MUTED })
      if (c.slot.figure) smallLines(f, c.slot.note, x, cw, { size: 6.75, color: MUTED })
    })
    f.y = top + heights[r]
  })
  smallLines(f, block.caption, f.x, f.w, { size: BOLD_CAPTION, style: 'bold', color: INK, gap: 0 })
  f.y += 9
}

/**
 * Pictures of one view stacked (`figurePairHtml`): each as wide as its page kind allows, its label inset or under it,
 * the pair's caption last. A pair that would not fit its page is drawn smaller, never across two.
 */
function figurePair(f: Flow, block: Block<'figurePair'>) {
  const named = (s: FigureSlot) => !!block.title && block.title.includes(s.label)
  const maxW = (block.sheet ? 9.4 : block.landscape ? 6.3 : 3.9) * IN
  const emptyH = (block.sheet ? 6 : 2.4) * IN
  const titleH = block.title ? measure(f, f.w, (g) => heading(g, block.title ?? '', 4)) : 0
  const capH = smallHeight(f, block.caption, f.w, 8.25, 'normal', 4.5)
  const items = block.slots.map((slot) => {
    const label = block.placement === 'caption' && !named(slot) ? slot.label : undefined
    const extra =
      smallHeight(f, label, f.w, BOLD_CAPTION, 'bold', 3) + (slot.figure ? smallHeight(f, slot.note, f.w, 6.75) : 0)
    return { slot, label, extra, ...fitted(slot, maxW, emptyH, f.w) }
  })
  const gap = block.sheet ? 6 : 12
  const room = f.bottom() - f.y - titleH - capH - items.reduce((s, i) => s + i.extra + gap, 0)
  if (block.sheet) {
    // Each picture shares the sheet's height (`flex: 1 1 auto`), contained and centred.
    const each = room / Math.max(1, items.length)
    for (const item of items) {
      if (item.h > each) {
        item.w *= each / item.h
        item.h = each
      }
    }
  } else {
    const pics = items.reduce((s, i) => s + i.h, 0)
    if (pics > room && pics > 0) {
      const k = Math.max(0.2, room / pics)
      for (const item of items) {
        item.w *= k
        item.h *= k
      }
    }
  }
  if (block.title) heading(f, block.title, 4)
  if (block.sheet) {
    const each = (f.bottom() - f.y - capH) / Math.max(1, items.length)
    for (const item of items) {
      const top = f.y + Math.max(0, (each - item.h - item.extra) / 2)
      slotPicture(
        f,
        item.slot,
        { x: f.x + (f.w - item.w) / 2, y: top, w: item.w, h: item.h },
        block.placement === 'inset' ? item.slot.label : undefined,
      )
      const was = f.y
      f.y = top + item.h
      smallLines(f, item.label, f.x, f.w, { size: BOLD_CAPTION, style: 'bold', color: INK, gap: 3, align: 'center' })
      if (item.slot.figure) smallLines(f, item.slot.note, f.x, f.w, { size: 6.75, color: MUTED, align: 'center' })
      f.y = was + each
    }
  } else {
    for (const item of items) {
      ensure(f, item.h + item.extra)
      slotPicture(
        f,
        item.slot,
        { x: f.x + (f.w - item.w) / 2, y: f.y, w: item.w, h: item.h },
        block.placement === 'inset' ? item.slot.label : undefined,
      )
      f.y += item.h
      smallLines(f, item.label, f.x, f.w, { size: BOLD_CAPTION, style: 'bold', color: INK, gap: 3 })
      if (item.slot.figure) smallLines(f, item.slot.note, f.x, f.w, { size: 6.75, color: MUTED })
      f.y += gap
    }
  }
  smallLines(f, block.caption, f.x, f.w, { size: 8.25, color: INK, gap: 4.5 })
}

/** One place on a figure page: its header bar, its picture or what goes there, and its note (`.vf-slot`). */
function barSlot(f: Flow, slot: FigureSlot, box: Rect) {
  const pdf = f.ctx.pdf
  const label = slot.label.toUpperCase()
  let size = 8.25
  while (size > 5 && textWidth(pdf, label, size, 'bold') > box.w - 6) size -= 0.25
  const barH = size * 1.3 + 3
  rect(f, { x: box.x, y: box.y, w: box.w, h: barH }, { fill: BAR, stroke: BLACK, width: 0.75 })
  put(f, label, box.x + box.w / 2, baseline(box.y + 1.5, size * 1.3, size), {
    size,
    style: 'bold',
    color: WHITE,
    align: 'center',
  })
  const noteH = slot.figure ? smallHeight(f, slot.note, box.w, 6.75) : 0
  const pic = { x: box.x, y: box.y + barH, w: box.w, h: Math.max(10, box.h - barH - noteH) }
  if (slot.figure) picture(f, slot.figure, pic, { slot, border: BLACK })
  else emptyBox(f, pic, slot.placeholder)
  f.y = pic.y + pic.h
  if (slot.figure) smallLines(f, slot.note, box.x, box.w, { size: 6.75, color: MUTED })
}

const BAR_H = 8.25 * 1.3 + 3

/**
 * The figure page on its own letter landscape page (`figurePageHtml`): a title box and a box of project facts over the
 * maps in a 2.3 in column, the before and after pictures stacked on the right, each place under a header bar.
 */
function figurePage(f: Flow, block: Block<'figurePage'>) {
  const pdf = f.ctx.pdf
  const H = Math.min(7.3 * IN, f.bottom() - f.y)
  const top = f.y
  const sideW = 2.3 * IN
  const mainX = f.x + sideW + 0.1 * IN
  const mainW = f.w - sideW - 0.1 * IN
  const size = 8.25
  const lh = size * 1.3
  const gapSide = 0.08 * IN
  // The title box: the number, then the title.
  const titleLines = [fold(block.number), ...wrap(pdf, block.title, sideW - 9, size, 'bold')]
  const titleH = titleLines.length * lh + 4.5
  rect(f, { x: f.x, y: top, w: sideW, h: titleH }, { stroke: BLACK, width: 0.75 })
  titleLines.forEach((l, i) =>
    put(f, l, f.x + sideW / 2, baseline(top + 2.25 + i * lh, lh, size), {
      size,
      style: 'bold',
      color: BLACK,
      align: 'center',
    }),
  )
  // The facts, a line each, a blank to fill where nobody has given one.
  const factLines = block.facts.map((row: FieldRow) => ({
    lines: wrap(pdf, `${row.label}: ${row.value ?? ''}`, sideW - 9 - (row.value === null ? 52.5 : 0), size, 'bold'),
    blank: row.value === null,
  }))
  const factsH = factLines.reduce((s, r) => s + Math.max(1, r.lines.length) * lh, 0) + 4.5
  const factsTop = top + titleH + gapSide
  if (block.facts.length) {
    rect(f, { x: f.x, y: factsTop, w: sideW, h: factsH }, { stroke: BLACK, width: 0.75 })
    let y = factsTop + 2.25
    for (const row of factLines) {
      row.lines.forEach((l, i) => {
        const last = i === row.lines.length - 1
        const lineW = textWidth(pdf, l, size, 'bold') + (row.blank && last ? 55 : 0)
        const x = f.x + (sideW - lineW) / 2
        put(f, l, x, baseline(y, lh, size), { size, style: 'bold', color: BLACK })
        if (row.blank && last) line(f, x + lineW - 52.5, y + lh - 2, x + lineW, y + lh - 2, BLACK, 0.6)
        y += lh
      })
    }
  }
  // The side column's maps share what height is left.
  const sideTop = block.facts.length ? factsTop + factsH + gapSide : factsTop
  const sideRoom = top + H - sideTop
  const sideEach = block.side.length ? (sideRoom - gapSide * (block.side.length - 1)) / block.side.length : 0
  block.side.forEach((slot, i) =>
    barSlot(f, slot, { x: f.x, y: sideTop + i * (sideEach + gapSide), w: sideW, h: sideEach }),
  )
  // The main column: each picture's box its picture's shape, as wide as the column allows; a missing picture's box
  // takes what height is left.
  const gapMain = 0.3 * IN
  const sized = block.main.map((slot) => {
    const noteH = slot.figure ? smallHeight(f, slot.note, mainW, 6.75) : 0
    if (!slot.figure) return { slot, w: mainW, h: 0, noteH, sized: false }
    const ar = aspectOf(slot.figure, bandOf(slot))
    const w = Math.min(mainW, 3.05 * IN * ar)
    return { slot, w, h: w / ar, noteH, sized: true }
  })
  const fixed = sized.reduce((s, c) => s + (c.sized ? c.h + BAR_H + c.noteH : 0), 0)
  const gaps = gapMain * Math.max(0, sized.length - 1)
  const loose = sized.filter((c) => !c.sized).length
  if (fixed + gaps > H) {
    const k = Math.max(
      0.2,
      (H - gaps - sized.reduce((s, c) => s + (c.sized ? BAR_H + c.noteH : 0), 0) - loose * 60) /
        Math.max(
          1,
          sized.reduce((s, c) => s + (c.sized ? c.h : 0), 0),
        ),
    )
    for (const c of sized)
      if (c.sized) {
        c.w *= k
        c.h *= k
      }
  }
  const used = sized.reduce((s, c) => s + (c.sized ? c.h + BAR_H + c.noteH : 0), 0)
  const looseH = loose ? Math.max(60, (H - used - gaps) / loose) : 0
  let y = top
  for (const c of sized) {
    const h = c.sized ? c.h + BAR_H + c.noteH : looseH
    barSlot(f, c.slot, { x: mainX + (mainW - c.w) / 2, y, w: c.w, h })
    y += h + gapMain
  }
  f.y = top + H
}

/** What a block holds as plain text, for a kind drawn where its layout cannot go: never nothing. */
function textsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim() && !value.startsWith('data:')) out.push(value)
  } else if (Array.isArray(value)) for (const v of value) textsOf(v, out)
  else if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value))
      if (!['kind', 'source', 'color', 'dataUrl', 'markSource', 'style', 'placement'].includes(key)) textsOf(v, out)
  return out
}

function fallbackText(f: Flow, block: ReportBlock) {
  for (const text of textsOf(block)) paragraph(f, text, { gap: 1 })
  f.y += f.style.gap
}

/** Any block in the flow. The kinds that open pages of their own are placed by `drawTopBlock`; here they draw in line. */
function drawBlock(f: Flow, block: ReportBlock) {
  switch (block.kind) {
    case 'heading':
      return heading(f, block.text, block.level)
    case 'paragraph':
      return paragraph(
        f,
        block.sentences
          .map((s) => s.text ?? '')
          .filter(Boolean)
          .join(' '),
      )
    case 'text':
      return paragraph(f, block.text)
    case 'list':
      return list(f, block.items, !!block.ordered)
    case 'fields':
      return fieldsBlock(f, block)
    case 'table':
      return tableBlock(f, block)
    case 'matrix':
      return matrixBlock(f, block)
    case 'scale':
      return scaleBlock(f, block)
    case 'choices':
      return choices(f, block)
    case 'figure':
      return figureBlock(f, block)
    case 'signature':
      return signature(f, block)
    case 'form':
      return form(f, block)
    case 'pageBreak':
      return
    case 'mapFigure':
      return mapFigure(f, block)
    case 'figureGrid':
      return figureGrid(f, block)
    case 'figurePair':
      return figurePair(f, block)
    case 'figurePage':
      // Only on a page of its own; anywhere else its words.
      return fallbackText(f, block)
    default:
      return fallbackText(f, block as ReportBlock)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The report's pages (`reportHtml`)

type Part =
  | { type: 'block'; block: ReportBlock }
  /** A landscape page: a wide table or matrix, with the headings before it and the short text closing its section. */
  | { type: 'wide'; blocks: ReportBlock[] }
  /** An 11 × 17 page: the headings, the analysis sheet and its calculation strip. */
  | { type: 'sheet'; headings: ReportBlock[]; figure: Block<'figure'>; calc: Block<'fields'> | null }

const sheetFigure = (block: ReportBlock | undefined): block is Block<'figure'> =>
  block?.kind === 'figure' && !!block.figure && isSheet(block.figure)

/** The body grouped as `reportHtml` groups it. */
function bodyParts(blocks: readonly ReportBlock[]): Part[] {
  const parts: Part[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    let last = i
    while (block.kind === 'heading' && blocks[last + 1]?.kind === 'heading') last++
    const next = blocks[last + 1]
    const nextWide = !!next && isWide(next)
    const nextSheet = sheetFigure(next)
    if (block.kind === 'heading' && (nextWide || nextSheet)) {
      const headings = blocks.slice(i, last + 1)
      i = last + 1
      if (sheetFigure(next)) {
        const calc = blocks[i + 1]
        parts.push({ type: 'sheet', headings, figure: next, calc: calc?.kind === 'fields' ? calc : null })
        if (calc?.kind === 'fields') i++
      } else {
        const closing = closingText(blocks, i + 1)
        parts.push({ type: 'wide', blocks: [...headings, next, ...blocks.slice(i + 1, i + 1 + closing)] })
        i += closing
      }
    } else if (sheetFigure(block) && next?.kind === 'fields') {
      parts.push({ type: 'sheet', headings: [], figure: block, calc: next })
      i++
    } else if (isWide(block)) parts.push({ type: 'wide', blocks: [block] })
    else parts.push({ type: 'block', block })
  }
  return parts
}

/** A page of its own at the end of a report (`OWN_PAGE` in `html.ts`). */
function ownPage(part: Part): boolean {
  if (part.type === 'sheet') return true
  if (part.type !== 'block') return false
  const b = part.block
  return (
    b.kind === 'pageBreak' ||
    b.kind === 'figurePair' ||
    b.kind === 'figurePage' ||
    b.kind === 'mapFigure' ||
    b.kind === 'figureGrid' ||
    (b.kind === 'figure' && !!b.figure && (isSheet(b.figure) || isPortraitSheet(b.figure)))
  )
}
/** A part that opens with a heading in the HTML (a heading, a titled table or fields, a matrix). */
function headingLike(part: Part): boolean {
  if (part.type !== 'block') return false
  const b = part.block
  return b.kind === 'heading' || ((b.kind === 'fields' || b.kind === 'table') && !!b.title) || b.kind === 'matrix'
}
const figureLike = (part: Part | undefined) =>
  part?.type === 'block' &&
  (part.block.kind === 'figure' || part.block.kind === 'mapFigure' || part.block.kind === 'figureGrid')

/** Where the to-complete list goes (`completeAt`): before the run of figure pages the report ends on. */
function completeAt(parts: readonly Part[]): number {
  let at = parts.length
  const figureWithFields = (i: number) =>
    figureLike(parts[i]) ||
    (parts[i].type === 'block' &&
      (parts[i] as { block: ReportBlock }).block.kind === 'fields' &&
      !(parts[i] as { block: Block<'fields'> }).block.title &&
      figureLike(parts[i - 1]))
  while (at > 0 && (ownPage(parts[at - 1]) || headingLike(parts[at - 1]) || figureWithFields(at - 1))) at--
  while (at < parts.length && headingLike(parts[at])) at++
  return at
}

/** Draws a block of the body, opening its own page when its kind takes one. */
function drawTopBlock(doc: Pages, block: ReportBlock, next?: ReportBlock) {
  doc.anchor = block
  const figure = block.kind === 'figure' ? block.figure : null
  if (figure && isPortraitSheet(figure)) {
    // The portrait 11 × 17 end map, full size so the scale it states is true on paper.
    doc.start('sheetPortrait')
    picture(doc, figure, { x: 0, y: 0, w: 11 * IN, h: 17 * IN })
    doc.pending = true
    return
  }
  if (block.kind === 'figure' && figure && isSheet(figure)) {
    if (figure.map) {
      doc.start('sheetFull')
      picture(doc, figure, { x: 0, y: 0, w: 17 * IN, h: 11 * IN })
      doc.pending = true
    } else sheetPage(doc, [], block, null)
    return
  }
  switch (block.kind) {
    case 'pageBreak':
      if (doc.kinds.length && !doc.fresh()) doc.pending = true
      return
    case 'figurePage':
      doc.start('figure')
      figurePage(doc, block)
      doc.pending = true
      return
    case 'figurePair':
      if (block.sheet || block.landscape) {
        doc.start(block.sheet ? 'sheet' : 'figure')
        figurePair(doc, block)
        doc.pending = true
      } else {
        // `break-before: page`; what follows continues on its page.
        doc.ready()
        if (!doc.fresh()) doc.start(doc.flowKind)
        figurePair(doc, block)
      }
      return
    case 'figureGrid':
      if (block.landscape) {
        doc.start('figure')
        doc.flowKind = 'figure'
        figureGrid(doc, block)
        doc.flowKind = 'portrait'
        doc.pending = true
        return
      }
  }
  doc.ready()
  if (block.kind === 'heading' && next) keepWithNext(doc, block, next)
  drawBlock(doc, block)
}

/** Blocks a page never splits (`break-inside: avoid`): a heading before one moves with all of it. */
const WHOLE: ReadonlySet<ReportBlock['kind']> = new Set([
  'fields',
  'matrix',
  'scale',
  'signature',
  'choices',
  'figure',
  'mapFigure',
  'figureGrid',
])

/** A heading never stays behind at the foot of a page: it moves to the next with what it introduces. */
function keepWithNext(doc: Pages, block: ReportBlock, next: ReportBlock) {
  if (doc.fresh()) return
  const own = measure(doc, doc.w, (g) => drawBlock(g, block), false)
  const together = measure(
    doc,
    doc.w,
    (g) => {
      drawBlock(g, block)
      drawBlock(g, next)
    },
    false,
  )
  ensure(doc, Math.min(doc.pageHeight(), WHOLE.has(next.kind) ? together : Math.min(together, own + 4 * doc.style.lh)))
}

/** An analysis sheet on its own 11 × 17 landscape page, its headings over it and its calculation strip under it. */
function sheetPage(doc: Pages, headings: readonly ReportBlock[], block: Block<'figure'>, calc: Block<'fields'> | null) {
  doc.start('sheet')
  for (const h of headings) {
    doc.anchor = h
    drawBlock(doc, h)
  }
  doc.anchor = block
  const calcH = calc ? measure(doc, doc.w, (g) => sheetFields(g, calc), false) : 0
  const capH = smallHeight(doc, block.caption, doc.w, CAPTION, 'normal', 3)
  const area = { x: doc.x, y: doc.y, w: doc.w, h: Math.max(40, doc.bottom() - doc.y - calcH - capH) }
  if (block.figure) picture(doc, block.figure, area)
  doc.y = area.y + area.h
  smallLines(doc, block.caption, doc.x, doc.w, { size: CAPTION, color: MUTED, align: 'center', gap: 3 })
  if (calc) {
    doc.anchor = calc
    sheetFields(doc, calc)
  }
  doc.pending = true
}

function drawPart(doc: Pages, part: Part, next?: Part) {
  if (part.type === 'block') return drawTopBlock(doc, part.block, next?.type === 'block' ? next.block : undefined)
  if (part.type === 'sheet') return sheetPage(doc, part.headings, part.figure, part.calc)
  doc.start('landscape')
  doc.flowKind = 'landscape'
  for (const block of part.blocks) {
    doc.anchor = block
    if (isWide(block)) {
      doc.style = WIDE
      drawBlock(doc, block)
      doc.style = NORMAL
    } else drawBlock(doc, block)
  }
  doc.flowKind = 'portrait'
  doc.pending = true
}

/** The logo in its box: the user's own picture contained in it, or an empty dashed box saying it is theirs. */
function logoBox(f: Flow, logo: ReportLogo | null, box: Rect, align: 'left' | 'right') {
  if (logo && imageFormat(logo.dataUrl)) {
    let ar = 0
    try {
      const props = f.ctx.pdf.getImageProperties(logo.dataUrl)
      ar = props.width > 0 && props.height > 0 ? props.width / props.height : 0
    } catch {
      ar = 0
    }
    if (ar) {
      const w = Math.min(box.w, box.h * ar)
      const h = w / ar
      const r = { x: align === 'right' ? box.x + box.w - w : box.x, y: box.y + (box.h - h) / 2, w, h }
      if (embed(f, logo.dataUrl, r)) return
    }
  }
  emptyBox(f, box, logo ? `Logo (your own): ${logo.name}` : 'Logo (your own)', 8.25)
}

interface ContentsEntry {
  target: ReportBlock | 'complete'
  page: number
  /** The baseline of the entry's last line, where its page number prints. */
  y: number
  top: number
  height: number
}

/** The contents (`nav.contents`): each section and picture with a dotted leader to the page it starts on. */
function contents(
  doc: Pages,
  sections: ReadonlyArray<{ block: ReportBlock | 'complete'; text: string }>,
  images: ReadonlyArray<{ block: ReportBlock; text: string }>,
): ContentsEntry[] {
  const entries: ContentsEntry[] = []
  const size = doc.style.body
  const lh = 13
  heading(doc, 'Contents', 1)
  const entry = (target: ReportBlock | 'complete', text: string) => {
    const lines = wrap(doc.ctx.pdf, text, doc.w - 40, size)
    ensure(doc, lines.length * lh)
    let top = doc.y
    let page = doc.page
    lines.forEach((l, i) => {
      const t = advance(doc, lh)
      if (doc.page !== page) {
        page = doc.page
        top = t
      }
      const y = baseline(t, lh, size)
      put(doc, l, doc.x, y, { size })
      if (i < lines.length - 1) return
      // The dotted leader, from the text to the page number's column.
      const from = doc.x + textWidth(doc.ctx.pdf, l, size) + 4
      const to = doc.x + doc.w - 24
      if (to > from) line(doc, from, y - 0.5, to, y - 0.5, DASH, 0.6, [0.6, 2.4])
      entries.push({ target, page, y, top, height: t + lh - top })
    })
  }
  for (const s of sections) entry(s.block, s.text)
  if (images.length) {
    heading(doc, 'Images', 4)
    for (const image of images) entry(image.block, image.text)
  }
  return entries
}

/**
 * The report as a PDF: the paper and pages `reportHtml` prints, drawn with the jsPDF module passed in. `compress`
 * deflates the page contents (on by default; the tests read the text of an uncompressed file).
 */
export function reportPdf(
  report: AssembledReport,
  logo: ReportLogo | null,
  jspdf: PdfModule,
  options: { compress?: boolean } = {},
): ArrayBuffer {
  const paper = report.layout.paper
  const pdf = new jspdf.jsPDF({
    unit: 'pt',
    format: PAPER[paper],
    orientation: 'portrait',
    compress: options.compress ?? true,
  })
  const ctx: Ctx = { pdf, mod: jspdf, images: new Map(), gstates: new Map() }
  const doc = new Pages(ctx, paper)
  const [first, ...rest] = report.blocks
  const title = first?.kind === 'heading' ? first.text : report.title
  const blocks = first?.kind === 'heading' ? rest : report.blocks
  pdf.setProperties({ title: fold(`${title} - ${report.subtitle}`), subject: fold(report.footer), creator: 'PGMaps' })
  // The cover takes the fields that come before the first section heading (the cover part's).
  const coverEnd = report.layout.cover ? blocks.findIndex((block) => block.kind === 'heading') : 0
  const coverBlocks = report.layout.cover ? blocks.slice(0, Math.max(0, coverEnd)) : []
  const body = blocks.slice(coverBlocks.length)

  if (report.layout.cover) {
    doc.start('cover')
    const titleSize = 25.5,
      subSize = 13.5
    const titleLines = wrap(pdf, title, doc.w, titleSize, 'bold')
    const subLines = wrap(pdf, report.subtitle, doc.w, subSize)
    const logoH = 110 * PX
    const headH = logoH + 13.5 + titleLines.length * titleSize * 1.15 + 13.5 + subLines.length * subSize * 1.3 + 13.5
    const coverH = measure(doc, doc.w, (g) => coverBlocks.forEach((b) => drawBlock(g, b)), false)
    const total = headH + coverH
    doc.y = doc.top + Math.max(0, (doc.pageHeight() - total) / 2)
    logoBox(doc, logo, { x: doc.x, y: doc.y, w: 260 * PX, h: logoH }, 'right')
    doc.y += logoH + 13.5
    for (const l of titleLines) {
      put(doc, l, doc.x, baseline(doc.y, titleSize * 1.15, titleSize), { size: titleSize, style: 'bold' })
      doc.y += titleSize * 1.15
    }
    doc.y += 13.5
    for (const l of subLines) {
      put(doc, l, doc.x, baseline(doc.y, subSize * 1.3, subSize), { size: subSize, color: hex('#334155') })
      doc.y += subSize * 1.3
    }
    doc.y += 13.5
    for (const b of coverBlocks) drawBlock(doc, b)
    doc.pending = true
  } else {
    doc.start('portrait')
    const logoW = 180 * PX,
      logoH = 64 * PX
    const textW = doc.w - logoW - 18
    const titleLines = wrap(pdf, title, textW, 18, 'bold')
    const subLines = wrap(pdf, report.subtitle, textW, 9.75)
    const leftH = titleLines.length * 21 + 3 + subLines.length * 13
    const h = Math.max(leftH, logoH)
    const top = doc.y
    titleLines.forEach((l, i) => put(doc, l, doc.x, baseline(top + i * 21, 21, 18), { size: 18, style: 'bold' }))
    subLines.forEach((l, i) =>
      put(doc, l, doc.x, baseline(top + titleLines.length * 21 + 3 + i * 13, 13, 9.75), { size: 9.75, color: MUTED }),
    )
    logoBox(doc, logo, { x: doc.x + doc.w - logoW, y: top, w: logoW, h: logoH }, 'right')
    line(doc, doc.x, top + h + 9, doc.x + doc.w, top + h + 9, INK, 1.5)
    doc.y = top + h + 9 + 12
  }

  // The contents: each section, the to-complete list, and the pictures, with the page each starts on.
  const sections: Array<{ block: ReportBlock | 'complete'; text: string }> = body
    .filter((b): b is Block<'heading'> => b.kind === 'heading' && b.level === 2)
    .map((b) => ({ block: b, text: b.text }))
  if (report.toComplete.length) sections.push({ block: 'complete', text: 'To complete before signing' })
  const images = body.flatMap((b) => {
    const text = imageLabel(b)
    return text ? [{ block: b, text }] : []
  })
  let entries: ContentsEntry[] = []
  if (report.layout.contents && sections.some((s) => s.block !== 'complete')) {
    doc.ready()
    entries = contents(doc, sections, images)
    doc.pending = true
  }

  const parts = bodyParts(body)
  const at = completeAt(parts)
  for (let i = 0; i < at; i++) drawPart(doc, parts[i], i + 1 < at ? parts[i + 1] : undefined)

  // The reviewer's list: one line per part, its items run on, in a ruled box.
  doc.ready()
  if (report.toComplete.length) {
    doc.anchor = 'complete'
    toComplete(doc, report.toComplete)
  }
  // The footer line: what the report is and is not.
  doc.y += 12
  const footerLines = wrap(pdf, report.footer, doc.w, 8.25)
  ensure(doc, footerLines.length * 11 + 6)
  line(doc, doc.x, doc.y, doc.x + doc.w, doc.y, RULE, 0.75)
  doc.y += 4.5
  for (const l of footerLines) put(doc, l, doc.x, baseline(advance(doc, 11), 11, 8.25), { size: 8.25, color: GREY })

  for (let i = at; i < parts.length; i++) drawPart(doc, parts[i], parts[i + 1])

  // The running header and "Page n of N" on every page that prints them.
  const total = doc.kinds.length
  const cut = report.subtitle.length > 60 ? `${report.subtitle.slice(0, 57).trimEnd()}…` : report.subtitle
  const header = fold(`${report.title} · ${cut}`.replace(/["\\]/g, ''))
  doc.kinds.forEach((kind, i) => {
    const spec = pageSpec(kind, paper)
    pdf.setPage(i + 1)
    const [t, r, b, l] = spec.margin
    const [w, h] = spec.size
    font(pdf, 8)
    pdf.setTextColor(...GREY)
    if (spec.header) {
      let text = header
      while (text.length > 4 && pdf.getTextWidth(text) > w - l - r) text = `${text.slice(0, -4).trimEnd()}...`
      pdf.text(text, l, t / 2 + 3)
    }
    if (spec.number) pdf.text(`Page ${i + 1} of ${total}`, w - r, h - b / 2 + 3, { align: 'right' })
  })
  // The contents' page numbers, each linked to its page.
  font(pdf, doc.style.body)
  pdf.setTextColor(...INK)
  const right = pageSpec('portrait', paper).size[0] - 16 * MM
  for (const e of entries) {
    const page = doc.anchors.get(e.target)
    if (!page) continue
    pdf.setPage(e.page)
    pdf.text(String(page), right, e.y, { align: 'right' })
    pdf.link(16 * MM, e.top, right - 16 * MM, e.height, { pageNumber: page })
  }
  // Bookmarks for the sections.
  for (const s of sections) {
    const page = doc.anchors.get(s.block)
    if (page) pdf.outline.add(null, fold(s.text), { pageNumber: page })
  }
  return pdf.output('arraybuffer')
}

/** "To complete before signing" (`section.complete`): a bullet per part, its items run on, in a ruled box. */
function toComplete(f: Flow, items: AssembledReport['toComplete']) {
  const pdf = f.ctx.pdf
  const byPart = new Map<string, string[]>()
  for (const item of items) byPart.set(item.part, [...(byPart.get(item.part) ?? []), item.what])
  const size = 7.5
  const lh = 9.4
  const pad = 6
  const indent = 12
  const titleLines = wrap(pdf, 'To complete before signing', f.w - pad * 2, 10.5, 'bold')
  type Line = { h: number; draw: (top: number) => void }
  const lines: Line[] = titleLines.map((l) => ({
    h: 14,
    draw: (top) => put(f, l, f.x + pad, baseline(top, 14, 10.5), { size: 10.5, style: 'bold' }),
  }))
  for (const [part, what] of byPart) {
    const segs = wrapRuns(
      pdf,
      [{ text: `${part}:`, bold: true }, { text: ` ${what.join('; ')}` }],
      f.w - pad * 2 - indent,
      size,
    )
    segs.forEach((s, i) =>
      lines.push({
        h: lh + (i === segs.length - 1 ? 2 : 0),
        draw: (top) => {
          if (i === 0) circle(f, f.x + pad + 4, baseline(top, lh, size) - size * 0.3, 1.1, { fill: INK })
          drawRuns(f, s, f.x + pad + indent, top, lh, size)
        },
      }),
    )
  }
  if (!f.fresh()) f.y += 10
  const total = lines.reduce((s, l) => s + l.h, 0) + pad * 2
  ensure(f, Math.min(total, f.pageHeight()))
  let i = 0
  while (i < lines.length) {
    const top = f.y
    let h = 0
    let j = i
    while (j < lines.length && (j === i || top + pad + h + lines[j].h + pad <= f.bottom())) h += lines[j++].h
    rect(f, { x: f.x, y: top, w: f.w, h: h + pad * 2 }, { fill: hex('#fffaf0'), stroke: hex('#b7791f'), width: 0.75 })
    let y = top + pad
    for (let k = i; k < j; k++) {
      lines[k].draw(y)
      y += lines[k].h
    }
    f.y = top + h + pad * 2
    i = j
    if (i < lines.length) f.breakPage()
  }
}
