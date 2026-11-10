/**
 * Fixed-interval contours from a regular grid, for printing. Unlike the plan view's adaptive
 * contours, the interval is the one asked for; when the lines would exceed the segment budget the
 * interval doubles and the result says so, so a sheet never labels 20 m lines "10 m".
 * Lines are returned in grid coordinates (column, row of sample centres). No DOM or network access.
 */

export interface ValueGrid {
  width: number
  height: number
  /** Row-major from the top-left; NaN is no data. */
  values: Float32Array | Float64Array
}

export interface ContourLevel {
  level: number
  /** Every `indexEvery`-th interval from zero. */
  index: boolean
  lines: [number, number][][]
}

export interface ContourResult {
  interval: number
  /** True when the requested interval was doubled to stay within the budget. */
  widened: boolean
  levels: ContourLevel[]
}

/** Segments a printed sheet's contours may hold before the interval is widened. */
export const MAX_SHEET_CONTOUR_SEGMENTS = 250_000

function crossings(grid: ValueGrid, interval: number) {
  let total = 0
  const { width, height, values } = grid
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const a = values[row * width + col],
        b = values[row * width + col + 1],
        c = values[(row + 1) * width + col + 1],
        d = values[(row + 1) * width + col]
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue
      total +=
        (Math.abs(Math.floor(a / interval) - Math.floor(b / interval)) +
          Math.abs(Math.floor(b / interval) - Math.floor(c / interval)) +
          Math.abs(Math.floor(c / interval) - Math.floor(d / interval)) +
          Math.abs(Math.floor(d / interval) - Math.floor(a / interval))) /
        2
    }
  return total
}

/** Joins segments that share an end into polylines. */
export function joinSegments(segments: [number, number][][]): [number, number][][] {
  const key = (p: [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
  const ends = new Map<string, number[]>()
  const keys = segments.map((segment, i) =>
    segment.map((p) => {
      const k = key(p)
      const list = ends.get(k)
      if (list) list.push(i)
      else ends.set(k, [i])
      return k
    }),
  )
  const used = new Uint8Array(segments.length)
  const lines: [number, number][][] = []
  const walk = (start: number, from: number) => {
    const line: [number, number][] = [segments[start][from]]
    let index = start,
      incoming = keys[start][from]
    while (!used[index]) {
      used[index] = 1
      const out = keys[index][0] === incoming ? 1 : 0
      line.push(segments[index][out])
      incoming = keys[index][out]
      const next = (ends.get(incoming) ?? []).filter((candidate) => !used[candidate])
      if (next.length !== 1) break
      index = next[0]
    }
    if (line.length > 1) lines.push(line)
  }
  // Open ends first, then the closed loops left over.
  segments.forEach((_, i) => {
    if (used[i]) return
    const open = keys[i].findIndex((k) => ends.get(k)?.length === 1)
    if (open >= 0) walk(i, open)
  })
  segments.forEach((_, i) => {
    if (!used[i]) walk(i, 0)
  })
  return lines
}

/**
 * Marching squares at `interval`, flagging every `indexEvery`-th level as an index contour. Cells
 * with any missing corner draw nothing: no line is invented across a gap.
 */
export function gridContours(grid: ValueGrid, interval: number, indexEvery = 2): ContourResult {
  if (!(interval > 0)) throw Error('The contour interval must be positive.')
  let used = interval
  while (crossings(grid, used) > MAX_SHEET_CONTOUR_SEGMENTS) used *= 2
  const { width, height, values } = grid
  const byLevel = new Map<number, [number, number][][]>()
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const h = [
        values[row * width + col],
        values[row * width + col + 1],
        values[(row + 1) * width + col + 1],
        values[(row + 1) * width + col],
      ]
      if (!h.every(Number.isFinite)) continue
      const low = Math.min(...h),
        high = Math.max(...h)
      const corners: [number, number][] = [
        [col, row],
        [col + 1, row],
        [col + 1, row + 1],
        [col, row + 1],
      ]
      for (let level = (Math.floor(low / used) + 1) * used; level <= high; level += used) {
        const hits: [number, number][] = []
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4
          if (h[edge] < level === h[next] < level) continue
          const t = (level - h[edge]) / (h[next] - h[edge])
          hits.push([
            corners[edge][0] + (corners[next][0] - corners[edge][0]) * t,
            corners[edge][1] + (corners[next][1] - corners[edge][1]) * t,
          ])
        }
        const list = byLevel.get(level) ?? []
        if (hits.length === 2) list.push([hits[0], hits[1]])
        else if (hits.length === 4) {
          // Saddle: pair the crossings by the sign of the bilinear centre.
          const centre = h[0] * h[2] - h[1] * h[3] - level * (h[0] + h[2] - h[1] - h[3]) >= 0
          if (centre) list.push([hits[0], hits[1]], [hits[2], hits[3]])
          else list.push([hits[0], hits[3]], [hits[1], hits[2]])
        }
        if (list.length) byLevel.set(level, list)
      }
    }
  const step = used * indexEvery
  return {
    interval: used,
    widened: used !== interval,
    levels: [...byLevel]
      .sort((a, b) => a[0] - b[0])
      .map(([level, segments]) => ({
        level,
        index: Math.abs(level / step - Math.round(level / step)) < 1e-9,
        lines: joinSegments(segments),
      })),
  }
}
