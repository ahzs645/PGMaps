/**
 * Printed contours to elevations to a terrain grid. A sheet's contour lines are lossless vector
 * drawing, and its elevation labels sit on their own line, so a line's height comes from the
 * label printed on it and unlabelled lines take the nearest interval step of the surface their
 * labelled neighbours make. Nothing here guesses an elevation the sheet does not print or imply.
 * DOM and network free: page coordinates and a frame in, a typed grid out.
 */
import Delaunator from 'delaunator'
import { transform } from './paths'
import { PDF_LIMITS, type Box, type Matrix, type XY } from './types'

export interface ContourLabel {
  /** Centre of the printed number, PDF user space. */
  at: XY
  value: number
}
export interface ContourAssignment {
  /** Elevation of each line, or null where the sheet gives no consistent height. */
  elevations: (number | null)[]
  interval: number
  labels: number
  /** Labels lying on exactly one contour line. */
  labelsOnLines: number
  /** Labels left out because their value is off the interval or disagrees with the lines around them. */
  labelsRejected: number
  /** Lines carrying two different printed values. */
  conflicts: number
  labelledLines: number
  /** Lines given a height from their labelled neighbours. */
  inferredLines: number
  unassignedLines: number
}
export interface PdfContourSurface {
  version: 1
  /** Projected CRS of the grid; the road tools accept BC Albers and UTM. */
  epsg: number
  cellM: number
  /** Centre of the top-left cell; rows run south. */
  origin: [number, number]
  width: number
  height: number
  /** Metres; NaN outside the map frame and the contours' triangulated area. */
  values: Float32Array
  assignment: Omit<ContourAssignment, 'elevations'>
  /** Contour vertices after thinning along each line. */
  vertices: number
  method: ContourMethod
  notes: string[]
}

/** Printed numbers that could be contour labels: digits only, inside the map frame. */
export function readContourLabels(
  items: ReadonlyArray<{ str: string; transform: number[]; width: number; height: number }>,
  frame: Box,
  pattern: RegExp = /^-?\d{1,5}$/,
): ContourLabel[] {
  const out: ContourLabel[] = []
  for (const item of items) {
    const text = item.str.trim()
    if (!pattern.test(text) || !Number.isFinite(Number(text))) continue
    const [a, b, c, d, e, f] = item.transform
    const along = Math.hypot(a, b),
      up = Math.hypot(c, d)
    if (!(along > 0 && up > 0)) continue
    // Baseline start + half the advance along the baseline + about a third of the size upward:
    // the middle of the digits, where the line the number labels runs.
    const at: XY = [
      e + (a / along) * (item.width / 2) + (c / up) * (item.height * 0.35),
      f + (b / along) * (item.width / 2) + (d / up) * (item.height * 0.35),
    ]
    if (at[0] < frame[0] || at[0] > frame[2] || at[1] < frame[1] || at[1] > frame[3]) continue
    out.push({ at, value: Number(text) })
  }
  return out
}

/** Buckets of segments, so a label finds the lines near it without scanning a million segments. */
export class SegmentIndex {
  private cells = new Map<number, number[]>()
  private segments: { line: number; a: XY; b: XY }[] = []
  constructor(
    lines: XY[][],
    private size: number,
  ) {
    lines.forEach((line, index) => {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i],
          id = this.segments.push({ line: index, a, b }) - 1
        for (let x = Math.floor(Math.min(a[0], b[0]) / size); x <= Math.floor(Math.max(a[0], b[0]) / size); x++)
          for (let y = Math.floor(Math.min(a[1], b[1]) / size); y <= Math.floor(Math.max(a[1], b[1]) / size); y++) {
            const key = x * 1_000_003 + y
            const cell = this.cells.get(key)
            if (cell) cell.push(id)
            else this.cells.set(key, [id])
          }
      }
    })
  }
  /** Nearest distance to each line within `radius` of the point. */
  near(p: XY, radius: number): Map<number, number> {
    const found = new Map<number, number>()
    for (let x = Math.floor((p[0] - radius) / this.size); x <= Math.floor((p[0] + radius) / this.size); x++)
      for (let y = Math.floor((p[1] - radius) / this.size); y <= Math.floor((p[1] + radius) / this.size); y++)
        for (const id of this.cells.get(x * 1_000_003 + y) ?? []) {
          const { line, a, b } = this.segments[id]
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
          const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
          if (d <= radius && d < (found.get(line) ?? Infinity)) found.set(line, d)
        }
    return found
  }
}

