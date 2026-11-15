import type { TerrainVertex } from './terrainMesh'

/**
 * Hidden-surface test for the 3D preview's road overlays.
 *
 * The ground paints on a canvas and the road, batters and ditches draw over it, so without a test the
 * road showed through every ridge in front of it. The display mesh is never excavated, though: over a
 * cut, the drawn ground lies above the formation and its batters. So the depth test runs against the
 * ground as the road leaves it (`excavatedGround`), rasterized into a depth buffer (`occlusionTest`).
 * Faces wholly behind it are left out, and the ground in front of the rest is drawn again over them
 * (`cover`), so a strip half behind a crest is cut at the crest rather than drawn whole.
 */

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
}

/** Depth-buffer cell, in screen pixels. */
export const OCCLUSION_CELL_PX = 2

type Box = [number, number, number, number]

const boxOf = (vertices: TerrainVertex[]): Box => {
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
  return [minX, minY, maxX, maxY]
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

const nearPolygon = (x: number, y: number, polygon: TerrainVertex[], reach: number) => {
  if (inside(x, y, polygon)) return true
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
    if (pointSegment(x, y, polygon[j], polygon[i]) <= reach) return true
  return false
}

/** The height of a face (fanned from its first vertex) at a plan point, or null when the point is outside it. */
export function faceHeightAt(x: number, y: number, face: TerrainVertex[]): number | null {
  const a = face[0]
  for (let i = 1; i + 1 < face.length; i++) {
    const b = face[i],
      c = face[i + 1]
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(area) < 1e-12) continue
    const wa = ((b.x - x) * (c.y - y) - (b.y - y) * (c.x - x)) / area
    const wb = ((c.x - x) * (a.y - y) - (c.y - y) * (a.x - x)) / area
    const wc = 1 - wa - wb
    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return wa * a.z + wb * b.z + wc * c.z
  }
  return null
}

/**
 * The ground as the road leaves it, for the depth test: the display mesh is never excavated, so over a
 * cut it lies above the formation and batters it should expose. A ground face wholly inside the road's
 * footprint (formation and batters) is left out, because the footprint's own faces replace it; a face
 * across the footprint's edge keeps its outside corners and lowers its inside ones to the design
 * surface. Since a cut batter runs from its catch point down, that face then lies at or under the
 * batter rather than across it. Ground beside the road, however close, stays whole.
 *
 * A corner within `reach` of a footprint face but not over one (in a seam between batter faces, or
 * under a face too twisted to fan) takes that face's lowest corner: lowering too far only lets a
 * little more through a cut, while a corner left standing over the cut covers the road in specks.
 */
export function excavatedGround(ground: TerrainVertex[][], footprint: TerrainVertex[][], reach = 0): TerrainVertex[][] {
  if (!footprint.length) return ground
  const boxes = footprint.map((face) => {
    const [minX, minY, maxX, maxY] = boxOf(face)
    return [minX - reach, minY - reach, maxX + reach, maxY + reach] as Box
  })
  let span = 0
  for (const box of boxes) span = Math.max(span, box[2] - box[0], box[3] - box[1])
  const bucket = Math.max(span, 5)
  const buckets = new Map<number, number[]>()
  // Integer keys; a window is at most a few kilometres, far inside 2^20 buckets a side.
  const key = (column: number, row: number) => (column + 524288) * 1048576 + (row + 524288)
  boxes.forEach((box, index) => {
    for (let column = Math.floor(box[0] / bucket); column <= Math.floor(box[2] / bucket); column++)
      for (let row = Math.floor(box[1] / bucket); row <= Math.floor(box[3] / bucket); row++) {
        const list = buckets.get(key(column, row))
        if (list) list.push(index)
        else buckets.set(key(column, row), [index])
      }
  })
  const designCache = new Map<TerrainVertex, number | null>()
  /** The lowest design height over a plan point, or null off the footprint. */
  const designAt = (vertex: TerrainVertex) => {
    if (designCache.has(vertex)) return designCache.get(vertex)!
    let lowest: number | null = null
    for (const index of buckets.get(key(Math.floor(vertex.x / bucket), Math.floor(vertex.y / bucket))) ?? []) {
      const box = boxes[index]
      if (vertex.x < box[0] || vertex.x > box[2] || vertex.y < box[1] || vertex.y > box[3]) continue
      const face = footprint[index]
      const z =
        faceHeightAt(vertex.x, vertex.y, face) ??
        (nearPolygon(vertex.x, vertex.y, face, reach) ? Math.min(...face.map((v) => v.z)) : null)
      if (z !== null && (lowest === null || z < lowest)) lowest = z
    }
    designCache.set(vertex, lowest)
    return lowest
  }
  const result: TerrainVertex[][] = []
  for (const face of ground) {
    const design = face.map(designAt)
    const covered = design.filter((z) => z !== null).length
    if (!covered) result.push(face)
    else if (covered < face.length)
      result.push(face.map((v, i) => (design[i] === null ? v : { ...v, z: Math.min(v.z, design[i]!) })))
  }
  return result
}

