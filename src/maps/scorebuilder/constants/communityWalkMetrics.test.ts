import { describe, expect, it } from 'vitest'
import { SCORE_METRICS } from './metrics'
import type { ScoreMetricKey } from '../types'

const COMMUNITY_WALK_KEYS: ScoreMetricKey[] = [
  'communityWalkBalanced',
  'communityWalkInfrastructure',
  'communityWalkAccess',
  'communityWalkSafetyAdjusted',
  'communityWalkSupplementedLocal',
]

describe('community walkability variant metrics', () => {
  it('registers all five variants as fully-formed walkability metrics', () => {
    for (const key of COMMUNITY_WALK_KEYS) {
      const metric = SCORE_METRICS.find((entry) => entry.key === key)
      expect(metric, `metric ${key} should be registered`).toBeDefined()
      if (!metric) continue
      expect(metric.category).toBe('walkability')
      expect(metric.direction).toBe('higherIsBetter')
      // Every keyed lookup table must have been filled in (no undefined leaks).
      expect(metric.component).toBeDefined()
      expect(metric.spatialMethod).toBe('directBoundaryJoin')
      expect(metric.uncertainty).toBeDefined()
      expect(metric.indexModule).toBeDefined()
      expect(metric.indexDomain).toBeDefined()
      expect(metric.directionLabel).toBe('higher helps')
    }
  })

  it('registers the MI-surface zonal metric with all lookup tables filled in', () => {
    const metric = SCORE_METRICS.find((entry) => entry.key === 'walkabilityMiSurface')
    expect(metric).toBeDefined()
    if (!metric) return
    expect(metric.category).toBe('walkability')
    expect(metric.direction).toBe('higherIsBetter')
    expect(metric.component).toBeDefined()
    expect(metric.spatialMethod).toBe('pointInPolygon')
    expect(metric.uncertainty).toBeDefined()
    expect(metric.indexModule).toBeDefined()
    expect(metric.indexDomain).toBeDefined()
  })
})
