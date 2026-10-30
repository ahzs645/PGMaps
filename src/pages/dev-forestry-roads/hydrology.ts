/**
 * Surface hydrology on a {@link SurfaceGrid}: depression filling, D8 flow, contributing area and
 * stream lines, and a comparison of the existing ground against the design surface the road
 * leaves behind (see `designSurface.ts`).
 *
 * This is a planning screen, not a hydrotechnical design. It routes rain over the surface only:
 * no infiltration, subsurface flow, channel hydraulics, snowmelt or storage routing, and the
 * culvert check is a full-pipe Manning capacity against a Rational-method peak.
 * Pure: projection is passed in, no DOM or network access.
 */
import { carveCulvert, roadFrame, type CulvertChannel } from './designSurface'
import { cellCentre, cloneSurfaceGrid, type SurfaceGrid, type ToGrid, type ToLonLat } from './surfaceGrid'
import type { Coordinate, Culvert, RoadAnalysis } from './types'

/** D8 neighbour order: E, SE, S, SW, W, NW, N, NE (rows run south). */
const D_ROW = [0, 1, 1, 1, 0, -1, -1, -1]
const D_COL = [1, 1, 0, -1, -1, -1, 0, 1]
/** Flow leaves the grid (edge or missing neighbour) at this cell. */
export const OUTLET = -1
/** The cell itself is missing. */
export const MISSING = -2

/** Binary min-heap of cell indices keyed by elevation, in typed arrays. */
class CellHeap {
  keys: Float64Array
  cells: Int32Array
  size = 0
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity)
    this.cells = new Int32Array(capacity)
  }
  push(cell: number, key: number) {
    let i = this.size++
    const keys = this.keys,
      cells = this.cells
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      cells[i] = cells[parent]
      i = parent
    }
    keys[i] = key
    cells[i] = cell
  }
  /** Removes the lowest cell; read `topKey` first if its key is needed. */
  pop(): number {
    const keys = this.keys,
      cells = this.cells,
      top = cells[0],
      n = --this.size
    if (n > 0) {
      const key = keys[n],
        cell = cells[n]
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && keys[child + 1] < keys[child]) child++
        if (keys[child] >= key) break
        keys[i] = keys[child]
        cells[i] = cells[child]
        i = child
      }
      keys[i] = key
      cells[i] = cell
    }
    return top
  }
  get topKey() {
    return this.keys[0]
  }
}

export interface FilledSurface {
  filled: SurfaceGrid
  /** Filled − original, ≥ 0; NaN where the cell is missing. Shows where water would pond. */
  depth: Float64Array
}

/**
 * Priority-Flood+ε (Barnes, Lehman & Mulla 2014): flood inwards from the outlets — the grid edge
 * and every cell next to a missing one — raising each depression to its spill level plus `epsilon`
 * per cell, so every filled cell has a strictly lower neighbour and D8 never stalls on a flat.
 * Raised cells go through a plain FIFO rather than the heap, which is what keeps it near O(n).
 */
