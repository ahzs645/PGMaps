/**
 * The road preview's GPU geometry, in one local frame in the terrain's export CRS. Design faces are
 * the LandXML faces, never triangulated again. Cutting their footprint out of the display ground
 * changes only the drawing: it neither fills source gaps nor changes the analytical terrain.
 *
 * Pure: no DOM or network access. Coordinates and elevations stay in metres; exaggeration belongs
 * to the renderer. An unavailable design is a result, so an invalid edit cannot empty the viewer.
 */
import { stationOffsetCoordinate } from './designExports'
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
/** How near a footprint edge or corner a ground vertex must lie, in plan, to be on it. */
const SEAM_EPS_M = 1e-5
/** How near a design TIN's outline point must lie to a station's catch point, in plan, to be that catch point. */
const CATCH_MATCH_M = 1e-3
/**
 * How far across a cut ground edge the footprint is looked for, in plan: above the cut's own snapping (`EDGE_EPS_M`)
 * and rounding, and below the ground wedges a seam leaves where it turns, which close to nothing at the corner.
 */
const SKIRT_PROBE_M = 1e-6
const AREA_EPS_M2 = 1e-9
/**
 * The skirt under the ground's cut edge hangs at least this far, and at least `TERRAIN_SKIRT_DEPTH_CELLS` ground cells.
 * Deep enough to fill what a coarse face can stand off the design, shallow enough not to read as a wall under the
 * ground where the display window cuts it.
 */
export const TERRAIN_SKIRT_MIN_DEPTH_M = 5
export const TERRAIN_SKIRT_DEPTH_CELLS = 2
/** An unfinished batter's curtain lower than this at both ends is left out: there is nothing to see. */
export const UNFINISHED_CURTAIN_MIN_HEIGHT_M = 0.05

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
  /**
   * The outline edges that join two stations' catch points on one side: there the TIN meets the ground. Every other
   * outline edge (a piece's first and last section, each end at an incomplete stretch) stays open.
   */
  seams: DesignSeam[]
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
    seams: [],
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
    const catchPoint = catchPoints(analysis, frame)
    const seams: DesignSeam[] = []
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
      // The section builder ends each complete section at its two catch points, so an outline edge joining one side's
      // catch points at two stations is where the TIN meets the ground. The rest of the outline never reached it.
      const caught = piece.points.map(([x, y]) => catchPoint(x, y))
      for (let k = 0; k < piece.boundary.length; k++) {
        const i = piece.boundary[k],
          j = piece.boundary[(k + 1) % piece.boundary.length]
        const a = caught[i],
          b = caught[j]
        if (a && b && a.side === b.side && a.station !== b.station) seams.push({ a: vertices[i], b: vertices[j] })
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
      seams,
      gaps: surface.gaps,
      bounds,
    }
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : 'The design surface could not be drawn.')
  }
}

/** Each complete station's two catch points in the frame, found again by plan position. */
function catchPoints(analysis: RoadAnalysis, frame: TerrainSceneFrame) {
  const cells = new Map<string, Array<{ x: number; y: number; station: number; side: -1 | 1 }>>()
  const key = (x: number, y: number) => `${Math.round(x / CATCH_MATCH_M)}:${Math.round(y / CATCH_MATCH_M)}`
  analysis.stations.forEach((station, index) => {
    if (!station.complete) return
    for (const side of [-1, 1] as const) {
      const daylight = side < 0 ? station.leftDaylightM : station.rightDaylightM
      if (daylight == null || !Number.isFinite(daylight)) continue
      const [x, y] = frame.point(stationOffsetCoordinate(station, side * Math.abs(daylight)))
      const entry = { x, y, station: index, side }
      const k = key(x, y)
      const cell = cells.get(k)
      if (cell) cell.push(entry)
      else cells.set(k, [entry])
    }
  })
  return (x: number, y: number) => {
    const column = Math.round(x / CATCH_MATCH_M),
      row = Math.round(y / CATCH_MATCH_M)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const entry of cells.get(`${column + dx}:${row + dy}`) ?? [])
          if (Math.hypot(entry.x - x, entry.y - y) <= CATCH_MATCH_M) return entry
    return null
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

/**
 * A bounded lookup from a box to the ids of the boxes whose grid cells it meets. Memberships stay under
 * `MAX_TERRAIN_SCENE_INDEX_ENTRIES` by coarsening the cells, never by dropping an item. Callers check the boxes.
 */
function gridIndex(boxes: readonly Box[]) {
  if (!boxes.length) return null
  const bounds: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const box of boxes) {
    bounds[0] = Math.min(bounds[0], box[0])
    bounds[1] = Math.min(bounds[1], box[1])
    bounds[2] = Math.max(bounds[2], box[2])
    bounds[3] = Math.max(bounds[3], box[3])
  }
  let cell = Math.max(1, bounds[2] - bounds[0], bounds[3] - bounds[1]) / INDEX_SIDE
  const cells = (box: Box): Box => [
    Math.floor((box[0] - bounds[0]) / cell),
    Math.floor((box[1] - bounds[1]) / cell),
    Math.floor((box[2] - bounds[0]) / cell),
    Math.floor((box[3] - bounds[1]) / cell),
  ]
  // Coarsen only the lookup, never the items. Eventually every item has one membership.
  for (;;) {
    let entries = 0
    for (const box of boxes) {
      const [left, top, right, bottom] = cells(box)
      entries += (right - left + 1) * (bottom - top + 1)
      if (entries > MAX_TERRAIN_SCENE_INDEX_ENTRIES) break
    }
    if (entries <= MAX_TERRAIN_SCENE_INDEX_ENTRIES) break
    cell *= 2
  }
  const columns = Math.floor((bounds[2] - bounds[0]) / cell) + 1
  const rows = Math.floor((bounds[3] - bounds[1]) / cell) + 1
  const buckets = new Map<number, number[]>()
  boxes.forEach((box, id) => {
    const [left, top, right, bottom] = cells(box)
    for (let row = top; row <= bottom; row++)
      for (let column = left; column <= right; column++) {
        const key = row * columns + column
        const bucket = buckets.get(key)
        if (bucket) bucket.push(id)
        else buckets.set(key, [id])
      }
  })
  return (box: Box): number[] => {
    if (box[2] < bounds[0] || box[0] > bounds[2] || box[3] < bounds[1] || box[1] > bounds[3]) return []
    const [left, top, right, bottom] = cells(box)
    const ids = new Set<number>()
    for (let row = Math.max(0, top); row <= Math.min(rows - 1, bottom); row++)
      for (let column = Math.max(0, left); column <= Math.min(columns - 1, right); column++)
        for (const id of buckets.get(row * columns + column) ?? []) ids.add(id)
    return [...ids]
  }
}

