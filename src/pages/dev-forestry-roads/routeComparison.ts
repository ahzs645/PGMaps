/**
 * Compares the active road against designed alternatives between the same two ends. Each goal runs
 * the bounded corridor search, fits a profile and prices the result with the road engine, then
 * screens it for drainage. Everything here is a planning comparison: the corridor, profile and
 * drainage budgets are the ones documented for those tools, and no result is a global optimum.
 *
 * Takes terrain and projections as arguments and touches neither the DOM nor the network.
 */
import { safeAnalyzeRoad } from './analysisResult'
import { yieldToHost } from './cooperative'
import { crossingScreeningOverlapCount } from './crossingPlan'
import {
  corridorFrame,
  CorridorSearchError,
  optimizeRoadCorridorAsync,
  type CorridorFailure,
  type RoadOptimizationObjective,
} from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { runDrainage, type DrainageSettings } from './drainageRun'
import { alignmentLength } from './engine'
import { fillDepressions, flowAccumulation, flowDirections } from './hydrology'
import { MAX_JOINT_MOVABLE_POINTS, refinePlanAndProfile } from './jointOptimizer'
import { derivedRoadName } from './roadNames'
import { roadFromRoute } from './routeFit'
import { suggestRoutes, type RouteSearchOptions } from './routing'
import { cellIndexAt, sampleSurfaceGrid, type ToGrid, type ToLonLat } from './surfaceGrid'
import { optimizeVerticalProfileAsync } from './verticalOptimizer'
import { constraintRouteIssues } from './riparian'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadPoint,
  RoadSettings,
  TerrainSource,
} from './types'

export type RouteGoal = 'cost' | 'shortest' | 'gentle' | 'drainage'

export const ROUTE_GOALS: {
  id: RouteGoal
  label: string
  objective: RoadOptimizationObjective
  color: string
  help: string
}[] = [
  {
    id: 'cost',
    label: 'Lowest cost',
    objective: 'balanced',
    color: '#16a34a',
    help: 'Prices the shortest, balanced and gentlest lines, then keeps whichever road costs least, drainage included.',
  },
  {
    id: 'shortest',
    label: 'Shortest',
    objective: 'shortest',
    color: '#2563eb',
    help: 'Stays close to a direct line, within the grade and radius limits.',
  },
  {
    id: 'gentle',
    label: 'Gentlest',
    objective: 'contour',
    color: '#9333ea',
    help: 'Follows the contours to reduce rise, fall and grade. Usually longer.',
  },
  {
    id: 'drainage',
    label: 'Fewest drainage issues',
    objective: 'balanced',
    color: '#0891b2',
    help: 'Models streams from the terrain and steers away from crossing them.',
  },
]

export interface RouteComparisonOptions {
  goals: RouteGoal[]
  corridorHalfWidthM: number
  groundWindowM: number
  /** Allowance per stream crossing without a culvert, CAD. A planning placeholder. */
  crossingCost: number
  /** Allowance per cross-drain site without a culvert, CAD. A planning placeholder. */
  crossDrainCost: number
  drainage: DrainageSettings
  /** Smaller corridor-search budgets, for tests and constrained devices. The defaults are the documented ones. */
  searchBudget?: { maxStates?: number; maxTerrainSamples?: number }
}
export const DEFAULT_CROSS_DRAIN_COST = 1500
/** Metres of road a mapped stream contact is worth to the drainage goal's search. */
const DRAINAGE_STREAM_CONTACT_M = 600
/**
 * The drainage goal steers around streams this many times the check's threshold. Every 1 ha gully on
 * a LiDAR hillside would price the whole corridor and exhaust the search; culverts handle the small ones.
 */
const STEERED_STREAM_FACTOR = 5
/** Metres of road per metre over a flow line at the stream threshold; a 12 m wide crossing is worth about 240 m. */
const FLOW_PENALTY_M = 20
/** Low points this close are one culvert site: an outlet and the pond behind it, or both ditches. */
const CROSS_DRAIN_SITE_M = 40
/** The screen sees streams, sags and outlets; the check in the Drainage view keeps 1 m cells. */
const SCREENING_CELL_M = 2
const SCREENING_BUFFER_M = 150
const STREAM_MODEL_CELL_M = 4
const MAX_GUIDE_POINTS = 8
const WIDER_CORRIDOR_FACTOR = 2
const MAX_CORRIDOR_HALF_WIDTH_M = 600
/**
 * How hard the second search of a corridor leans toward the end, once the even-handed one has run out
 * of budget. On the LiDAR hillside it reached ends 1.1 km apart in under 3 s where the first search
 * spent its whole budget, with a line 1 % to 5 % longer than a larger budget finds.
 */
export const QUICK_SEARCH_WEIGHT = 2.5
/**
 * A road is fitted to a grid route inside this distance of it. The route is a line that already meets
 * the grade limit, so the search only has to round its corners; a tube this narrow is searched in a
 * second or two where the full corridor spent its whole budget.
 */
