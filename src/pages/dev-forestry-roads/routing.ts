/**
 * Deterministic, bounded terrain-cost routing for preliminary comparison.
 * It searches an eight-neighbour grid, checks sampled ground grade along every
 * edge, and never uses missing elevations as zero. This is neither an equipment
 * feasibility model nor a continuous/global road-optimization algorithm.
 */
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

type XY = [number, number]
type Segment = { a: XY; b: XY; bounds: [number, number, number, number]; avoid: boolean; clearance: number }
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
  /** Null disables this sampled 2D terrain-gradient screen; not a terrain-stability assessment. */
  maxTerrainSlopePercent: number | null
  terrainSlopeSampleM: number
  /** Centreline clearance from blocked avoid features; accounts for neither final cut/fill nor clearing. */
  exclusionBufferM: number
  /** Applied only when stream crossings are forbidden. Imported stream geometry is not a surveyed bank. */
  streamBufferM: number
  allowStreamCrossings: boolean
  /** Null uses the bounded default; an explicit margin is 20–1,000 m. */
  searchMarginM: number | null
  /** Discounts only roads individually marked eligible for reuse. It does not establish connectivity or condition. */
  reuseExistingRoads: boolean
  existingRoadCostFactor: number
  roadSnapDistanceM: number
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
  maxTerrainSlopePercent: null,
  terrainSlopeSampleM: 5,
  exclusionBufferM: 0,
  streamBufferM: 0,
  allowStreamCrossings: true,
  searchMarginM: null,
  reuseExistingRoads: false,
  existingRoadCostFactor: 0.4,
  roadSnapDistanceM: 8,
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