/** Cell of the point lookups below, m: about the band's ground cell, so a piece's box reads a few cells. */
const POINT_CELL_M = 2
/** Most cells a point lookup keeps; past it its cells are made coarser. */
const MAX_POINT_CELLS = 4_000_000

/**
 * Plan cells over the points' extent, numbered densely so a lookup is an array index. A box's cells are visited
 * clipped to the extent, so `each` stops at the first cell for which `visit` returns true.
 */
function planCells(points: readonly TerrainVertex[]) {
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity
  for (const { x, y } of points) {
    left = Math.min(left, x)
    bottom = Math.min(bottom, y)
    right = Math.max(right, x)
    top = Math.max(top, y)
  }
  let size = POINT_CELL_M
  while (((right - left) / size + 1) * ((top - bottom) / size + 1) > MAX_POINT_CELLS) size *= 2
  const columns = Math.floor((right - left) / size) + 1,
    rows = Math.floor((top - bottom) / size) + 1
  const column = (x: number) => Math.floor((x - left) / size),
    row = (y: number) => Math.floor((y - bottom) / size)
  return {
    count: points.length ? columns * rows : 0,
    of: (point: TerrainVertex) => column(point.x) * rows + row(point.y),
    /** Visit each cell a box (grown by `SEAM_EPS_M`) meets until `visit` says stop. */
    each(box: Box, visit: (cell: number) => boolean | void) {
      const c0 = Math.max(0, column(box[0] - SEAM_EPS_M)),
        c1 = Math.min(columns - 1, column(box[2] + SEAM_EPS_M)),
        r0 = Math.max(0, row(box[1] - SEAM_EPS_M)),
        r1 = Math.min(rows - 1, row(box[3] + SEAM_EPS_M))
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (visit(c * rows + r)) return
    },
  }
}

/** The points within a box (grown by `SEAM_EPS_M`), from plan cells. One membership a point. */
function pointGrid(points: readonly TerrainVertex[]) {
  const grid = planCells(points)
  const cells: Array<TerrainVertex[] | undefined> = new Array(grid.count)
  for (const point of points) (cells[grid.of(point)] ??= []).push(point)
  return (box: Box): TerrainVertex[] => {
    const left = box[0] - SEAM_EPS_M,
      bottom = box[1] - SEAM_EPS_M,
      right = box[2] + SEAM_EPS_M,
      top = box[3] + SEAM_EPS_M
    const found: TerrainVertex[] = []
    grid.each(box, (cell) => {
      for (const point of cells[cell] ?? [])
        if (point.x >= left && point.x <= right && point.y >= bottom && point.y <= top) found.push(point)
    })
    return found
  }
}

/** Whether any of the points lies in a plan cell a box (grown by `SEAM_EPS_M`) meets: a quick test, no list built. */
function pointCells(points: readonly TerrainVertex[]) {
  const grid = planCells(points)
  const filled = new Uint8Array(grid.count)
  for (const point of points) filled[grid.of(point)] = 1
  return (box: Box) => {
    let found = false
    grid.each(box, (cell) => (found = filled[cell] === 1))
    return found
  }
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
  const lookup = gridIndex(triangles.map((triangle) => triangle.box))
  if (!lookup) return null
  return (box: Box): IndexedTriangle[] =>
    lookup(box)
      .filter((id) => overlaps(box, triangles[id].box))
      .map((id) => triangles[id])
}

/** How far the display ground is blended to a seam at least, in plan, m. */
export const TERRAIN_SEAM_BLEND_MIN_M = 2
/** And at least this many ground cells: the blend must reach past the ground vertex next to the seam. */
export const TERRAIN_SEAM_BLEND_CELLS = 1.5

