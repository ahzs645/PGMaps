/**
 * Deterministic, bounded terrain-cost routing for preliminary comparison.
 * It searches an eight-neighbour grid, checks sampled ground grade along every
 * edge, and never uses missing elevations as zero. This is neither an equipment
 * feasibility model nor a continuous/global road-optimization algorithm.
 */
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

type XY = [number, number]
type Segment = { a: XY; b: XY; bounds: [number, number, number, number]; avoid: boolean }
/** A blocked exclusion, or a passable zone that adds `costPerM` CAD per metre travelled inside it. */
type Polygon = { rings: XY[][]; bounds: [number, number, number, number]; costPerM: number | null }

export interface RouteSearchOptions {
  /** CAD per metre of road on level ground; steeper sampled grades cost up to 4× this. */
  baseCostPerM: number
  /** CAD per stream crossing. With the base cost this sets how far the route detours to avoid one. */
  crossingCost: number
  /** Degrees clockwise from north; the route leaves the start / reaches the end within ±45°. */
  startHeading: number | null
  endHeading: number | null
  /** Ranked, distinct alternatives to return (1–5). */
  alternatives: number
}
/**
 * The defaults keep the original relative weighting (a crossing worth 80 m of level road). They are
 * planning placeholders, not sourced construction or crossing costs.
 */
export const DEFAULT_ROUTE_OPTIONS: RouteSearchOptions = {
  baseCostPerM: 100,
  crossingCost: 8000,
  startHeading: null,
  endHeading: null,
  alternatives: 1,
}
export interface RouteCandidate {
  coordinates: Coordinate[]
  /** Expected cost under the search's own model, CAD. */
  cost: number
  lengthM: number
  crossings: number
}
const R = 6371008.8
const RAD = Math.PI / 180
const MAX_GRID_SIDE = 96
const MAX_VISITED = 10_000
const MAX_TERRAIN_SAMPLES = 450_000
const MAX_GEOMETRY_CHECKS = 2_000_000
const moves: XY[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
]
const boundsOverlap = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
const xyBounds = (points: XY[]): [number, number, number, number] => [
  Math.min(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[1])),
]

function onSegment(p: XY, a: XY, b: XY) {
  const size = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!size) return Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-7
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
  return (
    Math.abs(cross) / size < 1e-7 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-7
  )
}

function intersects(a: XY, b: XY, c: XY, d: XY) {
  const orient = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const x = orient(a, b, c),
    y = orient(a, b, d),
    u = orient(c, d, a),
    v = orient(c, d, b)
  if (x > 0 !== y > 0 && u > 0 !== v > 0) return true
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
}

function inRing(point: XY, ring: XY[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (onSegment(point, a, b)) return true
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

class MinHeap {
  private items: { node: number; score: number }[] = []
  get length() {
    return this.items.length
  }
  private less(a: { node: number; score: number }, b: { node: number; score: number }) {
    return a.score < b.score || (a.score === b.score && a.node < b.node)
  }
  push(value: { node: number; score: number }) {
    let i = this.items.length
    this.items.push(value)
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2)
      if (!this.less(value, this.items[parent])) break
      this.items[i] = this.items[parent]
      i = parent
    }
    this.items[i] = value
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()
    if (this.items.length && last) {
      let i = 0
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1
        if (child + 1 < this.items.length && this.less(this.items[child + 1], this.items[child])) child++
        if (!this.less(this.items[child], last)) break
        this.items[i] = this.items[child]
        i = child
      }
      this.items[i] = last
    }
    return first
  }
}

export function suggestRoute(
  start: Coordinate,
  end: Coordinate,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
): { coordinates: Coordinate[]; message: string; visited: number } {
  const result = suggestRoutes(start, end, terrain, settings, context)
  return { coordinates: result.routes[0].coordinates, message: result.message, visited: result.visited }
}

