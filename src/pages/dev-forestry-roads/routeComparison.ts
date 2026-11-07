/**
 * Compares the active road against designed alternatives between the same two ends. Each goal runs
 * the bounded corridor search, fits a profile and prices the result with the road engine, then
 * screens it for drainage. Everything here is a planning comparison: the corridor, profile and
 * drainage budgets are the ones documented for those tools, and no result is a global optimum.
 *
 * Takes terrain and projections as arguments and touches neither the DOM nor the network.
 */
import { safeAnalyzeRoad } from './analysisResult'
import { corridorFrame, optimizeRoadCorridorAsync, type RoadOptimizationObjective } from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { runDrainage, type DrainageSettings } from './drainageRun'
import { alignmentLength } from './engine'
import { fillDepressions, flowAccumulation, flowDirections } from './hydrology'
import { MAX_JOINT_MOVABLE_POINTS, refinePlanAndProfile } from './jointOptimizer'
import { suggestRoutes, type RouteSearchOptions } from './routing'
import { cellIndexAt, sampleSurfaceGrid, type ToGrid, type ToLonLat } from './surfaceGrid'
import { fitHorizontalRadii } from './horizontalTools'
import { optimizeVerticalProfile } from './verticalOptimizer'
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
    help: 'Prices the shortest, balanced and contour lines with fitted profiles, keeps the cheapest that meets the limits, then nudges its plan and re-prices it.',
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
const MAX_ROUTED_POINTS = 14
const WIDER_CORRIDOR_FACTOR = 2
const MAX_CORRIDOR_HALF_WIDTH_M = 600