/** How far either side of a seam the display ground is blended to it, for ground of this cell size, m. */
export function terrainSeamBlendRadius(cellSizeM: number) {
  return Math.max(
    TERRAIN_SEAM_BLEND_MIN_M,
    TERRAIN_SEAM_BLEND_CELLS * (Number.isFinite(cellSizeM) && cellSizeM > 0 ? cellSizeM : 0),
  )
}

/** The blend's weight at a plan distance, as a share of its radius: 1 on the seam, 0 at the radius, smooth at both. */
const blendWeight = (share: number) => (share >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.max(0, share))))

/**
 * Where the display ground goes near the seams. A ground vertex on a seam, in plan, takes the seam's level, decided
 * once a plan position so every face sharing it agrees; where seams overlap in plan (a folded footprint, a
 * switchback) it meets the one nearest its own level. That move is the seam's lift there. Between two such vertices
 * on one seam the ground's cut edge is straight, so the lift runs straight between them too. A ground vertex within
 * the blend radius of a seam stretch with ground beside it moves by the lift at the nearest such point, eased to
 * nothing at the radius. Everything else stays where it is.
 *
 * Fed polygon by polygon: its vertices (`note`), then, where one is on a seam, its edges (`noteEdge`); then `blend`.
 */
function seamField(seams: readonly DesignSeam[], radius: number) {
  const usable = seams.filter(({ a, b }) => valid(a) && valid(b) && Math.hypot(b.x - a.x, b.y - a.y) > EDGE_EPS_M)
  const reach = Math.max(radius, SEAM_EPS_M)
  const blending = radius > SEAM_EPS_M
  // Seams by plan cell, each listed in every cell within reach of it, in seam order so ties go to the first. The cells
  // are numbered densely over the seams' reach, so a vertex finds its list by an array index.
  const ends = usable.flatMap(({ a, b }) => [
    { x: a.x - reach, y: a.y - reach, z: 0 },
    { x: b.x + reach, y: b.y + reach, z: 0 },
    { x: a.x + reach, y: a.y + reach, z: 0 },
    { x: b.x - reach, y: b.y - reach, z: 0 },
  ])
  const grid = planCells(ends)
  const cells: Array<number[] | undefined> = new Array(grid.count)
  usable.forEach(({ a, b }, id) => {
    grid.each(
      [Math.min(a.x, b.x) - reach, Math.min(a.y, b.y) - reach, Math.max(a.x, b.x) + reach, Math.max(a.y, b.y) + reach],
      (cell) => {
        ;(cells[cell] ??= []).push(id)
      },
    )
  })
  const [left, bottom, right, top] = boxOf(ends)
  const nearby = (vertex: TerrainVertex) =>
    vertex.x >= left && vertex.x <= right && vertex.y >= bottom && vertex.y <= top ? cells[grid.of(vertex)] : undefined
  /** Each seam this vertex lies on, in plan, with where along it. */
  const onSeams = (vertex: TerrainVertex) => {
    const found: Array<{ id: number; t: number }> = []
    for (const id of nearby(vertex) ?? []) {
      const { a, b } = usable[id]
      const dx = b.x - a.x,
        dy = b.y - a.y
      const length = Math.sqrt(dx * dx + dy * dy)
      const t = ((vertex.x - a.x) * dx + (vertex.y - a.y) * dy) / (length * length)
      if (t * length < -SEAM_EPS_M || (t - 1) * length > SEAM_EPS_M) continue
      const clamped = Math.min(1, Math.max(0, t))
      if (Math.hypot(vertex.x - (a.x + dx * clamped), vertex.y - (a.y + dy * clamped)) > SEAM_EPS_M) continue
      found.push({ id, t: clamped })
    }
    return found
  }
  const levels = new Map<string, number>()
  /** Where each vertex goes. A vertex absent from it stays where it is. */
  const placed = new Map<TerrainVertex, number>()
  /** The seams each vertex on one lies on. */
  const seamsOf = new Map<TerrainVertex, Array<{ id: number; t: number }>>()
  /** Vertices near a seam but not on one: they are blended once every seam's lift is known. */
  const pending: TerrainVertex[] = []
  const knots: Array<Array<{ t: number; lift: number }>> = usable.map(() => [])
  const covered: Array<Array<[number, number]>> = usable.map(() => [])
  const seen = new Set<TerrainVertex>()
  /** Note a ground vertex; says whether it lies on a seam. */
  const note = (vertex: TerrainVertex): boolean => {
    if (!nearby(vertex)) return false
    if (seen.has(vertex)) return seamsOf.has(vertex)
    seen.add(vertex)
    const on = onSeams(vertex)
    if (!on.length) {
      if (blending) pending.push(vertex)
      return false
    }
    const key = `${Math.round(vertex.x / SEAM_EPS_M)}:${Math.round(vertex.y / SEAM_EPS_M)}`
    let level = levels.get(key)
    if (level === undefined) {
      for (const { id, t } of on) {
        const { a, b } = usable[id]
        const z = a.z + (b.z - a.z) * t
        if (level === undefined || Math.abs(z - vertex.z) < Math.abs(level - vertex.z)) level = z
      }
      levels.set(key, level!)
    }
    if (level !== vertex.z) placed.set(vertex, level!)
    seamsOf.set(vertex, on)
    for (const { id, t } of on) knots[id].push({ t, lift: level! - vertex.z })
    return true
  }
  /** A ground edge with both ends on one seam lies along it: that stretch of the seam has ground beside it. */
  const noteEdge = (p: TerrainVertex, q: TerrainVertex) => {
    const onP = seamsOf.get(p)
    if (!onP) return
    const onQ = seamsOf.get(q)
    if (!onQ) return
    for (const u of onP)
      for (const v of onQ)
        if (u.id === v.id && u.t !== v.t) covered[u.id].push([Math.min(u.t, v.t), Math.max(u.t, v.t)])
  }
  type Run = { merged: Array<[number, number]>; t: Float64Array; lift: Float64Array }
  let runs: Array<Run | null> = []
  /** The lift at a place along a seam, straight between the ground vertices on it. */
  const liftAt = ({ t: ts, lift }: Run, t: number) => {
    let low = 0,
      high = ts.length - 1
    if (t <= ts[low]) return lift[low]
    if (t >= ts[high]) return lift[high]
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (ts[middle] <= t) low = middle
      else high = middle
    }
    const span = ts[high] - ts[low]
    return span > 0 ? lift[low] + ((lift[high] - lift[low]) * (t - ts[low])) / span : lift[low]
  }
  /** How far a point off the seams is moved: the lift at the nearest seam point with ground beside it, eased. */
  const moveAt = (vertex: TerrainVertex) => {
    if (!blending) return 0
    // The nearest seam point with ground beside it wins; on a tie, the seam listed first.
    let best = radius,
      lift = 0
    for (const id of nearby(vertex) ?? []) {
      const run = runs[id]
      if (!run) continue
      const { a, b } = usable[id]
      const dx = b.x - a.x,
        dy = b.y - a.y
      const t = Math.min(1, Math.max(0, ((vertex.x - a.x) * dx + (vertex.y - a.y) * dy) / (dx * dx + dy * dy)))
      let at = t,
        nearest = Infinity
      for (const [from, to] of run.merged) {
        const clamped = Math.min(to, Math.max(from, t))
        if (Math.abs(clamped - t) < nearest) {
          nearest = Math.abs(clamped - t)
          at = clamped
        }
        if (from > t) break
      }
      const distance = Math.hypot(vertex.x - (a.x + dx * at), vertex.y - (a.y + dy * at))
      if (distance < best) {
        best = distance
        lift = liftAt(run, at)
      }
    }
    return lift * blendWeight(best / radius)
  }
  /** Once every ground vertex and edge is noted: each seam's lift, then every vertex near a seam is blended. */
  const blend = () => {
    runs = covered.map((intervals, id) => {
      if (!intervals.length) return null
      intervals.sort((u, v) => u[0] - v[0])
      const { a, b } = usable[id]
      const joined = SEAM_EPS_M / Math.hypot(b.x - a.x, b.y - a.y)
      const merged: Array<[number, number]> = [[...intervals[0]]]
      for (const [from, to] of intervals.slice(1)) {
        const last = merged[merged.length - 1]
        if (from <= last[1] + joined) last[1] = Math.max(last[1], to)
        else merged.push([from, to])
      }
      const along = knots[id].sort((u, v) => u.t - v.t)
      return { merged, t: Float64Array.from(along, (k) => k.t), lift: Float64Array.from(along, (k) => k.lift) }
    })
    for (const vertex of pending) {
      const move = moveAt(vertex)
      if (move) placed.set(vertex, vertex.z + move)
    }
  }
  /** Where a point that is no ground vertex (a fan's centre) is drawn, once `blend` has run. */
  const levelAt = (vertex: TerrainVertex) => {
    if (!nearby(vertex)) return vertex.z
    let level: number | undefined
    for (const { id, t } of onSeams(vertex)) {
      const { a, b } = usable[id]
      const z = a.z + (b.z - a.z) * t
      if (level === undefined || Math.abs(z - vertex.z) < Math.abs(level - vertex.z)) level = z
    }
    return level ?? vertex.z + moveAt(vertex)
  }
  return { note, noteEdge, blend, placed, levelAt }
}