export function fillDepressions(grid: SurfaceGrid, { epsilon = 1e-5 }: { epsilon?: number } = {}): FilledSurface {
  const { width: w, height: h } = grid
  const n = w * h,
    z = new Float64Array(grid.values),
    closed = new Uint8Array(n)
  const heap = new CellHeap(n),
    pit = new Int32Array(n)
  let pitHead = 0,
    pitTail = 0
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++) {
      const i = row * w + col
      if (Number.isNaN(z[i])) {
        closed[i] = 1
        continue
      }
      let seed = row === 0 || col === 0 || row === h - 1 || col === w - 1
      for (let k = 0; !seed && k < 8; k++) if (Number.isNaN(z[(row + D_ROW[k]) * w + col + D_COL[k]])) seed = true
      if (seed) {
        closed[i] = 1
        heap.push(i, z[i])
      }
    }
  while (pitHead < pitTail || heap.size) {
    let c: number
    if (pitHead < pitTail) {
      c = pit[pitHead++]
      if (pitHead === pitTail) pitHead = pitTail = 0
    } else c = heap.pop()
    const zc = z[c],
      row = (c / w) | 0,
      col = c - row * w
    for (let k = 0; k < 8; k++) {
      const r = row + D_ROW[k],
        q = col + D_COL[k]
      if (r < 0 || q < 0 || r >= h || q >= w) continue
      const j = r * w + q
      if (closed[j]) continue
      closed[j] = 1
      if (z[j] <= zc + epsilon) {
        z[j] = zc + epsilon
        pit[pitTail++] = j
      } else heap.push(j, z[j])
    }
  }
  const depth = new Float64Array(n)
  for (let i = 0; i < n; i++) depth[i] = z[i] - grid.values[i]
  return { filled: cloneSurfaceGrid(grid, z), depth }
}

/**
 * D8: each cell drains to the neighbour with the steepest drop per distance (diagonals at √2 cell).
 * {@link OUTLET} where no neighbour is lower — on a filled surface, only cells on the grid edge or
 * beside missing data — and {@link MISSING} for missing cells.
 */
export function flowDirections(filled: SurfaceGrid): Int8Array {
  const { width: w, height: h, values: z } = filled
  const dirs = new Int8Array(w * h)
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++) {
      const i = row * w + col,
        zi = z[i]
      if (Number.isNaN(zi)) {
        dirs[i] = MISSING
        continue
      }
      let best = 0,
        dir = OUTLET
      for (let k = 0; k < 8; k++) {
        const r = row + D_ROW[k],
          q = col + D_COL[k]
        if (r < 0 || q < 0 || r >= h || q >= w) continue
        const zj = z[r * w + q]
        if (Number.isNaN(zj)) continue
        const drop = (zi - zj) * (k & 1 ? Math.SQRT1_2 : 1)
        if (drop > best) {
          best = drop
          dir = k
        }
      }
      dirs[i] = dir
    }
  return dirs
}

/** Downstream cell of `i`, or −1 at an outlet or a missing cell. */
export function downstream(dirs: Int8Array, width: number, i: number): number {
  const k = dirs[i]
  return k < 0 ? -1 : i + D_ROW[k] * width + D_COL[k]
}

/** Contributing area in m² of every cell, itself included; 0 for missing cells. */
export function flowAccumulation(dirs: Int8Array, grid: Pick<SurfaceGrid, 'width' | 'cellM'>): Float64Array {
  const n = dirs.length,
    w = grid.width,
    area = grid.cellM * grid.cellM
  const acc = new Float64Array(n),
    inflow = new Uint8Array(n),
    queue = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    if (dirs[i] === MISSING) continue
    acc[i] = area
    const j = downstream(dirs, w, i)
    if (j >= 0) inflow[j]++
  }
  let head = 0,
    tail = 0
  for (let i = 0; i < n; i++) if (dirs[i] !== MISSING && !inflow[i]) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++],
      j = downstream(dirs, w, i)
    if (j < 0) continue
    acc[j] += acc[i]
    if (!--inflow[j]) queue[tail++] = j
  }
  return acc
}

export interface StreamProperties {
  id: string
  /** Contributing area at the segment's downstream end, hectares. */
  areaHa: number
  lengthM: number
}
export type StreamCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, StreamProperties>

interface StreamSegment {
  cells: number[]
  lengthM: number
}