/** Cells of the overlay layer the ground in front hides: alpha 255 where the ground covers it. */
export interface OcclusionCover {
  columns: number
  rows: number
  cell: number
  alpha: Uint8ClampedArray
}

/**
 * A depth buffer of `ground` as drawn by `project`. Depth grows away from the eye. `visible` says
 * whether any of a set of projected points (or their centroid) is in front of the ground; a point off
 * the buffer, or over no ground, is visible. `cover` marks the cells where the nearest of a set of
 * overlay faces is behind the ground, so the ground can be drawn back over them. `tolerance` (camera
 * depth units) absorbs the buffer's coarse cells and its linear depth interpolation.
 */
export function occlusionTest({
  ground,
  project,
  width,
  height,
  tolerance,
  cell = OCCLUSION_CELL_PX,
}: {
  ground: TerrainVertex[][]
  project: (vertex: TerrainVertex) => ProjectedPoint
  width: number
  height: number
  tolerance: number
  cell?: number
}) {
  const columns = Math.max(1, Math.ceil(width / cell)),
    rows = Math.max(1, Math.ceil(height / cell))
  const rasterize = (faces: ProjectedPoint[][]) => {
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
    for (const points of faces) {
      if (points.length < 3) continue
      for (let i = 1; i + 1 < points.length; i++) triangle(points[0], points[i], points[i + 1])
    }
    return buffer
  }
  const buffer = rasterize(ground.map((face) => face.map(project)))
  const visiblePoint = (point: ProjectedPoint) => {
    const column = Math.floor(point.x / cell),
      row = Math.floor(point.y / cell)
    if (column < 0 || row < 0 || column >= columns || row >= rows) return true
    return point.depth <= buffer[row * columns + column] + tolerance
  }
  /** True when any point, or the points' centroid, is in front of the ground. */
  const visible = (points: ProjectedPoint[]) => {
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
  /**
   * Cells where the nearest overlay is behind the ground, or null when none is. The overlay is grown
   * by a cell, so a line drawn along a face's edge (a ditch, an unfinished batter) is covered with it.
   */
  const cover = (overlays: ProjectedPoint[][]): OcclusionCover | null => {
    const nearest = rasterize(overlays)
    const alpha = new Uint8ClampedArray(columns * rows)
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        let depth = Infinity
        for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++)
          for (let c = Math.max(0, column - 1); c <= Math.min(columns - 1, column + 1); c++)
            depth = Math.min(depth, nearest[r * columns + c])
        const index = row * columns + column
        if (depth !== Infinity && buffer[index] + tolerance < depth) alpha[index] = 255
      }
    // Open the mask by a cell (shrink, then grow): a speck of ground a cell or two across over the road
    // is the coarse mesh disagreeing with the design surface, not a hill in front of it. Outside the
    // buffer counts as covered, so a cover reaching the edge is not shrunk away from it.
    const grow = (from: Uint8ClampedArray, all: boolean) => {
      const to = new Uint8ClampedArray(from.length)
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          let set = 0,
            seen = 0
          for (let r = row - 1; r <= row + 1; r++)
            for (let c = column - 1; c <= column + 1; c++) {
              seen++
              if (r < 0 || c < 0 || r >= rows || c >= columns ? all : from[r * columns + c]) set++
            }
          if (all ? set === seen : set > 0) to[row * columns + column] = 255
        }
      return to
    }
    const opened = grow(grow(alpha, true), false)
    const any = opened.some((value) => value > 0)
    return any ? { columns, rows, cell, alpha: opened } : null
  }
  return { visible, cover }
}
