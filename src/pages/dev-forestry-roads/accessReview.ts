/**
 * Access review: from an end (a point or a planned block) back to the roads a new road could leave,
 * each compared by the route goals. A new road has to start on an existing road, so the end is the
 * fixed input and each start is a junction on an active mapped road. No DOM or network access.
 */
import { safeAnalyzeRoad } from './analysisResult'
import { blockLandings, nearestBlockEdge, steepestGrades } from './blockAccess'
import type { FsrConnectionTarget } from './fsrConnections'
import { nearestExistingRoadPoint, nearestFsrConnections } from './fsrNetwork'
import { groundTrendTerrain } from './groundTrend'
import {
  compareRoutes,
  ROUTE_GOAL_MEASURES,
  ROUTE_GOALS,
  simplifyGuide,
  type RouteComparisonControl,
  type RouteComparisonInput,
  type RouteGoal,
  type RouteRow,
} from './routeComparison'
import { suggestRoutes } from './routing'
import { alignmentLength } from './engine'
import type { Alignment, ContextFeature, Coordinate, RoadTemplate } from './types'

/** Starts tried per review; each is a terrain search plus one comparison run per goal. */
export const MAX_ACCESS_STARTS = 4
/** Colours per start, so every variant from one road shares its colour on the plan. */
export const ACCESS_START_COLORS = ['#2563eb', '#db2777', '#16a34a', '#9333ea']

export type AccessEnd = { kind: 'point'; coordinate: Coordinate } | { kind: 'block'; block: ContextFeature }
export type AccessStartMode = { kind: 'nearest'; count: number } | { kind: 'road'; roadId: string }

/** Where a new road would leave an existing road (`target`) and where it ends (`landing`). */
export interface AccessStart {
  target: FsrConnectionTarget
  landing: Coordinate
}

export interface AccessRow extends RouteRow {
  startIndex: number
  start: AccessStart
  /**
   * Steepest sampled ground grades along the road with a loaded truck, which travels from the end
   * back to the junction: uphill is adverse for a loaded truck, downhill is adverse when empty.
   */
  loadedUphillPercent: number | null
  emptyUphillPercent: number | null
  /** Goals this road leads across every start, not only among its own road's variants. */
  overallBest: RouteGoal[]
}
export interface AccessAttempt {
  start: AccessStart
  error?: string
}
export interface AccessReview {
  rows: AccessRow[]
  attempts: AccessAttempt[]
}

/** A road that can carry traffic now: mapped, not closed, and active where the source says so. */
export function isActiveRoad(feature: ContextFeature) {
  const evidence = feature.roadEvidence
  return (
    feature.kind === 'existing-road' &&
    feature.geometry.type === 'LineString' &&
    evidence?.condition !== 'closed' &&
    (!evidence?.lifecycleStatus || evidence.lifecycleStatus === 'ACTIVE')
  )
}

/** The end's reference point: the clicked point, or the block's vertex centroid. */
export function accessEndPoint(end: AccessEnd): Coordinate {
  if (end.kind === 'point') return end.coordinate
  if (end.block.geometry.type !== 'Polygon') throw Error('Choose a block drawn or imported as an area.')
  const ring = end.block.geometry.coordinates[0]
  return [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length]
}

/** The active road nearest a clicked point, within `withinM`, for "start from a road I pick". */
export function pickActiveRoad(at: Coordinate, context: ContextFeature[], withinM = 250): ContextFeature | null {
  let best: { road: ContextFeature; distanceM: number } | null = null
  for (const road of context) {
    if (!isActiveRoad(road)) continue
    const point = nearestExistingRoadPoint(at, road)
    if (point && point.distanceM <= withinM && (!best || point.distanceM < best.distanceM))
      best = { road, distanceM: point.distanceM }
  }
  return best?.road ?? null
}

/**
 * The starts to try. Nearest: the closest active FSR sections, each joined at its footpoint (for a
 * block, at the edge closest to that FSR). A picked road: one start, at the point of that road
 * closest to the end.
 */
