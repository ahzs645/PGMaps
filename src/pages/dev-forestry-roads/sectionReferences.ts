import type { ContextFeature, Coordinate, TerrainSource } from './types'

/** Shared by every section in one analysis; exhaustion is explicit, never a guessed anchor. */
export const MAX_REFERENCE_SEGMENT_CHECKS = 2_000_000
export interface SectionReferenceSources {
  context?: ContextFeature[]
  referenceSurfaces?: Record<string, TerrainSource>
  verticalReference?: string
  referenceBudget?: { checks: number }
}

/** Nearest intersection on the requested side of the normal transect, using source geometry. */
export function featureSectionAnchor(
  feature: ContextFeature,
  coordinate: Coordinate,
  heading: number,
  side: 'left' | 'right',
  budget: { checks: number },
): { offset: number; elevation: number | null } | null {
  const rad = Math.PI / 180,
    earth = 6371008.8,
    angle = heading * rad
  const local = (point: number[]) => {
    const east = (point[0] - coordinate[0]) * rad * earth * Math.cos(coordinate[1] * rad)
    const north = (point[1] - coordinate[1]) * rad * earth
    return {
      along: east * Math.sin(angle) + north * Math.cos(angle),
      offset: east * Math.cos(angle) - north * Math.sin(angle),
      z: Number.isFinite(point[2]) ? point[2] : null,
    }
  }
  const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  let best: { offset: number; elevation: number | null } | null = null
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      if (++budget.checks > MAX_REFERENCE_SEGMENT_CHECKS)
        throw Error('Section reference budget exceeds 2,000,000 segment checks; crop or simplify reference features.')
      const a = local(line[i - 1]),
        b = local(line[i]),
        span = b.along - a.along
      if (Math.abs(span) < 1e-9 || a.along * b.along > 1e-12) continue
      const t = -a.along / span
      if (t < -1e-9 || t > 1 + 1e-9) continue
      const offset = a.offset + (b.offset - a.offset) * t
      if ((side === 'left' && offset >= 0) || (side === 'right' && offset <= 0)) continue
      const elevation = a.z !== null && b.z !== null ? a.z + (b.z - a.z) * t : null
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { offset, elevation }
    }
  return best
}
