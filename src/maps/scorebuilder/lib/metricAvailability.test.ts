import { describe, expect, it } from 'vitest'
import { SCORE_METRICS } from '../constants'
import type { ScoreMetricDefinition, ScoreMetricWeightMap } from '../types'
import {
  getMetricUnavailability,
  getUnavailableWeightedMetrics,
  isMetricAvailableOnBoundary,
} from './metrics'

function metric(key: string): ScoreMetricDefinition {
  const found = SCORE_METRICS.find((entry) => entry.key === key)
  if (!found) throw new Error(`unknown metric ${key}`)
  return found
}

function weights(entries: Record<string, number>): ScoreMetricWeightMap {
  return entries as ScoreMetricWeightMap
}

describe('isMetricAvailableOnBoundary', () => {
  it('allows metrics that declare no boundary requirement anywhere', () => {
    expect(isMetricAvailableOnBoundary(metric('parkDensity'), 'census')).toBe(true)
    expect(isMetricAvailableOnBoundary(metric('parkDensity'), 'watershed')).toBe(true)
  })

  it('restricts precomputed community walkability to the community boundary', () => {
    expect(isMetricAvailableOnBoundary(metric('communityWalkBalanced'), 'cityCommunity')).toBe(true)
    expect(isMetricAvailableOnBoundary(metric('communityWalkBalanced'), 'census')).toBe(false)
  })
})

describe('getMetricUnavailability', () => {
  it('returns null when the source is on and the boundary matches', () => {
    expect(getMetricUnavailability(metric('parkDensity'), ['parks'], 'cityCommunity')).toBeNull()
  })

  it('reports a switched-off source with the source to re-enable', () => {
    const result = getMetricUnavailability(metric('parkDensity'), ['census'], 'cityCommunity')
    expect(result?.reason).toBe('sourceOff')
    expect(result?.source).toBe('parks')
  })

  it('reports the boundary mismatch first, since no toggle can fix it', () => {
    const result = getMetricUnavailability(metric('communityWalkBalanced'), [], 'census')
    expect(result?.reason).toBe('boundary')
    expect(result?.source).toBeUndefined()
  })

  it('treats custom metrics with no backing source as always available', () => {
    const custom: ScoreMetricDefinition = { ...metric('parkDensity'), key: 'custom_thing', category: 'custom' }
    expect(getMetricUnavailability(custom, [], 'census')).toBeNull()
  })
})

describe('getUnavailableWeightedMetrics', () => {
  it('only flags metrics that carry a weight', () => {
    const result = getUnavailableWeightedMetrics(
      SCORE_METRICS,
      weights({ parkDensity: 25, trailDensity: 0 }),
      ['census'],
      'cityCommunity',
    )
    expect([...result.keys()]).toEqual(['parkDensity'])
  })

  it('flags negative weights too — they are just as dead', () => {
    const result = getUnavailableWeightedMetrics(
      SCORE_METRICS,
      weights({ crimeDensity: -30 }),
      [],
      'cityCommunity',
    )
    expect(result.get('crimeDensity')?.source).toBe('crime')
  })

  it('is empty when every weighted metric can contribute', () => {
    const result = getUnavailableWeightedMetrics(
      SCORE_METRICS,
      weights({ parkDensity: 25, populationDensity: 15 }),
      ['parks', 'census'],
      'cityCommunity',
    )
    expect(result.size).toBe(0)
  })
})
