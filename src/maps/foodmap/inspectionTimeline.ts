import { timelineBucketKey } from '@pgmaps/geo-toolkit/calculations/timeline'
import type { HazardRating, Inspection, Restaurant } from './types'

const SHORT_MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

/** Worst-last, so a rise in rank is a worse rating. Unknown is not a rating. */
const RATING_RANK: Partial<Record<HazardRating, number>> = { Low: 0, Moderate: 1, High: 2 }

/**
 * 35% of inspections before this month found a violation against 65% after,
 * ramping up over the following months. The violation codes barely change, so
 * it isn't a recoding, but the record doesn't say what did change. Windows
 * reaching before it carry a note so playback doesn't read as a real decline.
 */
export const VIOLATION_RATE_SHIFT = new Date(2022, 8, 1)

export interface InspectionMonthRange {
  /** First of the month holding the earliest inspection. */
  start: Date
  /** First of the month holding the latest inspection. */
  end: Date
}

export interface RatingChange {
  restaurant: Restaurant
  date: Date
  from: HazardRating
  to: HazardRating
  direction: 'worse' | 'better'
}

/** Parse "18-Mar-2024" or "March 18, 2024" as a local date. */
export function parseInspectionDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null

  const short = dateStr.match(/(\d{1,2})-(\w{3})-(\d{4})/)
  if (short) return new Date(parseInt(short[3]), SHORT_MONTHS[short[2]], parseInt(short[1]))

  if (dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/)) return new Date(dateStr)
  return null
}

export function inspectionDate(inspection: Inspection): Date | null {
  return parseInspectionDate(inspection.date || inspection.inspection_date)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** The months holding inspection records, or null when there are none. */
export function inspectionMonthRange(restaurants: readonly Restaurant[]): InspectionMonthRange | null {
  let first: Date | null = null
  let last: Date | null = null
  for (const restaurant of restaurants) {
    for (const inspection of restaurant.inspections ?? []) {
      const date = inspectionDate(inspection)
      if (!date) continue
      if (!first || date < first) first = date
      if (!last || date > last) last = date
    }
  }
  return first && last ? { start: startOfMonth(first), end: startOfMonth(last) } : null
}

/** The `date` URL param for a month, e.g. "2024-03". */
export function encodeTimelineMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * The month a `date` URL param asks for, kept inside the record. A missing or
 * unreadable param means the latest month with inspections.
 */
export function resolveTimelineMonth(raw: string, range: InspectionMonthRange): Date {
  const match = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) return range.end
  const date = new Date(Number(match[1]), month - 1, 1)
  if (date < range.start) return range.start
  return date > range.end ? range.end : date
}

/**
 * A restaurant's rating as of a moment: its latest inspection on or before it.
 * Pass the end of a month to include that month's inspections. Unknown means
 * no inspection yet, except a premises with no records at all, which keeps its
 * listed rating.
 */
export function hazardRatingAt(restaurant: Restaurant, at: Date): HazardRating {
  const inspections = restaurant.inspections ?? []
  if (inspections.length === 0) return restaurant.hazard_rating || 'Unknown'

  let latest: { date: Date; rating: HazardRating | undefined } | null = null
  for (const inspection of inspections) {
    const date = inspectionDate(inspection)
    if (!date || date > at) continue
    if (!latest || date >= latest.date) latest = { date, rating: inspection.hazard_rating }
  }
  if (!latest) return 'Unknown'
  return latest.rating || restaurant.hazard_rating || 'Unknown'
}

/** Critical violations per month, keyed like the timeline's month buckets. */
export function criticalViolationsByMonth(restaurants: readonly Restaurant[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const restaurant of restaurants) {
    for (const inspection of restaurant.inspections ?? []) {
      const date = inspectionDate(inspection)
      if (!date) continue
      const key = timelineBucketKey(date, 'month')
      counts.set(key, (counts.get(key) ?? 0) + (inspection.critical_violations_count || 0))
    }
  }
  return counts
}

/** Every change between consecutive rated inspections, newest first. */
export function findRatingChanges(restaurants: readonly Restaurant[]): RatingChange[] {
  const changes: RatingChange[] = []
  for (const restaurant of restaurants) {
    const rated = (restaurant.inspections ?? [])
      .map((inspection) => ({ date: inspectionDate(inspection), rating: inspection.hazard_rating }))
      .filter((entry): entry is { date: Date; rating: HazardRating } => {
        return entry.date !== null && RATING_RANK[entry.rating] !== undefined
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    for (let index = 1; index < rated.length; index++) {
      const from = rated[index - 1].rating
      const to = rated[index].rating
      if (from === to) continue
      changes.push({
        restaurant,
        date: rated[index].date,
        from,
        to,
        direction: RATING_RANK[to]! > RATING_RANK[from]! ? 'worse' : 'better',
      })
    }
  }
  return changes.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.restaurant.name.localeCompare(b.restaurant.name),
  )
}

export function ratingChangesByMonth(changes: readonly RatingChange[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const change of changes) {
    const key = timelineBucketKey(change.date, 'month')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