export function accessStarts(end: AccessEnd, context: ContextFeature[], mode: AccessStartMode): AccessStart[] {
  if (mode.kind === 'road') {
    const road = context.find((feature) => feature.id === mode.roadId)
    if (!road || road.kind !== 'existing-road') throw Error('The picked road is no longer in the project.')
    if (!isActiveRoad(road)) throw Error(`${road.name} is closed or not active. Pick an active road.`)
    const first = nearestExistingRoadPoint(accessEndPoint(end), road)
    if (!first) throw Error(`${road.name} has no line to join.`)
    const landing = end.kind === 'point' ? end.coordinate : nearestBlockEdge(end.block, first.coordinate).coordinate
    const junction = nearestExistingRoadPoint(landing, road) ?? first
    return [{ target: { ...junction, featureId: road.id, name: road.name }, landing }]
  }
  const count = Math.max(1, Math.min(MAX_ACCESS_STARTS, Math.round(mode.count)))
  if (end.kind === 'block') return blockLandings(end.block, context, count, 'fsr')
  return nearestFsrConnections(end.coordinate, context, count).map((target) => ({ target, landing: end.coordinate }))
}

export interface AccessReviewInput extends Omit<RouteComparisonInput, 'base' | 'baseAnalysis'> {
  starts: AccessStart[]
  /** Names the end in each road's name, e.g. "Block 3" or "Picked end". */
  endName: string
  template: RoadTemplate
}

/**
 * For each start, a terrain-cost route from the junction to the end is the corridor, and the route
 * goals are compared along it. Roads run from the junction (chainage 0) to the end. A start whose
 * route fails is reported in `attempts` rather than ending the review.
 */
