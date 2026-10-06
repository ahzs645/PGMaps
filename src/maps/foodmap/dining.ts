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

// These are spinner eligibility decisions, not corrections to inspection data.
// Keep exact-name exceptions auditable in docs/food-spinner-categories.md.
export const DINING_EXCEPTIONS = [
  { name: 'Costco Food Court', category: 'Restaurant' },
  { name: '7-Eleven Food Store #37259', category: 'Restaurant' },
  { name: '7-Eleven Food Store #37263', category: 'Restaurant' },
  { name: 'Active Body Nutrition', category: 'Coffee Shop' },
  { name: 'Royal Canadian Legion #43', category: 'Bar/Pub' },
  { name: 'Crush Night Club', category: 'Bar/Pub' },
  { name: 'Ignite Night Club', category: 'Bar/Pub' },
  { name: 'The Underground Show Lounge and Bar', category: 'Bar/Pub' },
] as const satisfies readonly { name: string; category: DiningCategory }[]

export type DiningExceptionName = (typeof DINING_EXCEPTIONS)[number]['name']

export function diningCategory(
  restaurant: Pick<Restaurant, 'name' | 'establishment_type' | 'facility_type'>,
  selectedExceptions: readonly DiningExceptionName[] = [],
): DiningCategory | null {
  const exception = DINING_EXCEPTIONS.find((item) => item.name === restaurant.name)
  if (exception) return selectedExceptions.includes(exception.name) ? exception.category : null
  const category = restaurant.establishment_type || restaurant.facility_type
  return DINING_CATEGORIES.find((candidate) => candidate === category) ?? null
}

export function selectDiningRestaurants<T extends Restaurant>(
  restaurants: readonly T[],
  categories: readonly DiningCategory[] = DINING_CATEGORIES,
  selectedExceptions: readonly DiningExceptionName[] = [],
): T[] {
  return restaurants.filter((restaurant) => {
    const category = diningCategory(restaurant, selectedExceptions)
    return category !== null && categories.includes(category)
  })
}
