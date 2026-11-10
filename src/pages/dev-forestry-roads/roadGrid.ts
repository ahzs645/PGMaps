/**
 * Planar line and grid helpers shared by road finding (`roadRelocation.ts`), click tracing
 * (`roadTrace.ts`) and bench measurement (`roadSlices.ts`). Everything is in projected metres on
 * a `SurfaceGrid`'s axes. Pure: no DOM or network access; terrain is passed in as a function.
 */
import type { GridBounds, SurfaceGrid, ToLonLat } from './surfaceGrid'
import type { TerrainSource } from './types'

export type XY = [number, number]

/**
 * Where a search reads its ground when it is not handed a grid: the project's terrain sampled at
 * `cellM` on a grid in the projection `toLonLat` inverts.
 */
export interface TerrainSampler {
  terrain: TerrainSource
  toLonLat: ToLonLat
  /** Sampling cell, metres. */
  cellM: number
}
export type GroundInput = SurfaceGrid | TerrainSampler
export const isSurfaceGrid = (ground: GroundInput): ground is SurfaceGrid => 'values' in ground

/** Cumulative length at each vertex. */
export function cumulativeLength(line: readonly XY[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++)
    out.push(out[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  return out
}
export const lineLength = (line: readonly XY[]) => cumulativeLength(line).at(-1) ?? 0

/** The point `s` metres along the line and the unit direction of the segment it is on. */
export function pointAlong(line: readonly XY[], cum: readonly number[], s: number): { at: XY; dir: XY } {
  const total = cum.at(-1) ?? 0
  const t = Math.max(0, Math.min(total, s))
  let i = 1
  while (i < line.length - 1 && cum[i] < t) i++
  const a = line[i - 1],
    b = line[i]
  const span = cum[i] - cum[i - 1]
  const f = span > 0 ? (t - cum[i - 1]) / span : 0
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy) || 1
  return { at: [a[0] + dx * f, a[1] + dy * f], dir: [dx / len, dy / len] }
}

/** Closest point of the line to `p`: its distance and its chainage along the line. */
export function nearestOnLine(
  line: readonly XY[],
  cum: readonly number[],
  p: XY,
): { distance: number; chainage: number; at: XY } {
  let best = { distance: Infinity, chainage: 0, at: line[0] as XY }
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i]
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    const x = a[0] + t * dx,
      y = a[1] + t * dy
    const d = Math.hypot(p[0] - x, p[1] - y)
    if (d < best.distance) best = { distance: d, chainage: cum[i - 1] + t * Math.sqrt(l2), at: [x, y] }
  }
  if (line.length === 1) best = { distance: Math.hypot(p[0] - line[0][0], p[1] - line[0][1]), chainage: 0, at: line[0] }
  return best
}

/** Points every `stepM` along the line, both ends included. */
export function resampleLine(line: readonly XY[], stepM: number): XY[] {
  const cum = cumulativeLength(line)
  const total = cum.at(-1) ?? 0
  if (total <= 0) return line.length ? [line[0]] : []
  const n = Math.max(1, Math.ceil(total / stepM))
  return Array.from({ length: n + 1 }, (_, i) => pointAlong(line, cum, (total * i) / n).at)
}

/** The part of the line between chainages `from` and `to` (from ≤ to). */
export function subLine(line: readonly XY[], cum: readonly number[], from: number, to: number): XY[] {
  const total = cum.at(-1) ?? 0
  const a = Math.max(0, Math.min(total, from)),
    b = Math.max(a, Math.min(total, to))
  const out: XY[] = [pointAlong(line, cum, a).at]
  for (let i = 0; i < line.length; i++) if (cum[i] > a && cum[i] < b) out.push(line[i])
  out.push(pointAlong(line, cum, b).at)
  return out
}

/** Ramer–Douglas–Peucker in the plane. */
export function simplifyLine(line: readonly XY[], toleranceM: number): XY[] {
  if (line.length < 3) return [...line]
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    const [ax, ay] = line[start],
      [bx, by] = line[end]
    const dx = bx - ax,
      dy = by - ay,
      span = Math.hypot(dx, dy)
    let worst = -1,
      worstD = 0
    for (let i = start + 1; i < end; i++) {
      const [px, py] = line[i]
      const d = span ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / span : Math.hypot(px - ax, py - ay)
      if (d > worstD) {
        worst = i
        worstD = d
      }
    }
    if (worst > 0 && worstD > toleranceM) {
      keep[worst] = 1
      stack.push([start, worst], [worst, end])
    }
  }
  return line.filter((_, i) => keep[i])
}

