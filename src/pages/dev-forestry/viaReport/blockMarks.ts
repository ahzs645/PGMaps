/**
 * Where a report picture's block marks go (`htmlFigures.ts` draws them): each block's ring or arrow at its place in the
 * picture, and its name in one row of labels above the marks, in the blocks' left-to-right order so no leader crosses
 * another (`rowPlacement`). Every label stays inside the shown picture (a panorama's band): a label is wrapped onto two
 * lines, then shrunk, then cut with an ellipsis, and only when the row still cannot hold them all does the least-seen
 * block's label give way. Units are the picture's pixels. No DOM or network access.
 */
import { rowPlacement, type Box } from '@/lib/mapSheet/callouts'
import { fitText, textWidth } from '@/lib/mapSheet/textMetrics'

/** What a block that is not plainly seen is called beside its name. */
export const UNSEEN_STATUS: Readonly<Record<string, string>> = {
  'possible glimpses': 'glimpses only',
  'not visible': 'not visible',
  unknown: 'not known',
}

export interface BlockMark {
  /** Shares of the picture's width and height. */
  x: number
  y: number
  label: string
  status: string
}

export interface PlacedBlockMark {
  /** The block's place, pixels, kept inside the shown picture so its ring shows whole. */
  anchor: [number, number]
  /** Not plainly seen: a dashed ring at the anchor rather than an arrow. */
  unseen: boolean
  /** Ring radius, pixels. */
  ring: number
  /** The label's lines, its type size and its box; null when the row could not hold it. */
  lines: string[]
  size: number
  box: Box | null
  /** The leader from the label's edge to the ring's edge or the arrow's tip, when the label is placed. */
  leader: [[number, number], [number, number]] | null
}

/** Line advance of a label's lines, as a share of its type size. */
export const MARK_LINE_HEIGHT = 1.15
/** The smallest type the labels shrink to, as a share of their size. */
const MIN_SHRINK = 0.6
/** Width measured with this margin over the type's own advances, for the browser's Arial against Helvetica's. */
const WIDTH_MARGIN = 1.06
/** A seen block's label gives way after an unseen one's when the row is full. */
const PRIORITY: Readonly<Record<string, number>> = { visible: 3, 'possible glimpses': 2, unknown: 1, 'not visible': 0 }

const measure = (text: string, size: number) => textWidth(text, size, 'bold') * WIDTH_MARGIN

/** A `width`-pixel picture's mark sizes: the labels' type size, the margin kept inside the picture, a ring's radius. */
const markSizes = (width: number) => {
  const base = Math.max(10, width * 0.022)
  return { base, pad: base * 0.3, ring: base * 1.2 }
}

/**
 * The rows a panorama's band must keep (`panoramaBand`) so every one of `marks` shows where it lies: each ring whole,
 * and above the topmost one room for a two-line label and its leader. Null without marks. Pixels of a `width` ×
 * `height` picture.
 */
export function markRows(
  marks: ReadonlyArray<{ y: number }>,
  width: number,
  height: number,
): { y: number; height: number } | null {
  if (!marks.length || width <= 0 || height <= 0) return null
  const { base, pad, ring } = markSizes(width)
  const ys = marks.map((m) => Math.min(1, Math.max(0, m.y)) * height)
  // Two lines at full size and an arrow's clearance (`clearance` below) over the ring.
  const top = Math.max(0, Math.min(...ys) - ring - pad - base * (2 * MARK_LINE_HEIGHT + 2.5))
  const bottom = Math.min(height, Math.max(...ys) + ring + pad)
  return { y: Math.round(top), height: Math.round(bottom) - Math.round(top) }
}

/**
 * Lays out `marks` over a `width` × `height` picture of which `band` (rows) is shown, or all of it. With `all`, every
 * block is marked; otherwise only the blocks not plainly seen.
 */