export interface DrainageScreen {
  crossings: number
  crossDrains: number
  redirected: number
  newPondingM2: number
  allowance: number
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
  /** Set when the row leads a measure among the rows that meet every limit. */
  best: RouteGoal[]
}
export interface RouteComparison {
  rows: RouteRow[]
  drainageChecked: boolean
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
export interface RouteComparisonControl {
  signal?: AbortSignal
  onStep?: (message: string) => void
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
): Pick<RouteRow, 'lengthM' | 'maxGradePercent' | 'earthworksM3' | 'constructionCost' | 'blockers'> {
  const blockers: string[] = []
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

function markBest(rows: RouteRow[]) {
  const eligible = rows.filter((row) => row.alignment && !row.blockers.length && row.totalCost !== null)
  const lead = (goal: RouteGoal, value: (row: RouteRow) => number | null) => {
    const ranked = eligible.filter((row) => value(row) !== null).sort((a, b) => value(a)! - value(b)!)
    if (ranked[0]) ranked[0].best.push(goal)
  }
  lead('cost', (row) => row.totalCost)
  lead('shortest', (row) => row.lengthM)
  lead('gentle', (row) => row.maxGradePercent)
  lead('drainage', (row) => (row.drainage ? row.drainage.crossings * 10_000 + row.drainage.crossDrains : null))
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
  const step = async (message: string) => {
    aborted()
    onStep?.(message)
    await tick()
    aborted()
  }
  const guide = simplifyGuide(base.points.map((p) => p.coordinate))
  const analyse = (alignment: Alignment) =>
    safeAnalyzeRoad(alignment, terrain, settings, context, input.analysisOptions)
  const searchOptions = (halfWidth: number) => ({
    corridorHalfWidthM: Math.min(MAX_CORRIDOR_HALF_WIDTH_M, halfWidth),
    groundWindowM: options.groundWindowM,
  })

  let wetness: ((coordinate: Coordinate) => number) | null = null
  type Searched = Awaited<ReturnType<typeof optimizeRoadCorridorAsync>>
  type Line =
    | { result: Searched; points?: undefined; note: string | null }
    | { result?: undefined; points: RoadPoint[]; note: string }
  const searches = new Map<string, { line: Line } | { error: unknown }>()
  /** One corridor search per objective and stream set: the cost goal shares the other goals' lines. */
  const horizontal = async (objective: RoadOptimizationObjective, drainage: boolean): Promise<Line> => {
    const key = `${objective}:${drainage}`
    const known = searches.get(key)
    if (known) {
      if ('error' in known) throw known.error
      return known.line
    }
    const search = (line: Coordinate[], halfWidth: number) =>
      optimizeRoadCorridorAsync(
        line,
        terrain,
        settings,
        context,
        {
          objective,
          ...searchOptions(halfWidth),
          ...(drainage ? { streamContactCostM: DRAINAGE_STREAM_CONTACT_M, groundPenalty: wetness! } : {}),
        },
        { signal },
      )
    const attempt = async (): Promise<Line> => {
      const halfWidth = options.corridorHalfWidthM
      let failure: unknown
      try {
        return { result: await search(guide, halfWidth), note: null }
      } catch (cause) {
        aborted()
        failure = cause
      }
      // Only a corridor with no valid line can gain from more room; an exhausted budget cannot.
      if (failure instanceof Error && /No verified candidate/.test(failure.message))
        try {
          return {
            result: await search(guide, halfWidth * WIDER_CORRIDOR_FACTOR),
            note: `Corridor widened to ±${Math.min(MAX_CORRIDOR_HALF_WIDTH_M, halfWidth * WIDER_CORRIDOR_FACTOR)} m.`,
          }
        } catch {
          aborted()
        }
      // A grid route can leave the corridor entirely; its simplified line becomes a new guide.
      let routed: Coordinate[]
      try {
        routed = suggestRoutes(guide[0], guide[guide.length - 1], terrain, settings, context, {
          ...routeOptions,
          alternatives: 1,
          groundWindowM: options.groundWindowM,
        }).routes[0].coordinates
      } catch {
        throw failure
      }
      const routedGuide = simplifyGuide(routed)
      try {
        return { result: await search(routedGuide, halfWidth), note: 'Guided by a terrain-cost grid route.' }
      } catch {
        aborted()
      }
      // The grid route met the limits; only the corridor's tighter geometry did not fit. Keep the
      // route with curves fitted to its corners: its rows say so, and a misfit corner is a blocker.
      const corners = simplifyGuide(routed, MAX_ROUTED_POINTS).map((coordinate) => ({
        id: id(),
        coordinate,
        radiusM: 0,
      }))
      return {
        points: fitHorizontalRadii(
          corners,
          { kind: 'radius', radiusM: settings.minRadius * 2 },
          {
            minRadiusM: settings.minRadius,
          },
        ).points,
        note: 'Grid route with fitted curves: the corridor search found no line.',
      }
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

  const profileOptions = { context, ...(input.analysisOptions ?? {}) }
  /** The horizontal candidate with the profile, of those asked for, that prices lowest. */
  const fitProfile = (
    found: Line,
    goal: (typeof ROUTE_GOALS)[number],
    objectives: readonly ('earthwork' | 'total')[],
  ) => {
    const name = `${base.name} · ${goal.label.toLowerCase()}`
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
    const fitted = objectives.map((objective) => {
      const vertical = optimizeVerticalProfile(candidate, length, terrain, settings, {
        ...profileOptions,
        objective,
      }).vertical.map((point) => ({ ...point, id: id() }))
      const analysis = analyse({ ...candidate, vertical })
      return {
        vertical,
        cost: analysis.estimatedCost,
        withinGrade: analysis.maxGradePercent <= settings.maxGradePercent,
      }
    })
    const best = fitted.sort((a, b) => Number(b.withinGrade) - Number(a.withinGrade) || a.cost - b.cost)[0]
    return { candidate: { ...candidate, vertical: best.vertical }, cost: best.cost, withinGrade: best.withinGrade }
  }

  const design = async (goal: (typeof ROUTE_GOALS)[number]) => {
    if (goal.id !== 'cost') {
      let found: Line
      try {
        found = await horizontal(goal.objective, goal.id === 'drainage')
      } catch (cause) {
        aborted()
        if (goal.id !== 'drainage') throw cause
        found = await horizontal(goal.objective, false)
        found = { ...found, note: 'Could not steer around modelled streams; this is the balanced line.' }
      }
      await step(`${goal.label}: fitting a profile…`)
      return { candidate: fitProfile(found, goal, ['total']).candidate, notes: found.note ? [found.note] : [] }
    }
    // Lowest cost has to be measured, not assumed from a preference: price every line, drainage
    // included, and keep the cheapest. A short line that needs more culverts can lose.
    const priced: { fit: ReturnType<typeof fitProfile>; total: number; note: string | null }[] = []
    let failure: unknown
    for (const objective of ['shortest', 'balanced', 'contour'] as const) {
      await step(`${goal.label}: pricing the ${objective} line…`)
      try {
        const found = await horizontal(objective, false)
        const fit = fitProfile(found, goal, ['earthwork', 'total'])
        let allowance = 0
        try {
          allowance = screen(fit.candidate, analyse(fit.candidate)).allowance
        } catch {
          aborted()
        }
        priced.push({ fit, total: fit.cost + allowance, note: found.note })
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
      await step(`${goal.label}: refining plan and profile…`)
      try {
        const refined = await refinePlanAndProfile(candidate, terrain, settings, context, {
          stepM: 5,
          rounds: 1,
          maxEvaluations: 10,
          profile: { ...profileOptions, objective: 'total' },
          signal,
          yieldControl: tick,
        })
        candidate = refined.alignment
      } catch (cause) {
        aborted()
        notes.push(cause instanceof Error ? `Refinement skipped: ${cause.message}` : 'Refinement skipped.')
      }
    }
    return { candidate, notes }
  }

  const screen = (alignment: Alignment, analysis: RoadAnalysis): DrainageScreen => {
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
    const crossings = run.crossings.filter((crossing) => !crossing.culvertId).length,
      crossDrains = crossDrainSites(run.lowPoints)
    return {
      crossings,
      crossDrains,
      redirected: run.crossings.filter((crossing) => crossing.redirected).length,
      newPondingM2: run.newPonding.areaM2,
      allowance: crossings * options.crossingCost + crossDrains * options.crossDrainCost,
    }
  }

  const rows: RouteRow[] = [
    {
      id: base.id,
      goal: 'current',
      label: 'Current road',
      color: '#ea580c',
      alignment: base,
      coordinates: baseAnalysis.centerline,
      ...metrics(baseAnalysis, settings.maxGradePercent),
      drainage: null,
      totalCost: null,
      notes: base.vertical.length ? [] : ['No designed profile: the formation follows the ground.'],
      best: [],
    },
  ]
  const goals = ROUTE_GOALS.filter((goal) => options.goals.includes(goal.id))
  if (goals.some((goal) => goal.id === 'drainage')) {
    await step('Modelling flow from the terrain…')
    wetness = flowPenalty(
      terrain,
      guide,
      input.gridAt(guide[0]),
      resolutionM,
      options.corridorHalfWidthM + SCREENING_BUFFER_M,
      options.drainage.streamThresholdHa * STEERED_STREAM_FACTOR,
    )
  }
  for (const goal of goals) {
    await step(`${goal.label}: searching the corridor…`)
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
      Object.assign(row, metrics(analysis, settings.maxGradePercent))
    } catch (cause) {
      aborted()
      row.blockers = [cause instanceof Error ? cause.message : 'No route found.']
    }
    rows.push(row)
  }
  let drainageChecked = true
  for (const row of rows) {
    if (!row.alignment) continue
    await step(`${row.label}: screening drainage…`)
    try {
      const analysis = row.goal === 'current' ? baseAnalysis : analyse(row.alignment)
      row.drainage = screen(row.alignment, analysis)
      row.totalCost = row.constructionCost! + row.drainage.allowance
    } catch (cause) {
      aborted()
      drainageChecked = false
      row.totalCost = row.constructionCost
      row.notes.push(cause instanceof Error ? `Drainage not screened: ${cause.message}` : 'Drainage not screened.')
    }
  }
  // The cheapest line is often another goal's line: one row, not two identical ones.
  const shown: RouteRow[] = []
  const lines = new Map<string, RouteRow>()
  for (const row of rows) {
    const key = row.alignment && row.goal !== 'current' ? JSON.stringify(row.coordinates) : null
    const twin = key ? lines.get(key) : undefined
    if (twin) {
      twin.notes.push(`Also the ${row.label.toLowerCase()} line.`)
      continue
    }
    if (key) lines.set(key, row)
    shown.push(row)
  }
  markBest(shown)
  return { rows: shown, drainageChecked }
}