/** Cell paths of stream segments, split at confluences, heads shorter than `minLengthM` dropped. */
function streamSegments(
  acc: Float64Array,
  dirs: Int8Array,
  grid: SurfaceGrid,
  thresholdM2: number,
  minLengthM: number,
): StreamSegment[] {
  const n = acc.length,
    w = grid.width
  const inflow = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!(acc[i] >= thresholdM2)) continue
    const j = downstream(dirs, w, i)
    if (j >= 0) inflow[j]++
  }
  const segments: StreamSegment[] = []
  for (let start = 0; start < n; start++) {
    if (!(acc[start] >= thresholdM2) || inflow[start] === 1) continue
    const cells = [start]
    let lengthM = 0,
      i = start
    for (;;) {
      const j = downstream(dirs, w, i)
      if (j < 0) break
      lengthM += dirs[i] & 1 ? grid.cellM * Math.SQRT2 : grid.cellM
      cells.push(j)
      if (inflow[j] !== 1) break
      i = j
    }
    if (cells.length < 2) continue
    const head = inflow[start] === 0,
      endsAtConfluence = inflow[cells[cells.length - 1]] > 1
    if (head && endsAtConfluence && lengthM < minLengthM) continue
    segments.push({ cells, lengthM })
  }
  return segments
}

/**
 * Stream lines where the contributing area reaches `thresholdM2`, in lon/lat, one feature per
 * reach between heads, confluences and outlets. First-order reaches shorter than `minLengthM`
 * that end at a confluence are dropped as stubs.
 */
export function extractStreams(
  acc: Float64Array,
  dirs: Int8Array,
  grid: SurfaceGrid,
  toLonLat: ToLonLat,
  {
    thresholdM2,
    minLengthM = 5 * grid.cellM,
    idPrefix = 'stream',
  }: { thresholdM2: number; minLengthM?: number; idPrefix?: string },
): StreamCollection {
  return {
    type: 'FeatureCollection',
    features: streamSegments(acc, dirs, grid, thresholdM2, minLengthM).map((segment, index) => ({
      type: 'Feature',
      properties: {
        id: `${idPrefix}-${index + 1}`,
        areaHa: acc[segment.cells[segment.cells.length - 1]] / 10_000,
        lengthM: segment.lengthM,
      },
      geometry: { type: 'LineString', coordinates: segment.cells.map((i) => toLonLat(cellCentre(grid, i))) },
    })),
  }
}

/** Standard round culvert diameters (m) the size check picks from. */
export const STANDARD_CULVERT_DIAMETERS_M = [0.3, 0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 3.0]

/** Rational method peak flow, m³/s: Q = C·i·A / 360 with i in mm/h and A in hectares. */
export const rationalPeakFlow = (runoffCoefficient: number, rainfallMmPerHr: number, areaHa: number) =>
  (runoffCoefficient * rainfallMmPerHr * areaHa) / 360

/** Manning full-pipe capacity of a round barrel, m³/s: Q = (1/n)·(πD²/4)·(D/4)^(2/3)·√S. */
export const fullPipeCapacity = (diameterM: number, slope: number, manningN: number) =>
  (1 / manningN) * ((Math.PI * diameterM ** 2) / 4) * (diameterM / 4) ** (2 / 3) * Math.sqrt(Math.max(0, slope))

/** Smallest standard diameter whose full-pipe capacity carries `flow`, or null if none does. */
export function minimumDiameter(
  flow: number,
  slope: number,
  manningN: number,
  sizes: readonly number[] = STANDARD_CULVERT_DIAMETERS_M,
): number | null {
  return [...sizes].sort((a, b) => a - b).find((d) => fullPipeCapacity(d, slope, manningN) >= flow) ?? null
}