/** A label belongs to a line it lies on, and only when no other line is nearly as close. */
export const LABEL_ON_LINE_PT = 1
export const LABEL_MARGIN_PT = 0.5
/** An unlabelled line takes a height only if its neighbours' surface puts it this close to an interval step. */
const SNAP_SHARE = 0.3
/**
 * A contour TIN's triangles join one contour to the same or the next one. A longer edge bridges
 * ground the sheet's contours never reached (it fanned across the north-east of the supplied sheet,
 * where only an unnamed contour set is drawn), so such triangles stay empty: unknown, not invented.
 */
export const CONTOUR_TIN_MAX_EDGE_M = 200
const INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100]

/** Grid in page units used only to carry heights between labelled and unlabelled lines. */
interface PageGrid {
  x0: number
  y0: number
  cell: number
  width: number
  height: number
  values: Float32Array
}
function surfaceFrom(
  lines: XY[][],
  heights: (number | null)[],
  frame: Box,
  cell: number,
  step: number,
  maxEdge: number,
): PageGrid {
  const coords: number[] = [],
    z: number[] = []
  lines.forEach((line, i) => {
    const h = heights[i]
    if (h === null) return
    let last: XY | null = null
    line.forEach((p, k) => {
      if (last && k < line.length - 1 && Math.hypot(p[0] - last[0], p[1] - last[1]) < step) return
      coords.push(p[0], p[1])
      z.push(h)
      last = p
    })
  })
  const width = Math.ceil((frame[2] - frame[0]) / cell) + 1,
    height = Math.ceil((frame[3] - frame[1]) / cell) + 1
  const values = new Float32Array(width * height).fill(NaN)
  if (z.length >= 3) {
    const tin = new Delaunator(coords)
    rasterizeTriangles(Float64Array.from(coords), Float64Array.from(z), tin.triangles, {
      ox: frame[0],
      oy: frame[1],
      cell,
      width,
      height,
      ascending: true,
      values,
      maxEdge,
    })
  }
  return { x0: frame[0], y0: frame[1], cell, width, height, values }
}
function sample(grid: PageGrid, [x, y]: XY): number {
  const c = Math.round((x - grid.x0) / grid.cell),
    r = Math.round((y - grid.y0) / grid.cell)
  if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) return NaN
  return grid.values[r * grid.width + c]
}
/** Median of the surface along a line, or NaN where too little of it is covered. */
function lineHeight(grid: PageGrid, line: XY[]): number {
  const stride = Math.max(1, Math.floor(line.length / 64))
  const values: number[] = []
  for (let i = 0; i < line.length; i += stride) {
    const v = sample(grid, line[i])
    if (Number.isFinite(v)) values.push(v)
  }
  if (values.length < Math.min(3, line.length)) return NaN
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

/**
 * Elevations for contour lines from the labels printed on them. Labels must lie on exactly one
 * line; their values set the interval; a two-fold check drops labels that disagree with the lines
 * around them (a spot height or a reach number that happens to touch a contour). Unlabelled lines
 * take the interval step their labelled neighbours' surface puts them on, and stay unassigned when
 * that surface sits between two steps.
 */
export function assignContourElevations(
  lines: XY[][],
  labels: ContourLabel[],
  frame: Box,
  { statedInterval, metresPerUnit = 1 }: { statedInterval?: number; metresPerUnit?: number } = {},
): ContourAssignment {
  const maxEdge = CONTOUR_TIN_MAX_EDGE_M / metresPerUnit
  const index = new SegmentIndex(lines, 4)
  const votes = new Map<number, Set<number>>()
  let labelsOnLines = 0
  for (const label of labels) {
    const near = [...index.near(label.at, LABEL_ON_LINE_PT + LABEL_MARGIN_PT + 1)].sort((a, b) => a[1] - b[1])
    if (!near.length || near[0][1] > LABEL_ON_LINE_PT || (near[1] && near[1][1] < near[0][1] + LABEL_MARGIN_PT))
      continue
    labelsOnLines++
    const set = votes.get(near[0][0]) ?? new Set<number>()
    set.add(label.value)
    votes.set(near[0][0], set)
  }
  const elevations: (number | null)[] = lines.map(() => null)
  let conflicts = 0
  for (const [line, values] of votes) {
    if (values.size > 1) conflicts++
    else elevations[line] = [...values][0]
  }
  const labelled = elevations.flatMap((v) => (v === null ? [] : [v]))
  // The legend's stated interval wins. Otherwise the largest step most labels sit on: a stray spot
  // height does not lower it, and a step too coarse only leaves intermediate lines unassigned.
  const interval =
    statedInterval ??
    [...INTERVALS].reverse().find((step) => labelled.filter((v) => v % step === 0).length >= labelled.length * 0.8) ??
    1
  let rejected = 0
  elevations.forEach((v, i) => {
    if (v !== null && v % interval !== 0) {
      elevations[i] = null
      rejected++
    }
  })
  const cell = 2
  // Two-fold check: each half of the labelled lines against the surface of the other half.
  const ids = elevations.flatMap((v, i) => (v === null ? [] : [i]))
  for (const half of [0, 1]) {
    const others = elevations.map((v, i) => (ids.indexOf(i) % 2 === half ? null : v))
    const grid = surfaceFrom(lines, others, frame, cell, cell, maxEdge)
    for (const id of ids.filter((_, k) => k % 2 === half)) {
      const predicted = lineHeight(grid, lines[id])
      if (Number.isFinite(predicted) && Math.abs(predicted - elevations[id]!) >= interval) {
        elevations[id] = null
        rejected++
      }
    }
  }
  const labelledLines = elevations.filter((v) => v !== null).length
  for (let round = 0; round < 8; round++) {
    const grid = surfaceFrom(lines, elevations, frame, cell, cell, maxEdge)
    let added = 0
    const next = [...elevations]
    lines.forEach((line, i) => {
      if (elevations[i] !== null) return
      const h = lineHeight(grid, line)
      if (!Number.isFinite(h)) return
      const step = Math.round(h / interval) * interval
      if (Math.abs(h - step) <= interval * SNAP_SHARE) {
        next[i] = step
        added++
      }
    })
    elevations.splice(0, elevations.length, ...next)
    if (!added) break
  }
  const assigned = elevations.filter((v) => v !== null).length
  return {
    elevations,
    interval,
    labels: labels.length,
    labelsOnLines,
    labelsRejected: rejected,
    conflicts,
    labelledLines,
    inferredLines: assigned - labelledLines,
    unassignedLines: lines.length - assigned,
  }
}

/** Fills each grid cell centre inside a triangle with that triangle's plane. */
export function rasterizeTriangles(
  coords: Float64Array,
  z: Float64Array,
  triangles: Uint32Array,
  grid: {
    ox: number
    oy: number
    cell: number
    width: number
    height: number
    /** Rows run up (page grids) or down (projected, north-up) from (ox, oy), the first cell centre. */
    ascending: boolean
    values: Float32Array
    /** Triangles with a longer edge are left empty: they bridge ground the contours never covered. */
    maxEdge?: number
    /** Triangles rising more than this are left empty: they skip a contour the sheet does not give. */
    maxRise?: number
  },
) {
  const { ox, oy, cell, width, height, ascending, values, maxEdge = Infinity, maxRise = Infinity } = grid
  const longest = maxEdge * maxEdge
  const sign = ascending ? 1 : -1
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t],
      b = triangles[t + 1],
      c = triangles[t + 2]
    const x0 = coords[a * 2],
      y0 = coords[a * 2 + 1],
      ux = coords[b * 2] - x0,
      uy = coords[b * 2 + 1] - y0,
      vx = coords[c * 2] - x0,
      vy = coords[c * 2 + 1] - y0
    const det = ux * vy - vx * uy
    if (!det) continue
    if (
      ux * ux + uy * uy > longest ||
      vx * vx + vy * vy > longest ||
      (vx - ux) ** 2 + (vy - uy) ** 2 > longest ||
      Math.max(z[a], z[b], z[c]) - Math.min(z[a], z[b], z[c]) > maxRise
    )
      continue
    const dz1 = z[b] - z[a],
      dz2 = z[c] - z[a]
    const gx = (dz1 * vy - dz2 * uy) / det,
      gy = (ux * dz2 - vx * dz1) / det
    const xs = [x0, x0 + ux, x0 + vx],
      ys = [y0, y0 + uy, y0 + vy]
    const c0 = Math.max(0, Math.ceil((Math.min(...xs) - ox) / cell - 1e-9)),
      c1 = Math.min(width - 1, Math.floor((Math.max(...xs) - ox) / cell + 1e-9))
    const rowsAt = (y: number) => (sign * (y - oy)) / cell
    const ra = rowsAt(Math.min(...ys)),
      rb = rowsAt(Math.max(...ys))
    const r0 = Math.max(0, Math.ceil(Math.min(ra, rb) - 1e-9)),
      r1 = Math.min(height - 1, Math.floor(Math.max(ra, rb) + 1e-9))
    for (let row = r0; row <= r1; row++) {
      const dy = oy + sign * row * cell - y0
      for (let col = c0; col <= c1; col++) {
        const dx = ox + col * cell - x0
        const wb = (dx * vy - vx * dy) / det,
          wc = (ux * dy - dx * uy) / det
        if (wb < -1e-9 || wc < -1e-9 || 1 - wb - wc < -1e-9) continue
        values[row * width + col] = z[a] + gx * dx + gy * dy
      }
    }
  }
}

