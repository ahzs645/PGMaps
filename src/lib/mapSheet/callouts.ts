/**
 * Annotation primitives for figures drawn over a picture: text with a halo and underline, leaders
 * with arrowheads, and callout boxes, including the balloon form whose pointer is part of the box
 * outline. Built from the same drawing operations and area symbols as every sheet, so the PDF, the
 * SVG preview and the PNG agree. No DOM or network access.
 */
import { boxesMeet, rectRing, type DrawOp, type Point, type StrokeStyle } from './drawOps'
import { areaSymbolOps, type AreaSymbol } from './symbols'
import { pdfText } from './renderPdf'
import { fitText, textWidth, wrapText, type SheetFontStyle } from './textMetrics'

/** Type as a figure prints it. Sizes are points. */
export interface SheetTextStyle {
  size: number
  style?: SheetFontStyle
  family?: 'helvetica' | 'times'
  color: string
  /** An outline under the glyphs, as a white halo over a photograph. */
  halo?: { color: string; width: number }
  /** A rule under the text, `width` points thick. */
  underline?: { width: number }
}

/** A leader: a stroke from a label to its feature, optionally ending in an arrowhead at the feature. */
export interface LeaderStyle {
  stroke: StrokeStyle
  /** Arrowhead length and full width, points; `filled` false draws an open V. */
  head?: { length: number; width: number; filled: boolean; color?: string }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Line height of a text style, points: what a block of lines advances by. */
export const lineHeight = (style: SheetTextStyle) => style.size * 1.17

/** One line of text in `style`, with its halo and underline. */
export function textOps(
  x: number,
  y: number,
  text: string,
  style: SheetTextStyle,
  align: 'left' | 'center' | 'right' = 'left',
  baseline: 'alphabetic' | 'middle' = 'alphabetic',
): DrawOp[] {
  const ops: DrawOp[] = [
    {
      op: 'text',
      x,
      y,
      text,
      size: style.size,
      color: style.color,
      align,
      baseline,
      ...(style.style ? { style: style.style } : {}),
      ...(style.family ? { family: style.family } : {}),
      ...(style.halo ? { halo: style.halo } : {}),
    },
  ]
  if (style.underline) {
    const w = textWidth(text, style.size, style.style ?? 'normal')
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    const under = baseline === 'middle' ? y + style.size * 0.5 : y + style.size * 0.14
    ops.push({
      op: 'path',
      parts: [
        [
          [x0, under],
          [x0 + w, under],
        ],
      ],
      closed: false,
      stroke: { color: style.color, width: style.underline.width },
    })
  }
  return ops
}

/** An arrowhead with its point at `tip`, pointing away from `from`. */
export function arrowHeadOps(
  from: Point,
  tip: Point,
  head: NonNullable<LeaderStyle['head']>,
  color: string,
  width: number,
): DrawOp[] {
  const dx = tip[0] - from[0],
    dy = tip[1] - from[1]
  const length = Math.hypot(dx, dy)
  if (!(length > 0)) return []
  const ux = dx / length,
    uy = dy / length
  const bx = tip[0] - ux * head.length,
    by = tip[1] - uy * head.length
  const left: Point = [bx - (uy * head.width) / 2, by + (ux * head.width) / 2]
  const right: Point = [bx + (uy * head.width) / 2, by - (ux * head.width) / 2]
  const fill = head.color ?? color
  return head.filled
    ? [{ op: 'path', parts: [[left, tip, right]], closed: true, fill }]
    : [{ op: 'path', parts: [[left, tip, right]], closed: false, stroke: { color: fill, width, join: 'miter' } }]
}

/**
 * A leader from `from` to `to`, stopped `shorten` points short of `to` so it does not cover the
 * feature. With a filled head, the shaft stops inside the head rather than poking through its tip.
 */
export function leaderOps(from: Point, to: Point, leader: LeaderStyle, shorten = 0): DrawOp[] {
  const dx = to[0] - from[0],
    dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)
  if (!(length > shorten)) return []
  const ux = dx / length,
    uy = dy / length
  const tip: Point = [to[0] - ux * shorten, to[1] - uy * shorten]
  const shaftEnd: Point =
    leader.head && leader.head.filled
      ? [tip[0] - ux * leader.head.length * 0.6, tip[1] - uy * leader.head.length * 0.6]
      : tip
  return [
    { op: 'path', parts: [[from, shaftEnd]], closed: false, stroke: leader.stroke },
    ...(leader.head ? arrowHeadOps(from, tip, leader.head, leader.stroke.color, leader.stroke.width) : []),
  ]
}

