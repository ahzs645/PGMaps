/**
 * Display ground with a fine band along the road. Guide: docs/forestry-road-design/3d-view.md.
 *
 * The coarse grid is `terrainMesh`'s own. Inside a band along given plan segments, each coarse cell
 * drawn as measured ground is split into k × k fine cells. Every other cell keeps the faces
 * `terrainMesh` gives it, so the camera fit, the colour range and every gap rule stay where they are.
 * The band is meshed once for a window and never swapped as the camera moves.
 */
import { terrainMeshGrid, type TerrainMeshOptions, type TerrainVertex } from './terrainMesh'
import { preparationExtent } from './preparationFootprint'
import type { TerrainRenderQuality } from './terrainRenderQuality'
import type { RoadStation } from './types'

/** Finest band spacing when the terrain states no source resolution. */
export const BAND_MIN_SPACING_M = 0.5

/** How far past the drawn road and its earthworks the fine band reaches, m. */
export const ROAD_BAND_MARGIN_M = 20

/**
 * Most fine cells the 3D view's band may hold, by render quality. Past this the band is drawn with
 * fewer divisions per coarse cell, so it is coarser but still follows the whole road. Auto is set so
 * one scene rebuild (band, cut and GPU buffers) costs about what one zoom step's re-mesh did before
 * the band: about 100 to 140 ms for the training example's 1.4 km road on 1 m ground.
 */
export const TERRAIN_BAND_MAX_CELLS = {
  auto: 30_000,
  high: 80_000,
  efficient: 15_000,
} as const satisfies Record<TerrainRenderQuality, number>

export interface TerrainBandSegment {
  a: [number, number]
  b: [number, number]
  /** How far to either side of the segment the band reaches, in metres. */
  reachM: number
}

export interface TerrainBandOptions extends TerrainMeshOptions {
  /** Plan segments the fine band follows, in the mesh's own metres. */
  segments: TerrainBandSegment[]
  /** The most fine cells the band may hold. The band is made coarser, in whole steps, until it fits. */
  maxCells: number
}

export interface TerrainBandMesh {
  faces: TerrainVertex[][]
  estimatedFaces: TerrainVertex[][]
  infilledCells: number
  openGapCells: number
  /** Coarse grid levels only, exactly as `terrainMesh` reports them. */
  elevations: number[]
  /** Coarse grid spacing. */
  spacing: number
  /** `terrainMesh`'s own measured faces, with no band: the same ground drawn coarse. */
  coarseFaces: TerrainVertex[][]
  /** Fine spacing inside the band, or null when nothing was refined. */
  bandSpacing: number | null
  /** Fine cells per coarse cell side (k), or 0 when nothing was refined. */
  bandDivisions: number
  /** Fine cells drawn. */
  bandCells: number
  /** Coarse cells replaced by fine cells. */
  refinedCells: number
}

/** Squared distance from a point to a segment. */
function pointSegmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const length = dx * dx + dy * dy
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  const ex = ax + t * dx - px,
    ey = ay + t * dy - py
  return ex * ex + ey * ey
}

/** Squared distance from a point to a box; 0 inside it. */
function pointBoxDistanceSq(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const ex = px < x0 ? x0 - px : px > x1 ? px - x1 : 0
  const ey = py < y0 ? y0 - py : py > y1 ? py - y1 : 0
  return ex * ex + ey * ey
}

/** Whether segment a-b crosses the box, by clipping the segment's parameter range to it. */
function segmentHitsBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let low = 0,
    high = 1
  const dx = bx - ax,
    dy = by - ay
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) low = Math.max(low, r)
      else high = Math.min(high, r)
      if (low > high) return false
    }
  }
  return true
}

/** Distance in plan between a segment and an axis-aligned box. */
export function segmentBoxDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  if (segmentHitsBox(ax, ay, bx, by, x0, y0, x1, y1)) return 0
  // Apart, the nearest pair is an end of the segment against the box, or a box corner against the segment.
  let best = Math.min(pointBoxDistanceSq(ax, ay, x0, y0, x1, y1), pointBoxDistanceSq(bx, by, x0, y0, x1, y1))
  for (const [cx, cy] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ])
    best = Math.min(best, pointSegmentDistanceSq(cx, cy, ax, ay, bx, by))
  return Math.sqrt(best)
}