export async function compareAccessRoutes(
  input: AccessReviewInput,
  control: RouteComparisonControl = {},
): Promise<AccessReview> {
  const { starts, endName, template, ...shared } = input
  if (!starts.length)
    throw Error(
      'No active FSR is loaded near this end. Load BC FSRs, import an FSR network, or start from a road you pick.',
    )
  const ground = groundTrendTerrain(shared.terrain, shared.options.groundWindowM ?? 0)
  // Roads run junction → end, and loaded trucks the other way, so any haul-direction grade limits
  // apply from the end back to the start.
  const routeOptions = {
    ...shared.routeOptions,
    ...(shared.routeOptions.haulGrades && {
      haulGrades: { ...shared.routeOptions.haulGrades, loadedDirection: 'end-to-start' as const },
    }),
  }
  const rows: AccessRow[] = []
  const attempts: AccessAttempt[] = []
  for (const [index, start] of starts.entries()) {
    if (control.signal?.aborted) throw new DOMException('Access review cancelled.', 'AbortError')
    if (start.target.distanceM < 2) {
      attempts.push({ start, error: 'The end already meets this road; inspect the junction instead.' })
      continue
    }
    try {
      const route = suggestRoutes(
        start.target.coordinate,
        start.landing,
        shared.terrain,
        shared.settings,
        shared.context,
        {
          ...routeOptions,
          alternatives: 1,
        },
      ).routes[0]
      // Fresh ids each review, so roads added from two reviews never share one.
      const newId = shared.id ?? (() => `access-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
      const base: Alignment = {
        id: newId(),
        name: `${start.target.name} → ${endName}`,
        color: ACCESS_START_COLORS[index % ACCESS_START_COLORS.length],
        points: simplifyGuide(route.coordinates).map((coordinate) => ({
          id: newId(),
          coordinate,
          radiusM: 0,
        })),
        vertical: [],
        template: { ...template },
        overrides: [],
      }
      const baseAnalysis = safeAnalyzeRoad(
        base,
        shared.terrain,
        shared.settings,
        shared.context,
        shared.analysisOptions,
      )
      const comparison = await compareRoutes(
        { ...shared, routeOptions, base, baseAnalysis },
        {
          signal: control.signal,
          onStep: (progress) =>
            control.onStep?.({
              message: `${start.target.name} (${index + 1} of ${starts.length}): ${progress.message}`,
              step: index * 100 + Math.round((100 * progress.step) / Math.max(1, progress.total)),
              total: starts.length * 100,
            }),
        },
      )
      const before = rows.length
      for (const row of comparison.rows) {
        if (!row.alignment) continue
        // The start's own terrain-cost route is a variant too when it already leads a goal: the
        // comparison then adds no other road for that goal.
        if (row.goal === 'current') {
          if (!comparison.currentLeads.length) continue
          row.best = [...comparison.currentLeads]
          row.label = ROUTE_GOALS.filter((goal) => comparison.currentLeads.includes(goal.id))
            .map((goal) => goal.label)
            .join(' · ')
        }
        // A loaded truck runs from the end back to the junction, against the road's chainage.
        const grades = row.coordinates.length > 1 ? steepestGrades([...row.coordinates].reverse(), ground) : null
        const alignment = {
          ...row.alignment,
          name: `${start.target.name} → ${endName} · ${row.label}`.slice(0, 200),
        }
        rows.push({
          ...row,
          id: `${index}:${row.id}`,
          alignment,
          startIndex: index,
          start,
          loadedUphillPercent: grades?.uphill ?? null,
          emptyUphillPercent: grades?.downhill ?? null,
          overallBest: [],
        })
      }
      // Every goal failed for this start: say why rather than leave it empty.
      const failed = comparison.rows.find((row) => !row.alignment)?.blockers[0]
      attempts.push(rows.length > before ? { start } : { start, error: failed ?? 'No road from here met the limits.' })
    } catch (error) {
      if (control.signal?.aborted) throw error
      attempts.push({ start, error: error instanceof Error ? error.message : 'Route search failed.' })
    }
  }
  // The overall leader of each goal, judged the way one comparison judges its own roads.
  const usable = rows.filter((row) => !row.blockers.length && row.totalCost !== null)
  for (const goal of shared.options.goals) {
    const measure = ROUTE_GOAL_MEASURES[goal]
    const leader = usable
      .filter((row) => measure(row) !== null)
      .sort((a, b) => measure(a)! - measure(b)! || a.totalCost! - b.totalCost!)[0]
    leader?.overallBest.push(goal)
  }
  return { rows, attempts }
}

/**
 * The same road driven the other way: points reversed, profile controls and widenings measured from
 * the other end, and left and right swapped, since the left side becomes the right.
 */
export function reverseAlignment(alignment: Alignment): Alignment {
  const length = alignmentLength(alignment)
  const swap = <T extends object>(values: T): T => {
    const next = { ...values } as Record<string, unknown>
    for (const key of Object.keys(values)) {
      if (!key.startsWith('left')) continue
      const other = `right${key.slice(4)}`
      next[key] = (values as Record<string, unknown>)[other]
      next[other] = (values as Record<string, unknown>)[key]
      if (next[key] === undefined) delete next[key]
      if (next[other] === undefined) delete next[other]
    }
    return next as T
  }
  return {
    ...alignment,
    points: [...alignment.points].reverse(),
    vertical: [...alignment.vertical]
      .reverse()
      .map((point) => ({ ...point, chainage: Math.max(0, length - point.chainage) })),
    overrides: alignment.overrides.map((range) => ({
      ...range,
      start: Math.max(0, length - range.end),
      end: Math.max(0, length - range.start),
      side: range.side === 'left' ? 'right' : range.side === 'right' ? 'left' : range.side,
    })),
    template: swap(alignment.template),
  }
}

/** Where an access review started from when its end is an existing road's endpoint. */
export interface AccessOrigin {
  alignmentId: string
  alignmentName: string
  endpoint: 'start' | 'end'
  coordinate: Coordinate
}

/**
 * A chosen variant as an FSR connector: it runs from the road's endpoint to the junction, the way
 * the connector always has, and records where it was meant to meet the FSR.
 */
export function accessConnector(
  row: AccessRow,
  origin: AccessOrigin,
  networkScope: string,
  preference: 'nearest' | 'chosen',
): Alignment {
  if (!row.alignment) throw Error('This variant has no designed road.')
  const road = reverseAlignment(row.alignment)
  const target = row.start.target
  road.points = road.points.map((point, i, all) =>
    i === 0
      ? { ...point, coordinate: origin.coordinate }
      : i === all.length - 1
        ? { ...point, coordinate: target.coordinate }
        : point,
  )
  road.name = `${origin.alignmentName} → ${target.name} · FSR connection`.slice(0, 200)
  road.fsrConnection = {
    targetFeatureId: target.featureId,
    targetName: target.name,
    targetCoordinate: target.coordinate,
    originCoordinate: origin.coordinate,
    originAlignmentId: origin.alignmentId,
    endpoint: origin.endpoint,
    preference,
    networkScope: networkScope.slice(0, 2000) || 'The loaded project road network was searched.',
    straightLineDistanceM: Math.min(100000, target.distanceM),
    routeLengthM: Math.min(100000, row.lengthM ?? alignmentLength(road)),
    searchCost: Math.max(0, row.totalCost ?? 0),
  }
  return road
}
