/**
 * A map sheet as a flat list of drawing operations in PDF points, origin top-left. The composer
 * builds the list and two thin back-ends draw it: jsPDF for the file and SVG for the preview, so
 * both show exactly the same sheet. The geometry helpers here (hatching, labels along lines,
 * stroke dashes) are what make the symbols look like the reference sheets. No DOM or network access.
 */
import type { SheetFontStyle } from './textMetrics'

export type Point = [number, number]

export interface StrokeStyle {
  color: string
  width: number
  /** On/off lengths in points. */
  dash?: number[]
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
  opacity?: number
}

export type RasterImage =
  /** Straight (not premultiplied) RGBA, row-major from the top-left. */
  | { kind: 'rgba'; data: Uint8ClampedArray; width: number; height: number }
  /** An encoded image, as a data URL. */
  | { kind: 'url'; url: string; format: 'PNG' | 'JPEG'; width: number; height: number }

export type DrawOp =
  | {
      op: 'rect'
      x: number
      y: number
      w: number
      h: number
      fill?: string
      fillOpacity?: number
      stroke?: StrokeStyle
    }
  | {
      op: 'path'
      /** Sub-paths; each is a polyline, or a ring when `closed`. */
      parts: Point[][]
      closed: boolean
      fill?: string
      fillOpacity?: number
      stroke?: StrokeStyle
    }
  | { op: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: StrokeStyle }
  | {
      op: 'text'
      x: number
      y: number
      text: string
      size: number
      style?: SheetFontStyle
      family?: 'helvetica' | 'times'
      color: string
      align?: 'left' | 'center' | 'right'
      /** Baseline placement: `middle` centres the cap height on y. */
      baseline?: 'alphabetic' | 'middle'
      /** Degrees counter-clockwise, as jsPDF reads it. */
      angle?: number
      /** A white (or other) outline drawn under the glyphs. */
      halo?: { color: string; width: number }
    }
  | { op: 'image'; x: number; y: number; w: number; h: number; image: RasterImage }
  /** Everything up to the matching `restore` is clipped to these rings (even-odd). */
  | { op: 'clip'; parts: Point[][] }
  | { op: 'restore' }

export const rectRing = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

/**
 * Parallel lines at `angleDeg` (counter-clockwise from east, as on paper) every `spacing` points,
 * covering the box. Clip them to the area they fill.
 */
export function hatchLines(
  box: { x: number; y: number; w: number; h: number },
  angleDeg: number,
  spacing: number,
  /** Shift of every line along the normal, points: a second colour drawn between the first's lines. */
  phase = 0,
): Point[][] {
  if (!(spacing > 0) || !(box.w > 0) || !(box.h > 0)) return []
  // Paper y runs down, so a line rising to the right has a negative y step.
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a),
    dy = -Math.sin(a)
  // Normal to the lines; offsets along it are where the lines sit.
  const nx = -dy,
    ny = dx
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2
  const reach = Math.hypot(box.w, box.h) / 2
  const lines: Point[][] = []
  // Anchor offsets to the page origin so neighbouring areas' hatches line up.
  const base = cx * nx + cy * ny
  const phaseShift = ((phase % spacing) + spacing) % spacing
  const first = Math.ceil((base - reach - phaseShift) / spacing) * spacing + phaseShift
  for (let offset = first; offset <= base + reach; offset += spacing) {
    const shift = offset - base
    const px = cx + nx * shift,
      py = cy + ny * shift
    lines.push([
      [px - dx * reach, py - dy * reach],
      [px + dx * reach, py + dy * reach],
    ])
  }
  return lines
}

export interface LineLabel {
  x: number
  y: number
  /** Degrees counter-clockwise, kept between −90 and 90 so the text reads left to right. */
  angle: number
}

/**
 * Places labels along a polyline every `spacing` points, starting half a spacing in, on stretches
 * straight enough to carry `labelWidth` of text. Only anchors inside `bounds` (less `margin`) are kept.
 */
