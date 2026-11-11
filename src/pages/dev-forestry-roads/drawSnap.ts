/**
 * Snapping a pegged point onto a road already on the plan, so a new road can start or end on it
 * (a branch) or join its end. No DOM access: the caller passes the lines and the plan's scale.
 *
 * The snapped point lies exactly on the other road's line. That is what joins it: the network
 * planner attaches a road to the line it touches by projecting onto that line's segments
 * (`connected-network.md`), and a branch needs no change to the road it starts from.
 */
import type { Coordinate } from './types'

/** How close, in screen pixels, a click has to be to a road to land on it. */
export const DRAW_SNAP_PX = 12

export interface SnapLine {
  id: string
  name: string
  /** A road in this project's design, or an existing road on the map. */
  kind: 'design' | 'existing'
  coordinates: Coordinate[]
}

export interface DrawSnap {
  coordinate: Coordinate
  lineId: string
  name: string
  kind: SnapLine['kind']
  /** On one of the line's ends, or partway along it (a branch). */
  at: 'start' | 'end' | 'line'
  /** From the clicked point to the snapped one, m. */
  distanceM: number
}

/** Each line with its box, so a pointer move skips every line it cannot reach. */
export interface SnapIndex {
  lines: { line: SnapLine; box: [number, number, number, number] }[]
}

export function snapIndex(lines: readonly SnapLine[]): SnapIndex {
  return {
    lines: lines
      .filter((line) => line.coordinates.length >= 2)
      .map((line) => {
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity
        for (const [x, y] of line.coordinates) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
        return { line, box: [x0, y0, x1, y1] }
      }),
  }
}

const M_PER_DEGREE = 111_320

/**
 * The nearest road within `tolerancePx` of `point`, or null. An end within reach wins over a
 * nearer point partway along, so joining a road end-to-end is never missed by a pixel.
 */
export function snapToRoads(
  point: Coordinate,
  index: SnapIndex,
  metresPerPixel: number,
  tolerancePx = DRAW_SNAP_PX,
): DrawSnap | null {
  const toleranceM = metresPerPixel * tolerancePx
  if (!(toleranceM > 0)) return null
  const kx = M_PER_DEGREE * Math.cos((point[1] * Math.PI) / 180)
  const ky = M_PER_DEGREE
  const padX = toleranceM / kx
  const padY = toleranceM / ky
  const local = ([x, y]: Coordinate): [number, number] => [(x - point[0]) * kx, (y - point[1]) * ky]
  let bestEnd: DrawSnap | null = null
  let bestLine: DrawSnap | null = null
  for (const { line, box } of index.lines) {
    if (point[0] < box[0] - padX || point[0] > box[2] + padX || point[1] < box[1] - padY || point[1] > box[3] + padY)
      continue
    const coords = line.coordinates
    for (const [at, end] of [
      ['start', coords[0]],
      ['end', coords[coords.length - 1]],
    ] as const) {
      const [ex, ey] = local(end)
      const d = Math.hypot(ex, ey)
      if (d <= toleranceM && (!bestEnd || d < bestEnd.distanceM))
        bestEnd = { coordinate: end, lineId: line.id, name: line.name, kind: line.kind, at, distanceM: d }
    }
    for (let i = 1; i < coords.length; i++) {
      const [ax, ay] = local(coords[i - 1])
      const [bx, by] = local(coords[i])
      const dx = bx - ax,
        dy = by - ay
      const length2 = dx * dx + dy * dy
      const t = length2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2)) : 0
      const px = ax + t * dx,
        py = ay + t * dy
      const d = Math.hypot(px, py)
      if (d > toleranceM || (bestLine && d >= bestLine.distanceM)) continue
      bestLine = {
        coordinate: [point[0] + px / kx, point[1] + py / ky],
        lineId: line.id,
        name: line.name,
        kind: line.kind,
        at: 'line',
        distanceM: d,
      }
    }
  }
  return bestEnd ?? bestLine
}

/** What the notice says about a snapped peg. */
export function snapNotice(snap: DrawSnap, first: boolean): string {
  if (snap.at === 'line') return first ? `This road branches from ${snap.name}.` : `This road ends on ${snap.name}.`
  return `${first ? 'Starts' : 'Ends'} at the ${snap.at} of ${snap.name}.`
}
