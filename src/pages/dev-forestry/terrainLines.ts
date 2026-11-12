/**
 * Lines of force from a DEM (handbook Appendix 4: alteration boundaries push up in hollows and drop
 * down on ridges). Draws (concave) are D8 flow-accumulation channels on the pit-filled DEM; ridges
 * (convex) are the same on the inverted DEM. Each candidate must also carry the right curvature sign
 * on average (Laplacian > 0 in a draw, < 0 on a ridge). Only the major lines on the landform are kept.
 *
 * Direction is the arrow's: concavity lines run from the draw's mouth up into it; convexity lines
 * run from the high point down the ridge. No DOM, no network; the DEM and the landform mask come in.
 * Ported from the VIA figure-style prototype (November 2026).
 */
import type { ElevationSource } from './terrain'
import { planGrid, type PlanGrid } from './planGrid'

export interface TerrainLinesOptions {
  bounds: readonly [number, number, number, number]
  /** Inside the landform? Lines are clipped to it. */
  inside: (lng: number, lat: number) => boolean
  cellMeters?: number
  /** Contributing area for a draw (and, inverted, a ridge), m². 0.2 km² ≈ first-order channel initiation in BC mountain terrain. */
  minAreaM2?: number
  minLengthM?: number
  maxLinesEach?: number
}
export interface TerrainLine {
  kind: 'convex' | 'concave'
  points: { lng: number; lat: number; elevation: number }[]
  lengthM: number
  contributingAreaM2: number
  meanLaplacian: number
}

const D8: [number, number, number][] = [
  [1, 0, 1],
  [1, 1, Math.SQRT2],
  [0, 1, 1],
  [-1, 1, Math.SQRT2],
  [-1, 0, 1],
  [-1, -1, Math.SQRT2],
  [0, -1, 1],
  [1, -1, Math.SQRT2],
]

class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    this.k.push(key)
    this.v.push(val)
    let i = this.k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.k[p] <= this.k[i]) break
      ;[this.k[p], this.k[i]] = [this.k[i], this.k[p]]
      ;[this.v[p], this.v[i]] = [this.v[i], this.v[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]]
    const lk = this.k.pop()!,
      lv = this.v.pop()!
    if (this.k.length) {
      this.k[0] = lk
      this.v[0] = lv
      let i = 0
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1
        let m = i
        if (l < this.k.length && this.k[l] < this.k[m]) m = l
        if (r < this.k.length && this.k[r] < this.k[m]) m = r
        if (m === i) break
        ;[this.k[m], this.k[i]] = [this.k[i], this.k[m]]
        ;[this.v[m], this.v[i]] = [this.v[i], this.v[m]]
        i = m
      }
    }
    return top
  }
}

/** Priority-flood pit filling with a tiny gradient, then D8 receivers and accumulation (cells). */
function flow(z: Float32Array, nx: number, ny: number) {
  const filled = Float32Array.from(z)
  const done = new Uint8Array(nx * ny)
  const heap = new MinHeap()
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
        const k = j * nx + i
        heap.push(filled[k], k)
        done[k] = 1
      }
  const order: number[] = []
  while (heap.size) {
    const [h, k] = heap.pop()
    order.push(k)
    const i = k % nx,
      j = (k - i) / nx
    for (const [dx, dy] of D8) {
      const a = i + dx,
        b = j + dy
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue
      const n = b * nx + a
      if (done[n]) continue
      done[n] = 1
      if (filled[n] <= h) filled[n] = h + 1e-3
      heap.push(filled[n], n)
    }
  }
  const recv = new Int32Array(nx * ny).fill(-1)
  for (let k = 0; k < nx * ny; k++) {
    const i = k % nx,
      j = (k - i) / nx
    let best = 0,
      to = -1
    for (const [dx, dy, d] of D8) {
      const a = i + dx,
        b = j + dy
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue
      const s = (filled[k] - filled[b * nx + a]) / d
      if (s > best) {
        best = s
        to = b * nx + a
      }
    }
    recv[k] = to
  }
  const acc = new Float32Array(nx * ny).fill(1)
  for (let t = order.length - 1; t >= 0; t--) {
    const k = order[t]
    if (recv[k] >= 0) acc[recv[k]] += acc[k]
  }
  return { recv, acc }
}

function laplacian(z: Float32Array, nx: number, ny: number, cell: number) {
  const out = new Float32Array(nx * ny)
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i
      out[k] = (z[k - 1] + z[k + 1] + z[k - nx] + z[k + nx] - 4 * z[k]) / (cell * cell)
    }
  return out
}