/**
 * `terrainMesh` with a fine band along the given segments. Outside the band the faces are the very
 * faces `terrainMesh` returns, in the same order. A refined cell's border vertices lie on the
 * straight edge of any drawn neighbour that is not refined, so the band meets the coarse ground
 * without a gap. `elevationAt` is called once per coarse vertex and once per fine vertex of a
 * candidate band cell, never over the band's whole bounding box.
 */
export function terrainBandMesh(
  bounds: number[],
  elevationAt: (x: number, y: number) => number,
  missing: Array<[number, number]>,
  fillSmallGaps = false,
  options: TerrainBandOptions,
): TerrainBandMesh {
  const { mesh, grid } = terrainMeshGrid(bounds, elevationAt, missing, fillSmallGaps, options)
  const { firstColumn, firstRow, columns, rows, spacing, vertices, blocked, infilled } = grid
  const plain = (): TerrainBandMesh => ({
    ...mesh,
    coarseFaces: mesh.faces,
    bandSpacing: null,
    bandDivisions: 0,
    bandCells: 0,
    refinedCells: 0,
  })

  // Candidate cells: inside the band and drawn by `terrainMesh` as measured ground.
  const candidates = new Set<number>()
  const originX = firstColumn * spacing,
    originY = firstRow * spacing
  for (const { a, b, reachM } of options.segments ?? []) {
    if (![a[0], a[1], b[0], b[1], reachM].every(Number.isFinite) || reachM < 0) continue
    const col0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reachM - originX) / spacing) - 1)
    const col1 = Math.min(columns - 1, Math.floor((Math.max(a[0], b[0]) + reachM - originX) / spacing) + 1)
    const row0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reachM - originY) / spacing) - 1)
    const row1 = Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) + reachM - originY) / spacing) + 1)
    for (let row = row0; row <= row1; row++)
      for (let col = col0; col <= col1; col++) {
        const cell = row * columns + col
        if (candidates.has(cell) || blocked.has(cell)) continue
        const x0 = (firstColumn + col) * spacing,
          y0 = (firstRow + row) * spacing
        const x1 = (firstColumn + col + 1) * spacing,
          y1 = (firstRow + row + 1) * spacing
        if (segmentBoxDistance(a[0], a[1], b[0], b[1], x0, y0, x1, y1) <= reachM) candidates.add(cell)
      }
  }
  if (!candidates.size) return plain()

  // k: the source resolution floor first, then the cell budget. Fine lines land on coarse lines.
  const stated = Number.isFinite(options.minSpacing) ? Math.max(0, options.minSpacing!) : 0
  const floor = stated > 0 ? stated : BAND_MIN_SPACING_M
  const budget = Number.isFinite(options.maxCells) || options.maxCells === Infinity ? options.maxCells : 0
  let k = Math.floor(spacing / floor + 1e-9)
  if (budget !== Infinity) k = Math.min(k, Math.floor(Math.sqrt(Math.max(0, budget) / candidates.size)))
  while (k >= 2 && candidates.size * k * k > budget) k--
  if (k < 2) return plain()

  // Fine vertex indices count from the grid's own origin, so a fine line at a multiple of k is a coarse line.
  const fineColumns = columns * k + 1
  const fineX = (fx: number) =>
    fx % k === 0 ? (firstColumn + fx / k) * spacing : ((firstColumn * k + fx) * spacing) / k
  const fineY = (fy: number) => (fy % k === 0 ? (firstRow + fy / k) * spacing : ((firstRow * k + fy) * spacing) / k)
  const samples = new Map<number, number>()
  const sampleAt = (fx: number, fy: number) => {
    const key = fy * fineColumns + fx
    let z = samples.get(key)
    if (z === undefined) {
      z = elevationAt(fineX(fx), fineY(fy))
      samples.set(key, z)
    }
    return z
  }

  // Pass 1: a candidate is refined only when every fine sample in it and on its border is finite.
  const refined = new Set<number>()
  for (const cell of candidates) {
    const row = Math.floor(cell / columns),
      col = cell % columns
    let finite = true
    for (let j = 0; j <= k; j++)
      for (let i = 0; i <= k; i++) {
        // Corners are the coarse grid's own measured vertices.
        if ((i === 0 || i === k) && (j === 0 || j === k)) continue
        if (!Number.isFinite(sampleAt(col * k + i, row * k + j))) finite = false
      }
    if (finite) refined.add(cell)
  }
  if (!refined.size) return plain()

  const drawn = (row: number, col: number) => {
    if (row < 0 || row >= rows || col < 0 || col >= columns) return false
    const cell = row * columns + col
    if (blocked.has(cell) && !infilled.has(cell)) return false
    return !!(vertices[row][col] && vertices[row][col + 1] && vertices[row + 1][col + 1] && vertices[row + 1][col])
  }
  // A side keeps its sampled levels only where no drawn, unrefined neighbour shares it.
  const straightSide = (row: number, col: number) => drawn(row, col) && !refined.has(row * columns + col)

  // Pass 2: fine vertices, shared by object between the cells that meet at them.
  const fineVertices = new Map<number, TerrainVertex>()
  const vertexAt = (row: number, col: number, i: number, j: number): TerrainVertex => {
    if ((i === 0 || i === k) && (j === 0 || j === k)) return vertices[row + j / k][col + i / k]!
    const fx = col * k + i,
      fy = row * k + j
    const key = fy * fineColumns + fx
    const known = fineVertices.get(key)
    if (known) return known
    const x = fineX(fx),
      y = fineY(fy)
    let z = samples.get(key)!
    if (j === 0 || j === k) {
      // A horizontal side, shared with the cell above or below.
      const r = j === 0 ? row - 1 : row + 1
      if (straightSide(r, col)) {
        const line = vertices[row + j / k]
        z = line[col]!.z + ((line[col + 1]!.z - line[col]!.z) * i) / k
      }
    } else if (i === 0 || i === k) {
      // A vertical side, shared with the cell to the left or right.
      const c = i === 0 ? col - 1 : col + 1
      if (straightSide(row, c)) {
        const side = col + i / k
        z = vertices[row][side]!.z + ((vertices[row + 1][side]!.z - vertices[row][side]!.z) * j) / k
      }
    }
    const vertex = { x, y, z }
    fineVertices.set(key, vertex)
    return vertex
  }

  // Same cell order and triangle convention as `terrainMesh`; a refined cell's fine faces take its place.
  const faces: TerrainVertex[][] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const cell = row * columns + col
      if (blocked.has(cell)) continue
      if (refined.has(cell)) {
        for (let j = 0; j < k; j++)
          for (let i = 0; i < k; i++) {
            const a = vertexAt(row, col, i, j),
              b = vertexAt(row, col, i + 1, j),
              c = vertexAt(row, col, i + 1, j + 1),
              d = vertexAt(row, col, i, j + 1)
            faces.push([a, b, c], [a, c, d])
          }
        continue
      }
      const a = vertices[row][col],
        b = vertices[row][col + 1],
        c = vertices[row + 1][col + 1],
        d = vertices[row + 1][col]
      if (a && b && c && d) faces.push([a, b, c], [a, c, d])
    }

  return {
    ...mesh,
    faces,
    coarseFaces: mesh.faces,
    bandSpacing: spacing / k,
    bandDivisions: k,
    bandCells: refined.size * k * k,
    refinedCells: refined.size,
  }
}

