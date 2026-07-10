import { useMemo, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  useMap
} from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { SharedMap } from '@/components/ui/persistent-map'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { getHazardRating, HAZARD_HEX_COLORS, HAZARD_TAILWIND } from '../hazard'
import type { HazardRating, MarkerStyle, RestaurantWithStats, VisualizationMode } from '../types'

interface RestaurantMapProps {
  restaurants: RestaurantWithStats[]
  selectedRestaurant: RestaurantWithStats | null
  visualizationMode: VisualizationMode
  markerStyle?: MarkerStyle
  loading?: boolean
  onRestaurantClick: (restaurant: RestaurantWithStats) => void
  onViewInspections: (restaurant: RestaurantWithStats) => void
  onClearSelection: () => void
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
    const rating = getHazardRating(restaurant, { atDate: true })
    return HAZARD_HEX_COLORS[colorMode][rating] || HAZARD_HEX_COLORS[colorMode].Unknown
  }
}

function getMarkerSize(violationCount: number, mode: VisualizationMode): number {
  if (mode === 'hazard') return 12
  const baseRadius = 10
  const maxRadius = 24
  const scale = Math.min(violationCount / 10, 1)
  return baseRadius + (maxRadius - baseRadius) * scale
}

/** Dark text on light marker fills (yellows), white text otherwise. */
function getContrastTextColor(hex: string): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 160 ? '#3b2f00' : '#ffffff'
}

interface MarkerDotProps {
  markerStyle: MarkerStyle
  color: string
  size: number
  violationCount: number
  criticalCount: number
  rating: HazardRating
  visualizationMode: VisualizationMode
  isSelected: boolean
}

const SELECTED_RING_CLASS =
  'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-sky-300 dark:ring-offset-slate-950'

/** Zoom level at which the 'heat' style trades the heatmap for individual dots. */
const HEAT_REVEAL_ZOOM = 13

/** Experimental marker dot renderers, switched by the `dots` URL param / sidebar select. */
function MarkerDot({
  markerStyle,
  color,
  size,
  violationCount,
  criticalCount,
  rating,
  visualizationMode,
  isSelected,
}: MarkerDotProps) {
  // "Quiet" markers: nothing to flag, so they recede and let problem spots pop.
  const isQuiet = visualizationMode === 'violations' ? violationCount === 0 : rating === 'Low'

  if (markerStyle === 'rings') {
    return (
      <div
        className={cn(
          'cursor-pointer rounded-full transition-transform hover:scale-110',
          'shadow-[0_1px_4px_rgba(0,0,0,0.35)] dark:shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_1px_5px_rgba(0,0,0,0.6)]',
          isSelected && SELECTED_RING_CLASS
        )}
        style={{
          width: Math.max(size, 12),
          height: Math.max(size, 12),
          border: `2.5px solid ${color}`,
          backgroundColor: `${color}2e`,
        }}
      />
    )
  }

  if (markerStyle === 'glow') {
    if (isQuiet) {
      return (
        <div
          className={cn(
            'cursor-pointer rounded-full transition-transform hover:scale-125',
            isSelected && SELECTED_RING_CLASS
          )}
          style={{ width: 7, height: 7, backgroundColor: color, opacity: 0.55 }}
        />
      )
    }
    const glowSize = Math.max(size, 13)
    const pulse = visualizationMode === 'violations' ? violationCount >= 6 : false
    return (
      <div className="relative" style={{ width: glowSize, height: glowSize }}>
        {pulse && (
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{ backgroundColor: color, opacity: 0.4 }}
          />
        )}
        <div
          className={cn(
            'absolute inset-0 cursor-pointer rounded-full border border-white/90 transition-transform hover:scale-110 dark:border-black/60',
            isSelected && SELECTED_RING_CLASS
          )}
          style={{
            backgroundColor: color,
            boxShadow: `0 0 10px 2px ${color}80, 0 1px 3px rgba(0,0,0,0.4)`,
          }}
        />
      </div>
    )
  }

  if (markerStyle === 'badges') {
    if (isQuiet) {
      return (
        <div
          className={cn(
            'cursor-pointer rounded-full border border-white/80 shadow-sm transition-transform hover:scale-125 dark:border-black/50',
            isSelected && SELECTED_RING_CLASS
          )}
          style={{ width: 8, height: 8, backgroundColor: color, opacity: 0.8 }}
        />
      )
    }
    const label = visualizationMode === 'violations'
      ? String(violationCount)
      : rating === 'Unknown' ? '?' : rating.charAt(0)
    const badgeSize = visualizationMode === 'violations'
      ? 17 + Math.min(violationCount, 10)
      : 18
    return (
      <div
        className={cn(
          'relative flex cursor-pointer items-center justify-center rounded-full border-2 border-white font-bold leading-none shadow-md transition-transform hover:scale-110 dark:border-slate-950 dark:shadow-[0_0_6px_rgba(0,0,0,0.8)]',
          isSelected && SELECTED_RING_CLASS
        )}
        style={{
          width: badgeSize,
          height: badgeSize,
          backgroundColor: color,
          color: getContrastTextColor(color),
          fontSize: 10,
        }}
      >
        {label}
        {criticalCount > 0 && visualizationMode === 'violations' && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-red-600 dark:border-slate-950"
          />
        )}
      </div>
    )
  }

  // classic (current production style)
  return (
    <div
      className={cn(
        'cursor-pointer rounded-full border-2 border-white shadow-lg transition-transform hover:scale-110 dark:border-slate-950 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.95),0_8px_18px_rgba(0,0,0,0.6),0_0_12px_rgba(255,255,255,0.35)]',
        isSelected && SELECTED_RING_CLASS
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color
      }}
    />
  )
}

