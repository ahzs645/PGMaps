/**
 * Skid reach over a harvest block: how far a ground skidder drags each part of the block to the
 * nearest road or landing, measured along the ground, and whether that is within a reach limit
 * that shortens when the log is dragged uphill to the road.
 *
 * The limit is a field layout rule of thumb, not a standard: 350 m on level ground, falling
 * linearly to 200 m where the skid runs uphill to the road at 30 % (percent, not degrees), and the
 * level-ground reach downhill. Ground steeper than a ground-based limit (40 %) is not skidded at all
 * and is reported as cable or another system. Every number is an input.
 *
 * Distance runs over the terrain grid (eight neighbours, Dijkstra), not in a straight line. Each step
 * uses up `step length ÷ allowed reach at that step's grade` of the reach, so a cell is within reach
 * when its path has used up no more than all of it. On a uniform grade that is exactly the rule; on a
 * path that is partly level and partly uphill it blends the two by length.
 *
 * Missing ground is never counted as covered. The model runs twice: once refusing missing cells,
 * once treating them as level and passable. A cell within reach only in the second run depends on
 * ground nobody has measured, and is reported unknown rather than beyond reach.
 *
 * Pure: terrain and projection are arguments; no DOM or network access.
 */
import type { SurfaceGrid, ToGrid, ToLonLat } from './surfaceGrid'
import type { Coordinate, RoadProject, TerrainSource } from './types'

export interface SkidReachRule {
  /** Reach on level ground, and on any skid downhill to the road, m along the ground. */
  flatReachM: number
  /** Reach where the skid runs uphill to the road at `adverseSlopePercent` or steeper, m. */
  adverseReachM: number
  /** Uphill-to-road grade at which the reach has fallen to `adverseReachM`, percent. */
  adverseSlopePercent: number
  /** Ground steeper than this is not ground-skidded: it is cable or another system. Percent. */
  maxGroundSlopePercent: number
}

/** The field person's rule of thumb, with "30" read as percent. Editable; not a standard. */
export const DEFAULT_SKID_RULE: SkidReachRule = {
  flatReachM: 350,
  adverseReachM: 200,
  adverseSlopePercent: 30,
  maxGroundSlopePercent: 40,
}
export const MIN_SKID_REACH_M = 20
export const MAX_SKID_REACH_M = 2000
export const MIN_SKID_SLOPE_PERCENT = 1
export const MAX_SKID_SLOPE_PERCENT = 200
/** Grid cell the model starts at; it grows ×1.25 until the grid fits `MAX_SKID_CELLS`. */
export const DEFAULT_SKID_CELL_M = 10
export const MIN_SKID_CELL_M = 2
export const MAX_SKID_CELL_M = 50
export const MAX_SKID_CELLS = 250_000
/** How far outside the block a skid path may run to reach a road. */
export const DEFAULT_OFF_BLOCK_M = 100
export const MAX_OFF_BLOCK_M = 500
/** Distances are followed out to this many reaches, so the farthest cell beyond reach can be named. */
export const SKID_REPORT_REACHES = 3
const REACH_EPS = 1e-9

/** Cell states, by index into `SKID_STATUS`. */
export const SKID_STATUS = ['outside', 'covered', 'beyond', 'steep', 'unknown'] as const
export type SkidStatus = (typeof SKID_STATUS)[number]
export const OUTSIDE = 0,
  COVERED = 1,
  BEYOND = 2,
  STEEP = 3,
  UNKNOWN = 4

export interface SkidProgress {
  phase: string
  done: number
  total: number
}

/** A road or landing logs can be skidded to. `haulToward` is the end loaded trucks leave by, when known. */
export interface SkidRoad {
  id: string
  name: string
  kind: 'existing' | 'design' | 'spur'
  coordinates: Coordinate[]
  haulToward?: 'start' | 'end' | null
}
type XY = [number, number]
export interface ProjectedRoad {
  road: SkidRoad
  xy: XY[]
}

export interface SkidReachInput {
  block: GeoJSON.Polygon
  roads: readonly SkidRoad[]
  /** Lines a skid may not cross, such as streams; none by default. */
  barriers?: readonly Coordinate[][]
  /** The ground the model reads: pass the ground trend (`groundTrendTerrain`), not raw 1 m LiDAR. */
  ground: TerrainSource
  toGrid: ToGrid
  toLonLat: ToLonLat
  rule: SkidReachRule
  cellM?: number
  offBlockM?: number
}