/** Centred moving average over `window` vertices; the ends stay where they are. */
export function smoothLine(line: readonly XY[], window: number): XY[] {
  const half = Math.floor(window / 2)
  if (line.length <= 2 || half < 1) return [...line]
  return line.map((p, i) => {
    if (i === 0 || i === line.length - 1) return p
    const h = Math.min(half, i, line.length - 1 - i)
    let x = 0,
      y = 0
    for (let k = i - h; k <= i + h; k++) {
      x += line[k][0]
      y += line[k][1]
    }
    return [x / (2 * h + 1), y / (2 * h + 1)] as XY
  })
}

/** Linear-interpolated quantile of an ascending list; null when empty. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at),
    hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

export function spreadOf(values: readonly number[]): { p50: number; p90: number; max: number } | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: quantile(sorted, 0.5)!, p90: quantile(sorted, 0.9)!, max: sorted.at(-1)! }
}

/** A grid's frame without values: the window a search works in. */
export interface GridFrame {
  origin: [number, number]
  cellM: number
  width: number
  height: number
}

/** The cell-aligned frame covering `bounds` at `cellM`, snapped to a grid's own lattice when given. */
export function frameFor(bounds: GridBounds, cellM: number, lattice?: SurfaceGrid): GridFrame {
  const [minX, minY, maxX, maxY] = bounds
  if (lattice) {
    const c0 = Math.max(0, Math.floor((minX - lattice.origin[0]) / lattice.cellM)),
      c1 = Math.min(lattice.width - 1, Math.ceil((maxX - lattice.origin[0]) / lattice.cellM)),
      r0 = Math.max(0, Math.floor((lattice.origin[1] - maxY) / lattice.cellM)),
      r1 = Math.min(lattice.height - 1, Math.ceil((lattice.origin[1] - minY) / lattice.cellM))
    return {
      origin: [lattice.origin[0] + c0 * lattice.cellM, lattice.origin[1] - r0 * lattice.cellM],
      cellM: lattice.cellM,
      width: Math.max(0, c1 - c0 + 1),
      height: Math.max(0, r1 - r0 + 1),
    }
  }
  return {
    origin: [minX + cellM / 2, maxY - cellM / 2],
    cellM,
    width: Math.floor((maxX - minX) / cellM) + 1,
    height: Math.floor((maxY - minY) / cellM) + 1,
  }
}

export function boundsOfLine(line: readonly XY[], padM: number): GridBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of line) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return [minX - padM, minY - padM, maxX + padM, maxY + padM]
}

/**
 * Distance from each cell centre of `frame` to the polyline, metres; Infinity beyond `maxM`. Each
 * segment visits only the cells within `maxM` of it.
 */
export function distanceField(frame: GridFrame, line: readonly XY[], maxM: number): Float32Array {
  const { origin, cellM, width, height } = frame
  const out = new Float32Array(width * height).fill(Infinity)
  const segments = line.length === 1 ? [[line[0], line[0]]] : line.slice(1).map((b, i) => [line[i], b])
  for (const [a, b] of segments) {
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - maxM - origin[0]) / cellM)),
      c1 = Math.min(width - 1, Math.ceil((Math.max(a[0], b[0]) + maxM - origin[0]) / cellM)),
      r0 = Math.max(0, Math.floor((origin[1] - Math.max(a[1], b[1]) - maxM) / cellM)),
      r1 = Math.min(height - 1, Math.ceil((origin[1] - Math.min(a[1], b[1]) + maxM) / cellM))
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy
    for (let r = r0; r <= r1; r++) {
      const y = origin[1] - r * cellM
      for (let c = c0; c <= c1; c++) {
        const x = origin[0] + c * cellM
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0
        const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
        const i = r * width + c
        if (d <= maxM && d < out[i]) out[i] = d
      }
    }
  }
  return out
}

/**
 * The ground on `frame`: copied from a grid on the same lattice, or sampled from terrain at each
 * cell where `wanted` is set. Cells not wanted or with no terrain are NaN.
 */
