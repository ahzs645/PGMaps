import { nearestFsrConnections } from './fsrNetwork'
import type { FsrConnectionTarget } from './fsrConnections'
import { groundTrendTerrain } from './groundTrend'
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

/** Samples the block edge and keeps, per mapped FSR section, the edge point closest to it. */
export function blockLandings(block: ContextFeature, context: ContextFeature[], limit = MAX_BLOCK_ACCESS_OPTIONS) {
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
    for (const target of nearestFsrConnections(landing, context, 10)) {
      const previous = best.get(target.featureId)
      if (!previous || target.distanceM < previous.target.distanceM) best.set(target.featureId, { landing, target })
    }
  return [...best.values()]
    .sort((a, b) => a.target.distanceM - b.target.distanceM || a.target.featureId.localeCompare(b.target.featureId))
    .slice(0, limit)
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
): BlockAccessResult {
  const parsed = parseRouteSearchOptions(input)
  const options: RouteSearchOptions = {
    ...parsed,
    alternatives: 1,
    haulGrades: parsed.haulGrades && { ...parsed.haulGrades, loadedDirection: 'start-to-end' },
  }
  const landings = blockLandings(block, context, limit)
  if (!landings.length)
    throw Error(
      'No mapped FSR sections are loaded near this block. Load BC FSRs or import an identified FSR network first. Closed roads are excluded.',
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
      const route = suggestRoutes(candidate.landing, candidate.target.coordinate, terrain, settings, context, options)
        .routes[0]
      const grades = steepestGrades(route.coordinates, ground)
      found.push({
        ...route,
        ...candidate,
        steepestLoadedUphillPercent: grades.uphill,
        steepestEmptyUphillPercent: grades.downhill,
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
  found.sort((a, b) => a.searchScore - b.searchScore || a.target.distanceM - b.target.distanceM)
  const cheapest = found[0]
  return {
    options: found,
    attempts,
    message: `${found.length} access option${found.length === 1 ? '' : 's'} from ${block.name} to ${found.length === 1 ? cheapest.target.name : `${found.length} FSR sections`}; lowest search score to ${cheapest.target.name}, ${Math.round(cheapest.lengthM).toLocaleString('en-CA')} m. Each landing is the block edge closest to its FSR, and loaded travel runs from the landing to the FSR. Junctions, road condition and access rights need review.`,
  }
}