export const ROUTED_HALF_WIDTH_M = 40
/** Guide points a grid route may keep; the corridor search takes at most 100. */
const MAX_ROUTED_GUIDE_POINTS = 100
/** Progress within a step is passed on no more often than this, ms. */
const DETAIL_INTERVAL_MS = 200
/** Plan-and-profile trials spent refining the cheapest line. */
const REFINEMENT_TRIALS = 10

export interface DrainageScreen {
  crossings: number
  crossDrains: number
  redirected: number
  newPondingM2: number
  allowance: number
  /** Possible overlap with priced structures; excluded from subtotal pending review. */
  crossingCostOverlaps?: number
}
export interface RouteRow {
  id: string
  goal: RouteGoal | 'current'
  label: string
  color: string
  alignment: Alignment | null
  /** The fitted centreline, for drawing. */
  coordinates: Coordinate[]
  lengthM: number | null
  maxGradePercent: number | null
  earthworksM3: number | null
  constructionCost: number | null
  drainage: DrainageScreen | null
  totalCost: number | null
  /** Why this row cannot be recommended; empty when it meets every limit. */
  blockers: string[]
  notes: string[]
  /** The goals this road actually won, measured across every road that meets the limits. */
  best: RouteGoal[]
}
export interface RouteComparison {
  rows: RouteRow[]
  drainageChecked: boolean
  /** Asked-for goals the current road already wins, so no new road is shown for them. */
  currentLeads: RouteGoal[]
}
export interface RouteComparisonInput {
  base: Alignment
  baseAnalysis: RoadAnalysis
  terrain: TerrainSource
  resolutionM: number
  settings: RoadSettings
  context: ContextFeature[]
  routeOptions: RouteSearchOptions
  options: RouteComparisonOptions
  analysisOptions?: Parameters<typeof safeAnalyzeRoad>[4]
  /** A metric grid around a coordinate, such as `localMetricGrid`. */
  gridAt: (at: Coordinate) => { toGrid: ToGrid; toLonLat: ToLonLat }
  id?: () => string
}
export interface RouteComparisonProgress {
  /** What is happening now, in terms of the roads rather than the engine. */
  message: string
  /** What the step is doing at this moment, and how far through its own budget it is. */
  detail?: string
  step: number
  total: number
}
export interface RouteComparisonControl {
  signal?: AbortSignal
  onStep?: (progress: RouteComparisonProgress) => void
}

/** Douglas-Peucker on a local metric frame, tightened until at most `maxPoints` remain. */
export function simplifyGuide(coordinates: Coordinate[], maxPoints = MAX_GUIDE_POINTS): Coordinate[] {
  if (coordinates.length <= maxPoints) return coordinates
  const frame = corridorFrame(coordinates[0]),
    xy = coordinates.map(frame.toXY)
  const offset = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      size = Math.hypot(dx, dy)
    return size ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / size : Math.hypot(p[0] - a[0], p[1] - a[1])
  }
  const keep = new Set([0, xy.length - 1])
  while (keep.size < maxPoints) {
    const kept = [...keep].sort((a, b) => a - b)
    let worst = -1,
      distance = 0
    for (let k = 1; k < kept.length; k++)
      for (let i = kept[k - 1] + 1; i < kept[k]; i++) {
        const d = offset(xy[i], xy[kept[k - 1]], xy[kept[k]])
        if (d > distance) {
          distance = d
          worst = i
        }
      }
    if (worst < 0) break
    keep.add(worst)
  }
  return [...keep].sort((a, b) => a - b).map((i) => coordinates[i])
}

/** One culvert site per cluster of low points that no culvert already serves. */
export function crossDrainSites(lowPoints: { chainage: number; culvertId: string | null }[]) {
  let sites = 0,
    previous = -Infinity
  for (const { chainage } of lowPoints.filter((p) => !p.culvertId).sort((a, b) => a.chainage - b.chainage)) {
    if (chainage - previous > CROSS_DRAIN_SITE_M) sites++
    previous = chainage
  }
  return sites
}

/**
 * Metres of road per metre travelled over ground that carries flow, modelled from the terrain around
 * the ends. A raster lookup rather than stream lines: a dense modelled network would cost the
 * corridor search a geometry check at every metre. Larger catchments cost more, and a one-cell
 * margin stops a line slipping between the diagonal cells of a flow path.
 */
