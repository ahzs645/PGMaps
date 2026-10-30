import { alignmentLength, distance, horizontalCurveSummary, positionAt } from './engine'
import type { Alignment, RoadTemplate } from './types'
import type { RoadOptimizationResult } from './corridorOptimizer'

/** Create a new alternative; never transplant station-based structures onto a changed route. */
export function corridorCandidate(
  result: RoadOptimizationResult,
  template: RoadTemplate,
  name: string,
  id: () => string = () => crypto.randomUUID(),
): Alignment {
  const candidate: Alignment = {
    id: id(),
    name: name.slice(0, 200),
    color: '#2563eb',
    points: result.controlPoints.map((p) => ({ id: id(), coordinate: [...p.coordinate], radiusM: p.radiusM })),
    vertical: [],
    template: structuredClone(template),
    overrides: [],
  }
  const length = alignmentLength(candidate)
  const curves = horizontalCurveSummary(candidate)
  const expected = result.controlPoints.filter((p) => p.radiusM > 0)
  if (
    Math.abs(length - result.lengthM) > 0.001 ||
    curves.length !== expected.length ||
    curves.some((c, i) => Math.abs(c.radius - expected[i].radiusM) > 0.001)
  )
    throw Error('The candidate does not reproduce its verified curves in the road engine; nothing was adopted.')
  // Independent check against the real application's coordinate/chainage model.
  const stride = Math.max(1, Math.floor(result.profile.length / 32))
  for (let i = 0; i < result.profile.length; i += stride) {
    if (distance(positionAt(candidate, result.profile[i].stationM).coordinate, result.coordinates[i]) > 0.002)
      throw Error('Candidate map/profile registration check failed; nothing was adopted.')
  }
  return candidate
}
