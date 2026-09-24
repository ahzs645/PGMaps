import { describe, expect, it } from 'vitest'
import {
  FOOD_VIOLATION_BUCKETS,
  getViolationBadgeLabel,
  getViolationBucket,
  getViolationBucketIndex,
  VIOLATION_BUCKET_STYLES,
} from './violationBuckets'

describe('violation buckets', () => {
  it('keeps places with no inspection out of the clean-record bucket', () => {
    expect(getViolationBucket({ total: 0, inspectionCount: 0 })).toBe('uninspected')
    expect(getViolationBucket(undefined)).toBe('uninspected')
    expect(getViolationBucket({ total: 0, inspectionCount: 2 })).toBe('zero')
    expect(getViolationBadgeLabel({ total: 0, inspectionCount: 0 })).toBe('Not inspected')
    expect(getViolationBadgeLabel({ total: 0, inspectionCount: 1 })).toBe('0 violations')
  })

  it('bands inspected places by violation count', () => {
    expect(getViolationBucket({ total: 2, inspectionCount: 1 })).toBe('low')
    expect(getViolationBucket({ total: 3, inspectionCount: 1 })).toBe('medium')
    expect(getViolationBucket({ total: 6, inspectionCount: 1 })).toBe('high')
    expect(getViolationBadgeLabel({ total: 1, inspectionCount: 1 })).toBe('1 violation')
  })

  it('lists styles in the same order as the bucket keys the donut indexes into', () => {
    expect(VIOLATION_BUCKET_STYLES.map((style) => style.key)).toEqual([...FOOD_VIOLATION_BUCKETS])
    expect(getViolationBucketIndex({ total: 0, inspectionCount: 0 })).toBe(FOOD_VIOLATION_BUCKETS.length - 1)
  })
})
