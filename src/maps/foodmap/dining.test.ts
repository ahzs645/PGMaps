import { describe, expect, it } from 'vitest'
import { DINING_CATEGORIES, diningCategory, selectDiningRestaurants } from './dining'
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

  it('applies dining exceptions without changing the source categories', () => {
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
    expect(selectDiningRestaurants(restaurants, DINING_CATEGORIES, ['Costco Food Court']).map((r) => r.name)).toEqual([
      'Costco Food Court',
      'Crave Cafe',
    ])
    expect(diningCategory(restaurants[7])).toBeNull()
    expect(diningCategory(restaurants[7], ['Costco Food Court'])).toBe('Restaurant')
    expect(restaurants[7].establishment_type).toBe('Concession')
  })

  it('lets individual exceptions in only when their dining category is selected', () => {
    const restaurants = [
      premise('Costco Food Court', 'Concession'),
      premise('Royal Canadian Legion #43', 'Bar/Pub'),
      premise('PG Civic Centre - CG 60667', 'Concession'),
    ]
    const exceptions = ['Costco Food Court', 'Royal Canadian Legion #43'] as const
    expect(selectDiningRestaurants(restaurants, ['Restaurant'], exceptions).map((r) => r.name)).toEqual([
      'Costco Food Court',
    ])
    expect(selectDiningRestaurants(restaurants, ['Bar/Pub'], exceptions).map((r) => r.name)).toEqual([
      'Royal Canadian Legion #43',
    ])
    expect(selectDiningRestaurants(restaurants, [], exceptions)).toEqual([])
  })

  it('supports a single category, an empty selection, and all dining categories', () => {
    const restaurants = DINING_CATEGORIES.map((category) => premise(category, category))
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
