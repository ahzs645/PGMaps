import { useMemo, useEffect } from 'react'
import { useTheme } from 'next-themes'
import {
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  useMap
} from '@/components/ui/map'
import { SharedMap } from '@/components/ui/persistent-map'
import { cn } from '@/lib/utils'
import type { RestaurantWithStats, HazardRating, VisualizationMode } from '../types'

interface RestaurantMapProps {
  restaurants: RestaurantWithStats[]
  selectedRestaurant: RestaurantWithStats | null
  visualizationMode: VisualizationMode
  onRestaurantClick: (restaurant: RestaurantWithStats) => void
  onViewInspections: (restaurant: RestaurantWithStats) => void
}

const HAZARD_COLORS: Record<'light' | 'dark', Record<HazardRating, string>> = {
  light: {
    Low: '#30a46c',
    Moderate: '#ffc53d',
    Unknown: '#8b8d98'
  },
  dark: {
    Low: '#33b074',
    Moderate: '#ffd60a',
    Unknown: '#777b84'
  }
}

function getViolationCountColor(count: number, isDarkMode: boolean): string {
  if (count === 0) return isDarkMode ? '#33b074' : '#30a46c'
  if (count <= 2) return isDarkMode ? '#ffff57' : '#ffe629'
  if (count <= 5) return isDarkMode ? '#ff801f' : '#f76b15'
  return isDarkMode ? '#ec5d5e' : '#e5484d'
}

function getViolationCountClass(count: number): string {
  if (count === 0) return 'bg-green-500'
  if (count <= 2) return 'bg-yellow-500'
  if (count <= 5) return 'bg-orange-500'
  return 'bg-red-500'
}

function getMarkerColor(restaurant: RestaurantWithStats, visualizationMode: VisualizationMode, isDarkMode: boolean): string {
  const colorMode = isDarkMode ? 'dark' : 'light'

  if (visualizationMode === 'violations') {
    return getViolationCountColor(restaurant.violationStats?.total || 0, isDarkMode)
  } else {
    const rating = restaurant.hazardRatingAtDate || restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown'
    return HAZARD_COLORS[colorMode][rating as HazardRating] || HAZARD_COLORS[colorMode].Unknown
  }
}

function getMarkerSize(violationCount: number, mode: VisualizationMode): number {
  if (mode === 'hazard') return 12
  const baseRadius = 10
  const maxRadius = 24
  const scale = Math.min(violationCount / 10, 1)
  return baseRadius + (maxRadius - baseRadius) * scale
}

export function RestaurantMap({
  restaurants,
  selectedRestaurant,
  visualizationMode,
  onRestaurantClick,
  onViewInspections
}: RestaurantMapProps) {
  const { map } = useMap()

  // Filter to only restaurants with valid coordinates
  const geocodedRestaurants = useMemo(() => {
    return restaurants.filter(r => r.latitude != null && r.longitude != null)
  }, [restaurants])

  // Fly to selected restaurant
  useEffect(() => {
    if (selectedRestaurant?.latitude && selectedRestaurant?.longitude && map) {
      map.flyTo({
        center: [selectedRestaurant.longitude, selectedRestaurant.latitude],
        zoom: 16,
        duration: 1000
      })
    }
  }, [selectedRestaurant, map])

  return (
    <SharedMap>
      {geocodedRestaurants.map(restaurant => (
        <RestaurantMarker
          key={restaurant.details_url}
          restaurant={restaurant}
          visualizationMode={visualizationMode}
          isSelected={selectedRestaurant?.details_url === restaurant.details_url}
          onClick={() => onRestaurantClick(restaurant)}
          onViewInspections={() => onViewInspections(restaurant)}
        />
      ))}
    </SharedMap>
  )
}

interface RestaurantMarkerProps {
  restaurant: RestaurantWithStats
  visualizationMode: VisualizationMode
  isSelected: boolean
  onClick: () => void
  onViewInspections: () => void
}

function RestaurantMarker({ restaurant, visualizationMode, isSelected, onClick, onViewInspections }: RestaurantMarkerProps) {
  const { resolvedTheme } = useTheme()
  const isDarkMode = resolvedTheme === 'dark'
  const stats = restaurant.violationStats || {
    total: 0,
    critical: 0,
    inspectionCount: 0
  }
  const color = getMarkerColor(restaurant, visualizationMode, isDarkMode)
  const size = getMarkerSize(stats.total, visualizationMode)
  const rating = restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown'

  const hazardColorClass = rating === 'Low' ? 'bg-green-500'
    : rating === 'Moderate' ? 'bg-amber-500'
    : 'bg-gray-500'
  const ratingBadgeClass = rating === 'Low'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    : rating === 'Moderate'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'

  const violationColorClass = getViolationCountClass(stats.total)
  const latestInspection = restaurant.filteredInspections?.[0] || restaurant.inspections?.[0]

  return (
    <MapMarker
      longitude={restaurant.longitude!}
      latitude={restaurant.latitude!}
      onClick={onClick}
    >
      <MarkerContent>
        <div
          className={cn(
            'rounded-full border-2 border-white shadow-lg cursor-pointer transition-transform hover:scale-110 dark:border-slate-950 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.95),0_8px_18px_rgba(0,0,0,0.6),0_0_12px_rgba(255,255,255,0.35)]',
            isSelected && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-sky-300 dark:ring-offset-slate-950'
          )}
          style={{
            width: size,
            height: size,
            backgroundColor: color
          }}
        />
      </MarkerContent>

      <MarkerTooltip>
        <div className="p-2 max-w-xs">
          <div className="font-semibold text-sm mb-1">{restaurant.name}</div>
          <div className="text-xs text-muted-foreground mb-2">{restaurant.address}</div>
          {visualizationMode === 'hazard' ? (
            <span className={cn('text-xs px-1.5 py-0.5 rounded text-white', hazardColorClass)}>
              {rating}
            </span>
          ) : (
            <span className={cn('text-xs px-1.5 py-0.5 rounded text-white', violationColorClass)}>
              {stats.total} violation{stats.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </MarkerTooltip>

      <MarkerPopup closeButton className="p-0">
        <div className="w-[260px] p-3 pr-7">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{restaurant.name}</h3>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {restaurant.full_address || restaurant.address}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded px-2 py-0.5 text-xs', ratingBadgeClass)}>
              {rating}
            </span>
            <span className={cn('rounded px-2 py-0.5 text-xs text-white', violationColorClass)}>
              {stats.total} violation{stats.total !== 1 ? 's' : ''}
            </span>
            {stats.critical > 0 && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {stats.critical} critical
              </span>
            )}
          </div>

          <div className="mt-2 text-xs text-muted-foreground">
            {stats.inspectionCount} inspection{stats.inspectionCount !== 1 ? 's' : ''}
            {latestInspection ? (
              <span>
                {' '}| Latest {latestInspection.inspection_date || latestInspection.date}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onViewInspections()
            }}
            className="mt-3 w-full rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
          >
            View Inspections
          </button>
        </div>
      </MarkerPopup>
    </MapMarker>
  )
}
