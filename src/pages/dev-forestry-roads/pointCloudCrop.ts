/**
 * Cropping a decoded point cloud to the area the road needs, before it is thinned, classified and
 * gridded. The decoder still reads the whole source tile (whitebox-wasm decodes a LAZ whole, and a
 * LAS is decoded in full); the crop only decides which of the decoded points go on to surface
 * building, so it saves the thinning budget, the ground filter's time and the grid's size, never
 * the read. Guide: `docs/forestry-road-design/terrain-preparation-and-survey.md`, **Cropping a
 * point cloud**.
 *
 * The crop is a drawn or imported polygon, a corridor round the road, or both (a point inside
 * either is kept). An optional upslope margin keeps ground outside the crop where it stands higher
 * than the crop's nearest edge, so drainage still has the slope that drains onto the road. Before
 * classification "ground" there is the lowest non-noise return per cell (`CROP_LIMITS.marginCellM`),
 * the same proxy the thinning uses.
 *
 * No DOM or network access: the worker runs it, and the unit tests run it on plain arrays.
 */

import { cropRegionBox, cropRegionTest, inRing, type CropRegion } from '@/lib/lidar/cropRegion'

/** Source projected x/y, as `PointPreservation`'s regions are. */
export interface PointCloudCrop extends CropRegion {
  /** Keep ground up to this far outside the crop where it stands above the crop's nearest edge. */
  upslopeMarginM?: number
}

export const CROP_LIMITS = {
  /** Polygon and corridor vertices together. */
  maxVertices: 2_000,
  maxPolygons: 100,
  maxHalfWidthM: 1_000,
  maxUpslopeMarginM: 500,
  /** Cell of the upslope margin's ground proxy and of the reported footprint. */
  marginCellM: 5,
  /** The margin's cell grows past `marginCellM` to stay within this many cells. */
  maxMarginCells: 4_000_000,
  /** Vertices × points the region test may take, as the preservation mask allows. */
  maxRegionWork: 400_000_000,
}

const NOISE = new Set([7, 18])
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Refuses a crop the worker could not apply exactly; `null` for no crop at all. */
export function validateCrop(crop: PointCloudCrop | undefined): PointCloudCrop | null {
  if (!crop) return null
  const rings = crop.polygons ?? []
  const corridor = crop.corridor
  if (!corridor && !rings.length) return null
  const vertices = (corridor?.points.length ?? 0) + rings.reduce((s, r) => s + r.length, 0)
  if (vertices > CROP_LIMITS.maxVertices || rings.length > CROP_LIMITS.maxPolygons)
    throw Error(
      `The crop has ${vertices} vertices in ${rings.length} areas; at most ${CROP_LIMITS.maxVertices} vertices in ${CROP_LIMITS.maxPolygons} areas. Simplify the area.`,
    )
  if (rings.some((r) => r.length < 3)) throw Error('A crop area needs at least three corners.')
  if (
    corridor &&
    (!finite(corridor.halfWidthM) ||
      corridor.halfWidthM <= 0 ||
      corridor.halfWidthM > CROP_LIMITS.maxHalfWidthM ||
      corridor.points.length < 2)
  )
    throw Error(`A crop corridor needs a road of two points or more and 0–${CROP_LIMITS.maxHalfWidthM} m each side.`)
  const margin = crop.upslopeMarginM ?? 0
  if (!finite(margin) || margin < 0 || margin > CROP_LIMITS.maxUpslopeMarginM)
    throw Error(`The upslope margin is 0–${CROP_LIMITS.maxUpslopeMarginM} m.`)
  if ([...(corridor?.points ?? []), ...rings.flat()].some((p) => p.length !== 2 || !p.every(finite)))
    throw Error('The crop has a coordinate that is not a number.')
  return crop
}

export interface CropResult {
  /** 1 for a point kept. */
  mask: Uint8Array
  /** Points inside the polygon or corridor. */
  inside: number
  /** Points kept only by the upslope margin. */
  margin: number
  kept: number
  /** Decoded points tested. */
  total: number
}

/**
 * Which points the crop keeps: those inside a polygon or within the corridor, then, with an upslope
 * margin, those in margin cells whose ground stands above the crop cell nearest them. Deterministic:
 * the same points and crop give the same mask.
 */
