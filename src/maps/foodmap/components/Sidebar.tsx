import { useState } from 'react'
import { RestaurantCard } from './RestaurantCard'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import { FilterChipGroup, MapSidebarShell, SearchInput, SelectedItemCard } from '@/components/ui/map-panels'
import { DATASETS } from '@/lib/dataCatalog'
import { useToggleArray } from '@/hooks/useToggleArray'
import type { FoodMapFilters, FoodMapFilterActions } from '../hooks/useFoodMapFilters'
import type {
  RestaurantWithStats,
  RestaurantStats,
  TimelineStats,
  HazardStatsAtDate,
  HazardRating,
} from '../types'

export interface SidebarData {
  restaurants: RestaurantWithStats[]
  geocodedRestaurants: RestaurantWithStats[]
  loading: boolean
  error: string | null
  stats: RestaurantStats
  timelineStats: TimelineStats
  hazardStatsAtDate: HazardStatsAtDate
  violationTimelineLabel: string
}

interface SidebarProps {
  className?: string
  data: SidebarData
  filters: FoodMapFilters
  filterActions: FoodMapFilterActions
  selectedRestaurant: RestaurantWithStats | null
  showTimeline: boolean
  onRestaurantClick: (restaurant: RestaurantWithStats) => void
  onClearSelection: () => void
  onOpenInspectionPanel: () => void
  onToggleTimeline: () => void
  onOpenRoulette: () => void
}

const hazardOptions: HazardRating[] = ['Low', 'Moderate', 'Unknown']
const facilityOptions = ['Restaurant', 'Institutional Kitchen', 'Store', 'Unknown', 'Other']
const timelineOptions = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 24, label: '2 years' },
  { value: 0, label: 'All time' },
]

const hazardChipColors: Record<HazardRating, string> = {
  Low: '#22c55e',
  Moderate: '#f59e0b',
  Unknown: '#6b7280',
}

