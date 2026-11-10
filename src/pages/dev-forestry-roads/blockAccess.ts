import { nearestExistingRoadPoint, nearestFsrConnections } from './fsrNetwork'
import type { FsrConnectionTarget } from './fsrConnections'
import { groundTrendTerrain } from './groundTrend'
import { junctionCandidates, measureJunction, type JunctionOrientation } from './junctionOrientation'
import { parseRouteSearchOptions, suggestRoutes, type RouteCandidate, type RouteSearchOptions } from './routing'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

/** FSR sections tried per block; each search is a full terrain-cost run. */
export const MAX_BLOCK_ACCESS_OPTIONS = 4
/** Edge samples used to find each section's closest landing; spacing widens on large blocks. */
const MAX_EDGE_SAMPLES = 400
const MIN_EDGE_SPACING_M = 10
const M_PER_DEGREE = 111195.0802335329

export interface BlockLanding {
  /** Point on the block edge closest to this FSR section. */
  landing: Coordinate
  target: FsrConnectionTarget
}
export interface BlockAccessOption extends RouteCandidate {
  landing: Coordinate
  target: FsrConnectionTarget
  /** Steepest sampled ground grades with loaded travel from the landing to the FSR; empty uphill is loaded downhill. */
  steepestLoadedUphillPercent: number
  steepestEmptyUphillPercent: number
  /**
   * Set when the search was asked to orient junctions toward a haul destination: the loaded truck's
   * turn onto the host (null where the way to the destination there is unknown), and whether the
   * junction was moved and the arrival heading held (false when every oriented try failed and the
   * nearest point was used instead).
   */
  junction?: { turnDeg: number | null; oriented: boolean; movedM: number }
}
export interface BlockAccessAttempt extends BlockLanding {
  error?: string
}
export interface BlockAccessResult {
  options: BlockAccessOption[]
  attempts: BlockAccessAttempt[]
  message: string
}

const outerRing = (block: ContextFeature) => {
  if (block.geometry.type !== 'Polygon' || !block.geometry.coordinates[0]?.length)
    throw Error('Choose a block drawn or imported as an area.')
  return block.geometry.coordinates[0]
}

/**
 * Which roads a block may connect to: mapped FSR sections only, or any active mapped road (FSR, permit
 * or tenure road). Closed and retired roads are never targets.
 */
export type BlockAccessTargets = 'fsr' | 'mapped-roads'

/** Closest point on every active mapped road, per road, as an FSR target would describe it. */
function nearestMappedRoads(origin: Coordinate, context: ContextFeature[]): FsrConnectionTarget[] {
  return context.flatMap((road) => {
    const evidence = road.roadEvidence
    if (
      road.kind !== 'existing-road' ||
      evidence?.condition === 'closed' ||
      (evidence?.lifecycleStatus && evidence.lifecycleStatus !== 'ACTIVE')
    )
      return []
    const point = nearestExistingRoadPoint(origin, road)
    return point ? [{ ...point, featureId: road.id, name: road.name }] : []
  })
}

/** Samples the block edge and keeps, per target road, the edge point closest to it. */
export function blockLandings(
  block: ContextFeature,
  context: ContextFeature[],
  limit = MAX_BLOCK_ACCESS_OPTIONS,
  targets: BlockAccessTargets = 'fsr',
) {
  const ring = outerRing(block)
  const xScale = M_PER_DEGREE * Math.cos((ring[0][1] * Math.PI) / 180)
  const lengths = ring.slice(1).map((point, i) => {
    const previous = ring[i]
    return Math.hypot((point[0] - previous[0]) * xScale, (point[1] - previous[1]) * M_PER_DEGREE)
  })
  const perimeter = lengths.reduce((sum, length) => sum + length, 0)
  const spacing = Math.max(MIN_EDGE_SPACING_M, perimeter / MAX_EDGE_SAMPLES)
  const samples: Coordinate[] = []
  lengths.forEach((length, i) => {
    const a = ring[i],
      b = ring[i + 1],
      count = Math.max(1, Math.ceil(length / spacing))
    for (let j = 0; j < count; j++)
      samples.push([a[0] + ((b[0] - a[0]) * j) / count, a[1] + ((b[1] - a[1]) * j) / count])
  })
  const best = new Map<string, BlockLanding>()
  for (const landing of samples)
    for (const target of targets === 'fsr'
      ? nearestFsrConnections(landing, context, 10)
      : nearestMappedRoads(landing, context)) {
      const previous = best.get(target.featureId)
      if (!previous || target.distanceM < previous.target.distanceM) best.set(target.featureId, { landing, target })
    }
  return [...best.values()]
    .sort((a, b) => a.target.distanceM - b.target.distanceM || a.target.featureId.localeCompare(b.target.featureId))
    .slice(0, limit)
}