export function cropMask(
  cloud: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>; classification: ArrayLike<number> },
  crop: PointCloudCrop,
): CropResult {
  const valid = validateCrop(crop)
  const { x, y } = cloud,
    n = x.length
  if (y.length !== n || cloud.z.length !== n || cloud.classification.length !== n)
    throw Error('The point arrays differ in length.')
  const mask = new Uint8Array(n)
  if (!valid) return { mask: mask.fill(1), inside: n, margin: 0, kept: n, total: n }
  const vertices = (valid.corridor?.points.length ?? 0) + (valid.polygons ?? []).reduce((s, r) => s + r.length, 0)
  if (vertices * n > CROP_LIMITS.maxRegionWork)
    throw Error('The crop is too detailed for this many points; simplify the area or the road.')
  const test = cropRegionTest(valid)
  let inside = 0
  for (let i = 0; i < n; i++)
    if (test(x[i], y[i])) {
      mask[i] = 1
      inside++
    }
  const margin = valid.upslopeMarginM ? upslopeMargin(cloud, mask, valid.upslopeMarginM) : 0
  return { mask, inside, margin, kept: inside + margin, total: n }
}

/** The margin's cell: `marginCellM`, grown only for a cloud wider than `maxMarginCells` of them. */
function marginCellFor(width: number, height: number) {
  let cell = CROP_LIMITS.marginCellM
  while ((width / cell + 2) * (height / cell + 2) > CROP_LIMITS.maxMarginCells) cell *= 1.5
  return cell
}

/**
 * How far past the crop region a point can be and still be kept: the upslope margin plus two cells
 * (a margin cell's centre is within the margin of a crop cell's, and each point within half a
 * diagonal of its cell's centre). A reader that drops points beyond this keeps every point the
 * crop would, and the same ground in every cell the margin reads, while the margin's cell stays
 * `marginCellM` (clouds up to about 10 km across).
 */
export function cropReachM(crop: PointCloudCrop): number {
  return crop.upslopeMarginM ? crop.upslopeMarginM + 2 * CROP_LIMITS.marginCellM : 0
}

/**
 * Marks (in `mask`, with 2) points outside the crop whose cell is within `marginM` of a crop cell
 * and whose cell's ground is higher than that nearest crop cell's. Distance runs over 8-connected
 * cell centres (Dijkstra), so it reads a little long on diagonals, never short. Returns the count.
 */
function upslopeMargin(
  cloud: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>; classification: ArrayLike<number> },
  mask: Uint8Array,
  marginM: number,
): number {
  const { x, y, z, classification } = cloud,
    n = x.length
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    seeds = 0
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i]
    if (y[i] < minY) minY = y[i]
    if (x[i] > maxX) maxX = x[i]
    if (y[i] > maxY) maxY = y[i]
    seeds += mask[i]
  }
  if (!seeds || seeds === n) return 0
  const cell = marginCellFor(maxX - minX, maxY - minY)
  // Cells on whole multiples of the cell size, so a cloud read only near the crop (the chunked
  // read, `cropReachM`) has the same cells, ground and margin as the whole tile.
  minX = Math.floor(minX / cell) * cell
  minY = Math.floor(minY / cell) * cell
  const cols = Math.floor((maxX - minX) / cell) + 1,
    rows = Math.floor((maxY - minY) / cell) + 1,
    size = cols * rows
  const cellOf = (i: number) => Math.floor((y[i] - minY) / cell) * cols + Math.floor((x[i] - minX) / cell)
  // Ground proxy per cell: the lowest ground return, else the lowest non-noise one.
  const groundZ = new Float64Array(size).fill(Infinity),
    lowZ = new Float64Array(size).fill(Infinity),
    seed = new Uint8Array(size)
  for (let i = 0; i < n; i++) {
    const c = cellOf(i),
      cls = classification[i]
    if (mask[i]) seed[c] = 1
    if (NOISE.has(cls)) continue
    if (cls === 2) {
      if (z[i] < groundZ[c]) groundZ[c] = z[i]
    } else if (z[i] < lowZ[c]) lowZ[c] = z[i]
  }
  const ground = new Float64Array(size)
  for (let c = 0; c < size; c++) ground[c] = groundZ[c] < Infinity ? groundZ[c] : lowZ[c]
  // Nearest crop cell by distance: Dijkstra from every seed, carrying the seed's ground. A seed
  // without a ground proxy (only noise) carries none, and ground nearest it is not kept.
  const distance = new Float64Array(size).fill(Infinity),
    from = new Float64Array(size).fill(NaN)
  const heap = new MinHeap(size)
  for (let c = 0; c < size; c++)
    if (seed[c]) {
      distance[c] = 0
      from[c] = ground[c]
      heap.push(c, 0)
    }
  const steps: Array<[number, number, number]> = [
    [-1, 0, cell],
    [1, 0, cell],
    [0, -1, cell],
    [0, 1, cell],
    [-1, -1, cell * Math.SQRT2],
    [1, -1, cell * Math.SQRT2],
    [-1, 1, cell * Math.SQRT2],
    [1, 1, cell * Math.SQRT2],
  ]
  while (heap.size) {
    const c = heap.pop(),
      d = distance[c]
    const col = c % cols,
      row = (c - col) / cols
    for (const [dc, dr, step] of steps) {
      const cc = col + dc,
        rr = row + dr
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
      const next = rr * cols + cc,
        nd = d + step
      if (nd > marginM + 1e-9 || nd >= distance[next]) continue
      distance[next] = nd
      from[next] = from[c]
      heap.push(next, nd)
    }
  }
  let kept = 0
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue
    const c = cellOf(i)
    // `seed[c]` cells are inside the crop's footprint already: only their crop points are kept.
    if (!seed[c] && distance[c] <= marginM && ground[c] > from[c]) {
      mask[i] = 2
      kept++
    }
  }
  return kept
}