export interface PondingSummary {
  cells: number
  areaM2: number
  maxDepthM: number
  volumeM3: number
}
export interface PondProperties extends PondingSummary {
  id: string
  /** Chainage and signed offset (negative left) of the deepest cell. */
  chainage: number
  offsetM: number
  /** Largest contributing area of any cell in the pond: what drains into it, hectares. */
  areaHa: number
  /** Some cell lies in or beside the footprint, e.g. water dammed against the uphill fill toe. */
  touchesRoad: boolean
}
export interface StreamCrossing {
  id: string
  /** Where the existing-ground stream enters the road footprint. */
  chainage: number
  coordinate: Coordinate
  areaHa: number
  /** A culvert within the search distance of the entry chainage, if any. */
  culvertId: string | null
  /** Where the same water leaves the footprint on the design surface. */
  exitChainage: number
  exitCoordinate: Coordinate
  /** Contributing area at the design-surface exit (the diverted stream plus whatever joined it). */
  exitAreaHa: number
  /** Culvert channel the design-surface path runs through, if any. */
  throughCulvertId: string | null
  /** |exit − entry| chainage. */
  divertedM: number
  /** True when the road carries the stream further than the diversion threshold along it. */
  redirected: boolean
}
export interface DitchLowPoint {
  id: string
  /** 'outlet' where flow leaves the prism, 'pond' where it collects on the design surface. */
  kind: 'outlet' | 'pond'
  side: 'left' | 'right'
  chainage: number
  coordinate: Coordinate
  areaHa: number
  /** Pond depth, 0 for an outlet. */
  depthM: number
  /** The culvert whose channel carries this flow, else the nearest within the search distance. */
  culvertId: string | null
  throughCulvert: boolean
}
export interface CulvertCheck {
  id: string
  name: string
  chainage: number
  designAreaHa: number
  existingAreaHa: number
  /** Rational-method peak on the design catchment, m³/s. */
  designFlowM3s: number
  /** Full-pipe Manning capacity of the entered diameter, m³/s. */
  capacityM3s: number
  slope: number
  /** True when the slope is the 2% default because the inverts are missing or not falling. */
  slopeAssumed: boolean
  diameterM: number
  minimumDiameterM: number | null
  adequate: boolean
}
export interface SurfaceDrainage {
  streams: StreamCollection
  ponding: PondingSummary
  /** Contributing area per cell, m². */
  accumulation: Float64Array
  /** Fill depth per cell, m. */
  depth: Float64Array
  /** Ephemeral D8 routes for pour-point and watershed analysis; never serialized as a project grid. */
  directions: Int8Array
}
export interface DrainageAnalysis {
  existing: SurfaceDrainage
  design: SurfaceDrainage
  /** Ponding deeper than `pondDepthM` on the design surface where the existing ground had none. */
  newPonding: PondingSummary & { ponds: GeoJSON.FeatureCollection<GeoJSON.Point, PondProperties> }
  crossings: StreamCrossing[]
  lowPoints: DitchLowPoint[]
  culverts: CulvertCheck[]
  warnings: string[]
}
export interface DrainageInput {
  existing: SurfaceGrid
  design: SurfaceGrid
  footprint: Uint8Array
  analysis: RoadAnalysis
  culverts: Culvert[]
  /** Culvert channels from `burnRoad`; recarved on a scratch copy when omitted. */
  channels?: CulvertChannel[]
  toGrid: ToGrid
  toLonLat: ToLonLat
  /** Design storm intensity for the Rational method, mm/h. */
  rainfallMmPerHr: number
  runoffCoefficient: number
  manningN: number
  streamThresholdM2: number
  epsilon?: number
  /** Ponding shallower than this is ignored (fill on flats and burn noise), m. Default 0.05. */
  pondDepthM?: number
  /** A culvert this close in chainage to a crossing or low point is associated with it. Default 15. */
  culvertSearchM?: number
  /** A crossing carried further than this along the road is `redirected`. Default 20. */
  divertThresholdM?: number
  /** Smallest contributing area for a reported low point, m². Default 500 m² (0.05 ha). */
  lowPointMinAreaM2?: number
  /** Slope assumed when a culvert's inverts are missing or not falling. Default 0.02. */
  defaultSlope?: number
}

