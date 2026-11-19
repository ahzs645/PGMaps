/**
 * The road preview's GPU geometry, in one local frame in the terrain's export CRS. Design faces are
 * the LandXML faces, never triangulated again. Cutting their footprint out of the display ground
 * changes only the drawing: it neither fills source gaps nor changes the analytical terrain.
 *
 * Pure: no DOM or network access. Coordinates and elevations stay in metres; exaggeration belongs
 * to the renderer. An unavailable design is a result, so an invalid edit cannot empty the viewer.
 */
import { designSurface, type DesignSurfaceGap, type DesignSurfaceKind } from './designSurfaceExport'
import { invalidInputNotice } from './inputErrors'
import { exportGrid } from './terrain'
import type { TerrainVertex } from './terrainMesh'
import type { Alignment, Coordinate, RoadAnalysis, TerrainMetadata } from './types'

/** Drawing budgets, separate from the source terrain and design/export limits. */
export const MAX_TERRAIN_SCENE_FOOTPRINT_TRIANGLES = 250_000
export const MAX_TERRAIN_SCENE_INDEX_ENTRIES = 2_000_000
export const MAX_TERRAIN_SCENE_CLIP_TESTS = 4_000_000
/**
 * Pieces one ground face may be cut into. Only a guard against one face exploding: the clip tests and the clipped faces
 * above bound the whole cut. 256 refused the training road at Efficient quality (128 samples a side, about 11 m faces,
 * each crossed by the finished surface's many narrow triangles) and sent it to the canvas preview.
 */
export const MAX_TERRAIN_SCENE_CLIP_PIECES = 2_048
export const MAX_TERRAIN_SCENE_CLIPPED_FACES = 1_000_000
const INDEX_SIDE = 128
const EDGE_EPS_M = 1e-7
const AREA_EPS_M2 = 1e-9

export interface TerrainSceneFrame {
  epsg: number
  /** Grid easting/northing removed before uploading positions to the GPU. Elevations stay absolute. */
  origin: [number, number]
  verticalReference: string
  point: (coordinate: Coordinate) => [number, number]
  coordinate: (x: number, y: number) => Coordinate
}

/** A fixed frame shared by terrain, exact design surfaces, structures, camera and picking. */
export function terrainSceneFrame(metadata: TerrainMetadata, at: Coordinate): TerrainSceneFrame {
  const grid = exportGrid(metadata, at)
  const origin = grid.toGrid(at)
  return {
    epsg: grid.epsg,
    origin,
    verticalReference: metadata.verticalReference,
    point: (coordinate) => {
      const [easting, northing] = grid.toGrid(coordinate)
      return [easting - origin[0], northing - origin[1]]
    },
    coordinate: (x, y) => grid.toLonLat([x + origin[0], y + origin[1]]),
  }
}

export interface TerrainScenePiece {
  /** Index-buffer entries, not triangle numbers. */
  firstIndex: number
  indexCount: number
  /** Source chainages, without display station equations. */
  from: number
  to: number
  folded: number
}

export interface TerrainSceneGeometry {
  kind: DesignSurfaceKind
  status: 'ready' | 'partial' | 'unavailable'
  reason?: string
  notice: string
  /** Local grid easting/northing and absolute source elevation, one xyz per vertex. */
  positions: Float32Array
  indices: Uint32Array
  pieces: TerrainScenePiece[]
  /** Exact double-precision design triangles for removing only their footprint from the ground. */
  footprint: TerrainVertex[][]
  gaps: DesignSurfaceGap[]
  /** Valid design bounds [west, south, low, east, north, high], or null with no design. */
  bounds: [number, number, number, number, number, number] | null
}

/**
 * One surface at a time: finished and subgrade coincide outside the formation, so drawing both
 * opaque would fight for depth. Piece ranges remain available for station picking and notices.
 */
