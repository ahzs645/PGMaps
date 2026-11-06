import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { formatFullAddress } from './address'
import { getHazardRating } from './hazard'
import type { RestaurantWithStats, VisualizationMode } from './types'

const inspectionDate = (restaurant: RestaurantWithStats) => {
  const latest = restaurant.filteredInspections[0]
  return latest?.date || latest?.inspection_date
}

/** The rating and inspection columns read the same timeline-scoped values as the map. */
export function foodTableColumns(mode: VisualizationMode, parseDate: (value: string | undefined) => Date | null) {
  return [
    textColumn<RestaurantWithStats>('name', 'Name', (restaurant) => restaurant.name, { width: 240 }),
    textColumn<RestaurantWithStats>('address', 'Address', formatFullAddress, { width: 260 }),
    textColumn<RestaurantWithStats>(
      'type',
      'Type',
      (restaurant) => restaurant.establishment_type || restaurant.facility_type,
    ),
    textColumn<RestaurantWithStats>(
      'hazard',
      'Hazard rating',
      (restaurant) => getHazardRating(restaurant, { atDate: mode === 'hazard' }),
      { width: 120 },
    ),
    numberColumn<RestaurantWithStats>('violations', 'Violations', (restaurant) => restaurant.violationStats.total),
    numberColumn<RestaurantWithStats>('critical', 'Critical', (restaurant) => restaurant.violationStats.critical),
    numberColumn<RestaurantWithStats>(
      'inspections',
      'Inspections',
      (restaurant) => restaurant.violationStats.inspectionCount,
    ),
    dateColumn<RestaurantWithStats>('lastInspection', 'Last inspection', (restaurant) =>
      parseDate(inspectionDate(restaurant)),
    ),
  ]
}
