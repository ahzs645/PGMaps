import { describe, expect, it } from 'vitest'

import { timelineBucketKey } from '@pgmaps/geo-toolkit/calculations/timeline'
import {
  criticalViolationsByMonth,
  encodeTimelineMonth,
  endOfMonth,
  findRatingChanges,
  hazardRatingAt,
  inspectionMonthRange,
  parseInspectionDate,
  ratingChangesByMonth,
  resolveTimelineMonth,
} from './inspectionTimeline'
import type { HazardRating, Inspection, Restaurant } from './types'

function inspection(date: string, hazard_rating: HazardRating, critical = 0): Inspection {
  return { date, hazard_rating, critical_violations_count: critical, non_critical_violations_count: 0 }
}

function restaurant(name: string, inspections: Inspection[], hazard_rating: HazardRating = 'Low'): Restaurant {
  return {
    name,
    address: '1 Test Street',
    latitude: 53.9,
    longitude: -122.7,
    facility_type: 'Restaurant',
    establishment_type: 'Restaurant',
    hazard_rating,
    details_url: `https://example.test/${name}`,
    inspections,
  }
}

describe('inspection timeline', () => {
  it('parses both date formats the source uses', () => {
    expect(parseInspectionDate('18-Mar-2024')).toEqual(new Date(2024, 2, 18))
    expect(parseInspectionDate('March 18, 2024')).toEqual(new Date(2024, 2, 18))
    expect(parseInspectionDate('not a date')).toBeNull()
    expect(parseInspectionDate(undefined)).toBeNull()
  })

  it('ends the record at the last inspection, not today', () => {
    const range = inspectionMonthRange([
      restaurant('A', [inspection('18-Mar-2024', 'Low'), inspection('2-Apr-2026', 'Low')]),
      restaurant('B', [inspection('30-Dec-2020', 'Low')]),
      restaurant('C', []),
    ])
    expect(range).toEqual({ start: new Date(2020, 11, 1), end: new Date(2026, 3, 1) })
    expect(inspectionMonthRange([restaurant('C', [])])).toBeNull()
  })

  it('reads a date param inside the record and falls back to its latest month', () => {
    const range = { start: new Date(2020, 11, 1), end: new Date(2026, 3, 1) }
    expect(resolveTimelineMonth('2024-03', range)).toEqual(new Date(2024, 2, 1))
    expect(resolveTimelineMonth('2024-03-18', range)).toEqual(new Date(2024, 2, 1))
    expect(resolveTimelineMonth('2019-01', range)).toEqual(range.start)
    expect(resolveTimelineMonth('2026-11', range)).toEqual(range.end)
    expect(resolveTimelineMonth('', range)).toEqual(range.end)
    expect(resolveTimelineMonth('2024-13', range)).toEqual(range.end)
    expect(resolveTimelineMonth('soon', range)).toEqual(range.end)
    expect(encodeTimelineMonth(new Date(2024, 2, 1))).toBe('2024-03')
  })

  it('counts an inspection in its own month for a rating read at month end', () => {
    const place = restaurant('A', [inspection('1-Feb-2024', 'Low'), inspection('18-Mar-2024', 'High')])
    expect(hazardRatingAt(place, new Date(2024, 2, 1))).toBe('Low')
    expect(hazardRatingAt(place, endOfMonth(new Date(2024, 2, 1)))).toBe('High')
  })

  it('reports no rating before the first inspection and a listed rating with no records', () => {
    const place = restaurant('A', [inspection('18-Mar-2024', 'Moderate')])
    expect(hazardRatingAt(place, new Date(2024, 1, 1))).toBe('Unknown')
    expect(hazardRatingAt(restaurant('B', [], 'Moderate'), new Date(2024, 1, 1))).toBe('Moderate')
  })

  it('sums critical violations under the timeline bucket key', () => {
    const counts = criticalViolationsByMonth([
      restaurant('A', [inspection('1-Mar-2024', 'Low', 2), inspection('31-Mar-2024', 'Low', 1)]),
      restaurant('B', [inspection('15-Mar-2024', 'Low', 4), inspection('15-Apr-2024', 'Low')]),
    ])
    expect(counts.get(timelineBucketKey(new Date(2024, 2, 1), 'month'))).toBe(7)
    expect(counts.get(timelineBucketKey(new Date(2024, 3, 1), 'month'))).toBe(0)
  })

  it('finds rating changes between consecutive inspections, newest first', () => {
    const place = restaurant('A', [
      inspection('1-Jun-2024', 'Low'),
      inspection('1-Feb-2024', 'Low'),
      inspection('1-Mar-2024', 'High'),
      inspection('1-Apr-2024', 'High'),
    ])
    const changes = findRatingChanges([place])
    expect(changes.map(({ from, to, direction }) => [from, to, direction])).toEqual([
      ['High', 'Low', 'better'],
      ['Low', 'High', 'worse'],
    ])
    expect(changes[0].date).toEqual(new Date(2024, 5, 1))
    expect(ratingChangesByMonth(changes).get(timelineBucketKey(new Date(2024, 2, 1), 'month'))).toBe(1)
  })

  it('does not count a first inspection or an unrated record as a change', () => {
    expect(findRatingChanges([restaurant('A', [inspection('1-Feb-2024', 'High')])])).toEqual([])
    const gap = restaurant('B', [
      inspection('1-Feb-2024', 'Low'),
      inspection('1-Mar-2024', 'Unknown'),
      inspection('1-Apr-2024', 'Low'),
    ])
    expect(findRatingChanges([gap])).toEqual([])
  })
})
