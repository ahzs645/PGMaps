/**
 * Spur suggestions: short roads from the existing and designed roads into the parts of a block a
 * skidder cannot reach, until the block's ground-skiddable area is covered to a target share or the
 * spur budget is spent.
 *
 * Adapted from the closest-first road builder of the LANDIS-II Forest Roads Simulation extension
 * (Clément Hardy, https://github.com/Klemet/LANDIS-II-Forest-Roads-Simulation-module,
 * doi:10.5281/zenodo.5510629), Apache License 2.0. What is taken from it: uncovered ground is served
 * in order of its straight-line distance to the nearest road, closest first, and each spur is a
 * least-cost path joined to the nearest road already connected. Changed here: the spur aims at the
 * point that best covers the uncovered patch rather than at the uncovered cell itself; it is drawn
 * by PGMaps' own grade-limited router (`routing.ts`) on the ground trend; it is shortened to the
 * least length that keeps its coverage; reach follows the slope-dependent skid model in
 * `skidReach.ts` rather than a fixed disc; and the order is deterministic.
 *
 * A suggestion is a candidate. Nothing here adds a road to the project.
 *
 * Pure: terrain, constraints and projection are arguments; no DOM or network access.
 */
import { steepestGrades } from './blockAccess'
import { routingContext } from './riparian'
import { suggestRoutes, type RouteSearchOptions } from './routing'
import {
  BEYOND,
  chamferDistance,
  classifySkidCells,
  copyReachField,
  lineCells,
  propagateReach,
  summarizeSkidReach,
  type ProjectedRoad,
  type ReachField,
  type SkidProgress,
  type SkidReachResult,
  type SkidReachSummary,
  type SkidRoad,
} from './skidReach'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

type XY = [number, number]

export interface SpurOptions {
  /** Covered share of the block's known, ground-skiddable area to stop at, 0–1. */
  targetShare: number
  maxSpurs: number
  /** Where loaded trucks leave the area, when known; spurs then join swept back toward it. */
  haulExit?: Coordinate | null
}
export const DEFAULT_SPUR_OPTIONS: SpurOptions = { targetShare: 0.98, maxSpurs: 6, haulExit: null }
export const MAX_SKID_SPURS = 12
/** Route searches allowed per spur in the budget, counting retries and patches given up on. */
const ROUTE_SEARCHES_PER_SPUR = 12
/** Route searches tried for one patch before it is given up on. */
export const MAX_PATCH_SEARCHES = 10
/** Alternative junctions are tried this far either way along the nearest road, m. */
export const JOIN_SHIFTS_M = [75, 150]
/** A second aim is tried at least this far from the first, m. */
const AIM_ALTERNATE_M = 100
/** A spur that would bring less than this into reach is not suggested. */
export const MIN_SPUR_GAIN_HA = 0.25
export const MIN_SPUR_LENGTH_M = 20
/** A spur is cut back to the shortest length that keeps this share of the coverage it adds. */
export const SPUR_TRIM_KEEP = 0.99
/** The swept-back join: half-way between square to the parent and back along it. */
export const SPUR_SWEEP_DEG = 45
/** Only the uncovered cells within this many level-ground reaches of the first one shape a spur's aim. */
const PATCH_REACHES = 2
/** Aim candidates tried per patch; larger patches are sampled evenly. */
const MAX_AIM_CANDIDATES = 2000

export interface SpurInput {
  /** Source terrain: the router reads its own ground trend from `routeOptions.groundWindowM`. */
  terrain: TerrainSource
  /** The ground trend the skid grid was read from, for the spur's reported grades. */
  ground: TerrainSource
  settings: RoadSettings
  context: readonly ContextFeature[]
  routeOptions: Partial<RouteSearchOptions>
  options: SpurOptions
}