function pointSegmentDistance(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const denominator = dx * dx + dy * dy
  const t = denominator ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function segmentDistance(a: XY, b: XY, c: XY, d: XY) {
  if (intersects(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

const expandBounds = (bounds: [number, number, number, number], distance: number): [number, number, number, number] => [
  bounds[0] - distance,
  bounds[1] - distance,
  bounds[2] + distance,
  bounds[3] + distance,
]

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

/** Validates portable route assumptions, retaining defaults for fields absent in older projects. */
export function parseRouteSearchOptions(input?: unknown): RouteSearchOptions {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw Error('Route search settings must be an object.')
  const values = input as Record<string, unknown> | undefined
  const options = Object.fromEntries(
    Object.entries(DEFAULT_ROUTE_OPTIONS).map(([key, fallback]) => [
      key,
      values?.[key] === undefined ? fallback : values[key],
    ]),
  ) as unknown as RouteSearchOptions
  if (
    !Number.isFinite(options.baseCostPerM) ||
    !Number.isFinite(options.crossingCost) ||
    !(options.baseCostPerM > 0) ||
    !(options.crossingCost >= 0)
  )
    throw Error('Use a positive road cost per metre and a non-negative crossing cost.')
  const finiteRange = (value: number, min: number, max: number) =>
    Number.isFinite(value) && value >= min && value <= max
  if (!finiteRange(options.exclusionBufferM, 0, 500) || !finiteRange(options.streamBufferM, 0, 500))
    throw Error('Use stream and exclusion clearances between 0 and 500 m.')
  if (options.maxTerrainSlopePercent !== null && !finiteRange(options.maxTerrainSlopePercent, 1, 300))
    throw Error('Use a terrain-slope limit between 1% and 300%, or leave it off.')
  if (!finiteRange(options.terrainSlopeSampleM, 1, 100))
    throw Error('Use a terrain-slope sample distance between 1 and 100 m.')
  if (options.searchMarginM !== null && !finiteRange(options.searchMarginM, 20, 1000))
    throw Error('Use a search margin between 20 and 1,000 m, or leave it automatic.')
  if (!finiteRange(options.existingRoadCostFactor, 0.05, 1) || !finiteRange(options.roadSnapDistanceM, 1, 50))
    throw Error('Use an existing-road cost factor of 0.05–1 and a proximity distance of 1–50 m.')
  if (!finiteRange(options.alternatives, 1, 5) || !Number.isInteger(options.alternatives))
    throw Error('Use 1–5 whole route alternatives.')
  if (typeof options.allowStreamCrossings !== 'boolean' || typeof options.reuseExistingRoads !== 'boolean')
    throw Error('Route crossing and road reuse switches must be true or false.')
  for (const heading of [options.startHeading, options.endHeading])
    if (heading !== null && !finiteRange(heading, 0, 360))
      throw Error('Use headings between 0° and 360°, or leave them off.')
  return options
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
  const options = parseRouteSearchOptions(input)
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
  const margin = options.searchMarginM ?? Math.max(80, Math.min(1000, direct * 0.35))
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
    polygons: Polygon[] = [],
    reusableRoads: { a: XY; b: XY; bounds: [number, number, number, number] }[] = []
  let vertices = 0,
    geometryChecks = 0,
    samples = 0
  for (const feature of context) {
    const reusable =
      options.reuseExistingRoads &&
      feature.kind === 'existing-road' &&
      feature.roadEvidence?.reuseAllowed === true &&
      feature.roadEvidence.condition !== 'closed'
    if (!['stream', 'avoid'].includes(feature.kind) && !reusable) continue
    const paths = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    const converted = paths.map((path) => path.map((p) => toXY([p[0], p[1]])))
    vertices += converted.reduce((sum, path) => sum + path.length, 0)
    if (vertices > 20_000)
      throw Error('Crop stream and exclusion inputs to the routing area first (maximum 20,000 vertices).')
    if (!converted.length || !converted[0].length) continue
    const featureBounds = xyBounds(converted[0])
    const clearance =
      feature.kind === 'avoid' ? options.exclusionBufferM : !options.allowStreamCrossings ? options.streamBufferM : 0
    if (!boundsOverlap(expandBounds(featureBounds, reusable ? options.roadSnapDistanceM : clearance), bounds)) continue
    if (reusable) {
      for (const path of converted)
        for (let i = 1; i < path.length; i++)
          reusableRoads.push({
            a: path[i - 1],
            b: path[i],
            bounds: expandBounds(xyBounds([path[i - 1], path[i]]), options.roadSnapDistanceM),
          })
      continue
    }
    const zoneCost = feature.kind === 'avoid' && Number.isFinite(feature.routeCostPerM) ? feature.routeCostPerM! : null
    if (feature.kind === 'avoid' && feature.geometry.type === 'Polygon')
      polygons.push({ rings: converted, bounds: featureBounds, costPerM: zoneCost })
    // A cost zone's outline is not a wall; only blocked exclusions and streams are edge-tested.
    if (zoneCost !== null) continue
    for (const path of converted)
      for (let i = 1; i < path.length; i++) {
        const edgeBounds = expandBounds(xyBounds([path[i - 1], path[i]]), clearance)
        if (boundsOverlap(edgeBounds, bounds))
          segments.push({
            a: path[i - 1],
            b: path[i],
            bounds: edgeBounds,
            avoid: feature.kind === 'avoid' || !options.allowStreamCrossings,
            clearance,
          })
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
  const roadBuckets: number[][] = Array.from({ length: bucketCount * bucketCount }, () => [])
  reusableRoads.forEach((segment, index) => {
    for (const id of bucketIds(segment.bounds)) {
      geometryBudget()
      roadBuckets[id].push(index)
    }
  })
  const reuseFactorAt = (point: XY) => {
    if (!reusableRoads.length) return 1
    for (const index of roadBuckets[bucketIds([point[0], point[1], point[0], point[1]])[0]]) {
      geometryBudget()
      const segment = reusableRoads[index]
      if (pointSegmentDistance(point, segment.a, segment.b) <= options.roadSnapDistanceM)
        return options.existingRoadCostFactor
    }
    return 1
  }
  const heuristicCostPerM = options.baseCostPerM * (reusableRoads.length ? options.existingRoadCostFactor : 1)
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
  const nearBlockedFeature = (point: XY) => {
    const area: [number, number, number, number] = [point[0], point[1], point[0], point[1]]
    for (const index of buckets[bucketIds(area)[0]]) {
      const segment = segments[index]
      if (!segment.avoid || !boundsOverlap(segment.bounds, area)) continue
      geometryBudget()
      if (pointSegmentDistance(point, segment.a, segment.b) <= segment.clearance + 1e-7) return true
    }
    return false
  }
  if (excluded([0, 0]) || excluded(target))
    throw Error('A route endpoint is inside an exclusion polygon. Move the endpoint outside the excluded area.')
  if (nearBlockedFeature([0, 0]) || nearBlockedFeature(target))
    throw Error('A route endpoint violates an exclusion or stream clearance. Move it outside the blocked corridor.')
  const startElevation = read([0, 0]),
    endElevation = read(target)
  if (!Number.isFinite(startElevation) || !Number.isFinite(endElevation))
    throw Error('Both road endpoints need valid terrain coverage.')
  const terrainSlopeOk = (point: XY) => {
    if (options.maxTerrainSlopePercent === null) return true
    const d = options.terrainSlopeSampleM
    const west = read([point[0] - d, point[1]]),
      east = read([point[0] + d, point[1]]),
      south = read([point[0], point[1] - d]),
      north = read([point[0], point[1] + d])
    return (
      [west, east, south, north].every(Number.isFinite) &&
      (Math.hypot(east - west, north - south) / (2 * d)) * 100 <= options.maxTerrainSlopePercent + 1e-6
    )
  }
  if (!terrainSlopeOk([0, 0]) || !terrainSlopeOk(target))
    throw Error('A route endpoint has missing terrain-slope coverage or exceeds the sampled terrain-slope limit.')
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
      if (segment.avoid && segmentDistance(a, b, segment.a, segment.b) <= segment.clearance + 1e-7) return Infinity
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
      if (!Number.isFinite(elevation) || !terrainSlopeOk(point)) return Infinity
      const grade = (Math.abs(elevation - previous) / distance) * 100
      if (grade > settings.maxGradePercent + 1e-6) return Infinity
      const middle: XY = [a[0] + (b[0] - a[0]) * (f - 0.5 / count), a[1] + (b[1] - a[1]) * (f - 0.5 / count)]
      cost +=
        distance * options.baseCostPerM * reuseFactorAt(middle) * (1 + 3 * (grade / settings.maxGradePercent) ** 2)
      if (zones.length) {
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
    const cost = segmentCost([0, 0], target, startElevation, endElevation, 1, 0)
    if (
      !Number.isFinite(cost) ||
      !headingOk([0, 0], target, options.startHeading) ||
      !headingOk([0, 0], target, options.endHeading)
    )
      throw Error('The direct connection does not meet the terrain, heading, clearance and grade constraints.')
    return {
      routes: [{ coordinates: [[...start], [...end]], cost, lengthM: direct, crossings: crossingsOf.get(0) ?? 0 }],
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
      heap.push({ node: startId, score: direct * heuristicCostPerM })
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
            score: nextCost + Math.hypot(q[0] - target[0], q[1] - target[1]) * heuristicCostPerM,
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
      `No terrain-cost path in this bounded area meets the ${settings.maxGradePercent}% sampled ground-grade limit${options.startHeading !== null || options.endHeading !== null ? ', the end headings' : ''}, terrain coverage, slope and clearance constraints. This does not rule out a field-designed road or a wider search.`,
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
    message: `Terrain-cost route suggestion${routes.length > 1 ? `s: ${routes.length} ranked alternatives (${routes.map((r) => money(r.cost)).join(', ')})` : ` (${money(routes[0].cost)})`} on a ${spacing.toFixed(1)} m search grid; ${totalVisited.toLocaleString('en-CA')} nodes explored. Segments were checked at ≤1 m spacing against a ${settings.maxGradePercent}% ground-grade limit. Exclusions use ${options.exclusionBufferM} m centreline clearance; stream crossings are ${options.allowStreamCrossings ? 'priced' : `blocked with ${options.streamBufferM} m clearance`}.${options.maxTerrainSlopePercent === null ? '' : ` Sampled terrain gradient ≤${options.maxTerrainSlopePercent}% over ±${options.terrainSlopeSampleM} m.`}${reusableRoads.length ? ` Reviewed road corridors within ${options.roadSnapDistanceM} m use ${options.existingRoadCostFactor}× road cost; proximity does not establish connection or usability.` : ''} Cost zones add their entered costs. Curves, earthworks and engineering feasibility require review.`,
    visited: totalVisited,
  }
}
