/**
 * A landform suggested from the ground itself.
 *
 * The 2013 guide: "A landform is a distinct topographic feature, is
 * three-dimensional in form, and is generally defined by ridges, valleys,
 * shorelines, and skylines." Each of those is something the elevation model
 * can find, so this grows the hillside a block sits on until one of them stops
 * it:
 *
 * - **Ridges and skylines** — where the ground turns to face away from the
 *   viewpoint. The far side of a ridge is not part of the face the viewer sees.
 * - **Valleys** — where the slope flattens onto the valley floor, and where a
 *   drainage big enough to matter cuts across the face (flow accumulation over
 *   a filled surface).
 * - **Shorelines** — mapped water, when the caller has it.
 *
 * What comes back is a candidate for the reviewer, like an inventory unit: a
 * reading of the terrain from one viewpoint, not a delineation anyone has
 * checked. It is pure — no DOM, no network — so it runs against any
 * `ElevationSource` and is tested on synthetic ground.
 */
import type { ElevationSource } from './terrain'
import { metersPerDegree, pointInPolygon, polygonAreaMeters, polygonBounds, type PolygonGeometry } from './visibility'

export type LandformBoundary = 'faces-away' | 'flat' | 'slope-break' | 'drainage' | 'water' | 'narrow' | 'no-data' | 'search-limit'

export type TerrainLandformOptions = {
  /** Grid cell, metres. 50 m resolves a hillside face without resolving every gully. */
  cellMeters?: number
  /** How far from the block to look, metres. */
  radiusMeters?: number
  /** Slopes gentler than this are valley floor, percent. */
  minSlopePercent?: number
  /** Ground whose downslope direction turns more than this from the viewer faces away, degrees. */
  facingToleranceDegrees?: number
  /** A drainage with at least this catchment splits a face, km². */
  drainageAreaKm2?: number
  /** Water to stop at: lakes, wide rivers. */
  water?: ReadonlyArray<PolygonGeometry>
  /**
   * Slope and facing are read off terrain smoothed over about this distance,
   * metres. A landform is a hillside, not every bench and gully on it; read
   * cell by cell the face breaks into fingers along each spur.
   */
  generaliseMeters?: number
  /** Flat ground above the block up to about this wide is a bench and is bridged, metres. */
  benchMeters?: number
  /** A viewpoint nearer than this reads facing against one bearing, metres. */
  closeViewerMeters?: number
}

export type TerrainLandform = {
  geometry: GeoJSON.Polygon
  areaHectares: number
  /** Share of the outline stopped by each kind of edge, 0–1. */
  boundedBy: Partial<Record<LandformBoundary, number>>
  /** The face ran into the edge of the search area, so it may continue past it. */
  reachedLimit: boolean
  /**
   * The terrain found little face beyond the block itself — a block on a valley
   * floor or a narrow bank, where there is no hillside for an opening to alter
   * a share of.
   */
  blockOnly: boolean
  /**
   * The viewpoint is close enough that facing was read against one bearing,
   * block to viewer, rather than cell by cell — from a road on the same slope
   * the ground either side of the viewer would otherwise face away from it.
   */
  viewerClose: boolean
}

export const TERRAIN_LANDFORM_DEFAULTS = {
  cellMeters: 50,
  radiusMeters: 5000,
  minSlopePercent: 8,
  facingToleranceDegrees: 80,
  drainageAreaKm2: 3,
  generaliseMeters: 150,
  /** Flat ground above the block this wide or narrower is a bench on the face, not its top. */
  benchMeters: 300,
  /** Nearer than this, facing is read against one bearing (`viewerClose`). */
  closeViewerMeters: 1500,
} as const

const NEIGHBOURS_8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