/** The terrain grid with everything the reach model reads, built once per run. */
export interface SkidGrid {
  grid: SurfaceGrid
  /** Steepest ground gradient per cell, percent; NaN where it cannot be read. */
  slopePercent: Float32Array
  block: Uint8Array
  /** Block cell indices, in grid order. */
  blockCells: Int32Array
  /** Cells a skid may run through: the block and a band `offBlockM` wide around it. */
  travel: Uint8Array
  barrier: Uint8Array
  /** Index into `roads` of the road on each cell, or -1. */
  sourceRoad: Int32Array
  roads: ProjectedRoad[]
  toGrid: ToGrid
  toLonLat: ToLonLat
  rule: SkidReachRule
  offBlockM: number
}

/** Per cell: reach used (1 = all of it), along-ground skid distance and the road cell it ends at. */
export interface ReachField {
  reach: Float64Array
  skidM: Float32Array
  exit: Int32Array
}

export interface SkidReachSummary {
  cellM: number
  blockHa: number
  coveredHa: number
  beyondHa: number
  unknownHa: number
  steepHa: number
  /** Shares of the whole block area, 0–1. */
  coveredShare: number
  beyondShare: number
  unknownShare: number
  steepShare: number
  /** Covered share of the block's known, ground-skiddable area (block less too steep and unknown). */
  coveredOfSkiddable: number
  /** The block cell farthest along the ground from a road, within `SKID_REPORT_REACHES` reaches. */
  farthest: { coordinate: Coordinate; skidM: number; covered: boolean } | null
  /** Beyond-reach cells with no ground path within `SKID_REPORT_REACHES` reaches. */
  unreachedHa: number
  meanCoveredM: number | null
  p95CoveredM: number | null
}

export interface SkidReachResult {
  skidGrid: SkidGrid
  strict: ReachField
  optimistic: ReachField
  status: Uint8Array
  summary: SkidReachSummary
}

/**
 * The roads a run counts as landings: active mapped roads in the context (closed and retired ones
 * never), mapped roads loaded as roads, and designed roads along their calculated centrelines. A
 * designed FSR connector hauls out by the end it connects at.
 */
export function skidRoadsFromProject(
  project: Pick<RoadProject, 'alignments' | 'context' | 'designPlaceholderId'>,
  centrelines: ReadonlyMap<string, readonly Coordinate[]>,
  include: { mapped: boolean; designed: boolean },
): SkidRoad[] {
  const roads: SkidRoad[] = []
  if (include.mapped)
    for (const feature of project.context) {
      const evidence = feature.roadEvidence
      if (
        feature.kind !== 'existing-road' ||
        feature.geometry.type !== 'LineString' ||
        evidence?.condition === 'closed' ||
        (evidence?.lifecycleStatus && evidence.lifecycleStatus !== 'ACTIVE')
      )
        continue
      roads.push({
        id: feature.id,
        name: feature.name,
        kind: 'existing',
        coordinates: feature.geometry.coordinates.map((c) => [c[0], c[1]] as Coordinate),
      })
    }
  for (const alignment of project.alignments) {
    if (alignment.id === project.designPlaceholderId) continue
    const mapped = !!alignment.mappedRoad
    if (mapped ? !include.mapped : !include.designed) continue
    const line = centrelines.get(alignment.id)
    roads.push({
      id: alignment.id,
      name: alignment.name,
      kind: mapped ? 'existing' : 'design',
      coordinates: line?.length ? [...line] : alignment.points.map((point) => point.coordinate),
      // A connector runs from its origin to the FSR junction at its last point.
      haulToward: alignment.fsrConnection ? 'end' : null,
    })
  }
  return roads
}

const finiteRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max