/**
 * A ground polygon being cut, with `cut[i]` true when its edge from vertex i to the next lies along a footprint
 * triangle's edge line. Only those edges can be where the ground ends on the footprint, which the skirt follows.
 */
interface Piece {
  vertices: TerrainVertex[]
  cut: boolean[]
}

/** Split a convex ground polygon at a counter-clockwise footprint edge. New heights stay on ground. */
function splitAtEdge(polygon: Piece, a: TerrainVertex, b: TerrainVertex) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > EDGE_EPS_M)) return { inside: polygon, outside: { vertices: [], cut: [] } as Piece }
  const distance = (p: TerrainVertex) => {
    const d = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length
    return Math.abs(d) <= EDGE_EPS_M ? 0 : d
  }
  const inside: Piece = { vertices: [], cut: [] }
  const outside: Piece = { vertices: [], cut: [] }
  const { vertices } = polygon
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const previous = vertices[j]
    const current = vertices[i]
    const before = distance(previous)
    const after = distance(current)
    if (before >= 0 !== after >= 0) {
      const t = before / (before - after)
      const crossing = {
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
        z: previous.z + (current.z - previous.z) * t,
      }
      // The side `current` is on carries on along this edge from the crossing. The side `previous` was on leaves the
      // edge here and runs along the footprint edge's line to where the polygon comes back to it.
      const continuing = after >= 0 ? inside : outside
      const leaving = after >= 0 ? outside : inside
      continuing.vertices.push(crossing)
      continuing.cut.push(polygon.cut[j])
      leaving.vertices.push(crossing)
      leaving.cut.push(true)
    }
    const side = after >= 0 ? inside : outside
    side.vertices.push(current)
    side.cut.push(polygon.cut[i])
  }
  return { inside, outside }
}