/** A binary min-heap on elevation, for the priority-flood fill. */
class MinHeap {
  private items: number[] = []
  constructor(private readonly key: Float64Array) {}
  get size() { return this.items.length }
  push(index: number) {
    const items = this.items
    items.push(index)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.key[items[parent]] <= this.key[items[i]]) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }
  pop(): number {
    const items = this.items
    const top = items[0]
    const last = items.pop()!
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1, right = left + 1
        let smallest = i
        if (left < items.length && this.key[items[left]] < this.key[items[smallest]]) smallest = left
        if (right < items.length && this.key[items[right]] < this.key[items[smallest]]) smallest = right
        if (smallest === i) break
        ;[items[smallest], items[i]] = [items[i], items[smallest]]
        i = smallest
      }
    }
    return top
  }
}

/**
 * Upstream cell count for every cell. Pits are filled first (priority flood,
 * with a small rise across flats so they still drain), so a DEM's noise does
 * not strand a drainage halfway down a hillside.
 */
export function flowAccumulation(elevation: Float64Array, width: number, height: number): Float64Array {
  const n = width * height
  const filled = new Float64Array(elevation)
  for (let i = 0; i < n; i += 1) if (!Number.isFinite(filled[i])) filled[i] = -Infinity
  const done = new Uint8Array(n)
  const heap = new MinHeap(filled)
  for (let x = 0; x < width; x += 1) for (const y of [0, height - 1]) { const i = y * width + x; if (!done[i]) { done[i] = 1; heap.push(i) } }
  for (let y = 0; y < height; y += 1) for (const x of [0, width - 1]) { const i = y * width + x; if (!done[i]) { done[i] = 1; heap.push(i) } }
  const order: number[] = []
  while (heap.size) {
    const i = heap.pop()
    order.push(i)
    const x = i % width, y = (i - x) / width
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (done[j]) continue
      done[j] = 1
      if (filled[j] <= filled[i]) filled[j] = filled[i] + 1e-4
      heap.push(j)
    }
  }
  // Downhill last-in first: every cell hands its count to its steepest lower neighbour.
  const accumulation = new Float64Array(n).fill(1)
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const i = order[k]
    const x = i % width, y = (i - x) / width
    let best = -1, drop = 0
    for (const [dx, dy, distance] of NEIGHBOURS_8) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      const slope = (filled[i] - filled[j]) / distance
      if (slope > drop) { drop = slope; best = j }
    }
    if (best >= 0) accumulation[best] += accumulation[i]
  }
  return accumulation
}

/**
 * The outline of a set of grid cells, as rings of cell corners with the cells
 * on the left. At a corner where two parts of the set only touch diagonally
 * the walk turns left, so each part closes on its own ring.
 */
export function traceRings(mask: Uint8Array, width: number, height: number): Array<Array<[number, number]>> {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1
  const edges = new Map<string, Array<[number, number, number, number]>>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = `${x0},${y0}`
    const list = edges.get(key)
    if (list) list.push([x0, y0, x1, y1])
    else edges.set(key, [[x0, y0, x1, y1]])
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue
      if (!inside(x, y - 1)) add(x, y, x + 1, y)
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!inside(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const rings: Array<Array<[number, number]>> = []
  // Prefer the left turn, then straight on, then right.
  const rank = (from: [number, number, number, number], to: [number, number, number, number]) => {
    const cross = (from[2] - from[0]) * (to[3] - to[1]) - (from[3] - from[1]) * (to[2] - to[0])
    return cross > 0 ? 0 : cross === 0 ? 1 : 2
  }
  for (const [, list] of edges) {
    while (list.length) {
      let edge = list.pop()!
      const start = `${edge[0]},${edge[1]}`
      const ring: Array<[number, number]> = []
      for (;;) {
        ring.push([edge[0], edge[1]])
        const end = `${edge[2]},${edge[3]}`
        if (end === start) break
        const options = edges.get(end)
        if (!options?.length) break
        const current = edge
        options.sort((a, b) => rank(current, a) - rank(current, b))
        edge = options.shift()!
      }
      if (ring.length >= 4) rings.push(ring)
    }
  }
  return rings
}

function signedArea(ring: ReadonlyArray<[number, number]>): number {
  let area = 0
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length]
    area += x0 * y1 - x1 * y0
  }
  return area / 2
}

