/** Cell-exact D8 catchments. No DOM, network, or rendered-map elevations. */
import { downstream, MISSING } from './hydrology'
import { cellCentre, cellIndexAt, type SurfaceGrid, type ToLonLat } from './surfaceGrid'
import type { Coordinate } from './types'

export const MAX_CATCHMENT_CELLS = 4_194_304
export const MAX_CATCHMENT_BOUNDARY_EDGES = 200_000
export const MAX_WATERSHEDS = 1_000
export type DrainageGrid = Pick<SurfaceGrid, 'origin' | 'cellM' | 'width' | 'height'>
export interface CatchmentProperties {
  id: string
  role: 'catchment' | 'watershed'
  surface: 'existing' | 'design'
  cells: number
  areaHa: number
  outlet: Coordinate
  touchesGridEdge: boolean
  touchesNoData: boolean
  /** A raster boundary/no-data contact means the contributing area may extend outside measured support. */
  truncated: boolean
}
export type CatchmentFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CatchmentProperties>
export interface PourPoint {
  coordinate: Coordinate
  snapRadiusM: number
  surface: 'existing' | 'design'
}
export interface CatchmentResult {
  requestedCoordinate: Coordinate
  snappedCoordinate: Coordinate
  snappedDistanceM: number
  outletCell: number
  feature: CatchmentFeature
}

function validateGrid(grid: DrainageGrid, dirs: Int8Array) {
  const n = grid.width * grid.height
  if (
    !Number.isInteger(grid.width) ||
    !Number.isInteger(grid.height) ||
    grid.width < 1 ||
    grid.height < 1 ||
    n > MAX_CATCHMENT_CELLS ||
    dirs.length !== n ||
    !(grid.cellM > 0) ||
    !Number.isFinite(grid.cellM) ||
    !grid.origin.every(Number.isFinite)
  )
    throw Error('Catchment grid is invalid or exceeds 4,194,304 cells.')
  return n
}

/** Snap to greatest contributing area inside a metric circle; equal areas prefer nearest, then cell ID. */
export function snapPourPoint(
  grid: DrainageGrid,
  directions: Int8Array,
  accumulation: Float64Array,
  xy: [number, number],
  radiusM: number,
): { cell: number; distanceM: number } {
  const n = validateGrid(grid, directions)
  if (
    accumulation.length !== n ||
    !xy.every(Number.isFinite) ||
    !Number.isFinite(radiusM) ||
    radiusM < 0 ||
    radiusM > 2_000
  )
    throw Error('Choose a finite pour point and a snap radius from 0 to 2,000 m.')
  const containing = cellIndexAt(grid as SurfaceGrid, ...xy)
  if (!radiusM) {
    if (containing < 0 || directions[containing] === MISSING)
      throw Error('The pour point has no sampled terrain. Select a supported point or increase the snap radius.')
    const centre = cellCentre(grid as SurfaceGrid, containing)
    return { cell: containing, distanceM: Math.hypot(centre[0] - xy[0], centre[1] - xy[1]) }
  }
  const col0 = Math.max(0, Math.ceil((xy[0] - radiusM - grid.origin[0]) / grid.cellM))
  const col1 = Math.min(grid.width - 1, Math.floor((xy[0] + radiusM - grid.origin[0]) / grid.cellM))
  const row0 = Math.max(0, Math.ceil((grid.origin[1] - xy[1] - radiusM) / grid.cellM))
  const row1 = Math.min(grid.height - 1, Math.floor((grid.origin[1] - xy[1] + radiusM) / grid.cellM))
  let cell = -1,
    bestArea = -Infinity,
    distanceM = Infinity
  for (let row = row0; row <= row1; row++)
    for (let col = col0; col <= col1; col++) {
      const i = row * grid.width + col
      if (directions[i] === MISSING || !Number.isFinite(accumulation[i])) continue
      const d = Math.hypot(grid.origin[0] + col * grid.cellM - xy[0], grid.origin[1] - row * grid.cellM - xy[1])
      if (d > radiusM + 1e-9) continue
      if (
        accumulation[i] > bestArea ||
        (accumulation[i] === bestArea && (d < distanceM || (d === distanceM && i < cell)))
      ) {
        cell = i
        bestArea = accumulation[i]
        distanceM = d
      }
    }
  if (cell < 0) throw Error('No supported flow cell lies within the pour-point snap radius.')
  return { cell, distanceM }
}