export function terrainSceneGeometry({
  kind,
  alignment,
  analysis,
  frame,
}: {
  kind: DesignSurfaceKind
  alignment: Alignment
  analysis: RoadAnalysis
  frame: TerrainSceneFrame
}): TerrainSceneGeometry {
  const unavailable = (reason: string, gaps: DesignSurfaceGap[] = []): TerrainSceneGeometry => ({
    kind,
    status: 'unavailable',
    reason,
    notice: reason,
    positions: new Float32Array(),
    indices: new Uint32Array(),
    pieces: [],
    footprint: [],
    gaps,
    bounds: null,
  })
  if (analysis.invalidInput)
    return unavailable(
      `The design surface is unavailable while an input is invalid. ${invalidInputNotice(analysis.invalidInput)}`,
    )

  try {
    // A translation of the export grid changes neither its faces nor its distances. Keeping it in
    // doubles here, before the GPU arrays, also avoids clipping with rounded large grid coordinates.
    const surface = designSurface(kind, alignment, analysis, frame.point)
    const faceCount = surface.pieces.reduce((sum, piece) => sum + piece.faces.length, 0)
    if (!faceCount)
      return unavailable('No design surface: at least two consecutive complete sections are needed.', surface.gaps)
    if (faceCount > MAX_TERRAIN_SCENE_FOOTPRINT_TRIANGLES)
      return unavailable(
        `The design has more than ${MAX_TERRAIN_SCENE_FOOTPRINT_TRIANGLES} faces for this 3D view.`,
        surface.gaps,
      )

    const pointCount = surface.pieces.reduce((sum, piece) => sum + piece.points.length, 0)
    const positions = new Float32Array(pointCount * 3)
    const indices = new Uint32Array(faceCount * 3)
    const pieces: TerrainScenePiece[] = []
    const footprint: TerrainVertex[][] = []
    const bounds: NonNullable<TerrainSceneGeometry['bounds']> = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ]
    let pointOffset = 0
    let indexOffset = 0
    for (const piece of surface.pieces) {
      const vertices = piece.points.map(([x, y, z]) => {
        if (![x, y, z].every(Number.isFinite)) throw Error('The design surface contains an unreadable coordinate.')
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.min(bounds[2], z)
        bounds[3] = Math.max(bounds[3], x)
        bounds[4] = Math.max(bounds[4], y)
        bounds[5] = Math.max(bounds[5], z)
        return { x, y, z }
      })
      positions.set(piece.points.flat(), pointOffset * 3)
      const firstIndex = indexOffset
      for (const triangle of piece.faces) {
        for (const id of triangle) indices[indexOffset++] = pointOffset + id
        footprint.push(triangle.map((id) => vertices[id]))
      }
      pieces.push({
        firstIndex,
        indexCount: indexOffset - firstIndex,
        from: piece.from,
        to: piece.to,
        folded: piece.folded,
      })
      pointOffset += piece.points.length
    }
    const label = kind === 'finished' ? 'Finished surface' : 'Subgrade'
    return {
      kind,
      status: surface.gaps.length ? 'partial' : 'ready',
      notice: surface.gaps.length
        ? `${label} from the design TIN; ${surface.gaps.length} incomplete stretch${surface.gaps.length === 1 ? '' : 'es'} left open.`
        : `${label} from the design TIN.`,
      positions,
      indices,
      pieces,
      footprint,
      gaps: surface.gaps,
      bounds,
    }
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : 'The design surface could not be drawn.')
  }
}

type Box = [number, number, number, number]
const boxOf = (vertices: readonly TerrainVertex[]): Box => {
  const result: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { x, y } of vertices) {
    result[0] = Math.min(result[0], x)
    result[1] = Math.min(result[1], y)
    result[2] = Math.max(result[2], x)
    result[3] = Math.max(result[3], y)
  }
  return result
}
const overlaps = (a: Box, b: Box) =>
  a[0] < b[2] - EDGE_EPS_M && a[2] > b[0] + EDGE_EPS_M && a[1] < b[3] - EDGE_EPS_M && a[3] > b[1] + EDGE_EPS_M
const twiceArea = (vertices: readonly TerrainVertex[]) => {
  let area = 0
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++)
    area += vertices[j].x * vertices[i].y - vertices[i].x * vertices[j].y
  return area
}
const valid = (vertex: TerrainVertex) =>
  Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z)
const usable = (vertices: readonly TerrainVertex[]) =>
  vertices.length >= 3 && Math.abs(twiceArea(vertices)) > AREA_EPS_M2 * 2

interface IndexedTriangle {
  vertices: TerrainVertex[]
  box: Box
}

/** Bounded memberships even when a long triangle crosses most of the footprint. */
function footprintIndex(footprint: readonly (readonly TerrainVertex[])[]) {
  const triangles: IndexedTriangle[] = []
  for (const face of footprint) {
    if (!face.every(valid)) continue
    for (let i = 1; i + 1 < face.length; i++) {
      const triangle = [face[0], face[i], face[i + 1]]
      if (!usable(triangle)) continue
      if (twiceArea(triangle) < 0) triangle.reverse()
      triangles.push({ vertices: triangle, box: boxOf(triangle) })
      if (triangles.length > MAX_TERRAIN_SCENE_FOOTPRINT_TRIANGLES)
        throw Error('The design footprint is too large to cut out of the 3D terrain.')
    }
  }
  if (!triangles.length) return null
  const bounds = boxOf(triangles.flatMap((triangle) => triangle.vertices))
  let cell = Math.max(1, bounds[2] - bounds[0], bounds[3] - bounds[1]) / INDEX_SIDE
  const cells = (box: Box): Box => [
    Math.floor((box[0] - bounds[0]) / cell),
    Math.floor((box[1] - bounds[1]) / cell),
    Math.floor((box[2] - bounds[0]) / cell),
    Math.floor((box[3] - bounds[1]) / cell),
  ]
  // Coarsen only the lookup, never the triangles. Eventually every triangle has one membership.
  for (;;) {
    let entries = 0
    for (const triangle of triangles) {
      const [left, top, right, bottom] = cells(triangle.box)
      entries += (right - left + 1) * (bottom - top + 1)
      if (entries > MAX_TERRAIN_SCENE_INDEX_ENTRIES) break
    }
    if (entries <= MAX_TERRAIN_SCENE_INDEX_ENTRIES) break
    cell *= 2
  }
  const columns = Math.floor((bounds[2] - bounds[0]) / cell) + 1
  const rows = Math.floor((bounds[3] - bounds[1]) / cell) + 1
  const buckets = new Map<number, number[]>()
  triangles.forEach((triangle, id) => {
    const [left, top, right, bottom] = cells(triangle.box)
    for (let row = top; row <= bottom; row++)
      for (let column = left; column <= right; column++) {
        const key = row * columns + column
        const bucket = buckets.get(key)
        if (bucket) bucket.push(id)
        else buckets.set(key, [id])
      }
  })
  return (box: Box): IndexedTriangle[] => {
    if (!overlaps(box, bounds)) return []
    const [left, top, right, bottom] = cells(box)
    const ids = new Set<number>()
    for (let row = Math.max(0, top); row <= Math.min(rows - 1, bottom); row++)
      for (let column = Math.max(0, left); column <= Math.min(columns - 1, right); column++)
        for (const id of buckets.get(row * columns + column) ?? []) ids.add(id)
    return [...ids].filter((id) => overlaps(box, triangles[id].box)).map((id) => triangles[id])
  }
}