export interface SpurCandidate {
  id: string
  /** 1-based, in the order the spurs were made. */
  index: number
  coordinates: Coordinate[]
  lengthM: number
  junction: Coordinate
  parentId: string
  parentName: string
  /** The spur's end, where its landing goes. */
  landing: Coordinate
  gainHa: number
  /** Percentage points of the block's ground-skiddable area the spur brings into reach. */
  gainPoints: number
  /** Covered share of the skiddable area once this and every earlier spur are built. */
  coveredOfSkiddableAfter: number
  crossings: number
  steepestUphillPercent: number
  steepestDownhillPercent: number
  /**
   * How the spur was joined: inside the swept-back heading window (`sweptBackHeading` ±45°, so never
   * swept forward against the haul), or wherever the router took it.
   */
  join: 'swept-back' | 'free'
  /** The loaded truck's turn from the spur onto its parent toward the haul, degrees; null when the haul is unknown. */
  loadedTurnDeg: number | null
}
export interface SpurSuggestion {
  spurs: SpurCandidate[]
  before: SkidReachSummary
  after: SkidReachSummary
  stopped: 'already-met' | 'target-met' | 'spur-budget' | 'no-candidates'
  /** Uncovered patches no spur was suggested for, and why. */
  skipped: { at: Coordinate; reason: string }[]
  /** The fields and states with every spur built, for the plan. */
  result: SkidReachResult
}

/** Context beyond the router's search area plus this much (riparian screens, clearances) is left out of a spur search. */
const CONTEXT_CROP_EXTRA_M = 300

/**
 * The context features whose extent comes within `marginM` of the box round `a` and `b`. The
 * router tests every feature it is given against its whole grid, so a project's streams for a
 * whole landscape exhaust its geometry budget on a 500 m spur.
 */
export function cropContext(
  context: readonly ContextFeature[],
  a: XY,
  b: XY,
  marginM: number,
  toGrid: (c: Coordinate) => XY,
): ContextFeature[] {
  const minX = Math.min(a[0], b[0]) - marginM,
    maxX = Math.max(a[0], b[0]) + marginM,
    minY = Math.min(a[1], b[1]) - marginM,
    maxY = Math.max(a[1], b[1]) + marginM
  return context.filter((feature) => {
    const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const ring of rings)
      for (const c of ring) {
        const [x, y] = toGrid([c[0], c[1]])
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    return x0 <= maxX && x1 >= minX && y0 <= maxY && y1 >= minY
  })
}

const bearingOf = (from: XY, to: XY) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360

/**
 * The heading a spur leaves its parent on, degrees from north: half-way between square to the
 * parent (on the side of `toward`) and straight back against the haul. A loaded truck leaving the
 * spur then turns `sweepDeg` or less onto the parent, toward the haul.
 */
