/**
 * Bounded, deterministic horizontal road-corridor search. The exact tangent/arc
 * geometry is retained as editable PIs and radii, not replaced by unverified
 * straight chords. Ground grades are a reconnaissance screen, NOT designed
 * formation grades. No geology, hydraulic adequacy or road approval is inferred.
 */
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

export type RoadOptimizationObjective = 'shortest' | 'balanced' | 'contour'
export interface RoadOptimizationOptions {
  objective: RoadOptimizationObjective
  corridorHalfWidthM: number
  /** Centreline clearance to supplied exclusions, not an inferred legal buffer. */
  avoidanceClearanceM?: number
  /** Optional directional ground limits in the start -> end direction. */
  maxUphillGradePercent?: number
  maxDownhillGradePercent?: number
  /** Smaller budgets can be used in tests or on constrained devices. */
  maxStates?: number
  maxTerrainSamples?: number
}
export interface CorridorMetrics {
  lengthM: number
  maxSampledGroundPitchPercent: number
  groundAscentM: number
  groundDescentM: number
  excessVerticalM: number
  streamContacts: number
  complete: boolean
}
export interface RoadOptimizationResult extends CorridorMetrics {
  /** Sampled ACTUAL centreline, suitable for comparison/export, not PI controls. */
  coordinates: Coordinate[]
  controlPoints: Array<{ coordinate: Coordinate; radiusM: number }>
  profile: Array<{ stationM: number; elevationM: number }>
  baseline: CorridorMetrics
  directM: number
  explored: number
  terrainSamples: number
  minimumRadiusM: number | null
  nominalTurnRadiusM: number
  sampleStepM: number
  searchCellM: number
  objectiveCost: number
  searchStatus: 'complete' | 'budget-limited'
  warnings: string[]
  message: string
}
export interface CorridorProgress { explored: number; terrainSamples: number }
export interface CorridorRunControl {
  signal?: AbortSignal
  onProgress?: (progress: CorridorProgress) => void
}
type XY = [number, number]
type Piece = { a: XY; heading: number; length: number; curvature: number }
type RecordNode = {
  at: XY; heading: number; cost: number; parent: number; pieces: Piece[]; length: number; key: number
}
type Segment = { a: XY; b: XY; stream: string | null; bounds: number[] }
const R = 6371008.8, RAD = Math.PI / 180, TAU = 2 * Math.PI
const BINS = 32, TURN = TAU / BINS, STEP = 1, LEAD = 2
const EPS = 1e-7
const profiles = {
  shortest: { grade: 0.05, vertical: 0.5, turn: 0.1, guide: 0.1 },
  balanced: { grade: 1.5, vertical: 12, turn: 0.4, guide: 0.15 },
  contour: { grade: 4, vertical: 45, turn: 0.6, guide: 0.1 },
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const norm = (p: XY) => Math.hypot(...p)
const delta = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const advance = (p: XY, heading: number, length: number): XY =>
  [p[0] + Math.cos(heading) * length, p[1] + Math.sin(heading) * length]
const mod = (angle: number) => ((angle % TAU) + TAU) % TAU
const validCoordinate = (p: unknown): p is Coordinate => Array.isArray(p) && p.length === 2 &&
  p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) < 85