/** Checks a rule, throwing a message that names the field and its range. */
export function validateSkidRule(rule: SkidReachRule): SkidReachRule {
  if (!finiteRange(rule.flatReachM, MIN_SKID_REACH_M, MAX_SKID_REACH_M))
    throw Error(`Use a level-ground reach from ${MIN_SKID_REACH_M} to ${MAX_SKID_REACH_M} m.`)
  if (!finiteRange(rule.adverseReachM, MIN_SKID_REACH_M, rule.flatReachM))
    throw Error(`Use an uphill reach from ${MIN_SKID_REACH_M} m up to the level-ground reach.`)
  if (!finiteRange(rule.adverseSlopePercent, MIN_SKID_SLOPE_PERCENT, MAX_SKID_SLOPE_PERCENT))
    throw Error(`Use an uphill grade from ${MIN_SKID_SLOPE_PERCENT}% to ${MAX_SKID_SLOPE_PERCENT}%.`)
  if (!finiteRange(rule.maxGroundSlopePercent, MIN_SKID_SLOPE_PERCENT, MAX_SKID_SLOPE_PERCENT))
    throw Error(`Use a ground-skidding slope limit from ${MIN_SKID_SLOPE_PERCENT}% to ${MAX_SKID_SLOPE_PERCENT}%.`)
  return rule
}

/**
 * Reach allowed at a skid grade, m. Positive grades are adverse: the log rises toward the road. The
 * reach falls linearly from the level-ground reach to the uphill reach at the uphill grade and
 * holds there; level ground and downhill skids keep the level-ground reach.
 */
export function allowedSkidReachM(adverseGradePercent: number, rule: SkidReachRule): number {
  if (!(adverseGradePercent > 0)) return rule.flatReachM
  const t = Math.min(1, adverseGradePercent / rule.adverseSlopePercent)
  return rule.flatReachM - (rule.flatReachM - rule.adverseReachM) * t
}

/** Min-heap of (cell, score) pairs on typed arrays; stale entries are skipped by the caller. */
class CellHeap {
  private nodes = new Int32Array(1024)
  private scores = new Float64Array(1024)
  size = 0
  push(node: number, score: number) {
    if (this.size === this.nodes.length) {
      const nodes = new Int32Array(this.size * 2),
        scores = new Float64Array(this.size * 2)
      nodes.set(this.nodes)
      scores.set(this.scores)
      this.nodes = nodes
      this.scores = scores
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.scores[parent] < score || (this.scores[parent] === score && this.nodes[parent] <= node)) break
      this.nodes[i] = this.nodes[parent]
      this.scores[i] = this.scores[parent]
      i = parent
    }
    this.nodes[i] = node
    this.scores[i] = score
  }
  /** Pops the least entry into `top`. */
  pop(top: { node: number; score: number }) {
    top.node = this.nodes[0]
    top.score = this.scores[0]
    const last = --this.size
    if (last <= 0) return
    const node = this.nodes[last],
      score = this.scores[last]
    let i = 0
    for (;;) {
      let child = 2 * i + 1
      if (child >= last) break
      if (
        child + 1 < last &&
        (this.scores[child + 1] < this.scores[child] ||
          (this.scores[child + 1] === this.scores[child] && this.nodes[child + 1] < this.nodes[child]))
      )
        child++
      if (score < this.scores[child] || (score === this.scores[child] && node <= this.nodes[child])) break
      this.nodes[i] = this.nodes[child]
      this.scores[i] = this.scores[child]
      i = child
    }
    this.nodes[i] = node
    this.scores[i] = score
  }
}

/** Cells whose centre lies inside the polygon (outer ring less holes), by even-odd scanlines. */
export function polygonCells(grid: SurfaceGrid, rings: readonly XY[][]): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height)
  const crossings: number[] = []
  for (let row = 0; row < grid.height; row++) {
    const y = grid.origin[1] - row * grid.cellM
    crossings.length = 0
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j],
          [bx, by] = ring[i]
        if (ay > y !== by > y) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay))
      }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - grid.origin[0]) / grid.cellM)),
        to = Math.min(grid.width - 1, Math.floor((crossings[k + 1] - grid.origin[0]) / grid.cellM))
      for (let col = from; col <= to; col++) mask[row * grid.width + col] = 1
    }
  }
  return mask
}

/** Cells a polyline passes through, sampled every quarter cell. */
export function lineCells(grid: SurfaceGrid, line: readonly XY[]): number[] {
  const out = new Set<number>()
  const mark = (x: number, y: number) => {
    const col = Math.round((x - grid.origin[0]) / grid.cellM),
      row = Math.round((grid.origin[1] - y) / grid.cellM)
    if (col >= 0 && row >= 0 && col < grid.width && row < grid.height) out.add(row * grid.width + col)
  }
  if (line.length === 1) mark(line[0][0], line[0][1])
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1],
      [bx, by] = line[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (grid.cellM / 4)))
    for (let k = 0; k <= steps; k++) mark(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)
  }
  return [...out]
}