export function flowPenalty(
  terrain: TerrainSource,
  guide: Coordinate[],
  grid: { toGrid: ToGrid; toLonLat: ToLonLat },
  resolutionM: number,
  marginM: number,
  thresholdHa: number,
): (coordinate: Coordinate) => number {
  const points = guide.map(grid.toGrid)
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const surface = sampleSurfaceGrid(
    terrain,
    [Math.min(...xs) - marginM, Math.min(...ys) - marginM, Math.max(...xs) + marginM, Math.max(...ys) + marginM],
    grid.toLonLat,
    { cellM: Math.max(resolutionM, STREAM_MODEL_CELL_M), maxCells: 1_000_000 },
  )
  const directions = flowDirections(fillDepressions(surface).filled)
  const accumulation = flowAccumulation(directions, surface)
  const threshold = thresholdHa * 10_000,
    { width, height } = surface
  const penalty = new Float32Array(width * height)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const area = accumulation[row * width + col]
      if (!(area >= threshold)) continue
      const value = FLOW_PENALTY_M * (1 + Math.log10(area / threshold))
      for (let r = Math.max(0, row - 1); r <= Math.min(height - 1, row + 1); r++)
        for (let c = Math.max(0, col - 1); c <= Math.min(width - 1, col + 1); c++)
          penalty[r * width + c] = Math.max(penalty[r * width + c], value)
    }
  return (coordinate) => {
    const [x, y] = grid.toGrid(coordinate)
    const index = cellIndexAt(surface, x, y)
    return index < 0 ? 0 : penalty[index]
  }
}

function metrics(
  analysis: RoadAnalysis,
  limit: number,
  context: ContextFeature[],
): Pick<RouteRow, 'lengthM' | 'maxGradePercent' | 'earthworksM3' | 'constructionCost' | 'blockers'> {
  const blockers = constraintRouteIssues(analysis.centerline, context)
  if (analysis.crossingEstimate?.complete === false)
    blockers.push('Crossing estimates are incomplete or need review; the known subtotal is not a complete road price.')
  if (analysis.maxGradePercent > limit + 1e-6) blockers.push(`Grade ${analysis.maxGradePercent.toFixed(1)}% over limit`)
  if (analysis.coveragePercent < 99.95) blockers.push(`${analysis.coveragePercent.toFixed(0)}% of sections complete`)
  const sharp = new Set(
    analysis.stations.flatMap((s) => s.flags.filter((f) => /Sharp horizontal PI/i.test(f)).map(() => s.chainage)),
  ).size
  if (sharp) blockers.push(`${sharp} sharp corner${sharp === 1 ? '' : 's'}`)
  return {
    lengthM: analysis.length,
    maxGradePercent: analysis.maxGradePercent,
    earthworksM3: analysis.cutVolumeM3 + analysis.fillVolumeM3,
    constructionCost: analysis.estimatedCost,
    blockers,
  }
}

/** How each goal is measured on a road; lower is better. */
export const ROUTE_GOAL_MEASURES: Record<RouteGoal, (row: RouteRow) => number | null> = {
  cost: (row) => row.totalCost,
  shortest: (row) => row.lengthM,
  gentle: (row) => row.maxGradePercent,
  drainage: (row) => (row.drainage ? row.drainage.crossings * 10_000 + row.drainage.crossDrains : null),
}

/**
 * Names roads by what they measured, not by the search that produced them: a search for the shortest
 * line can return the cheapest road, and a goal's own search can lose to another's. Each asked-for goal
 * goes to the road leading it among those that meet every limit, ties to the cheaper. A road leading
 * nothing is dropped, and so is one that breaks a limit or failed once another road holds its goal.
 */
export function assignGoals(rows: RouteRow[], goals: readonly RouteGoal[]) {
  const usable = rows.filter((row) => row.alignment && !row.blockers.length && row.totalCost !== null)
  for (const goal of goals) {
    const measure = ROUTE_GOAL_MEASURES[goal]
    const leader = usable
      .filter((row) => measure(row) !== null)
      .sort((a, b) => measure(a)! - measure(b)! || a.totalCost! - b.totalCost!)[0]
    leader?.best.push(goal)
  }
  const held = new Set(rows.flatMap((row) => row.best))
  const kept = rows.filter(
    (row) =>
      row.goal === 'current' || row.best.length > 0 || (!usable.includes(row) && !held.has(row.goal as RouteGoal)),
  )
  for (const row of kept) {
    if (row.goal === 'current' || !row.best.length) continue
    const won = ROUTE_GOALS.filter((goal) => row.best.includes(goal.id))
    row.goal = won[0].id
    row.color = won[0].color
    row.label = won.map((goal) => goal.label).join(' · ')
    if (row.alignment) row.alignment.color = won[0].color
  }
  return kept
}

const whole = (value: number) => Math.round(value).toLocaleString('en-CA')