/** A convex polygon minus one triangle is at most three convex polygons. */
function subtractTriangle(polygon: Piece, triangle: readonly TerrainVertex[]) {
  let remainder = polygon
  const result: Piece[] = []
  for (let i = 0; i < 3 && usable(remainder.vertices); i++) {
    const { inside, outside } = splitAtEdge(remainder, triangle[i], triangle[(i + 1) % 3])
    if (usable(outside.vertices)) result.push(outside)
    remainder = inside
  }
  return result
}

/**
 * Put every given point that lies inside one of the polygon's edges into that edge, at the ground's own level there.
 * `added` marks the vertices already put in, and comes back with the new ones marked; it is null while there are none.
 * With `neighbours`, the points are other ground vertices, each kept at its own level, and only edges it accepts
 * (given their ends and the points on them) take them.
 *
 * Without it the ground's cut edge would run straight past a seam's corner (a T-junction against the seam), and a
 * neighbouring piece that has the corner would part from it once the corner is brought to the seam.
 */
function withCorners(
  polygon: Piece,
  points: readonly TerrainVertex[],
  added: boolean[] | null = null,
  neighbours?: (p: TerrainVertex, q: TerrainVertex, on: readonly TerrainVertex[]) => boolean,
) {
  if (!points.length) return { piece: polygon, added }
  const [left, bottom, right, top] = boxOf(polygon.vertices)
  const corners = points.filter(
    ({ x, y }) =>
      x >= left - SEAM_EPS_M && x <= right + SEAM_EPS_M && y >= bottom - SEAM_EPS_M && y <= top + SEAM_EPS_M,
  )
  if (!corners.length) return { piece: polygon, added }
  // What goes into each edge, found before anything is copied: most polygons take nothing.
  const n = polygon.vertices.length
  let into: Array<TerrainVertex[] | undefined> | null = null
  for (let i = 0; i < n; i++) {
    const p = polygon.vertices[i],
      q = polygon.vertices[(i + 1) % n]
    const dx = q.x - p.x,
      dy = q.y - p.y
    const length = Math.hypot(dx, dy)
    if (!(length > 2 * SEAM_EPS_M)) continue
    const on: Array<{ along: number; corner: TerrainVertex }> = []
    for (const corner of corners) {
      const along = ((corner.x - p.x) * dx + (corner.y - p.y) * dy) / length
      if (along <= SEAM_EPS_M || along >= length - SEAM_EPS_M) continue
      if (Math.abs((corner.y - p.y) * dx - (corner.x - p.x) * dy) / length > SEAM_EPS_M) continue
      on.push({ along, corner })
    }
    if (
      !on.length ||
      (neighbours &&
        !neighbours(
          p,
          q,
          on.map(({ corner }) => corner),
        ))
    )
      continue
    on.sort((u, v) => u.along - v.along)
    const edge: TerrainVertex[] = []
    let last = 0
    for (const { along, corner } of on) {
      // One vertex for points closer together than a seam's own tolerance: they are one place.
      if (along - last <= SEAM_EPS_M) continue
      last = along
      // A neighbour's ground vertex lies on this edge's ground already: keeping it as it is makes the two one vertex.
      edge.push(neighbours ? corner : { x: corner.x, y: corner.y, z: p.z + ((q.z - p.z) * along) / length })
    }
    if (edge.length) (into ??= [])[i] = edge
  }
  if (!into) return { piece: polygon, added }
  const vertices: TerrainVertex[] = []
  const cut: boolean[] = []
  const marks: boolean[] = []
  for (let i = 0; i < n; i++) {
    vertices.push(polygon.vertices[i])
    cut.push(polygon.cut[i])
    marks.push(added?.[i] ?? false)
    for (const vertex of into[i] ?? []) {
      vertices.push(vertex)
      cut.push(polygon.cut[i])
      marks.push(true)
    }
  }
  return { piece: { vertices, cut }, added: marks }
}

/**
 * Whether a triangle is flat in plan, or thinner than a seam's own tolerance. Such a triangle joins points the stitch
 * treats as lying on one line, and once they are moved by different amounts it would stand up as a fin.
 */
const thin = (triangle: readonly TerrainVertex[]) => {
  const area = Math.abs(twiceArea(triangle))
  if (area <= AREA_EPS_M2 * 2) return true
  let longest = 0
  for (let i = 0; i < 3; i++) {
    const p = triangle[i],
      q = triangle[(i + 1) % 3]
    longest = Math.max(longest, Math.hypot(q.x - p.x, q.y - p.y))
  }
  return area <= SEAM_EPS_M * longest
}