/**
 * Approximate Euclidean distance (m) from every cell to the nearest seed cell: a two-pass chamfer
 * with weights 1 and √2, within about 8 % of the true distance.
 */
export function chamferDistance(width: number, height: number, cellM: number, seeds: ArrayLike<number>): Float32Array {
  const d = new Float32Array(width * height).fill(Infinity)
  for (let i = 0; i < seeds.length; i++) d[seeds[i]] = 0
  const a = cellM,
    b = cellM * Math.SQRT2
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      let v = d[i]
      if (col > 0) v = Math.min(v, d[i - 1] + a)
      if (row > 0) {
        v = Math.min(v, d[i - width] + a)
        if (col > 0) v = Math.min(v, d[i - width - 1] + b)
        if (col < width - 1) v = Math.min(v, d[i - width + 1] + b)
      }
      d[i] = v
    }
  for (let row = height - 1; row >= 0; row--)
    for (let col = width - 1; col >= 0; col--) {
      const i = row * width + col
      let v = d[i]
      if (col < width - 1) v = Math.min(v, d[i + 1] + a)
      if (row < height - 1) {
        v = Math.min(v, d[i + width] + a)
        if (col < width - 1) v = Math.min(v, d[i + width + 1] + b)
        if (col > 0) v = Math.min(v, d[i + width - 1] + b)
      }
      d[i] = v
    }
  return d
}

/**
 * Steepest gradient per cell from central differences, percent. An axis with one neighbour missing
 * uses the one-sided difference; with both missing, or the cell itself missing, the slope is NaN.
 */
export function slopePercentGrid(grid: SurfaceGrid): Float32Array {
  const { width, height, cellM, values } = grid
  const out = new Float32Array(width * height)
  const axis = (i: number, back: number, forward: number, hasBack: boolean, hasForward: boolean) => {
    const z = values[i]
    const zb = hasBack ? values[back] : NaN,
      zf = hasForward ? values[forward] : NaN
    if (Number.isFinite(zb) && Number.isFinite(zf)) return (zf - zb) / (2 * cellM)
    if (Number.isFinite(zf)) return (zf - z) / cellM
    if (Number.isFinite(zb)) return (z - zb) / cellM
    return NaN
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (!Number.isFinite(values[i])) {
        out[i] = NaN
        continue
      }
      const gx = axis(i, i - 1, i + 1, col > 0, col < width - 1),
        gy = axis(i, i - width, i + width, row > 0, row < height - 1)
      out[i] = Number.isFinite(gx) && Number.isFinite(gy) ? 100 * Math.hypot(gx, gy) : NaN
    }
  return out
}

const project = (line: readonly Coordinate[], toGrid: ToGrid): XY[] =>
  line.map((c) => toGrid(c)).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))

