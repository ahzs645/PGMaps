import type { Alignment, Coordinate, RoadProject } from './types'

/** A full-cost plan needs its candidate, connected network and physical supply/destination locations visible. */
export function roadPlanFitCoordinates(
  project: RoadProject,
  target: 'roads' | 'active',
  active: Alignment,
): Coordinate[] {
  if (target === 'active') return active.points.map((point) => point.coordinate)
  const coordinates = project.alignments.flatMap((alignment) => alignment.points.map((point) => point.coordinate))
  if (!project.totalCostPlanning) return coordinates
  for (const feature of project.context)
    if (feature.kind === 'existing-road' && feature.geometry.type === 'LineString')
      coordinates.push(...feature.geometry.coordinates.map((point) => [point[0], point[1]] as Coordinate))
  const planning = project.totalCostPlanning
  if (planning.outlet) coordinates.push(planning.outlet)
  for (const source of planning.sources) if (source.entrance) coordinates.push(source.entrance)
  return coordinates
}