/** What stopped a corridor search, where it got to and what to change, for the row that found no road. */
export function describeCorridorFailure(
  failure: CorridorFailure,
  limits: { maxGradePercent: number; minRadiusM: number; halfWidthM: number },
) {
  const { stopped } = failure
  const total = stopped.grade + stopped.terrain + stopped.exclusion + stopped.corridor
  const [check] = (Object.entries(stopped) as [keyof typeof stopped, number][]).sort((a, b) => b[1] - a[1])[0]
  const share = failure.closestRemainingM / Math.max(1, failure.directM)
  const reached =
    failure.closestRemainingM > failure.directM - 5
      ? 'made no headway toward the end'
      : `got to within ${whole(failure.closestRemainingM)} m of the end`
  // The trouble lies ahead of where the search stopped: by the start, by the end, or between them.
  const move = share > 0.65 ? "the road's start" : share < 0.35 ? "the road's end" : 'an end'
  const ended = failure.reason === 'budget' ? ', then ran out of its search budget' : ' and had no line left to try'
  if (!total) return `The search ${reached}${ended}. Move an end or widen the corridor under Search settings.`
  const cause = {
    grade: `ground steeper than the ${limits.maxGradePercent}% grade limit`,
    terrain: 'gaps in the terrain',
    exclusion: 'blocked areas',
    corridor: `the edge of the ±${limits.halfWidthM} m corridor`,
  }[check]
  const remedy = {
    grade: `Raise the grade limit, move ${move} onto gentler ground, or widen the corridor under Search settings.`,
    terrain: 'Move the ends onto mapped ground, or add terrain between them.',
    exclusion: 'Change the treatment of the areas between the ends, or widen the corridor under Search settings.',
    corridor: 'Widen the corridor under Search settings.',
  }[check]
  return `No line within ${limits.maxGradePercent}% and a ${limits.minRadiusM} m radius reaches the end: the search ${reached}${ended}. ${whole((100 * stopped[check]) / total)}% of the lines it tried were stopped by ${cause}. ${remedy}`
}

/**
 * What a run came back with, for the notice: how many roads, how many of them carry a flag, and the
 * goals left with none. `found` is false only when nothing usable came back and no goal was already
 * led by the current road.
 */
export function comparisonSummary(comparison: RouteComparison): { found: boolean; message: string } {
  const designed = comparison.rows.filter((row) => row.goal !== 'current' && row.alignment)
  const failed = comparison.rows.filter((row) => row.goal !== 'current' && !row.alignment)
  if (!designed.length)
    return failed.length
      ? { found: false, message: `No route found. ${failed[0].blockers[0] ?? ''}`.trim() }
      : { found: true, message: 'No new road beat yours on these goals.' }
  const flagged = designed.filter((row) => row.blockers.length).length
  const routes = `${designed.length} route${designed.length === 1 ? '' : 's'}`
  const without = failed.length ? ` No route for ${failed.map((row) => row.label.toLowerCase()).join(', ')}.` : ''
  if (!flagged)
    return { found: true, message: `${routes} ready. Click one to open its profile and sections.${without}` }
  return {
    found: true,
    message:
      (flagged === designed.length
        ? `${routes} found, ${designed.length === 1 ? 'with a limit broken or a check to make: its row says' : 'each with a limit broken or a check to make: their rows say'} which.`
        : `${routes} found; ${flagged} ${flagged === 1 ? 'has' : 'have'} a limit broken or a check to make, shown on ${flagged === 1 ? 'its row' : 'their rows'}.`) +
      ` Click one to open it.${without}`,
  }
}

const LINE_NAME: Record<'shortest' | 'balanced' | 'contour', string> = {
  shortest: 'shortest',
  balanced: 'balanced',
  contour: 'gentlest',
}

