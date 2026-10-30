/** Province-wide source, bounded local discovery and measured centreline connection candidates. */
import { distance } from './engine'
import { loadBcFsrsNear } from './existingRoads'
import type { ContextFeature, Coordinate } from './types'

export const FSR_SEARCH_RADII_M = [2000, 5000, 10000] as const
export interface ExistingRoadPoint {
  coordinate: Coordinate
  distanceM: number
  segmentIndex: number
  fraction: number
}
export interface FsrConnectionPoint extends ExistingRoadPoint {
  featureId: string
  name: string
}

function checkOrigin(origin: Coordinate) {
  if (origin.length !== 2 || !origin.every(Number.isFinite) || Math.abs(origin[0]) > 180 || Math.abs(origin[1]) >= 85)
    throw Error('Choose a valid start point for the FSR connection search.')
}

/** Closest point on each measured line segment in a local metric plane, not the closest stored vertex. */
export function nearestExistingRoadPoint(origin: Coordinate, road: ContextFeature): ExistingRoadPoint | null {
  checkOrigin(origin)
  if (road.geometry.type !== 'LineString') return null
  const xScale = 111195.0802335329 * Math.cos((origin[1] * Math.PI) / 180)
  const yScale = 111195.0802335329
  let nearest: ExistingRoadPoint | null = null
  let squaredDistance = Infinity
  const points = road.geometry.coordinates
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (![a[0], a[1], b[0], b[1]].every(Number.isFinite)) throw Error('An FSR line has invalid coordinates.')
    const ax = (a[0] - origin[0]) * xScale,
      ay = (a[1] - origin[1]) * yScale
    const dx = (b[0] - a[0]) * xScale,
      dy = (b[1] - a[1]) * yScale
    const lengthSquared = dx * dx + dy * dy
    const fraction = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0
    const candidateDistance = (ax + fraction * dx) ** 2 + (ay + fraction * dy) ** 2
    if (candidateDistance >= squaredDistance) continue
    squaredDistance = candidateDistance
    const coordinate: Coordinate = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
    nearest = { coordinate, distanceM: distance(origin, coordinate), segmentIndex: i - 1, fraction }
  }
  return nearest
}

/** Current mapped FSR sections only; road condition and access remain review inputs. */
export function nearestFsrConnections(origin: Coordinate, context: ContextFeature[], limit = 3): FsrConnectionPoint[] {
  checkOrigin(origin)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Error('Compare between 1 and 10 nearest FSR sections.')
  const candidates = new Map<string, FsrConnectionPoint>()
  for (const road of context) {
    const evidence = road.roadEvidence
    if (
      road.kind !== 'existing-road' ||
      evidence?.roadClass !== 'fsr' ||
      evidence.condition === 'closed' ||
      (evidence.lifecycleStatus && evidence.lifecycleStatus !== 'ACTIVE')
    )
      continue
    const point = nearestExistingRoadPoint(origin, road)
    if (!point) continue
    const candidate = { ...point, featureId: road.id, name: road.name }
    const sectionId = evidence.sourceId ? `${evidence.source}:${evidence.sourceId}` : road.id
    const previous = candidates.get(sectionId)
    if (!previous || candidate.distanceM < previous.distanceM) candidates.set(sectionId, candidate)
  }
  return [...candidates.values()]
    .sort((a, b) => a.distanceM - b.distanceM || a.featureId.localeCompare(b.featureId))
    .slice(0, limit)
}

/** Expands only until a nearest mapped section is found; this never downloads the province's full network. */
export async function loadNearestBcFsrs(
  origin: Coordinate,
  signal?: AbortSignal,
  minimumCandidates = 1,
): Promise<{
  roads: ContextFeature[]
  nearest: FsrConnectionPoint[]
  searchedRadiusM: number
}> {
  checkOrigin(origin)
  if (!Number.isInteger(minimumCandidates) || minimumCandidates < 1 || minimumCandidates > 10)
    throw Error('Request between 1 and 10 nearby FSR choices.')
  for (const radius of FSR_SEARCH_RADII_M) {
    if (signal?.aborted) throw new DOMException('FSR search cancelled', 'AbortError')
    const roads = await loadBcFsrsNear(origin, radius, signal)
    const nearest = nearestFsrConnections(origin, roads, 10).filter((p) => p.distanceM <= radius + 1)
    if (nearest.length >= minimumCandidates || radius === FSR_SEARCH_RADII_M.at(-1))
      return { roads, nearest, searchedRadiusM: radius }
  }
  throw Error('The FSR search did not complete.')
}
