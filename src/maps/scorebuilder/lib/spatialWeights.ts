/**
 * Queen contiguity between region polygons, and the row-standardised weights the spatial
 * autocorrelation statistics read (`spatialAutocorrelation.ts`).
 *
 * Written from the published definition (Cliff & Ord 1981; Anselin 1988): two regions are
 * neighbours when their boundaries share an edge or a single point. Real boundary files
 * rarely share vertices exactly — one side of a shared edge often carries a vertex the
 * other lacks (a T-junction), and coordinates drift by rounding — so the test is "a vertex
 * of one region lies within `toleranceMeters` of a boundary segment of the other". That
 * covers a shared vertex, a T-junction and a partly overlapping edge alike. Regions whose
 * outlines cross without any vertex near the other's boundary (overlapping polygons) are
 * not linked; contiguity assumes a set of regions that tile the area.
 *
 * DOM-free: the unit tests run it on made-up geometry.
 */

export interface ContiguityRegion {
  id: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export interface ContiguityGraph {
  /** Region ids in input order; `neighbors[i]` holds indices into this list, ascending. */
  ids: string[]
  neighbors: number[][]
  /** Ids of regions that touch no other region. */
  islands: string[]
  toleranceMeters: number
}

/**
 * Default snapping distance. Wide enough for the rounding and independent simplification
 * of neighbouring boundary files, far narrower than any region the labs map.
 */
export const DEFAULT_CONTIGUITY_TOLERANCE_METERS = 2

const METERS_PER_DEGREE = 111_320

interface Segment {
  owner: number
  ax: number
  ay: number
  bx: number
  by: number
}

function ringsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
  if (geometry.type === 'Polygon') return geometry.coordinates
  return geometry.coordinates.flat()
}

function pointSegmentDistanceSquared(px: number, py: number, s: Segment): number {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const lengthSquared = dx * dx + dy * dy
  let t = lengthSquared > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / lengthSquared : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const ex = s.ax + t * dx - px
  const ey = s.ay + t * dy - py
  return ex * ex + ey * ey
}

/** Cell coordinates packed into one number; the offset keeps negative cells distinct. */
function cellKey(cx: number, cy: number): number {
  return (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576)
}

/**
 * Queen contiguity, symmetric by construction. Coordinates are longitude/latitude; they are
 * projected onto a local equirectangular plane so the tolerance is in metres.
 */