/** A fan's centre nearer than this to its polygon's edge, in plan, is a sliver's: it is drawn at its corners' mean. */
const CENTRE_INSIDE_M = 1e-3

/**
 * Triangles covering a convex polygon whose edges carry added corners, so each corner is a vertex of the faces drawn
 * and no face is flat in plan. A fan from a vertex when one sees every edge (an original vertex first), else from the
 * centre. The centre lies on the polygon's own ground and is drawn where `place` puts that point, except in a sliver,
 * where it takes the mean of the levels its corners are drawn at (`level`) so it cannot stand off them.
 */
function triangulated(
  vertices: readonly TerrainVertex[],
  added: readonly boolean[],
  level: (vertex: TerrainVertex) => number = (vertex) => vertex.z,
  place: (vertex: TerrainVertex) => number = (vertex) => vertex.z,
): TerrainVertex[][] {
  const n = vertices.length
  const flat = (triangle: readonly TerrainVertex[]) => Math.abs(twiceArea(triangle)) <= AREA_EPS_M2 * 2
  // An original vertex whose fan has no thin triangle, then any vertex; else a fan with none flat in plan.
  for (const [refused, anyApex] of [
    [thin, false],
    [thin, true],
    [flat, false],
    [flat, true],
  ] as const)
    for (let apex = 0; apex < n; apex++) {
      if (added[apex] && !anyApex) continue
      const fan: TerrainVertex[][] = []
      for (let k = 1; k + 1 < n; k++) {
        const triangle = [vertices[apex], vertices[(apex + k) % n], vertices[(apex + k + 1) % n]]
        if (refused(triangle)) break
        fan.push(triangle)
      }
      if (fan.length === n - 2) return fan
    }
  const centre = {
    x: vertices.reduce((sum, v) => sum + v.x, 0) / n,
    y: vertices.reduce((sum, v) => sum + v.y, 0) / n,
    z: vertices.reduce((sum, v) => sum + v.z, 0) / n,
  }
  let inside = Infinity
  for (let i = 0; i < n; i++) {
    const p = vertices[i],
      q = vertices[(i + 1) % n]
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (length > 0)
      inside = Math.min(inside, Math.abs((centre.y - p.y) * (q.x - p.x) - (centre.x - p.x) * (q.y - p.y)) / length)
  }
  centre.z = inside >= CENTRE_INSIDE_M ? place(centre) : vertices.reduce((sum, v) => sum + level(v), 0) / n
  return vertices
    .map((v, i) => [centre, v, vertices[(i + 1) % n]])
    .filter((triangle) => Math.abs(twiceArea(triangle)) > AREA_EPS_M2 * 2)
}

