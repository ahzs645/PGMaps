import type { TerrainVertex } from './terrainMesh'

/**
 * Hidden-surface test for the 3D preview's road overlays.
 *
 * The ground paints on a canvas and the road, batters and ditches draw over it, so without a test the
 * road showed through every ridge in front of it. The display mesh is never excavated, though: over a
 * cut, the drawn ground lies above the formation and its batters. So the ground on and beside the
 * road's footprint never hides anything (`groundNearFootprint`), and the rest of the ground is
 * rasterized into a coarse depth buffer (`occlusionTest`) that each overlay is tested against.
 */

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
}

/** Depth-buffer cell, in screen pixels. */
export const OCCLUSION_CELL_PX = 2

type Box = [number, number, number, number]

const boxOf = (vertices: TerrainVertex[], margin = 0): Box => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const v of vertices) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  return [minX - margin, minY - margin, maxX + margin, maxY + margin]
}

const inside = (x: number, y: number, polygon: TerrainVertex[]) => {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result
  }
  return result
}

const pointSegment = (px: number, py: number, a: TerrainVertex, b: TerrainVertex) => {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length)) : 0
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

const cross = (a: TerrainVertex, b: TerrainVertex, c: TerrainVertex) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentDistance = (a: TerrainVertex, b: TerrainVertex, c: TerrainVertex, d: TerrainVertex) => {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(
    pointSegment(a.x, a.y, c, d),
    pointSegment(b.x, b.y, c, d),
    pointSegment(c.x, c.y, a, b),
    pointSegment(d.x, d.y, a, b),
  )
}

/** True when two plan polygons overlap or come within `margin` of each other. */
export function polygonsNear(a: TerrainVertex[], b: TerrainVertex[], margin: number) {
  if (a.some((v) => inside(v.x, v.y, b)) || b.some((v) => inside(v.x, v.y, a))) return true
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]) < margin) return true
  return false
}

/**
 * Indices of the ground faces that overlap the road's footprint (formation and batters) in plan, or
 * lie within `margin` of it. The display mesh is not excavated, so these faces cover the cut they sit
 * over; they are left out of the depth buffer.
 */
export function groundNearFootprint(ground: TerrainVertex[][], footprint: TerrainVertex[][], margin: number) {
  const near = new Set<number>()
  if (!footprint.length || !ground.length) return near
  const bucket = Math.max(4 * margin, 10)
  const buckets = new Map<number, number[]>()
  // Integer keys; a window is at most a few kilometres, far inside 2^20 buckets a side.
  const key = (column: number, row: number) => (column + 524288) * 1048576 + (row + 524288)
  const boxes = footprint.map((face) => boxOf(face, margin))
  boxes.forEach((box, index) => {
    for (let column = Math.floor(box[0] / bucket); column <= Math.floor(box[2] / bucket); column++)
      for (let row = Math.floor(box[1] / bucket); row <= Math.floor(box[3] / bucket); row++) {
        const list = buckets.get(key(column, row))
        if (list) list.push(index)
        else buckets.set(key(column, row), [index])
      }
  })
  ground.forEach((face, index) => {
    const box = boxOf(face)
    const tried = new Set<number>()
    for (let column = Math.floor(box[0] / bucket); column <= Math.floor(box[2] / bucket); column++)
      for (let row = Math.floor(box[1] / bucket); row <= Math.floor(box[3] / bucket); row++)
        for (const candidate of buckets.get(key(column, row)) ?? []) {
          if (tried.has(candidate)) continue
          tried.add(candidate)
          const other = boxes[candidate]
          if (box[2] < other[0] || box[0] > other[2] || box[3] < other[1] || box[1] > other[3]) continue
          if (polygonsNear(face, footprint[candidate], margin)) {
            near.add(index)
            return
          }
        }
  })
  return near
}

/**
 * A depth buffer of the ground faces not in `skip`, as drawn by `project`, and a test of whether any
 * of a set of projected points is in front of it. Depth grows away from the eye. A point off the
 * buffer, or over no ground, is visible. `tolerance` (camera depth units) absorbs the buffer's
 * coarse cells and its linear depth interpolation.
 */
export function occlusionTest({
  ground,
  skip,
  project,
  width,
  height,
  tolerance,
  cell = OCCLUSION_CELL_PX,
}: {
  ground: TerrainVertex[][]
  skip: Set<number>
  project: (vertex: TerrainVertex) => ProjectedPoint
  width: number
  height: number
  tolerance: number
  cell?: number
}) {
  const columns = Math.max(1, Math.ceil(width / cell)),
    rows = Math.max(1, Math.ceil(height / cell))
  const buffer = new Float32Array(columns * rows).fill(Infinity)
  const write = (column: number, row: number, depth: number) => {
    if (column < 0 || row < 0 || column >= columns || row >= rows) return
    const index = row * columns + column
    if (depth < buffer[index]) buffer[index] = depth
  }
  const triangle = (a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint) => {
    const ax = a.x / cell,
      ay = a.y / cell,
      bx = b.x / cell,
      by = b.y / cell,
      cx = c.x / cell,
      cy = c.y / cell
    // A triangle smaller than a cell can miss every cell centre; its corners still mark their cells.
    write(Math.floor(ax), Math.floor(ay), a.depth)
    write(Math.floor(bx), Math.floor(by), b.depth)
    write(Math.floor(cx), Math.floor(cy), c.depth)
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(area) < 1e-9) return
    const minColumn = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      maxColumn = Math.min(columns - 1, Math.ceil(Math.max(ax, bx, cx))),
      minRow = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      maxRow = Math.min(rows - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let row = minRow; row <= maxRow; row++) {
      const py = row + 0.5
      for (let column = minColumn; column <= maxColumn; column++) {
        const px = column + 0.5
        const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
        const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
        const wc = 1 - wa - wb
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue
        write(column, row, wa * a.depth + wb * b.depth + wc * c.depth)
      }
    }
  }
  ground.forEach((face, index) => {
    if (skip.has(index) || face.length < 3) return
    const points = face.map(project)
    for (let i = 1; i + 1 < points.length; i++) triangle(points[0], points[i], points[i + 1])
  })
  const visiblePoint = (point: ProjectedPoint) => {
    const column = Math.floor(point.x / cell),
      row = Math.floor(point.y / cell)
    if (column < 0 || row < 0 || column >= columns || row >= rows) return true
    return point.depth <= buffer[row * columns + column] + tolerance
  }
  /** True when any point, or the points' centroid, is in front of the ground. */
  return (points: ProjectedPoint[]) => {
    if (!points.length) return false
    let x = 0,
      y = 0,
      depth = 0
    for (const point of points) {
      if (visiblePoint(point)) return true
      x += point.x
      y += point.y
      depth += point.depth
    }
    return visiblePoint({ x: x / points.length, y: y / points.length, depth: depth / points.length })
  }
}