/** Samples the ground over the block and its band, and marks block, roads and barriers on the grid. */
export function* prepareSkidGrid(input: SkidReachInput): Generator<SkidProgress, SkidGrid> {
  const rule = validateSkidRule({ ...input.rule })
  const offBlockM = input.offBlockM ?? DEFAULT_OFF_BLOCK_M
  if (!finiteRange(offBlockM, 0, MAX_OFF_BLOCK_M))
    throw Error(`Use a distance outside the block from 0 to ${MAX_OFF_BLOCK_M} m.`)
  const startCell = input.cellM ?? DEFAULT_SKID_CELL_M
  if (!finiteRange(startCell, MIN_SKID_CELL_M, MAX_SKID_CELL_M))
    throw Error(`Use a skid grid cell from ${MIN_SKID_CELL_M} to ${MAX_SKID_CELL_M} m.`)
  const rings = input.block.coordinates.map((ring) => project(ring as Coordinate[], input.toGrid))
  if (!rings[0] || rings[0].length < 3) throw Error('Choose a block drawn or imported as an area.')
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of rings[0]) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const pad = offBlockM + 2 * startCell
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  let cellM = startCell
  while ((Math.floor((maxX - minX) / cellM) + 1) * (Math.floor((maxY - minY) / cellM) + 1) > MAX_SKID_CELLS)
    cellM *= 1.25
  if (cellM > MAX_SKID_CELL_M)
    throw Error(
      `This block needs skid cells coarser than ${MAX_SKID_CELL_M} m to fit ${MAX_SKID_CELLS.toLocaleString('en-CA')} cells. Split it into smaller blocks.`,
    )
  const width = Math.floor((maxX - minX) / cellM) + 1,
    height = Math.floor((maxY - minY) / cellM) + 1
  const values = new Float64Array(width * height)
  const origin: XY = [minX + cellM / 2, maxY - cellM / 2]
  const xy: XY = [0, 0]
  for (let row = 0; row < height; row++) {
    xy[1] = origin[1] - row * cellM
    for (let col = 0; col < width; col++) {
      xy[0] = origin[0] + col * cellM
      const [lon, lat] = input.toLonLat(xy)
      const z = input.ground.elevationAt(lon, lat)
      values[row * width + col] = Number.isFinite(z) ? z : NaN
    }
    yield { phase: 'Reading the ground', done: row + 1, total: height }
  }
  const grid: SurfaceGrid = { origin, cellM, width, height, values }
  const block = polygonCells(grid, rings)
  const blockList: number[] = []
  for (let i = 0; i < block.length; i++) if (block[i]) blockList.push(i)
  if (!blockList.length) throw Error('The block is smaller than one skid cell. Use a finer cell or a larger block.')
  const toBlock = chamferDistance(width, height, cellM, blockList)
  const travel = new Uint8Array(width * height)
  for (let i = 0; i < travel.length; i++) if (toBlock[i] <= offBlockM + 1e-6) travel[i] = 1
  const barrier = new Uint8Array(width * height)
  for (const line of input.barriers ?? []) for (const i of lineCells(grid, project(line, input.toGrid))) barrier[i] = 1
  const sourceRoad = new Int32Array(width * height).fill(-1)
  const roads: ProjectedRoad[] = input.roads.map((road) => ({ road, xy: project(road.coordinates, input.toGrid) }))
  roads.forEach((road, k) => {
    for (const i of lineCells(grid, road.xy)) if (sourceRoad[i] < 0) sourceRoad[i] = k
  })
  return {
    grid,
    slopePercent: slopePercentGrid(grid),
    block,
    blockCells: Int32Array.from(blockList),
    travel,
    barrier,
    sourceRoad,
    roads,
    toGrid: input.toGrid,
    toLonLat: input.toLonLat,
    rule,
    offBlockM,
  }
}

export function emptyReachField(cells: number): ReachField {
  return {
    reach: new Float64Array(cells).fill(Infinity),
    skidM: new Float32Array(cells).fill(NaN),
    exit: new Int32Array(cells).fill(-1),
  }
}
export const copyReachField = (field: ReachField): ReachField => ({
  reach: new Float64Array(field.reach),
  skidM: new Float32Array(field.skidM),
  exit: new Int32Array(field.exit),
})

const NEIGHBOURS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
/** Heap pops between progress reports. */
const POPS_PER_YIELD = 4096

/**
 * Lowers `field` from new road cells `seeds`: Dijkstra over the reach each step uses, outward from
 * the roads. Adding roads only ever shortens skids, so running this on a field already computed for
 * other roads gives the field for all of them. `optimistic` lets missing ground through as level.
 */
export function* propagateReach(
  sg: SkidGrid,
  field: ReachField,
  seeds: ArrayLike<number>,
  optimistic: boolean,
): Generator<SkidProgress, void> {
  const { width, height, cellM, values: z } = sg.grid
  const { rule, travel, barrier, slopePercent } = sg
  const heap = new CellHeap()
  for (let k = 0; k < seeds.length; k++) {
    const s = seeds[k]
    if (field.reach[s] > 0) {
      field.reach[s] = 0
      field.skidM[s] = 0
      field.exit[s] = s
    }
    heap.push(s, 0)
  }
  const top = { node: 0, score: 0 }
  let pops = 0
  const cap = SKID_REPORT_REACHES
  while (heap.size) {
    heap.pop(top)
    const u = top.node,
      du = top.score
    if (du > field.reach[u]) continue
    if (++pops % POPS_PER_YIELD === 0) yield { phase: 'Following skid paths', done: pops, total: sg.blockCells.length }
    const row = (u / width) | 0,
      col = u - row * width
    const zu = z[u]
    for (let k = 0; k < 8; k++) {
      const dr = NEIGHBOURS[k][0],
        dc = NEIGHBOURS[k][1]
      const r = row + dr,
        c = col + dc
      if (r < 0 || c < 0 || r >= height || c >= width) continue
      const v = r * width + c
      if (!travel[v] || barrier[v]) continue
      if (k >= 4 && barrier[row * width + c] && barrier[r * width + col]) continue
      const zv = z[v]
      const h = k < 4 ? cellM : cellM * Math.SQRT2
      const slope = slopePercent[v]
      let step: number, allowed: number
      if (Number.isFinite(zu) && Number.isFinite(zv)) {
        if (slope > rule.maxGroundSlopePercent) continue
        if (!optimistic && !(slope <= rule.maxGroundSlopePercent)) continue
        const dz = zu - zv
        step = Math.hypot(h, dz)
        allowed = allowedSkidReachM((100 * dz) / h, rule)
      } else {
        if (!optimistic || slope > rule.maxGroundSlopePercent) continue
        step = h
        allowed = rule.flatReachM
      }
      const next = du + step / allowed
      if (next > cap || next >= field.reach[v] - 1e-12) continue
      field.reach[v] = next
      field.skidM[v] = field.skidM[u] + step
      field.exit[v] = field.exit[u]
      heap.push(v, next)
    }
  }
}