/** Same spherical azimuthal-equidistant frame used by the road geometry engine. */
export function corridorFrame(origin: Coordinate) {
  const toXY = (p: Coordinate): XY => {
    const dlat = (p[1] - origin[1]) * RAD, dlon = (p[0] - origin[0]) * RAD
    const lat = origin[1] * RAD, q = p[1] * RAD
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat) * Math.cos(q) * Math.sin(dlon / 2) ** 2
    const d = 2 * R * Math.asin(Math.sqrt(clamp(h, 0, 1)))
    const b = Math.atan2(Math.sin(dlon) * Math.cos(q), Math.cos(lat) * Math.sin(q) - Math.sin(lat) * Math.cos(q) * Math.cos(dlon))
    return [d * Math.sin(b), d * Math.cos(b)]
  }
  const fromXY = (p: XY): Coordinate => {
    if (norm(p) < 1e-10) return [...origin]
    const b = Math.atan2(p[0], p[1]), d = norm(p) / R, lat = origin[1] * RAD
    const q = Math.asin(clamp(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b), -1, 1))
    const lon = origin[0] * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(q))
    return [((lon / RAD + 540) % 360) - 180, q / RAD]
  }
  return { toXY, fromXY }
}
function piecePoint(p: Piece, t: number): XY {
  const angle = p.curvature * p.length * t, distance = p.length * t
  const scale = Math.abs(angle) < 1e-10 ? 1 : Math.sin(angle / 2) / (angle / 2)
  return advance(p.a, p.heading + angle / 2, distance * scale)
}
function segmentDistance(p: XY, a: XY, b: XY) {
  const v = delta(b, a), q = delta(p, a)
  const t = clamp((q[0] * v[0] + q[1] * v[1]) / Math.max(1e-24, v[0] ** 2 + v[1] ** 2), 0, 1)
  return Math.hypot(q[0] - t * v[0], q[1] - t * v[1])
}
function touches(a: XY, b: XY, c: XY, d: XY) {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const x = o(a, b, c), y = o(a, b, d), u = o(c, d, a), v = o(c, d, b)
  return (((x > 0) !== (y > 0)) && ((u > 0) !== (v > 0))) ||
    Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b)) < EPS
}
function segmentSeparation(a: XY, b: XY, c: XY, d: XY) {
  return touches(a, b, c, d) ? 0 : Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b))
}
function inRing(p: XY, ring: XY[]) {
  let yes = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i]
    if (segmentDistance(p, a, b) <= EPS) return true
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes
  }
  return yes
}
const bounds = (a: XY, b: XY, pad = 0) => [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad]
const overlaps = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
class Queue {
  private values: Array<{ id: number; f: number }> = []
  private less(a: { id: number; f: number }, b: { id: number; f: number }) { return a.f < b.f || (a.f === b.f && a.id < b.id) }
  push(value: { id: number; f: number }) {
    let i = this.values.length; this.values.push(value)
    while (i) { const p = (i - 1) >> 1; if (!this.less(value, this.values[p])) break; this.values[i] = this.values[p]; i = p }
    this.values[i] = value
  }
  pop() {
    const first = this.values[0], last = this.values.pop()
    if (last && this.values.length) {
      let i = 0
      while (2 * i + 1 < this.values.length) {
        let c = 2 * i + 1
        if (c + 1 < this.values.length && this.less(this.values[c + 1], this.values[c])) c++
        if (!this.less(this.values[c], last)) break
        this.values[i] = this.values[c]; i = c
      }
      this.values[i] = last
    }
    return first
  }
  get length() { return this.values.length }
}

/** Forward-only straight/arc/tangent connection to an exact endpoint. */
function goalConnections(at: XY, heading: number, end: XY, minRadius: number): Piece[][] {
  const v = delta(end, at), along = v[0] * Math.cos(heading) + v[1] * Math.sin(heading)
  const across = -v[0] * Math.sin(heading) + v[1] * Math.cos(heading)
  const results: Piece[][] = []
  if (along > EPS && Math.abs(across) < 1e-6) results.push([{ a: at, heading, length: norm(v), curvature: 0 }])
  const entry = advance(at, heading, LEAD)
  for (const radius of [minRadius, minRadius * 2]) for (const sign of [-1, 1]) {
    const centre = advance(entry, heading + sign * Math.PI / 2, radius)
    const w = delta(end, centre), d = norm(w)
    if (d <= radius + LEAD) continue
    const phi = Math.atan2(w[1], w[0]), alpha = Math.acos(radius / d)
    const initial = heading - sign * Math.PI / 2
    for (const angle of [phi - alpha, phi + alpha]) {
      const tangent = advance(centre, angle, radius), tangentHeading = angle + sign * Math.PI / 2
      const tail = delta(end, tangent), tailLength = norm(tail)
      if (tailLength < LEAD || tail[0] * Math.cos(tangentHeading) + tail[1] * Math.sin(tangentHeading) <= 0) continue
      const sweep = mod(sign * (angle - initial))
      if (sweep < 1e-7 || sweep > Math.PI * 0.9) continue
      results.push([
        { a: at, heading, length: LEAD, curvature: 0 },
        { a: entry, heading, length: radius * sweep, curvature: sign / radius },
        { a: tangent, heading: tangentHeading, length: tailLength, curvature: 0 },
      ])
    }
  }
  return results
}