/** A binary min-heap of cell indices keyed by distance; ties go to the lower cell, so it is deterministic. */
class MinHeap {
  private cells: Int32Array
  private keys: Float64Array
  size = 0
  constructor(capacity: number) {
    this.cells = new Int32Array(Math.max(16, Math.min(capacity, 1 << 16)))
    this.keys = new Float64Array(this.cells.length)
  }
  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.cells[a] < this.cells[b])
  }
  private swap(a: number, b: number) {
    const c = this.cells[a],
      k = this.keys[a]
    this.cells[a] = this.cells[b]
    this.keys[a] = this.keys[b]
    this.cells[b] = c
    this.keys[b] = k
  }
  push(cell: number, key: number) {
    if (this.size === this.cells.length) {
      const cells = new Int32Array(this.size * 2),
        keys = new Float64Array(this.size * 2)
      cells.set(this.cells)
      keys.set(this.keys)
      this.cells = cells
      this.keys = keys
    }
    let i = this.size++
    this.cells[i] = cell
    this.keys[i] = key
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  pop(): number {
    const top = this.cells[0]
    this.size--
    if (this.size) {
      this.cells[0] = this.cells[this.size]
      this.keys[0] = this.keys[this.size]
      let i = 0
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1
        let m = i
        if (l < this.size && this.less(l, m)) m = l
        if (r < this.size && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}

/** The kept points only, in file order. */
export function applyCropMask<
  T extends { x: Float64Array; y: Float64Array; z: Float64Array; classification: Uint8Array },
>(cloud: T, mask: Uint8Array, kept: number): Pick<T, 'x' | 'y' | 'z' | 'classification'> {
  const out = {
    x: new Float64Array(kept),
    y: new Float64Array(kept),
    z: new Float64Array(kept),
    classification: new Uint8Array(kept),
  }
  for (let i = 0, k = 0; i < mask.length; i++)
    if (mask[i]) {
      out.x[k] = cloud.x[i]
      out.y[k] = cloud.y[i]
      out.z[k] = cloud.z[i]
      out.classification[k++] = cloud.classification[i]
    }
  return out
}

export interface CropFootprint {
  /** Closed rings, in the cloud's CRS, round the cells that hold a kept point. */
  rings: Array<Array<[number, number]>>
  cellM: number
  /** Area of those cells, m². */
  areaM2: number
}

/**
 * The outline of the cells that hold a kept point, for showing what the crop kept before the
 * surface is built. Rings run round each occupied region's boundary edges; a hole is its own ring.
 */
export function cropFootprint(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  maxCells = 250_000,
  cellM: number = CROP_LIMITS.marginCellM,
): CropFootprint {
  const n = x.length
  if (!n) return { rings: [], cellM, areaM2: 0 }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i]
    if (y[i] < minY) minY = y[i]
    if (x[i] > maxX) maxX = x[i]
    if (y[i] > maxY) maxY = y[i]
  }
  let cell = cellM
  while (((maxX - minX) / cell + 2) * ((maxY - minY) / cell + 2) > maxCells) cell *= 1.5
  // Whole multiples of the cell, so two footprints of one cloud (inside, kept) share their cells.
  minX = Math.floor(minX / cell) * cell
  minY = Math.floor(minY / cell) * cell
  const cols = Math.floor((maxX - minX) / cell) + 1,
    rows = Math.floor((maxY - minY) / cell) + 1
  const filled = new Uint8Array(cols * rows)
  let count = 0
  for (let i = 0; i < n; i++) {
    const c = Math.floor((y[i] - minY) / cell) * cols + Math.floor((x[i] - minX) / cell)
    if (!filled[c]) {
      filled[c] = 1
      count++
    }
  }
  const at = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < cols && row < rows ? filled[row * cols + col] : 0
  // Directed boundary edges with the filled cell on the left, keyed by their start corner.
  const W = cols + 1
  const edges = new Map<number, number[]>()
  const add = (from: number, to: number) => {
    const list = edges.get(from)
    if (list) list.push(to)
    else edges.set(from, [to])
  }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      if (!filled[row * cols + col]) continue
      const sw = row * W + col,
        se = sw + 1,
        nw = sw + W,
        ne = nw + 1
      if (!at(col, row - 1)) add(sw, se)
      if (!at(col + 1, row)) add(se, ne)
      if (!at(col, row + 1)) add(ne, nw)
      if (!at(col - 1, row)) add(nw, sw)
    }
  const corner = (k: number): [number, number] => [minX + (k % W) * cell, minY + Math.floor(k / W) * cell]
  const rings: CropFootprint['rings'] = []
  const starts = [...edges.keys()].sort((a, b) => a - b)
  for (const start of starts)
    while (edges.get(start)?.length) {
      const ring: number[] = [start]
      let at0 = start
      for (;;) {
        const list = edges.get(at0)!
        const next = list.shift()!
        if (!list.length) edges.delete(at0)
        if (next === start) break
        ring.push(next)
        at0 = next
        if (!edges.get(at0)?.length) break
      }
      // Drop corners where the boundary runs straight on.
      const simple = ring.filter((k, i) => {
        const a = corner(ring[(i + ring.length - 1) % ring.length]),
          b = corner(k),
          c = corner(ring[(i + 1) % ring.length])
        return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0
      })
      const points = simple.map(corner)
      rings.push([...points, points[0]])
    }
  return { rings, cellM: cell, areaM2: count * cell * cell }
}

