/**
 * Turns a traced or terrain-found line into an existing road in the project's context: user
 * linework, unknown condition, unreviewed and not enabled for reuse, with a record of how it was
 * made. As an active existing road it can be picked as the road to connect to. The record it came
 * from is never changed. Pure: no DOM or network access.
 */
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import type { RoadFindResult } from './roadRelocation'
import type { ContextFeature, Coordinate, RoadLineOrigin } from './types'

const round = (value: number, digits = 1) => Number(value.toFixed(digits))

export function roadLineFeature({
  id,
  name,
  coordinates,
  origin,
}: {
  id: string
  name: string
  coordinates: Coordinate[]
  origin: RoadLineOrigin
}): ContextFeature {
  if (coordinates.length < 2) throw Error('A road line needs at least two points.')
  return {
    id,
    name: name.slice(0, 200),
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: coordinates.map((c) => [c[0], c[1]]) },
    roadEvidence: { ...unreviewedRoadEvidence('user'), roadClass: 'user', lineOrigin: origin },
  }
}

/** The origin record of a candidate a reviewer adopted from a terrain search. */
export function relocationOrigin(
  result: RoadFindResult,
  fromName: string,
  terrainCellM: number,
  createdAt = new Date().toISOString(),
): RoadLineOrigin {
  return {
    method: 'terrain-relocation',
    fromName: fromName.slice(0, 200),
    createdAt,
    terrainCellM: round(terrainCellM, 2),
    foundPercent: round(result.foundShare * 100, 0),
    ...(result.shiftM ? { medianShiftM: round(result.shiftM.p50), p90ShiftM: round(result.shiftM.p90) } : {}),
    ...(result.slices?.widthM ? { benchWidthM: round(result.slices.widthM.p50) } : {}),
    scoredWith: result.mode,
    corridorM: result.settings.corridorM,
    confidence: result.settings.confidence,
    flatToleranceM: result.settings.flatToleranceM,
    ...(result.state
      ? {
          drivableWidthM: round(result.state.input.drivableWidthM),
          vegetationPercent: round(result.state.input.vegetationPercent),
          stateScore: round(result.state.score),
          stateClass: result.state.stateClass,
        }
      : {}),
  }
}

/** One line for a card: how this road's line was made. */
export function describeLineOrigin(origin: RoadLineOrigin): string {
  const cell = origin.terrainCellM !== undefined ? ` on ${origin.terrainCellM} m terrain` : ''
  if (origin.method === 'terrain-relocation')
    return (
      `Found${cell}${origin.fromName ? ` from ${origin.fromName}` : ''}: bench along ${origin.foundPercent ?? '—'}%` +
      (origin.medianShiftM !== undefined ? `, median ${origin.medianShiftM} m from the record` : '') +
      (origin.stateClass !== undefined
        ? `; LiDAR state class ${origin.stateClass} (score ${origin.stateScore ?? '—'})`
        : '')
    )
  if (origin.method === 'terrain-trace')
    return `Traced${cell}: ${origin.snappedSegments ?? 0} of ${origin.segments ?? 0} segments followed a road bench`
  return `Traced by clicks${origin.segments ? ` (${origin.segments} segments)` : ''}; not checked against terrain`
}