function surfaceDrainage(grid: SurfaceGrid, input: DrainageInput, idPrefix: string) {
  const { filled, depth } = fillDepressions(grid, { epsilon: input.epsilon })
  const dirs = flowDirections(filled),
    accumulation = flowAccumulation(dirs, grid)
  const streams = extractStreams(accumulation, dirs, grid, input.toLonLat, {
    thresholdM2: input.streamThresholdM2,
    idPrefix,
  })
  const minDepth = input.pondDepthM ?? 0.05,
    cellArea = grid.cellM ** 2
  const ponding: PondingSummary = { cells: 0, areaM2: 0, maxDepthM: 0, volumeM3: 0 }
  for (let i = 0; i < depth.length; i++)
    if (depth[i] > minDepth) {
      ponding.cells++
      ponding.volumeM3 += depth[i] * cellArea
      ponding.maxDepthM = Math.max(ponding.maxDepthM, depth[i])
    }
  ponding.areaM2 = ponding.cells * cellArea
  return { dirs, drainage: { streams, ponding, accumulation, depth, directions: dirs } satisfies SurfaceDrainage }
}

/**
 * Compare drainage on the existing ground and the design surface. A planning estimate, not a
 * hydrotechnical design: culvert flows are Rational-method peaks on D8 catchments at the given
 * storm intensity (no time of concentration), capacities are full-pipe Manning without inlet
 * or outlet control, headwater or debris allowance.
 *
 * - Crossings: each existing-ground stream cell flowing into the footprint is traced on the
 *   design surface to where it leaves the footprint; re-entries of the same stream are folded in.
 * - Low points: footprint cells where design-surface flow of at least `lowPointMinAreaM2` leaves
 *   the prism (the ditch outlets and sags the road creates), plus new ponds in or beside the
 *   footprint draining at least as much. Within 10 m of chainage on one side only the largest is kept.
 * - New ponding: 8-connected clusters of design-surface fill deeper than `pondDepthM` on cells
 *   whose existing ground was not ponded, reported as a point at each cluster's deepest cell.
 */