/** The crop as the designer chose it, in WGS84: what the page keeps and the import projects. */
export interface PointCloudCropChoice {
  /** Crop to the active road's corridor, this far each side; 0 or omitted adds no corridor. */
  corridorM?: number
  /** Drawn or imported areas, WGS84 rings (closed or not). */
  areas?: Array<Array<[number, number]>>
  /** What the areas came from, for the summary: "Drawn area", a file name. */
  areaName?: string
  upslopeMarginM?: number
}

/** True when the choice crops anything. */
export function cropChosen(choice: PointCloudCropChoice | undefined, roadPoints = 0): boolean {
  return !!choice && (!!choice.areas?.length || (!!choice.corridorM && roadPoints >= 2))
}

/**
 * The choice in the cloud's projected CRS, or undefined when it crops nothing. `forward` takes
 * longitude/latitude to that CRS. A ring's closing point is dropped: the ring test closes it.
 */
export function projectCropChoice(
  choice: PointCloudCropChoice | undefined,
  road: Array<[number, number]>,
  forward: (lonLat: [number, number]) => [number, number],
): PointCloudCrop | undefined {
  if (!cropChosen(choice, road.length)) return undefined
  const polygons = (choice!.areas ?? []).map((ring) => {
    const open =
      ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring
    return open.map(forward)
  })
  const crop: PointCloudCrop = {
    ...(polygons.length ? { polygons } : {}),
    ...(choice!.corridorM && road.length >= 2
      ? { corridor: { points: road.map(forward), halfWidthM: choice!.corridorM } }
      : {}),
    ...(choice!.upslopeMarginM ? { upslopeMarginM: choice!.upslopeMarginM } : {}),
  }
  return validateCrop(crop) ?? undefined
}

/** What the crop kept, as one sentence for the busy line and the import summary. */
export function describeCrop(
  report: {
    total: number
    inside: number
    margin: number
    kept: number
    points: number
    areaM2: number
  },
  /** The tiles were read in chunks, keeping only the crop's reach. */
  chunked = false,
): string {
  const count = (n: number) => n.toLocaleString('en-CA')
  return (
    `Crop kept ${count(report.kept)} of ${count(report.total)} ${chunked ? "points read within the crop's reach" : 'decoded points'}` +
    (report.margin ? ` (${count(report.inside)} inside, ${count(report.margin)} in the upslope margin)` : '') +
    ` over ${(report.areaM2 / 10_000).toFixed(1)} ha` +
    (report.points < report.kept ? `, thinned to ${count(report.points)} for the surface` : '') +
    (chunked
      ? ". Each tile was read chunk by chunk and only points within the crop's reach were kept."
      : '. The whole tile was still read.')
  )
}

