import type { HazardRating } from './types'

interface HazardRatingSource {
  hazardRatingAtDate?: HazardRating | null
  current_hazard_rating?: HazardRating | null
  hazard_rating?: HazardRating | null
}

/**
 * Resolve a restaurant's NHA hazard rating: current -> last-known -> 'Unknown'.
 * Pass `atDate: true` to prefer the timeline-scrubbed rating when present.
 */
export function getHazardRating(restaurant: HazardRatingSource, { atDate = false }: { atDate?: boolean } = {}): HazardRating {
  return (
    ((atDate ? restaurant.hazardRatingAtDate : undefined) ||
      restaurant.current_hazard_rating ||
      restaurant.hazard_rating ||
      'Unknown') as HazardRating
  )
}

/** Hazard rating hex colors for map paint, per theme. */
export const HAZARD_HEX_COLORS: Record<'light' | 'dark', Record<HazardRating, string>> = {
  light: {
    Low: '#30a46c',
    Moderate: '#ffc53d',
    Unknown: '#8b8d98',
  },
  dark: {
    Low: '#33b074',
    Moderate: '#ffd60a',
    Unknown: '#777b84',
  },
}

/** Tailwind classes per hazard rating for chips, badges, and wheel slices. */
export const HAZARD_TAILWIND: Record<HazardRating, { bg: string; border: string; text: string }> = {
  Low: { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-600 dark:text-green-400' },
  Moderate: { bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  Unknown: { bg: 'bg-gray-500', border: 'border-gray-500', text: 'text-gray-600 dark:text-gray-400' },
}