/**
 * The outline of a balloon callout: the box and a pointer as one ring, the pointer's base `base`
 * points wide on the edge facing `anchor` and its tip at `anchor`. An anchor inside the box gives
 * the plain box.
 */
export function balloonRing(box: Box, anchor: Point, base: number): Point[] {
  const { x, y, w, h } = box
  const [ax, ay] = anchor
  if (ax >= x && ax <= x + w && ay >= y && ay <= y + h) return rectRing(x, y, w, h)
  // Sides are tried by how far the anchor lies beyond them, so a pointer leaves the nearest face.
  const beyond = { right: ax - (x + w), left: x - ax, top: y - ay, bottom: ay - (y + h) }
  const side = (Object.keys(beyond) as Array<keyof typeof beyond>).reduce((a, b) => (beyond[b] > beyond[a] ? b : a))
  const span = (lo: number, hi: number, at: number) => Math.max(lo + 1, Math.min(hi - base - 1, at - base / 2))
  if (side === 'right' || side === 'left') {
    const b0 = h > base + 2 ? span(y, y + h, ay) : y,
      b1 = Math.min(y + h, b0 + base)
    return side === 'right'
      ? [
          [x, y],
          [x + w, y],
          [x + w, b0],
          [ax, ay],
          [x + w, b1],
          [x + w, y + h],
          [x, y + h],
        ]
      : [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, b1],
          [ax, ay],
          [x, b0],
        ]
  }
  const b0 = w > base + 2 ? span(x, x + w, ax) : x,
    b1 = Math.min(x + w, b0 + base)
  return side === 'top'
    ? [
        [x, y],
        [b0, y],
        [ax, ay],
        [b1, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ]
    : [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [b1, y + h],
        [ax, ay],
        [b0, y + h],
        [x, y + h],
      ]
}

export interface CalloutBoxStyle {
  /** A highlighted callout's box and leader (a board triptych's yellow focus box). */
  focus?: { box?: AreaSymbol; leader?: LeaderStyle }
  box: AreaSymbol
  padding: { x: number; y: number }
  title: SheetTextStyle
  body?: SheetTextStyle
  pointer: { kind: 'wedge'; base: number } | { kind: 'leader'; leader: LeaderStyle }
}

/** Text as it prints: the PDF fonts fold some characters (an em dash prints " - "), so measure the folded text. */
const printed = (text: string) => pdfText(text).replace(/\s+/g, ' ').trim()

/** Most lines a callout's title and body take before the font shrinks. */
export const CALLOUT_MAX_TITLE_LINES = 2
export const CALLOUT_MAX_BODY_LINES = 1
/** The one step a callout's type shrinks by when wrapping alone does not fit it. */
export const CALLOUT_SHRINK = 0.85