const finiteNumber = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/**
 * How far from the centreline one side of a station's drawing reaches, m: the road edge, the catch
 * point, a stripped margin past it, or, where the batter never met the ground, the last section
 * sample with a design level, whichever is farthest.
 */
function drawnHalfWidth(station: RoadStation, sign: -1 | 1) {
  let reach = Math.abs(sign < 0 ? station.leftWidth : station.rightWidth)
  const daylight = sign < 0 ? station.leftDaylightM : station.rightDaylightM
  if (finiteNumber(daylight)) reach = Math.max(reach, Math.abs(daylight))
  else
    for (const point of station.section)
      if (sign * point.offset > 0 && finiteNumber(point.design)) reach = Math.max(reach, Math.abs(point.offset))
  const prepared = preparationExtent(station, sign)
  if (prepared !== null) reach = Math.max(reach, Math.abs(prepared))
  return Number.isFinite(reach) ? reach : 0
}

/**
 * The fine band's segments for a road: its centreline between consecutive stations, each reaching
 * the wider of its two stations' drawn half-widths on either side plus `marginM`.
 */
export function roadBandSegments(
  stations: readonly RoadStation[],
  point: (station: RoadStation) => [number, number],
  marginM = ROAD_BAND_MARGIN_M,
): TerrainBandSegment[] {
  const half = stations.map((station) => Math.max(drawnHalfWidth(station, -1), drawnHalfWidth(station, 1)))
  const points = stations.map(point)
  const segments: TerrainBandSegment[] = []
  for (let i = 1; i < stations.length; i++)
    segments.push({ a: points[i - 1], b: points[i], reachM: Math.max(half[i - 1], half[i]) + marginM })
  return segments
}