function trace(
  grid: PlanGrid,
  z: Float32Array,
  inside: Uint8Array,
  recv: Int32Array,
  acc: Float32Array,
  lap: Float32Array,
  minCells: number,
  kind: TerrainLine['kind'],
) {
  const { nx, ny } = grid
  const channel = new Uint8Array(nx * ny)
  for (let k = 0; k < nx * ny; k++) if (acc[k] >= minCells) channel[k] = 1
  // Heads: channel cells no channel cell drains into.
  const fed = new Uint8Array(nx * ny)
  for (let k = 0; k < nx * ny; k++) if (channel[k] && recv[k] >= 0) fed[recv[k]] = 1
  const used = new Uint8Array(nx * ny)
  const lines: { cells: number[] }[] = []
  for (let k = 0; k < nx * ny; k++) {
    if (!channel[k] || fed[k]) continue
    const cells: number[] = []
    let c = k
    while (c >= 0 && channel[c]) {
      cells.push(c)
      if (used[c]) break
      used[c] = 1
      c = recv[c]
    }
    lines.push({ cells })
  }
  const out: TerrainLine[] = []
  for (const { cells } of lines) {
    // Clip to the landform: keep the longest run of inside cells.
    let best: number[] = [],
      run: number[] = []
    for (const c of cells) {
      if (inside[c]) run.push(c)
      else {
        if (run.length > best.length) best = run
        run = []
      }
    }
    if (run.length > best.length) best = run
    if (best.length < 3) continue
    let length = 0
    for (let t = 1; t < best.length; t++) {
      const a = best[t - 1],
        b = best[t]
      length += Math.hypot((a % nx) - (b % nx), Math.floor(a / nx) - Math.floor(b / nx)) * grid.cellMeters
    }
    const meanLap = best.reduce((s, c) => s + lap[c], 0) / best.length
    const pts = best.map((c) => {
      const i = c % nx,
        j = (c - i) / nx
      const [lng, lat] = grid.centre(i, j)
      return { lng, lat, elevation: kind === 'concave' ? z[c] : -z[c] }
    })
    out.push({
      kind,
      points: pts,
      lengthM: length,
      contributingAreaM2: acc[best[best.length - 1]] * grid.cellMeters ** 2,
      meanLaplacian: meanLap,
    })
  }
  return out
}

const smooth = (pts: TerrainLine['points']) =>
  pts.map((p, i) => {
    const w = pts.slice(Math.max(0, i - 2), i + 3)
    return i === 0 || i === pts.length - 1
      ? p
      : {
          lng: w.reduce((s, q) => s + q.lng, 0) / w.length,
          lat: w.reduce((s, q) => s + q.lat, 0) / w.length,
          elevation: p.elevation,
        }
  })

export function terrainLines(
  dem: Pick<ElevationSource, 'elevationAt'>,
  opts: TerrainLinesOptions,
): { lines: TerrainLine[]; grid: PlanGrid; notes: string[] } {
  const grid = planGrid(opts.bounds, opts.cellMeters ?? 25, 1_500_000)
  const { nx, ny } = grid
  const z = new Float32Array(nx * ny),
    inside = new Uint8Array(nx * ny)
  let missing = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lng, lat] = grid.centre(i, j)
      const e = dem.elevationAt(lng, lat)
      const k = j * nx + i
      if (Number.isFinite(e)) z[k] = e
      else {
        z[k] = 0
        missing++
      }
      inside[k] = opts.inside(lng, lat) ? 1 : 0
    }
  const minCells = (opts.minAreaM2 ?? 200_000) / grid.cellMeters ** 2
  const lap = laplacian(z, nx, ny, grid.cellMeters)
  const down = flow(z, nx, ny)
  const neg = z.map((v) => -v)
  const up = flow(neg, nx, ny)
  const minLength = opts.minLengthM ?? 300
  const maxEach = opts.maxLinesEach ?? 6
  const rank = (l: TerrainLine) => l.lengthM * Math.log10(10 + l.contributingAreaM2 / 1e4)
  const concave = trace(grid, z, inside, down.recv, down.acc, lap, minCells, 'concave')
    .filter((l) => l.lengthM >= minLength && l.meanLaplacian > 0)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, maxEach)
    // Arrows point up the draw: from the mouth (downstream end) to the head.
    .map((l) => ({ ...l, points: smooth([...l.points].reverse()) }))
  const convex = trace(grid, neg, inside, up.recv, up.acc, lap, minCells, 'convex')
    .filter((l) => l.lengthM >= minLength && l.meanLaplacian < 0)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, maxEach)
    // Inverted flow climbs the ridge; arrows point down it, so reverse.
    .map((l) => ({ ...l, points: smooth([...l.points].reverse()) }))
  const notes = [
    `${nx} × ${ny} cells at ${grid.cellMeters.toFixed(0)} m; contributing area ≥ ${((opts.minAreaM2 ?? 200_000) / 1e6).toFixed(2)} km²; length ≥ ${minLength} m`,
  ]
  if (missing) notes.push(`${missing} cells without DEM`)
  return { lines: [...convex, ...concave], grid, notes }
}