export function labelsAlongLine(
  line: Point[],
  spacing: number,
  labelWidth: number,
  bounds: { x: number; y: number; w: number; h: number },
  margin = 4,
  /** Distance of the first label from the start; defaults to half a spacing. */
  start?: number,
): LineLabel[] {
  if (line.length < 2) return []
  const cumulative = [0]
  for (let i = 1; i < line.length; i++)
    cumulative.push(cumulative[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  const total = cumulative.at(-1)!
  if (total < labelWidth * 1.5) return []
  const at = (distance: number): Point => {
    let i = 1
    while (i < cumulative.length - 1 && cumulative[i] < distance) i++
    const span = cumulative[i] - cumulative[i - 1] || 1
    const t = (distance - cumulative[i - 1]) / span
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]
  }
  const labels: LineLabel[] = []
  for (let d = start ?? Math.min(spacing / 2, total / 2); d + labelWidth / 2 <= total; d += spacing) {
    if (d - labelWidth / 2 < 0) continue
    const start = at(d - labelWidth / 2),
      end = at(d + labelWidth / 2),
      middle = at(d)
    const chord = Math.hypot(end[0] - start[0], end[1] - start[1])
    // A sharp bend under the label would make it read off the line.
    if (chord < labelWidth * 0.85) continue
    if (
      middle[0] < bounds.x + margin + labelWidth / 2 ||
      middle[0] > bounds.x + bounds.w - margin - labelWidth / 2 ||
      middle[1] < bounds.y + margin + labelWidth / 2 ||
      middle[1] > bounds.y + bounds.h - margin - labelWidth / 2
    )
      continue
    let angle = (Math.atan2(-(end[1] - start[1]), end[0] - start[0]) * 180) / Math.PI
    if (angle > 90) angle -= 180
    if (angle < -90) angle += 180
    labels.push({ x: middle[0], y: middle[1], angle })
  }
  return labels
}

/** A marker placed along a line: where, and the line's direction there. */
export interface LineMarkerPlacement {
  x: number
  y: number
  /** Direction of travel, degrees counter-clockwise from east on paper. Not flipped to read upright. */
  angle: number
}

/** Most markers one line carries; past it the spacing is widened so the count fits. */
export const MAX_LINE_MARKERS = 4000

/**
 * Markers every `spacing` points along a polyline, the first `start` in (half a spacing by
 * default), none past the end. Each takes the direction of the segment it lands on.
 */
export function markersAlongLine(line: Point[], spacing: number, start = spacing / 2): LineMarkerPlacement[] {
  if (line.length < 2 || !(spacing > 0)) return []
  let total = 0
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
  if (!(total > 0)) return []
  const step = Math.max(spacing, total / MAX_LINE_MARKERS)
  const out: LineMarkerPlacement[] = []
  let segment = 1,
    travelled = 0
  for (let d = Math.max(0, start); d <= total + 1e-9; d += step) {
    // Walk forward to the segment holding d; segments are never revisited.
    while (segment < line.length - 1) {
      const length = Math.hypot(line[segment][0] - line[segment - 1][0], line[segment][1] - line[segment - 1][1])
      if (travelled + length >= d) break
      travelled += length
      segment++
    }
    const [ax, ay] = line[segment - 1],
      [bx, by] = line[segment]
    const length = Math.hypot(bx - ax, by - ay)
    const t = length > 0 ? Math.min(1, (d - travelled) / length) : 0
    out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: (Math.atan2(-(by - ay), bx - ax) * 180) / Math.PI })
  }
  return out
}

/**
 * The polyline moved `offset` points sideways: positive to the right of travel, as MapLibre's
 * `line-offset`. Corners are mitred, the miter held to four times the offset so a hairpin stays near.
 */
export function offsetPolyline(line: Point[], offset: number): Point[] {
  if (!offset || line.length < 2) return line
  const normals: Point[] = []
  for (let i = 1; i < line.length; i++) {
    const dx = line[i][0] - line[i - 1][0],
      dy = line[i][1] - line[i - 1][1]
    const length = Math.hypot(dx, dy) || 1
    // Right of travel on paper (y down) is (−dy, dx).
    normals.push([-dy / length, dx / length])
  }
  return line.map(([x, y], i) => {
    const a = normals[Math.max(0, i - 1)],
      b = normals[Math.min(normals.length - 1, i)]
    let mx = a[0] + b[0],
      my = a[1] + b[1]
    const m = Math.hypot(mx, my)
    if (m < 1e-9) return [x + b[0] * offset, y + b[1] * offset] as Point
    mx /= m
    my /= m
    const scale = Math.min(4, 1 / Math.max(0.25, mx * b[0] + my * b[1]))
    return [x + mx * offset * scale, y + my * offset * scale] as Point
  })
}

/** Box of a set of point lists; null when there are no points. */
export function boundsOf(parts: Point[][]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const part of parts)
    for (const [x, y] of part) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null
}

/** True when two boxes overlap or touch. */
export const boxesMeet = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/**
 * Keeps labels apart: `place` accepts a label only when no accepted one has its centre within
 * `distance` points. Hashed on a grid, so thousands of contour labels stay cheap.
 */
export function labelSpacer(distance: number) {
  const cells = new Map<string, Point[]>()
  const key = (x: number, y: number) => `${Math.floor(x / distance)},${Math.floor(y / distance)}`
  return (x: number, y: number) => {
    const cx = Math.floor(x / distance),
      cy = Math.floor(y / distance)
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const [px, py] of cells.get(`${i},${j}`) ?? []) if (Math.hypot(px - x, py - y) < distance) return false
    const list = cells.get(key(x, y)) ?? []
    list.push([x, y])
    cells.set(key(x, y), list)
    return true
  }
}