export function buildQueenContiguity(
  regions: readonly ContiguityRegion[],
  options: { toleranceMeters?: number } = {},
): ContiguityGraph {
  const toleranceMeters = options.toleranceMeters ?? DEFAULT_CONTIGUITY_TOLERANCE_METERS
  const ids = regions.map((region) => region.id)
  const n = regions.length

  let latSum = 0
  let latCount = 0
  for (const region of regions) {
    for (const ring of ringsOf(region.geometry)) {
      for (const position of ring) {
        latSum += position[1]
        latCount += 1
      }
    }
  }
  const latitude = latCount ? latSum / latCount : 0
  const xScale = METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)
  const yScale = METERS_PER_DEGREE

  const segments: Segment[] = []
  const vertices: Array<{ owner: number; x: number; y: number }> = []
  for (let owner = 0; owner < n; owner += 1) {
    for (const ring of ringsOf(regions[owner].geometry)) {
      for (let k = 0; k < ring.length; k += 1) {
        const x = ring[k][0] * xScale
        const y = ring[k][1] * yScale
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        vertices.push({ owner, x, y })
        if (k + 1 < ring.length) {
          const bx = ring[k + 1][0] * xScale
          const by = ring[k + 1][1] * yScale
          if (Number.isFinite(bx) && Number.isFinite(by)) segments.push({ owner, ax: x, ay: y, bx, by })
        }
      }
    }
  }

  const adjacency: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>())
  if (segments.length) {
    // A cell about the length of a typical segment keeps each lookup to a handful of
    // segments; at least four tolerances wide so a segment's buffer reaches only the
    // cells next to the ones it passes through.
    const lengths = segments.map((s) => Math.hypot(s.bx - s.ax, s.by - s.ay)).sort((a, b) => a - b)
    const cell = Math.max(lengths[Math.floor(lengths.length / 2)], toleranceMeters * 4, 1e-6)
    const grid = new Map<number, number[]>()
    const register = (cx: number, cy: number, index: number) => {
      const key = cellKey(cx, cy)
      const list = grid.get(key)
      if (!list) grid.set(key, [index])
      else if (list[list.length - 1] !== index) list.push(index)
    }
    segments.forEach((s, index) => {
      const minX = Math.floor((Math.min(s.ax, s.bx) - toleranceMeters) / cell)
      const maxX = Math.floor((Math.max(s.ax, s.bx) + toleranceMeters) / cell)
      const minY = Math.floor((Math.min(s.ay, s.by) - toleranceMeters) / cell)
      const maxY = Math.floor((Math.max(s.ay, s.by) + toleranceMeters) / cell)
      if ((maxX - minX + 1) * (maxY - minY + 1) <= 16) {
        for (let cx = minX; cx <= maxX; cx += 1) for (let cy = minY; cy <= maxY; cy += 1) register(cx, cy, index)
        return
      }
      // A long diagonal: walk it in half-cell steps and register the 3x3 block around each
      // step, which covers every point within a tolerance of the segment.
      const length = Math.hypot(s.bx - s.ax, s.by - s.ay)
      const steps = Math.ceil(length / (cell / 2))
      const seen = new Set<number>()
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps
        const cx = Math.floor((s.ax + t * (s.bx - s.ax)) / cell)
        const cy = Math.floor((s.ay + t * (s.by - s.ay)) / cell)
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const key = cellKey(cx + ox, cy + oy)
            if (seen.has(key)) continue
            seen.add(key)
            register(cx + ox, cy + oy, index)
          }
        }
      }
    })

    const toleranceSquared = toleranceMeters * toleranceMeters
    for (const vertex of vertices) {
      const candidates = grid.get(cellKey(Math.floor(vertex.x / cell), Math.floor(vertex.y / cell)))
      if (!candidates) continue
      const linked = adjacency[vertex.owner]
      for (const index of candidates) {
        const segment = segments[index]
        if (segment.owner === vertex.owner || linked.has(segment.owner)) continue
        if (pointSegmentDistanceSquared(vertex.x, vertex.y, segment) <= toleranceSquared) {
          linked.add(segment.owner)
          adjacency[segment.owner].add(vertex.owner)
        }
      }
    }
  }

  const neighbors = adjacency.map((set) => [...set].sort((a, b) => a - b))
  const islands = ids.filter((_, index) => neighbors[index].length === 0)
  return { ids, neighbors, islands, toleranceMeters }
}

/** Row-standardised contiguity weights over the regions that carry a value. */
export interface SpatialWeights {
  /** Analysed region ids, in the order of `values` and `neighbors`. */
  ids: string[]
  values: number[]
  /** Neighbour indices into `ids`; each row's weights are 1 / its neighbour count. */
  neighbors: number[][]
  /** Regions left out because they have no neighbour among the analysed regions. */
  islands: string[]
  /** Regions left out because their value is missing, or that the graph does not hold. */
  missing: string[]
}

/**
 * Restricts the graph to the regions with a finite value. A region whose only neighbours
 * have no value becomes an island; islands carry no spatial information, so they leave
 * the analysis and are reported rather than entering it with a zero row.
 */
export function weightsForValues(
  graph: ContiguityGraph,
  observations: ReadonlyArray<{ id: string; value: number }>,
): SpatialWeights {
  const graphIndex = new Map(graph.ids.map((id, index) => [id, index]))
  const missing: string[] = []
  const candidateGraphIndex: number[] = []
  const candidateValues: number[] = []
  const candidateIds: string[] = []
  const position = new Map<number, number>()
  for (const observation of observations) {
    const index = graphIndex.get(observation.id)
    if (index === undefined || !Number.isFinite(observation.value) || position.has(index)) {
      missing.push(observation.id)
      continue
    }
    position.set(index, candidateIds.length)
    candidateGraphIndex.push(index)
    candidateValues.push(observation.value)
    candidateIds.push(observation.id)
  }

  const islands: string[] = []
  const keptPosition = new Map<number, number>()
  const kept: number[] = []
  candidateGraphIndex.forEach((graphI, candidate) => {
    if (graph.neighbors[graphI].some((graphJ) => position.has(graphJ))) {
      keptPosition.set(graphI, kept.length)
      kept.push(candidate)
    } else {
      islands.push(candidateIds[candidate])
    }
  })

  return {
    ids: kept.map((candidate) => candidateIds[candidate]),
    values: kept.map((candidate) => candidateValues[candidate]),
    neighbors: kept.map((candidate) => {
      const row: number[] = []
      for (const graphJ of graph.neighbors[candidateGraphIndex[candidate]]) {
        const j = keptPosition.get(graphJ)
        if (j !== undefined) row.push(j)
      }
      return row
    }),
    islands,
    missing,
  }
}