function* search(
  guide: Coordinate[], terrain: TerrainSource, settings: RoadSettings, context: ContextFeature[],
  options: RoadOptimizationOptions, control: CorridorRunControl = {},
): Generator<CorridorProgress, RoadOptimizationResult> {
  if (!Array.isArray(guide) || guide.length < 2 || guide.length > 100 || !guide.every(validCoordinate)) throw Error('Sketch between 2 and 100 valid road points.')
  if (!Object.prototype.hasOwnProperty.call(profiles, options.objective)) throw Error('Choose a valid optimization preference.')
  const width = options.corridorHalfWidthM, clearance = options.avoidanceClearanceM ?? 0
  const uphill = options.maxUphillGradePercent ?? settings.maxGradePercent
  const downhill = options.maxDownhillGradePercent ?? settings.maxGradePercent
  if (!Number.isFinite(width) || width < 25 || width > 1000) throw Error('Corridor half-width must be 25–1,000 m.')
  if (!Number.isFinite(clearance) || clearance < 0 || clearance >= width) throw Error('Exclusion clearance must be non-negative and smaller than the corridor half-width.')
  if (![uphill, downhill].every(x => Number.isFinite(x) && x >= 1 && x <= 30)) throw Error('Ground-grade screening limits must be between 1% and 30%.')
  if (!Number.isFinite(settings.minRadius) || settings.minRadius < 5 || settings.minRadius > 1000) throw Error('Minimum radius must be 5–1,000 m.')
  const maxStates = options.maxStates ?? 50000, maxSamples = options.maxTerrainSamples ?? 3500000
  if (!Number.isInteger(maxStates) || maxStates < 1 || maxStates > 70000 || !Number.isInteger(maxSamples) || maxSamples < 100 || maxSamples > 5000000) throw Error('Invalid search budget.')
  const frame = corridorFrame(guide[0]), sketch = guide.map(frame.toXY), end = sketch[sketch.length - 1]
  const direct = norm(end)
  const sketchLength = sketch.slice(1).reduce((s, p, i) => s + norm(delta(p, sketch[i])), 0)
  if (direct < 10 || direct > 5000 || sketch.some(p => norm(p) > 7000) || sketchLength > 15000) throw Error('Use distinct endpoints 10 m–5 km apart and keep the entire sketch within a 7 km planning area.')
  if (sketch.slice(1).some((p, i) => norm(delta(p, sketch[i])) < 0.01)) throw Error('Remove coincident consecutive guide points.')
  const box = [Math.min(...sketch.map(p => p[0])) - width, Math.min(...sketch.map(p => p[1])) - width, Math.max(...sketch.map(p => p[0])) + width, Math.max(...sketch.map(p => p[1])) + width]
  const cell = Math.max(3, (box[2] - box[0]) / 140, (box[3] - box[1]) / 140)
  const columns = Math.ceil((box[2] - box[0]) / cell) + 1, rows = Math.ceil((box[3] - box[1]) / cell) + 1
  const step = Math.max(12, cell * 2), turn = Math.min(TURN * 2, step / settings.minRadius)
  const turnRadius = step / turn
  const segments: Segment[] = [], polygons: Array<{ rings: XY[][]; box: number[] }> = []
  let vertices = 0, operations = 0, calls = 0, explored = 0
  const abort = () => { if (control.signal?.aborted) throw new DOMException('Road optimization cancelled.', 'AbortError') }
  const geometryBudget = (n = 1) => { operations += n; if (operations > 15000000) throw Error('Exclusion geometry budget reached; crop the constraint layers.') }
  for (const feature of context) {
    if (feature.kind !== 'stream' && feature.kind !== 'avoid') continue
    const raw = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    const paths = raw.map(path => path.map(p => {
      if (!validCoordinate(p.slice(0, 2))) throw Error('Constraint coordinates must be finite longitude/latitude pairs.')
      return frame.toXY([p[0], p[1]])
    }))
    vertices += paths.reduce((s, p) => s + p.length, 0)
    if (vertices > 20000) throw Error('Crop stream/exclusion inputs to 20,000 vertices or fewer.')
    if (!paths.length || !paths[0].length) throw Error('Empty constraint geometry.')
    const all = paths.flat(), b = [Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1]))]
    if (!overlaps(b, [box[0] - clearance, box[1] - clearance, box[2] + clearance, box[3] + clearance])) continue
    if (feature.geometry.type === 'Polygon') {
      if (paths.some(p => p.length < 3)) throw Error('Exclusion rings need at least three vertices.')
      for (const ring of paths) if (norm(delta(ring[0], ring[ring.length - 1])) > EPS) ring.push([...ring[0]])
      if (feature.kind === 'avoid') polygons.push({ rings: paths, box: b })
    }
    for (const path of paths) for (let i = 1; i < path.length; i++) segments.push({ a: path[i - 1], b: path[i], stream: feature.kind === 'stream' ? feature.id : null, bounds: bounds(path[i - 1], path[i]) })
  }
  // Spatial buckets bound work for local obstacle checks; no broad-phase omission.
  const buckets = new Map<string, number[]>(), bucketSize = Math.max(25, Math.max(box[2] - box[0], box[3] - box[1]) / 20)
  const bucketKeys = (b: number[]) => {
    const keys: string[] = []
    for (let y = Math.floor(b[1] / bucketSize); y <= Math.floor(b[3] / bucketSize); y++)
      for (let x = Math.floor(b[0] / bucketSize); x <= Math.floor(b[2] / bucketSize); x++) { geometryBudget(); keys.push(x + ',' + y) }
    return keys
  }
  segments.forEach((s, i) => {
    const b = [Math.max(box[0] - clearance - 1, s.bounds[0]), Math.max(box[1] - clearance - 1, s.bounds[1]), Math.min(box[2] + clearance + 1, s.bounds[2]), Math.min(box[3] + clearance + 1, s.bounds[3])]
    if (b[0] > b[2] || b[1] > b[3]) return
    for (const key of bucketKeys(b)) { const ids = buckets.get(key) ?? []; ids.push(i); buckets.set(key, ids) }
  })
  const guideOffset = (p: XY) => {
    geometryBudget(sketch.length)
    let min = Infinity
    for (let i = 1; i < sketch.length; i++) min = Math.min(min, segmentDistance(p, sketch[i - 1], sketch[i]))
    return min
  }
  const pointAllowed = (p: XY, margin = 0) => {
    if (p[0] < box[0] || p[1] < box[1] || p[0] > box[2] || p[1] > box[3] || guideOffset(p) + margin > width + EPS) return false
    return !polygons.some(poly => {
      if (!overlaps(poly.box, [...p, ...p])) return false
      geometryBudget(poly.rings.reduce((s, r) => s + r.length, 0))
      return inRing(p, poly.rings[0]) && !poly.rings.slice(1).some(hole => inRing(p, hole))
    })
  }
  const segmentAllowed = (a: XY, b: XY, sagitta: number, contacts: Set<string>, enforce = true) => {
    const area = bounds(a, b, clearance + sagitta + EPS)
    const candidates = new Set(bucketKeys(area).flatMap(key => buckets.get(key) ?? []))
    for (const index of candidates) {
      geometryBudget()
      const s = segments[index]
      if (!overlaps(area, s.bounds)) continue
      const separation = segmentSeparation(a, b, s.a, s.b)
      if (enforce && s.stream === null && separation <= clearance + sagitta + EPS) return false
      if (s.stream !== null && separation <= sagitta + EPS) contacts.add(s.stream)
    }
    return true
  }
  const cache = new Map<string, number>()
  const read = (p: XY, fresh = false) => {
    abort()
    // No coordinate rounding: narrow missing cells must not be replaced by a nearby height.
    const key = p[0] + ',' + p[1]
    if (!fresh && cache.has(key)) return cache.get(key)!
    if (++calls > maxSamples) throw Error('Terrain sampling budget reached; narrow the corridor or shorten the road.')
    const z = terrain.elevationAt(...frame.fromXY(p))
    if (cache.size < 200000) cache.set(key, z)
    return z
  }
  const endpointsZ = [read([0, 0]), read(end)]
  if (!endpointsZ.every(Number.isFinite)) throw Error('Both road endpoints need valid terrain elevations.')
  if (!pointAllowed([0, 0]) || !pointAllowed(end) || !segmentAllowed([0, 0], [0, 0], 0, new Set()) || !segmentAllowed(end, end, 0, new Set())) throw Error('An endpoint is inside or too close to an exclusion.')
  const weights = profiles[options.objective]
  type Evaluation = { cost: number; metrics: CorridorMetrics; points: XY[]; profile: Array<{ stationM: number; elevationM: number }> }
  const evaluate = (pieces: Piece[], strict: boolean, collect = false, fresh = false): Evaluation | null => {
    let length = 0, cost = 0, rise = 0, fall = 0, peak = 0, complete = true
    const contacts = new Set<string>(), points: XY[] = [], elevationProfile: Evaluation['profile'] = []
    let firstZ = NaN, lastZ = NaN
    for (const piece of pieces) {
      const count = Math.max(1, Math.ceil(piece.length / STEP)), ds = piece.length / count
      let previous = piece.a, zBefore = read(previous, fresh)
      if (!Number.isFinite(firstZ)) firstZ = zBefore
      if (!Number.isFinite(zBefore)) { complete = false; if (strict) return null }
      if (strict && (!pointAllowed(previous) || !segmentAllowed(previous, previous, 0, contacts))) return null
      if (collect && points.length === 0) { points.push(previous); elevationProfile.push({ stationM: length, elevationM: zBefore }) }
      for (let i = 1; i <= count; i++) {
        const at = piecePoint(piece, i / count), sagitta = piece.curvature ? Math.abs((1 / piece.curvature) * (1 - Math.cos(piece.curvature * ds / 2))) : 0
        // Distance-to-guide is 1-Lipschitz. This margin conservatively guards
        // the entire subarc, not only its sampled vertices.
        if (strict && (!pointAllowed(at, ds / 2) || !pointAllowed(previous, ds / 2) || !segmentAllowed(previous, at, sagitta, contacts))) return null
        if (!strict) segmentAllowed(previous, at, sagitta, contacts, false)
        const z = read(at, fresh)
        if (!Number.isFinite(z) || !Number.isFinite(zBefore)) { complete = false; if (strict) return null }
        else {
          const dz = z - zBefore, grade = dz / ds * 100, limit = grade >= 0 ? uphill : downhill
          if (strict && Math.abs(grade) > limit + 1e-5) return null
          peak = Math.max(peak, Math.abs(grade)); rise += Math.max(0, dz); fall += Math.max(0, -dz)
          cost += ds * (1 + weights.grade * (grade / limit) ** 2) + weights.vertical * Math.abs(dz)
        }
        cost += ds * weights.guide * (guideOffset(at) / width) ** 2
        length += ds
        if (collect) { points.push(at); elevationProfile.push({ stationM: length, elevationM: z }) }
        previous = at; zBefore = z; lastZ = z
      }
      cost += piece.length * weights.turn * Math.abs(piece.curvature) * settings.minRadius
    }
    cost += contacts.size * 150
    return { cost, points, profile: elevationProfile, metrics: { lengthM: length, maxSampledGroundPitchPercent: peak, groundAscentM: rise, groundDescentM: fall, excessVerticalM: complete ? Math.max(0, rise + fall - Math.abs(lastZ - firstZ)) : NaN, streamContacts: contacts.size, complete } }
  }
  const baselinePieces: Piece[] = sketch.slice(1).map((p, i) => ({ a: sketch[i], heading: Math.atan2(p[1] - sketch[i][1], p[0] - sketch[i][0]), length: norm(delta(p, sketch[i])), curvature: 0 }))
  const baseline = evaluate(baselinePieces, false)!.metrics
  const keyOf = (p: XY, heading: number) => {
    const col = Math.round((p[0] - box[0]) / cell), row = Math.round((p[1] - box[1]) / cell)
    if (col < 0 || row < 0 || col >= columns || row >= rows) return -1
    return (row * columns + col) * BINS + Math.round(mod(heading) / TURN) % BINS
  }
  const records: RecordNode[] = [], best = new Map<number, number>(), heap = new Queue()
  const enqueue = (record: RecordNode) => {
    const old = best.get(record.key)
    if (old !== undefined && records[old].cost <= record.cost + EPS) return
    const id = records.length; records.push(record); best.set(record.key, id)
    heap.push({ id, f: record.cost + norm(delta(end, record.at)) })
  }
  const headings = [Math.atan2(end[1], end[0]), Math.atan2(sketch[1][1], sketch[1][0]), ...Array.from({ length: BINS }, (_, i) => i * TURN)]
  for (const heading of headings) enqueue({ at: [0, 0], heading, cost: 0, parent: -1, pieces: [], length: 0, key: keyOf([0, 0], heading) })
  let goal = -1, goalCost = Infinity, status: RoadOptimizationResult['searchStatus'] = 'complete'
  const reconstruct = (id: number): Piece[] => {
    const blocks: Piece[][] = []
    for (let count = 0; id >= 0; count++) {
      if (count > 2000) throw Error('Candidate exceeds the control-point budget.')
      const p = records[id]; blocks.push(p.pieces); id = p.parent
    }
    return blocks.reverse().flat()
  }
  yield { explored, terrainSamples: calls }
  while (heap.length) {
    abort()
    const top = heap.pop()!
    const p = records[top.id]
    if (best.get(p.key) !== top.id) continue // immutable records prevent stale-parent corruption
    if (top.f >= goalCost - EPS) break
    if (++explored > maxStates) { if (goal < 0) throw Error('Search budget reached without a verified candidate; widen or revise the guide.'); status = 'budget-limited'; break }
    if (explored % 96 === 0) yield { explored, terrainSamples: calls }
    const remaining = norm(delta(end, p.at))
    // Direct initial alignment and local, tangent goal connections are checked
    // with exactly the same grade, obstacle and terrain rules as all other edges.
    if (p.parent === -1 || remaining < step * 4 + settings.minRadius * 2) {
      for (const connection of goalConnections(p.at, p.heading, end, settings.minRadius)) {
        const addedLength = connection.reduce((s, x) => s + x.length, 0)
        if (p.cost + addedLength >= goalCost) continue
        const checked = evaluate(connection, true)
        if (!checked || p.cost + checked.cost >= goalCost) continue
        goal = records.length; goalCost = p.cost + checked.cost
        records.push({ at: end, heading: 0, cost: goalCost, parent: top.id, pieces: connection, length: p.length + addedLength, key: -1 })
      }
    }
    for (const turnAngle of [-turn, -turn / 2, 0, turn / 2, turn]) {
      const pieces: Piece[] = turnAngle === 0 ? [{ a: p.at, heading: p.heading, length: step, curvature: 0 }] : [
        { a: p.at, heading: p.heading, length: LEAD, curvature: 0 },
        { a: advance(p.at, p.heading, LEAD), heading: p.heading, length: step, curvature: turnAngle / step },
      ]
      const heading = mod(p.heading + turnAngle)
      if (turnAngle !== 0) pieces.push({ a: piecePoint(pieces[1], 1), heading, length: LEAD, curvature: 0 })
      const next = piecePoint(pieces[pieces.length - 1], 1), key = keyOf(next, heading)
      const length = p.length + pieces.reduce((s, v) => s + v.length, 0)
      if (key < 0 || key === p.key || length > Math.min(15000, sketchLength * 3 + width * 4) || !pointAllowed(next)) continue
      const existing = best.get(key)
      if (existing !== undefined && records[existing].cost <= p.cost + step) continue
      const edge = evaluate(pieces, true)
      if (!edge || p.cost + edge.cost + norm(delta(end, next)) >= goalCost) continue
      enqueue({ at: next, heading, cost: p.cost + edge.cost, parent: top.id, pieces, length, key })
    }
  }
  if (goal < 0) throw Error('No verified candidate in this corridor meets the sampled ground-grade, radius, terrain and exclusion checks. This is not proof that a field-designed road is impossible.')
  const pieces = reconstruct(goal)
  // Independent final pass uses fresh samples on the exact geometry we return.
  const final = evaluate(pieces, true, true, true)
  if (!final) throw Error('Candidate failed final geometry/terrain verification; no road was changed.')
  const controls: RoadOptimizationResult['controlPoints'] = [{ coordinate: [...guide[0]], radiusM: 0 }]
  for (const piece of pieces) if (piece.curvature) {
    const radius = 1 / Math.abs(piece.curvature), sweep = Math.abs(piece.length * piece.curvature)
    const pi = advance(piece.a, piece.heading, radius * Math.tan(sweep / 2))
    controls.push({ coordinate: frame.fromXY(pi), radiusM: radius })
  }
  controls.push({ coordinate: [...guide[guide.length - 1]], radiusM: 0 })
  if (controls.length > 1000) throw Error('Candidate requires too many control points; shorten the planning section.')
  const coordinates = final.points.map(frame.fromXY)
  coordinates[0] = [...guide[0]]; coordinates[coordinates.length - 1] = [...guide[guide.length - 1]]
  const radii = controls.filter(p => p.radiusM > 0).map(p => p.radiusM)
  const warnings = ['Horizontal reconnaissance candidate only. Design PIs/vertical curves, full cut/fill footprint, drainage, sight distance, stability and field verification still require review.', 'Ground-grade limits are applied at ≤1 m sampling; this is not a continuous-surface or survey-accuracy guarantee.', 'Interior sketch points guide the corridor; they are not compulsory waypoints.']
  if (status === 'budget-limited') warnings.push('Search budget reached: a verified candidate was found, but alternatives may be better.')
  if (final.metrics.streamContacts) warnings.push('Mapped watercourse contact requires site assessment; no crossing approval or hydraulic sizing was performed.')
  const message = options.objective + ' corridor: ' + final.metrics.lengthM.toFixed(1) + ' m; ' + final.metrics.maxSampledGroundPitchPercent.toFixed(2) + '% maximum sampled ground grade; ' + final.metrics.excessVerticalM.toFixed(1) + ' m excess rise/fall. ' + warnings[0]
  return { ...final.metrics, coordinates, controlPoints: controls, profile: final.profile, baseline, directM: direct, explored, terrainSamples: calls, minimumRadiusM: radii.length ? Math.min(...radii) : null, nominalTurnRadiusM: turnRadius, sampleStepM: STEP, searchCellM: cell, objectiveCost: goalCost, searchStatus: status, warnings, message }
}

export function optimizeRoadCorridor(guide: Coordinate[], terrain: TerrainSource, settings: RoadSettings, context: ContextFeature[], options: RoadOptimizationOptions): RoadOptimizationResult {
  const iterator = search(guide, terrain, settings, context, options)
  let next = iterator.next()
  while (!next.done) next = iterator.next()
  return next.value
}
/** Cooperative execution keeps Cancel and the map responsive without serializing terrain functions. */
export async function optimizeRoadCorridorAsync(guide: Coordinate[], terrain: TerrainSource, settings: RoadSettings, context: ContextFeature[], options: RoadOptimizationOptions, control: CorridorRunControl = {}): Promise<RoadOptimizationResult> {
  const iterator = search(guide, terrain, settings, context, options, control)
  let next = iterator.next()
  while (!next.done) {
    control.onProgress?.(next.value)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    next = iterator.next()
  }
  if (control.signal?.aborted) throw new DOMException('Road optimization cancelled.', 'AbortError')
  return next.value
}