export function* groundOnFrameSteps(
  ground: GroundInput,
  frame: GridFrame,
  wanted: (index: number) => boolean,
): Generator<{ sampled: number }, SurfaceGrid> {
  const { origin, cellM, width, height } = frame
  const values = new Float64Array(width * height).fill(NaN)
  if (isSurfaceGrid(ground)) {
    const c0 = Math.round((origin[0] - ground.origin[0]) / ground.cellM),
      r0 = Math.round((ground.origin[1] - origin[1]) / ground.cellM)
    for (let r = 0; r < height; r++) {
      const gr = r0 + r
      if (gr < 0 || gr >= ground.height) continue
      for (let c = 0; c < width; c++) {
        const gc = c0 + c
        if (gc < 0 || gc >= ground.width) continue
        const i = r * width + c
        if (wanted(i)) values[i] = ground.values[gr * ground.width + gc]
      }
    }
    return { origin: [origin[0], origin[1]], cellM, width, height, values }
  }
  const xy: [number, number] = [0, 0]
  let sampled = 0
  for (let r = 0; r < height; r++) {
    xy[1] = origin[1] - r * cellM
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      if (!wanted(i)) continue
      xy[0] = origin[0] + c * cellM
      const [lon, lat] = ground.toLonLat(xy)
      const z = ground.terrain.elevationAt(lon, lat)
      values[i] = Number.isFinite(z) ? z : NaN
      sampled++
    }
    yield { sampled }
  }
  return { origin: [origin[0], origin[1]], cellM, width, height, values }
}

/** A binary min-heap of cell indices keyed by cost, in typed arrays. */
class CellHeap {
  private keys = new Float64Array(1024)
  private cells = new Int32Array(1024)
  size = 0
  push(key: number, cell: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2),
        cells = new Int32Array(this.size * 2)
      keys.set(this.keys)
      cells.set(this.cells)
      this.keys = keys
      this.cells = cells
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= key) break
      this.keys[i] = this.keys[parent]
      this.cells[i] = this.cells[parent]
      i = parent
    }
    this.keys[i] = key
    this.cells[i] = cell
  }
  /** Removes the smallest; its cell is returned and its key left in `lastKey`. */
  pop(): number {
    const top = this.cells[0]
    this.lastKey = this.keys[0]
    const key = this.keys[--this.size],
      cell = this.cells[this.size]
    let i = 0
    for (;;) {
      let child = 2 * i + 1
      if (child >= this.size) break
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++
      if (this.keys[child] >= key) break
      this.keys[i] = this.keys[child]
      this.cells[i] = this.cells[child]
      i = child
    }
    this.keys[i] = key
    this.cells[i] = cell
    return top
  }
  lastKey = 0
}

const NEIGHBOURS: [number, number, number][] = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, 1, Math.SQRT2],
]
/** Pops between progress reports. */
const SEARCH_SLICE = 4096

/**
 * Least-cost path over an 8-connected grid. A step costs its length ÷ the mean conductance of its
 * two cells; a conductance of 0 (or NaN) is impassable. Starts from every `sources` cell at zero
 * cost and stops at the first `targets` cell settled. With `heuristic` (an admissible lower bound
 * of the remaining cost) it is A*; without, Dijkstra.
 */
export function* leastCostPathSteps({
  width,
  height,
  cellM,
  conductance,
  sources,
  targets,
  heuristic,
  maxExplored = Infinity,
}: {
  width: number
  height: number
  cellM: number
  conductance: Float32Array | Float64Array
  sources: readonly number[]
  targets: Uint8Array
  heuristic?: (cell: number) => number
  maxExplored?: number
}): Generator<{ explored: number }, { path: number[] | null; cost: number; explored: number }> {
  const n = width * height
  const cost = new Float64Array(n).fill(Infinity)
  const from = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const heap = new CellHeap()
  const h = heuristic ?? (() => 0)
  for (const s of sources) {
    if (!(conductance[s] > 0)) continue
    cost[s] = 0
    heap.push(h(s), s)
  }
  let explored = 0
  while (heap.size) {
    const cell = heap.pop()
    if (done[cell]) continue
    done[cell] = 1
    explored++
    if (targets[cell]) {
      const path: number[] = []
      for (let at = cell; at >= 0; at = from[at]) path.push(at)
      return { path: path.reverse(), cost: cost[cell], explored }
    }
    if (explored >= maxExplored) break
    if (explored % SEARCH_SLICE === 0) yield { explored }
    const row = Math.floor(cell / width),
      col = cell - row * width
    const ca = conductance[cell]
    for (const [dc, dr, step] of NEIGHBOURS) {
      const c = col + dc,
        r = row + dr
      if (c < 0 || r < 0 || c >= width || r >= height) continue
      const next = r * width + c
      if (done[next]) continue
      const cb = conductance[next]
      if (!(cb > 0)) continue
      const g = cost[cell] + (step * cellM) / (0.5 * (ca + cb))
      if (g < cost[next]) {
        cost[next] = g
        from[next] = cell
        heap.push(g + h(next), next)
      }
    }
  }
  return { path: null, cost: Infinity, explored }
}
