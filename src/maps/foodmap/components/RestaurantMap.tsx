import { useMemo, useRef, useEffect } from 'react'
import { useTheme } from 'next-themes'
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  MapControls,
  type MapRef
} from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { createEmptyViolationRiskSummary, getRiskBandColor, getRiskBandLabel } from '../risk'
import type { RestaurantWithStats, HazardRating, VisualizationMode } from '../types'

interface RestaurantMapProps {
  restaurants: RestaurantWithStats[]
  selectedRestaurant: RestaurantWithStats | null
  visualizationMode: VisualizationMode
  onRestaurantClick: (restaurant: RestaurantWithStats) => void
}

const ZOOM = 12

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

function getMarkerColor(restaurant: RestaurantWithStats, visualizationMode: VisualizationMode, isDarkMode: boolean): string {
  const colorMode = isDarkMode ? 'dark' : 'light'

  if (visualizationMode === 'violations') {
    const stats = restaurant.violationStats || {
      total: 0,
      risk: createEmptyViolationRiskSummary()
    }
    const hasViolations = stats.total > 0
    return getRiskBandColor(stats.risk.worstBand, hasViolations, colorMode)
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
  onRestaurantClick
}: RestaurantMapProps) {
  const mapRef = useRef<MapRef>(null)

  // Filter to only restaurants with valid coordinates
  const geocodedRestaurants = useMemo(() => {
    return restaurants.filter(r => r.latitude != null && r.longitude != null)
  }, [restaurants])

  // Fly to selected restaurant
  useEffect(() => {
    if (selectedRestaurant?.latitude && selectedRestaurant?.longitude && mapRef.current) {
      mapRef.current.flyTo({
        center: [selectedRestaurant.longitude, selectedRestaurant.latitude],
        zoom: 16,
        duration: 1000
      })
    }
  }, [selectedRestaurant])

  return (
    <div className="w-full h-full">
      <Map
        ref={mapRef}
        center={PG_CENTER}
        zoom={ZOOM}
        styles={MAP_STYLES}
      >
        <MapControls position="top-right" showZoom showCompass />

        {geocodedRestaurants.map(restaurant => (
          <RestaurantMarker
            key={restaurant.details_url}
            restaurant={restaurant}
            visualizationMode={visualizationMode}
            isSelected={selectedRestaurant?.details_url === restaurant.details_url}
            onClick={() => onRestaurantClick(restaurant)}
          />
        ))}
      </Map>
    </div>
  )
}

interface RestaurantMarkerProps {
  restaurant: RestaurantWithStats
  visualizationMode: VisualizationMode
  isSelected: boolean
  onClick: () => void
}

function RestaurantMarker({ restaurant, visualizationMode, isSelected, onClick }: RestaurantMarkerProps) {
  const { resolvedTheme } = useTheme()
  const isDarkMode = resolvedTheme === 'dark'
  const stats = restaurant.violationStats || {
    total: 0,
    critical: 0,
    inspectionCount: 0,
    risk: createEmptyViolationRiskSummary()
  }
  const hasViolations = stats.total > 0
  const color = getMarkerColor(restaurant, visualizationMode, isDarkMode)
  const size = getMarkerSize(stats.total, visualizationMode)
  const rating = restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown'
  const riskLabel = getRiskBandLabel(stats.risk.worstBand, hasViolations)

  const hazardColorClass = rating === 'Low' ? 'bg-green-500'
    : rating === 'Moderate' ? 'bg-amber-500'
    : 'bg-gray-500'

  const violationColorClass = !hasViolations ? 'bg-green-500'
    : stats.risk.worstBand === 'Severe' ? 'bg-red-500'
    : stats.risk.worstBand === 'Elevated' ? 'bg-orange-500'
    : stats.risk.worstBand === 'Moderate' ? 'bg-yellow-500'
    : stats.risk.worstBand === 'Administrative' ? 'bg-blue-500'
    : 'bg-gray-500'

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
          <div className="flex items-center gap-1">
            <span className={cn('text-xs px-1.5 py-0.5 rounded text-white', hazardColorClass)}>
              {rating}
            </span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded text-white', violationColorClass)}>
              {riskLabel}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {stats.total} violation{stats.total !== 1 ? 's' : ''}
          </div>
        </div>
      </MarkerTooltip>

      <MarkerPopup closeButton>
        <div className="p-4 max-w-xs">
          <div className="font-semibold text-foreground mb-1">{restaurant.name}</div>
          <div className="text-sm text-muted-foreground mb-2">{restaurant.full_address || restaurant.address}</div>

          <div className="flex items-center gap-2 mb-2">
            <span className={cn('text-xs px-2 py-1 rounded text-white', hazardColorClass)}>
              {rating}
            </span>
            <span className={cn('text-xs px-2 py-1 rounded text-white', violationColorClass)}>
              {riskLabel}
            </span>
          </div>

          <div className="text-xs text-muted-foreground mb-2">
            {stats.total} violation{stats.total !== 1 ? 's' : ''} |{' '}
            {stats.inspectionCount} inspection{stats.inspectionCount !== 1 ? 's' : ''} |{' '}
            {stats.critical} critical
          </div>

          {restaurant.filteredInspections?.[0] && (
            <div className="mt-2 text-sm text-muted-foreground">
              <div className="font-medium">
                Latest: {restaurant.filteredInspections[0].inspection_date || restaurant.filteredInspections[0].date}
              </div>
              <div>{restaurant.filteredInspections[0].inspection_type || restaurant.filteredInspections[0].type}</div>
            </div>
          )}
        </div>
      </MarkerPopup>
    </MapMarker>
  )
}
