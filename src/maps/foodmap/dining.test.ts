import { describe, expect, it } from 'vitest'
import { OTHER_SPOTS, ROULETTE_CATEGORIES, diningCategory, selectDiningRestaurants } from './dining'
import type { EstablishmentType, Restaurant } from './types'

function premise(
  name: string,
  establishment_type: EstablishmentType,
  facility_type: Restaurant['facility_type'] = 'Restaurant',
): Restaurant {
  return {
    name,
    establishment_type,
    facility_type,
    address: '',
    latitude: null,
    longitude: null,
    hazard_rating: 'Unknown',
    details_url: name,
  }
}

describe('spinner dining eligibility', () => {
  it('excludes non-dining premises even when their source facility type is Restaurant', () => {
    const excluded: EstablishmentType[] = [
      'Community Kitchen',
      'Social Services',
      'Institutional Kitchen',
      'Recreation',
      'Concession',
      'Camp',
      'Catering',
      'Hotel',
      'Farm',
      'Gas Station',
      'Store',
      'Unknown',
      'Other',
    ]
    const restaurants = [
      premise('Pizza place', 'Restaurant'),
      premise('Food truck', 'Food Truck'),
      ...excluded.map((category) => premise(category, category)),
      premise('Evangelical Free Church', 'Community Kitchen'),
      premise('PG Civic Centre - CG 60667', 'Concession'),
    ]
    expect(selectDiningRestaurants(restaurants).map((r) => r.name)).toEqual(['Pizza place', 'Food truck'])
  })

  it('keeps Other spots out by default without changing the source categories', () => {
    const restaurants = [
      premise('7-Eleven Food Store #37259', 'Restaurant'),
      premise('7-Eleven Food Store #37263', 'Restaurant'),
      premise('Active Body Nutrition', 'Coffee Shop'),
      premise('Royal Canadian Legion #43', 'Bar/Pub'),
      premise('Crush Night Club', 'Bar/Pub'),
      premise('Ignite Night Club', 'Bar/Pub'),
      premise('The Underground Show Lounge and Bar', 'Bar/Pub'),
      premise('Costco Food Court', 'Concession'),
      premise('Crave Cafe', 'Restaurant'),
    ]
    expect(selectDiningRestaurants(restaurants).map((r) => r.name)).toEqual(['Crave Cafe'])
    expect(selectDiningRestaurants(restaurants, ROULETTE_CATEGORIES)).toEqual(restaurants)
    expect(diningCategory(restaurants[7])).toBe(OTHER_SPOTS)
    expect(restaurants[7].establishment_type).toBe('Concession')
  })

  it('treats Other spots as its own category, independent of the dining categories', () => {
    const restaurants = [
      premise('Costco Food Court', 'Concession'),
      premise('Royal Canadian Legion #43', 'Bar/Pub'),
      premise('Crave Cafe', 'Restaurant'),
      premise('PG Civic Centre - CG 60667', 'Concession'),
    ]
    expect(selectDiningRestaurants(restaurants, [OTHER_SPOTS]).map((r) => r.name)).toEqual([
      'Costco Food Court',
      'Royal Canadian Legion #43',
    ])
    expect(selectDiningRestaurants(restaurants, ['Bar/Pub']).map((r) => r.name)).toEqual([])
    expect(selectDiningRestaurants(restaurants, [])).toEqual([])
  })

  it('supports a single category, an empty selection, and all dining categories', () => {
    const restaurants = [
      premise('Restaurant', 'Restaurant'),
      premise('Food Truck', 'Food Truck'),
      premise('Coffee Shop', 'Coffee Shop'),
      premise('Bar/Pub', 'Bar/Pub'),
      premise('Brewery/Winery', 'Brewery/Winery'),
      premise('Bakery', 'Bakery'),
      premise('Deli', 'Deli'),
      premise('Stand', 'Stand'),
    ]
    expect(selectDiningRestaurants(restaurants, ['Restaurant']).map((r) => r.name)).toEqual(['Restaurant'])
    expect(selectDiningRestaurants(restaurants, [])).toEqual([])
    expect(selectDiningRestaurants(restaurants)).toEqual(restaurants)
  })

  it('uses the facility fallback only when no establishment category is available', () => {
    expect(
      diningCategory({
        name: 'Unclassified',
        establishment_type: undefined,
        facility_type: undefined,
      } as unknown as Restaurant),
    ).toBeNull()
    expect(
      diningCategory({
        name: 'Facility only',
        establishment_type: undefined,
        facility_type: 'Restaurant',
      } as unknown as Restaurant),
    ).toBe('Restaurant')
    expect(diningCategory(premise('Unclassified', 'Unknown'))).toBeNull()
  })
})