/** A point inside (or on) a counter-clockwise footprint triangle, in plan. */
const insideTriangle = (x: number, y: number, [a, b, c]: readonly TerrainVertex[]) =>
  (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= -AREA_EPS_M2 &&
  (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x) >= -AREA_EPS_M2 &&
  (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x) >= -AREA_EPS_M2

/** An outline edge of the design footprint where the design met the ground. */
export interface DesignSeam {
  a: TerrainVertex
  b: TerrainVertex
}

/** A stretch of the cut ground's edge that lies on the footprint's outline: the top of the skirt hung under it. */
export interface TerrainSkirtEdge {
  a: TerrainVertex
  b: TerrainVertex
}

/** How far the skirt hangs below the ground's cut edge for a display mesh of this cell size, m. */
export function terrainSkirtDepth(cellSizeM: number) {
  return Math.max(TERRAIN_SKIRT_MIN_DEPTH_M, TERRAIN_SKIRT_DEPTH_CELLS * (Number.isFinite(cellSizeM) ? cellSizeM : 0))
}

/**
 * Remove the chosen design surface's exact XY footprint from sampled display ground, and say where the ground now
 * ends on the footprint's outline. The input is convex sampled faces (triangles, or triangles clipped to a display
 * window). All face metadata, including colour and estimated status, is retained. Non-finite source faces remain
 * absent, and the input faces are never changed.
 *
 * Footprint triangles, rather than a piece's outer ring, also handle overlapping/folded design faces. No design across
 * an incomplete section means no cut there. Newly cut terrain vertices interpolate only their original ground face;
 * they never borrow a design height or fill a gap. Every footprint corner on a cut edge becomes a ground vertex.
 *
 * `seams` are the outline edges where the design met the ground. A ground vertex lying on one, in plan, takes the
 * seam's level, at any ground cell size: the display ground is coarser than the source the design met, and left
 * alone it would stand above or below the catch line and saw in and out of it. Ground within `blendM` of a seam is
 * eased to it (`seamField`), so the lift is spread over that distance rather than taken up between the seam and the
 * ground vertex next to it, which can be a fraction of a millimetre away. A vertex on any other outline edge (an open
 * edge: a batter that stopped short of the ground, an incomplete stretch's end) moves only by a seam's blend.
 *
 * Throws on an explicit drawing budget so callers can retain the previous view and report why.
 */
export function cutTerrainToDesign<T extends { vertices: TerrainVertex[] }>(
  faces: readonly T[],
  footprint: readonly (readonly TerrainVertex[])[],
  options: { seams?: readonly DesignSeam[]; blendM?: number } = {},
): { faces: T[]; skirt: TerrainSkirtEdge[] } {
  const near = footprintIndex(footprint)
  const field = options.seams?.length
    ? seamField(options.seams, Math.max(0, options.blendM ?? TERRAIN_SEAM_BLEND_MIN_M))
    : null
  const placed = field?.placed
  const stitched = (vertex: TerrainVertex): TerrainVertex => {
    const z = placed?.get(vertex)
    return z === undefined ? vertex : { ...vertex, z }
  }
  const drawnLevel = (vertex: TerrainVertex) => placed?.get(vertex) ?? vertex.z
  const groundLevel = (vertex: TerrainVertex) => field?.levelAt(vertex) ?? vertex.z
  const result: T[] = []
  const skirt: TerrainSkirtEdge[] = []
  const overBudget = (count: number) => {
    if (count > MAX_TERRAIN_SCENE_CLIPPED_FACES)
      throw Error('The cut 3D terrain exceeds this view’s face budget. Use a smaller terrain window.')
  }
  const tooMany = () => overBudget(result.length)
  /** Whether the stitch moves this vertex off its ground. */
  const isMoved = (vertex: TerrainVertex) => !!placed?.has(vertex)
  // First every face is cut; it is drawn once every moved point is known.
  const cutFaces: Array<{
    face: T
    box: Box
    candidates: IndexedTriangle[]
    pieces: Array<{ piece: Piece; added: boolean[] | null }> | null
  }> = []
  let pieceCount = 0
  let tests = 0
  for (const face of faces) {
    if (!face.vertices.every(valid) || !usable(face.vertices)) continue
    const box = boxOf(face.vertices)
    const candidates = near?.(box) ?? []
    if (!candidates.length) {
      cutFaces.push({ face, box, candidates, pieces: null })
      overBudget(++pieceCount)
      continue
    }
    let polygons: Piece[] = [{ vertices: face.vertices, cut: face.vertices.map(() => false) }]
    for (const triangle of candidates) {
      const next: Piece[] = []
      for (const polygon of polygons) {
        if (++tests > MAX_TERRAIN_SCENE_CLIP_TESTS)
          throw Error('This 3D terrain needs too many design-edge cuts. Use a smaller terrain window.')
        if (!overlaps(boxOf(polygon.vertices), triangle.box)) next.push(polygon)
        else next.push(...subtractTriangle(polygon, triangle.vertices))
        if (next.length > MAX_TERRAIN_SCENE_CLIP_PIECES)
          throw Error('Too many design edges cross one 3D terrain face. Use a finer terrain mesh here.')
      }
      polygons = next
      if (!polygons.length) break
    }
    // Footprint corners within this face, once each: only they can lie inside a cut edge.
    const corners: TerrainVertex[] = []
    const seen = new Set<string>()
    for (const { vertices } of candidates)
      for (const corner of vertices) {
        if (corner.x < box[0] - SEAM_EPS_M || corner.x > box[2] + SEAM_EPS_M) continue
        if (corner.y < box[1] - SEAM_EPS_M || corner.y > box[3] + SEAM_EPS_M) continue
        const key = `${corner.x}:${corner.y}`
        if (seen.has(key)) continue
        seen.add(key)
        corners.push(corner)
      }
    const pieces = polygons.map((polygon) => withCorners(polygon, corners))
    cutFaces.push({ face, box, candidates, pieces })
    pieceCount += pieces.length
    overBudget(pieceCount)
  }

  // Where every ground vertex goes: first the ones on a seam, which set each seam's lift, then the ones near one.
  if (field) {
    const polygon = (vertices: readonly TerrainVertex[]) => {
      let onSeam = false
      for (const vertex of vertices) if (field.note(vertex)) onSeam = true
      if (onSeam)
        for (let i = 0; i < vertices.length; i++) field.noteEdge(vertices[i], vertices[(i + 1) % vertices.length])
    }
    for (const { face, pieces } of cutFaces)
      if (pieces) for (const { piece } of pieces) polygon(piece.vertices)
      else polygon(face.vertices)
    field.blend()
  }

  // The ground is moved vertex by vertex, so it stays closed only where every face along an edge has the same vertices
  // on it. An edge's own T-junctions (a cut's crossings, the fine band's border against coarse cells) are harmless while
  // the edge lies on its ground, and only then: once a point on it or one of its ends is moved, every vertex of a
  // neighbour lying on it must be one of its vertices too. So once anything moves, every ground vertex is kept, once,
  // and put into such edges below; a face with no moved vertex near has no edge that needs another vertex. Two vertices
  // at one place are put into an edge once (`withCorners`).
  const moved = placed?.size ? [...placed.keys()] : []
  const points: TerrainVertex[] = []
  if (moved.length) {
    const noted = new Set<TerrainVertex>()
    const notePoint = (vertex: TerrainVertex) => {
      if (noted.has(vertex)) return
      noted.add(vertex)
      points.push(vertex)
    }
    for (const { face, pieces } of cutFaces)
      if (pieces) for (const { piece } of pieces) for (const vertex of piece.vertices) notePoint(vertex)
      else for (const vertex of face.vertices) notePoint(vertex)
  }
  const movedNear = moved.length ? pointCells(moved) : null
  const pointIndex = movedNear ? pointGrid(points) : null
  /** The ground vertices that may lie on this box's edges, or none when no moved point is near it. */
  const pointsNear = (box: Box) => (pointIndex && movedNear!(box) ? pointIndex(box) : [])
  const leavesGround = (p: TerrainVertex, q: TerrainVertex, on: readonly TerrainVertex[]) =>
    isMoved(p) || isMoved(q) || on.some(isMoved)
  for (const { face, box, candidates, pieces } of cutFaces) {
    if (!pieces) {
      // A face with no moved vertex near is drawn as it was.
      const near = pointsNear(box)
      if (!near.length) {
        result.push(face)
        tooMany()
        continue
      }
      const { piece, added } = withCorners(
        { vertices: face.vertices, cut: face.vertices.map(() => false) },
        near,
        null,
        leavesGround,
      )
      if (added) {
        for (const drawn of triangulated(piece.vertices, added, drawnLevel, groundLevel)) {
          result.push({ ...face, vertices: drawn.map(stitched) })
          tooMany()
        }
        continue
      }
      // Kept whole, its own vertices moved where they are near a seam.
      const stitchedVertices = face.vertices.map(stitched)
      result.push(
        stitchedVertices.some((v, i) => v !== face.vertices[i]) ? { ...face, vertices: stitchedVertices } : face,
      )
      tooMany()
      continue
    }
    const faceMoved = !!movedNear?.(box)
    for (const cutPiece of pieces) {
      const { piece, added } = faceMoved
        ? withCorners(cutPiece.piece, pointsNear(boxOf(cutPiece.piece.vertices)), cutPiece.added, leavesGround)
        : cutPiece
      const { vertices, cut } = piece
      // The skirt hangs from each cut edge that has footprint, not more ground, just across it. A cut edge can run
      // on past a footprint triangle along its line; the corner put in above ends the part that does not.
      const sign = twiceArea(vertices) > 0 ? 1 : -1
      for (let i = 0; i < vertices.length; i++) {
        if (!cut[i]) continue
        const p = vertices[i],
          q = vertices[(i + 1) % vertices.length]
        const length = Math.hypot(q.x - p.x, q.y - p.y)
        if (!(length > SEAM_EPS_M)) continue
        const x = (p.x + q.x) / 2 + (sign * (q.y - p.y) * SKIRT_PROBE_M) / length
        const y = (p.y + q.y) / 2 - (sign * (q.x - p.x) * SKIRT_PROBE_M) / length
        if (
          candidates.some(
            (triangle) =>
              x >= triangle.box[0] &&
              x <= triangle.box[2] &&
              y >= triangle.box[1] &&
              y <= triangle.box[3] &&
              insideTriangle(x, y, triangle.vertices),
          )
        )
          skirt.push({ a: stitched(p), b: stitched(q) })
      }
      for (const drawn of added ? triangulated(vertices, added, drawnLevel, groundLevel) : [vertices]) {
        result.push({ ...face, vertices: drawn.map(stitched) })
        tooMany()
      }
    }
  }

  return { faces: result, skirt }
}

/** `cutTerrainToDesign`'s ground alone. */
export function clipTerrainToDesign<T extends { vertices: TerrainVertex[] }>(
  faces: readonly T[],
  footprint: readonly (readonly TerrainVertex[])[],
  options: { seams?: readonly DesignSeam[]; blendM?: number } = {},
): T[] {
  return cutTerrainToDesign(faces, footprint, options).faces
}

/**
 * Faces from each open batter edge down (or up) to the sampled ground at the same offsets, so a batter that stopped
 * short of the ground shows where it stopped. Where the edge crosses the ground the face is split at the crossing.
 * Display only: it never changes the batter, its quantities or the terrain.
 */
export function unfinishedBatterCurtains(
  edges: readonly { a: TerrainVertex; b: TerrainVertex; groundA: number; groundB: number }[],
  minHeightM = UNFINISHED_CURTAIN_MIN_HEIGHT_M,
): TerrainVertex[][] {
  const faces: TerrainVertex[][] = []
  for (const { a, b, groundA, groundB } of edges) {
    if (![a.x, a.y, a.z, b.x, b.y, b.z, groundA, groundB].every(Number.isFinite)) continue
    const da = a.z - groundA,
      db = b.z - groundB
    if (Math.max(Math.abs(da), Math.abs(db)) < minHeightM) continue
    const groundUnderA = { x: a.x, y: a.y, z: groundA },
      groundUnderB = { x: b.x, y: b.y, z: groundB }
    if (da * db >= 0) {
      // An end already on the ground is one corner, not two.
      const face = [a, b]
      if (db !== 0) face.push(groundUnderB)
      if (da !== 0) face.push(groundUnderA)
      faces.push(face)
      continue
    }
    const t = da / (da - db)
    const crossing = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
    faces.push([a, crossing, groundUnderA], [crossing, b, groundUnderB])
  }
  return faces
}