export function suggestRoutes(
  start: Coordinate,
  end: Coordinate,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
  input: Partial<RouteSearchOptions> = {},
): { routes: RouteCandidate[]; message: string; visited: number } {
  const options = { ...DEFAULT_ROUTE_OPTIONS, ...input }
  if (!(options.baseCostPerM > 0) || !(options.crossingCost >= 0))
    throw Error('Use a positive road cost per metre and a non-negative crossing cost.')
  const wanted = Math.max(1, Math.min(5, Math.round(options.alternatives)))
  if (
    ![start, end].every(
      (p) => p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) < 85,
    )
  )
    throw Error('Choose valid start and end coordinates for the route suggestion.')
  if (!Number.isFinite(settings.maxGradePercent) || settings.maxGradePercent <= 0 || settings.maxGradePercent > 60)
    throw Error('Use a maximum sampled ground grade greater than 0% and no greater than 60%.')
  const cosLat = Math.cos(((start[1] + end[1]) / 2) * RAD)
  const toXY = (p: Coordinate): XY => [(p[0] - start[0]) * RAD * R * cosLat, (p[1] - start[1]) * RAD * R]
  const toCoordinate = (p: XY): Coordinate => [start[0] + p[0] / (RAD * R * cosLat), start[1] + p[1] / (RAD * R)]
  const target = toXY(end),
    direct = Math.hypot(...target)
  if (direct < 2) throw Error('Place the road endpoints at least 2 m apart.')
  if (direct > 15_000)
    throw Error('Keep each route suggestion within 15 km; split a longer road into planning sections.')
  const margin = Math.max(80, Math.min(1000, direct * 0.35))
  const bounds: [number, number, number, number] = [
    Math.min(0, target[0]) - margin,
    Math.min(0, target[1]) - margin,
    Math.max(0, target[0]) + margin,
    Math.max(0, target[1]) + margin,
  ]
  const spacing = Math.max(2, Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / (MAX_GRID_SIDE - 1))
  const columns = Math.ceil((bounds[2] - bounds[0]) / spacing) + 1,
    rows = Math.ceil((bounds[3] - bounds[1]) / spacing) + 1
  const size = columns * rows
  const cell = (p: XY) => Math.round((p[1] - bounds[1]) / spacing) * columns + Math.round((p[0] - bounds[0]) / spacing)
  const startId = cell([0, 0]),
    endId = cell(target)
  const position = (id: number): XY =>
    id === startId
      ? [0, 0]
      : id === endId
        ? target
        : [bounds[0] + (id % columns) * spacing, bounds[1] + Math.floor(id / columns) * spacing]
  const segments: Segment[] = [],
    polygons: Polygon[] = []
  let vertices = 0,
    geometryChecks = 0,
    samples = 0
  for (const feature of context) {
    if (!['stream', 'avoid'].includes(feature.kind)) continue
    const paths = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    const converted = paths.map((path) => path.map((p) => toXY([p[0], p[1]])))
    vertices += converted.reduce((sum, path) => sum + path.length, 0)
    if (vertices > 20_000)
      throw Error('Crop stream and exclusion inputs to the routing area first (maximum 20,000 vertices).')
    if (!converted.length || !converted[0].length) continue
    const featureBounds = xyBounds(converted[0])
    if (!boundsOverlap(featureBounds, bounds)) continue
    const zoneCost = feature.kind === 'avoid' && Number.isFinite(feature.routeCostPerM) ? feature.routeCostPerM! : null
    if (feature.kind === 'avoid' && feature.geometry.type === 'Polygon')
      polygons.push({ rings: converted, bounds: featureBounds, costPerM: zoneCost })
    // A cost zone's outline is not a wall; only blocked exclusions and streams are edge-tested.
    if (zoneCost !== null) continue
    for (const path of converted)
      for (let i = 1; i < path.length; i++) {
        const edgeBounds = xyBounds([path[i - 1], path[i]])
        if (boundsOverlap(edgeBounds, bounds))
          segments.push({ a: path[i - 1], b: path[i], bounds: edgeBounds, avoid: feature.kind === 'avoid' })
      }
  }
  const geometryBudget = (operations = 1) => {
    geometryChecks += operations
    if (geometryChecks > MAX_GEOMETRY_CHECKS)
      throw Error(
        'The terrain-cost search reached its geometry budget. Crop the constraint layers or use a shorter planning section.',
      )
  }
  // Coarse spatial bins keep local edge checks independent of distant inputs.
  // Both index construction and subsequent geometry operations are budgeted.
  const bucketCount = 12
  const bucketIds = (area: number[]) => {
    const x = (value: number) =>
      Math.max(0, Math.min(bucketCount - 1, Math.floor(((value - bounds[0]) / (bounds[2] - bounds[0])) * bucketCount)))
    const y = (value: number) =>
      Math.max(0, Math.min(bucketCount - 1, Math.floor(((value - bounds[1]) / (bounds[3] - bounds[1])) * bucketCount)))
    const ids: number[] = []
    for (let row = y(area[1]); row <= y(area[3]); row++)
      for (let col = x(area[0]); col <= x(area[2]); col++) ids.push(row * bucketCount + col)
    return ids
  }
  const buckets: number[][] = Array.from({ length: bucketCount * bucketCount }, () => [])
  segments.forEach((segment, index) => {
    for (const id of bucketIds(segment.bounds)) {
      geometryBudget()
      buckets[id].push(index)
    }
  })
  const inside = (p: XY, polygon: Polygon) => {
    if (!boundsOverlap(polygon.bounds, [p[0], p[1], p[0], p[1]])) return false
    geometryBudget(polygon.rings.reduce((sum, ring) => sum + ring.length, 0))
    return inRing(p, polygon.rings[0]) && !polygon.rings.slice(1).some((ring) => inRing(p, ring))
  }
  const excluded = (p: XY) => polygons.some((polygon) => polygon.costPerM === null && inside(p, polygon))
  const zones = polygons.filter((polygon) => polygon.costPerM !== null)
  const zoneCostAt = (p: XY) => zones.reduce((sum, zone) => sum + (inside(p, zone) ? zone.costPerM! : 0), 0)
  const read = (p: XY) => {
    samples++
    if (samples > MAX_TERRAIN_SAMPLES)
      throw Error(
        'The terrain-cost search reached its sampling budget. Use a shorter planning section or revise the grade limit.',
      )
    return terrain.elevationAt(...toCoordinate(p))
  }
  if (excluded([0, 0]) || excluded(target))
    throw Error('A route endpoint is inside an exclusion polygon. Move the endpoint outside the excluded area.')
  const startElevation = read([0, 0]),
    endElevation = read(target)
  if (!Number.isFinite(startElevation) || !Number.isFinite(endElevation))
    throw Error('Both road endpoints need valid terrain coverage.')
  const elevations = new Float64Array(size).fill(NaN),
    loaded = new Uint8Array(size)
  const elevationAt = (id: number) => {
    if (!loaded[id]) {
      const p = position(id)
      elevations[id] = excluded(p) ? NaN : read(p)
      loaded[id] = 1
    }
    return elevations[id]
  }
  const edges = new Map<number, number>()
  const fineBlocked = new Set<number>()
  const edgeKey = (a: number, b: number) => Math.min(a, b) * size + Math.max(a, b)
  const crossingsOf = new Map<number, number>()
  const segmentCost = (a: XY, b: XY, zA: number, zB: number, maxStep: number, key = -1): number => {
    if (!Number.isFinite(zA) || !Number.isFinite(zB)) return Infinity
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 1e-6) return 0
    const edgeBounds: [number, number, number, number] = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]
    let crossings = 0
    const candidates = new Set(bucketIds(edgeBounds).flatMap((id) => buckets[id]))
    for (const index of candidates) {
      geometryBudget()
      const segment = segments[index]
      if (!boundsOverlap(segment.bounds, edgeBounds)) continue
      if (intersects(a, b, segment.a, segment.b)) {
        if (segment.avoid) return Infinity
        crossings++
      }
    }
    const count = Math.max(1, Math.ceil(length / maxStep)),
      distance = length / count
    let previous = zA,
      cost = 0
    for (let i = 1; i <= count; i++) {
      const f = i / count
      const point: XY = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      const elevation = i === count ? zB : read(point)
      if (!Number.isFinite(elevation)) return Infinity
      const grade = (Math.abs(elevation - previous) / distance) * 100
      if (grade > settings.maxGradePercent + 1e-6) return Infinity
      cost += distance * options.baseCostPerM * (1 + 3 * (grade / settings.maxGradePercent) ** 2)
      if (zones.length) {
        const middle: XY = [a[0] + (b[0] - a[0]) * (f - 0.5 / count), a[1] + (b[1] - a[1]) * (f - 0.5 / count)]
        cost += distance * zoneCostAt(middle)
      }
      previous = elevation
    }
    if (key >= 0) crossingsOf.set(key, crossings)
    return cost + crossings * options.crossingCost
  }
  // Headings: the first leg leaves within ±45° of the start heading, the last arrives within ±45° of the end one.
  const headingOk = (from: XY, to: XY, heading: number | null) => {
    if (heading === null || !Number.isFinite(heading)) return true
    const bearing = (Math.atan2(to[0] - from[0], to[1] - from[1]) / RAD + 360) % 360
    const difference = Math.abs(((bearing - heading + 540) % 360) - 180)
    return difference <= 45 + 1e-6
  }
  if (startId === endId) {
    const cost = segmentCost([0, 0], target, startElevation, endElevation, 1)
    if (!Number.isFinite(cost))
      throw Error('The direct connection does not meet the terrain, exclusion and grade constraints.')
    return {
      routes: [{ coordinates: [[...start], [...end]], cost, lengthM: direct, crossings: 0 }],
      message: `Terrain-cost route suggestion: direct connection checked at ≤1 m spacing against a ${settings.maxGradePercent}% ground-grade limit. Review the designed profile and curves separately.`,
      visited: 2,
    }
  }
  let totalVisited = 0
  const budget = 40_000 * wanted
  // Coarse search edges are subsequently checked at <=1 m. If an edge fails,
  // exclude it and rerun; never return a shortcut over a narrow gap or steep step.
  // `used` makes each later alternative pay extra for edges earlier routes took.
  const search = (used: Map<number, number>): number[] | null => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const costs = new Float64Array(size).fill(Infinity),
        parent = new Int32Array(size).fill(-1),
        closed = new Uint8Array(size)
      const heap = new MinHeap()
      costs[startId] = 0
      heap.push({ node: startId, score: direct * options.baseCostPerM })
      let visited = 0,
        found = false
      while (heap.length) {
        const { node } = heap.pop()
        if (closed[node]) continue
        closed[node] = 1
        visited++
        totalVisited++
        if (visited > MAX_VISITED || totalVisited > budget)
          throw Error('The terrain-cost search reached its node budget. Try a shorter planning section.')
        if (node === endId) {
          found = true
          break
        }
        const col = node % columns,
          row = Math.floor(node / columns),
          p = position(node),
          z = elevationAt(node)
        for (const [dc, dr] of moves) {
          const nextCol = col + dc,
            nextRow = row + dr
          if (nextCol < 0 || nextCol >= columns || nextRow < 0 || nextRow >= rows) continue
          const next = nextRow * columns + nextCol
          if (closed[next]) continue
          const key = edgeKey(node, next)
          if (fineBlocked.has(key)) continue
          const q = position(next)
          if (node === startId && !headingOk(p, q, options.startHeading)) continue
          if (next === endId && !headingOk(p, q, options.endHeading)) continue
          let cost = edges.get(key)
          if (cost === undefined) {
            const nextElevation = elevationAt(next)
            cost = segmentCost(p, q, z, nextElevation, Math.min(5, Math.max(0.5, spacing / 5)), key)
            edges.set(key, cost)
          }
          if (!Number.isFinite(cost)) continue
          const nextCost = costs[node] + cost * (1 + 0.6 * (used.get(key) ?? 0))
          if (nextCost >= costs[next]) continue
          costs[next] = nextCost
          parent[next] = node
          heap.push({
            node: next,
            score: nextCost + Math.hypot(q[0] - target[0], q[1] - target[1]) * options.baseCostPerM,
          })
        }
      }
      if (!found) return null
      const path: number[] = []
      for (let node = endId; node >= 0; node = parent[node]) {
        path.push(node)
        if (node === startId) break
      }
      path.reverse()
      let rejected = false
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i]
        if (!Number.isFinite(segmentCost(position(a), position(b), elevationAt(a), elevationAt(b), 1))) {
          fineBlocked.add(edgeKey(a, b))
          rejected = true
        }
      }
      if (!rejected) return path
    }
    throw Error(
      'Candidate paths failed the finer terrain check. Shorten the planning section or inspect the terrain gaps and steep steps; no unverified route was returned.',
    )
  }
  const used = new Map<number, number>()
  const found: { path: number[]; keys: Set<number> }[] = []
  for (let round = 0; round < wanted * 3 && found.length < wanted; round++) {
    const path = search(used)
    if (!path) break
    const keys = new Set(path.slice(1).map((node, i) => edgeKey(path[i], node)))
    for (const key of keys) used.set(key, (used.get(key) ?? 0) + 1)
    // An alternative must differ: no more than 70% of its edges shared with a kept route.
    const distinct = found.every((kept) => [...keys].filter((key) => kept.keys.has(key)).length <= 0.7 * keys.size)
    if (distinct) found.push({ path, keys })
  }
  if (!found.length)
    throw Error(
      `No terrain-cost path in this bounded area meets the ${settings.maxGradePercent}% sampled ground-grade limit${options.startHeading !== null || options.endHeading !== null ? ', the end headings' : ''}, terrain coverage and exclusions. This does not rule out a field-designed road or a wider search.`,
    )
  // Keep the verified grid vertices. Rounding or unconstrained smoothing could
  // move a route into an obstacle or invalidate the grade/coverage checks.
  const routes = found
    .map(({ path }) => {
      let cost = 0,
        lengthM = 0,
        crossings = 0
      for (let i = 1; i < path.length; i++) {
        const key = edgeKey(path[i - 1], path[i])
        cost += edges.get(key) ?? 0
        crossings += crossingsOf.get(key) ?? 0
        const a = position(path[i - 1]),
          b = position(path[i])
        lengthM += Math.hypot(b[0] - a[0], b[1] - a[1])
      }
      const coordinates = path.map((id) => toCoordinate(position(id)))
      coordinates[0] = [...start]
      coordinates[coordinates.length - 1] = [...end]
      return { coordinates, cost, lengthM, crossings }
    })
    .sort((a, b) => a.cost - b.cost)
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`
  return {
    routes,
    message: `Terrain-cost route suggestion${routes.length > 1 ? `s: ${routes.length} ranked alternatives (${routes.map((r) => money(r.cost)).join(', ')})` : ` (${money(routes[0].cost)})`} on a ${spacing.toFixed(1)} m search grid; ${totalVisited.toLocaleString('en-CA')} nodes explored. Segments were checked at ≤1 m spacing against a ${settings.maxGradePercent}% ground-grade limit. Exclusion polygons are blocked; cost zones and stream crossings add their entered costs. Curves, earthworks and engineering feasibility require review.`,
    visited: totalVisited,
  }
}