export function layoutBlockMarks(
  marks: readonly BlockMark[],
  width: number,
  height: number,
  options: { all: boolean; band?: { y: number; height: number } | null },
): PlacedBlockMark[] {
  const shown = marks.filter((m) => options.all || UNSEEN_STATUS[m.status])
  if (!shown.length) return []
  const top = options.band ? options.band.y : 0
  const bottom = options.band ? options.band.y + options.band.height : height
  const { base, pad, ring } = markSizes(width)
  const area: Box = { x: pad, y: top + pad, w: width - pad * 2, h: bottom - top - pad * 2 }
  const spacing = base * 0.6
  const anchors = shown.map((m): [number, number] => [
    Math.min(width - ring - pad, Math.max(ring + pad, m.x * width)),
    Math.min(bottom - ring - pad, Math.max(top + ring + pad, m.y * height)),
  ])
  const words = shown.map((m) => {
    const unseen = UNSEEN_STATUS[m.status]
    return unseen ? [m.label, `(${unseen})`] : [m.label]
  })
  // Wrap, then shrink, then cut: the first setting whose row fits the picture's width.
  const settings = [
    ...[1, 0.9, 0.8, 0.7, MIN_SHRINK].flatMap((scale) => [
      { wrap: false, scale },
      { wrap: true, scale },
    ]),
  ]
  const linesFor = (i: number, wrap: boolean, size: number) => {
    const lines = wrap ? words[i] : [words[i].join(' ')]
    return lines.map((line) => fitText(line, size, area.w / WIDTH_MARGIN, 'bold'))
  }
  const rowWidth = (wrap: boolean, size: number) =>
    shown.reduce(
      (sum, _, i) => sum + Math.max(...linesFor(i, wrap, size).map((line) => measure(line, size))),
      spacing * (shown.length - 1),
    )
  const chosen = settings.find((s) => rowWidth(s.wrap, base * s.scale) <= area.w) ?? settings[settings.length - 1]
  const size = base * chosen.scale
  const lines = shown.map((_, i) => linesFor(i, chosen.wrap, size))
  // Clearance from a label's edge to its mark: room for the ring, or for an arrow a few lines long.
  const clearance = (i: number) => (UNSEEN_STATUS[shown[i].status] ? ring + size * 0.5 : size * 2.5)
  const items = shown.map((m, i) => ({
    centerX: anchors[i][0],
    bottom: anchors[i][1] - clearance(i),
    w: Math.max(...lines[i].map((line) => measure(line, size))),
    h: lines[i].length * size * MARK_LINE_HEIGHT,
    priority: PRIORITY[m.status] ?? 0,
  }))
  let boxes = rowPlacement(items, area, spacing)
  // A row pushed down onto its marks (blocks near the top of the shown picture) goes under them instead, when it fits.
  const covered = boxes.some((box, i) => box && box.y + box.h > anchors[i][1] - ring)
  if (covered) {
    const tallest = Math.max(...items.map((item) => item.h))
    const rowTop = Math.max(...anchors.map((a, i) => a[1] + clearance(i)))
    if (rowTop + tallest <= area.y + area.h) boxes = boxes.map((box) => (box ? { ...box, y: rowTop } : null))
  }
  return shown.map((m, i) => {
    const box = boxes[i]
    const [ax, ay] = anchors[i]
    const unseen = !!UNSEEN_STATUS[m.status]
    let leader: PlacedBlockMark['leader'] = null
    if (box) {
      // The leader leaves the label as near above its mark as the label's width allows.
      const x = Math.min(box.x + box.w - size * 0.3, Math.max(box.x + size * 0.3, ax))
      const above = box.y + box.h <= ay
      const from: [number, number] = [x, above ? box.y + box.h + size * 0.15 : box.y - size * 0.15]
      const to: [number, number] = unseen ? [ax, above ? ay - ring : ay + ring] : [ax, ay]
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) > size * 0.3) leader = [from, to]
    }
    return { anchor: [ax, ay], unseen, ring, lines: lines[i], size, box, leader }
  })
}
