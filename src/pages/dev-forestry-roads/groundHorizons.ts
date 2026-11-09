/**
 * Ground horizons as one non-overlapping column of material per station. Horizons are entered in
 * list order and a later one replaces an earlier one wherever they overlap in station and depth,
 * so "hard pan over the whole road, then gravel from 0 to 215 m" needs no hand-split ranges and
 * excavation is never counted twice. No DOM or network access.
 */
import type { StratumAssignment } from './engineeringTypes'

export interface HorizonPiece {
  /** Unique within one station: the horizon's id, suffixed when a later horizon splits it in two. */
  id: string
  /** The entered horizon this depth interval comes from. */
  stratumId: string
  materialId: string
  topDepthM: number
  /** Null extends below every finite horizon. */
  bottomDepthM: number | null
}

const EPS = 1e-7
const bottom = (depth: number | null) => depth ?? Infinity

/**
 * The depth intervals in force where every horizon of `active` applies (the caller selects them by
 * station, in entered order). Returned top down; no two intervals overlap.
 */
export function resolveHorizons(active: readonly StratumAssignment[]): HorizonPiece[] {
  let pieces: HorizonPiece[] = []
  for (const horizon of active) {
    const next: HorizonPiece[] = []
    for (const piece of pieces) {
      const overlaps =
        Math.min(bottom(piece.bottomDepthM), bottom(horizon.bottomDepthM)) >
        Math.max(piece.topDepthM, horizon.topDepthM) + EPS
      if (!overlaps) {
        next.push(piece)
        continue
      }
      if (piece.topDepthM < horizon.topDepthM - EPS) next.push({ ...piece, bottomDepthM: horizon.topDepthM })
      if (horizon.bottomDepthM !== null && bottom(piece.bottomDepthM) > horizon.bottomDepthM + EPS)
        next.push({ ...piece, topDepthM: horizon.bottomDepthM })
    }
    next.push({
      id: horizon.id,
      stratumId: horizon.id,
      materialId: horizon.materialId,
      topDepthM: horizon.topDepthM,
      bottomDepthM: horizon.bottomDepthM,
    })
    pieces = next
  }
  pieces.sort((a, b) => a.topDepthM - b.topDepthM)
  const seen = new Map<string, number>()
  return pieces.map((piece) => {
    const count = (seen.get(piece.stratumId) ?? 0) + 1
    seen.set(piece.stratumId, count)
    return count === 1 ? piece : { ...piece, id: `${piece.stratumId}~${count}` }
  })
}

/** For each horizon, the earlier horizons it replaces over part of their station range and depth. */
export function horizonReplacements(strata: readonly StratumAssignment[]): Map<string, string[]> {
  const replaced = new Map<string, string[]>()
  for (let i = 0; i < strata.length; i++) {
    const later = strata[i]
    const earlier = strata
      .slice(0, i)
      .filter(
        (other) =>
          Math.min(later.end, other.end) > Math.max(later.start, other.start) + EPS &&
          Math.min(bottom(later.bottomDepthM), bottom(other.bottomDepthM)) >
            Math.max(later.topDepthM, other.topDepthM) + EPS,
      )
      .map((other) => other.id)
    if (earlier.length) replaced.set(later.id, earlier)
  }
  return replaced
}