/** Lines of `text` in `style` within `maxWidth`: wrapped at words, then one size smaller, then cut with "...". */
export function fitCalloutLines(
  text: string,
  style: SheetTextStyle,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; style: SheetTextStyle } {
  const face = style.style ?? 'normal'
  const folded = printed(text)
  for (const size of [style.size, style.size * CALLOUT_SHRINK]) {
    const lines = wrapText(folded, size, maxWidth, face)
    if (lines.length <= maxLines) return { lines, style: { ...style, size } }
  }
  const size = style.size * CALLOUT_SHRINK
  const lines = wrapText(folded, size, maxWidth, face)
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = fitText(`${lines.slice(maxLines - 1).join(' ')}`, size, maxWidth, face)
  if (!kept[maxLines - 1].endsWith('...'))
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1]}...`, size, maxWidth, face)
  return { lines: kept, style: { ...style, size } }
}

/** A callout's text laid out: its lines in each style, and the box that holds them with padding all round. */
export type CalloutText = {
  title: { lines: string[]; style: SheetTextStyle }
  body: { lines: string[]; style: SheetTextStyle } | null
  w: number
  h: number
}

/**
 * Lays a callout's text out within `maxWidth` (the box's widest, padding included) and sizes its box
 * from the measured lines, bold metrics for a bold line.
 */
export function calloutText(style: CalloutBoxStyle, title: string, body?: string, maxWidth = Infinity): CalloutText {
  const inner = Math.max(1, maxWidth - style.padding.x * 2)
  const t = fitCalloutLines(title, style.title, inner, CALLOUT_MAX_TITLE_LINES)
  const b = body && style.body ? fitCalloutLines(body, style.body, inner, CALLOUT_MAX_BODY_LINES) : null
  const widest = Math.max(
    ...t.lines.map((line) => textWidth(line, t.style.size, t.style.style ?? 'normal')),
    ...(b ? b.lines.map((line) => textWidth(line, b.style.size, b.style.style ?? 'normal')) : [0]),
  )
  const lines = t.lines.length * lineHeight(t.style) + (b ? b.lines.length * lineHeight(b.style) : 0)
  return { title: t, body: b, w: widest + style.padding.x * 2, h: lines + style.padding.y * 2 }
}

/** Size of a callout's box for its text, points. */
export function calloutSize(style: CalloutBoxStyle, title: string, body?: string, maxWidth = Infinity) {
  const { w, h } = calloutText(style, title, body, maxWidth)
  return { w, h }
}

/**
 * A callout in `box` pointing at `anchor`: a balloon whose wedge is part of the outline, or a box
 * with a separate leader from the box edge nearest the anchor, drawn first so the box covers its
 * root. `box` overrides the style's box symbol (a highlighted callout), `leader` its leader. `text`
 * is the layout the box was sized from (`calloutText`); without it the text is laid out unwrapped.
 */
export function calloutOps(
  style: CalloutBoxStyle,
  box: Box,
  anchor: Point,
  title: string,
  body?: string,
  override: { box?: AreaSymbol; leader?: LeaderStyle } = {},
  text: CalloutText = calloutText(style, title, body),
): DrawOp[] {
  const ops: DrawOp[] = []
  const symbol = override.box ?? style.box
  if (style.pointer.kind === 'wedge')
    ops.push(...areaSymbolOps([balloonRing(box, anchor, style.pointer.base)], symbol, 1))
  else {
    const leader = override.leader ?? style.pointer.leader
    ops.push(...leaderOps(nearestEdgePoint(box, anchor), anchor, leader, 3))
    ops.push(...areaSymbolOps([rectRing(box.x, box.y, box.w, box.h)], symbol, 1))
  }
  let y = box.y + style.padding.y
  for (const block of [text.title, ...(text.body ? [text.body] : [])])
    for (const line of block.lines) {
      ops.push(...textOps(box.x + style.padding.x, y + block.style.size * 0.92, line, block.style))
      y += lineHeight(block.style)
    }
  return ops
}

/** The point on a box's edge nearest `anchor`: where a leader leaves the box. */
export function nearestEdgePoint(box: Box, anchor: Point): Point {
  const x = Math.max(box.x, Math.min(box.x + box.w, anchor[0])),
    y = Math.max(box.y, Math.min(box.y + box.h, anchor[1]))
  if (x !== anchor[0] || y !== anchor[1]) return [x, y]
  // The anchor is inside the box: leave from the nearest side.
  const sides: Array<[number, Point]> = [
    [anchor[1] - box.y, [anchor[0], box.y]],
    [box.y + box.h - anchor[1], [anchor[0], box.y + box.h]],
    [anchor[0] - box.x, [box.x, anchor[1]]],
    [box.x + box.w - anchor[0], [box.x + box.w, anchor[1]]],
  ]
  return sides.sort((p, q) => p[0] - q[0])[0][1]
}

/**
 * `box` moved into `bounds` and clear of every `placed` box by `gap`: right of the box it meets,
 * else under it, back at its own x. Null when it cannot fit within `tries` moves.
 */
export function placeClear(box: Box, placed: readonly Box[], bounds: Box, gap = 4, tries = 24): Box | null {
  if (box.w > bounds.w || box.h > bounds.h) return null
  const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w - box.w, x))
  const clampY = (y: number) => Math.max(bounds.y, Math.min(bounds.y + bounds.h - box.h, y))
  const grown = (b: Box) => ({ x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 })
  let candidate = { ...box, x: clampX(box.x), y: clampY(box.y) }
  for (let i = 0; i < tries; i++) {
    const hit = placed.find((p) => boxesMeet(grown(p), candidate))
    if (!hit) return candidate
    const right = hit.x + hit.w + gap * 2
    if (right + candidate.w <= bounds.x + bounds.w) candidate = { ...candidate, x: right }
    else {
      const down = hit.y + hit.h + gap * 2
      if (down + candidate.h > bounds.y + bounds.h) return null
      candidate = { ...candidate, x: clampX(box.x), y: down }
    }
  }
  return null
}

// ---------------------------------------------------------------- label styles

/** How a figure names its features. Independent of the figure's symbols; a preset gives the default. */
export type LabelStyleId = 'box' | 'underlined' | 'halo' | 'numbered'

export const LABEL_STYLES: ReadonlyArray<{ id: LabelStyleId; name: string }> = [
  { id: 'box', name: 'Box' },
  { id: 'underlined', name: 'Underlined label' },
  { id: 'halo', name: 'Halo text' },
  { id: 'numbered', name: 'Numbered markers' },
]

export type FigureLabel = {
  title: string
  body?: string
  /** What the label points at, page points. */
  anchor: Point
  /** Highlighted (a board triptych's focus box). */
  focus?: boolean
  /** A secondary feature (existing opening, road, another licensee's block): smaller and plainer. */
  secondary?: boolean
}

export type LabelOptions = {
  style: LabelStyleId
  /** Where labels may go. */
  area: Box
  /** Widest a label may be, points (about 28 % of the image width). */
  maxWidth: number
  /** Page y of the skyline above page x: labels sit above it. Without it, above the anchor. */
  ceilingAt?: (x: number) => number
  /** Gap between a label and the skyline (or anchor) below it, points. */
  gap?: number
  /** The box style, for `box`; a plain white box when absent. */
  box?: CalloutBoxStyle
  /** Text styles for the boxless styles; sensible defaults when absent. */
  text?: SheetTextStyle
  leader?: LeaderStyle
}

const DARK = '#1a1a1a'
const PLAIN_BOX: CalloutBoxStyle = {
  box: { kind: 'area', label: 'Label box', fill: '#ffffff', outline: [{ color: '#000000', width: 0.72 }] },
  padding: { x: 4, y: 2.5 },
  title: { size: 9, style: 'bold', color: '#000000' },
  body: { size: 9, color: '#000000' },
  pointer: { kind: 'leader', leader: { stroke: { color: '#000000', width: 0.6 } } },
}
const SECONDARY_TEXT: SheetTextStyle = { size: 7, color: '#ffffff' }
const SECONDARY_LEADER: LeaderStyle = {
  stroke: { color: '#ffffff', width: 0.6 },
  head: { length: 3.5, width: 3, filled: true },
}

/** Numbered markers' circle radius, points. */
export const MARKER_RADIUS = 6

/**
 * Labels for `labels` in one of the label styles, placed clear of each other inside `area`: above
 * the skyline over each anchor, moved right and then down when they collide. Every box is sized
 * from its measured text. Returns the operations, the key a numbered style prints in the legend,
 * the boxes placed (for tests and later layout) and how many labels found no room.
 */
export function labelOps(
  labels: readonly FigureLabel[],
  options: LabelOptions,
): { ops: DrawOp[]; key: Array<{ n: number; text: string }>; boxes: Box[]; dropped: number } {
  const gap = options.gap ?? 28
  const ops: DrawOp[] = []
  const placed: Box[] = []
  const key: Array<{ n: number; text: string }> = []
  let dropped = 0
  const sorted = [...labels].sort((a, b) => Number(!!a.secondary) - Number(!!b.secondary) || a.anchor[0] - b.anchor[0])
  if (options.style === 'numbered') {
    // Small numbered circles on the features; the names go in the key.
    sorted.forEach((label, i) => {
      const n = i + 1
      const box = placeClear(
        {
          x: label.anchor[0] - MARKER_RADIUS,
          y: label.anchor[1] - MARKER_RADIUS,
          w: MARKER_RADIUS * 2,
          h: MARKER_RADIUS * 2,
        },
        placed,
        options.area,
        1,
      )
      if (!box) {
        dropped++
        return
      }
      placed.push(box)
      const cx = box.x + MARKER_RADIUS,
        cy = box.y + MARKER_RADIUS
      if (Math.hypot(cx - label.anchor[0], cy - label.anchor[1]) > MARKER_RADIUS)
        ops.push(...leaderOps([cx, cy], label.anchor, { stroke: { color: DARK, width: 0.5 } }, 0))
      ops.push({ op: 'circle', x: cx, y: cy, r: MARKER_RADIUS, fill: '#ffffff', stroke: { color: DARK, width: 0.8 } })
      ops.push(...textOps(cx, cy, String(n), { size: 7, style: 'bold', color: DARK }, 'center', 'middle'))
      key.push({ n, text: printed([label.title, label.body].filter(Boolean).join(' - ')) })
    })
    return { ops, key, boxes: placed, dropped }
  }
  for (const label of sorted) {
    const ceiling = options.ceilingAt ? Math.min(options.ceilingAt(label.anchor[0]), label.anchor[1]) : label.anchor[1]
    if (options.style === 'box' && !label.secondary) {
      const style = options.box ?? PLAIN_BOX
      const text = calloutText(style, label.title, label.body, options.maxWidth)
      const lean = style.pointer.kind === 'wedge' ? text.w * 0.35 : 0
      const box = placeClear(
        { x: label.anchor[0] - text.w / 2 - lean, y: ceiling - gap - text.h, w: text.w, h: text.h },
        placed,
        options.area,
      )
      if (!box) {
        dropped++
        continue
      }
      placed.push(box)
      ops.push(
        ...calloutOps(
          style,
          box,
          label.anchor,
          label.title,
          label.body,
          label.focus && style.focus ? style.focus : {},
          text,
        ),
      )
      continue
    }
    // Boxless: underlined, halo, and every style's secondary labels.
    const underlined = options.style === 'underlined' && !label.secondary
    const base: SheetTextStyle = label.secondary
      ? SECONDARY_TEXT
      : underlined
        ? { size: 9.5, style: 'bold', color: DARK, underline: { width: 0.6 } }
        : (options.text ?? { size: 9, style: 'bold', color: DARK, halo: { color: '#ffffff', width: 1.8 } })
    const title = fitCalloutLines(label.title, base, options.maxWidth, CALLOUT_MAX_TITLE_LINES)
    const body =
      label.body && !label.secondary
        ? fitCalloutLines(
            label.body,
            { ...base, style: 'normal', underline: undefined, size: base.size * 0.85 },
            options.maxWidth,
            1,
          )
        : null
    const blocks = [title, ...(body ? [body] : [])]
    const w = Math.max(
      ...blocks.flatMap((b) => b.lines.map((l) => textWidth(l, b.style.size, b.style.style ?? 'normal'))),
    )
    const h = blocks.reduce((sum, b) => sum + b.lines.length * lineHeight(b.style), 0)
    const box = placeClear(
      { x: label.anchor[0] - w / 2, y: ceiling - (label.secondary ? gap * 0.6 : gap) - h, w, h },
      placed,
      options.area,
    )
    if (!box) {
      dropped++
      continue
    }
    placed.push(box)
    const leader = label.secondary
      ? SECONDARY_LEADER
      : (options.leader ?? { stroke: { color: underlined ? DARK : '#000000', width: underlined ? 0.6 : 0.5 } })
    // Underlined: the leader drops from the underline, straight down when the anchor is under it.
    const from: Point = underlined
      ? [Math.max(box.x, Math.min(box.x + box.w, label.anchor[0])), box.y + box.h]
      : nearestEdgePoint(box, label.anchor)
    ops.push(...leaderOps(from, label.anchor, leader, 2))
    let y = box.y
    for (const block of blocks)
      for (const line of block.lines) {
        ops.push(...textOps(box.x + box.w / 2, y + block.style.size * 0.92, line, block.style, 'center'))
        y += lineHeight(block.style)
      }
  }
  return { ops, key, boxes: placed, dropped }
}