function inside(ring: XY[], [x, y]: XY) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit
  }
  return hit
}

/**
 * The assigned contours as a north-up grid in the map's projected CRS, clipped to the map frame.
 * Between contours the ground is the TIN's plane: crests and valley floors read flat, and the
 * surface knows nothing finer than the contour interval.
 */
/**
 * Nearest seed cell of every cell (−1 when there is none), by Felzenszwalb and Huttenlocher's exact
 * squared Euclidean distance transform with the minimising index carried through both passes.
 */
export function nearestSeeds(seed: Uint8Array, width: number, height: number): Int32Array {
  const FAR = 1e20
  const n = Math.max(width, height)
  const f = new Float64Array(n),
    d = new Float64Array(n),
    arg = new Int32Array(n),
    v = new Int32Array(n),
    z = new Float64Array(n + 1)
  const transform1d = (length: number) => {
    let k = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < length; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
      arg[q] = v[k]
    }
  }
  // Columns: distance to the nearest seed in the same column, and that seed's row.
  const columnD = new Float64Array(width * height),
    columnRow = new Int32Array(width * height)
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) f[row] = seed[row * width + col] ? 0 : FAR
    transform1d(height)
    for (let row = 0; row < height; row++) {
      columnD[row * width + col] = d[row]
      columnRow[row * width + col] = arg[row]
    }
  }
  const out = new Int32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) f[col] = columnD[row * width + col]
    transform1d(width)
    for (let col = 0; col < width; col++) {
      const from = arg[col]
      out[row * width + col] = d[col] >= FAR / 2 ? -1 : columnRow[row * width + from] * width + from
    }
  }
  return out
}