/** Every road cell on the grid. */
export function sourceCells(sg: SkidGrid): number[] {
  const out: number[] = []
  for (let i = 0; i < sg.sourceRoad.length; i++) if (sg.sourceRoad[i] >= 0) out.push(i)
  return out
}

/** Each block cell's state from the two fields. */
export function classifySkidCells(sg: SkidGrid, strict: ReachField, optimistic: ReachField): Uint8Array {
  const status = new Uint8Array(sg.block.length)
  const z = sg.grid.values,
    max = sg.rule.maxGroundSlopePercent
  for (const i of sg.blockCells) {
    if (!Number.isFinite(z[i])) status[i] = UNKNOWN
    else if (sg.sourceRoad[i] >= 0 || strict.reach[i] <= 1 + REACH_EPS) status[i] = COVERED
    else if (sg.slopePercent[i] > max) status[i] = STEEP
    else if (optimistic.reach[i] <= 1 + REACH_EPS) status[i] = UNKNOWN
    else status[i] = BEYOND
  }
  return status
}

export function summarizeSkidReach(sg: SkidGrid, strict: ReachField, status: Uint8Array): SkidReachSummary {
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const counts = [0, 0, 0, 0, 0]
  let farthest = -1,
    unreached = 0
  const covered: number[] = []
  for (const i of sg.blockCells) {
    counts[status[i]]++
    if (status[i] === COVERED) covered.push(strict.skidM[i])
    if (status[i] === BEYOND && !Number.isFinite(strict.reach[i])) unreached++
    if ((status[i] === COVERED || status[i] === BEYOND) && Number.isFinite(strict.skidM[i]))
      if (farthest < 0 || strict.skidM[i] > strict.skidM[farthest]) farthest = i
  }
  const block = sg.blockCells.length
  const skiddable = block - counts[STEEP] - counts[UNKNOWN]
  covered.sort((a, b) => a - b)
  const row = Math.floor(farthest / sg.grid.width)
  return {
    cellM: sg.grid.cellM,
    blockHa: block * cellHa,
    coveredHa: counts[COVERED] * cellHa,
    beyondHa: counts[BEYOND] * cellHa,
    unknownHa: counts[UNKNOWN] * cellHa,
    steepHa: counts[STEEP] * cellHa,
    coveredShare: counts[COVERED] / block,
    beyondShare: counts[BEYOND] / block,
    unknownShare: counts[UNKNOWN] / block,
    steepShare: counts[STEEP] / block,
    coveredOfSkiddable: skiddable > 0 ? counts[COVERED] / skiddable : 0,
    farthest:
      farthest < 0
        ? null
        : {
            coordinate: sg.toLonLat([
              sg.grid.origin[0] + (farthest - row * sg.grid.width) * sg.grid.cellM,
              sg.grid.origin[1] - row * sg.grid.cellM,
            ]),
            skidM: strict.skidM[farthest],
            covered: status[farthest] === COVERED,
          },
    unreachedHa: unreached * cellHa,
    meanCoveredM: covered.length ? covered.reduce((sum, m) => sum + m, 0) / covered.length : null,
    p95CoveredM: covered.length ? covered[Math.min(covered.length - 1, Math.floor(0.95 * covered.length))] : null,
  }
}

