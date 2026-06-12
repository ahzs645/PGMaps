import { describe, expect, it } from 'vitest'
import { captureBaselineSnapshot, compareAgainstBaseline } from './baselineComparison'
import type { ScoredBoundaryRegion } from '../types'

function region(id: string, name: string, rank: number, score: number): ScoredBoundaryRegion {
  return { region: { id, name }, rank, score } as unknown as ScoredBoundaryRegion
}

describe('baseline comparison', () => {
  const baselineRegions = [region('a', 'Alpha', 1, 80), region('b', 'Beta', 2, 70), region('c', 'Gamma', 3, 60)]

  it('captures the current ranking', () => {
    const snapshot = captureBaselineSnapshot(baselineRegions, 'Test recipe')
    expect(snapshot.label).toBe('Test recipe')
    expect(snapshot.topRegionName).toBe('Alpha')
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries[1]).toMatchObject({ id: 'b', rank: 2, score: 70 })
  })

  it('reports rank movement, score deltas, and top change', () => {
    const snapshot = captureBaselineSnapshot(baselineRegions, 'Test recipe')
    const current = [region('b', 'Beta', 1, 78), region('a', 'Alpha', 2, 74), region('c', 'Gamma', 3, 61)]
    const result = compareAgainstBaseline(snapshot, current)

    expect(result.sharedRegionCount).toBe(3)
    expect(result.topChanged).toBe(true)
    expect(result.currentTopName).toBe('Beta')
    // Beta moved up one (2→1), Alpha moved down one (1→2), Gamma held.
    const beta = result.topMovers.find((mover) => mover.id === 'b')
    const alpha = result.topMovers.find((mover) => mover.id === 'a')
    expect(beta).toMatchObject({ rankDelta: 1, baselineRank: 2, currentRank: 1 })
    expect(alpha).toMatchObject({ rankDelta: -1 })
    expect(result.averageAbsRankShift).toBeCloseTo(2 / 3)
    expect(result.averageScoreDelta).toBeCloseTo((78 - 70 + 74 - 80 + 61 - 60) / 3)
  })

  it('counts regions entering and leaving the comparison universe', () => {
    const snapshot = captureBaselineSnapshot(baselineRegions, 'Test recipe')
    const current = [region('a', 'Alpha', 1, 80), region('d', 'Delta', 2, 75)]
    const result = compareAgainstBaseline(snapshot, current)
    expect(result.sharedRegionCount).toBe(1)
    expect(result.newRegionCount).toBe(1)
    expect(result.droppedRegionCount).toBe(2)
  })

  it('reports no movers when nothing changed', () => {
    const snapshot = captureBaselineSnapshot(baselineRegions, 'Test recipe')
    const result = compareAgainstBaseline(snapshot, baselineRegions)
    expect(result.topMovers).toHaveLength(0)
    expect(result.topChanged).toBe(false)
    expect(result.averageAbsRankShift).toBe(0)
  })
})
