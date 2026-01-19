import { useState, useMemo, useCallback } from 'react'
import { RestaurantMap } from './components/RestaurantMap'
import { Sidebar } from './components/Sidebar'
import { InspectionPanel } from './components/InspectionPanel'
import { Timeline } from './components/Timeline'
import { useRestaurantData } from './hooks/useRestaurantData'
import type { RestaurantWithStats, HazardRating, VisualizationMode } from './types'

// Parse date string like "18-Mar-2024" or "March 18, 2024"
function parseInspectionDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null

  // Try "DD-MMM-YYYY" format
  const shortMatch = dateStr.match(/(\d{1,2})-(\w{3})-(\d{4})/)
  if (shortMatch) {
    const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    return new Date(parseInt(shortMatch[3]), months[shortMatch[2]], parseInt(shortMatch[1]))
  }

  // Try "Month DD, YYYY" format
  const longMatch = dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/)
  if (longMatch) {
    return new Date(dateStr)
  }

  return null
}

export default function FoodMap() {
  const { restaurants, loading, error, stats } = useRestaurantData()

  // Filter state
  const [selectedHazardRatings, setSelectedHazardRatings] = useState<HazardRating[]>(['Low', 'Moderate', 'Unknown'])
  const [selectedFacilityTypes, setSelectedFacilityTypes] = useState<string[]>(['Restaurant', 'Institutional Kitchen', 'Store', 'Unknown', 'Other'])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantWithStats | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspectionPanel, setShowInspectionPanel] = useState(false)

  // Visualization mode: 'hazard' or 'violations'
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>('violations')

  // Timeline toggle
  const [showTimeline, setShowTimeline] = useState(false)

  // Timeline filter - default to past year
  const [timelineMonths, setTimelineMonths] = useState(12)
  const cutoffDate = useMemo(() => {
    if (timelineMonths === 0) return null // All time
    const date = new Date()
    date.setMonth(date.getMonth() - timelineMonths)
    return date
  }, [timelineMonths])

  // Hazard timeline date (for hazard mode) - snap to first of month
  const now = new Date()
  const [hazardTimelineDate, setHazardTimelineDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))

  // Calculate date range from all inspections
  const inspectionDateRange = useMemo(() => {
    let minDate = new Date()
    let maxDate = new Date(2020, 0, 1)

    restaurants.forEach(r => {
      (r.inspections || []).forEach(insp => {
        const date = parseInspectionDate(insp.date || insp.inspection_date)
        if (date) {
          if (date < minDate) minDate = date
          if (date > maxDate) maxDate = date
        }
      })
    })

    // Add some padding
    const start = new Date(minDate)
    start.setMonth(start.getMonth() - 1)
    const end = new Date()

    return { start, end }
  }, [restaurants])

  // Get hazard rating at a specific date for a restaurant
  const getHazardRatingAtDate = useCallback((restaurant: RestaurantWithStats, targetDate: Date): HazardRating => {
    const inspections = restaurant.inspections || []
    if (inspections.length === 0) return (restaurant.hazard_rating as HazardRating) || 'Unknown'

    // Sort inspections by date descending
    const sortedInspections = [...inspections]
      .map(insp => ({
        ...insp,
        parsedDate: parseInspectionDate(insp.date || insp.inspection_date)
      }))
      .filter(insp => insp.parsedDate)
      .sort((a, b) => (b.parsedDate as Date).getTime() - (a.parsedDate as Date).getTime())

    // Find the most recent inspection before or on the target date
    const inspectionAtDate = sortedInspections.find(insp => {
      const parsed = insp.parsedDate as Date
      return parsed <= targetDate
    })

    if (inspectionAtDate) {
      return (inspectionAtDate.hazard_rating as HazardRating) || (restaurant.hazard_rating as HazardRating) || 'Unknown'
    }

    // If no inspection before target date, return Unknown (restaurant may not have existed yet)
    return 'Unknown'
  }, [])

  // Compute violation stats for each restaurant within the timeline
  const restaurantsWithStats = useMemo<RestaurantWithStats[]>(() => {
    return restaurants.map(r => {
      const inspections = r.inspections || []

      // Filter inspections by cutoff date (for violations mode)
      const filteredInspections = cutoffDate
        ? inspections.filter(insp => {
            const date = parseInspectionDate(insp.date || insp.inspection_date)
            return date && date >= cutoffDate
          })
        : inspections

      // Calculate violation stats
      let totalViolations = 0
      let criticalViolations = 0
      let nonCriticalViolations = 0

      filteredInspections.forEach(insp => {
        totalViolations += (insp.violations?.length || 0)
        criticalViolations += (insp.critical_violations_count || 0)
        nonCriticalViolations += (insp.non_critical_violations_count || 0)
      })

      const result: RestaurantWithStats = {
        ...r,
        filteredInspections,
        hazardRatingAtDate: 'Unknown' as HazardRating,
        violationStats: {
          total: totalViolations,
          critical: criticalViolations,
          nonCritical: nonCriticalViolations,
          inspectionCount: filteredInspections.length
        }
      }

      // Get hazard rating at the timeline date (for hazard mode)
      result.hazardRatingAtDate = getHazardRatingAtDate(result, hazardTimelineDate)

      return result
    })
  }, [restaurants, cutoffDate, hazardTimelineDate, getHazardRatingAtDate])

  const filteredRestaurants = useMemo(() => {
    return restaurantsWithStats.filter(r => {
      // In hazard mode, filter by the rating at the selected date
      const ratingToCheck = visualizationMode === 'hazard'
        ? r.hazardRatingAtDate
        : (r.current_hazard_rating || r.hazard_rating || 'Unknown') as HazardRating

      const matchesHazard = selectedHazardRatings.includes(ratingToCheck)
      const matchesFacility = selectedFacilityTypes.includes(r.facility_type || 'Unknown')
      const matchesSearch = !searchQuery ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.address.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesHazard && matchesFacility && matchesSearch
    })
  }, [restaurantsWithStats, visualizationMode, selectedHazardRatings, selectedFacilityTypes, searchQuery])

  const geocodedRestaurants = useMemo(() => {
    return filteredRestaurants.filter(r => r.latitude && r.longitude)
  }, [filteredRestaurants])

  // Stats for the current timeline
  const timelineStats = useMemo(() => {
    const all = restaurantsWithStats
    return {
      totalViolations: all.reduce((sum, r) => sum + (r.violationStats?.total || 0), 0),
      criticalViolations: all.reduce((sum, r) => sum + (r.violationStats?.critical || 0), 0),
      totalInspections: all.reduce((sum, r) => sum + (r.violationStats?.inspectionCount || 0), 0),
      restaurantsWithViolations: all.filter(r => (r.violationStats?.total || 0) > 0).length
    }
  }, [restaurantsWithStats])

  // Hazard stats at the selected date
  const hazardStatsAtDate = useMemo(() => {
    const all = restaurantsWithStats
    return {
      Low: all.filter(r => r.hazardRatingAtDate === 'Low').length,
      Moderate: all.filter(r => r.hazardRatingAtDate === 'Moderate').length,
      Unknown: all.filter(r => r.hazardRatingAtDate === 'Unknown').length
    }
  }, [restaurantsWithStats])

  // Handlers
  const handleRestaurantClick = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
  }, [])

  const handleMapRestaurantClick = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
    setShowSidebar(true)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedRestaurant(null)
    setShowInspectionPanel(false)
  }, [])

  const openInspectionPanel = useCallback(() => {
    setShowInspectionPanel(true)
  }, [])

  return (
    <div className="flex h-full w-full bg-white dark:bg-gray-900">
      {/* Sidebar */}
      {showSidebar && (
        <Sidebar
          restaurants={filteredRestaurants}
          geocodedRestaurants={geocodedRestaurants}
          loading={loading}
          error={error}
          stats={stats}
          timelineStats={timelineStats}
          hazardStatsAtDate={hazardStatsAtDate}
          selectedRestaurant={selectedRestaurant}
          searchQuery={searchQuery}
          selectedHazardRatings={selectedHazardRatings}
          selectedFacilityTypes={selectedFacilityTypes}
          timelineMonths={timelineMonths}
          visualizationMode={visualizationMode}
          onSearchQueryChange={setSearchQuery}
          onHazardRatingsChange={setSelectedHazardRatings}
          onFacilityTypesChange={setSelectedFacilityTypes}
          onTimelineMonthsChange={setTimelineMonths}
          onVisualizationModeChange={setVisualizationMode}
          onRestaurantClick={handleRestaurantClick}
          onClearSelection={clearSelection}
          onOpenInspectionPanel={openInspectionPanel}
          showTimeline={showTimeline}
          onToggleTimeline={() => setShowTimeline(!showTimeline)}
        />
      )}

      {/* Toggle sidebar button */}
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className={`absolute top-4 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          showSidebar ? 'left-[360px]' : 'left-4'
        }`}
      >
        {showSidebar ? (
          <svg className="w-5 h-5 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {/* Map */}
      <div className="flex-1 relative">
        <RestaurantMap
          restaurants={geocodedRestaurants}
          selectedRestaurant={selectedRestaurant}
          visualizationMode={visualizationMode}
          onRestaurantClick={handleMapRestaurantClick}
        />

        {/* Timeline */}
        {showTimeline && (
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10">
            <Timeline
              startDate={inspectionDateRange.start}
              endDate={inspectionDateRange.end}
              currentDate={hazardTimelineDate}
              onDateChange={setHazardTimelineDate}
            />
          </div>
        )}

        {/* Map Legend */}
        <div className="absolute bottom-6 right-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 z-10">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {visualizationMode === 'violations'
              ? `Violations (${timelineMonths === 0 ? 'All Time' : `Past ${timelineMonths}mo`})`
              : 'Hazard Rating'}
          </h4>

          {/* Violations legend */}
          {visualizationMode === 'violations' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-green-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">0 violations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-yellow-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">1-3 violations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-orange-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">4-6 violations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-red-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">7+ violations</span>
              </div>
            </div>
          )}

          {/* Hazard rating legend with counts */}
          {visualizationMode === 'hazard' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-green-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">Low ({hazardStatsAtDate.Low})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-amber-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">Moderate ({hazardStatsAtDate.Moderate})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-gray-500"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">Unknown ({hazardStatsAtDate.Unknown})</span>
              </div>
            </div>
          )}

          {visualizationMode === 'violations' && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-gray-400"></span>
                <span className="text-xs text-gray-600 dark:text-gray-300">Size = count</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inspection Detail Panel */}
      {showInspectionPanel && selectedRestaurant && (
        <InspectionPanel
          restaurant={selectedRestaurant}
          onClose={() => setShowInspectionPanel(false)}
        />
      )}
    </div>
  )
}