export function sweptBackHeading(haulBearing: number, junction: XY, toward: XY, sweepDeg = SPUR_SWEEP_DEG): number {
  const rad = (haulBearing * Math.PI) / 180
  const t: XY = [Math.sin(rad), Math.cos(rad)]
  let n: XY = [t[1], -t[0]]
  if (n[0] * (toward[0] - junction[0]) + n[1] * (toward[1] - junction[1]) < 0) n = [-n[0], -n[1]]
  const s = (sweepDeg * Math.PI) / 180
  // Rotate the square-off direction by sweepDeg toward −t.
  const d: XY = [n[0] * Math.cos(s) - t[0] * Math.sin(s), n[1] * Math.cos(s) - t[1] * Math.sin(s)]
  return ((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360
}

export interface RoadJoin {
  point: XY
  road: ProjectedRoad
  /** At either end of the road: the spur then continues it, and no heading is imposed. */
  atEnd: boolean
  /** Bearing along the road toward the haul at the join, when the haul direction is known. */
  haulBearing: number | null
}

/**
 * Where a spur toward `at` may join the roads, best first: the nearest point on the nearest road,
 * points `JOIN_SHIFTS_M` either way along that road, then the nearest point on the next road. A
 * junction inside a stream's screening area fails the route search, so the next one is tried.
 */
export function roadJoins(roads: readonly ProjectedRoad[], at: XY, haulExit: XY | null): RoadJoin[] {
  const nearest = roads
    .map((road) => {
      let best = { d: Infinity, s: 0 },
        run = 0
      for (let i = 1; i < road.xy.length; i++) {
        const a = road.xy[i - 1],
          b = road.xy[i]
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          length2 = dx * dx + dy * dy,
          length = Math.sqrt(length2)
        const t = length2 ? Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / length2)) : 0
        const d = Math.hypot(at[0] - a[0] - t * dx, at[1] - a[1] - t * dy)
        if (d < best.d) best = { d, s: run + t * length }
        run += length
      }
      return { road, ...best, length: run }
    })
    .filter((entry) => Number.isFinite(entry.d) && entry.length > 0)
    .sort((a, b) => a.d - b.d)
  const joinAt = (road: ProjectedRoad, s: number, length: number): RoadJoin => {
    let run = 0,
      segment = 1
    for (; segment < road.xy.length; segment++) {
      const a = road.xy[segment - 1],
        b = road.xy[segment]
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (run + d >= s || segment === road.xy.length - 1) break
      run += d
    }
    const a = road.xy[segment - 1],
      b = road.xy[segment]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const f = d ? Math.max(0, Math.min(1, (s - run) / d)) : 0
    let toward = road.road.haulToward ?? null
    if (!toward && haulExit) {
      const start = road.xy[0],
        end = road.xy.at(-1)!
      toward =
        Math.hypot(start[0] - haulExit[0], start[1] - haulExit[1]) <=
        Math.hypot(end[0] - haulExit[0], end[1] - haulExit[1])
          ? 'start'
          : 'end'
    }
    return {
      point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
      road,
      atEnd: s <= 1e-6 || s >= length - 1e-6,
      haulBearing: toward === null ? null : toward === 'end' ? bearingOf(a, b) : bearingOf(b, a),
    }
  }
  if (!nearest.length) return []
  const first = nearest[0]
  const positions: number[] = []
  for (const shift of [0, ...JOIN_SHIFTS_M.flatMap((m) => [-m, m])]) {
    const s = Math.max(0, Math.min(first.length, first.s + shift))
    if (positions.every((p) => Math.abs(p - s) > JOIN_SHIFTS_M[0] / 2)) positions.push(s)
  }
  const joins = positions.map((s) => joinAt(first.road, s, first.length))
  const second = nearest.find((entry) => entry.road.road.id !== first.road.road.id)
  if (second) joins.push(joinAt(second.road, second.s, second.length))
  return joins
}

const lineLength = (line: readonly XY[]) =>
  line.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0)

/** The first `lengthM` of a line. */
export function linePrefix(line: readonly XY[], lengthM: number): XY[] {
  const out: XY[] = [line[0]]
  let left = lengthM
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d >= left) {
      if (left > 1e-9) out.push([a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d])
      return out
    }
    out.push(b)
    left -= d
  }
  return out
}

/** Stream crossings of a projected line: one per stream segment it crosses. */
function streamCrossings(line: readonly XY[], streams: readonly XY[][]): number {
  const orient = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  let count = 0
  for (const stream of streams)
    for (let j = 1; j < stream.length; j++)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i],
          c = stream[j - 1],
          d = stream[j]
        if (orient(a, b, c) > 0 !== orient(a, b, d) > 0 && orient(c, d, a) > 0 !== orient(c, d, b) > 0) {
          count++
          break
        }
      }
  return count
}