/** A square box blur of radius `r` cells, ignoring missing values. */
function boxBlur(values: Float64Array, width: number, height: number, r: number): Float64Array {
  const pass = (input: Float64Array, horizontal: boolean) => {
    const output = new Float64Array(input.length)
    for (let a = 0; a < (horizontal ? height : width); a += 1) {
      for (let b = 0; b < (horizontal ? width : height); b += 1) {
        let sum = 0, count = 0
        for (let k = -r; k <= r; k += 1) {
          const c = b + k
          if (c < 0 || c >= (horizontal ? width : height)) continue
          const value = input[horizontal ? a * width + c : c * width + a]
          if (Number.isFinite(value)) { sum += value; count += 1 }
        }
        const i = horizontal ? a * width + b : b * width + a
        output[i] = Number.isFinite(input[i]) && count ? sum / count : Number.NaN
      }
    }
    return output
  }
  return pass(pass(values, true), false)
}

/** Square structuring element of radius `r`: a cell is set when any (dilate) or every (erode) cell within it is. */
function morph(mask: Uint8Array, width: number, height: number, r: number, any: boolean): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let hit = !any
    for (let dy = -r; dy <= r && hit !== any; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const nx = x + dx, ny = y + dy
      const set = nx >= 0 && ny >= 0 && nx < width && ny < height ? mask[ny * width + nx] === 1 : !any
      if (set === any) { hit = any; break }
    }
    out[y * width + x] = hit ? 1 : 0
  }
  return out
}
const dilate = (mask: Uint8Array, width: number, height: number, r: number) => morph(mask, width, height, r, true)
const erode = (mask: Uint8Array, width: number, height: number, r: number) => morph(mask, width, height, r, false)

/** Douglas–Peucker on a closed ring, so a staircase of cells reads as a line. */
function simplifyRing(ring: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (ring.length < 5) return ring
  const keep = new Uint8Array(ring.length)
  const distance = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1])
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length
  }
  const run = (from: number, to: number) => {
    let worst = -1, index = -1
    for (let i = from + 1; i < to; i += 1) {
      const d = distance(ring[i], ring[from], ring[to])
      if (d > worst) { worst = d; index = i }
    }
    if (worst > tolerance && index > 0) { keep[index] = 1; run(from, index); run(index, to) }
  }
  // Split at the vertex farthest from the first, so the closed ring has two ends to anchor.
  let far = 0
  for (let i = 1; i < ring.length; i += 1) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i
  keep[0] = 1; keep[far] = 1
  run(0, far)
  const closed = [...ring, ring[0]]
  const tail = (from: number, to: number) => {
    let worst = -1, index = -1
    for (let i = from + 1; i < to; i += 1) {
      const d = distance(closed[i], closed[from], closed[to])
      if (d > worst) { worst = d; index = i }
    }
    if (worst > tolerance && index > 0) { if (index < ring.length) keep[index] = 1; tail(from, index); tail(index, to) }
  }
  tail(far, ring.length)
  return ring.filter((_, i) => keep[i])
}

/**
 * The hillside face containing `block`, as seen from `viewpoint`. Null when
 * there is no terrain under the block.
 */
