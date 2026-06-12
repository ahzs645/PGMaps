import type { ScoredBoundaryRegion } from '../types'

/** A frozen copy of the ranking at the moment the user pinned a baseline. */
export interface BaselineSnapshot {
  label: string
  capturedAt: string
  topRegionName: string | null
  entries: Array<{ id: string; name: string; rank: number; score: number }>
}

export interface BaselineRegionDelta {
  id: string
  name: string
  baselineRank: number
  currentRank: number
  rankDelta: number
  scoreDelta: number
}

export interface BaselineComparisonResult {
  sharedRegionCount: number
  newRegionCount: number
  droppedRegionCount: number
  averageAbsRankShift: number
  averageScoreDelta: number
  topChanged: boolean
  currentTopName: string | null
  /** Regions whose rank moved the most since the baseline, biggest movers first. */
  topMovers: BaselineRegionDelta[]
}

export function captureBaselineSnapshot(regions: ScoredBoundaryRegion[], label: string): BaselineSnapshot {
  return {
    label,
    capturedAt: new Date().toISOString(),
    topRegionName: regions[0]?.region.name ?? null,
    entries: regions.map((entry) => ({
      id: entry.region.id,
      name: entry.region.name,
      rank: entry.rank,
      score: entry.score,
    })),
  }
}

export function compareAgainstBaseline(
  baseline: BaselineSnapshot,
  regions: ScoredBoundaryRegion[],
  moverLimit = 6,
): BaselineComparisonResult {
  const baselineById = new Map(baseline.entries.map((entry) => [entry.id, entry]))
  const currentIds = new Set(regions.map((entry) => entry.region.id))

  const deltas: BaselineRegionDelta[] = []
  for (const entry of regions) {
    const before = baselineById.get(entry.region.id)
    if (!before) continue
    deltas.push({
      id: entry.region.id,
      name: entry.region.name,
      baselineRank: before.rank,
      currentRank: entry.rank,
      rankDelta: before.rank - entry.rank,
      scoreDelta: entry.score - before.score,
    })
  }

  const sharedRegionCount = deltas.length
  const averageAbsRankShift = sharedRegionCount
    ? deltas.reduce((sum, delta) => sum + Math.abs(delta.rankDelta), 0) / sharedRegionCount
    : 0
  const averageScoreDelta = sharedRegionCount
    ? deltas.reduce((sum, delta) => sum + delta.scoreDelta, 0) / sharedRegionCount
    : 0

  const topMovers = [...deltas]
    .sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta) || Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
    .filter((delta) => delta.rankDelta !== 0 || Math.abs(delta.scoreDelta) >= 0.05)
    .slice(0, moverLimit)

  const currentTopName = regions[0]?.region.name ?? null

  return {
    sharedRegionCount,
    newRegionCount: regions.filter((entry) => !baselineById.has(entry.region.id)).length,
    droppedRegionCount: baseline.entries.filter((entry) => !currentIds.has(entry.id)).length,
    averageAbsRankShift,
    averageScoreDelta,
    topChanged: (baseline.topRegionName ?? null) !== currentTopName,
    currentTopName,
    topMovers,
  }
}
