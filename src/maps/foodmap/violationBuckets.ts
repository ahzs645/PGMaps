import type { ViolationStats } from './types'

/**
 * Violation-count bands shared by the map markers, cluster donuts, legend,
 * sidebar cards and WebMCP tools.
 *
 * 'uninspected' is kept apart from 'zero' on purpose: most establishments have
 * no inspection inside a short period, and folding them into "0 violations"
 * painted hundreds of places with a clean record nobody observed.
 */
export const FOOD_VIOLATION_BUCKETS = ['zero', 'low', 'medium', 'high', 'uninspected'] as const
export type FoodViolationBucket = (typeof FOOD_VIOLATION_BUCKETS)[number]

type BucketStats = Pick<ViolationStats, 'total' | 'inspectionCount'>

export interface ViolationBucketStyle {
  key: FoodViolationBucket
  label: string
  /** Legend swatch and cluster donut wedge colour. */
  color: string
  /** Marker fill per theme. */
  markerColor: { light: string; dark: string }
  /** Sidebar/popup count badge. Only real problems get a solid fill. */
  badgeClass: string
  /** Sidebar list dot. */
  dotClass: string
}

export const VIOLATION_BUCKET_STYLES: readonly ViolationBucketStyle[] = [
  {
    key: 'zero',
    label: '0 violations',
    color: '#22c55e',
    markerColor: { light: '#30a46c', dark: '#33b074' },
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    dotClass: 'bg-green-500',
  },
  {
    key: 'low',
    label: '1-2 violations',
    color: '#eab308',
    markerColor: { light: '#ffe629', dark: '#ffff57' },
    badgeClass: 'bg-yellow-400 text-yellow-950',
    dotClass: 'bg-yellow-500',
  },
  {
    key: 'medium',
    label: '3-5 violations',
    color: '#f97316',
    markerColor: { light: '#f76b15', dark: '#ff801f' },
    badgeClass: 'bg-orange-500 text-white',
    dotClass: 'bg-orange-500',
  },
  {
    key: 'high',
    label: '6+ violations',
    color: '#ef4444',
    markerColor: { light: '#e5484d', dark: '#ec5d5e' },
    badgeClass: 'bg-red-500 text-white',
    dotClass: 'bg-red-500',
  },
  {
    key: 'uninspected',
    label: 'Not inspected',
    color: '#9ca3af',
    markerColor: { light: '#b0b4ba', dark: '#6f737a' },
    badgeClass: 'border border-dashed border-border text-muted-foreground',
    dotClass: 'bg-gray-400 dark:bg-gray-500',
  },
]

const STYLE_BY_KEY = new Map(VIOLATION_BUCKET_STYLES.map((style) => [style.key, style]))

export function getViolationBucket(stats: BucketStats | null | undefined): FoodViolationBucket {
  if (!stats || stats.inspectionCount === 0) return 'uninspected'
  if (stats.total === 0) return 'zero'
  if (stats.total <= 2) return 'low'
  if (stats.total <= 5) return 'medium'
  return 'high'
}

export function getViolationBucketStyle(stats: BucketStats | null | undefined): ViolationBucketStyle {
  return STYLE_BY_KEY.get(getViolationBucket(stats))!
}

export function getViolationBucketIndex(stats: BucketStats | null | undefined): number {
  return FOOD_VIOLATION_BUCKETS.indexOf(getViolationBucket(stats))
}

/** Badge text: a count when the place was inspected, otherwise say so. */
export function getViolationBadgeLabel(stats: BucketStats | null | undefined): string {
  if (!stats || stats.inspectionCount === 0) return 'Not inspected'
  return `${stats.total} violation${stats.total === 1 ? '' : 's'}`
}