export function landformFromTerrain(
  source: ElevationSource,
  block: PolygonGeometry,
  viewpoint: { lng: number; lat: number },
  options: TerrainLandformOptions = {},
): TerrainLandform | null {
  const cell = options.cellMeters ?? TERRAIN_LANDFORM_DEFAULTS.cellMeters
  const radius = options.radiusMeters ?? TERRAIN_LANDFORM_DEFAULTS.radiusMeters
  const minSlope = (options.minSlopePercent ?? TERRAIN_LANDFORM_DEFAULTS.minSlopePercent) / 100
  const facing = Math.cos(((options.facingToleranceDegrees ?? TERRAIN_LANDFORM_DEFAULTS.facingToleranceDegrees) * Math.PI) / 180)
  const drainageCells = ((options.drainageAreaKm2 ?? TERRAIN_LANDFORM_DEFAULTS.drainageAreaKm2) * 1e6) / (cell * cell)
  const water = options.water ?? []

  const [west, south, east, north] = polygonBounds(block)
  const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
  const scale = metersPerDegree(centre.lat)
  const half = Math.ceil(radius / cell)
  const width = 2 * half + 1, height = width
  // Cell (x, y) centre, metres east and north of the block's centre.
  const toLngLat = (mx: number, my: number): [number, number] => [centre.lng + mx / scale.lng, centre.lat + my / scale.lat]
  const cellCentre = (x: number, y: number) => toLngLat((x - half) * cell, (y - half) * cell)

  const raw = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [lng, lat] = cellCentre(x, y)
    raw[y * width + x] = source.elevationAt(lng, lat)
  }
  // 3 × 3 mean: aspect off a raw DEM flickers from cell to cell on a smooth face.
  const smooth = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let sum = 0, count = 0
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const value = raw[ny * width + nx]
      if (Number.isFinite(value)) { sum += value; count += 1 }
    }
    smooth[y * width + x] = Number.isFinite(raw[y * width + x]) && count ? sum / count : Number.NaN
  }
  // Flow is routed on the raw surface: smoothing flattens a gully's bottom and
  // D8 then splits its water between parallel lines, neither big enough to count.
  const accumulation = flowAccumulation(raw, width, height)
  // A drainage has a valley bottom, not a one-cell line: widen it a cell each
  // side so it still parts the face once the outline is simplified.
  const drainage = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (accumulation[y * width + x] < drainageCells) continue
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) drainage[ny * width + nx] = 1
    }
  }

  // The hillside's own shape: box blur, twice, over the generalising distance.
  const broad = boxBlur(boxBlur(smooth, width, height, Math.max(1, Math.round((options.generaliseMeters ?? TERRAIN_LANDFORM_DEFAULTS.generaliseMeters) / cell))), width, height, Math.max(1, Math.round((options.generaliseMeters ?? TERRAIN_LANDFORM_DEFAULTS.generaliseMeters) / cell)))
  // Water rasterised polygon by polygon over its own bounding box: testing
  // every cell against every polygon froze the page for 20 s on a lake-rich view.
  const wet = new Uint8Array(width * height)
  for (const polygon of water) {
    const [pw, ps, pe, pn] = polygonBounds(polygon)
    const wx0 = Math.max(0, Math.floor(((pw - centre.lng) * scale.lng) / cell) + half)
    const wx1 = Math.min(width - 1, Math.ceil(((pe - centre.lng) * scale.lng) / cell) + half)
    const wy0 = Math.max(0, Math.floor(((ps - centre.lat) * scale.lat) / cell) + half)
    const wy1 = Math.min(height - 1, Math.ceil(((pn - centre.lat) * scale.lat) / cell) + half)
    for (let y = wy0; y <= wy1; y += 1) for (let x = wx0; x <= wx1; x += 1) {
      if (wet[y * width + x]) continue
      const [lng, lat] = cellCentre(x, y)
      if (pointInPolygon(polygon, lng, lat)) wet[y * width + x] = 1
    }
  }
  // Seed from the block itself: it is on the landform whatever its own cells say.
  const inBlock = new Uint8Array(width * height)
  const seeds: number[] = []
  const x0 = Math.max(0, Math.floor(((west - centre.lng) * scale.lng) / cell) + half - 1)
  const x1 = Math.min(width - 1, Math.ceil(((east - centre.lng) * scale.lng) / cell) + half + 1)
  const y0 = Math.max(0, Math.floor(((south - centre.lat) * scale.lat) / cell) + half - 1)
  const y1 = Math.min(height - 1, Math.ceil(((north - centre.lat) * scale.lat) / cell) + half + 1)
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const [lng, lat] = cellCentre(x, y)
    if (pointInPolygon(block, lng, lat) && Number.isFinite(smooth[y * width + x])) { inBlock[y * width + x] = 1; seeds.push(y * width + x) }
  }
  if (!seeds.length) {
    const i = half * width + half
    if (!Number.isFinite(smooth[i])) return null
    inBlock[i] = 1
    seeds.push(i)
  }

  // Flat ground below the block is valley floor; above it, a bench or the top.
  let blockElevation = 0
  for (const i of seeds) blockElevation += smooth[i] / seeds.length

  const at = (x: number, y: number) => broad[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]
  const viewX = (viewpoint.lng - centre.lng) * scale.lng, viewY = (viewpoint.lat - centre.lat) * scale.lat
  const viewerClose = Math.hypot(viewX, viewY) < (options.closeViewerMeters ?? TERRAIN_LANDFORM_DEFAULTS.closeViewerMeters)
  const reason = new Array<LandformBoundary | null>(width * height).fill(null)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x
    if (!Number.isFinite(smooth[i])) { reason[i] = 'no-data'; continue }
    const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell), gy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell)
    const slope = Math.hypot(gx, gy)
    if (!Number.isFinite(slope)) { reason[i] = 'no-data'; continue }
    if (wet[i]) { reason[i] = 'water'; continue }
    if (drainage[i]) { reason[i] = 'drainage'; continue }
    if (slope < minSlope) { reason[i] = smooth[i] > blockElevation ? 'slope-break' : 'flat'; continue }
    // Downslope points at the viewer on a face turned toward them.
    const tx = viewerClose ? viewX : viewX - (x - half) * cell, ty = viewerClose ? viewY : viewY - (y - half) * cell
    const toward = Math.hypot(tx, ty)
    if (toward > 0 && (-gx * tx - gy * ty) / (slope * toward) < facing) reason[i] = 'faces-away'
  }

  // Close notches two cells deep, then trim fingers a cell wide: a landform's
  // edge is a ridge or a valley, not the fringe of a threshold. Trimming wider
  // lost a 150 m lakeshore bank whole.
  const eligible = new Uint8Array(width * height)
  for (let i = 0; i < eligible.length; i += 1) eligible[i] = reason[i] === null ? 1 : 0
  // Water, drainages and missing terrain are real edges; only the thresholds' fringe is smoothed.
  const hard = (i: number) => reason[i] === 'water' || reason[i] === 'drainage' || reason[i] === 'no-data'
  // A bench is flat ground above the block with face going on up above it and
  // down below it — in opposite directions. A saddle has higher ground on two
  // sides along the contour and lower ground across it, at right angles, so it
  // is not bridged: bridging by closure alone ran a knoll's face over the
  // saddle onto the next mountain. The top, with nothing higher, stays an edge.
  const benchCells = Math.max(1, Math.round((options.benchMeters ?? TERRAIN_LANDFORM_DEFAULTS.benchMeters) / cell))
  const DIRECTIONS = 16
  const RISE_METERS = 10
  const faceOrBlock = (j: number) => eligible[j] === 1 || inBlock[j] === 1
  for (let i = 0; i < eligible.length; i += 1) {
    if (reason[i] !== 'slope-break') continue
    const x = i % width, y = (i - x) / width
    const up: boolean[] = [], down: boolean[] = []
    for (let d = 0; d < DIRECTIONS; d += 1) {
      const angle = (d / DIRECTIONS) * 2 * Math.PI
      up.push(false); down.push(false)
      for (let step = 1; step <= benchCells; step += 1) {
        const nx = Math.round(x + Math.cos(angle) * step), ny = Math.round(y + Math.sin(angle) * step)
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) break
        const j = ny * width + nx
        if (hard(j)) break
        if (!faceOrBlock(j)) continue
        if (smooth[j] > smooth[i] + RISE_METERS) up[d] = true
        else if (smooth[j] < smooth[i] - RISE_METERS) down[d] = true
        break
      }
    }
    // Face above one way and below within 22.5° of straight back.
    let bench = false
    for (let d = 0; d < DIRECTIONS && !bench; d += 1) {
      if (!up[d]) continue
      for (const offset of [-1, 0, 1]) if (down[(d + DIRECTIONS / 2 + offset + DIRECTIONS) % DIRECTIONS]) bench = true
    }
    if (bench) reason[i] = null
  }
  for (let i = 0; i < eligible.length; i += 1) eligible[i] = reason[i] === null ? 1 : 0
  const closed = erode(dilate(eligible, width, height, 2), width, height, 2)
  const opened = dilate(erode(closed, width, height, 1), width, height, 1)
  for (let i = 0; i < eligible.length; i += 1) {
    if (opened[i] && !hard(i)) reason[i] = null
    else if (!opened[i] && reason[i] === null) reason[i] = 'narrow'
  }

  const region = new Uint8Array(width * height)
  const queue = [...seeds]
  for (const i of seeds) region[i] = 1
  // Grow over the face. The block's own cells are always in; from outside
  // them only eligible ground joins.
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]
    const x = i % width, y = (i - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (region[j] || (reason[j] !== null && !inBlock[j])) continue
      region[j] = 1
      queue.push(j)
    }
  }

  // A landform has no holes: a knoll or a gully inside the face is part of it.
  const outside = new Uint8Array(width * height)
  const flood: number[] = []
  for (let x = 0; x < width; x += 1) for (const y of [0, height - 1]) { const i = y * width + x; if (!region[i] && !outside[i]) { outside[i] = 1; flood.push(i) } }
  for (let y = 0; y < height; y += 1) for (const x of [0, width - 1]) { const i = y * width + x; if (!region[i] && !outside[i]) { outside[i] = 1; flood.push(i) } }
  for (let head = 0; head < flood.length; head += 1) {
    const i = flood[head]
    const x = i % width, y = (i - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (region[j] || outside[j]) continue
      outside[j] = 1
      flood.push(j)
    }
  }
  let cells = 0
  for (let i = 0; i < region.length; i += 1) if (!outside[i]) { region[i] = 1; cells += 1 }
  // Why the face stops, tallied along the edge that is drawn: after holes are filled.
  const tally = new Map<LandformBoundary, number>()
  let edgeCount = 0
  let reachedLimit = false
  for (let i = 0; i < region.length; i += 1) {
    if (!region[i]) continue
    const x = i % width, y = (i - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      let why: LandformBoundary | null
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) { why = 'search-limit'; reachedLimit = true }
      else if (region[ny * width + nx]) continue
      else why = reason[ny * width + nx] ?? 'faces-away'
      edgeCount += 1
      tally.set(why, (tally.get(why) ?? 0) + 1)
    }
  }

  // Little joined the block: no face to speak of, only the ground it stands on.
  const blockOnly = cells <= seeds.length * 2.5 + 4

  const rings = traceRings(region, width, height)
  if (!rings.length) return null
  const outer = rings.reduce((best, ring) => (signedArea(ring) > signedArea(best) ? ring : best))
  const simplified = simplifyRing(outer, 0.75)
  // Corner (x, y) of the grid, in metres from the block's centre.
  const coordinates = simplified.map(([x, y]) => toLngLat((x - half - 0.5) * cell, (y - half - 0.5) * cell))
  coordinates.push(coordinates[0])

  return {
    geometry: { type: 'Polygon', coordinates: [coordinates] },
    // The drawn outline's own area, so pieces only touching it at a corner do not count.
    areaHectares: polygonAreaMeters({ type: 'Polygon', coordinates: [coordinates] }) / 10_000,
    boundedBy: Object.fromEntries([...tally].map(([key, count]) => [key, count / Math.max(1, edgeCount)])),
    reachedLimit,
    blockOnly,
    viewerClose,
  }
}