/**
 * The outer rings of a file's polygons (WGS84), for a crop area. Holes are left out and counted:
 * the crop keeps what is inside a ring. Lines and points are not areas and are counted, never
 * closed into one.
 */
export function cropAreasFromFeatures(features: ReadonlyArray<{ geometry: unknown }>): {
  areas: Array<Array<[number, number]>>
  holes: number
  skipped: number
} {
  const areas: Array<Array<[number, number]>> = []
  let holes = 0,
    skipped = 0
  const take = (polygon: unknown) => {
    const rings = polygon as Array<Array<number[]>>
    if (!Array.isArray(rings) || !rings.length) return
    areas.push(rings[0].map((p) => [p[0], p[1]] as [number, number]))
    holes += rings.length - 1
  }
  for (const { geometry } of features) {
    const g = geometry as { type?: string; coordinates?: unknown } | null
    if (g?.type === 'Polygon') take(g.coordinates)
    else if (g?.type === 'MultiPolygon') for (const polygon of g.coordinates as unknown[]) take(polygon)
    else skipped++
  }
  return { areas, holes, skipped }
}

const ringArea = (ring: ReadonlyArray<readonly [number, number]>) =>
  ring.slice(1).reduce((s, p, k) => s + (ring[k][0] * p[1] - p[0] * ring[k][1]) / 2, 0)

/**
 * A footprint's rings as MultiPolygon coordinates: each anticlockwise ring an outer boundary, each
 * clockwise ring a hole in the smallest outer ring holding it, so a map fills what was kept.
 */
export function footprintPolygons(rings: CropFootprint['rings']): Array<Array<Array<[number, number]>>> {
  const outers = rings.filter((r) => ringArea(r) > 0).sort((a, b) => ringArea(a) - ringArea(b))
  const polygons = outers.map((r) => [r])
  for (const hole of rings.filter((r) => ringArea(r) < 0)) {
    // A hole's corner lies on its outer ring's grid, never on that ring: test the midpoint of its first edge.
    const x = (hole[0][0] + hole[1][0]) / 2,
      y = (hole[0][1] + hole[1][1]) / 2
    const k = outers.findIndex((outer) => inRing(x, y, outer))
    if (k >= 0) polygons[k].push(hole)
  }
  return polygons
}

/** A source tile as its header states it, and whether the crop's reach touches it. */
export interface CropTile {
  name: string
  /** The header's horizontal extent in the cloud's CRS: [minX, minY, maxX, maxY]. */
  box: [number, number, number, number]
  points: number
  touches: boolean
}

/**
 * Which tiles the crop reaches, from their headers alone: no point is read to decide it. A tile
 * whose stated extent misses the crop's box grown by its reach (`cropReachM`) is never read.
 */
export function cropTiles(
  headers: ReadonlyArray<{ name: string; min: readonly number[]; max: readonly number[]; points: number }>,
  crop: PointCloudCrop,
): CropTile[] {
  const [x0, y0, x1, y1] = cropRegionBox(crop, cropReachM(crop))
  return headers.map((h) => {
    const box: CropTile['box'] = [h.min[0], h.min[1], h.max[0], h.max[1]]
    return {
      name: h.name,
      box,
      points: h.points,
      touches: box[0] <= x1 && box[2] >= x0 && box[1] <= y1 && box[3] >= y0,
    }
  })
}

/** The part of a tile the reader needs: its extent within the crop's reach. */
export function cropReadBox(tile: CropTile, crop: PointCloudCrop): [number, number, number, number] {
  const [x0, y0, x1, y1] = cropRegionBox(crop, cropReachM(crop))
  return [Math.max(x0, tile.box[0]), Math.max(y0, tile.box[1]), Math.min(x1, tile.box[2]), Math.min(y1, tile.box[3])]
}

/** A box as a closed ring with `steps` points an edge, so a projected outline follows its curvature. */
export function boxRing(
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  steps = 8,
): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    for (let k = 0; k < steps; k++) ring.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps])
  }
  edge(x0, y0, x1, y0)
  edge(x1, y0, x1, y1)
  edge(x1, y1, x0, y1)
  edge(x0, y1, x0, y0)
  ring.push(ring[0])
  return ring
}