/** The point on a block's outer edge closest to `point`, and its distance in metres. */
export function nearestBlockEdge(
  block: ContextFeature,
  point: Coordinate,
): { coordinate: Coordinate; distanceM: number } {
  const ring = outerRing(block)
  const xScale = M_PER_DEGREE * Math.cos((point[1] * Math.PI) / 180)
  const local = (c: GeoJSON.Position) => [(c[0] - point[0]) * xScale, (c[1] - point[1]) * M_PER_DEGREE]
  let best: { coordinate: Coordinate; distanceM: number } = {
    coordinate: [ring[0][0], ring[0][1]],
    distanceM: Infinity,
  }
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = local(ring[i - 1]),
      [bx, by] = local(ring[i])
    const dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0
    const distanceM = Math.hypot(ax + t * dx, ay + t * dy)
    if (distanceM < best.distanceM)
      best = {
        coordinate: [
          ring[i - 1][0] + t * (ring[i][0] - ring[i - 1][0]),
          ring[i - 1][1] + t * (ring[i][1] - ring[i - 1][1]),
        ],
        distanceM,
      }
  }
  return best
}

/** Steepest signed grades from start to end, read every metre on the ground the search used. */
export function steepestGrades(coordinates: Coordinate[], terrain: TerrainSource) {
  let uphill = 0,
    downhill = 0
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1],
      b = coordinates[i]
    const xScale = M_PER_DEGREE * Math.cos((a[1] * Math.PI) / 180)
    const length = Math.hypot((b[0] - a[0]) * xScale, (b[1] - a[1]) * M_PER_DEGREE)
    const count = Math.max(1, Math.ceil(length))
    let previous = terrain.elevationAt(a[0], a[1])
    for (let j = 1; j <= count; j++) {
      const f = j / count
      const elevation = terrain.elevationAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
      if (Number.isFinite(previous) && Number.isFinite(elevation)) {
        const grade = ((elevation - previous) / (length / count)) * 100
        uphill = Math.max(uphill, grade)
        downhill = Math.max(downhill, -grade)
      }
      previous = elevation
    }
  }
  return { uphill, downhill }
}

/**
 * Proposes access roads from a harvest block to the nearest mapped FSR sections: one landing on the
 * block edge closest to each section, one terrain-cost route from it. Loaded travel runs from the
 * landing out to the FSR, so any directional grade limits are applied that way round. Options are
 * ranked by search score; none is a confirmed junction, access right or road condition.
 */