export function RestaurantMap({
  restaurants,
  selectedRestaurant,
  visualizationMode,
  markerStyle = 'classic',
  loading = false,
  onRestaurantClick,
  onViewInspections,
  onClearSelection
}: RestaurantMapProps) {
  const { map } = useMap()
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)

  // Filter to only restaurants with valid coordinates
  const geocodedRestaurants = useMemo(() => {
    return restaurants.filter(r => r.latitude != null && r.longitude != null)
  }, [restaurants])

  // 'heat' style: aggregate heatmap at city zoom, individual dots revealed on zoom-in.
  const [dotsRevealed, setDotsRevealed] = useState(true)
  useEffect(() => {
    if (!map || markerStyle !== 'heat') {
      setDotsRevealed(true)
      return
    }
    const update = () => setDotsRevealed(map.getZoom() >= HEAT_REVEAL_ZOOM)
    update()
    map.on('zoom', update)
    return () => { map.off('zoom', update) }
  }, [map, markerStyle])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: markerStyle !== 'heat' ? [] : geocodedRestaurants.map(r => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [r.longitude!, r.latitude!] },
      properties: {
        weight: visualizationMode === 'violations'
          ? 0.3 + (r.violationStats?.total || 0)
          : getHazardRating(r, { atDate: true }) === 'Moderate' ? 1.5 : 0.3,
      },
    })),
  }), [geocodedRestaurants, markerStyle, visualizationMode])

  const showMarkers = markerStyle !== 'heat' || dotsRevealed

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
    <SharedMap loading={loading} loadingLabel="Loading food safety data">
      {markerStyle === 'heat' && (
        <MapHeatmapLayer
          data={heatmapData}
          colorRamp="air"
          intensityStops={[[10, 0.32], [13, 0.85]]}
          radiusStops={[[10, 15], [13, 34]]}
          opacity={[[0, 0.85], [HEAT_REVEAL_ZOOM - 1, 0.7], [HEAT_REVEAL_ZOOM + 0.8, 0]]}
        />
      )}
      {showMarkers && geocodedRestaurants.map(restaurant => (
        <RestaurantMarker
          key={restaurant.details_url}
          restaurant={restaurant}
          visualizationMode={visualizationMode}
          markerStyle={markerStyle}
          isSelected={selectedRestaurant?.details_url === restaurant.details_url}
          isMobileViewport={isMobileViewport}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRestaurantClick(restaurant)
          }}
          onViewInspections={() => onViewInspections(restaurant)}
        />
      ))}
      {isMobileViewport && selectedRestaurant && (
        <MobileRestaurantFeatureCard
          restaurant={selectedRestaurant}
          visualizationMode={visualizationMode}
          onClose={onClearSelection}
          onViewInspections={() => onViewInspections(selectedRestaurant)}
        />
      )}
    </SharedMap>
  )
}

interface RestaurantMarkerProps {
  restaurant: RestaurantWithStats
  visualizationMode: VisualizationMode
  markerStyle: MarkerStyle
  isSelected: boolean
  isMobileViewport: boolean
  onClick: (event: MouseEvent) => void
  onViewInspections: () => void
}

