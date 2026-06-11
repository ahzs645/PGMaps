import type { ScoreBandSummary, ScoredBoundaryRegion } from '../types'

export interface ScoreSpread {
  min: number
  max: number
  average: number
}

export function summarizeScores(regions: ScoredBoundaryRegion[]): ScoreSpread {
  if (!regions.length) return { min: 0, max: 0, average: 0 }
  const values = regions.map((entry) => entry.score)
  const sum = values.reduce((total, value) => total + value, 0)
  return { min: Math.min(...values), max: Math.max(...values), average: sum / values.length }
}

export function buildScoreBandSummary(regions: ScoredBoundaryRegion[]): ScoreBandSummary[] {
  const definitions: Array<Omit<ScoreBandSummary, 'count'>> = [
    { key: 'high', label: 'High fit', description: 'Strongest matches for the active model.', min: 70, max: 100 },
    { key: 'moderate', label: 'Moderate fit', description: 'Worth reviewing with local context.', min: 55, max: 70 },
    { key: 'low', label: 'Low fit', description: 'Below the current model average target.', min: 40, max: 55 },
    { key: 'watchlist', label: 'Watchlist', description: 'Lowest-scoring or constrained areas.', min: 0, max: 40 },
  ]

  return definitions.map((band) => ({
    ...band,
    count: regions.filter((region) =>
      band.key === 'high'
        ? region.score >= band.min
        : band.key === 'watchlist'
          ? region.score < band.max
          : region.score >= band.min && region.score < band.max,
    ).length,
  }))
}