export function analyzeDrainage(input: DrainageInput): DrainageAnalysis {
  const { existing, design, footprint, analysis, culverts, toGrid, toLonLat } = input
  if (existing.width !== design.width || existing.height !== design.height || footprint.length !== design.values.length)
    throw Error('The existing and design surfaces must share one grid.')
  const warnings: string[] = []
  const w = design.width,
    n = design.values.length,
    cellArea = design.cellM ** 2
  const searchM = input.culvertSearchM ?? 15,
    divertM = input.divertThresholdM ?? 20,
    minDepth = input.pondDepthM ?? 0.05,
    minLowArea = input.lowPointMinAreaM2 ?? 500,
    defaultSlope = input.defaultSlope ?? 0.02
  const frame = roadFrame(analysis, toGrid)
  const before = surfaceDrainage(existing, input, 'existing'),
    after = surfaceDrainage(design, input, 'design')
  const accE = before.drainage.accumulation,
    accD = after.drainage.accumulation
  const lonLat = (i: number) => toLonLat(cellCentre(design, i))
  const locate = (i: number) => {
    const [x, y] = cellCentre(design, i)
    return frame.locate(x, y)
  }

  const scratch = input.channels ? null : cloneSurfaceGrid(design)
  const channels =
    input.channels ??
    culverts
      .map((c) => carveCulvert(scratch!, existing, footprint, frame, c))
      .filter((c): c is CulvertChannel => c !== null)
  const channelOf = new Int32Array(n)
  channels.forEach((c, k) => c.cells.forEach((i) => (channelOf[i] = k + 1)))
  const nearestCulvert = (chainage: number) => {
    let best: Culvert | null = null
    for (const c of culverts)
      if (
        Math.abs(c.chainage - chainage) <= searchM &&
        (!best || Math.abs(c.chainage - chainage) < Math.abs(best.chainage - chainage))
      )
        best = c
    return best?.id ?? null
  }

  // Crossings. Upstream entries first, so a stream's own re-entry downstream is already claimed.
  const thresholdM2 = input.streamThresholdM2
  const entries: number[] = []
  for (let i = 0; i < n; i++) {
    if (footprint[i] || !(accE[i] >= thresholdM2)) continue
    const j = downstream(before.dirs, w, i)
    if (j >= 0 && footprint[j]) entries.push(j)
  }
  entries.sort((a, b) => accE[a] - accE[b])
  const claimed = new Uint8Array(n),
    followCells = Math.ceil(50 / design.cellM)
  const crossings: StreamCrossing[] = []
  for (const entry of new Set(entries)) {
    if (claimed[entry]) continue
    for (let i = entry, outside = 0; i >= 0 && outside <= followCells; i = downstream(before.dirs, w, i)) {
      if (footprint[i]) {
        if (claimed[i] && i !== entry) break
        claimed[i] = 1
        outside = 0
      } else outside++
    }
    let exit = entry,
      through: string | null = null
    for (let steps = 0; steps < n; steps++) {
      if (channelOf[exit]) through ??= channels[channelOf[exit] - 1].id
      if (!footprint[exit]) break
      const j = downstream(after.dirs, w, exit)
      if (j < 0) break
      exit = j
    }
    const at = locate(entry),
      out = locate(exit)
    const divertedM = Math.abs(out.chainage - at.chainage)
    crossings.push({
      id: `crossing-${crossings.length + 1}`,
      chainage: at.chainage,
      coordinate: lonLat(entry),
      areaHa: accE[entry] / 10_000,
      culvertId: nearestCulvert(at.chainage),
      exitChainage: out.chainage,
      exitCoordinate: lonLat(exit),
      exitAreaHa: accD[exit] / 10_000,
      throughCulvertId: through,
      divertedM,
      redirected: divertedM > divertM,
    })
  }
  crossings.sort((a, b) => a.chainage - b.chainage)

  // New ponding clusters on the design surface.
  const depthE = before.drainage.depth,
    depthD = after.drainage.depth
  const ponded = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (depthD[i] > minDepth && !(depthE[i] > minDepth)) ponded[i] = 1
  const queue = new Int32Array(n)
  const ponds: GeoJSON.Feature<GeoJSON.Point, PondProperties>[] = []
  const total: PondingSummary = { cells: 0, areaM2: 0, maxDepthM: 0, volumeM3: 0 }
  for (let seed = 0; seed < n; seed++) {
    if (ponded[seed] !== 1) continue
    let head = 0,
      tail = 0,
      deepest = seed,
      volume = 0,
      touchesRoad = false,
      catchment = 0
    queue[tail++] = seed
    ponded[seed] = 2
    while (head < tail) {
      const i = queue[head++],
        row = (i / w) | 0,
        col = i - row * w
      volume += depthD[i] * cellArea
      if (depthD[i] > depthD[deepest]) deepest = i
      if (footprint[i]) touchesRoad = true
      catchment = Math.max(catchment, accD[i])
      for (let k = 0; k < 8; k++) {
        const r = row + D_ROW[k],
          q = col + D_COL[k]
        if (r < 0 || q < 0 || r >= design.height || q >= w) continue
        const j = r * w + q
        if (footprint[j]) touchesRoad = true
        if (ponded[j] === 1) {
          ponded[j] = 2
          queue[tail++] = j
        }
      }
    }
    const place = locate(deepest)
    const summary: PondingSummary = {
      cells: tail,
      areaM2: tail * cellArea,
      maxDepthM: depthD[deepest],
      volumeM3: volume,
    }
    total.cells += tail
    total.areaM2 += summary.areaM2
    total.volumeM3 += volume
    total.maxDepthM = Math.max(total.maxDepthM, summary.maxDepthM)
    ponds.push({
      type: 'Feature',
      properties: {
        id: `pond-${ponds.length + 1}`,
        ...summary,
        chainage: place.chainage,
        offsetM: place.offset,
        areaHa: catchment / 10_000,
        touchesRoad,
      },
      geometry: { type: 'Point', coordinates: lonLat(deepest) },
    })
  }

  // Low points: where concentrated design-surface flow leaves the prism, and ponds on it.
  type Candidate = Omit<DitchLowPoint, 'id'>
  const candidates: Candidate[] = []
  for (let i = 0; i < n; i++) {
    if (!footprint[i] || !(accD[i] >= minLowArea)) continue
    const j = downstream(after.dirs, w, i)
    if (j >= 0 && footprint[j]) continue
    const place = locate(i),
      channel = channelOf[i] ? channels[channelOf[i] - 1].id : null
    candidates.push({
      kind: 'outlet',
      side: place.offset < 0 ? 'left' : 'right',
      chainage: place.chainage,
      coordinate: lonLat(i),
      areaHa: accD[i] / 10_000,
      depthM: 0,
      culvertId: channel ?? nearestCulvert(place.chainage),
      throughCulvert: channel !== null,
    })
  }
  for (const pond of ponds) {
    const p = pond.properties
    if (!p.touchesRoad || p.areaHa * 10_000 < minLowArea) continue
    candidates.push({
      kind: 'pond',
      side: p.offsetM < 0 ? 'left' : 'right',
      chainage: p.chainage,
      coordinate: pond.geometry.coordinates as Coordinate,
      areaHa: p.areaHa,
      depthM: p.maxDepthM,
      culvertId: nearestCulvert(p.chainage),
      throughCulvert: false,
    })
  }
  candidates.sort((a, b) => b.areaHa - a.areaHa || (a.kind === 'pond' ? -1 : 1))
  const kept: Candidate[] = []
  for (const c of candidates)
    if (!kept.some((k) => k.side === c.side && k.kind === c.kind && Math.abs(k.chainage - c.chainage) < 10))
      kept.push(c)
  const lowPoints = kept.sort((a, b) => a.chainage - b.chainage).map((c, index) => ({ id: `low-${index + 1}`, ...c }))

  // Culvert size check.
  const culvertChecks: CulvertCheck[] = []
  for (const c of culverts) {
    const channel = channels.find((ch) => ch.id === c.id)
    if (!channel) {
      warnings.push(`${c.name}: outside the road or the surface grid; not checked.`)
      continue
    }
    let designArea = 0,
      existingArea = 0
    for (const i of channel.barrel) {
      designArea = Math.max(designArea, accD[i])
      existingArea = Math.max(existingArea, accE[i])
    }
    const fall =
      c.inletInvertM !== null && c.outletInvertM !== null && c.lengthM > 0
        ? (c.inletInvertM - c.outletInvertM) / c.lengthM
        : NaN
    const slopeAssumed = !(fall > 0),
      slope = slopeAssumed ? defaultSlope : fall
    const designAreaHa = designArea / 10_000
    const designFlowM3s = rationalPeakFlow(input.runoffCoefficient, input.rainfallMmPerHr, designAreaHa)
    const capacityM3s = fullPipeCapacity(c.diameterM, slope, input.manningN)
    if (channel.assumedInverts) warnings.push(`${c.name}: inverts missing; channel set 0.3 m below the lower end.`)
    culvertChecks.push({
      id: c.id,
      name: c.name,
      chainage: c.chainage,
      designAreaHa,
      existingAreaHa: existingArea / 10_000,
      designFlowM3s,
      capacityM3s,
      slope,
      slopeAssumed,
      diameterM: c.diameterM,
      minimumDiameterM: minimumDiameter(designFlowM3s, slope, input.manningN),
      adequate: capacityM3s >= designFlowM3s,
    })
  }

  return {
    existing: before.drainage,
    design: after.drainage,
    newPonding: { ...total, ponds: { type: 'FeatureCollection', features: ponds } },
    crossings,
    lowPoints,
    culverts: culvertChecks,
    warnings,
  }
}