/** Split a convex ground polygon at a counter-clockwise footprint edge. New heights stay on ground. */
function splitAtEdge(polygon: TerrainVertex[], a: TerrainVertex, b: TerrainVertex) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > EDGE_EPS_M)) return { inside: polygon, outside: [] as TerrainVertex[] }
  const distance = (p: TerrainVertex) => {
    const d = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length
    return Math.abs(d) <= EDGE_EPS_M ? 0 : d
  }
  const inside: TerrainVertex[] = []
  const outside: TerrainVertex[] = []
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const previous = polygon[j]
    const current = polygon[i]
    const before = distance(previous)
    const after = distance(current)
    if (before >= 0 !== after >= 0) {
      const t = before / (before - after)
      const crossing = {
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
        z: previous.z + (current.z - previous.z) * t,
      }
      inside.push(crossing)
      outside.push(crossing)
    }
    ;(after >= 0 ? inside : outside).push(current)
  }
  return { inside, outside }
}

/** A convex polygon minus one triangle is at most three convex polygons. */
function subtractTriangle(polygon: TerrainVertex[], triangle: readonly TerrainVertex[]) {
  let remainder = polygon
  const result: TerrainVertex[][] = []
  for (let i = 0; i < 3 && usable(remainder); i++) {
    const { inside, outside } = splitAtEdge(remainder, triangle[i], triangle[(i + 1) % 3])
    if (usable(outside)) result.push(outside)
    remainder = inside
  }
  return result
}

/**
 * Remove the chosen design surface's exact XY footprint from sampled display ground. The input
 * is convex sampled faces (triangles, or triangles clipped to a display window). All face metadata,
 * including colour and estimated status, is retained. Non-finite source faces remain absent.
 *
 * Footprint triangles, rather than a piece's outer ring, also handle overlapping/folded design
 * faces. No design across an incomplete section means no cut there. Newly cut terrain vertices
 * interpolate only their original ground face; they never borrow a design height or fill a gap.
 * Throws on an explicit drawing budget so callers can retain the previous view and report why.
 */
export function clipTerrainToDesign<T extends { vertices: TerrainVertex[] }>(
  faces: readonly T[],
  footprint: readonly (readonly TerrainVertex[])[],
): T[] {
  const near = footprintIndex(footprint)
  const result: T[] = []
  let tests = 0
  for (const face of faces) {
    if (!face.vertices.every(valid) || !usable(face.vertices)) continue
    const candidates = near?.(boxOf(face.vertices)) ?? []
    if (!candidates.length) {
      result.push(face)
      if (result.length > MAX_TERRAIN_SCENE_CLIPPED_FACES)
        throw Error('The cut 3D terrain exceeds this view’s face budget. Use a smaller terrain window.')
      continue
    }
    let polygons = [face.vertices]
    for (const triangle of candidates) {
      const next: TerrainVertex[][] = []
      for (const polygon of polygons) {
        if (++tests > MAX_TERRAIN_SCENE_CLIP_TESTS)
          throw Error('This 3D terrain needs too many design-edge cuts. Use a smaller terrain window.')
        if (!overlaps(boxOf(polygon), triangle.box)) next.push(polygon)
        else next.push(...subtractTriangle(polygon, triangle.vertices))
        if (next.length > MAX_TERRAIN_SCENE_CLIP_PIECES)
          throw Error('Too many design edges cross one 3D terrain face. Use a finer terrain mesh here.')
      }
      polygons = next
      if (!polygons.length) break
    }
    for (const vertices of polygons) result.push({ ...face, vertices })
    if (result.length > MAX_TERRAIN_SCENE_CLIPPED_FACES)
      throw Error('The cut 3D terrain exceeds this view’s face budget. Use a smaller terrain window.')
  }
  return result
}