/**
 * How a contour surface fills the ground between lines. `tin` (the default) is the Delaunay surface
 * of the contour vertices. `nearest-contours` takes each cell's height between the nearest contour
 * on an even step and the nearest on an odd step (adjacent contours alternate), weighted by distance:
 * it has no flat triangles, but measured worse against the LiDAR slope sheet (67% within one range
 * against 69%, 52% of road stations against 62%) and rougher along roads, so it is opt-in only.
 */
export type ContourMethod = 'nearest-contours' | 'tin'

export function contourSurface(
  lines: XY[][],
  assignment: ContourAssignment,
  frame: { bbox: Box; pageToProjected: Matrix },
  epsg: number,
  {
    cellM = 2,
    maxCells = 4_194_304,
    method = 'tin',
  }: { cellM?: number; maxCells?: number; method?: ContourMethod } = {},
): PdfContourSurface {
  const [l, b, r, t] = frame.bbox
  const ring = (
    [
      [l, b],
      [r, b],
      [r, t],
      [l, t],
    ] as XY[]
  ).map((p) => transform(frame.pageToProjected, p))
  const minX = Math.min(...ring.map((p) => p[0])),
    maxX = Math.max(...ring.map((p) => p[0])),
    minY = Math.min(...ring.map((p) => p[1])),
    maxY = Math.max(...ring.map((p) => p[1]))
  let cell = cellM
  while ((Math.floor((maxX - minX) / cell) + 1) * (Math.floor((maxY - minY) / cell) + 1) > maxCells) cell *= 1.25
  const width = Math.floor((maxX - minX) / cell) + 1,
    height = Math.floor((maxY - minY) / cell) + 1
  const ox = minX + cell / 2,
    oy = maxY - cell / 2
  const coords: number[] = [],
    z: number[] = []
  lines.forEach((line, i) => {
    const h = assignment.elevations[i]
    if (h === null) return
    let last: XY | null = null
    line.forEach((page, k) => {
      const p = transform(frame.pageToProjected, page)
      if (last && k < line.length - 1 && Math.hypot(p[0] - last[0], p[1] - last[1]) < cell / 2) return
      coords.push(p[0], p[1])
      z.push(h)
      last = p
    })
  })
  if (z.length > PDF_LIMITS.contourVertices) throw Error('The contours exceed the terrain vertex budget.')
  if (z.length < 3) throw Error('Too few contour lines carry an elevation to build a surface.')
  const values = new Float32Array(width * height).fill(NaN)
  if (method === 'tin') {
    const tin = new Delaunator(coords)
    rasterizeTriangles(Float64Array.from(coords), Float64Array.from(z), tin.triangles, {
      ox,
      oy,
      cell,
      width,
      height,
      ascending: false,
      values,
      maxEdge: CONTOUR_TIN_MAX_EDGE_M,
      maxRise: assignment.interval + 1e-6,
    })
  } else {
    // Seed cells per parity of the contour step, each keeping the exact line point nearest its centre.
    const parities = [0, 1].map(() => ({
      seed: new Uint8Array(width * height),
      x: new Float32Array(width * height),
      y: new Float32Array(width * height),
      z: new Float32Array(width * height),
      gap: new Float32Array(width * height).fill(Infinity),
    }))
    const step = cell / 4
    lines.forEach((line, i) => {
      const h = assignment.elevations[i]
      if (h === null) return
      const level = Math.round(h / assignment.interval),
        target = parities[((level % 2) + 2) % 2]
      const points = line.map((p) => transform(frame.pageToProjected, p))
      for (let k = 1; k < points.length; k++) {
        const [ax, ay] = points[k - 1],
          [bx, by] = points[k]
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
        for (let s = 0; s <= n; s++) {
          const px = ax + ((bx - ax) * s) / n,
            py = ay + ((by - ay) * s) / n
          const col = Math.round((px - ox) / cell),
            row = Math.round((oy - py) / cell)
          if (col < 0 || row < 0 || col >= width || row >= height) continue
          const index = row * width + col,
            gap = Math.hypot(px - (ox + col * cell), py - (oy - row * cell))
          if (gap >= target.gap[index]) continue
          target.seed[index] = 1
          target.gap[index] = gap
          target.x[index] = px
          target.y[index] = py
          target.z[index] = h
        }
      }
    })
    const [even, odd] = parities
    const nearEven = nearestSeeds(even.seed, width, height),
      nearOdd = nearestSeeds(odd.seed, width, height)
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const index = row * width + col,
          a = nearEven[index],
          b = nearOdd[index]
        if (a < 0 || b < 0) continue
        const cx = ox + col * cell,
          cy = oy - row * cell
        const ax = even.x[a] - cx,
          ay = even.y[a] - cy,
          bx = odd.x[b] - cx,
          by = odd.y[b] - cy
        const da = Math.hypot(ax, ay),
          db = Math.hypot(bx, by),
          za = even.z[a],
          zb = odd.z[b]
        // A gap no contour pair spans, or a step the sheet skips, stays unknown.
        if (da + db > CONTOUR_TIN_MAX_EDGE_M || Math.abs(Math.abs(za - zb) - assignment.interval) > 1e-6) continue
        // Between the two lines: weighted by distance. Both on one side (a summit, a pit, a valley
        // floor inside one contour): the nearer line's height, as flat as the sheet says it is.
        values[index] = ax * bx + ay * by < 0 || da + db === 0 ? za + ((zb - za) * da) / (da + db) : da <= db ? za : zb
      }
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      if (!inside(ring, [ox + col * cell, oy - row * cell])) values[row * width + col] = NaN
  const summary: PdfContourSurface['assignment'] = {
    interval: assignment.interval,
    labels: assignment.labels,
    labelsOnLines: assignment.labelsOnLines,
    labelsRejected: assignment.labelsRejected,
    conflicts: assignment.conflicts,
    labelledLines: assignment.labelledLines,
    inferredLines: assignment.inferredLines,
    unassignedLines: assignment.unassignedLines,
  }
  return {
    version: 1,
    epsg,
    cellM: cell,
    origin: [ox, oy],
    width,
    height,
    values,
    assignment: summary,
    vertices: z.length,
    method,
    notes: [
      method === 'tin'
        ? `Built from the sheet's ${assignment.interval} m contours and the elevations printed on them as a triangulated surface: triangles on one contour make flat terraces, crests and valley floors read flat, and nothing finer than the contour interval is known. Where no labelled contour reaches (gaps over ${CONTOUR_TIN_MAX_EDGE_M} m, or a skipped contour) the surface is left empty.`
        : `Built from the sheet's ${assignment.interval} m contours and the elevations printed on them: each cell lies between its two nearest contours, weighted by distance. Summits and valley floors inside one contour read flat, and nothing finer than the contour interval is known. Where no labelled contour pair reaches (gaps over ${CONTOUR_TIN_MAX_EDGE_M} m, or a skipped contour) the surface is left empty.`,
      `${summary.labelledLines} lines carry a printed elevation; ${summary.inferredLines} more take the interval step their labelled neighbours put them on; ${summary.unassignedLines} stay out (between two steps or isolated).`,
      'Vertical datum is not printed on the sheet; you state it when using the surface as terrain.',
    ],
  }
}
