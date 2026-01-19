import { useState, useCallback } from 'react'
import { RestaurantCard } from './RestaurantCard'
import { cn } from '@/lib/utils'
import type {
  RestaurantWithStats,
  RestaurantStats,
  TimelineStats,
  HazardStatsAtDate,
  HazardRating,
  VisualizationMode
} from '../types'

interface SidebarProps {
  restaurants: RestaurantWithStats[]
  geocodedRestaurants: RestaurantWithStats[]
  loading: boolean
  error: string | null
  stats: RestaurantStats
  timelineStats: TimelineStats
  hazardStatsAtDate: HazardStatsAtDate
  selectedRestaurant: RestaurantWithStats | null
  searchQuery: string
  selectedHazardRatings: HazardRating[]
  selectedFacilityTypes: string[]
  timelineMonths: number
  visualizationMode: VisualizationMode
  onSearchQueryChange: (query: string) => void
  onHazardRatingsChange: (ratings: HazardRating[]) => void
  onFacilityTypesChange: (types: string[]) => void
  onTimelineMonthsChange: (months: number) => void
  onVisualizationModeChange: (mode: VisualizationMode) => void
  onRestaurantClick: (restaurant: RestaurantWithStats) => void
  onClearSelection: () => void
  onOpenInspectionPanel: () => void
  showTimeline: boolean
  onToggleTimeline: () => void
}

const hazardOptions: HazardRating[] = ['Low', 'Moderate', 'Unknown']
const facilityOptions = ['Restaurant', 'Institutional Kitchen', 'Store', 'Unknown', 'Other']
const timelineOptions = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 24, label: '2 years' },
  { value: 0, label: 'All time' }
]

const hazardColors: Record<HazardRating, string> = {
  Low: 'bg-green-500',
  Moderate: 'bg-amber-500',
  Unknown: 'bg-gray-500'
}

export function Sidebar({
  restaurants,
  geocodedRestaurants,
  loading,
  error,
  stats,
  timelineStats,
  hazardStatsAtDate,
  selectedRestaurant,
  searchQuery,
  selectedHazardRatings,
  selectedFacilityTypes,
  timelineMonths,
  visualizationMode,
  onSearchQueryChange,
  onHazardRatingsChange,
  onFacilityTypesChange,
  onTimelineMonthsChange,
  onVisualizationModeChange,
  onRestaurantClick,
  onClearSelection,
  onOpenInspectionPanel,
  showTimeline,
  onToggleTimeline
}: SidebarProps) {
  const [showFilters, setShowFilters] = useState(false)

  const toggleHazard = useCallback((hazard: HazardRating) => {
    const current = [...selectedHazardRatings]
    const index = current.indexOf(hazard)
    if (index > -1) {
      current.splice(index, 1)
    } else {
      current.push(hazard)
    }
    onHazardRatingsChange(current)
  }, [selectedHazardRatings, onHazardRatingsChange])

  const toggleFacility = useCallback((facility: string) => {
    const current = [...selectedFacilityTypes]
    const index = current.indexOf(facility)
    if (index > -1) {
      current.splice(index, 1)
    } else {
      current.push(facility)
    }
    onFacilityTypesChange(current)
  }, [selectedFacilityTypes, onFacilityTypesChange])

  return (
    <div className="w-[350px] h-full bg-white dark:bg-gray-800 shadow-lg flex flex-col border-r border-gray-200 dark:border-gray-700 z-10">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Food Safety</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Restaurant Inspections</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleTimeline}
              className={`p-2 rounded-lg transition-colors ${
                showTimeline
                  ? 'bg-blue-500 hover:bg-blue-600'
                  : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={showTimeline ? 'Hide Timeline' : 'Show Timeline'}
            >
              <svg className={`w-5 h-5 ${showTimeline ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Visualization Mode Toggle */}
      <div className="p-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex rounded-lg bg-gray-200 dark:bg-gray-700 p-1">
          <button
            onClick={() => onVisualizationModeChange('violations')}
            className={cn(
              'flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors',
              visualizationMode === 'violations'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            Violations
          </button>
          <button
            onClick={() => onVisualizationModeChange('hazard')}
            className={cn(
              'flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors',
              visualizationMode === 'hazard'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            Hazard Rating
          </button>
        </div>
      </div>

      {/* Map count + Time selector */}
      <div className="px-4 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {geocodedRestaurants?.length || 0} of {restaurants?.length || 0} on map
        </span>
        {visualizationMode === 'violations' && (
          <select
            value={timelineMonths}
            onChange={(e) => onTimelineMonthsChange(parseInt(e.target.value))}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {timelineOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Timeline Stats (violations mode) */}
      {visualizationMode === 'violations' ? (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-lg font-bold text-red-600">{timelineStats?.totalViolations || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">violations</div>
            </div>
            <div>
              <div className="text-lg font-bold text-orange-600">{timelineStats?.criticalViolations || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">critical</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-600">{timelineStats?.totalInspections || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">inspections</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-700 dark:text-gray-300">{timelineStats?.restaurantsWithViolations || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">with violations</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-lg font-bold text-green-600">{hazardStatsAtDate?.Low || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">low</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600">{hazardStatsAtDate?.Moderate || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">moderate</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-600 dark:text-gray-400">{hazardStatsAtDate?.Unknown || 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">unknown</div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search restaurants..."
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filters toggle */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between border-b border-gray-200 dark:border-gray-700"
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
        <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 space-y-4">
          {/* Hazard Rating Filter */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Hazard Rating</h3>
            <div className="flex flex-wrap gap-2">
              {hazardOptions.map((hazard) => (
                <button
                  key={hazard}
                  onClick={() => toggleHazard(hazard)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selectedHazardRatings.includes(hazard)
                      ? `${hazardColors[hazard]} text-white border-transparent`
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                  )}
                >
                  {hazard}
                  <span className="ml-1 opacity-75">({stats?.byHazard?.[hazard] || 0})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Facility Type Filter */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Facility Type</h3>
            <div className="flex flex-wrap gap-2">
              {facilityOptions.map((facility) => (
                <button
                  key={facility}
                  onClick={() => toggleFacility(facility)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selectedFacilityTypes.includes(facility)
                      ? 'bg-blue-500 text-white border-transparent'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                  )}
                >
                  {facility}
                  <span className="ml-1 opacity-75">({stats?.byFacilityType?.[facility] || 0})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Selected restaurant detail */}
      {selectedRestaurant && (
        <div className="flex flex-col bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 max-h-[40vh] shrink-0">
          <div className="flex items-center justify-between p-3 shrink-0 gap-2">
            <span className="text-sm font-medium text-blue-900 dark:text-blue-200">Selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenInspectionPanel}
                className="py-1 px-3 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                View Inspections
              </button>
              <button onClick={onClearSelection} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="overflow-y-auto px-3 min-h-0 flex-1">
            <RestaurantCard restaurant={selectedRestaurant} expanded visualizationMode={visualizationMode} />
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">Loading restaurants...</div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-red-500 text-center">
            <p className="font-medium">Error loading data</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 text-xs text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span>{restaurants.length} restaurants</span>
            <span className="text-gray-400 dark:text-gray-500">Click for details</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
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
    </div>
  )
}