function RestaurantMarker({ restaurant, visualizationMode, markerStyle, isSelected, isMobileViewport, onClick, onViewInspections }: RestaurantMarkerProps) {
  const { resolvedTheme } = useTheme()
  const isDarkMode = resolvedTheme === 'dark'
  const stats = restaurant.violationStats || {
    total: 0,
    critical: 0,
    inspectionCount: 0
  }
  const color = getMarkerColor(restaurant, visualizationMode, isDarkMode)
  const size = getMarkerSize(stats.total, visualizationMode)
  const rating = getHazardRating(restaurant)

  const hazardColorClass = HAZARD_TAILWIND[rating].bg
  const ratingBadgeClass = rating === 'Low'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    : rating === 'Moderate'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'

  const violationColorClass = getViolationCountClass(stats.total)

  return (
    <MapMarker
      longitude={restaurant.longitude!}
      latitude={restaurant.latitude!}
      onClick={onClick}
    >
      <MarkerContent>
        <MarkerDot
          markerStyle={markerStyle}
          color={color}
          size={size}
          violationCount={stats.total}
          criticalCount={stats.critical}
          rating={getHazardRating(restaurant, { atDate: visualizationMode === 'hazard' })}
          visualizationMode={visualizationMode}
          isSelected={isSelected}
        />
      </MarkerContent>

      {!isMobileViewport && (
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
      )}

      {!isMobileViewport && (
        <MarkerPopup closeButton className="p-0">
          <RestaurantPopupContent
            restaurant={restaurant}
            rating={rating}
            ratingBadgeClass={ratingBadgeClass}
            violationColorClass={violationColorClass}
            onViewInspections={onViewInspections}
          />
        </MarkerPopup>
      )}
    </MapMarker>
  )
}

function RestaurantPopupContent({
  restaurant,
  rating,
  ratingBadgeClass,
  violationColorClass,
  onViewInspections,
}: {
  restaurant: RestaurantWithStats
  rating: string
  ratingBadgeClass: string
  violationColorClass: string
  onViewInspections: () => void
}) {
  const stats = restaurant.violationStats || {
    total: 0,
    critical: 0,
    inspectionCount: 0
  }
  const latestInspection = restaurant.filteredInspections?.[0] || restaurant.inspections?.[0]

  return (
    <div className="w-[260px] p-3 pr-7">
      <h3 className="text-sm font-semibold leading-snug text-foreground">{restaurant.name}</h3>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        {restaurant.full_address || restaurant.address}
      </p>

      <RestaurantSummaryBadges
        rating={rating}
        ratingBadgeClass={ratingBadgeClass}
        violationColorClass={violationColorClass}
        totalViolations={stats.total}
        criticalViolations={stats.critical}
      />

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
  )
}

function MobileRestaurantFeatureCard({
  restaurant,
  visualizationMode,
  onClose,
  onViewInspections,
}: {
  restaurant: RestaurantWithStats
  visualizationMode: VisualizationMode
  onClose: () => void
  onViewInspections: () => void
}) {
  const stats = restaurant.violationStats || {
    total: 0,
    critical: 0,
    inspectionCount: 0
  }
  const rating = getHazardRating(restaurant, { atDate: visualizationMode === 'hazard' })
  const ratingBadgeClass = rating === 'Low'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    : rating === 'Moderate'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
  const violationColorClass = getViolationCountClass(stats.total)
  const latestInspection = restaurant.filteredInspections?.[0] || restaurant.inspections?.[0]

  return (
    <MobileFeatureCard
      cardKey={restaurant.details_url}
      title={restaurant.name}
      subtitle={restaurant.full_address || restaurant.address}
      onClose={onClose}
    >
      <RestaurantSummaryBadges
        rating={rating}
        ratingBadgeClass={ratingBadgeClass}
        violationColorClass={violationColorClass}
        totalViolations={stats.total}
        criticalViolations={stats.critical}
      />
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2 first:pt-0">
          <span className="text-muted-foreground">Inspections</span>
          <span className="font-medium">{stats.inspectionCount}</span>
        </div>
        <div className="flex items-center justify-between gap-3 py-2 last:pb-0">
          <span className="text-muted-foreground">Latest</span>
          <span className="min-w-0 truncate font-medium">{latestInspection?.inspection_date || latestInspection?.date || '-'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onViewInspections}
        className="mt-3 w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
      >
        View Inspections
      </button>
    </MobileFeatureCard>
  )
}

function RestaurantSummaryBadges({
  rating,
  ratingBadgeClass,
  violationColorClass,
  totalViolations,
  criticalViolations,
}: {
  rating: string
  ratingBadgeClass: string
  violationColorClass: string
  totalViolations: number
  criticalViolations: number
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className={cn('rounded px-2 py-0.5 text-xs', ratingBadgeClass)}>
        {rating}
      </span>
      <span className={cn('rounded px-2 py-0.5 text-xs text-white', violationColorClass)}>
        {totalViolations} violation{totalViolations !== 1 ? 's' : ''}
      </span>
      {criticalViolations > 0 && (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          {criticalViolations} critical
        </span>
      )}
    </div>
  )
}