/** The whole run: ground, both reach fields, cell states and the summary. */
export function* skidReachSteps(input: SkidReachInput): Generator<SkidProgress, SkidReachResult> {
  const skidGrid = yield* prepareSkidGrid(input)
  return yield* skidReachOnGrid(skidGrid)
}

/** Reach fields, states and summary for a prepared grid's roads. */
export function* skidReachOnGrid(skidGrid: SkidGrid): Generator<SkidProgress, SkidReachResult> {
  const cells = skidGrid.block.length
  const seeds = sourceCells(skidGrid)
  const strict = emptyReachField(cells),
    optimistic = emptyReachField(cells)
  if (seeds.length) {
    yield* propagateReach(skidGrid, strict, seeds, false)
    yield* propagateReach(skidGrid, optimistic, seeds, true)
  }
  const status = classifySkidCells(skidGrid, strict, optimistic)
  return { skidGrid, strict, optimistic, status, summary: summarizeSkidReach(skidGrid, strict, status) }
}

/**
 * The outlines of a cell mask as closed rings in grid metres, each running round its cells with
 * collinear corners dropped. Holes come back as their own rings.
 */
export function maskOutlines(grid: SurfaceGrid, inMask: (index: number) => boolean): XY[][] {
  const { width, height } = grid
  const at = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < width && row < height && inMask(row * width + col)
  // Directed edges between cell corners, mask on the left. Corner (c, r) is the top-left of cell (c, r).
  const next = new Map<number, number[]>()
  const key = (c: number, r: number) => r * (width + 1) + c
  const add = (c0: number, r0: number, c1: number, r1: number) => {
    const from = key(c0, r0)
    const list = next.get(from)
    if (list) list.push(key(c1, r1))
    else next.set(from, [key(c1, r1)])
  }
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      if (!at(c, r)) continue
      if (!at(c, r - 1)) add(c + 1, r, c, r)
      if (!at(c - 1, r)) add(c, r, c, r + 1)
      if (!at(c, r + 1)) add(c, r + 1, c + 1, r + 1)
      if (!at(c + 1, r)) add(c + 1, r + 1, c + 1, r)
    }
  const rings: XY[][] = []
  const corner = (k: number): XY => {
    const r = Math.floor(k / (width + 1)),
      c = k - r * (width + 1)
    return [grid.origin[0] + (c - 0.5) * grid.cellM, grid.origin[1] - (r - 0.5) * grid.cellM]
  }
  for (const [start, list] of next) {
    while (list.length) {
      const keys = [start]
      let current = list.pop()!
      while (current !== start) {
        keys.push(current)
        const options = next.get(current)
        if (!options?.length) break
        current = options.pop()!
      }
      const points = keys.map(corner)
      const kept = points.filter((p, i) => {
        const a = points[(i - 1 + points.length) % points.length],
          b = points[(i + 1) % points.length]
        return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9
      })
      if (kept.length >= 3) rings.push([...kept, kept[0]])
    }
  }
  return rings
}

export const SKID_MAP_COLORS = {
  beyond: '#dc2626',
  steep: '#7c3aed',
  unknown: '#64748b',
} as const
/** Most outline vertices sent to the plan; smaller rings are dropped first beyond it. */
export const MAX_SKID_OUTLINE_VERTICES = 20_000

/** Plan features for the beyond-reach, too-steep and unknown parts of a block, as outlines. */
export function skidReachMapFeatures(result: SkidReachResult): GeoJSON.Feature<GeoJSON.LineString>[] {
  const { skidGrid, status } = result
  const groups: [SkidStatus, number, string][] = [
    ['beyond', BEYOND, 'Beyond skid reach'],
    ['steep', STEEP, 'Too steep to skid'],
    ['unknown', UNKNOWN, 'Skid reach unknown'],
  ]
  const rings = groups.flatMap(([role, code, label]) =>
    maskOutlines(skidGrid.grid, (i) => status[i] === code).map((ring) => ({ role, label, ring })),
  )
  rings.sort((a, b) => b.ring.length - a.ring.length)
  let vertices = 0
  const kept = rings.filter((entry) => (vertices += entry.ring.length) <= MAX_SKID_OUTLINE_VERTICES)
  return kept.map(({ role, label, ring }) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: ring.map((p) => skidGrid.toLonLat(p)) },
    properties: { kind: 'skid-reach', role, color: SKID_MAP_COLORS[role as keyof typeof SKID_MAP_COLORS], label },
  }))
}