/** Exactly the cells whose D8 paths pass through outletCell, including that cell. */
export function upstreamMask(grid: DrainageGrid, dirs: Int8Array, outletCell: number): Uint8Array {
  const n = validateGrid(grid, dirs)
  if (!Number.isInteger(outletCell) || outletCell < 0 || outletCell >= n || dirs[outletCell] === MISSING)
    throw Error('Choose a supported outlet cell inside the drainage grid.')
  const mask = new Uint8Array(n),
    queue = new Int32Array(n)
  mask[outletCell] = 1
  queue[0] = outletCell
  let head = 0,
    tail = 1
  while (head < tail) {
    const i = queue[head++],
      row = Math.floor(i / grid.width),
      col = i % grid.width
    for (let r = Math.max(0, row - 1); r <= Math.min(grid.height - 1, row + 1); r++)
      for (let c = Math.max(0, col - 1); c <= Math.min(grid.width - 1, col + 1); c++) {
        const j = r * grid.width + c
        if (!mask[j] && dirs[j] >= 0 && downstream(dirs, grid.width, j) === i) {
          mask[j] = 1
          queue[tail++] = j
        }
      }
  }
  return mask
}

type Vertex = [number, number]
const signedArea = (ring: Vertex[]) =>
  ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2
function contains(ring: Vertex[], point: Vertex) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

/** Exact union of occupied raster cells, retaining holes and separate components at diagonal touches. */
export function catchmentPolygon(
  grid: DrainageGrid,
  dirs: Int8Array,
  mask: Uint8Array,
  outletCell: number,
  toLonLat: ToLonLat,
  {
    id = 'catchment',
    role = 'catchment',
    surface = 'design',
    cells,
  }: Partial<Pick<CatchmentProperties, 'id' | 'role' | 'surface'>> & { cells?: number[] } = {},
): CatchmentFeature {
  const n = validateGrid(grid, dirs)
  if (mask.length !== n) throw Error('Catchment cells do not match the drainage grid.')
  const stride = grid.width + 1
  const edges = new Map<number, { end: number; dir: number }[]>()
  let count = 0,
    edgeCount = 0,
    touchesGridEdge = false,
    touchesNoData = false
  const edge = (x0: number, y0: number, x1: number, y1: number, dir: number) => {
    if (++edgeCount > MAX_CATCHMENT_BOUNDARY_EDGES)
      throw Error(
        'Catchment boundaries exceed 200,000 edges. Use a coarser drainage grid or a smaller analysis extent.',
      )
    const start = y0 * stride + x0,
      list = edges.get(start) ?? []
    list.push({ end: y1 * stride + x1, dir })
    edges.set(start, list)
  }
  const selected = cells ?? mask.keys()
  for (const i of selected)
    if (mask[i]) {
      if (dirs[i] === MISSING) throw Error('A catchment cannot include missing terrain.')
      count++
      const r = Math.floor(i / grid.width),
        c = i % grid.width
      if (!r || !c || r === grid.height - 1 || c === grid.width - 1) touchesGridEdge = true
      for (let rr = Math.max(0, r - 1); rr <= Math.min(grid.height - 1, r + 1); rr++)
        for (let cc = Math.max(0, c - 1); cc <= Math.min(grid.width - 1, c + 1); cc++)
          if (dirs[rr * grid.width + cc] === MISSING) touchesNoData = true
      if (!r || !mask[i - grid.width]) edge(c, r, c + 1, r, 0)
      if (c === grid.width - 1 || !mask[i + 1]) edge(c + 1, r, c + 1, r + 1, 1)
      if (r === grid.height - 1 || !mask[i + grid.width]) edge(c + 1, r + 1, c, r + 1, 2)
      if (!c || !mask[i - 1]) edge(c, r + 1, c, r, 3)
    }
  if (!count) throw Error('The catchment has no supported cells.')
  const rings: Vertex[][] = []
  while (edges.size) {
    const start = edges.keys().next().value as number
    let at = start,
      incoming = -1
    const ring: Vertex[] = []
    do {
      ring.push([at % stride, Math.floor(at / stride)])
      const choices = edges.get(at)
      if (!choices?.length) throw Error('Catchment boundary is open.')
      const turnRank = (dir: number) => (incoming < 0 ? dir : [1, 0, 3, 2][(dir - incoming + 4) % 4])
      choices.sort((a, b) => turnRank(a.dir) - turnRank(b.dir))
      const next = choices.shift()!
      if (!choices.length) edges.delete(at)
      at = next.end
      incoming = next.dir
      if (ring.length > MAX_CATCHMENT_BOUNDARY_EDGES) throw Error('Catchment boundary exceeded its traversal budget.')
    } while (at !== start)
    const corners = ring.filter((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length],
        b = ring[(i + 1) % ring.length]
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0])
    })
    corners.push(corners[0])
    rings.push(corners)
  }
  const polygons = rings.filter((r) => signedArea(r) > 0).map((r) => [r])
  for (const hole of rings.filter((r) => signedArea(r) < 0)) {
    const parent = polygons.find((p) => contains(p[0], hole[0]))
    if (!parent) throw Error('Catchment hole has no exterior boundary.')
    parent.push(hole)
  }
  const coordinates = polygons.map((p) =>
    p.map((r) =>
      r
        .map(([c, row]) =>
          toLonLat([grid.origin[0] + (c - 0.5) * grid.cellM, grid.origin[1] - (row - 0.5) * grid.cellM]),
        )
        .reverse(),
    ),
  )
  return {
    type: 'Feature',
    properties: {
      id,
      role,
      surface,
      cells: count,
      areaHa: (count * grid.cellM ** 2) / 10_000,
      outlet: toLonLat(cellCentre(grid as SurfaceGrid, outletCell)),
      touchesGridEdge,
      touchesNoData,
      truncated: touchesGridEdge || touchesNoData,
    },
    geometry:
      coordinates.length === 1
        ? { type: 'Polygon', coordinates: coordinates[0] }
        : { type: 'MultiPolygon', coordinates },
  }
}

