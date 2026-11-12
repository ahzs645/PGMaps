/**
 * Annotation primitives for figures drawn over a picture: text with a halo and underline, leaders
 * with arrowheads, and callout boxes, including the balloon form whose pointer is part of the box
 * outline. Built from the same drawing operations and area symbols as every sheet, so the PDF, the
 * SVG preview and the PNG agree. No DOM or network access.
 */
import { boxesMeet, rectRing, type DrawOp, type Point, type StrokeStyle } from './drawOps'
import { areaSymbolOps, type AreaSymbol } from './symbols'
import { textWidth, type SheetFontStyle } from './textMetrics'

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
  box: AreaSymbol
  padding: { x: number; y: number }
  title: SheetTextStyle
  body?: SheetTextStyle
  pointer: { kind: 'wedge'; base: number } | { kind: 'leader'; leader: LeaderStyle }
}

/** Size of a callout's box for its text, points. */
export function calloutSize(style: CalloutBoxStyle, title: string, body?: string): { w: number; h: number } {
  const titleWidth = textWidth(title, style.title.size, style.title.style ?? 'normal')
  const bodyWidth = body && style.body ? textWidth(body, style.body.size, style.body.style ?? 'normal') : 0
  return {
    w: Math.max(titleWidth, bodyWidth) + style.padding.x * 2,
    h: lineHeight(style.title) + (body && style.body ? lineHeight(style.body) : 0) + style.padding.y * 2 - 1,
  }
}

/**
 * A callout in `box` pointing at `anchor`: a balloon whose wedge is part of the outline, or a box
 * with a separate leader drawn first so the box covers its root. `box` overrides the style's box
 * symbol (a highlighted callout), `leader` its leader.
 */
export function calloutOps(
  style: CalloutBoxStyle,
  box: Box,
  anchor: Point,
  title: string,
  body?: string,
  override: { box?: AreaSymbol; leader?: LeaderStyle } = {},
): DrawOp[] {
  const ops: DrawOp[] = []
  const symbol = override.box ?? style.box
  if (style.pointer.kind === 'wedge')
    ops.push(...areaSymbolOps([balloonRing(box, anchor, style.pointer.base)], symbol, 1))
  else {
    const leader = override.leader ?? style.pointer.leader
    const from: Point = [
      Math.max(box.x + 4, Math.min(box.x + box.w - 4, anchor[0])),
      anchor[1] > box.y + box.h ? box.y + box.h : anchor[1] < box.y ? box.y : box.y + box.h / 2,
    ]
    ops.push(...leaderOps(from, anchor, leader, 3))
    ops.push(...areaSymbolOps([rectRing(box.x, box.y, box.w, box.h)], symbol, 1))
  }
  const titleY = box.y + style.padding.y + style.title.size * 0.92
  ops.push(...textOps(box.x + style.padding.x, titleY, title, style.title))
  if (body && style.body)
    ops.push(...textOps(box.x + style.padding.x, titleY + lineHeight(style.body), body, style.body))
  return ops
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