export function suggestBlockAccess(
  block: ContextFeature,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  input: Partial<RouteSearchOptions> = {},
  limit = MAX_BLOCK_ACCESS_OPTIONS,
  targets: BlockAccessTargets = 'fsr',
  orientation?: JunctionOrientation,
): BlockAccessResult {
  const parsed = parseRouteSearchOptions(input)
  const options: RouteSearchOptions = {
    ...parsed,
    alternatives: 1,
    haulGrades: parsed.haulGrades && { ...parsed.haulGrades, loadedDirection: 'start-to-end' },
  }
  const landings = blockLandings(block, context, limit, targets)
  if (!landings.length)
    throw Error(
      targets === 'fsr'
        ? 'No mapped FSR sections are loaded near this block. Load BC FSRs or import an identified FSR network first. Closed roads are excluded.'
        : 'No active mapped roads are loaded near this block. Closed roads are excluded.',
    )
  const ground = groundTrendTerrain(terrain, options.groundWindowM ?? 0)
  const attempts: BlockAccessAttempt[] = []
  const found: BlockAccessOption[] = []
  for (const candidate of landings) {
    if (candidate.target.distanceM < 2) {
      attempts.push({ ...candidate, error: 'The block already meets this FSR; inspect the junction instead.' })
      continue
    }
    try {
      // Oriented: try junctions along the host, best first, each holding the arrival heading that
      // turns loaded trucks out toward the destination; the nearest point is the fallback.
      const host = orientation && context.find((feature) => feature.id === candidate.target.featureId)
      const tries =
        orientation && host?.geometry.type === 'LineString'
          ? junctionCandidates(
              candidate.landing,
              host.geometry.coordinates as Coordinate[],
              candidate.target,
              orientation.departureAt,
              orientation.rule,
            )
          : []
      let routed: { route: RouteCandidate; target: FsrConnectionTarget; oriented: boolean; movedM: number } | null =
        null
      for (const at of tries) {
        try {
          const route = suggestRoutes(candidate.landing, at.coordinate, terrain, settings, context, {
            ...options,
            endHeading: at.arrivalHeading,
          }).routes[0]
          const target = {
            ...candidate.target,
            ...(host && nearestExistingRoadPoint(at.coordinate, host)),
            coordinate: at.coordinate,
            distanceM: at.approachM,
          }
          routed = { route, target, oriented: true, movedM: Math.abs(at.offsetM) }
          break
        } catch {
          // This junction cannot be reached at its heading; try the next.
        }
      }
      routed ??= {
        route: suggestRoutes(candidate.landing, candidate.target.coordinate, terrain, settings, context, options)
          .routes[0],
        target: candidate.target,
        oriented: false,
        movedM: 0,
      }
      const { route, target } = routed
      const grades = steepestGrades(route.coordinates, ground)
      const departure = orientation?.departureAt(target.coordinate) ?? null
      found.push({
        ...route,
        landing: candidate.landing,
        target,
        steepestLoadedUphillPercent: grades.uphill,
        steepestEmptyUphillPercent: grades.downhill,
        ...(orientation && {
          junction: {
            turnDeg:
              departure === null
                ? null
                : (measureJunction(route.coordinates, departure, orientation.rule)?.turnDeg ?? null),
            oriented: routed.oriented,
            movedM: routed.movedM,
          },
        }),
      })
      attempts.push(candidate)
    } catch (error) {
      attempts.push({ ...candidate, error: error instanceof Error ? error.message : 'Route search failed.' })
    }
  }
  if (!found.length)
    throw Error(
      `No access route from ${block.name} to the ${landings.length} nearest FSR section${landings.length === 1 ? '' : 's'} passed the terrain and route limits. ${attempts.map((attempt) => `${attempt.target.name}: ${attempt.error}`).join(' ')}`,
    )
  // Oriented: a junction within the turn limit leads any that is not, whatever it costs to search.
  const sharp = (option: BlockAccessOption) =>
    orientation && option.junction
      ? Number((option.junction.turnDeg ?? Infinity) > orientation.rule.maxTurnDeg + 1e-9)
      : 0
  found.sort((a, b) => sharp(a) - sharp(b) || a.searchScore - b.searchScore || a.target.distanceM - b.target.distanceM)
  const cheapest = found[0]
  return {
    options: found,
    attempts,
    message: `${found.length} access option${found.length === 1 ? '' : 's'} from ${block.name} to ${found.length === 1 ? cheapest.target.name : `${found.length} FSR sections`}; lowest search score to ${cheapest.target.name}, ${Math.round(cheapest.lengthM).toLocaleString('en-CA')} m. Each landing is the block edge closest to its FSR, and loaded travel runs from the landing to the FSR. ${orientation ? ` Junctions were placed along each road within ${orientation.rule.windowM} m of its nearest point so loaded trucks turn out toward the destination through at most ${orientation.rule.maxTurnDeg}°${found.some((option) => option.junction && !option.junction.oriented) ? '; where no such junction could be reached, the nearest point was used and its turn is shown' : ''}.` : ''} Junctions, road condition and access rights need review.`,
  }
}
