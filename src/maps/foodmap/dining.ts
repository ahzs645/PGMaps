import type { EstablishmentType, Restaurant } from './types'

/** Dining choices, separate from the health authority's broader facility registry. */
export const DINING_CATEGORIES = [
  'Restaurant',
  'Food Truck',
  'Coffee Shop',
  'Bar/Pub',
  'Brewery/Winery',
  'Bakery',
  'Deli',
  'Stand',
] as const satisfies readonly EstablishmentType[]

export type DiningCategory = (typeof DINING_CATEGORIES)[number]

/** Opt-in spinner category for places outside the default dining list. */
export const OTHER_SPOTS = 'Other spots'

export const ROULETTE_CATEGORIES = [...DINING_CATEGORIES, OTHER_SPOTS] as const

export type RouletteCategory = DiningCategory | typeof OTHER_SPOTS

// These are spinner eligibility decisions, not corrections to inspection data.
// Keep exact-name entries auditable in docs/food-spinner-categories.md.
const OTHER_SPOT_NAMES: ReadonlySet<string> = new Set([
  'Costco Food Court',
  '7-Eleven Food Store #37259',
  '7-Eleven Food Store #37263',
  'Active Body Nutrition',
  'Royal Canadian Legion #43',
  'Crush Night Club',
  'Ignite Night Club',
  'The Underground Show Lounge and Bar',
])

export function diningCategory(
  restaurant: Pick<Restaurant, 'name' | 'establishment_type' | 'facility_type'>,
): RouletteCategory | null {
  if (OTHER_SPOT_NAMES.has(restaurant.name)) return OTHER_SPOTS
  const category = restaurant.establishment_type || restaurant.facility_type
  return DINING_CATEGORIES.find((candidate) => candidate === category) ?? null
}

export function selectDiningRestaurants<T extends Restaurant>(
  restaurants: readonly T[],
  categories: readonly RouletteCategory[] = DINING_CATEGORIES,
): T[] {
  return restaurants.filter((restaurant) => {
    const category = diningCategory(restaurant)
    return category !== null && categories.includes(category)
  })
}