export async function compareRoutes(
  input: RouteComparisonInput,
  control: RouteComparisonControl = {},
): Promise<RouteComparison> {
  const { base, baseAnalysis, terrain, settings, context, options, resolutionM, routeOptions } = input
  const id = input.id ?? (() => crypto.randomUUID())
  const { signal, onStep } = control
  const aborted = () => {
    if (signal?.aborted) throw new DOMException('Route comparison cancelled.', 'AbortError')
  }
  const askedFor = ROUTE_GOALS.filter((goal) => options.goals.includes(goal.id))
  // Lowest cost tries three lines, then a plan refinement; every other goal searches, then fits a
  // profile. Every road, the current one included, then has its drainage screened.
  const total =
    askedFor.reduce((sum, goal) => sum + (goal.id === 'cost' ? 4 : 2), 0) +
    askedFor.length +
    1 +
    (options.goals.includes('drainage') ? 1 : 0)
  let done = 0
  /** Gives the page a turn between two stretches of work that cannot be split, and stops if cancelled. */
  const breathe = async () => {
    await yieldToHost()
    aborted()
  }
  let current = '',
    detailed = 0
  const step = async (message: string) => {
    aborted()
    done = Math.min(total, done + 1)
    current = message
    detailed = 0
    onStep?.({ message, step: done, total })
    await breathe()
  }
  /**
   * What the current step is doing, and how far along it is: a search by the share of its own budget
   * spent, which it may not need all of, and a profile fit by the share of its work done.
   */
  const detail = (text: string, share?: number, of = ' of its budget') => {
    const now = Date.now()
    if (share !== undefined && now - detailed < DETAIL_INTERVAL_MS) return
    detailed = now
    onStep?.({
      message: current,
      detail: share === undefined ? text : `${text} · ${Math.floor(share * 100)}%${of}`,
      step: done,
      total,
    })
  }
  const guide = simplifyGuide(base.points.map((p) => p.coordinate))
  // The same candidate is priced, refined, screened and listed; analyse and screen it once each.
  const analyses = new WeakMap<Alignment, RoadAnalysis>()
  const analyse = (alignment: Alignment) => {
    const known = analyses.get(alignment)
    if (known) return known
    const analysis = safeAnalyzeRoad(alignment, terrain, settings, context, input.analysisOptions)
    analyses.set(alignment, analysis)
    return analysis
  }
  const searchOptions = (halfWidth: number) => ({
    corridorHalfWidthM: Math.min(MAX_CORRIDOR_HALF_WIDTH_M, halfWidth),
    groundWindowM: options.groundWindowM,
    constraintCostBasePerM: routeOptions.baseCostPerM,
    ...options.searchBudget,
  })

  let wetness: ((coordinate: Coordinate) => number) | null = null
  type Searched = Awaited<ReturnType<typeof optimizeRoadCorridorAsync>>
  type Line =
    | { result: Searched; points?: undefined; note: string | null }
    | { result?: undefined; points: RoadPoint[]; note: string }
  const searches = new Map<string, { line: Line } | { error: unknown }>()
  /**
   * What is known about each corridor, shared by every goal. The limits a line must meet do not
   * depend on the goal, so a corridor one goal's search found empty is empty for the rest, and one
   * that spent a whole search budget is searched the quicker way from then on.
   */
  type Corridor = 'guide' | 'wide' | 'routed'
  const corridors = new Map<string, 'hard' | 'empty' | 'spent'>()
  /** The search that got nearest the end, kept to explain a goal that ends with no road. */
  let nearest: { failure: CorridorFailure; halfWidthM: number } | null = null
  let other: unknown = null
  const noteFailure = (cause: unknown, halfWidthM: number) => {
    if (!(cause instanceof CorridorSearchError)) {
      other ??= cause
      return
    }
    if (!nearest || cause.failure.closestRemainingM < nearest.failure.closestRemainingM)
      nearest = { failure: cause.failure, halfWidthM }
  }
  const QUICK_NOTE = 'Found by a quicker search that leans toward the end, so a more direct line may exist.'
  /** One corridor, searched evenly first and then the quicker way if that runs out. Null when it has no line. */
  const searchCorridor = async (
    corridor: Corridor,
    line: Coordinate[],
    halfWidth: number,
    objective: RoadOptimizationObjective,
    drainage: boolean,
    doing: string,
  ): Promise<{ result: Searched; quick: boolean } | null> => {
    // The tube along a grid route is cheap to search, and what fits in it does depend on the goal.
    const place = corridor === 'routed' ? `routed:${objective}` : corridor
    const known = corridors.get(place)
    if (known === 'empty' || known === 'spent') return null
    const run = (searchWeight?: number) =>
      optimizeRoadCorridorAsync(
        line,
        terrain,
        settings,
        context,
        {
          objective,
          ...searchOptions(halfWidth),
          ...(drainage ? { streamContactCostM: DRAINAGE_STREAM_CONTACT_M, groundPenalty: wetness! } : {}),
          ...(searchWeight ? { searchWeight } : {}),
        },
        {
          signal,
          onProgress: ({ budgetUsed }) => detail(searchWeight ? `${doing}, leaning toward the end` : doing, budgetUsed),
        },
      )
    // A search that cannot start (an end off the terrain or inside a blocked area) fails every time.
    const failed = (cause: unknown) => {
      aborted()
      noteFailure(cause, Math.min(MAX_CORRIDOR_HALF_WIDTH_M, halfWidth))
      if (!(cause instanceof CorridorSearchError)) throw cause
      return cause.failure.reason
    }
    if (known !== 'hard' || drainage)
      try {
        detail(doing)
        return { result: await run(), quick: false }
      } catch (cause) {
        if (failed(cause) === 'no-candidate') {
          corridors.set(place, 'empty')
          return null
        }
        // Steering round wet ground already leans toward the end; a second run would repeat it.
        if (drainage) return null
        corridors.set(place, 'hard')
      }
    try {
      detail(`${doing}, leaning toward the end`)
      return { result: await run(QUICK_SEARCH_WEIGHT), quick: true }
    } catch (cause) {
      corridors.set(place, failed(cause) === 'no-candidate' ? 'empty' : 'spent')
      return null
    }
  }
  /** The terrain-cost grid route between the ends, searched once: it does not depend on the goal. */
  let gridRoute: { coordinates: Coordinate[] } | { error: unknown } | null = null
  const routed = () => {
    if (!gridRoute)
      try {
        gridRoute = {
          coordinates: suggestRoutes(guide[0], guide[guide.length - 1], terrain, settings, context, {
            ...routeOptions,
            alternatives: 1,
            groundWindowM: options.groundWindowM,
          }).routes[0].coordinates,
        }
      } catch (error) {
        gridRoute = { error }
      }
    return 'coordinates' in gridRoute ? gridRoute.coordinates : null
  }
  /** The grid route as a road: fewer points with curves where that stays clear, else the route as found. */
  let gridRoad: { points: RoadPoint[]; note: string } | null = null
  const roadFromGridRoute = (route: Coordinate[]) => {
    if (gridRoad) return gridRoad
    const road = roadFromRoute(route, terrain, context, settings.minRadius)
    const sharp = road.fit?.sharpCorners ?? 0
    return (gridRoad = {
      points: road.points.map((point) => ({ id: id(), ...point })),
      note: road.fit
        ? `Built from a terrain-cost grid route, with curves fitted within ${road.maxDeviationM} m of it${sharp ? `; ${sharp} corner${sharp === 1 ? ' is' : 's are'} too tight for a ${settings.minRadius} m curve` : ''}. Its ground grades were checked along the grid route, not along the curves.`
        : // Every leg of the route as found was checked for ground, grade and blocked areas by its own search.
          'This is a terrain-cost grid route as found. No curves fit it without leaving the terrain or entering a blocked area, so its corners are sharp.',
    })
  }
  /** One line per objective and stream set: the cost goal shares the other goals' lines. */
  const horizontal = async (objective: RoadOptimizationObjective, drainage: boolean): Promise<Line> => {
    const key = `${objective}:${drainage}`
    const known = searches.get(key)
    if (known) {
      if ('error' in known) throw known.error
      return known.line
    }
    const attempt = async (): Promise<Line> => {
      const halfWidth = options.corridorHalfWidthM
      const quick = (found: { quick: boolean }, note: string | null) =>
        found.quick ? [note, QUICK_NOTE].filter(Boolean).join(' ') : note
      const direct = await searchCorridor(
        'guide',
        guide,
        halfWidth,
        objective,
        drainage,
        `searching within ${halfWidth} m of your road`,
      )
      if (direct) return { result: direct.result, note: quick(direct, null) }
      // Only a corridor with no valid line can gain from more room; an exhausted budget cannot.
      const wider = Math.min(MAX_CORRIDOR_HALF_WIDTH_M, halfWidth * WIDER_CORRIDOR_FACTOR)
      if (corridors.get('guide') === 'empty' && wider > halfWidth) {
        const wide = await searchCorridor(
          'wide',
          guide,
          wider,
          objective,
          drainage,
          `no line within ${halfWidth} m; searching within ${wider} m`,
        )
        if (wide) return { result: wide.result, note: quick(wide, `Corridor widened to ±${wider} m.`) }
      }
      // Steering round wet ground is tried in the corridors only: past them the balanced line serves.
      if (drainage) throw Error('No line steers round the modelled streams.')
      // A grid route can leave the corridor entirely; its simplified line becomes a new guide.
      detail('searching a wider area on a grid')
      await breathe()
      const route = routed()
      if (!route) throw Error('No line found.')
      const tube = Math.min(halfWidth, ROUTED_HALF_WIDTH_M)
      const along = await searchCorridor(
        'routed',
        simplifyGuide(route, MAX_ROUTED_GUIDE_POINTS),
        tube,
        objective,
        drainage,
        'fitting a road along a grid route',
      )
      if (along)
        return {
          result: along.result,
          note: quick(along, `Follows a terrain-cost grid route, within ${tube} m of it.`),
        }
      // The grid route met the grade limit; only the corridor's tighter geometry did not fit along it.
      detail('fitting curves to the grid route')
      await breathe()
      return roadFromGridRoute(route)
    }
    try {
      const line = await attempt()
      searches.set(key, { line })
      return line
    } catch (error) {
      aborted()
      searches.set(key, { error })
      throw error
    }
  }
  /** Why a goal ended with no road, in the designer's terms: which limit, and where the search got to. */
  const failureText = (cause: unknown) => {
    const grid =
      gridRoute && 'error' in gridRoute ? ' A coarser search of a wider area on a grid found no line either.' : ''
    if (nearest)
      return (
        describeCorridorFailure(nearest.failure, {
          maxGradePercent: settings.maxGradePercent,
          minRadiusM: settings.minRadius,
          halfWidthM: nearest.halfWidthM,
        }) + grid
      )
    const reason = other ?? cause
    return reason instanceof Error ? reason.message : 'No route found.'
  }

  const profileOptions = { context, ...(input.analysisOptions ?? {}) }
  /** The horizontal candidate with the profile, of those asked for, that prices lowest. */
  const fitProfile = async (
    found: Line,
    goal: (typeof ROUTE_GOALS)[number],
    objectives: readonly ('earthwork' | 'total')[],
  ) => {
    const name = derivedRoadName(base.name, goal.label.toLowerCase())
    const candidate: Alignment = found.result
      ? corridorCandidate(found.result, base.template, name, id)
      : {
          id: id(),
          name: name.slice(0, 200),
          color: goal.color,
          points: found.points,
          vertical: [],
          template: structuredClone(base.template),
          overrides: [],
        }
    candidate.color = goal.color
    const length = alignmentLength(candidate)
    const fitted: { vertical: Alignment['vertical']; cost: number; withinGrade: boolean }[] = []
    let failure: unknown
    const fit = async (objective: 'earthwork' | 'total') => {
      try {
        detail('fitting a profile')
        const profile = await optimizeVerticalProfileAsync(
          candidate,
          length,
          terrain,
          settings,
          { ...profileOptions, objective },
          { signal, onProgress: ({ fraction }) => detail('fitting a profile', fraction, '') },
        )
        await breathe()
        const vertical = profile.vertical.map((point) => ({ ...point, id: id() }))
        const analysis = analyse({ ...candidate, vertical })
        fitted.push({
          vertical,
          cost: analysis.estimatedCost,
          withinGrade: analysis.maxGradePercent <= settings.maxGradePercent,
        })
      } catch (cause) {
        aborted()
        failure ??= cause
      }
    }
    for (const objective of objectives) await fit(objective)
    // Total cost needs every crossing and haul input priced; cut and fill alone does not.
    if (!fitted.length && !objectives.includes('earthwork')) await fit('earthwork')
    if (!fitted.length)
      throw Error(
        `A line was found, but no profile fits it. ${failure instanceof Error ? failure.message : 'The profile search failed.'}`,
      )
    const best = fitted.sort((a, b) => Number(b.withinGrade) - Number(a.withinGrade) || a.cost - b.cost)[0]
    return { candidate: { ...candidate, vertical: best.vertical }, cost: best.cost, withinGrade: best.withinGrade }
  }

  const design = async (goal: (typeof ROUTE_GOALS)[number]) => {
    if (goal.id !== 'cost') {
      let found: Line | null = null
      if (goal.id === 'drainage') {
        // Steering is extra: a search that cannot do it still has the balanced line to offer.
        try {
          found = await horizontal(goal.objective, true)
        } catch {
          aborted()
        }
        if (!found) {
          found = await horizontal(goal.objective, false)
          found = { ...found, note: 'Could not steer around modelled streams; this is the balanced line.' }
        }
      } else found = await horizontal(goal.objective, false)
      await step(`${goal.label}: fitting a profile`)
      return {
        candidate: (await fitProfile(found, goal, ['total'])).candidate,
        notes: found.note ? [found.note] : [],
      }
    }
    // Lowest cost has to be measured, not assumed from a preference: price every line, drainage
    // included, and keep the cheapest. A short line that needs more culverts can lose.
    const priced: { fit: Awaited<ReturnType<typeof fitProfile>>; total: number; note: string | null }[] = []
    let failure: unknown
    for (const objective of ['shortest', 'balanced', 'contour'] as const) {
      await step(`${goal.label}: pricing the ${LINE_NAME[objective]} line`)
      try {
        const found = await horizontal(objective, false)
        const fit = await fitProfile(found, goal, ['earthwork', 'total'])
        await breathe()
        priced.push({ fit, total: totalOf(fit.candidate), note: found.note })
      } catch (cause) {
        aborted()
        failure = cause
      }
    }
    if (!priced.length) throw failure
    priced.sort((a, b) => Number(b.fit.withinGrade) - Number(a.fit.withinGrade) || a.total - b.total)
    let candidate = priced[0].fit.candidate
    const notes = priced[0].note ? [priced[0].note] : []
    if (candidate.points.length > 2 && candidate.points.length - 2 <= MAX_JOINT_MOVABLE_POINTS) {
      await step(`${goal.label}: refining the cheapest line`)
      let trial = 0
      try {
        const refined = await refinePlanAndProfile(candidate, terrain, settings, context, {
          stepM: 5,
          rounds: 1,
          maxEvaluations: REFINEMENT_TRIALS,
          profile: { ...profileOptions, objective: 'total' },
          signal,
          yieldControl: async () => {
            detail(`trial ${Math.min(REFINEMENT_TRIALS, ++trial)} of ${REFINEMENT_TRIALS}`)
            await breathe()
          },
        })
        // Refinement sees only the build price. A cheaper build that lands on a stream costs more.
        if (totalOf(refined.alignment) < priced[0].total) candidate = refined.alignment
      } catch (cause) {
        aborted()
        notes.push(cause instanceof Error ? `Refinement skipped: ${cause.message}` : 'Refinement skipped.')
      }
    }
    return { candidate, notes }
  }

  /** Build plus drainage allowance: the same total a row shows. */
  const totalOf = (alignment: Alignment) => {
    const analysis = analyse(alignment)
    if (analysis.crossingEstimate?.complete === false || constraintRouteIssues(analysis.centerline, context).length)
      return Infinity
    try {
      const drainage = screen(alignment, analysis)
      return drainage.crossingCostOverlaps ? Infinity : analysis.estimatedCost + drainage.allowance
    } catch {
      return analysis.estimatedCost
    }
  }

  const screens = new WeakMap<Alignment, DrainageScreen>()
  const screen = (alignment: Alignment, analysis: RoadAnalysis): DrainageScreen => {
    const known = screens.get(alignment)
    if (known) return known
    const result = screenOnce(alignment, analysis)
    screens.set(alignment, result)
    return result
  }
  const screenOnce = (alignment: Alignment, analysis: RoadAnalysis): DrainageScreen => {
    const grid = input.gridAt(alignment.points[0].coordinate)
    const run = runDrainage({
      terrain,
      analysis,
      culverts: alignment.engineering?.culverts ?? [],
      toGrid: grid.toGrid,
      toLonLat: grid.toLonLat,
      resolutionM: Math.max(resolutionM, SCREENING_CELL_M),
      settings: { ...options.drainage, bufferM: Math.min(options.drainage.bufferM, SCREENING_BUFFER_M) },
      maxCells: 1_500_000,
    })
    const unassignedCrossings = run.crossings.filter((crossing) => !crossing.culvertId)
    const crossingCostOverlaps = crossingScreeningOverlapCount(
      analysis,
      unassignedCrossings,
      Math.max(resolutionM, SCREENING_CELL_M),
    )
    const crossings = unassignedCrossings.length,
      crossDrains = crossDrainSites(run.lowPoints)
    return {
      crossings,
      crossDrains,
      redirected: run.crossings.filter((crossing) => crossing.redirected).length,
      newPondingM2: run.newPonding.areaM2,
      allowance: (crossings - crossingCostOverlaps) * options.crossingCost + crossDrains * options.crossDrainCost,
      ...(crossingCostOverlaps ? { crossingCostOverlaps } : {}),
    }
  }

  const rows: RouteRow[] = [
    {
      id: base.id,
      goal: 'current',
      label: 'Your road',
      color: '#ea580c',
      alignment: base,
      coordinates: baseAnalysis.centerline,
      ...metrics(baseAnalysis, settings.maxGradePercent, context),
      drainage: null,
      totalCost: null,
      notes: base.vertical.length ? [] : ['No designed profile: the formation follows the ground.'],
      best: [],
    },
  ]
  if (askedFor.some((goal) => goal.id === 'drainage')) {
    await step('Modelling where water flows')
    wetness = flowPenalty(
      terrain,
      guide,
      input.gridAt(guide[0]),
      resolutionM,
      options.corridorHalfWidthM + SCREENING_BUFFER_M,
      options.drainage.streamThresholdHa * STEERED_STREAM_FACTOR,
    )
  }
  for (const goal of askedFor) {
    await step(`${goal.label}: searching for a line`)
    const row: RouteRow = {
      id: id(),
      goal: goal.id,
      label: goal.label,
      color: goal.color,
      alignment: null,
      coordinates: [],
      lengthM: null,
      maxGradePercent: null,
      earthworksM3: null,
      constructionCost: null,
      drainage: null,
      totalCost: null,
      blockers: [],
      notes: [],
      best: [],
    }
    try {
      const { candidate, notes } = await design(goal)
      row.alignment = candidate
      row.notes = notes
      const analysis = analyse(candidate)
      row.coordinates = analysis.centerline
      Object.assign(row, metrics(analysis, settings.maxGradePercent, context))
    } catch (cause) {
      aborted()
      row.blockers = [failureText(cause)]
    }
    rows.push(row)
  }
  let drainageChecked = true
  for (const row of rows) {
    if (!row.alignment) continue
    await step(`${row.label}: checking drainage`)
    try {
      const analysis = row.goal === 'current' ? baseAnalysis : analyse(row.alignment)
      await breathe()
      row.drainage = screen(row.alignment, analysis)
      row.totalCost = row.constructionCost! + row.drainage.allowance
      if (row.drainage.crossingCostOverlaps) {
        row.totalCost = null
        row.blockers.push(
          `${row.drainage.crossingCostOverlaps} modelled drainage crossing(s) may overlap itemized stream structures. Review their association before comparing a complete total; the potentially duplicate allowance is excluded from the known subtotal.`,
        )
      }
    } catch (cause) {
      aborted()
      drainageChecked = false
      row.totalCost = row.constructionCost
      row.notes.push(cause instanceof Error ? `Drainage not screened: ${cause.message}` : 'Drainage not screened.')
    }
  }
  // The cheapest line is often another goal's line: one row, not two identical ones.
  const lines = new Set<string>()
  const distinct = rows.filter((row) => {
    if (!row.alignment || row.goal === 'current') return true
    const key = JSON.stringify(row.coordinates)
    if (lines.has(key)) return false
    lines.add(key)
    return true
  })
  const shown = assignGoals(distinct, options.goals)
  const currentLeads = shown.find((row) => row.goal === 'current')?.best ?? []
  for (const row of shown)
    if (row.goal !== 'current' && row.alignment)
      row.alignment.name = derivedRoadName(
        base.name,
        ROUTE_GOALS.find((goal) => goal.id === row.goal)!.label.toLowerCase(),
      )
  return { rows: shown, drainageChecked, currentLeads }
}