export function Sidebar({
  className,
  data,
  filters,
  filterActions,
  selectedRestaurant,
  showTimeline,
  onRestaurantClick,
  onClearSelection,
  onOpenInspectionPanel,
  onToggleTimeline,
  onOpenRoulette,
}: SidebarProps) {
  const {
    restaurants,
    geocodedRestaurants,
    loading,
    error,
    stats,
    timelineStats,
    hazardStatsAtDate,
    violationTimelineLabel,
  } = data
  const {
    hazardRatings: selectedHazardRatings,
    facilityTypes: selectedFacilityTypes,
    searchQuery,
    visualizationMode,
    timelineMonths,
    violationTimelineMode,
  } = filters

  const [showFilters, setShowFilters] = useState(false)

  const toggleHazard = useToggleArray(selectedHazardRatings, filterActions.setHazardRatings)
  const toggleFacility = useToggleArray(selectedFacilityTypes, filterActions.setFacilityTypes)

  return (
    <MapSidebarShell
      className={className}
      title="Food Safety"
      subtitle="Restaurant Inspections"
      dataset={DATASETS.foodSafety}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenRoulette}
            className="p-2 rounded-lg bg-purple-500 hover:bg-purple-600 transition-colors"
            title="Restaurant Roulette"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <path strokeWidth="2" d="M12 2v10l7 7" />
            </svg>
          </button>
          <button
            onClick={onToggleTimeline}
            className={`p-2 rounded-lg transition-colors ${
              showTimeline ? 'bg-sky-500 hover:bg-sky-600' : 'bg-secondary hover:bg-accent'
            }`}
            title={showTimeline ? 'Hide Timeline' : 'Show Timeline'}
          >
            <svg
              className={`w-5 h-5 ${showTimeline ? 'text-white' : 'text-muted-foreground'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
      }
    >
      {/* Visualization Mode Toggle */}
      <div className="border-b border-border bg-background/95 p-3">
        <div className="flex rounded-lg bg-secondary p-1">
          <button
            onClick={() => filterActions.setVisualizationMode('violations')}
            className={cn(
              'flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors',
              visualizationMode === 'violations'
                ? 'bg-background text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Violations
          </button>
          <button
            onClick={() => filterActions.setVisualizationMode('hazard')}
            className={cn(
              'flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors',
              visualizationMode === 'hazard'
                ? 'bg-background text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Hazard Rating
          </button>
        </div>
      </div>

      {/* Map count + Time selector */}
      <div className="flex items-center justify-between border-b border-border bg-background/95 px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {geocodedRestaurants?.length || 0} of {restaurants?.length || 0} on map
        </span>
        {visualizationMode === 'violations' && (
          <AppSelect
            value={String(timelineMonths)}
            onValueChange={(value) => filterActions.setTimelineMonths(parseInt(value))}
            options={timelineOptions.map((opt) => ({ value: String(opt.value), label: opt.label }))}
            className="w-32"
            triggerClassName="h-8 rounded text-xs focus:ring-2 focus:ring-sky-500"
          />
        )}
      </div>

      {visualizationMode === 'violations' && (
        <div className="border-b border-border bg-background/95 px-4 py-2">
          <div className="mb-2 flex rounded-md bg-secondary p-0.5">
            <button
              onClick={() => filterActions.setViolationTimelineMode('period')}
              className={cn(
                'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                violationTimelineMode === 'period'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Period
            </button>
            <button
              onClick={() => filterActions.setViolationTimelineMode('cumulative')}
              className={cn(
                'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                violationTimelineMode === 'cumulative'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Cumulative
            </button>
          </div>
          <div className="truncate text-xs text-muted-foreground">{violationTimelineLabel}</div>
        </div>
      )}

      {/* Timeline Stats (violations mode) */}
      {visualizationMode === 'violations' ? (
        <div className="border-b border-border bg-background/95 px-4 py-2">
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-lg font-bold text-red-600">{timelineStats?.totalViolations || 0}</div>
              <div className="text-xs text-muted-foreground">violations</div>
            </div>
            <div>
              <div className="text-lg font-bold text-orange-600">{timelineStats?.criticalViolations || 0}</div>
              <div className="text-xs text-muted-foreground">critical</div>
            </div>
            <div>
              <div className="text-lg font-bold text-sky-600 dark:text-sky-400">
                {timelineStats?.totalInspections || 0}
              </div>
              <div className="text-xs text-muted-foreground">inspections</div>
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">{timelineStats?.restaurantsWithViolations || 0}</div>
              <div className="text-xs text-muted-foreground">with violations</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-b border-border bg-background/95 px-4 py-2">
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-lg font-bold text-green-600">{hazardStatsAtDate?.Low || 0}</div>
              <div className="text-xs text-muted-foreground">low</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600">{hazardStatsAtDate?.Moderate || 0}</div>
              <div className="text-xs text-muted-foreground">moderate</div>
            </div>
            <div>
              <div className="text-lg font-bold text-muted-foreground">{hazardStatsAtDate?.Unknown || 0}</div>
              <div className="text-xs text-muted-foreground">unknown</div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="border-b border-border p-4">
        <SearchInput
          value={searchQuery}
          onChange={(e) => filterActions.setSearchQuery(e.target.value)}
          placeholder="Search restaurants..."
          className="focus:ring-sky-500"
        />
      </div>

      {/* Filters toggle */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center justify-between border-b border-border px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-accent"
      >
        <span>Filters</span>
        <svg
          className={cn('w-4 h-4 transform transition-transform', showFilters && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Filters panel */}
      {showFilters && (
        <div className="space-y-4 border-b border-border bg-background/95 p-4">
          {/* Hazard Rating Filter */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">Hazard Rating</h3>
            <FilterChipGroup
              items={hazardOptions.map((hazard) => ({
                value: hazard,
                label: hazard,
                count: stats?.byHazard?.[hazard] || 0,
                color: hazardChipColors[hazard],
              }))}
              selectedValues={selectedHazardRatings}
              onToggle={toggleHazard}
              chipClassName="px-3 py-1"
            />
          </div>

          {/* Facility Type Filter */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">Facility Type</h3>
            <FilterChipGroup
              items={facilityOptions.map((facility) => ({
                value: facility,
                label: facility,
                count: stats?.byFacilityType?.[facility] || 0,
                color: '#0ea5e9',
              }))}
              selectedValues={selectedFacilityTypes}
              onToggle={toggleFacility}
              chipClassName="px-3 py-1"
              showDot={false}
            />
          </div>
        </div>
      )}

      {/* Selected restaurant detail */}
      {selectedRestaurant && (
        <div className="hidden max-h-[40vh] shrink-0 flex-col border-b border-sky-300/60 bg-sky-50 dark:border-sky-800/60 dark:bg-sky-950/30 md:flex">
          <SelectedItemCard
            tone="sky"
            title="Selected"
            onClear={onClearSelection}
            actions={
              <button
                onClick={onOpenInspectionPanel}
                className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700"
              >
                View Inspections
              </button>
            }
            className="m-3 shrink-0"
          />
          <div className="overflow-y-auto px-3 min-h-0 flex-1">
            <RestaurantCard restaurant={selectedRestaurant} expanded visualizationMode={visualizationMode} />
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">Loading restaurants...</div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-red-500 text-center">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>{restaurants.length} restaurants</span>
            <span className="text-muted-foreground">Click for details</span>
          </div>
          <div className="divide-y divide-border">
            {restaurants.map((restaurant) => (
              <RestaurantCard
                key={restaurant.details_url}
                restaurant={restaurant}
                isSelected={selectedRestaurant?.details_url === restaurant.details_url}
                visualizationMode={visualizationMode}
                onClick={() => onRestaurantClick(restaurant)}
              />
            ))}
          </div>
        </div>
      )}
    </MapSidebarShell>
  )
}