const inRing = (p: XY, ring: readonly XY[]) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i],
      [bx, by] = ring[j]
    if (ay > p[1] !== by > p[1] && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/** Points of a convex hull, for the farthest-point test of an aim. */
function hull(points: XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: XY[] = [],
    upper: XY[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop()
    lower.push(p)
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

interface ReachState {
  strict: ReachField
  optimistic: ReachField
  status: Uint8Array
}

/**
 * Suggests spurs into the block's uncovered ground, closest patch first, until the covered share of
 * its ground-skiddable area reaches the target or the spur budget is spent.
 */
export function* suggestSpursSteps(base: SkidReachResult, input: SpurInput): Generator<SkidProgress, SpurSuggestion> {
  const sg = base.skidGrid
  const { grid } = sg
  const { width, cellM } = grid
  const cellHa = (cellM * cellM) / 10_000
  const options = input.options
  if (!(options.targetShare > 0 && options.targetShare <= 1)) throw Error('Use a coverage target from 1% to 100%.')
  if (!(Number.isInteger(options.maxSpurs) && options.maxSpurs >= 1 && options.maxSpurs <= MAX_SKID_SPURS))
    throw Error(`Use 1–${MAX_SKID_SPURS} spurs.`)
  const haulExit = options.haulExit ? sg.toGrid(options.haulExit) : null
  // Closed areas the router refuses an end in: blocked exclusions and unreviewed stream screens.
  // Aims and junctions inside them are passed over rather than searched and refused.
  const closed = routingContext(input.context)
    .filter(
      (feature) =>
        feature.kind === 'avoid' && feature.geometry.type === 'Polygon' && feature.routeCostPerM === undefined,
    )
    .map((feature) => {
      const rings = (feature.geometry as GeoJSON.Polygon).coordinates.map((ring) =>
        ring.map((c) => sg.toGrid([c[0], c[1]])),
      )
      const xs = rings[0].map((p) => p[0]),
        ys = rings[0].map((p) => p[1])
      return { rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
    })
  const isClosed = (p: XY) =>
    closed.some(
      ({ rings, box }) =>
        p[0] >= box[0] &&
        p[0] <= box[2] &&
        p[1] >= box[1] &&
        p[1] <= box[3] &&
        inRing(p, rings[0]) &&
        !rings.slice(1).some((ring) => inRing(p, ring)),
    )
  const streams = input.context
    .filter((feature) => feature.kind === 'stream' && feature.geometry.type === 'LineString')
    .map((feature) => (feature.geometry as GeoJSON.LineString).coordinates.map((c) => sg.toGrid([c[0], c[1]])))
  const roads: ProjectedRoad[] = [...sg.roads]
  let state: ReachState = {
    strict: copyReachField(base.strict),
    optimistic: copyReachField(base.optimistic),
    status: base.status,
  }
  const skipped = new Uint8Array(grid.values.length)
  const skippedNotes: SpurSuggestion['skipped'] = []
  const spurs: SpurCandidate[] = []
  const centre = (i: number): XY => {
    const row = Math.floor(i / width)
    return [grid.origin[0] + (i - row * width) * cellM, grid.origin[1] - row * cellM]
  }
  const sources = () => {
    const list: number[] = []
    for (let i = 0; i < sg.sourceRoad.length; i++) if (sg.sourceRoad[i] >= 0) list.push(i)
    for (const road of roads.slice(sg.roads.length)) list.push(...lineCells(grid, road.xy))
    return list
  }
  const summary = (s: ReachState) => summarizeSkidReach(sg, s.strict, s.status)
  const coveredCount = (field: ReachField) => {
    let n = 0
    for (const i of sg.blockCells)
      if (field.reach[i] <= 1 + 1e-9 && sg.slopePercent[i] <= sg.rule.maxGroundSlopePercent) n++
    return n
  }
  /** Fields with `line` added as a road, built on `from` without changing it. */
  function* withRoad(from: ReachState, line: XY[]): Generator<SkidProgress, ReachState> {
    const seeds = lineCells(grid, line)
    const strict = copyReachField(from.strict),
      optimistic = copyReachField(from.optimistic)
    yield* propagateReach(sg, strict, seeds, false)
    yield* propagateReach(sg, optimistic, seeds, true)
    return { strict, optimistic, status: classifySkidCells(sg, strict, optimistic) }
  }
  const before = summary(state)
  let searches = 0
  let stopped: SpurSuggestion['stopped'] =
    before.coveredOfSkiddable >= options.targetShare ? 'already-met' : 'no-candidates'
  while (stopped !== 'already-met') {
    const now = summary(state)
    if (now.coveredOfSkiddable >= options.targetShare) {
      stopped = 'target-met'
      break
    }
    if (spurs.length >= options.maxSpurs || searches >= options.maxSpurs * ROUTE_SEARCHES_PER_SPUR) {
      stopped = 'spur-budget'
      break
    }
    yield { phase: `Finding spur ${spurs.length + 1}`, done: spurs.length, total: options.maxSpurs }
    // Closest first: the uncovered cell nearest a road, as the crow flies.
    const toRoad = chamferDistance(grid.width, grid.height, cellM, sources())
    let trigger = -1
    for (const i of sg.blockCells)
      if (state.status[i] === BEYOND && !skipped[i] && (trigger < 0 || toRoad[i] < toRoad[trigger])) trigger = i
    if (trigger < 0) {
      stopped = 'no-candidates'
      break
    }
    // The patch: uncovered cells joined to the trigger, within a couple of reaches of it.
    const reachM = PATCH_REACHES * sg.rule.flatReachM
    const t = centre(trigger)
    const patch: number[] = []
    const seen = new Uint8Array(grid.values.length)
    const queue = [trigger]
    seen[trigger] = 1
    while (queue.length) {
      const i = queue.pop()!
      patch.push(i)
      const row = Math.floor(i / width),
        col = i - row * width
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr,
            c = col + dc
          if ((!dr && !dc) || r < 0 || c < 0 || r >= grid.height || c >= width) continue
          const j = r * width + c
          if (seen[j] || state.status[j] !== BEYOND || skipped[j]) continue
          seen[j] = 1
          const p = centre(j)
          if (Math.hypot(p[0] - t[0], p[1] - t[1]) <= reachM) queue.push(j)
        }
    }
    const skipPatch = (reason: string) => {
      for (const i of patch) skipped[i] = 1
      skippedNotes.push({ at: sg.toLonLat(t), reason })
    }
    if (patch.length * cellHa < MIN_SPUR_GAIN_HA) {
      skipPatch(
        `${(patch.length * cellHa).toFixed(2)} ha beyond reach here, under the ${MIN_SPUR_GAIN_HA} ha a spur is suggested for.`,
      )
      continue
    }
    // Aim: the patch cell whose farthest patch cell is nearest (an approximate 1-centre).
    const points = patch.map(centre)
    const corners = hull(points)
    const stride = Math.max(1, Math.ceil(points.length / MAX_AIM_CANDIDATES))
    const scored: { p: XY; worst: number }[] = []
    for (let k = 0; k < points.length; k += stride) {
      const p = points[k]
      if (isClosed(p)) continue
      let worst = 0
      for (const q of corners) worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]))
      scored.push({ p, worst })
    }
    scored.sort((a, b) => a.worst - b.worst)
    if (!scored.length) {
      skipPatch(
        'This ground lies inside a closed stream screening area or exclusion. Record the stream review or change its treatment to route a spur into it.',
      )
      continue
    }
    const aims = [scored[0].p]
    const alternate = scored.find(
      (entry) => Math.hypot(entry.p[0] - aims[0][0], entry.p[1] - aims[0][1]) >= AIM_ALTERNATE_M,
    )
    if (alternate) aims.push(alternate.p)
    let route: Coordinate[] | null = null,
      usedHeading = false,
      failure = '',
      join: RoadJoin | null = null,
      tries = 0
    search: for (const aim of aims) {
      for (const candidate of roadJoins(roads, aim, haulExit).filter((join) => !isClosed(join.point))) {
        const heading =
          candidate.haulBearing !== null && !candidate.atEnd
            ? sweptBackHeading(candidate.haulBearing, candidate.point, aim)
            : null
        const direct = Math.hypot(aim[0] - candidate.point[0], aim[1] - candidate.point[1])
        const margin = input.routeOptions.searchMarginM ?? Math.max(80, Math.min(1000, direct * 0.35))
        const nearby = cropContext(input.context, candidate.point, aim, margin + CONTEXT_CROP_EXTRA_M, sg.toGrid)
        for (const startHeading of heading === null ? [null] : [heading, null]) {
          if (tries >= MAX_PATCH_SEARCHES) break search
          tries++
          searches++
          try {
            route = suggestRoutes(
              sg.toLonLat(candidate.point),
              sg.toLonLat(aim),
              input.terrain,
              input.settings,
              nearby,
              {
                ...input.routeOptions,
                alternatives: 1,
                startHeading,
                endHeading: null,
              },
            ).routes[0].coordinates
            usedHeading = startHeading !== null
            join = candidate
            break search
          } catch (error) {
            // The nearest junction's reason is the one worth reporting.
            failure ||= `${candidate.road.road.name}: ${error instanceof Error ? error.message : 'the route search failed.'}`
          }
          yield { phase: `Finding spur ${spurs.length + 1}`, done: spurs.length, total: options.maxSpurs }
        }
      }
    }
    if (!route || !join) {
      skipPatch(
        failure
          ? `No spur reached this ground in ${tries} route search${tries === 1 ? '' : 'es'}. Nearest junction, ${failure}`
          : 'No road to join a spur to.',
      )
      continue
    }
    const full = route.map((c) => sg.toGrid(c))
    const fullLength = lineLength(full)
    const baseCovered = coveredCount(state.strict)
    const fullState = yield* withRoad(state, full)
    const fullGain = coveredCount(fullState.strict) - baseCovered
    if (fullGain * cellHa < MIN_SPUR_GAIN_HA) {
      skipPatch(
        `A spur from ${join.road.road.name} would bring ${(fullGain * cellHa).toFixed(2)} ha into reach, under the ${MIN_SPUR_GAIN_HA} ha a spur is suggested for.`,
      )
      continue
    }
    // Shortest prefix that keeps SPUR_TRIM_KEEP of the coverage the full spur adds.
    let low = Math.min(fullLength, MIN_SPUR_LENGTH_M),
      high = fullLength,
      kept = fullState
    while (high - low > cellM / 2) {
      const mid = (low + high) / 2
      const trial = yield* withRoad(state, linePrefix(full, mid))
      if (coveredCount(trial.strict) - baseCovered >= SPUR_TRIM_KEEP * fullGain) {
        high = mid
        kept = trial
      } else low = mid
    }
    const line = high >= fullLength ? full : linePrefix(full, high)
    const gain = coveredCount(kept.strict) - baseCovered
    state = kept
    const coordinates = line.map((p) => sg.toLonLat(p))
    coordinates[0] = sg.toLonLat(join.point)
    const spur: SkidRoad = {
      id: `spur-${spurs.length + 1}`,
      name: `Spur ${spurs.length + 1}`,
      kind: 'spur',
      coordinates,
      // The spur starts at its junction, so its loaded trucks leave by its start.
      haulToward: 'start',
    }
    roads.push({ road: spur, xy: line })
    const after = summary(state)
    const skiddableHa = after.blockHa - after.steepHa - after.unknownHa
    const grades = steepestGrades(coordinates, input.ground)
    const exitBearing = (bearingOf(line[0], line[1] ?? line[0]) + 180) % 360
    const loadedTurnDeg =
      join.haulBearing === null ? null : Math.abs(((exitBearing - join.haulBearing + 540) % 360) - 180)
    spurs.push({
      id: spur.id,
      index: spurs.length + 1,
      coordinates,
      lengthM: lineLength(line),
      junction: coordinates[0],
      parentId: join.road.road.id,
      parentName: join.road.road.name,
      landing: coordinates.at(-1)!,
      gainHa: gain * cellHa,
      gainPoints: skiddableHa > 0 ? (100 * gain * cellHa) / skiddableHa : 0,
      coveredOfSkiddableAfter: after.coveredOfSkiddable,
      crossings: streamCrossings(line, streams),
      steepestUphillPercent: grades.uphill,
      steepestDownhillPercent: grades.downhill,
      join: usedHeading ? 'swept-back' : 'free',
      loadedTurnDeg,
    })
  }
  return {
    spurs,
    before,
    after: summary(state),
    stopped,
    skipped: skippedNotes,
    result: { skidGrid: sg, ...state, summary: summary(state) },
  }
}
