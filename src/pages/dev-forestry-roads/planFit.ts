import { nearestBlockEdge } from './blockAccess'
import type { Alignment, ContextFeature, Coordinate, RoadProject } from './types'

/** A full-cost plan needs its candidate, connected network and physical supply/destination locations visible. */
export function roadPlanFitCoordinates(
  project: RoadProject,
  target: 'roads' | 'active',
  active: Alignment,
): Coordinate[] {
  const roads = target === 'active' ? [active] : project.alignments
  const coordinates = roads.flatMap((alignment) => alignment.points.map((point) => point.coordinate))
  // A block a road reaches is part of the picture: fit the whole block, not just the landing.
  coordinates.push(...reachedBlockCoordinates(project.context, roads))
  if (target === 'active' || !project.totalCostPlanning) return coordinates
  for (const feature of project.context)
    if (feature.kind === 'existing-road' && feature.geometry.type === 'LineString')
      coordinates.push(...feature.geometry.coordinates.map((point) => [point[0], point[1]] as Coordinate))
  const planning = project.totalCostPlanning
  if (planning.outlet) coordinates.push(planning.outlet)
  for (const source of planning.sources) if (source.entrance) coordinates.push(source.entrance)
  return coordinates
}

/** Harvest blocks an alignment starts or ends within REACHED_BLOCK_M of, as their outer-ring coordinates. */
export function reachedBlockCoordinates(context: ContextFeature[], roads: Alignment[]): Coordinate[] {
  const ends = roads.flatMap((road) =>
    road.points.length ? [road.points[0].coordinate, road.points[road.points.length - 1].coordinate] : [],
  )
  return context
    .filter(
      (feature) =>
        feature.kind === 'harvest' &&
        feature.geometry.type === 'Polygon' &&
        ends.some((end) => nearestBlockEdge(feature, end).distanceM <= REACHED_BLOCK_M),
    )
    .flatMap((block) => (block.geometry as GeoJSON.Polygon).coordinates[0].map(([x, y]) => [x, y] as Coordinate))
}
const REACHED_BLOCK_M = 25