export function delineateCatchment(
  grid: DrainageGrid,
  dirs: Int8Array,
  accumulation: Float64Array,
  point: PourPoint,
  toGrid: (coordinate: Coordinate) => [number, number],
  toLonLat: ToLonLat,
): CatchmentResult {
  const snapped = snapPourPoint(grid, dirs, accumulation, toGrid(point.coordinate), point.snapRadiusM)
  const feature = catchmentPolygon(grid, dirs, upstreamMask(grid, dirs, snapped.cell), snapped.cell, toLonLat, {
    surface: point.surface,
  })
  return {
    requestedCoordinate: [...point.coordinate],
    snappedCoordinate: feature.properties.outlet,
    snappedDistanceM: snapped.distanceM,
    outletCell: snapped.cell,
    feature,
  }
}

/** Assign every supported cell to its terminal D8 outlet, then polygonize qualifying nonoverlapping basins. */
export function delineateWatersheds(
  grid: DrainageGrid,
  dirs: Int8Array,
  toLonLat: ToLonLat,
  { minAreaHa = 0.4, surface = 'design' }: { minAreaHa?: number; surface?: PourPoint['surface'] } = {},
): GeoJSON.FeatureCollection<CatchmentFeature['geometry'], CatchmentProperties> {
  const n = validateGrid(grid, dirs)
  if (!Number.isFinite(minAreaHa) || minAreaHa < 0 || minAreaHa > 100_000)
    throw Error('Minimum watershed area must be between 0 and 100,000 ha.')
  const labels = new Int32Array(n).fill(-1),
    path: number[] = [],
    counts = new Map<number, number>()
  for (let start = 0; start < n; start++) {
    if (dirs[start] === MISSING || labels[start] >= 0) continue
    path.length = 0
    let i = start,
      outlet = -1
    while (labels[i] < 0 && dirs[i] !== MISSING) {
      if (labels[i] === -2) throw Error('The supplied D8 grid contains a cycle.')
      labels[i] = -2
      path.push(i)
      const j = downstream(dirs, grid.width, i)
      if (j < 0) {
        outlet = i
        break
      }
      if (j >= n || dirs[j] === MISSING) throw Error('D8 flow points outside supported terrain.')
      i = j
    }
    if (outlet < 0) outlet = labels[i]
    if (outlet < 0) throw Error('D8 flow did not reach a supported outlet.')
    for (const p of path) labels[p] = outlet
    counts.set(outlet, (counts.get(outlet) ?? 0) + path.length)
  }
  // Counts above include newly traversed paths only, with every supported cell visited once.
  const outlets = [...counts].filter(([, count]) => (count * grid.cellM ** 2) / 10_000 >= minAreaHa)
  if (outlets.length > MAX_WATERSHEDS)
    throw Error('More than 1,000 watersheds meet the threshold. Increase the minimum watershed area.')
  const cells = new Map(outlets.map(([outlet]) => [outlet, [] as number[]]))
  for (let i = 0; i < n; i++) cells.get(labels[i])?.push(i)
  // Reuse one byte mask, rather than retaining one full raster per basin.
  const mask = new Uint8Array(n)
  const features: CatchmentFeature[] = []
  let totalEdges = 0
  for (const [outlet] of outlets) {
    const selected = cells.get(outlet)!
    for (const i of selected) mask[i] = 1
    const feature = catchmentPolygon(grid, dirs, mask, outlet, toLonLat, {
      id: `watershed-${outlet}`,
      role: 'watershed',
      surface,
      cells: selected,
    })
    for (const i of selected) mask[i] = 0
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    totalEdges += polygons.reduce((sum, p) => sum + p.reduce((s, ring) => s + ring.length, 0), 0)
    if (totalEdges > MAX_CATCHMENT_BOUNDARY_EDGES)
      throw Error(
        'Combined watershed boundaries exceed 200,000 vertices. Increase the minimum area or use coarser terrain.',
      )
    features.push(feature)
  }
  return { type: 'FeatureCollection', features }
}
